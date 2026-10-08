export type UserRole = 'PLANNER' | 'PLANT_LEAD' | 'VP' | 'AUDIT';

export interface OperationShipment {
  shipment_id: string;
  po_id: string;
  origin: string;
  destination: string;
  vessel_name: string;
  supplier_name: string;
  material_id: string;
  quantity: number;
  expected_date: string;
  status: string;
  linked_work_orders: string[];
  linked_customer_orders: string[];
}

export interface EvidenceSourceItem {
  title: string;
  url: string;
  publisher?: string;
  published_at?: string;
  snippet?: string;
  relevance?: number;
}

export interface SignalSearchResponse {
  search_id: string;
  entity: { type: string; id: string };
  query: string;
  source: { tier: string; label: string; searched_at: string; confidence: number };
  article: { title: string; source: string; date: string; snippet: string; url: string } | null;
  sources?: EvidenceSourceItem[];
  parsed_signal: {
    event_name: string;
    disruption_type: string;
    location: string;
    severity: string;
    delay_days: number;
    headline: string;
    source_url: string;
    summary: string;
  } | null;
  resolution: {
    matched: boolean;
    shipment_id: string | null;
    po_id: string | null;
    work_orders: string[];
    customer_orders: string[];
  };
  status: string;
  incident_id: string | null;
  dossier: Dossier | null;
  trace: string[];
  error?: string;
}

export type SignalSearchMode = 'live_with_fallback' | 'live' | 'cache' | 'demo';

export interface InvestigationRecord {
  search_id: string;
  entity_type: string;
  entity_id: string;
  query: string;
  mode: string;
  source_tier: string;
  searched_at: string;
  result_count: number;
  parsed_signal_status: string;
  resolution_status: string;
  final_outcome: string;
  retry_count: number;
}

export interface IncidentSummary {
  incident_id: string;
  severity: string;
  title: string;
  location: string;
  hero_material: string;
  on_hand_qty: number;
  tts_days: number;
  origin: string;
  destination: string;
  stockout_date: string;
  revised_eta: string;
  baseline_gap_days: number;
  disruption_delay_days: number;
  total_gap_days: number;
  otif_risk_usd: number;
  customer_impacted: string;
  so_due_date: string;
  status: string;
  owner: string;
  governance_rule: string;
  recommended_supplier: string | null;
  recommended_location: string | null;
}

export interface RuleEval {
  pass: boolean;
  value: string;
  threshold: string;
  reason: string;
  warning?: boolean;
}

export interface OptionItem {
  option_id: string;
  option_type: string;
  category_label: string;
  supplier_name: string;
  location: string;
  freight_mode: string;
  lead_time_days: number;
  arrival_date: string;
  residual_gap_days: number;
  estimated_cost_usd: number;
  status: string;
  hard_vetoes: string[];
  requires_vp_approval: boolean;
  rules: Record<string, RuleEval>;
  description: string;
}

export interface DependencyChain {
  supplier_name: string;
  shipment_id: string;
  po_id: string;
  component_id: string;
  component_name: string;
  subassembly_id: string;
  finished_product_id: string;
  work_order_id: string;
  customer_order_id: string;
  customer_name: string;
  so_due_date: string;
  chain_summary: string;
}

export interface Dossier {
  incident_id: string;
  as_of: string;
  impact_status?: 'SHORTAGE' | 'ABSORBED' | 'UNSUPPORTED';
  dependency_chain?: DependencyChain;
  disruption: {
    event_name: string;
    location: string;
    severity: string;
    vessel_name: string;
    shipment_id: string;
    po_id: string;
    material_id: string;
    material_name: string;
    supplier_name: string;
    simulated_delay_days: number;
    original_eta: string;
    revised_eta: string;
  };
  operational_context: {
    shipment_quantity: number;
    origin: string;
    destination: string;
    finished_material_id: string;
    planned_production_quantity: number;
    unit_price_usd: number;
    production_line: string;
    frozen_until: string;
    source_reference: string;
  };
  attribution_math: {
    on_hand_qty: number;
    daily_burn_rate: number;
    tts_days: number;
    tts_formula: string;
    stockout_date: string;
    planned_arrival_date: string;
    baseline_gap_days: number;
    baseline_explanation: string;
    disruption_delay_days: number;
    total_shortage_gap_days: number;
    gap_equation: string;
  };
  verifiable_exposure: {
    work_order_id: string;
    wo_planned_start: string;
    wo_planned_end: string;
    wo_duration_days: number;
    customer_order_id: string;
    customer_name: string;
    so_due_date: string;
    delayed_completion_date: string;
    days_past_sla: number;
    otif_exposure_usd: number;
    proof_narrative: string;
  };
  recovery_options_matrix: OptionItem[];
  executive_summary: {
    recommended_option_id: string | null;
    recommended_supplier: string | null;
    expedite_cost_usd: number;
    penalty_avoided_usd: number;
    net_value_saved_usd: number;
    roi_ratio: number;
    residual_gap_days: number;
    approval_required: boolean;
    approval_authority: string;
    recommendation_reasons?: string[];
    severity_explanation?: string;
  };
}

export interface EvidencePayload {
  incident_id: string;
  search_id?: string;
  source_tier: string;
  source_label: string;
  query: string;
  detected_at: string;
  article: { title: string; source: string; date: string; snippet: string; url: string };
  sources?: EvidenceSourceItem[];
  facts?: Array<{ claim: string; source_index?: number }>;
  inferences?: Array<{ claim: string; reason?: string }>;
  confidence: number;
  extracted_delay_days: number;
  entity_resolution: string[];
  ais: Record<string, string>;
  audit_trail: DecisionRecord[];
}

export interface DecisionRecord {
  decision_id: string;
  incident_id: string;
  option_id: string;
  action: string;
  po_number: string | null;
  approver_role: string;
  timestamp: string;
  notes: string;
  status: string;
  po_payload?: {
    po_number: string;
    supplier: string;
    material_id: string;
    quantity: number;
    freight_mode: string;
    est_arrival: string;
    authorized_cost_usd: number;
    cost_center: string;
    authorized_by: string;
  } | null;
}

export interface SimulationResponse {
  dossier: Dossier;
  timeline_series: Array<{
    day: number;
    date: string;
    unmitigated_stock: number;
    eurocoils_stock: number;
    is_shortage: boolean;
    is_residual_gap: boolean;
  }>;
}
