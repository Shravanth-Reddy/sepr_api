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
from typing import Dict, Any, List, Optional, Tuple
import impact_engine_v2
import config
import serp_client
import disruption_parser
import erp_resolver
import graph

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

# Audit ledger — SQLite-persisted for durable demo
AUDIT_LOGS: List[Dict[str, Any]] = []
INVESTIGATION_LOGS: List[Dict[str, Any]] = []
LATEST_INVESTIGATION: Optional[Dict[str, Any]] = None
INVESTIGATION_RECORDS: Dict[str, Dict[str, Any]] = {}


def _ensure_audit_tables() -> None:
    """Create audit tables in mock_erp.db if they don't exist."""
    conn = config.get_db_connection()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS audit_investigations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            search_id TEXT,
            entity_id TEXT,
            query TEXT,
            source_tier TEXT,
            searched_at TEXT,
            final_outcome TEXT,
            selected_article_url TEXT,
            parsed_signal TEXT,
            confidence REAL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS audit_decisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            decision_id TEXT,
            incident_id TEXT,
            option_id TEXT,
            action TEXT,
            po_number TEXT,
            approver_role TEXT,
            notes TEXT,
            timestamp TEXT
        )
    """)
    conn.commit()
    conn.close()


_ensure_audit_tables()

SEARCH_STATUS_IMPACT_READY = "IMPACT_READY"
SEARCH_STATUS_NO_DISRUPTION = "NO_DISRUPTION_FOUND"
SEARCH_STATUS_SIGNAL_NO_DELAY = "SIGNAL_FOUND_NO_DELAY"
SEARCH_STATUS_NO_RESPONSE = "NO_USABLE_RESPONSE"
SEARCH_STATUS_UNMATCHED = "UNMATCHED_DISRUPTION"


import json as _json


def _persist_investigation(rec: Dict[str, Any]) -> None:
    """Insert investigation record into SQLite audit_investigations table and memory."""
    INVESTIGATION_LOGS.append(rec)
    try:
        conn = config.get_db_connection()
        conn.execute("""
            INSERT INTO audit_investigations
                (search_id, entity_id, query, source_tier, searched_at, final_outcome, selected_article_url, parsed_signal, confidence)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            rec.get("search_id"),
            rec.get("entity_id"),
            rec.get("query"),
            rec.get("source_tier"),
            rec.get("searched_at"),
            rec.get("final_outcome"),
            (rec.get("selected_article") or {}).get("url"),
            _json.dumps(rec.get("parsed_signal")),
            rec.get("confidence", 0.0),
        ))
        conn.commit()
        conn.close()
    except Exception as e:
        app.logger.error(f"Failed to persist investigation: {e}")


