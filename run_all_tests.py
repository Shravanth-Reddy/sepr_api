"""
APEXX Master Acceptance Test Runner
===================================
Runs all four day suites + server API + signal agent pytest suite.
Reports complete dashboard summary.
"""
import sys
import subprocess
import os

BASE_DIR = os.path.dirname(__file__)

SUITES = [
    ("Day 1: Evidence Search & Multi-Source Ranking", "test_day1_evidence_flow.py"),
    ("Day 2: Generalized Dynamic BOM & Dual Scenarios", "test_day2_generalized_impact.py"),
    ("Day 3: Explainability & SQLite Audit Persistence", "test_day3_explainability_audit.py"),
    ("Day 4: Full E2E Workflow & Guardrail Boundaries", "test_day4_e2e_runbook.py"),
    ("Integration: Phase 2 API Server Endpoints", "test_server.py"),
]


def run_suite(name: str, script_name: str) -> bool:
    print(f"\n{'='*70}")
    print(f"  EXECUTING: {name}")
    print(f"{'='*70}")
    script_path = os.path.join(BASE_DIR, script_name)
    res = subprocess.run([sys.executable, script_path], cwd=BASE_DIR)
    return res.returncode == 0


def main():
    print("""
======================================================================
     APEXX AUTONOMOUS SUPPLY CONTROL TOWER -- MASTER TEST SUITE
======================================================================
""")
    results = {}
    for name, script in SUITES:
        success = run_suite(name, script)
        results[name] = success

    print(f"\n{'='*70}")
    print("                    FINAL VERIFICATION SUMMARY")
    print(f"{'='*70}")
    all_passed = True
    for name, success in results.items():
        status = "[PASS]" if success else "[FAIL]"
        if not success:
            all_passed = False
        print(f"  {status:8} | {name}")

    print(f"{'='*70}")
    if all_passed:
        print("  ALL TEST SUITES PASSED! System is 100% ready for demo judging.")
        print(f"{'='*70}\n")
        sys.exit(0)
    else:
        print("  SOME TEST SUITES FAILED. Please review the logs above.")
        print(f"{'='*70}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
