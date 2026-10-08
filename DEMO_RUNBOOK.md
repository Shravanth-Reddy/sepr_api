# APEXX Supply Control Tower — Judge Demo Runbook & Architecture Guide

**System Name:** APEXX Autonomous Supply Control Tower  
**Reference Scenario Date:** `2026-10-03` (Deterministic Evaluation Baseline)  
**Primary Disruption:** Port Klang Tropical Storm & Berth Congestion (`+7 Days Delay`)  
**Primary Shipment:** `SHIP-7010` (Stator Coils `STCOIL-440V` for ACME Corp `WO-7782`)

---

## 1. Executive Summary & Value Proposition

Traditional supply chain control towers suffer from two core failure modes:
1. **Unverified Hallucinations**: Generic LLMs make up shipment delays and recommend unvetted suppliers.
2. **Brittle Alert Fatigue**: Basic alert tools fire false alarms on delays that are safely absorbed by inventory buffers.

**The APEXX Solution:**
- **Honest Signal Extraction**: Real multi-source SerpAPI news signals ranked by relevance and deduplicated, with clear tier provenance (Live API → Local Cache → Controlled Scenario).
- **Dual-Scenario Discrimination**: Automatically distinguishes **Critical Shortages** ($120k penalty) from **Buffer-Absorbed Delays** ($0 exposure, zero panic).
- **Verifiable Attribution Math**: Strictly separates the baseline deficit from disruption delay:
  $$\text{Baseline Deficit (3d)} + \text{Disruption Delay (7d)} = \text{10d Net Shortage}$$
- **Deterministic Governance (C1–C8)**: Recommends recovery options backed by an explainable, 9-point rule proof chain and enforces VP authorization gates for spend over $30,000.
- **Durable Audit Trail**: Persists all investigations, rule evaluations, and human decisions to SQLite.

---

## 2. Five-Minute Live Judge Walkthrough Script

### **Phase 1: Operational Signal Discovery & Multi-Source Evidence**
1. **Action**: Open the **Operations** tab and click **"Investigate"** on `SHIP-7010` (Vessel *MSC Laurence*, Route *Port Klang → Chennai*).
2. **Talking Point**:
   > *"We trigger a targeted search querying the exact vessel and origin port. The parser scores and ranks multiple news sources, deduplicating them and extracting a verified +7-day delay at Port Klang."*
3. **Evidence Drawer**:
   - Point to the **Evidence Drawer**: Show the selected article headline, live URL, extracted delay (+7d), and corroborating sources.
   - Note the **AIS Telemetry Status**: Honestly marked as `"UNAVAILABLE / NOT MONITORED"` (no fake GPS coordinates).

---

### **Phase 2: Verifiable Exposure & Dual-Scenario Comparison**
1. **Action**: Navigate to the **Incident Queue** (`/api/incidents`).
2. **Point Out Dual Scenarios**:
   - **`INC-2026-PORT-KLANG-01` (`SHIP-7010`)**: **CRITICAL** severity. 400 on-hand units cover 5.0 days of burn (stockout on `2026-10-08`). Inbound arrives on `2026-10-18` (+7d delay). **Financial exposure: $120,000.00** across 500 units for customer ACME Corp.
   - **`INC-SHIP-6205-01` (`SHIP-6205-01`)**: **NOMINAL / BUFFER ABSORBED**. 2,000 bearings on-hand provide 20.0 days of cover. Even with a +7d delay pushing arrival to day 15, `TTS (20d) >= TTR (15d)`. **Financial exposure: $0.00**. No expediting spend needed!

---

### **Phase 3: Digital Twin What-If Simulator**
1. **Action**: Switch to the **Planner** role on `INC-2026-PORT-KLANG-01` and drag the **Disruption Delay Slider** from `+7 days` to `+14 days`.
2. **Talking Point**:
   > *"Our Digital Twin recalculates inventory trajectory curves in real time. As delay increases, the total shortage gap dynamically widens, and constraint rules re-evaluate to see which suppliers remain viable."*

---

