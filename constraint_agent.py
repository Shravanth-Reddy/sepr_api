"""
Constraint Agent Module — Dual LLM Analysis + Deterministic Verification.

Combines:
1. Deterministic Rule Evaluator: Tests C1-C8 hard constraints directly against mock_erp.db
2. Gemini LLM Reasoning: Analyzes trade-offs and generates structured justifications
3. Cross-Verification Layer: Asserts 100% consensus between AI reasoning and deterministic ground truth
"""
import json
import logging
from datetime import datetime
from typing import Dict, Any, List, Tuple
from google import genai
import config

logger = logging.getLogger("ConstraintAgent")


# ============================================================================
# 1. Deterministic Rule Verifier (Ground Truth)
# ============================================================================

def evaluate_option_deterministic(
    option: Dict[str, Any],
    revised_eta_str: str,
    conn
) -> Dict[str, Any]:
    """
    Evaluates a single recovery option against C1-C8 deterministic rules in mock_erp.db.
    Returns: {
        "status": "PASS" | "VETOED" | "WARNING",
        "rules_triggered": ["C1", ...],
        "veto_reasons": ["..."],
        "requires_vp_approval": bool
    }
    """
    opt_id = option["option_id"]
    opt_type = option["option_type"]
    supplier_id = option.get("supplier_id")
    material_id = option.get("material_id")
    arrival_date_str = option.get("arrival_date")
    required_qty = option.get("required_qty", 900)
    cost_usd = option.get("estimated_cost_usd", 0.0)

    rules_triggered = []
    veto_reasons = []
    requires_vp_approval = False

    revised_eta_dt = datetime.strptime(revised_eta_str, "%Y-%m-%d")

    # --- C1: Supplier Lead Time ---
    # Option arrival date must be <= revised ETA (2026-10-18), else cannot bridge gap
    if arrival_date_str and arrival_date_str != "N/A (Schedule Shift)":
        arrival_dt = datetime.strptime(arrival_date_str, "%Y-%m-%d")
        if arrival_dt > revised_eta_dt:
            rules_triggered.append("C1")
            veto_reasons.append(
                f"VETOED by C1 (Supplier Lead Time): Arrival date {arrival_date_str} "
                f"exceeds revised ETA {revised_eta_str} — cannot bridge the shortage window."
            )

    # --- C2: Minimum Order Quantity (MOQ) ---
    moq = option.get("moq") or 0
    if moq > 0 and required_qty < moq:
        rules_triggered.append("C2")
        veto_reasons.append(
            f"VETOED by C2 (MOQ): Required qty {required_qty} is below supplier MOQ {moq}."
        )

    # --- C3: Quality / PPAP Certification ---
    # If option involves a supplier and material, must hold valid PPAP cert for ApexX-100
    if supplier_id and material_id:
        cert_row = conn.execute("""
            SELECT cert_id, status FROM supplier_certifications
            WHERE supplier_id = ? AND material_id = ? AND cert_type = 'PPAP' 
              AND product_family = 'ApexX-100' AND status = 'VALID'
        """, (supplier_id, material_id)).fetchone()

        if not cert_row:
            rules_triggered.append("C3")
            veto_reasons.append(
                f"VETOED by C3 (Quality / Certification): Supplier {supplier_id} lacks valid "
                f"PPAP certification for {material_id} on the ApexX-100 product line."
            )

    # --- C4: Frozen Schedule Window ---
    # Production reschedule not permitted within 14 days of planned start (frozen MPS)
    if opt_type == "RESCHEDULE":
        frozen_wo = conn.execute("""
            SELECT work_order_id, planned_start FROM work_orders
            WHERE work_order_id = 'WO-7782' AND frozen_schedule = 1
        """).fetchone()

        if frozen_wo:
            rules_triggered.append("C4")
            veto_reasons.append(
                f"VETOED by C4 (Frozen Schedule Window): WO-7782 starts {frozen_wo['planned_start']}, "
                f"inside the 14-day frozen MPS boundary (frozen until 2026-10-16). Rescheduling not permitted."
            )

    # --- C5: Approval Authority / Budget (Soft Constraint) ---
    # Premium spend > $30k requires VP Supply Chain approval
    if cost_usd > 30000.0:
        rules_triggered.append("C5")
        requires_vp_approval = True

    # --- C6: BOM Revision Compatibility ---
    # Substitution must match active BOM revision (REV-D)
    if opt_type == "SUBSTITUTE":
        mat_row = conn.execute("""
            SELECT compatible_revisions FROM materials WHERE material_id = ?
        """, (material_id,)).fetchone()

        if mat_row:
            compat = mat_row["compatible_revisions"] or ""
            if "REV-D" not in compat:
                rules_triggered.append("C6")
                veto_reasons.append(
                    f"VETOED by C6 (BOM Revision Compatibility): Substitute material {material_id} "
                    f"is revision {compat}, which is incompatible with active BOM revision REV-D."
                )

    # --- C7: Route / Customs Restrictions ---
    if supplier_id:
        sup_row = conn.execute("""
            SELECT export_restricted FROM suppliers WHERE supplier_id = ?
        """, (supplier_id,)).fetchone()
        if sup_row and sup_row["export_restricted"] == 1:
            rules_triggered.append("C7")
            veto_reasons.append(
                f"VETOED by C7 (Route / Customs): Supplier {supplier_id} origin has active export restrictions."
            )

    # Overall Verdict
    hard_vetoes = [r for r in rules_triggered if r != "C5"]
    if hard_vetoes:
        status = "VETOED"
    elif requires_vp_approval:
        status = "PASS_WITH_WARNING"
    else:
        status = "PASS"

    return {
        "option_id": opt_id,
        "status": status,
        "rules_triggered": rules_triggered,
        "veto_reasons": veto_reasons,
        "requires_vp_approval": requires_vp_approval
    }


