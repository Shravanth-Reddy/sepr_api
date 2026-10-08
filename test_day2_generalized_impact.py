"""
Day 2 Verification Test Suite: Generalize Impact Beyond SHIP-7010.

Per Section 8, 9, and 16 (Page 25) of the Final Product Definition and Execution Plan:
Tests covering:
1. Dynamic Selected Shipment Control (no hardcoded SHIP-7010 branching).
2. End-to-end BOM and Pegging Dependency Lineage.
3. Disruption with Shortage Scenario (SHIP-7010).
4. Disruption Absorbed by Buffer Scenario (SHIP-6205-01).
5. Unsupported / Incomplete Shipment Handling.
6. Generalized Digital Twin Simulator.
"""
from server import app
import impact_engine_v2
import config

client = app.test_client()


def test_1_dynamic_shipment_control():
    """Verify that the selected shipment ID dynamically drives the dossier without hardcoding."""
    # Test SHIP-7010
    d_7010 = impact_engine_v2.get_incident_dossier("SHIP-7010")
    assert d_7010["disruption"]["shipment_id"] == "SHIP-7010"
    assert d_7010["disruption"]["material_id"] == "STCOIL-440V"
    assert "Pacific Coils" in d_7010["disruption"]["supplier_name"]

    # Test SHIP-6205-01
    d_6205 = impact_engine_v2.get_incident_dossier("SHIP-6205-01")
    assert d_6205["disruption"]["shipment_id"] == "SHIP-6205-01"
    assert d_6205["disruption"]["material_id"] == "BEARING-6205"
    assert "Nachi Bearings" in d_6205["disruption"]["supplier_name"]

    # Endpoints
    res_7010 = client.get("/api/incidents/INC-2026-PORT-KLANG-01")
    assert res_7010.status_code == 200
    assert res_7010.get_json()["disruption"]["material_id"] == "STCOIL-440V"

    res_6205 = client.get("/api/incidents/INC-SHIP-6205-01")
    assert res_6205.status_code == 200
    assert res_6205.get_json()["disruption"]["material_id"] == "BEARING-6205"

    print("PASS: Test 1 (Dynamic shipment control)")


def test_2_dependency_chain_lineage():
    """Verify that BOM, work orders, and customer orders are resolved and exposed."""
    dossier = impact_engine_v2.get_incident_dossier("SHIP-7010")
    chain = dossier.get("dependency_chain")
    assert chain is not None, "Dossier must expose dependency_chain"

    assert chain["supplier_name"] == "Pacific Coils Sdn Bhd"
    assert chain["shipment_id"] == "SHIP-7010"
    assert chain["component_id"] == "STCOIL-440V"
    assert chain["subassembly_id"] == "MOTOR-ASM-100"
    assert chain["finished_product_id"] == "APEXM-100"
    assert chain["work_order_id"] == "WO-7782"
    assert chain["customer_name"] == "ACME Corp"
    assert chain["customer_order_id"] == "SO-55102"
    assert "chain_summary" in chain
    print("PASS: Test 2 (Dependency chain lineage)")


def test_3_shortage_scenario_ship_7010():
    """Verify disruption causing material shortage and OTIF exposure (Scenario A)."""
    dossier = impact_engine_v2.get_incident_dossier("SHIP-7010", simulated_delay_days=7)
    assert dossier["impact_status"] == "SHORTAGE"
    assert dossier["attribution_math"]["tts_days"] == 5.0
    assert dossier["attribution_math"]["baseline_gap_days"] == 3
    assert dossier["attribution_math"]["disruption_delay_days"] == 7
    assert dossier["attribution_math"]["total_shortage_gap_days"] == 10
    assert dossier["verifiable_exposure"]["otif_exposure_usd"] == 120000.0
    assert dossier["disruption"]["severity"] == "CRITICAL"
    assert len(dossier["recovery_options_matrix"]) >= 3
    assert dossier["executive_summary"]["recommended_option_id"] == "OPT-A"
    print("PASS: Test 3 (Shortage scenario SHIP-7010)")


def test_4_absorbed_scenario_ship_6205():
    """Verify disruption absorbed by inventory buffer with zero contract exposure (Scenario B)."""
    dossier = impact_engine_v2.get_incident_dossier("SHIP-6205-01", simulated_delay_days=7)
    assert dossier["impact_status"] == "ABSORBED", "SHIP-6205-01 must be evaluated as ABSORBED"
    assert dossier["attribution_math"]["tts_days"] == 20.0
    assert dossier["attribution_math"]["total_shortage_gap_days"] == 0
    assert dossier["verifiable_exposure"]["otif_exposure_usd"] == 0.0
    assert dossier["verifiable_exposure"]["days_past_sla"] == 0
    assert dossier["executive_summary"]["recommended_option_id"] == "NONE_REQUIRED"
    assert "absorbs" in dossier["verifiable_exposure"]["proof_narrative"].lower()
    print("PASS: Test 4 (Absorbed scenario SHIP-6205-01)")


def test_5_unsupported_shipment_handling():
    """Verify explicit unsupported-state output when a shipment has missing data."""
    dossier = impact_engine_v2.get_incident_dossier("SHIP-INVALID-XYZ")
    assert dossier.get("status") == "UNSUPPORTED_DATA"
    assert "insufficient" in dossier.get("message", "").lower()

    res = client.get("/api/incidents/INC-SHIP-INVALID-XYZ")
    assert res.status_code == 404
    print("PASS: Test 5 (Unsupported shipment handling)")


def test_6_digital_twin_simulation_generalization():
    """Verify that what-if simulation dynamically recalculates for different shipments."""
    # Simulate SHIP-7010 (burn=80, on_hand=400)
    res_7010 = client.post("/api/simulate", json={
        "incident_id": "INC-2026-PORT-KLANG-01",
        "delay_days": 12
    })
    assert res_7010.status_code == 200
    pts_7010 = res_7010.get_json()["timeline_series"]
    assert pts_7010[0]["unmitigated_stock"] == 400

    # Simulate SHIP-6205-01 (burn=100, on_hand=2000)
    res_6205 = client.post("/api/simulate", json={
        "incident_id": "INC-SHIP-6205-01",
        "delay_days": 12
    })
    assert res_6205.status_code == 200
    pts_6205 = res_6205.get_json()["timeline_series"]
    assert pts_6205[0]["unmitigated_stock"] == 2000
    print("PASS: Test 6 (Digital twin simulation generalization)")


if __name__ == "__main__":
    print("\n=== RUNNING DAY 2 VERIFICATION TEST SUITE ===")
    test_1_dynamic_shipment_control()
    test_2_dependency_chain_lineage()
    test_3_shortage_scenario_ship_7010()
    test_4_absorbed_scenario_ship_6205()
    test_5_unsupported_shipment_handling()
    test_6_digital_twin_simulation_generalization()
    print("\n=== ALL 6 DAY 2 ACCEPTANCE TESTS PASSED SUCCESSFULLY! ===")
