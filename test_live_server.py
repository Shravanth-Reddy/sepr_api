import os
import pytest
import requests

if os.getenv("RUN_LIVE_API_TESTS") != "1":
    pytest.skip("Live server tests require RUN_LIVE_API_TESTS=1", allow_module_level=True)

print("--- Test 1: GET http://127.0.0.1:8000/api/incidents ---")
r1 = requests.get("http://127.0.0.1:8000/api/incidents", timeout=5)
assert r1.status_code == 200
inc = r1.json()["queue"][0]
print("Incident ID:  ", inc["incident_id"])
print("Gap Equation: ", f"{inc['baseline_gap_days']}d (baseline) + {inc['disruption_delay_days']}d (storm) = {inc['total_gap_days']}d")
print("OTIF Risk:    ", f"${inc['otif_risk_usd']:,.2f}")

print("\n--- Test 2: POST http://127.0.0.1:8000/api/simulate ---")
r2 = requests.post("http://127.0.0.1:8000/api/simulate", json={"delay_days": 10}, timeout=5)
assert r2.status_code == 200
dossier = r2.json()["dossier"]
print("Simulated Gap: ", dossier["attribution_math"]["gap_equation"])
print("Revised ETA:   ", dossier["disruption"]["revised_eta"])

print("\n--- Test 3: POST http://127.0.0.1:8000/api/decisions ---")
r3 = requests.post("http://127.0.0.1:8000/api/decisions", json={
    "incident_id": "INC-2026-PORT-KLANG-01",
    "option_id": "OPT-A",
    "action": "APPROVE",
    "approver_role": "VP Supply Chain",
    "notes": "Protect the ACME SLA with the lowest-cost option that passes all hard constraints."
}, timeout=5)
assert r3.status_code == 200
dec = r3.json()
print("Decision:      ", dec["action"])
print("PO Issued:     ", dec["po_number"])
print("Cost Auth:     ", f"${dec['po_payload']['authorized_cost_usd']:,.2f}")
print("\nPhase 2 Server: ALL LIVE ENDPOINTS VERIFIED SUCCESSFULLY!")