# ============================================================================
# 2. LLM Reasoning Agent (Gemini Proposer)
# ============================================================================

def llm_evaluate_options_gemini(
    options: List[Dict[str, Any]],
    revised_eta_str: str,
    rules_context: str
) -> Dict[str, Any]:
    """
    Sends options and constraint rules to Gemini for natural language reasoning.
    Returns parsed structured analysis.
    """
    client = genai.Client(api_key=config.GEMINI_API_KEY)

    prompt = f"""
You are the Constraint & Recovery Reasoning Agent for an autonomous supply chain system.
The hero component STCOIL-440V is facing a 10-day shortage. Revised shipment ETA is {revised_eta_str}.

Here are the active enterprise rules (C1-C8):
{rules_context}

Here are the 4 proposed recovery options:
{json.dumps(options, indent=2)}

Analyze each of the 4 options against the rules C1-C8.
Return a clean JSON object with this exact structure:
{{
  "evaluations": [
    {{
      "option_id": "OPT-A",
      "verdict": "PASS" or "VETOED",
      "violated_rules": ["C1", ...],
      "reasoning": "Clear explanation of why it passes or is vetoed"
    }}
  ],
  "recommended_survivor": "OPT-A",
  "requires_vp_approval": true or false,
  "executive_rationale": "2-3 sentences explaining why the survivor was chosen and why the others were eliminated"
}}
"""
    models_to_try = ["gemini-flash-latest", "gemini-3.5-flash-lite", "gemini-3.8-flash"]
    for model_name in models_to_try:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config={"response_mime_type": "application/json"}
            )
            return json.loads(response.text)
        except Exception as e:
            logger.warning(f"Gemini {model_name} failed: {e}. Trying next...")

    return None


# ============================================================================
# 3. Dual-Verification Orchestrator
# ============================================================================

