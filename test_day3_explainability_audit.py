"""
Day 3 Acceptance Tests: Explainability & Durable Audit
=======================================================
Tests:
  T1. "Why this option?" has >= 5 traceable sentences for SHIP-7010 (SHORTAGE).
  T2. severity_explanation is derived from actual computed data values.
  T3. Absorbed scenario has recommendation_reasons with correct wording.
  T4. Decision records persist to SQLite (survive in-memory clear).
  T5. Investigation records persist to SQLite (survive in-memory clear).
  T6. /api/audit reads from SQLite and returns durable records.
  T7. recommendation_reasons reference real ERP values (stockout date, on_hand, etc.).
"""
import sys
import os
import json
import sqlite3

# Add parent directory to path so we can import project modules
sys.path.insert(0, os.path.dirname(__file__))

import config
import impact_engine_v2


# --- T1: "Why this option?" has >= 5 sentences --------------------------------
def test_why_recommended_shortage_has_min_5_sentences():
    """SHIP-7010 (SHORTAGE) must have at least 5 traceable recommendation reasons."""
    d = impact_engine_v2.get_incident_dossier("SHIP-7010")
    assert d["impact_status"] == "SHORTAGE", f"Expected SHORTAGE, got {d['impact_status']}"
    reasons = d["executive_summary"].get("recommendation_reasons", [])
    assert isinstance(reasons, list), "recommendation_reasons must be a list"
    assert len(reasons) >= 5, (
        f"Expected >= 5 recommendation reasons for SHORTAGE dossier, got {len(reasons)}.\n"
        f"Reasons so far: {reasons}"
    )
    print(f"  [PASS] T1 -- {len(reasons)} recommendation reasons found")
    for i, r in enumerate(reasons, 1):
        print(f"     {i}. {r}")


# --- T2: severity_explanation is data-derived ----------------------------------
def test_severity_explanation_references_real_data():
    """Severity explanation must reference actual ERP values: on_hand, tts, revised ETA."""
    d = impact_engine_v2.get_incident_dossier("SHIP-7010")
    explanation = d["executive_summary"].get("severity_explanation", "")
    assert explanation, "severity_explanation must not be empty"

    on_hand = str(int(d["attribution_math"]["on_hand_qty"]))
    tts = f"{d['attribution_math']['tts_days']:.1f}"
    stockout = d["attribution_math"]["stockout_date"]
    revised_eta = d["disruption"]["revised_eta"]

    assert on_hand in explanation, f"on_hand_qty ({on_hand}) must appear in severity_explanation"
    assert tts in explanation, f"tts_days ({tts}) must appear in severity_explanation"
    assert stockout in explanation, f"stockout_date ({stockout}) must appear in severity_explanation"
    print(f"  [PASS] T2 -- severity_explanation references on_hand={on_hand}, tts={tts}d, stockout={stockout}")
    print(f"     Explanation: {explanation[:120]}...")


# --- T3: Absorbed scenario has correct recommendation_reasons ------------------
def test_absorbed_recommendation_reasons():
    """SHIP-6205-01 (ABSORBED) must have recommendation_reasons mentioning TTS >= TTR."""
    d = impact_engine_v2.get_incident_dossier("SHIP-6205-01")
    assert d["impact_status"] == "ABSORBED", f"Expected ABSORBED, got {d['impact_status']}"
    reasons = d["executive_summary"].get("recommendation_reasons", [])
    assert isinstance(reasons, list), "recommendation_reasons must be a list"
    assert len(reasons) >= 1, "ABSORBED scenario must have at least 1 recommendation reason"

    combined = " ".join(reasons).lower()
    assert any(kw in combined for kw in ["absorbs", "tts", "ttr", "buffer", "no recovery"]), (
        f"ABSORBED reasons must reference buffer/TTS/TTR. Got: {reasons}"
    )
    print(f"  [PASS] T3 -- ABSORBED has {len(reasons)} recommendation reasons")
    for i, r in enumerate(reasons, 1):
        print(f"     {i}. {r}")


# --- T4: Decision records persist to SQLite ------------------------------------
def test_decision_persists_to_sqlite():
    """Inserting a decision record via _persist_decision must write to SQLite."""
    import server  # imports _persist_decision and _ensure_audit_tables

    server._ensure_audit_tables()

    test_rec = {
        "decision_id": "DEC-TEST-D3-001",
        "incident_id": "INC-2026-PORT-KLANG-01",
        "option_id": "OPT-A",
        "action": "APPROVE",
        "po_number": "PO-TEST-9999",
        "approver_role": "VP Supply Chain",
        "notes": "Day 3 persistence test",
        "timestamp": "2026-10-06T10:00:00+00:00",
    }
    server._persist_decision(test_rec)

    # Verify it's in SQLite
    conn = config.get_db_connection()
    row = conn.execute(
        "SELECT * FROM audit_decisions WHERE decision_id = ?",
        ("DEC-TEST-D3-001",)
    ).fetchone()
    conn.close()

    assert row is not None, "Decision record not found in SQLite after _persist_decision call"
    assert row["incident_id"] == "INC-2026-PORT-KLANG-01"
    assert row["option_id"] == "OPT-A"
    print(f"  [PASS] T4 -- Decision persisted to SQLite: {dict(row)['decision_id']}")


