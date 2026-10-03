"""
Signal Agent Orchestrator.

Autonomous signal intelligence agent that:
1. Ingests maritime disruption signals via SerpAPI (with 3-tier demo fallback)
2. Parses unstructured news into structured disruption events
3. Resolves external disruption entities to internal ERP objects in mock_erp.db
4. Formats canonical trace logs and exports signal_output.json for the downstream Impact Engine.

Updated for ApexX-100 scenario:
  - Reference date: 2026-10-03
  - Hero shipment: SHIP-7010 / PO-7010 / STCOIL-440V / MV Sentinel
  - Default delay: +7 days
"""
import json
import logging
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from pathlib import Path

import config
import serp_client
import disruption_parser
import erp_resolver

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("SignalAgent")

SIGNAL_OUTPUT_FILE = config.BASE_DIR / "signal_output.json"


class SignalAgent:
    """The Signal Agent: Connects external disruption intelligence to enterprise ERP records."""

    def __init__(self):
        self.output_file = SIGNAL_OUTPUT_FILE

    def run(
        self,
        query: Optional[str] = None,
        force_tier: Optional[int] = None,
        reference_date: str = config.REFERENCE_DATE
    ) -> Dict[str, Any]:
        """
        Executes the end-to-end Signal Agent pipeline:
        Ingestion -> Parsing -> ERP Resolution -> Output Payload & Trace Log.
        """
        logger.info("Signal Agent initiated.")

        # 1. Ingestion via 3-Tier Fallback Chain
        logger.info(f"Step 1: Ingesting news signals (force_tier={force_tier})...")
        raw_news, source_tier = serp_client.fetch_disruption_news(query=query, force_tier=force_tier)
        logger.info(f"Ingestion successful from tier: {source_tier}")

        # 2. Parsing into DisruptionEvent schema
        logger.info("Step 2: Parsing news content into structured disruption event...")
        event = disruption_parser.extract_primary_disruption(raw_news)
        logger.info(f"Disruption detected: {event.event_name} (+{event.delay_days}d delay)")

        # 3. ERP Entity Resolution against mock_erp.db
        logger.info(f"Step 3: Resolving external entity '{event.location}' against mock_erp.db...")
        resolved_impacts = erp_resolver.resolve_disruption_to_erp(
            location=event.location,
            delay_days=event.delay_days,
            reference_date_str=reference_date
        )

        if not resolved_impacts:
            logger.warning(f"No in-transit shipments matched for '{event.location}'. Signal IGNORED.")
            output_payload: Dict[str, Any] = {
                "agent": "SignalAgent",
                "status": "IGNORED",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "source_tier": source_tier,
                "disruption": event.model_dump(),
                "affected_shipments_count": 0,
                "primary_impact": None,
                "all_impacted_shipments": [],
                "trace_log": f"Signal Agent: detected {event.event_name} but no matching in-transit shipments found. Signal IGNORED.",
                "downstream_ready": False
            }
            with open(self.output_file, "w", encoding="utf-8") as f:
                json.dump(output_payload, f, indent=2, ensure_ascii=False)
            return output_payload

        # Primary impacted shipment (SHIP-7010 is the critical demonstration path)
        primary_impact = next(
            (imp for imp in resolved_impacts if imp.shipment_id == "SHIP-7010"),
            resolved_impacts[0]
        )
        logger.info(f"Resolved to critical shipment: {primary_impact.shipment_id}, PO: {primary_impact.po_id}")

        # 4. Canonical Trace Log formatting
        source_label_map = {
            "live_api": f"Live SerpAPI ({event.headline[:40]}...)",
            "cache": "Cached Intelligence Feed",
            "hardcoded_scenario": "Scenario Fallback Generator"
        }
        source_label = source_label_map.get(source_tier, source_tier)

        trace_log = (
            f"Signal Agent: detected {event.event_name} via [{source_label}], "
            f"matched to {primary_impact.po_id} (vessel {primary_impact.vessel_name}), "
            f"material {primary_impact.material_id} ({primary_impact.material_name}), "
            f"ETA revised +{primary_impact.delay_days} days "
            f"({primary_impact.original_eta} -> {primary_impact.revised_eta})."
        )
        logger.info(f"TRACE: {trace_log}")

        # 5. Output Payload Construction
        output_payload: Dict[str, Any] = {
            "agent": "SignalAgent",
            "status": "DISRUPTION_DETECTED",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source_tier": source_tier,
            "disruption": event.model_dump(),
            "affected_shipments_count": len(resolved_impacts),
            "primary_impact": primary_impact.model_dump(),
            "all_impacted_shipments": [imp.model_dump() for imp in resolved_impacts],
            "trace_log": trace_log,
            "downstream_ready": True
        }

        # 6. Export to file for downstream agents
        with open(self.output_file, "w", encoding="utf-8") as f:
            json.dump(output_payload, f, indent=2, ensure_ascii=False)
        logger.info(f"Signal state exported successfully to {self.output_file}")

        return output_payload


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Run Signal Agent for Supply Chain Disruption Orchestration")
    parser.add_argument("--tier", type=int, choices=[1, 2, 3], help="Force tier: 1=Live, 2=Cache, 3=Scenario")
    parser.add_argument("--query", type=str, help="Custom search query for SerpAPI")
    args = parser.parse_args()

    agent = SignalAgent()
    result = agent.run(query=args.query, force_tier=args.tier)
    print("\n" + "=" * 60)
    print("SIGNAL AGENT EXECUTION SUMMARY:")
    print("=" * 60)
    print(f"Status:       {result['status']}")
    print(f"Source Tier:   {result['source_tier']}")
    print(f"Disruption:   {result['disruption']['event_name']}")
    print(f"Headline:     {result['disruption']['headline']}")
    if result['primary_impact']:
        pi = result['primary_impact']
        print(f"Affected PO:  {pi['po_id']} ({pi['material_name']})")
        print(f"Original ETA: {pi['original_eta']} -> Revised ETA: {pi['revised_eta']}")
    print(f"\nTRACE LOG:\n{result['trace_log']}")
    print("=" * 60)


if __name__ == "__main__":
    main()
