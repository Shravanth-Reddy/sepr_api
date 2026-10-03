"""
LangGraph Orchestration Pipeline for Autonomous Supply Chain Disruption Management.

Defines:
1. DisruptionState: Typed shared dossier flowing through all agent nodes
2. Nodes: signal, impact, recovery, constraint, recommendation, escalate
3. Conditional Routers:
   - route_after_signal: IGNORED vs proceed to impact
   - route_after_impact: ABSORBED vs SHORTAGE (proceed to recovery)
   - route_after_constraint: ESCALATE vs proceed to recommendation
"""
from typing import TypedDict, List, Dict, Any, Optional
from langgraph.graph import StateGraph, END


class DisruptionState(TypedDict):
    """The central state dossier passed across all agent nodes."""
    # Input parameters
    query: Optional[str]
    force_tier: Optional[int]
    reference_date: str

    # 1. Signal Agent outputs
    signal_status: str              # "DETECTED" | "IGNORED"
    disruption_event: Dict[str, Any]
    matched_shipments: List[Dict[str, Any]]
    primary_shipment: Optional[Dict[str, Any]]

    # 2. Impact Engine outputs
    impact_status: str              # "SHORTAGE" | "ABSORBED"
    tts_days: float                 # Time to Survive (days)
    ttr_days: float                 # Time to Recover (days)
    stockout_date: str              # YYYY-MM-DD
    shortage_window_days: int       # Net shortage days
    affected_work_orders: List[Dict[str, Any]]
    affected_customer_orders: List[Dict[str, Any]]
    otif_exposure_usd: float

    # 3. Recovery Agent outputs
    recovery_options: List[Dict[str, Any]]  # Candidate options (OPT-A through OPT-D)

    # 4. Constraint Agent outputs
    constraint_verdicts: List[Dict[str, Any]] # C1-C8 check results for each option
    surviving_options: List[Dict[str, Any]]   # Options that passed all hard constraints
    vetoed_options: List[Dict[str, Any]]      # Options vetoed with rule IDs and reasons

    # 5. Recommendation outputs (Gemini LLM)
    recommendation_summary: str
    recommended_option: Optional[Dict[str, Any]]
    approval_required: bool                   # True if C5 budget rule triggered (> $30k)
    approval_authority: str                   # "VP Supply Chain" or "Plant Manager"

    # Orchestration tracking
    trace_log: List[str]
    final_status: str                         # "READY" | "ABSORBED" | "IGNORED" | "ESCALATE"


# ============================================================================
# Conditional Routing Functions
# ============================================================================

def route_after_signal(state: DisruptionState) -> str:
    """Routes to END if signal was false positive / IGNORED, else to impact_node."""
    if state.get("signal_status") == "IGNORED":
        return "signal_ignored_exit"
    return "impact_node"


def route_after_impact(state: DisruptionState) -> str:
    """Routes to END if buffer absorbs delay, else to recovery_node."""
    if state.get("impact_status") == "ABSORBED":
        return "impact_absorbed_exit"
    return "recovery_node"


def route_after_constraint(state: DisruptionState) -> str:
    """Routes to escalate_node if no feasible options survive, else to recommend_node."""
    survivors = state.get("surviving_options", [])
    if not survivors:
        return "escalate_node"
    return "recommend_node"


# ============================================================================
# Placeholder Node Stubs (will be replaced by full implementations in Steps 3-7)
# ============================================================================

import serp_client
import disruption_parser
import erp_resolver
import config


def signal_node(state: DisruptionState) -> Dict[str, Any]:
    """
    Signal Agent LangGraph Node:
    1. Ingests news via 3-tier SerpAPI fallback
    2. Parses into structured DisruptionEvent
    3. Resolves affected shipments in mock_erp.db
    """
    query = state.get("query") or config.DEFAULT_SEARCH_QUERY
    force_tier = state.get("force_tier")
    ref_date = state.get("reference_date") or config.REFERENCE_DATE
    logs = list(state.get("trace_log") or [])

    # 1. News Ingestion
    raw_news, source_tier = serp_client.fetch_disruption_news(query=query, force_tier=force_tier)

    # 2. News Parsing
    event = disruption_parser.extract_primary_disruption(raw_news)

    # 3. ERP Entity Resolution against mock_erp.db
    resolved = erp_resolver.resolve_disruption_to_erp(
        location=event.location,
        delay_days=event.delay_days,
        reference_date_str=ref_date
    )

    # If no shipments match -> False positive / IGNORED
    if not resolved:
        trace_entry = (
            f"Signal Agent: detected '{event.event_name}' at '{event.location}' via [{source_tier}], "
            f"but no matching in-transit shipments exist in mock_erp.db. Status: IGNORED."
        )
        logs.append(trace_entry)
        return {
            "signal_status": "IGNORED",
            "disruption_event": event.model_dump(),
            "matched_shipments": [],
            "primary_shipment": None,
            "trace_log": logs
        }

    # Primary hero shipment (SHIP-7010 / STCOIL-440V)
    primary = next((s for s in resolved if s.shipment_id == "SHIP-7010"), resolved[0])

    source_label_map = {
        "live_api": f"Live SerpAPI ({event.headline[:35]}...)",
        "cache": "Cached Intelligence Feed",
        "hardcoded_scenario": "Scenario Fallback Generator"
    }
    source_label = source_label_map.get(source_tier, source_tier)

    trace_entry = (
        f"Signal Agent: detected {event.event_name} via [{source_label}], "
        f"matched to {primary.po_id} (vessel {primary.vessel_name}), "
        f"material {primary.material_id} ({primary.material_name}), "
        f"ETA revised +{primary.delay_days} days ({primary.original_eta} -> {primary.revised_eta})."
    )
    logs.append(trace_entry)

    return {
        "signal_status": "DETECTED",
        "disruption_event": event.model_dump(),
        "matched_shipments": [s.model_dump() for s in resolved],
        "primary_shipment": primary.model_dump(),
        "trace_log": logs
    }


