"""
Phase 2: Enterprise API Backend Server (Flask + CORS + SQLite + LangGraph).

Endpoints:
1. GET  /api/incidents      -> Incident queue with severity, gap breakdown, and status
2. GET  /api/incidents/<id> -> Full verified incident dossier with verifiable exposure and C1-C8 matrix
3. POST /api/simulate       -> Real-time Digital Twin simulation (takes delay_days, recalculates curves & vetoes)
4. POST /api/decisions      -> Authorizes recovery action, issues formal PO, and records audit trail
5. GET  /api/audit          -> Full decision audit ledger
"""
from flask import Flask, jsonify, request
from datetime import datetime, timezone
from typing import Dict, Any, List
import impact_engine_v2
import config

app = Flask(__name__)

# Full CORS Support
@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type,Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    return response

# Handle pre-flight OPTIONS requests
@app.route("/api/<path:path>", methods=["OPTIONS"])
def handle_options(path):
    return "", 204

# Audit ledger in-memory store
AUDIT_LOGS: List[Dict[str, Any]] = []


@app.route("/api/incidents", methods=["GET"])
def list_incidents():
    """Returns the enterprise incident queue sorted by severity and financial risk."""
    dossier = impact_engine_v2.get_incident_dossier()
    return jsonify({
        "as_of": dossier["as_of"],
        "active_incidents_count": 1,
        "queue": [
            {
                "incident_id": dossier["incident_id"],
                "severity": "CRITICAL",
                "title": dossier["disruption"]["event_name"],
                "location": dossier["disruption"]["location"],
                "hero_material": dossier["disruption"]["material_id"],
                "stockout_date": dossier["attribution_math"]["stockout_date"],
                "revised_eta": dossier["disruption"]["revised_eta"],
                "baseline_gap_days": dossier["attribution_math"]["baseline_gap_days"],
                "disruption_delay_days": dossier["attribution_math"]["disruption_delay_days"],
                "total_gap_days": dossier["attribution_math"]["total_shortage_gap_days"],
                "otif_risk_usd": dossier["verifiable_exposure"]["otif_exposure_usd"],
                "customer_impacted": dossier["verifiable_exposure"]["customer_name"],
                "so_due_date": dossier["verifiable_exposure"]["so_due_date"],
                "status": "AWAITING_APPROVAL",
                "owner": "Sarah Jenkins (Senior S&OE Planner)",
                "governance_rule": "Rule C5: Requires VP Supply Chain Approval"
            }
        ]
    })


@app.route("/api/incidents/<incident_id>", methods=["GET"])
def get_incident_detail(incident_id: str):
    """Returns the full verified incident dossier for the selected incident."""
    if incident_id != "INC-2026-PORT-KLANG-01":
        return jsonify({"error": "Incident not found"}), 404
    return jsonify(impact_engine_v2.get_incident_dossier())


@app.route("/api/simulate", methods=["POST"])
def simulate_delay():
    """
    Real-time Digital Twin what-if simulator.
    Takes { "delay_days": int } and re-evaluates curves, shortage, and C1-C8 matrix.
    """
    data = request.get_json() or {}
    delay_days = int(data.get("delay_days", 7))
    as_of = data.get("as_of", "2026-10-03")

    dossier = impact_engine_v2.get_incident_dossier(
        as_of=as_of,
        simulated_delay_days=delay_days
    )

    # 20-day timeline series for depletion curve
    tts = dossier["attribution_math"]["tts_days"]
    ttr = dossier["disruption"]["simulated_delay_days"] + 8  # 8 is baseline planned days
    
    timeline_series = []
    base_stock = 400
    burn = 80

    for day in range(0, 21):
        on_hand_sim = max(0, base_stock - (burn * day))
        inflow_regular = 900 if day >= ttr else 0
        inflow_eurocoils = 900 if day >= 10 else 0
        
        timeline_series.append({
            "day": day,
            "date": f"2026-10-{day+3:02d}",
            "unmitigated_stock": on_hand_sim + inflow_regular,
            "eurocoils_stock": on_hand_sim + inflow_eurocoils,
            "is_shortage": (day >= tts and day < ttr),
            "is_residual_gap": (day >= tts and day < 10)
        })

    return jsonify({
        "dossier": dossier,
        "timeline_series": timeline_series
    })


@app.route("/api/decisions", methods=["POST"])
def record_decision():
    """
    Records an authorized human gate decision, generates the formal PO,
    and writes to the enterprise audit trail.
    """
    data = request.get_json() or {}
    incident_id = data.get("incident_id", "INC-2026-PORT-KLANG-01")
    option_id = data.get("option_id", "OPT-A")
    action = data.get("action", "APPROVE")
    approver_role = data.get("approver_role", "VP Supply Chain")
    notes = data.get("notes", "")

    timestamp = datetime.now(timezone.utc).isoformat()
    po_number = f"PO-EURO-{int(datetime.now().timestamp()) % 100000}" if action == "APPROVE" else None

    decision_record = {
        "decision_id": f"DEC-{len(AUDIT_LOGS) + 1:04d}",
        "incident_id": incident_id,
        "option_id": option_id,
        "action": action,
        "po_number": po_number,
        "approver_role": approver_role,
        "timestamp": timestamp,
        "notes": notes,
        "status": "EXECUTED" if action == "APPROVE" else "ESCALATED" if action == "ESCALATE" else "DECLINED",
        "po_payload": {
            "po_number": po_number,
            "supplier": "EuroCoils GmbH (Stuttgart, Germany)",
            "material_id": "STCOIL-440V",
            "quantity": 900,
            "freight_mode": "AIR_EXPEDITE",
            "est_arrival": "2026-10-13",
            "authorized_cost_usd": 30150.00,
            "cost_center": "CC-APEX-SUPPLY-CHAIN",
            "authorized_by": f"{approver_role} (Rule C5 Gate)"
        } if action == "APPROVE" else None
    }

    AUDIT_LOGS.append(decision_record)
    return jsonify(decision_record)


@app.route("/api/audit", methods=["GET"])
def get_audit():
    return jsonify({"audit_trail": AUDIT_LOGS})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000, debug=False)