### **Phase 4: Governance Gate & "Why This Option?" Explainability**
1. **Action**: Review the **Recovery Options Matrix**:
   - **OPT-A (EuroCoils GmbH, Air Freight)**: Arrives `2026-10-13` (10d lead time). Valid PPAP on ApexX-100. Cost: **$30,150.00**. Status: `PASS_WITH_WARNING` (Rule C5 triggers VP sign-off because spend > $30k).
   - **OPT-B (Hanoi Precision, Ocean)**: Arrives `2026-11-02` (30d lead time). **VETOED** (fails C1: arrives after revised ETA).
   - **OPT-C (Reschedule)**: **VETOED** (fails C4: inside 14-day frozen production window).
   - **OPT-D (Substitute Material STCOIL-415V)**: **VETOED** (fails C6: incompatible with active BOM REV-D).
2. **Action**: Open the **Audit** workspace and highlight the **"Why This Option?"** 9-point proof:
   > 1. SerpApi evidence indicates a Port Klang disruption.  
   > 2. The affected route matches SHIP-7010 (Port Klang -> Chennai).  
   > 3. SHIP-7010 carries STCOIL-440V (Stator Coil 440V) from Pacific Coils.  
   > 4. STCOIL-440V is required by APEXM-100 work order WO-7782 for ACME Corp.  
   > 5. Inventory of 400 units (5.0d supply) reaches stockout on 2026-10-08, before the disrupted arrival of 2026-10-18.  
   > 6. OPT-A (EuroCoils GmbH) arrives 2026-10-13, earlier than revised ETA 2026-10-18.  
   > 7. OPT-A passes hard constraints C1, C2, C3, C4, C6, C7, C8 without hard vetoes.  
   > 8. Expediting cost $30,150.00 is lower than the OTIF penalty exposure of $120,000.00 (Net saving: $89,850.00).  
   > 9. C5 requires VP Supply Chain approval because spend exceeds $30,000.

---

### **Phase 5: Human Gate Sign-off & Durable SQLite Audit**
1. **Action**: Switch to the **VP Supply Chain** role.
2. **Action**: Click **"Review and approve"**, enter approval note: `"Approved critical air freight to protect ACME Corp delivery and prevent $120k penalty"`, and submit.
3. **Verify Outcome**:
   - Formal Purchase Order **`PO-EURO-XXXX`** generated.
   - Decision record created and persisted in SQLite.
4. **Demonstrate Restart Durability**:
   - Even if the backend server restarts, `/api/audit` reads directly from SQLite and displays all past decisions, investigations, and search outcomes intact.

---

## 3. Quickstart & Verification Commands

### Start Backend API Server
```powershell
python server.py
# Server runs on http://127.0.0.1:8000
```

### Run Master Acceptance Test Suite
```powershell
python run_all_tests.py
```

### Run Individual Phase Verification Suites
```powershell
python test_day1_evidence_flow.py          # Day 1: Evidence & Search Flow (5/5)
python test_day2_generalized_impact.py      # Day 2: Dynamic BOM & Dual Scenario (6/6)
python test_day3_explainability_audit.py    # Day 3: Explainability & SQLite Audit (7/7)
python test_day4_e2e_runbook.py             # Day 4: Full E2E & Edge Case Guardrails (6/6)
python test_server.py                       # Core API Integration (4/4)
python -m pytest test_signal_agent.py       # Signal Agent Unit Tests (15/15)
```

---

## 4. API Endpoints Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/operations/shipments` | In-transit shipment inventory with linked work orders |
| `POST` | `/api/signal-search` | External search, multi-source extraction & ERP resolution |
| `GET` | `/api/incidents` | Incident queue sorted by financial severity (Shortage vs Absorbed) |
| `GET` | `/api/incidents/<id>` | Comprehensive incident dossier with BOM lineage & C1–C8 matrix |
| `GET` | `/api/evidence/<id>` | Multi-source evidence payload with confidence & search metadata |
| `POST` | `/api/simulate` | Digital Twin simulation recalculating shortage curves & rule viability |
| `POST` | `/api/decisions` | Governed human approval gate issuing PO and writing SQLite audit |
| `GET` | `/api/audit` | Durable audit ledger reading from SQLite |