from impact_engine import impact_node
from recovery_agent import recovery_node
from constraint_agent import constraint_node
from recommendation import recommend_node


def signal_ignored_exit_node(state: DisruptionState) -> Dict[str, Any]:
    """Terminal node for ignored/unrelated disruption signals."""
    log = list(state.get("trace_log", []))
    log.append("Router: Disruption does not impact active enterprise shipments. Flow ended gracefully.")
    return {"final_status": "IGNORED", "trace_log": log}


def impact_absorbed_exit_node(state: DisruptionState) -> Dict[str, Any]:
    """Terminal node when inventory buffer absorbs the delay with zero shortage."""
    log = list(state.get("trace_log", []))
    log.append(f"Router: TTS ({state.get('tts_days')}d) >= TTR ({state.get('ttr_days')}d). Delay is absorbed by safety buffer. Zero recovery needed.")
    return {"final_status": "ABSORBED", "trace_log": log}


def escalate_node(state: DisruptionState) -> Dict[str, Any]:
    """Terminal node when all recovery options are vetoed by hard constraints."""
    log = list(state.get("trace_log", []))
    log.append("Router: All recovery options vetoed by constraint engine. Escalating to S&OE Executive Board.")
    return {"final_status": "ESCALATE", "trace_log": log}


# ============================================================================
# Graph Builder
# ============================================================================

def build_disruption_graph(
    signal_fn=signal_node,
    impact_fn=impact_node,
    recovery_fn=recovery_node,
    constraint_fn=constraint_node,
    recommend_fn=recommend_node
) -> StateGraph:
    """Constructs and compiles the complete LangGraph disruption state machine."""
    workflow = StateGraph(DisruptionState)

    # 1. Register Nodes
    workflow.add_node("signal_node", signal_fn)
    workflow.add_node("impact_node", impact_fn)
    workflow.add_node("recovery_node", recovery_fn)
    workflow.add_node("constraint_node", constraint_fn)
    workflow.add_node("recommend_node", recommend_fn)

    # Terminal exit nodes
    workflow.add_node("signal_ignored_exit", signal_ignored_exit_node)
    workflow.add_node("impact_absorbed_exit", impact_absorbed_exit_node)
    workflow.add_node("escalate_node", escalate_node)

    # 2. Set Entry Point
    workflow.set_entry_point("signal_node")

    # 3. Add Conditional Routing Edges
    workflow.add_conditional_edges(
        "signal_node",
        route_after_signal,
        {
            "signal_ignored_exit": "signal_ignored_exit",
            "impact_node": "impact_node"
        }
    )

    workflow.add_conditional_edges(
        "impact_node",
        route_after_impact,
        {
            "impact_absorbed_exit": "impact_absorbed_exit",
            "recovery_node": "recovery_node"
        }
    )

    workflow.add_edge("recovery_node", "constraint_node")

    workflow.add_conditional_edges(
        "constraint_node",
        route_after_constraint,
        {
            "escalate_node": "escalate_node",
            "recommend_node": "recommend_node"
        }
    )

    # 4. Terminal Edges to END
    workflow.add_edge("recommend_node", END)
    workflow.add_edge("signal_ignored_exit", END)
    workflow.add_edge("impact_absorbed_exit", END)
    workflow.add_edge("escalate_node", END)

    return workflow.compile()


if __name__ == "__main__":
    # Self-test: Compile and inspect the graph
    app = build_disruption_graph()
    print("Graph compiled successfully!")
    print(f"Nodes registered: {list(app.get_graph().nodes.keys())}")
