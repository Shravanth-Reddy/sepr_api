"""
Day 4 Acceptance Tests: End-to-End Integration, Edge-Case Resilience & Runbook Validation
========================================================================================
Tests:
  T1. Full End-to-End Flow (Search -> Signal -> Dossier -> Simulate -> Approve -> Audit).
  T2. Dual Scenario Discrimination (Shortage $120k vs. Absorbed $0.00).
  T3. Guardrail: Empty approval notes rejected with 400 Bad Request.
  T4. Guardrail: Vetoed option approval rejected with 409 Conflict.
  T5. Guardrail: Unsupported shipment returns clean diagnostic without crash.
  T6. Digital Twin Slider Boundaries (0 delay days to 20 delay days).
"""
import sys
import os
import json
import sqlite3

# Add parent directory to path so we can import project modules
sys.path.insert(0, os.path.dirname(__file__))

import config
import impact_engine_v2
import server


def test_1_full_e2e_workflow():
    """Full judge walkthrough: Search -> Impact -> Simulate -> Decision -> PO -> Audit."""
    server._ensure_audit_tables()
    client = server.app.test_client()

    # Step 1: Trigger signal search (using demo/cache fallback for deterministic test)
    search_res = client.post("/api/signal-search", json={
        "entity_type": "shipment",
        "entity_id": "SHIP-7010",
        "mode": "demo"
    })
    assert search_res.status_code == 200, f"Search failed: {search_res.data}"
    search_data = json.loads(search_res.data)
    assert search_data["status"] == "IMPACT_READY"
    incident_id = search_data["incident_id"]

    # Step 2: Fetch Incident Detail Dossier
    dossier_res = client.get(f"/api/incidents/{incident_id}")
    assert dossier_res.status_code == 200
    dossier = json.loads(dossier_res.data)
    assert dossier["impact_status"] == "SHORTAGE"
    assert dossier["verifiable_exposure"]["otif_exposure_usd"] == 120000.0

    # Step 3: Run What-If Simulation (+10 days delay)
    sim_res = client.post("/api/simulate", json={
        "incident_id": incident_id,
        "delay_days": 10
    })
    assert sim_res.status_code == 200
    sim_data = json.loads(sim_res.data)
    assert len(sim_data["timeline_series"]) == 21
    assert sim_data["dossier"]["disruption"]["simulated_delay_days"] == 10

    # Step 4: Record Governed Decision (Approve OPT-A with mandatory note)
    decision_res = client.post("/api/decisions", json={
        "incident_id": incident_id,
        "option_id": "OPT-A",
        "action": "APPROVE",
        "approver_role": "VP Supply Chain",
        "notes": "Day 4 E2E Test Approval: Expedite via EuroCoils"
    })
    assert decision_res.status_code == 200
    decision_data = json.loads(decision_res.data)
    assert decision_data["status"] == "EXECUTED"
    assert decision_data["po_number"].startswith("PO-EURO-")
    assert decision_data["po_payload"]["authorized_cost_usd"] == 30150.0

    # Step 5: Verify Durable Audit Ledger
    audit_res = client.get("/api/audit")
    assert audit_res.status_code == 200
    audit_data = json.loads(audit_res.data)
    matching_dec = next((d for d in audit_data["audit_trail"] if d["po_number"] == decision_data["po_number"]), None)
    assert matching_dec is not None, "Issued PO must be visible in audit ledger"

    print("  [PASS] T1 -- Full End-to-End workflow completed successfully (PO issued & audited)")


def test_2_dual_scenario_discrimination():
    """Verify system accurately distinguishes critical shortage from zero-cost absorbed delay."""
    client = server.app.test_client()
    inc_res = client.get("/api/incidents")
    assert inc_res.status_code == 200
    inc_data = json.loads(inc_res.data)

    queue = inc_data["queue"]
    assert len(queue) >= 2, "Incident queue must contain both scenarios"

    shortage = next((i for i in queue if i["hero_material"] == "STCOIL-440V"), None)
    absorbed = next((i for i in queue if i["hero_material"] == "BEARING-6205"), None)

    assert shortage is not None, "STCOIL-440V shortage scenario missing"
    assert shortage["impact_status"] == "SHORTAGE"
    assert shortage["otif_risk_usd"] == 120000.0
    assert shortage["severity"] == "CRITICAL"

    assert absorbed is not None, "BEARING-6205 absorbed scenario missing"
    assert absorbed["impact_status"] == "ABSORBED"
    assert absorbed["otif_risk_usd"] == 0.0
    assert absorbed["severity"] == "NOMINAL"

    print("  [PASS] T2 -- Dual-Scenario discrimination verified (Shortage: $120k vs Absorbed: $0.00)")