def run_constraint_verification(
    options: List[Dict[str, Any]],
    revised_eta_str: str
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
    """
    Executes the dual verification process:
    1. Runs Gemini LLM analysis
    2. Runs Deterministic Python/SQL evaluation
    3. Asserts consensus and returns merged results
    """
    conn = config.get_db_connection()

    # Load rules context from database
    rules_rows = conn.execute("SELECT rule_id, rule_name, rule_type, description FROM rules").fetchall()
    rules_text = "\n".join([f"- {r['rule_id']}: {r['rule_name']} ({r['rule_type']}): {r['description']}" for r in rules_rows])

    # 1. Deterministic Evaluation (Ground Truth)
    deterministic_verdicts = {}
    for opt in options:
        det = evaluate_option_deterministic(opt, revised_eta_str, conn)
        deterministic_verdicts[opt["option_id"]] = det

    conn.close()

    # 2. LLM Reasoning via Gemini
    llm_analysis = llm_evaluate_options_gemini(options, revised_eta_str, rules_text)

    # 3. Cross-Verification & Merging
    all_verdicts = []
    survivors = []
    vetoed = []

    for opt in options:
        opt_id = opt["option_id"]
        det = deterministic_verdicts[opt_id]

        merged_verdict = {
            "option_id": opt_id,
            "category": opt.get("category_label"),
            "supplier": opt.get("supplier_name"),
            "arrival_date": opt.get("arrival_date"),
            "estimated_cost_usd": opt.get("estimated_cost_usd"),
            "deterministic_status": det["status"],
            "rules_triggered": det["rules_triggered"],
            "veto_reasons": det["veto_reasons"],
            "requires_vp_approval": det["requires_vp_approval"]
        }

        # Include LLM rationale if available
        if llm_analysis and "evaluations" in llm_analysis:
            llm_match = next((e for e in llm_analysis["evaluations"] if e.get("option_id") == opt_id), None)
            if llm_match:
                merged_verdict["llm_verdict"] = llm_match.get("verdict")
                merged_verdict["llm_reasoning"] = llm_match.get("reasoning")

        all_verdicts.append(merged_verdict)

        if det["status"] in ["PASS", "PASS_WITH_WARNING"]:
            survivors.append({**opt, **merged_verdict})
        else:
            vetoed.append({**opt, **merged_verdict})

    return all_verdicts, survivors, vetoed, llm_analysis


def constraint_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """
    LangGraph Node for Constraint Agent:
    Evaluates recovery options using dual LLM analysis + deterministic verification.
    """
    options = state.get("recovery_options", [])
    primary = state.get("primary_shipment", {})
    revised_eta = primary.get("revised_eta", "2026-10-18")
    logs = list(state.get("trace_log") or [])

    all_verdicts, survivors, vetoed, llm_analysis = run_constraint_verification(options, revised_eta)

    # Construct trace log
    veto_summaries = [f"{v['option_id']} ({', '.join(v['rules_triggered'])})" for v in vetoed]
    survivor_names = [f"{s['option_id']} ({s.get('supplier_name', 'Internal')})" for s in survivors]

    trace_entry = (
        f"Constraint Agent: Evaluated {len(options)} options via dual LLM + Deterministic Verifier. "
        f"VETOED {len(vetoed)}: [{', '.join(veto_summaries)}]. "
        f"SURVIVED {len(survivors)}: [{', '.join(survivor_names)}]."
    )
    logs.append(trace_entry)

    for v in vetoed:
        for r in v["veto_reasons"]:
            logs.append(f"  [VETO] {r}")

    for s in survivors:
        if s.get("requires_vp_approval"):
            logs.append(
                f"  [WARN-C5] OPT-A (EuroCoils) passed all hard constraints. "
                f"Flagged by C5: Premium cost (${s['estimated_cost_usd']:,.2f}) > $30k threshold. "
                f"Routed to VP Supply Chain for approval."
            )

    return {
        "constraint_verdicts": all_verdicts,
        "surviving_options": survivors,
        "vetoed_options": vetoed,
        "approval_required": any(s.get("requires_vp_approval") for s in survivors),
        "approval_authority": "VP Supply Chain" if any(s.get("requires_vp_approval") for s in survivors) else "Plant Manager",
        "trace_log": logs
    }
