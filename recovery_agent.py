"""
Recovery Agent Module — Pure Python ERP Solution Generator.

Fetches candidate recovery options from recovery_option_templates in mock_erp.db,
enriches them with real supplier master data (lead times, MOQs, freight rates),
and computes arrival dates and cost profiles across the 4 standard mitigation categories:
1. Expedited / Alternate Supply (Air Freight)
2. Alternate Supplier (Ocean Freight)
3. Production Rescheduling
4. Material Substitution
"""
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
import config


def generate_recovery_options(
    material_id: str,
    required_qty: int = 900,
    reference_date_str: str = config.REFERENCE_DATE
) -> List[Dict[str, Any]]:
    """
    Queries candidate recovery templates for the delayed material,
    joining supplier master data to compute realistic arrival dates and total costs.
    """
    conn = config.get_db_connection()
    ref_date = datetime.strptime(reference_date_str, "%Y-%m-%d")

    # Fetch templates matching the material or relevant to the hero component
    templates = conn.execute("""
        SELECT 
            t.option_id,
            t.option_type,
            t.supplier_id,
            t.material_id,
            t.description,
            t.freight_mode,
            t.lead_time_days AS template_lead_time,
            t.estimated_cost AS template_cost,
            s.supplier_name,
            s.location AS supplier_location,
            s.approved AS supplier_approved,
            s.lead_time_days AS supplier_lead_time,
            s.moq,
            s.capacity_per_day,
            s.unit_cost,
            s.export_restricted,
            s.freight_cost_air,
            s.freight_cost_sea
        FROM recovery_option_templates t
        LEFT JOIN suppliers s ON t.supplier_id = s.supplier_id
        ORDER BY t.option_id ASC
    """).fetchall()

    options: List[Dict[str, Any]] = []

    for row in templates:
        opt_id = row["option_id"]
        opt_type = row["option_type"]
        supplier_id = row["supplier_id"]
        target_material_id = row["material_id"]
        lead_time = row["template_lead_time"] or row["supplier_lead_time"] or 0
        freight_mode = row["freight_mode"]

        # 1. Arrival date calculation
        arrival_dt = ref_date + timedelta(days=lead_time)
        arrival_date_str = arrival_dt.strftime("%Y-%m-%d") if lead_time > 0 else "N/A (Schedule Shift)"

        # 2. Cost calculation
        if opt_type == "SPOT_BUY":
            # Premium freight + unit cost delta
            freight_rate = row["freight_cost_air"] if freight_mode == "AIR" else (row["freight_cost_sea"] or 0.0)
            cost_usd = row["template_cost"] or (required_qty * freight_rate)
        elif opt_type == "SUBSTITUTE":
            cost_usd = row["template_cost"] or (required_qty * (row["unit_cost"] or 35.0))
        elif opt_type == "RESCHEDULE":
            cost_usd = 0.0
        else:
            cost_usd = row["template_cost"] or 0.0

        option_dict: Dict[str, Any] = {
            "option_id": opt_id,
            "option_type": opt_type,
            "category_label": {
                "SPOT_BUY": "Expedited / Alternate Supply" if freight_mode == "AIR" else "Alternate Supplier (Standard)",
                "RESCHEDULE": "Production Reschedule",
                "SUBSTITUTE": "Material Substitution"
            }.get(opt_type, opt_type),
            "supplier_id": supplier_id,
            "supplier_name": row["supplier_name"],
            "supplier_location": row["supplier_location"],
            "material_id": target_material_id,
            "required_qty": required_qty,
            "moq": row["moq"],
            "capacity_per_day": row["capacity_per_day"],
            "freight_mode": freight_mode,
            "lead_time_days": lead_time,
            "arrival_date": arrival_date_str,
            "estimated_cost_usd": round(cost_usd, 2),
            "description": row["description"]
        }
        options.append(option_dict)

    conn.close()
    return options


def recovery_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """
    LangGraph Node for Recovery Agent:
    Retrieves candidate options across all 4 categories and passes them to the Constraint Agent.
    """
    primary_shipment = state.get("primary_shipment", {})
    material_id = primary_shipment.get("material_id", "STCOIL-440V")
    order_qty = primary_shipment.get("po_quantity", 900)
    ref_date = state.get("reference_date") or config.REFERENCE_DATE
    logs = list(state.get("trace_log") or [])

    options = generate_recovery_options(
        material_id=material_id,
        required_qty=order_qty,
        reference_date_str=ref_date
    )

    trace_entry = (
        f"Recovery Agent: Generated {len(options)} recovery options across 4 strategic categories "
        f"(Expedited Supply, Alternate Supplier, Reschedule, Substitution). "
        f"Routing to Constraint Agent for hard rule verification."
    )
    logs.append(trace_entry)

    return {
        "recovery_options": options,
        "trace_log": logs
    }