def test_3_guardrail_empty_notes_rejected():
    """Approval without a mandatory note must return 400 Bad Request."""
    client = server.app.test_client()
    res = client.post("/api/decisions", json={
        "incident_id": "INC-2026-PORT-KLANG-01",
        "option_id": "OPT-A",
        "action": "APPROVE",
        "notes": "   "  # Empty whitespace
    })
    assert res.status_code == 400, f"Expected 400, got {res.status_code}"
    body = json.loads(res.data)
    assert "Approval reason is required" in body.get("error", "")
    print("  [PASS] T3 -- Guardrail: Empty approval notes correctly rejected with 400")


def test_4_guardrail_vetoed_option_rejected():
    """Approving a vetoed recovery option (e.g., OPT-B or OPT-C) must return 409 Conflict."""
    client = server.app.test_client()
    res = client.post("/api/decisions", json={
        "incident_id": "INC-2026-PORT-KLANG-01",
        "option_id": "OPT-B",  # VETOED on lead time
        "action": "APPROVE",
        "notes": "Attempting to approve vetoed ocean supplier"
    })
    assert res.status_code == 409, f"Expected 409 Conflict for vetoed option, got {res.status_code}"
    body = json.loads(res.data)
    assert "Cannot approve a vetoed recovery option" in body.get("error", "")
    print("  [PASS] T4 -- Guardrail: Vetoed option approval correctly blocked with 409 Conflict")


def test_5_guardrail_unsupported_shipment():
    """Querying an unknown/unsupported shipment returns clean 404/diagnostic without crashing."""
    client = server.app.test_client()
    res = client.get("/api/incidents/INC-SHIP-UNKNOWN-999")
    assert res.status_code == 404, f"Expected 404 for unknown shipment, got {res.status_code}"
    body = json.loads(res.data)
    assert body.get("status") == "UNSUPPORTED_DATA" or "error" in body
    print("  [PASS] T5 -- Guardrail: Unsupported shipment handled safely without backend crash")


def test_6_simulator_boundaries():
    """Digital Twin slider behaves correctly at boundary values (0 days and 20 days)."""
    d_zero = impact_engine_v2.get_incident_dossier("SHIP-7010", simulated_delay_days=0)
    assert d_zero["attribution_math"]["disruption_delay_days"] == 0
    assert d_zero["attribution_math"]["total_shortage_gap_days"] == d_zero["attribution_math"]["baseline_gap_days"]

    d_extreme = impact_engine_v2.get_incident_dossier("SHIP-7010", simulated_delay_days=20)
    assert d_extreme["attribution_math"]["disruption_delay_days"] == 20
    assert d_extreme["attribution_math"]["total_shortage_gap_days"] == 3 + 20

    print("  [PASS] T6 -- Digital Twin boundaries verified (0d delay and 20d extreme delay)")


if __name__ == "__main__":
    tests = [
        ("T1: Full End-to-End Workflow", test_1_full_e2e_workflow),
        ("T2: Dual-Scenario Discrimination", test_2_dual_scenario_discrimination),
        ("T3: Empty Approval Notes Guardrail", test_3_guardrail_empty_notes_rejected),
        ("T4: Vetoed Option Approval Guardrail", test_4_guardrail_vetoed_option_rejected),
        ("T5: Unsupported Shipment Guardrail", test_5_guardrail_unsupported_shipment),
        ("T6: Simulator Boundary Validation", test_6_simulator_boundaries),
    ]

    passed = 0
    failed = 0
    for name, fn in tests:
        print(f"\n[RUN] {name}")
        try:
            fn()
            passed += 1
        except Exception as e:
            print(f"  [FAIL] -- {e}")
            failed += 1

    print(f"\n{'='*60}")
    print(f"  Day 4 Results: {passed}/{len(tests)} passed, {failed} failed")
    print(f"{'='*60}")
    sys.exit(0 if failed == 0 else 1)
