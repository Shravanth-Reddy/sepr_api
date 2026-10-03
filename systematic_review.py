"""
Systematic End-to-End Verification & Health Review Script.

Checks:
1. Process & Port Health (Port 8000 Backend, Port 3000 Frontend)
2. Database Schema & Data Integrity (mock_erp.db)
3. Mathematical Attribution Accuracy (Baseline 3d + Storm 7d = 10d Net)
4. Verifiable Timeline & OTIF Arithmetic (WO-7782 duration vs SO-55102 SLA)
5. Dynamic C1-C8 Matrix Evaluation
6. API Endpoints & Contract Validation
7. Decision Authorization & Audit Ledger Flow
"""
import requests
import sqlite3
import json
from datetime import datetime

PASS = 0
FAIL = 0

def check(label, condition, detail=""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  [PASS] {label}")
    else:
        FAIL += 1
        print(f"  [FAIL] {label} -> {detail}")

print("=" * 75)
print("SYSTEMATIC WORKING REVIEW: APEXX-100 S&OE CONTROL TOWER")
print("=" * 75)

# 1. PROCESS & PORT HEALTH
print("\n--- 1. Service & Port Health ---")
try:
    r_api = requests.get("http://127.0.0.1:8000/api/incidents", timeout=3)
    check("Backend API Server (port 8000) is LIVE", r_api.status_code == 200, f"Got status {r_api.status_code}")
except Exception as e:
    check("Backend API Server (port 8000) is LIVE", False, str(e))

try:
    r_fe = requests.get("http://localhost:3000", timeout=3)
    check("Frontend Vite Server (port 3000) is LIVE", r_fe.status_code == 200, f"Got status {r_fe.status_code}")
except Exception as e:
    check("Frontend Vite Server (port 3000) is LIVE", False, str(e))

# 2. DATABASE INTEGRITY
print("\n--- 2. Database Ground Truth (mock_erp.db) ---")
conn = sqlite3.connect("mock_erp.db")
conn.row_factory = sqlite3.Row

# Inventory
inv = conn.execute("SELECT on_hand_qty, daily_consumption FROM inventory WHERE material_id='STCOIL-440V'").fetchone()
check("STCOIL-440V on_hand = 400", inv["on_hand_qty"] == 400, f"Got {inv['on_hand_qty']}")
check("STCOIL-440V daily_consumption = 80.0", inv["daily_consumption"] == 80.0, f"Got {inv['daily_consumption']}")

# Shipment
ship = conn.execute("SELECT shipment_id, po_id, vessel_name, original_eta FROM shipments WHERE shipment_id='SHIP-7010'").fetchone()
check("SHIP-7010 exists and linked to PO-7010", ship["po_id"] == "PO-7010")
check("Carrying vessel = MV Sentinel", ship["vessel_name"] == "MV Sentinel")
check("Original ETA = 2026-10-11", ship["original_eta"] == "2026-10-11")

# Work Order & Customer Order
wo = conn.execute("SELECT planned_start, planned_end, frozen_schedule FROM work_orders WHERE work_order_id='WO-7782'").fetchone()
check("WO-7782 starts 2026-10-14, ends 2026-10-17 (3d duration)", wo["planned_start"] == "2026-10-14" and wo["planned_end"] == "2026-10-17")
check("WO-7782 frozen_schedule = 1 (Rule C4)", wo["frozen_schedule"] == 1)

co = conn.execute("SELECT quantity, unit_price, requested_date FROM customer_orders WHERE customer_order_id='SO-55102'").fetchone()
check("SO-55102 ACME order due date = 2026-10-19", co["requested_date"] == "2026-10-19")
check("SO-55102 order value = $120,000.00 (500 * $240)", co["quantity"] * co["unit_price"] == 120000.0)
conn.close()

# 3. MATHEMATICAL ATTRIBUTION & TIMELINE VERIFICATION
print("\n--- 3. Mathematical Attribution & Timeline Proof ---")
import impact_engine_v2
dossier = impact_engine_v2.get_incident_dossier(as_of="2026-10-03", simulated_delay_days=7)

tts = dossier["attribution_math"]["tts_days"]
check("TTS = 5.0 days (400 / 80)", tts == 5.0, f"Got {tts}")
check("Stockout date = 2026-10-08", dossier["attribution_math"]["stockout_date"] == "2026-10-08")

base_gap = dossier["attribution_math"]["baseline_gap_days"]
disruption_gap = dossier["attribution_math"]["disruption_delay_days"]
total_gap = dossier["attribution_math"]["total_shortage_gap_days"]
check("Baseline gap = 3 days (Oct 08 to Oct 11)", base_gap == 3, f"Got {base_gap}")
check("Disruption gap = 7 days", disruption_gap == 7, f"Got {disruption_gap}")
check("Total shortage gap = 10 days (3 + 7)", total_gap == 10, f"Got {total_gap}")

exposure = dossier["verifiable_exposure"]
check("WO duration = 3 days", exposure["wo_duration_days"] == 3)
check("Delayed WO completion = 2026-10-21 (Oct 18 arrival + 3d duration)", exposure["delayed_completion_date"] == "2026-10-21")
check("Days past ACME SLA (Oct 19) = 2 days late", exposure["days_past_sla"] == 2)
check("OTIF exposure verified = $120,000.00", exposure["otif_exposure_usd"] == 120000.0)

# 4. OPTION A RESIDUAL GAP & FINANCES
print("\n--- 4. Recovery Option A (EuroCoils) Residual Gap & Financials ---")
opt_a = next(o for o in dossier["recovery_options_matrix"] if o["option_id"] == "OPT-A")
check("EuroCoils arrival = 2026-10-13", opt_a["arrival_date"] == "2026-10-13")
check("EuroCoils residual shortage gap = 5 days (Oct 08 to Oct 13)", opt_a["residual_gap_days"] == 5, f"Got {opt_a['residual_gap_days']}")
check("EuroCoils expedite cost = $30,150.00", opt_a["estimated_cost_usd"] == 30150.0)

exec_sum = dossier["executive_summary"]
check("Net value saved = $89,850.00 ($120k penalty - $30,150 freight)", exec_sum["net_value_saved_usd"] == 89850.0)
check("ROI ratio = 2.98x (298%)", exec_sum["roi_ratio"] == 2.98, f"Got {exec_sum['roi_ratio']}")
check("Governance rule C5 triggered (spend > $30k) -> Requires VP Approval", exec_sum["approval_required"] == True)

# 5. DYNAMIC C1-C8 MATRIX
print("\n--- 5. Dynamic C1-C8 Constraint Matrix ---")
matrix = {o["option_id"]: o for o in dossier["recovery_options_matrix"]}

# OPT-A
check("OPT-A passes C1-C4, C6-C8", len(matrix["OPT-A"]["hard_vetoes"]) == 0)
check("OPT-A triggers C5 soft warning (VP approval)", matrix["OPT-A"]["requires_vp_approval"] == True)
check("OPT-A final status = PASS_WITH_WARNING (Survivor)", matrix["OPT-A"]["status"] == "PASS_WITH_WARNING")

# OPT-B
check("OPT-B vetoed by C1 (Lead time 30d arrives Nov 02 > Oct 18)", "C1" in matrix["OPT-B"]["hard_vetoes"])
check("OPT-B final status = VETOED", matrix["OPT-B"]["status"] == "VETOED")

# OPT-C
check("OPT-C vetoed by C4 (WO-7782 inside 14d frozen window)", "C4" in matrix["OPT-C"]["hard_vetoes"])
check("OPT-C final status = VETOED", matrix["OPT-C"]["status"] == "VETOED")

# OPT-D
check("OPT-D vetoed by C3 (No PPAP) and C6 (REV-C != REV-D)", "C3" in matrix["OPT-D"]["hard_vetoes"] and "C6" in matrix["OPT-D"]["hard_vetoes"])
check("OPT-D final status = VETOED", matrix["OPT-D"]["status"] == "VETOED")

# 6. API ENDPOINTS & SIMULATION
print("\n--- 6. API Endpoints & What-If Simulation (/api/simulate) ---")
# Simulate delay = 14 days
sim_res = requests.post("http://127.0.0.1:8000/api/simulate", json={"delay_days": 14}).json()
sim_dossier = sim_res["dossier"]
check("Simulation delay = 14d -> Revised ETA = 2026-10-25", sim_dossier["disruption"]["revised_eta"] == "2026-10-25")
check("Simulation total gap = 17 days (3d baseline + 14d storm)", sim_dossier["attribution_math"]["total_shortage_gap_days"] == 17)
check("Simulation returns 21 depletion timeline points", len(sim_res["timeline_series"]) == 21)

# 7. DECISION AUTHORIZATION & AUDIT LEDGER
print("\n--- 7. Human Decision Gate & Audit Trail (/api/decisions) ---")
dec_res = requests.post("http://127.0.0.1:8000/api/decisions", json={
    "incident_id": "INC-2026-PORT-KLANG-01",
    "option_id": "OPT-A",
    "action": "APPROVE",
    "approver_role": "VP Supply Chain"
}).json()

check("Decision status = EXECUTED", dec_res["status"] == "EXECUTED")
check("PO generated with valid format", dec_res["po_number"].startswith("PO-EURO-"))
check("PO authorized by VP Supply Chain", "VP Supply Chain" in dec_res["po_payload"]["authorized_by"])
check("Authorized spend = $30,150.00", dec_res["po_payload"]["authorized_cost_usd"] == 30150.0)

audit_res = requests.get("http://127.0.0.1:8000/api/audit").json()
check("Audit ledger records transaction", len(audit_res["audit_trail"]) >= 1)

# FINAL SUMMARY
print("\n" + "=" * 75)
total = PASS + FAIL
print(f"FINAL REVIEW SCORECARD: {PASS}/{total} CHECKS PASSED, {FAIL} FAILED")
print("=" * 75)
if FAIL == 0:
    print("ALL WORKING LOGIC & CONTRACTS ARE VERIFIED 100% ACCURATE!")
