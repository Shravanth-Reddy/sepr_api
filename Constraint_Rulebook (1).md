# Constraint Rulebook — ApexX-100 Demo
### The Constraint Agent's hard rules. Deterministic checks — NOT LLM-judged.
*(Hard constraints = deterministic code. Soft trade-offs = LLM reasoning. Say this to judges.)*

| # | Rule | Check (deterministic) | Demo verdict |
|---|---|---|---|
| C1 | **Supplier lead time** | Option arrival date must be ≤ revised ETA (2026-10-18), else it cannot bridge the gap | ❌ VETOES Hanoi Coils (30-day lead → arrives ~Nov 1) |
| C2 | **MOQ** | Order qty ≥ supplier MOQ | ✅ EuroCoils passes (900 ≥ 200) |
| C3 | **Quality / certification** | Alternate material or supplier must hold valid PPAP/certification for the ApexX-100 line | ❌ VETOES substitute STCOIL-415V (not certified) |
| C4 | **Frozen schedule window** | Production reschedule not permitted within 14 days of planned start (frozen MPS until 2026-10-16) | ❌ VETOES rescheduling WO-7782 (starts 2026-10-14) |
| C5 | **Approval authority / budget** | Premium spend > $30k requires VP Supply Chain approval (not plant manager) | ⚠️ ROUTES EuroCoils air freight (~$30.1k premium) to VP approval |
| C6 | **BOM revision compatibility** | Substitution must match active BOM revision (REV-D) electrically and mechanically | ❌ VETOES STCOIL-415V (different REV, dual constraint with C3) |
| C7 | **Route / customs** | Air freight from EU origin — no export restrictions; customs pre-clearance available | ✅ EuroCoils passes |
| C8 | **Supplier capacity** | Order qty ≤ supplier monthly capacity | ✅ EuroCoils passes (900 ≤ 3,000) |

## The demo money shot (20 seconds)
Recovery Agent proposes 4 options → Constraint Agent vetoes 3 **with specific rule IDs and reasons** →
1 survives (EuroCoils air freight) → routed to human with costed trade-off:
**~$30.1k premium freight vs $120k OTIF penalty exposure (SO-55102, ACME Corp, due 2026-10-19).**

## Key computed facts for the Impact Engine
- STCOIL-440V consumption: 40 FG/day × 2 per FG = **80/day**
- On-hand 400 → **TTS = 5 days** (stockout ~2026-10-07)
- Revised ETA → **TTR = 16 days** (2026-10-18)
- **TTR > TTS → confirmed shortage window 2026-10-07 → 2026-10-18**
- Pegging: WO-7781 (10/08), WO-7782 (10/14, FIRM, ACME), WO-7783 (10/21) → all depend on Motor Assembly → STCOIL-440V
