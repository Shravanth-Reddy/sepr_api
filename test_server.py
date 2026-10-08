from server import app

client = app.test_client()

print("--- Test 1: GET /api/incidents ---")
res1 = client.get("/api/incidents")
assert res1.status_code == 200
inc = res1.get_json()["queue"][0]
print("Incident ID:   ", inc["incident_id"])
print("Gap Equation:  ", f"{inc['baseline_gap_days']}d (baseline) + {inc['disruption_delay_days']}d (storm) = {inc['total_gap_days']}d")
print("OTIF Exposure: ", f"${inc['otif_risk_usd']:,.2f}")

print("\n--- Test 2: POST /api/simulate (delay=12d) ---")
res2 = client.post("/api/simulate", json={"incident_id": "INC-2026-PORT-KLANG-01", "delay_days": 12})
assert res2.status_code == 200
sim_data = res2.get_json()
print("Simulated Gap: ", sim_data["dossier"]["attribution_math"]["gap_equation"])
print("Revised ETA:   ", sim_data["dossier"]["disruption"]["revised_eta"])
print("Timeline Pts:  ", len(sim_data["timeline_series"]))

print("\n--- Test 3: GET /api/evidence/<incident_id> ---")
res_evidence = client.get("/api/evidence/INC-2026-PORT-KLANG-01")
assert res_evidence.status_code == 200
evidence = res_evidence.get_json()
assert evidence["incident_id"] == "INC-2026-PORT-KLANG-01"
assert evidence["extracted_delay_days"] == 7
assert evidence["article"]["title"]
print("Evidence Source:   ", evidence["source_label"])
print("Evidence Article:  ", evidence["article"]["title"])

print("\n--- Test 4: POST /api/decisions (APPROVE OPT-A) ---")
res3 = client.post("/api/decisions", json={
    "incident_id": "INC-2026-PORT-KLANG-01",
    "option_id": "OPT-A",
    "action": "APPROVE",
    "approver_role": "VP Supply Chain",
    "notes": "Protect the ACME SLA with the lowest-cost option that passes all hard constraints."
})
assert res3.status_code == 200
dec = res3.get_json()
print("Decision Status:    ", dec["status"])
print("Generated PO:       ", dec["po_number"])
print("Authorized Supplier:", dec["po_payload"]["supplier"])
print("Cost Center:        ", dec["po_payload"]["cost_center"])
print("\nPhase 2 Server Verification: ALL 4 ENDPOINTS PASSED!")