# --- T5: Investigation records persist to SQLite -------------------------------
def test_investigation_persists_to_sqlite():
    """Inserting an investigation record via _persist_investigation must write to SQLite."""
    import server

    server._ensure_audit_tables()

    test_rec = {
        "search_id": "SEARCH-D3-TEST-001",
        "entity_id": "SHIP-7010",
        "query": "Port Klang disruption test",
        "source_tier": "live_api",
        "searched_at": "2026-10-06T10:00:00+00:00",
        "final_outcome": "IMPACT_READY",
        "selected_article": {"url": "https://example.com/test-article"},
        "parsed_signal": {"headline": "Port Klang congestion", "delay_days": 7},
        "confidence": 0.94,
    }
    server._persist_investigation(test_rec)

    conn = config.get_db_connection()
    row = conn.execute(
        "SELECT * FROM audit_investigations WHERE search_id = ?",
        ("SEARCH-D3-TEST-001",)
    ).fetchone()
    conn.close()

    assert row is not None, "Investigation record not found in SQLite after _persist_investigation call"
    assert row["entity_id"] == "SHIP-7010"
    assert row["final_outcome"] == "IMPACT_READY"
    assert row["selected_article_url"] == "https://example.com/test-article"
    print(f"  [PASS] T5 -- Investigation persisted to SQLite: search_id={row['search_id']}")


# --- T6: /api/audit reads from SQLite ------------------------------------------
def test_audit_endpoint_reads_from_sqlite():
    """The /api/audit endpoint must return records from SQLite, not only in-memory."""
    import server

    server._ensure_audit_tables()
    client = server.app.test_client()

    # Insert directly via SQLite to simulate pre-existing records (restart scenario)
    conn = config.get_db_connection()
    conn.execute("""
        INSERT OR IGNORE INTO audit_decisions
            (decision_id, incident_id, option_id, action, po_number, approver_role, notes, timestamp)
        VALUES ('DEC-RESTART-TEST', 'INC-2026-PORT-KLANG-01', 'OPT-A', 'APPROVE',
                'PO-RESTART-001', 'VP Supply Chain', 'Restart persistence test',
                '2026-10-06T11:00:00+00:00')
    """)
    conn.commit()
    conn.close()

    response = client.get("/api/audit")
    assert response.status_code == 200
    body = json.loads(response.data)
    trail = body.get("audit_trail", [])

    ids = [r.get("decision_id") for r in trail]
    assert "DEC-RESTART-TEST" in ids, (
        f"DEC-RESTART-TEST not found in audit_trail after direct SQLite insert.\n"
        f"Found IDs: {ids}"
    )
    print(f"  [PASS] T6 -- /api/audit reads DEC-RESTART-TEST from SQLite ({len(trail)} records total)")


# --- T7: recommendation_reasons contain real ERP values -----------------------
def test_recommendation_reasons_reference_erp_values():
    """recommendation_reasons must reference actual stockout date, ERP shipment ID, material."""
    d = impact_engine_v2.get_incident_dossier("SHIP-7010")
    reasons = d["executive_summary"].get("recommendation_reasons", [])
    combined = " ".join(reasons)

    shipment_id = d["disruption"]["shipment_id"]
    material_id = d["disruption"]["material_id"]
    stockout_date = d["attribution_math"]["stockout_date"]

    assert shipment_id in combined, f"{shipment_id} must appear in recommendation_reasons"
    assert material_id in combined, f"{material_id} must appear in recommendation_reasons"
    assert stockout_date in combined, f"stockout_date ({stockout_date}) must appear in recommendation_reasons"
    print(f"  [PASS] T7 -- recommendation_reasons reference {shipment_id}, {material_id}, {stockout_date}")


# --- Runner --------------------------------------------------------------------
if __name__ == "__main__":
    tests = [
        ("T1: Why recommended >= 5 sentences", test_why_recommended_shortage_has_min_5_sentences),
        ("T2: Severity explanation data-derived", test_severity_explanation_references_real_data),
        ("T3: Absorbed recommendation_reasons", test_absorbed_recommendation_reasons),
        ("T4: Decision SQLite persistence", test_decision_persists_to_sqlite),
        ("T5: Investigation SQLite persistence", test_investigation_persists_to_sqlite),
        ("T6: Audit endpoint reads SQLite", test_audit_endpoint_reads_from_sqlite),
        ("T7: Reasons reference ERP values", test_recommendation_reasons_reference_erp_values),
    ]

    passed = 0
    failed = 0
    for name, fn in tests:
        print(f"\n[{'RUN':>4}] {name}")
        try:
            fn()
            passed += 1
        except Exception as e:
            print(f"  [FAIL] -- {e}")
            failed += 1

    print(f"\n{'='*60}")
    print(f"  Day 3 Results: {passed}/{len(tests)} passed, {failed} failed")
    print(f"{'='*60}")
    sys.exit(0 if failed == 0 else 1)
