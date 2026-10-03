"""
Impact Engine Module — Pure Python & SQL Deterministic Calculations.

Computes:
1. Time-to-Survive (TTS) from on-hand inventory and daily burn rate
2. Time-to-Recover (TTR) from revised shipment ETA
3. Stockout date and net shortage window
4. BOM & Pegging traversal across work orders (wo_materials)
5. Customer order exposure and financial OTIF risk calculation
"""
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
import config


def compute_inventory_and_shortage(
    material_id: str,
    revised_eta_str: str,
    reference_date_str: str = config.REFERENCE_DATE
) -> Dict[str, Any]:
    """
    Computes TTS vs TTR, determines shortage status, traverses BOM pegging
    to identify impacted work orders and calculate OTIF financial exposure.
    """
    conn = config.get_db_connection()
    ref_date = datetime.strptime(reference_date_str, "%Y-%m-%d")
    revised_eta_dt = datetime.strptime(revised_eta_str, "%Y-%m-%d")

    # 1. Fetch inventory parameters
    inv_row = conn.execute(
        "SELECT on_hand_qty, daily_consumption, safety_stock FROM inventory WHERE material_id = ?",
        (material_id,)
    ).fetchone()

    if not inv_row:
        conn.close()
        raise ValueError(f"Material {material_id} not found in inventory table.")

    on_hand = inv_row["on_hand_qty"]
    daily_consumption = inv_row["daily_consumption"]
    safety_stock = inv_row["safety_stock"]

    # 2. TTS & TTR Calculation
    tts_days = (on_hand / daily_consumption) if daily_consumption > 0 else 999.0
    stockout_dt = ref_date + timedelta(days=round(tts_days))
    stockout_date_str = stockout_dt.strftime("%Y-%m-%d")

    ttr_days = (revised_eta_dt - ref_date).days

    # 3. Buffer vs Shortage Evaluation
    if tts_days >= ttr_days:
        conn.close()
        return {
            "impact_status": "ABSORBED",
            "material_id": material_id,
            "on_hand_qty": on_hand,
            "daily_consumption": daily_consumption,
            "tts_days": round(tts_days, 1),
            "ttr_days": ttr_days,
            "stockout_date": stockout_date_str,
            "shortage_window_days": 0,
            "affected_work_orders": [],
            "affected_customer_orders": [],
            "otif_exposure_usd": 0.0,
            "summary": f"Buffer absorbs delay: TTS ({tts_days:.0f}d) >= TTR ({ttr_days}d). Zero shortage risk."
        }

    # Shortage confirmed
    shortage_window_days = (revised_eta_dt - stockout_dt).days

    # 4. Pegging: Traverse affected Work Orders
    wo_rows = conn.execute("""
        SELECT 
            wm.work_order_id,
            wm.required_qty,
            wm.allocated_qty,
            wm.shortage_qty,
            wo.finished_material_id,
            wo.planned_quantity,
            wo.planned_start,
            wo.planned_end,
            wo.status AS wo_status,
            wo.customer_order_id,
            wo.frozen_schedule
        FROM wo_materials wm
        JOIN work_orders wo ON wm.work_order_id = wo.work_order_id
        WHERE wm.material_id = ?
        ORDER BY wo.planned_start ASC
    """, (material_id,)).fetchall()

    affected_work_orders: List[Dict[str, Any]] = []
    affected_customer_order_ids = set()

    for row in wo_rows:
        wo_dict = dict(row)
        planned_start = row["planned_start"]
        # WO is impacted if its planned_start falls inside the shortage window:
        # stockout_date_str <= planned_start <= revised_eta_str
        if stockout_date_str <= planned_start <= revised_eta_str:
            affected_work_orders.append(wo_dict)
            if row["customer_order_id"]:
                affected_customer_order_ids.add(row["customer_order_id"])

    # 5. Customer Orders & OTIF Penalty Exposure
    affected_customer_orders: List[Dict[str, Any]] = []
    total_otif_exposure = 0.0

    for co_id in affected_customer_order_ids:
        co_row = conn.execute("""
            SELECT 
                customer_order_id,
                customer_name,
                material_id,
                quantity,
                requested_date,
                unit_price,
                status
            FROM customer_orders
            WHERE customer_order_id = ?
        """, (co_id,)).fetchone()

        if co_row:
            co_dict = dict(co_row)
            order_value = co_dict["quantity"] * (co_dict["unit_price"] or 0.0)
            co_dict["order_value_usd"] = order_value
            affected_customer_orders.append(co_dict)
            total_otif_exposure += order_value

    conn.close()

    return {
        "impact_status": "SHORTAGE",
        "material_id": material_id,
        "on_hand_qty": on_hand,
        "daily_consumption": daily_consumption,
        "tts_days": round(tts_days, 1),
        "ttr_days": ttr_days,
        "stockout_date": stockout_date_str,
        "shortage_window_days": shortage_window_days,
        "affected_work_orders": affected_work_orders,
        "affected_customer_orders": affected_customer_orders,
        "otif_exposure_usd": total_otif_exposure,
        "summary": (
            f"Confirmed shortage: Stockout {stockout_date_str} (TTS={tts_days:.0f}d), "
            f"Revised ETA {revised_eta_str} (TTR={ttr_days}d). "
            f"Shortage window: {shortage_window_days} days. "
            f"OTIF exposure: ${total_otif_exposure:,.2f} across {len(affected_customer_orders)} customer orders."
        )
    }


def impact_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """
    LangGraph Node for Impact Engine:
    Reads primary shipment from state, computes inventory burn and pegging,
    and updates state with shortage metrics and affected orders.
    """
    primary_shipment = state.get("primary_shipment")
    ref_date = state.get("reference_date") or config.REFERENCE_DATE
    logs = list(state.get("trace_log") or [])

    if not primary_shipment:
        raise ValueError("Impact Node requires a valid primary_shipment in state.")

    material_id = primary_shipment["material_id"]
    revised_eta = primary_shipment["revised_eta"]

    impact_data = compute_inventory_and_shortage(
        material_id=material_id,
        revised_eta_str=revised_eta,
        reference_date_str=ref_date
    )

    if impact_data["impact_status"] == "ABSORBED":
        trace_entry = (
            f"Impact Engine: {material_id} inventory buffer absorbs delay. "
            f"TTS ({impact_data['tts_days']}d) >= TTR ({impact_data['ttr_days']}d). Status: ABSORBED."
        )
    else:
        trace_entry = (
            f"Impact Engine: Confirmed {impact_data['shortage_window_days']}-day shortage for {material_id} "
            f"({impact_data['stockout_date']} -> {revised_eta}). "
            f"Pegged to {len(impact_data['affected_work_orders'])} work orders. "
            f"OTIF financial exposure: ${impact_data['otif_exposure_usd']:,.2f}."
        )

    logs.append(trace_entry)

    return {
        "impact_status": impact_data["impact_status"],
        "tts_days": impact_data["tts_days"],
        "ttr_days": impact_data["ttr_days"],
        "stockout_date": impact_data["stockout_date"],
        "shortage_window_days": impact_data["shortage_window_days"],
        "affected_work_orders": impact_data["affected_work_orders"],
        "affected_customer_orders": impact_data["affected_customer_orders"],
        "otif_exposure_usd": impact_data["otif_exposure_usd"],
        "trace_log": logs
    }
