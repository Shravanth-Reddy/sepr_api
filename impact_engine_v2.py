"""
Phase 1: Verified Impact Engine & Attribution Calculator.

Ground Truth Principles:
1. Pinned Scenario Clock: as_of = 2026-10-03 (prevents clock drift).
2. Honest Gap Attribution:
   Total Shortage Gap = Baseline Pre-Existing Deficit + Disruption Delay
3. Verifiable OTIF Exposure:
   WO start, duration, completion date, and SO SLA delivery deadline.
4. Residual Gap Calculation for Recovery Options:
   Residual Shortage = Option Arrival Date - Stockout Date.
5. Reactive C1-C8 Matrix:
   Evaluates rules dynamically based on simulated delay.
"""
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
import config


def get_incident_dossier(
    as_of: str = "2026-10-03",
    simulated_delay_days: int = 7
) -> Dict[str, Any]:
    """
    Computes the complete, verified incident dossier directly from mock_erp.db
    with separated baseline vs disruption gap attribution and dynamic C1-C8 matrix.
    """
    conn = config.get_db_connection()
    ref_date = datetime.strptime(as_of, "%Y-%m-%d")

    # 1. Hero Component: STCOIL-440V
    inv = conn.execute("""
        SELECT on_hand_qty, daily_consumption, safety_stock 
        FROM inventory WHERE material_id = 'STCOIL-440V'
    """).fetchone()

    on_hand = inv["on_hand_qty"]
    daily_burn = inv["daily_consumption"]
    safety_stock = inv["safety_stock"]

    tts_days = on_hand / daily_burn  # 400 / 80 = 5.0 days
    stockout_dt = ref_date + timedelta(days=round(tts_days))
    stockout_date_str = stockout_dt.strftime("%Y-%m-%d")  # 2026-10-08

    # 2. Hero Shipment: SHIP-7010
    ship = conn.execute("""
        SELECT s.shipment_id, s.po_id, s.origin, s.destination, s.vessel_name, s.original_eta,
               po.quantity AS po_quantity, po.supplier_id, sup.supplier_name
        FROM shipments s
        JOIN purchase_orders po ON s.po_id = po.po_id
        JOIN suppliers sup ON po.supplier_id = sup.supplier_id
        WHERE s.shipment_id = 'SHIP-7010'
    """).fetchone()

    orig_eta_str = ship["original_eta"]  # 2026-10-11
    orig_eta_dt = datetime.strptime(orig_eta_str, "%Y-%m-%d")

    # Baseline planned arrival days from ref
    planned_arrival_days = (orig_eta_dt - ref_date).days  # 8 days (Oct 11)

    # 3. Honest Gap Attribution
    baseline_gap_days = max(0, (orig_eta_dt - stockout_dt).days)  # Oct 11 - Oct 8 = 3 days baseline deficit
    disruption_gap_days = simulated_delay_days  # +7 days from storm

    revised_eta_dt = orig_eta_dt + timedelta(days=simulated_delay_days)
    revised_eta_str = revised_eta_dt.strftime("%Y-%m-%d")  # 2026-10-18
    ttr_days = (revised_eta_dt - ref_date).days  # 15 days

    total_gap_days = (revised_eta_dt - stockout_dt).days if ttr_days > tts_days else 0

    # 4. Verifiable Work Order & Customer Order Timeline
    # WO-7782 (FIRM for ACME Corp SO-55102)
    wo = conn.execute("""
        SELECT work_order_id, finished_material_id, planned_quantity, 
               planned_start, planned_end, status, customer_order_id, frozen_schedule
        FROM work_orders WHERE work_order_id = 'WO-7782'
    """).fetchone()

    wo_start_dt = datetime.strptime(wo["planned_start"], "%Y-%m-%d")  # 2026-10-14
    wo_end_dt = datetime.strptime(wo["planned_end"], "%Y-%m-%d")      # 2026-10-17
    wo_duration_days = (wo_end_dt - wo_start_dt).days                 # 3 days

    co = conn.execute("""
        SELECT customer_order_id, customer_name, material_id, quantity, requested_date, unit_price, status
        FROM customer_orders WHERE customer_order_id = 'SO-55102'
    """).fetchone()

    so_due_dt = datetime.strptime(co["requested_date"], "%Y-%m-%d")   # 2026-10-19

    # Without mitigation: WO-7782 can only start when revised shipment arrives on revised_eta_dt (Oct 18 if +7d)
    delayed_wo_start_dt = max(wo_start_dt, revised_eta_dt)
    delayed_wo_end_dt = delayed_wo_start_dt + timedelta(days=wo_duration_days)
    days_past_sla = max(0, (delayed_wo_end_dt - so_due_dt).days)
    otif_exposure_usd = (co["quantity"] * (co["unit_price"] or 240.0)) if days_past_sla > 0 else 0.0

    # 5. Recovery Options with Residual Gap and Dynamic C1-C8 Matrix
    templates = conn.execute("""
        SELECT t.option_id, t.option_type, t.supplier_id, t.material_id, t.description,
               t.freight_mode, t.lead_time_days AS template_lead_time, t.estimated_cost,
               s.supplier_name, s.location AS supplier_location, s.approved, s.lead_time_days AS sup_lead_time,
               s.moq, s.capacity_per_day, s.unit_cost, s.export_restricted, s.freight_cost_air, s.freight_cost_sea
        FROM recovery_option_templates t
        LEFT JOIN suppliers s ON t.supplier_id = s.supplier_id
        ORDER BY t.option_id ASC
    """).fetchall()

    options_matrix: List[Dict[str, Any]] = []

    for t in templates:
        opt_id = t["option_id"]
        opt_type = t["option_type"]
        supplier_id = t["supplier_id"]
        target_mat = t["material_id"]
        lead_time = t["template_lead_time"] or t["sup_lead_time"] or 0
        freight_mode = t["freight_mode"] or "LAND"

        # Arrival Date
        if opt_type == "RESCHEDULE":
            arrival_str = "Schedule Shift (No Inflow)"
            arrival_dt = None
            residual_gap = total_gap_days
        else:
            arrival_dt = ref_date + timedelta(days=lead_time)
            arrival_str = arrival_dt.strftime("%Y-%m-%d")
            # Residual gap: how many days of shortage remain between stockout and option arrival
            if arrival_dt > stockout_dt:
                residual_gap = (arrival_dt - stockout_dt).days
            else:
                residual_gap = 0

        # Cost
        if opt_type == "SPOT_BUY":
            freight_rate = t["freight_cost_air"] if freight_mode == "AIR" else (t["freight_cost_sea"] or 0.0)
            cost_usd = t["estimated_cost"] or (900 * freight_rate)
        elif opt_type == "SUBSTITUTE":
            cost_usd = t["estimated_cost"] or 15000.0
        else:
            cost_usd = 0.0

        # Dynamic Rule Evaluation (C1 through C8)
        rules_eval = {}

        # C1: Lead Time (Option arrival <= revised ETA)
        if arrival_dt:
            c1_pass = arrival_dt <= revised_eta_dt
            rules_eval["C1"] = {
                "pass": c1_pass,
                "value": f"{lead_time}d (Arrives {arrival_str})",
                "threshold": f"<= Revised ETA {revised_eta_str}",
                "reason": "Arrival bridges gap before revised ETA" if c1_pass else f"Arrives {arrival_str}, exceeding revised ETA {revised_eta_str} by {(arrival_dt - revised_eta_dt).days} days"
            }
        else:
            rules_eval["C1"] = {"pass": False, "value": "No inflow", "threshold": "Must bridge supply", "reason": "Rescheduling does not supply components"}

        # C2: MOQ
        moq = t["moq"] or 0
        c2_pass = (900 >= moq) if moq > 0 else True
        rules_eval["C2"] = {
            "pass": c2_pass,
            "value": f"900 units",
            "threshold": f">= MOQ {moq}",
            "reason": "Satisfies supplier minimum order quantity"
        }

        # C3: Quality / PPAP
        if supplier_id and target_mat:
            cert = conn.execute("""
                SELECT cert_id FROM supplier_certifications 
                WHERE supplier_id = ? AND material_id = ? AND cert_type = 'PPAP' 
                  AND product_family = 'ApexX-100' AND status = 'VALID'
            """, (supplier_id, target_mat)).fetchone()
            c3_pass = cert is not None
            rules_eval["C3"] = {
                "pass": c3_pass,
                "value": "Valid PPAP" if c3_pass else "NO PPAP CERT",
                "threshold": "ApexX-100 PPAP Required",
                "reason": "Holds active PPAP certification" if c3_pass else f"Supplier {supplier_id} lacks PPAP for {target_mat} on ApexX-100"
            }
        else:
            rules_eval["C3"] = {"pass": True, "value": "Internal", "threshold": "N/A", "reason": "No supplier certification required"}

        # C4: Frozen Schedule Window (Cannot reschedule within 14 days of start)
        if opt_type == "RESCHEDULE":
            frozen_pass = wo["frozen_schedule"] == 0
            rules_eval["C4"] = {
                "pass": frozen_pass,
                "value": f"WO-7782 starts {wo['planned_start']}",
                "threshold": "Frozen window until 2026-10-16",
                "reason": "Rescheduling permitted" if frozen_pass else "WO-7782 starts Oct 14, inside 14-day frozen window (frozen until Oct 16)"
            }
        else:
            rules_eval["C4"] = {"pass": True, "value": "N/A", "threshold": "Schedule unchanged", "reason": "Production schedule preserved"}

        # C5: Budget / Approval (Soft constraint: > $30k requires VP approval)
        c5_vp = cost_usd > 30000.0
        rules_eval["C5"] = {
            "pass": True,  # Soft rule, does not veto
            "warning": c5_vp,
            "value": f"${cost_usd:,.2f}",
            "threshold": "<= $30,000 (Plant Mgr)",
            "reason": "Requires VP Supply Chain approval (exceeds $30k threshold)" if c5_vp else "Within Plant Manager authorization limit"
        }

        # C6: BOM Revision
        if opt_type == "SUBSTITUTE":
            mat_row = conn.execute("SELECT compatible_revisions FROM materials WHERE material_id = ?", (target_mat,)).fetchone()
            compat = mat_row["compatible_revisions"] if mat_row else ""
            c6_pass = "REV-D" in (compat or "")
            rules_eval["C6"] = {
                "pass": c6_pass,
                "value": compat,
                "threshold": "REV-D Required",
                "reason": "Revision compatible" if c6_pass else f"Material {target_mat} is {compat}, incompatible with active BOM REV-D"
            }
        else:
            rules_eval["C6"] = {"pass": True, "value": "REV-D", "threshold": "Active BOM", "reason": "Matches active BOM revision"}

        # C7: Route / Customs
        export_rest = t["export_restricted"] or 0
        c7_pass = export_rest == 0
        rules_eval["C7"] = {
            "pass": c7_pass,
            "value": "Clear" if c7_pass else "RESTRICTED",
            "threshold": "No export embargo",
            "reason": "No export restrictions" if c7_pass else "Origin country has active customs export hold"
        }

        # C8: Capacity
        cap_day = t["capacity_per_day"] or 5000
        monthly_cap = cap_day * 30
        c8_pass = 900 <= monthly_cap
        rules_eval["C8"] = {
            "pass": c8_pass,
            "value": f"900 / {monthly_cap:,} mo",
            "threshold": f"<= {monthly_cap:,} units/mo",
            "reason": "Within supplier production capacity"
        }

        # Overall Status
        hard_fails = [cid for cid, r in rules_eval.items() if cid != "C5" and not r["pass"]]
        if hard_fails:
            status = "VETOED"
        elif rules_eval["C5"]["warning"]:
            status = "PASS_WITH_WARNING"
        else:
            status = "PASS"

        options_matrix.append({
            "option_id": opt_id,
            "option_type": opt_type,
            "category_label": {
                "SPOT_BUY": "Expedited Supply" if freight_mode == "AIR" else "Alternate Supplier (Ocean)",
                "RESCHEDULE": "Production Reschedule",
                "SUBSTITUTE": "Material Substitution"
            }.get(opt_type, opt_type),
            "supplier_name": t["supplier_name"] or "Internal Plant Operations",
            "location": t["supplier_location"] or "Chennai Plant Floor",
            "freight_mode": freight_mode,
            "lead_time_days": lead_time,
            "arrival_date": arrival_str,
            "residual_gap_days": residual_gap,
            "estimated_cost_usd": round(cost_usd, 2),
            "status": status,
            "hard_vetoes": hard_fails,
            "requires_vp_approval": rules_eval["C5"]["warning"],
            "rules": rules_eval,
            "description": t["description"]
        })

    conn.close()

    # Protected OTIF and Net Value for Recommended Option (OPT-A)
    rec_option = next((o for o in options_matrix if o["status"] in ["PASS", "PASS_WITH_WARNING"]), None)
    cost_opt_a = rec_option["estimated_cost_usd"] if rec_option else 30150.0
    net_value_saved = max(0.0, otif_exposure_usd - cost_opt_a) if days_past_sla > 0 else 0.0

    return {
        "incident_id": "INC-2026-PORT-KLANG-01",
        "as_of": as_of,
        "disruption": {
            "event_name": "Port Klang Typhoon Squall & Container Berth Congestion",
            "location": "Port Klang, Malaysia",
            "severity": "CRITICAL" if days_past_sla > 0 else "NOMINAL",
            "vessel_name": ship["vessel_name"],
            "shipment_id": ship["shipment_id"],
            "po_id": ship["po_id"],
            "material_id": "STCOIL-440V",
            "material_name": "Stator Coil 440V (Hero Component)",
            "supplier_name": ship["supplier_name"],
            "simulated_delay_days": simulated_delay_days,
            "original_eta": orig_eta_str,
            "revised_eta": revised_eta_str
        },
        "attribution_math": {
            "on_hand_qty": on_hand,
            "daily_burn_rate": daily_burn,
            "tts_days": tts_days,
            "tts_formula": f"{on_hand} on-hand ÷ {daily_burn}/day = {tts_days:.1f} days",
            "stockout_date": stockout_date_str,
            "planned_arrival_date": orig_eta_str,
            "baseline_gap_days": baseline_gap_days,
            "baseline_explanation": f"Stockout is {stockout_date_str}, but original ETA was {orig_eta_str} ({baseline_gap_days}d pre-existing gap before typhoon)",
            "disruption_delay_days": disruption_gap_days,
            "total_shortage_gap_days": total_gap_days,
            "gap_equation": f"{baseline_gap_days}d (Baseline Deficit) + {disruption_gap_days}d (Storm Delay) = {total_gap_days}d Net Shortage"
        },
        "verifiable_exposure": {
            "work_order_id": wo["work_order_id"],
            "wo_planned_start": wo["planned_start"],
            "wo_planned_end": wo["planned_end"],
            "wo_duration_days": wo_duration_days,
            "customer_order_id": co["customer_order_id"],
            "customer_name": co["customer_name"],
            "so_due_date": co["requested_date"],
            "delayed_completion_date": delayed_wo_end_dt.strftime("%Y-%m-%d"),
            "days_past_sla": days_past_sla,
            "otif_exposure_usd": otif_exposure_usd,
            "proof_narrative": (
                f"WO-7782 requires STCOIL-440V to produce 500 drives for ACME Corp (SO-55102, due {co['requested_date']}). "
                f"Without recovery, parts arrive {revised_eta_str}, delaying completion to {delayed_wo_end_dt.strftime('%Y-%m-%d')} "
                f"({days_past_sla} days past ACME's delivery SLA), triggering ${otif_exposure_usd:,.2f} in contract penalties."
                if days_past_sla > 0 else
                f"WO-7782 requires STCOIL-440V to produce 500 drives for ACME Corp (SO-55102, due {co['requested_date']}). "
                f"Components arrive {revised_eta_str} on-time, completing by {delayed_wo_end_dt.strftime('%Y-%m-%d')} (0 days past SLA). Zero contract penalty exposure."
            )
        },
        "recovery_options_matrix": options_matrix,
        "executive_summary": {
            "recommended_option_id": (rec_option["option_id"] if rec_option else None) if days_past_sla > 0 else "NONE_REQUIRED",
            "recommended_supplier": (rec_option["supplier_name"] if rec_option else None) if days_past_sla > 0 else "Standard Supply Route",
            "expedite_cost_usd": cost_opt_a if days_past_sla > 0 else 0.0,
            "penalty_avoided_usd": otif_exposure_usd,
            "net_value_saved_usd": net_value_saved,
            "roi_ratio": round(net_value_saved / cost_opt_a, 2) if (cost_opt_a > 0 and days_past_sla > 0) else 0,
            "residual_gap_days": rec_option["residual_gap_days"] if rec_option else 0,
            "approval_required": rec_option["requires_vp_approval"] if (rec_option and days_past_sla > 0) else False,
            "approval_authority": ("VP Supply Chain (Rule C5: Spend > $30k)" if (rec_option and rec_option["requires_vp_approval"]) else "Plant Manager") if days_past_sla > 0 else "None"
        }
    }


if __name__ == "__main__":
    dossier = get_incident_dossier()
    print("=" * 70)
    print("VERIFIED INCIDENT DOSSIER:")
    print("=" * 70)
    print("Gap Attribution:", dossier["attribution_math"]["gap_equation"])
    print("Customer Exposure Proof:", dossier["verifiable_exposure"]["proof_narrative"])
    print("Recommended Action:", dossier["executive_summary"]["recommended_option_id"], "-", dossier["executive_summary"]["recommended_supplier"])
    print("Expedite Cost:", f"${dossier['executive_summary']['expedite_cost_usd']:,.2f}")
    print("Penalty Avoided:", f"${dossier['executive_summary']['penalty_avoided_usd']:,.2f}")
    print("Net Value Saved:", f"+${dossier['executive_summary']['net_value_saved_usd']:,.2f}")
    print("Residual Shortage Gap with Option A:", f"{dossier['executive_summary']['residual_gap_days']} days")
