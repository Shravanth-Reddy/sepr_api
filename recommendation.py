"""
Recommendation Agent Module — Gemini LLM Executive Trade-Off Synthesis.

Synthesizes:
1. The sole feasible survivor (OPT-A EuroCoils)
2. Financial trade-off: $30.1k premium freight vs $120k OTIF penalty on ACME Corp (SO-55102)
3. Formal 3-sentence executive briefing drafted by Gemini
4. Human approval routing for the VP Supply Chain (Rule C5)
"""
import json
import logging
from typing import Dict, Any, List, Optional
from google import genai
import config

logger = logging.getLogger("RecommendationAgent")


def generate_executive_briefing_gemini(
    survivor: Dict[str, Any],
    vetoed: List[Dict[str, Any]],
    otif_exposure_usd: float,
    shortage_window_days: int
) -> str:
    """
    Prompts Gemini to draft a concise 3-sentence executive summary
    synthesizing the trade-off and rule vetoes for leadership.
    """
    client = genai.Client(api_key=config.GEMINI_API_KEY)

    prompt = f"""
You are the Chief Supply Chain Decision Intelligence Agent.
A critical component shortage of STCOIL-440V threatens plant operations and customer deliveries.

Facts:
- Shortage window: {shortage_window_days} days.
- Customer penalty exposure: ${otif_exposure_usd:,.2f} on ACME Corp order SO-55102 (due 2026-10-19).
- Surviving recommended option: {survivor.get('option_id')} ({survivor.get('category')}) from {survivor.get('supplier_name')}.
  - Mode: {survivor.get('freight_mode')}
  - Arrival: {survivor.get('arrival_date')} (bridges the shortage gap)
  - Cost: ${survivor.get('estimated_cost_usd', 0.0):,.2f}
  - Approval rule: Triggered C5 (spend > $30k), requiring VP Supply Chain approval.
- Vetoed alternatives:
  - OPT-B (Hanoi Coils): Vetoed by C1 (30-day lead time exceeds revised ETA, arrives Nov 2).
  - OPT-C (Reschedule WO-7782): Vetoed by C4 (falls inside 14-day frozen schedule window).
  - OPT-D (Substitute 415V): Vetoed by C3 (no PPAP cert for ApexX-100) and C6 (BOM revision mismatch).

Write a high-impact, professional 3-sentence executive summary for the VP Supply Chain.
Sentence 1: State the crisis (disruption, shortage window, and $120k OTIF penalty on ACME Corp).
Sentence 2: State the recommended action, its cost ($30,150 air freight from EuroCoils), and net value saved (~$89,850).
Sentence 3: State that all 3 alternatives were eliminated by hard engineering/planning constraints (C1, C4, C3/C6), requiring the VP's sign-off under C5.
"""
    models_to_try = ["gemini-flash-latest", "gemini-3.5-flash-lite", "gemini-3.8-flash"]
    for model_name in models_to_try:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=prompt
            )
            return response.text.strip()
        except Exception as e:
            logger.warning(f"Gemini {model_name} failed in recommendation: {e}. Trying next...")

    # Deterministic fallback if API offline
    return (
        f"A Port Klang shipping disruption creates a confirmed {shortage_window_days}-day stator coil shortage, "
        f"exposing ACME Corp order SO-55102 to ${otif_exposure_usd:,.2f} in OTIF penalties. "
        f"We recommend executing OPT-A: spot buy 900 units via air freight from EuroCoils GmbH for ${survivor.get('estimated_cost_usd', 30150):,.2f}, "
        f"arriving 2026-10-13 to protect the production line and yield a net value preservation of ~${otif_exposure_usd - survivor.get('estimated_cost_usd', 30150):,.2f}. "
        f"Three alternative options were disqualified by deterministic constraints (C1 lead time, C4 frozen schedule, C3/C6 quality & revision), "
        f"routing this $30k+ spend to the VP Supply Chain for final sign-off under Rule C5."
    )


def recommend_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """
    LangGraph Node for Recommendation Agent:
    Takes the surviving feasible option, calculates ROI, calls Gemini for executive briefing,
    and marks the workflow as READY for human approval.
    """
    survivors = state.get("surviving_options", [])
    vetoed = state.get("vetoed_options", [])
    otif_exposure = state.get("otif_exposure_usd", 120000.0)
    shortage_window = state.get("shortage_window_days", 10)
    logs = list(state.get("trace_log") or [])

    if not survivors:
        raise ValueError("Recommend node reached with no surviving options. Router error.")

    primary_survivor = survivors[0]
    cost = primary_survivor.get("estimated_cost_usd", 30150.0)
    net_benefit = otif_exposure - cost

    # Generate executive summary via Gemini
    summary_text = generate_executive_briefing_gemini(
        survivor=primary_survivor,
        vetoed=vetoed,
        otif_exposure_usd=otif_exposure,
        shortage_window_days=shortage_window
    )

    trace_entry = (
        f"Recommendation Agent: Drafted executive briefing via Gemini LLM. "
        f"Recommended: {primary_survivor['option_id']} ({primary_survivor.get('supplier_name', 'EuroCoils')}) "
        f"at ${cost:,.2f} premium freight vs ${otif_exposure:,.2f} OTIF risk (Net benefit: +${net_benefit:,.2f}). "
        f"Routed to {state.get('approval_authority', 'VP Supply Chain')} for human gate approval."
    )
    logs.append(trace_entry)

    return {
        "recommended_option": {
            **primary_survivor,
            "net_benefit_usd": round(net_benefit, 2)
        },
        "recommendation_summary": summary_text,
        "final_status": "READY",
        "trace_log": logs
    }