def _persist_decision(rec: Dict[str, Any]) -> None:
    """Insert decision record into SQLite audit_decisions table and memory."""
    AUDIT_LOGS.append(rec)
    try:
        conn = config.get_db_connection()
        conn.execute("""
            INSERT INTO audit_decisions
                (decision_id, incident_id, option_id, action, po_number, approver_role, notes, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            rec.get("decision_id"),
            rec.get("incident_id"),
            rec.get("option_id"),
            rec.get("action"),
            rec.get("po_number"),
            rec.get("approver_role"),
            rec.get("notes"),
            rec.get("timestamp"),
        ))
        conn.commit()
        conn.close()
    except Exception as e:
        app.logger.error(f"Failed to persist decision: {e}")


def build_operation_query(operation: Dict[str, Any]) -> str:
    """Builds a high-yield external-search query from an internal shipment record."""
    origin = operation.get("origin", "").strip()
    if "Red Sea" in origin:
        return "Red Sea shipping disruption delay attacks rerouting"
    elif "Ningbo" in origin:
        return "Ningbo port congestion disruption delay typhoon"
    elif "Port Klang" in origin:
        return f'"{origin}" port delay disruption congestion weather'
    else:
        return f'"{origin}" port shipping delay disruption congestion'


def load_shipments() -> List[Dict[str, Any]]:
    conn = config.get_db_connection()
    rows = conn.execute("""
        SELECT
            s.shipment_id, s.po_id, s.origin, s.destination, s.vessel_name,
            s.original_eta, s.status,
            po.material_id, po.quantity,
            sup.supplier_name,
            GROUP_CONCAT(DISTINCT impacted_wo.work_order_id) AS work_order_ids,
            GROUP_CONCAT(DISTINCT impacted_wo.customer_order_id) AS customer_order_ids
        FROM shipments s
        JOIN purchase_orders po ON s.po_id = po.po_id
        JOIN suppliers sup ON po.supplier_id = sup.supplier_id
        LEFT JOIN (
            SELECT
                wm.material_id,
                wo.work_order_id,
                wo.customer_order_id
            FROM wo_materials wm
            JOIN work_orders wo ON wo.work_order_id = wm.work_order_id
            WHERE wm.shortage_qty > 0
        ) impacted_wo ON impacted_wo.material_id = po.material_id
        GROUP BY s.shipment_id
        ORDER BY CASE WHEN s.status = 'IN_TRANSIT' THEN 0 ELSE 1 END, s.original_eta
    """).fetchall()
    result = []
    for row in rows:
        result.append({
            "shipment_id": row["shipment_id"],
            "po_id": row["po_id"],
            "origin": row["origin"],
            "destination": row["destination"],
            "vessel_name": row["vessel_name"],
            "supplier_name": row["supplier_name"],
            "material_id": row["material_id"],
            "quantity": row["quantity"],
            "expected_date": row["original_eta"],
            "status": row["status"],
            "linked_work_orders": [item for item in (row["work_order_ids"] or "").split(",") if item],
            "linked_customer_orders": [item for item in (row["customer_order_ids"] or "").split(",") if item],
        })
    conn.close()
    return result


def source_label(source_tier: str) -> str:
    return {
        "live_api": "Live SerpAPI",
        "cache": "Local evidence cache",
        "hardcoded_scenario": "Deterministic demo fallback",
        "unavailable": "Search unavailable",
    }.get(source_tier, source_tier)


@app.route("/api/operations/shipments", methods=["GET"])
def list_operations():
    return jsonify({"shipments": load_shipments()})


@app.route("/api/signal-search", methods=["POST"])
def search_operation_signal():
    data = request.get_json() or {}
    shipment_id = str(data.get("entity_id", "")).strip()
    if data.get("entity_type", "shipment") != "shipment":
        return jsonify({"error": "Only shipment investigations are supported in this iteration"}), 400

    operation = next((item for item in load_shipments() if item["shipment_id"] == shipment_id), None)
    if not operation:
        return jsonify({"error": "Shipment not found"}), 404

    query = str(data.get("query") or build_operation_query(operation)).strip()
    mode = data.get("mode", "live_with_fallback")
    force_tier = {"live": 1, "cache": 2, "demo": 3}.get(mode)
    searched_at = datetime.now(timezone.utc).isoformat()
    search_id = f"SEARCH-{int(datetime.now().timestamp() * 1000)}"
    try:
        raw_news, tier = serp_client.fetch_disruption_news(query=query, force_tier=force_tier)
    except RuntimeError as exc:
        INVESTIGATION_LOGS.append({
            "search_id": search_id,
            "entity_type": "shipment",
            "entity_id": shipment_id,
            "query": query,
            "mode": mode,
            "source_tier": "unavailable",
            "searched_at": searched_at,
            "result_count": 0,
            "parsed_signal_status": "UNAVAILABLE",
            "resolution_status": "NOT_ATTEMPTED",
            "final_outcome": "SEARCH_FAILED",
            "retry_count": 0,
        })
        return jsonify({
            "search_id": search_id,
            "entity": {"type": "shipment", "id": shipment_id},
            "query": query,
            "source": {"tier": "unavailable", "label": "Live search unavailable", "searched_at": searched_at},
            "status": "SEARCH_FAILED",
            "error": str(exc),
            "trace": ["Loaded shipment from ERP", "Generated SerpAPI query", "External search failed"],
        }), 502

    global LATEST_INVESTIGATION
    news_results = raw_news.get("news_results") or []
    event, ranked_sources, selected_source = disruption_parser.extract_disruption_with_sources(
        raw_news,
        vessel_name=operation["vessel_name"],
        location=operation["origin"],
        supplier_name=operation["supplier_name"],
        material_name=operation.get("material_id"),
    )

    # Fallback to first raw article if no ranked candidate was matched
    if selected_source:
        article_payload = {
            "title": selected_source.get("title", "No article title available"),
            "source": selected_source.get("publisher", "Unknown source"),
            "date": selected_source.get("published_at") or config.REFERENCE_DATE,
            "snippet": selected_source.get("snippet", ""),
            "url": selected_source.get("url", ""),
            "relevance": selected_source.get("relevance", 1.0),
        }
    elif news_results:
        raw_first = news_results[0]
        article_payload = {
            "title": raw_first.get("title", "No article title available"),
            "source": (raw_first.get("source") or {}).get("name", "Unknown source"),
            "date": raw_first.get("date") or raw_first.get("iso_date") or config.REFERENCE_DATE,
            "snippet": raw_first.get("snippet", ""),
            "url": raw_first.get("link", ""),
            "relevance": 0.5,
        }
    else:
        article_payload = None

    selected_match = None
    if event:
        resolved = erp_resolver.resolve_disruption_to_erp(
            location=event.location,
            vessel_name=operation["vessel_name"],
            delay_days=event.delay_days,
            reference_date_str=config.REFERENCE_DATE,
        )
        selected_match = next((item for item in resolved if item.shipment_id == shipment_id), None)

    if not news_results:
        status = SEARCH_STATUS_NO_RESPONSE
    elif not event:
        status = SEARCH_STATUS_NO_DISRUPTION
    elif event.delay_days <= 0:
        status = SEARCH_STATUS_SIGNAL_NO_DELAY
    elif not selected_match:
        status = SEARCH_STATUS_UNMATCHED
    else:
        status = SEARCH_STATUS_IMPACT_READY

    dossier = None
    incident_id = None
    if status == SEARCH_STATUS_IMPACT_READY:
        dossier = impact_engine_v2.get_incident_dossier(
            shipment_id=shipment_id,
            material_id=operation.get("material_id"),
            simulated_delay_days=event.delay_days,
            as_of=config.REFERENCE_DATE
        )
        if dossier.get("status") != "UNSUPPORTED_DATA":
            incident_id = dossier["incident_id"]
        else:
            status = "UNSUPPORTED_DATA"

    investigation_record = {
        "search_id": search_id,
        "entity_type": "shipment",
        "entity_id": shipment_id,
        "query": query,
        "mode": mode,
        "source_tier": tier,
        "source_label": source_label(tier),
        "searched_at": searched_at,
        "result_count": len(news_results),
        "sources": ranked_sources,
        "selected_article": article_payload,
        "parsed_signal": event.model_dump() if event else None,
        "parsed_signal_status": "PARSED" if event else "NOT_FOUND",
        "resolution_status": "MATCHED" if selected_match else "NOT_MATCHED" if event else "NOT_ATTEMPTED",
        "final_outcome": status,
        "retry_count": 0,
        "incident_id": incident_id,
        "confidence": 0.94 if selected_match else (0.62 if event else 0.0),
        "facts": [
            {"claim": f"Disruption reported: {event.headline}", "source_index": 0}
        ] if event else [],
        "inferences": [
            {
                "claim": f"{shipment_id} on {operation['vessel_name']} may be affected",
                "reason": f"Shipment origin {operation['origin']} matches reported {event.location}"
            }
        ] if event and selected_match else [],
    }

    LATEST_INVESTIGATION = investigation_record
    INVESTIGATION_RECORDS[search_id] = investigation_record
    if incident_id:
        INVESTIGATION_RECORDS[incident_id] = investigation_record
    _persist_investigation(investigation_record)

    trace = [
        "Loaded shipment from ERP",
        "Generated SerpAPI query",
        f"Retrieved external signal from {source_label(tier)}",
        "Parsed disruption event" if event else "No disruption event identified",
        "Resolved signal against in-transit shipments" if event else "Resolution skipped",
        "Calculated downstream exposure" if dossier else "No downstream impact calculated",
    ]
    return jsonify({
        "search_id": search_id,
        "entity": {"type": "shipment", "id": shipment_id},
        "query": query,
        "source": {
            "tier": tier,
            "label": source_label(tier),
            "searched_at": searched_at,
            "confidence": investigation_record["confidence"],
        },
        "article": article_payload,
        "sources": ranked_sources,
        "parsed_signal": event.model_dump() if event else None,
        "resolution": {
            "matched": selected_match is not None,
            "shipment_id": selected_match.shipment_id if selected_match else None,
            "po_id": selected_match.po_id if selected_match else None,
            "work_orders": operation["linked_work_orders"],
            "customer_orders": operation["linked_customer_orders"],
        },
        "status": status,
        "incident_id": incident_id,
        "dossier": dossier,
        "trace": trace,
    })


@app.route("/api/incidents", methods=["GET"])
def list_incidents():
    """Returns the enterprise incident queue sorted by severity and financial risk."""
    shipment_ids = ["SHIP-8100", "SHIP-9200", "SHIP-7010", "SHIP-6205-01"]
    
    queue = []
    as_of_date = config.REFERENCE_DATE
    for s_id in shipment_ids:
        d = impact_engine_v2.get_incident_dossier(s_id)
        if d.get("status") == "UNSUPPORTED_DATA":
            continue
        as_of_date = d.get("as_of", as_of_date)
        rec = next(
            (option for option in d.get("recovery_options_matrix", [])
             if option["option_id"] == d.get("executive_summary", {}).get("recommended_option_id")),
            None,
        )
        queue.append({
            "incident_id": d["incident_id"],
            "severity": d["disruption"]["severity"],
            "impact_status": d["impact_status"],
            "title": d["disruption"]["event_name"],
            "location": d["disruption"]["location"],
            "hero_material": d["disruption"]["material_id"],
            "on_hand_qty": d["attribution_math"]["on_hand_qty"],
            "tts_days": d["attribution_math"]["tts_days"],
            "origin": d["operational_context"]["origin"],
            "destination": d["operational_context"]["destination"],
            "stockout_date": d["attribution_math"]["stockout_date"],
            "revised_eta": d["disruption"]["revised_eta"],
            "baseline_gap_days": d["attribution_math"]["baseline_gap_days"],
            "disruption_delay_days": d["attribution_math"]["disruption_delay_days"],
            "total_gap_days": d["attribution_math"]["total_shortage_gap_days"],
            "otif_risk_usd": d["verifiable_exposure"]["otif_exposure_usd"],
            "customer_impacted": d["verifiable_exposure"]["customer_name"],
            "so_due_date": d["verifiable_exposure"]["so_due_date"],
            "status": "AWAITING_APPROVAL" if d["impact_status"] != "ABSORBED" else "BUFFER_ABSORBED",
            "owner": "Sarah Jenkins (Senior S&OE Planner)",
            "governance_rule": "Rule C5: Requires VP Supply Chain Approval" if d["impact_status"] != "ABSORBED" else "Nominal (No Rule Breach)",
            "recommended_supplier": rec["supplier_name"] if rec else None,
            "recommended_location": rec["location"] if rec else None,
            "dependency_summary": d.get("dependency_chain", {}).get("chain_summary", ""),
        })

    # Sort critical shortages with highest exposure first
    queue.sort(key=lambda x: (0 if x["impact_status"] != "ABSORBED" else 1, -x["otif_risk_usd"]))

    return jsonify({
        "as_of": as_of_date,
        "active_incidents_count": len([item for item in queue if item["impact_status"] != "ABSORBED"]),
        "queue": queue
    })


@app.route("/api/incidents/<incident_id>", methods=["GET"])
def get_incident_detail(incident_id: str):
    """Returns the full verified incident dossier for the selected incident."""
    if incident_id == "INC-2026-PORT-KLANG-01":
        return jsonify(impact_engine_v2.get_incident_dossier("SHIP-7010"))
    elif incident_id.startswith("INC-"):
        ship_id = incident_id.replace("INC-", "")
        dossier = impact_engine_v2.get_incident_dossier(ship_id)
        if dossier.get("status") == "UNSUPPORTED_DATA":
            return jsonify(dossier), 404
        return jsonify(dossier)
    return jsonify({"error": "Incident not found"}), 404


@app.route("/api/evidence/<incident_id>", methods=["GET"])
def get_incident_evidence(incident_id: str):
    """
    Returns verified evidence metadata for the selected incident.
    Prioritizes actual investigation evidence from recent search.
    Falls back honestly to deterministic demo scenario if unsearched.
    """
    shipment_id = "SHIP-7010"
    if incident_id.startswith("INC-") and incident_id != "INC-2026-PORT-KLANG-01":
        shipment_id = incident_id.replace("INC-", "")

    dossier = impact_engine_v2.get_incident_dossier(shipment_id)
    if dossier.get("status") == "UNSUPPORTED_DATA":
        return jsonify({"error": "Incident not found"}), 404

    inv = INVESTIGATION_RECORDS.get(incident_id) or LATEST_INVESTIGATION

    if inv and inv.get("selected_article"):
        article = inv["selected_article"]
        source_tier = inv.get("source_tier", "live_api")
        source_lbl = inv.get("source_label", source_label(source_tier))
        query = inv.get("query", config.DEFAULT_SEARCH_QUERY)
        detected_at = inv.get("searched_at", f"{dossier['as_of']}T06:18:50Z")
        confidence = inv.get("confidence", 0.94)
        delay_days = (inv.get("parsed_signal") or {}).get("delay_days", dossier["disruption"]["simulated_delay_days"])
        sources = inv.get("sources", [article])
        facts = inv.get("facts", [])
        inferences = inv.get("inferences", [])
        search_id = inv.get("search_id", "SEARCH-LIVE")
    else:
        # Fallback to controlled canonical fixture (explicitly labeled as demo fallback)
        raw_news, source_tier = serp_client.fetch_disruption_news(force_tier=3)
        article_raw = (raw_news.get("news_results") or [{}])[0]
        article = {
            "title": article_raw.get("title", "No article title available"),
            "source": (article_raw.get("source") or {}).get("name", "Maritime Trade & Logistics Gazette"),
            "date": article_raw.get("date") or article_raw.get("iso_date") or dossier["as_of"],
            "snippet": article_raw.get("snippet", ""),
            "url": article_raw.get("link", ""),
            "relevance": 1.0,
        }
        source_lbl = "Deterministic demo fallback"
        query = raw_news.get("search_parameters", {}).get("q", config.DEFAULT_SEARCH_QUERY)
        detected_at = f"{dossier['as_of']}T06:18:50Z"
        confidence = 0.85
        delay_days = dossier["disruption"]["simulated_delay_days"]
        sources = [article]
        facts = [{"claim": f"{dossier['disruption']['location']} disruption reported", "source_index": 0}]
        inferences = [{"claim": f"{shipment_id} may be impacted", "reason": f"Matches {dossier['disruption']['location']}"}]
        search_id = f"SCENARIO-{shipment_id}"

    return jsonify({
        "incident_id": incident_id,
        "search_id": search_id,
        "source_tier": source_tier,
        "source_label": source_lbl,
        "query": query,
        "detected_at": detected_at,
        "article": article,
        "sources": sources,
        "facts": facts,
        "inferences": inferences,
        "confidence": confidence,
        "extracted_delay_days": delay_days,
        "entity_resolution": [
            f"{dossier['disruption']['location']} -> {dossier['disruption']['shipment_id']}",
            f"{dossier['disruption']['vessel_name']} -> {dossier['disruption']['po_id']}",
            f"{dossier['disruption']['supplier_name']} -> {dossier['disruption']['material_id']}",
            f"+{delay_days}d delay extracted",
        ],
        "ais": {
            "status": "UNAVAILABLE / NOT MONITORED",
            "telemetry_state": "DISCONNECTED (SIMULATED)",
            "vessel_name": dossier["disruption"]["vessel_name"],
            "note": "Satellite AIS tracking is omitted from trust-critical evidence per product specification."
        },
        "audit_trail": AUDIT_LOGS,
    })


@app.route("/api/simulate", methods=["POST"])
def simulate_delay():
    """
    Real-time Digital Twin what-if simulator.
    Takes { "delay_days": int, "incident_id": str } and re-evaluates curves & matrix.
    """
    data = request.get_json() or {}
    delay_days = int(data.get("delay_days", 7))
    as_of = data.get("as_of", "2026-10-03")
    incident_id = data.get("incident_id", "INC-2026-PORT-KLANG-01")

    shipment_id = "SHIP-7010"
    if incident_id.startswith("INC-") and incident_id != "INC-2026-PORT-KLANG-01":
        shipment_id = incident_id.replace("INC-", "")

    dossier = impact_engine_v2.get_incident_dossier(
        shipment_id=shipment_id,
        as_of=as_of,
        simulated_delay_days=delay_days
    )

    tts = dossier["attribution_math"]["tts_days"]
    ttr = dossier["disruption"]["simulated_delay_days"] + 8
    base_stock = dossier["attribution_math"]["on_hand_qty"]
    burn = dossier["attribution_math"]["daily_burn_rate"]
    po_qty = dossier["operational_context"]["shipment_quantity"]

    timeline_series = []
    for day in range(0, 21):
        on_hand_sim = max(0, base_stock - (burn * day))
        inflow_regular = po_qty if day >= ttr else 0
        inflow_mitigated = po_qty if day >= 10 else 0

        timeline_series.append({
            "day": day,
            "date": f"2026-10-{day+3:02d}",
            "unmitigated_stock": on_hand_sim + inflow_regular,
            "eurocoils_stock": on_hand_sim + inflow_mitigated,
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
    notes = str(data.get("notes", ""))

    shipment_id = "SHIP-7010"
    if incident_id.startswith("INC-") and incident_id != "INC-2026-PORT-KLANG-01":
        shipment_id = incident_id.replace("INC-", "")

    dossier = impact_engine_v2.get_incident_dossier(shipment_id=shipment_id)
    option = next((item for item in dossier["recovery_options_matrix"] if item["option_id"] == option_id), None)
    if action == "APPROVE":
        if not notes.strip():
            return jsonify({"error": "Approval reason is required"}), 400
        if option is None:
            return jsonify({"error": "Cannot approve an unknown recovery option"}), 400
        if option["status"] == "VETOED":
            return jsonify({"error": "Cannot approve a vetoed recovery option"}), 409

    timestamp = datetime.now(timezone.utc).isoformat()
    po_prefix = "PO-EURO" if option and "Euro" in (option.get("supplier_name") or "") else "PO-REC"
    po_number = f"{po_prefix}-{int(datetime.now().timestamp()) % 100000}" if action == "APPROVE" else None

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
            "supplier": option["supplier_name"] if option else None,
            "material_id": dossier["disruption"]["material_id"],
            "quantity": dossier["operational_context"]["shipment_quantity"],
            "freight_mode": option["freight_mode"] if option else None,
            "est_arrival": option["arrival_date"] if option else None,
            "authorized_cost_usd": option["estimated_cost_usd"] if option else None,
            "cost_center": "CC-APEX-SUPPLY-CHAIN",
            "authorized_by": f"{approver_role} (Rule C5 Gate)"
        } if action == "APPROVE" else None
    }

    _persist_decision(decision_record)
    return jsonify(decision_record)


@app.route("/api/audit", methods=["GET"])
def get_audit():
    """Returns durable audit trail read from SQLite (survives restarts)."""
    try:
        conn = config.get_db_connection()
        decisions = [dict(row) for row in conn.execute(
            "SELECT * FROM audit_decisions ORDER BY id DESC"
        ).fetchall()]
        investigations_raw = conn.execute(
            "SELECT * FROM audit_investigations ORDER BY id DESC"
        ).fetchall()
        investigations = []
        for row in investigations_raw:
            r = dict(row)
            if r.get("selected_article_url"):
                r["selected_article"] = {"url": r["selected_article_url"]}
            if r.get("parsed_signal") and isinstance(r["parsed_signal"], str):
                try:
                    r["parsed_signal"] = _json.loads(r["parsed_signal"])
                except Exception:
                    pass
            investigations.append(r)
        conn.close()
    except Exception as e:
        app.logger.error(f"Error querying audit: {e}")
        decisions, investigations = [], []
    return jsonify({
        "audit_trail": decisions,
        "investigations": investigations,
    })


@app.route("/api/orchestrate", methods=["POST"])
def orchestrate_langgraph():
    """
    Executes the full LangGraph StateGraph pipeline end-to-end.
    Accepts: { "query": str, "force_tier": int, "reference_date": str }
    Returns the complete DisruptionState dossier and routing trace.
    """
    data = request.get_json() or {}
    query = data.get("query") or config.DEFAULT_SEARCH_QUERY
    force_tier = data.get("force_tier")
    ref_date = data.get("reference_date") or config.REFERENCE_DATE

    workflow_app = graph.build_disruption_graph()
    initial_state: graph.DisruptionState = {
        "query": query,
        "force_tier": force_tier,
        "reference_date": ref_date,
        "signal_status": "PENDING",
        "disruption_event": {},
        "matched_shipments": [],
        "primary_shipment": None,
        "impact_status": "PENDING",
        "tts_days": 0.0,
        "ttr_days": 0.0,
        "stockout_date": "",
        "shortage_window_days": 0,
        "affected_work_orders": [],
        "affected_customer_orders": [],
        "otif_exposure_usd": 0.0,
        "recovery_options": [],
        "constraint_verdicts": [],
        "surviving_options": [],
        "vetoed_options": [],
        "recommendation_summary": "",
        "recommended_option": None,
        "approval_required": False,
        "approval_authority": "",
        "trace_log": [],
        "final_status": "PROCESSING",
    }

    try:
        final_state = workflow_app.invoke(initial_state)
        return jsonify({
            "status": "SUCCESS",
            "langgraph_result": final_state
        })
    except Exception as e:
        app.logger.error(f"LangGraph execution error: {e}")
        return jsonify({
            "status": "ERROR",
            "error": str(e)
        }), 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000, debug=False)
