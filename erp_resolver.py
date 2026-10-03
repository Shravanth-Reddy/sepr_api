"""
ERP Entity Resolution Engine.

Cross-references external disruption signals (affected port, vessel, delay)
against mock_erp.db to resolve affected in-transit shipments, purchase orders,
materials, and calculate revised ETAs.

Updated for ApexX-100 scenario:
  - Hero shipment: SHIP-7010 (PO-7010, STCOIL-440V, MV Sentinel, Port Klang)
  - Scenario B: SHIP-6205-01 (PO-7015, BEARING-6205)
"""
import logging
from datetime import datetime, timedelta
from typing import List, Optional
from pydantic import BaseModel, Field
import config

logger = logging.getLogger(__name__)


class ResolvedShipmentImpact(BaseModel):
    shipment_id: str = Field(..., description="ID of affected shipment, e.g., SHIP-7010")
    po_id: str = Field(..., description="Associated Purchase Order ID, e.g., PO-7010")
    vessel_name: str = Field(..., description="Carrying vessel name, e.g., MV Sentinel")
    origin: str = Field(..., description="Origin port / location")
    destination: str = Field(..., description="Destination port / facility")
    material_id: str = Field(..., description="Delayed component material ID, e.g., STCOIL-440V")
    material_name: str = Field(..., description="Human-readable material name")
    supplier_id: str = Field(..., description="Supplier ID, e.g., SUP-001")
    supplier_name: str = Field(..., description="Supplier company name")
    po_quantity: int = Field(..., description="Quantity ordered in this PO")
    original_eta: str = Field(..., description="Original scheduled ETA (YYYY-MM-DD)")
    revised_eta: str = Field(..., description="Calculated revised ETA after delay (YYYY-MM-DD)")
    delay_days: int = Field(..., description="Added delay days")
    days_to_revised_eta: int = Field(..., description="Time to recover (TTR) in days from reference date")
    status: str = Field(..., description="Current shipment status")


def calculate_revised_eta(original_eta_str: str, delay_days: int) -> str:
    """Calculates new arrival date by adding delay days to original ETA."""
    try:
        orig_dt = datetime.strptime(original_eta_str, "%Y-%m-%d")
        revised_dt = orig_dt + timedelta(days=delay_days)
        return revised_dt.strftime("%Y-%m-%d")
    except Exception as e:
        logger.warning(f"Error calculating revised ETA: {e}")
        return original_eta_str


def resolve_disruption_to_erp(
    location: str,
    vessel_name: Optional[str] = None,
    delay_days: int = config.DEFAULT_DELAY_DAYS,
    reference_date_str: str = config.REFERENCE_DATE
) -> List[ResolvedShipmentImpact]:
    """
    Queries mock_erp.db to find active shipments matching the disruption location
    or vessel, joining with PO, material, and supplier records.

    Returns empty list for unrecognized locations/vessels (false-positive / IGNORED).
    """
    conn = config.get_db_connection()
    cursor = conn.cursor()

    query = """
        SELECT 
            s.shipment_id,
            s.po_id,
            s.vessel_name,
            s.origin,
            s.destination,
            s.original_eta,
            s.status,
            po.material_id,
            po.quantity AS po_quantity,
            po.supplier_id,
            m.material_name,
            sup.supplier_name
        FROM shipments s
        JOIN purchase_orders po ON s.po_id = po.po_id
        JOIN materials m ON po.material_id = m.material_id
        JOIN suppliers sup ON po.supplier_id = sup.supplier_id
        WHERE s.status = 'IN_TRANSIT'
    """

    cursor.execute(query)
    all_in_transit = cursor.fetchall()

    matched_rows = []
    location_norm = location.strip().lower()

    # 1. First try matching by vessel name if provided
    if vessel_name:
        vessel_norm = vessel_name.strip().lower()
        matched_rows = [
            row for row in all_in_transit
            if vessel_norm in row["vessel_name"].lower()
        ]

    # 2. If no match by vessel, match by origin port/location (only if location is non-empty)
    if not matched_rows and location_norm:
        matched_rows = [
            row for row in all_in_transit
            if location_norm in row["origin"].lower() or row["origin"].lower() in location_norm
        ]

    # 3. If no match at all, return empty — this is a false positive / IGNORED signal
    if not matched_rows:
        conn.close()
        return []

    ref_date = datetime.strptime(reference_date_str, "%Y-%m-%d")
    results: List[ResolvedShipmentImpact] = []

    for row in matched_rows:
        orig_eta = row["original_eta"]
        new_eta = calculate_revised_eta(orig_eta, delay_days)
        new_eta_dt = datetime.strptime(new_eta, "%Y-%m-%d")
        ttr_days = (new_eta_dt - ref_date).days

        impact = ResolvedShipmentImpact(
            shipment_id=row["shipment_id"],
            po_id=row["po_id"],
            vessel_name=row["vessel_name"],
            origin=row["origin"],
            destination=row["destination"],
            material_id=row["material_id"],
            material_name=row["material_name"],
            supplier_id=row["supplier_id"],
            supplier_name=row["supplier_name"],
            po_quantity=row["po_quantity"],
            original_eta=orig_eta,
            revised_eta=new_eta,
            delay_days=delay_days,
            days_to_revised_eta=ttr_days,
            status=row["status"]
        )
        results.append(impact)

    conn.close()
    return results
