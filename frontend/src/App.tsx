import React, { useState, useEffect } from 'react';
import { 
  AlertTriangle, Shield, CheckCircle2, XCircle, Clock, 
  Layers, ChevronRight, Info, Anchor, DollarSign, Calendar,
  FileText, ExternalLink, Sliders, UserCheck, X, Check, ArrowRight
} from 'lucide-react';

interface RuleEval {
  pass: boolean;
  value: string;
  threshold: string;
  reason: string;
  warning?: boolean;
}

interface OptionItem {
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

interface Dossier {
  incident_id: string;
  as_of: string;
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
    recommended_option_id: string;
    recommended_supplier: string;
    expedite_cost_usd: number;
    penalty_avoided_usd: number;
    net_value_saved_usd: number;
    roi_ratio: number;
    residual_gap_days: number;
    approval_required: boolean;
    approval_authority: string;
  };
}

export default function App() {
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [delaySlider, setDelaySlider] = useState<number>(7);
  const [selectedOptionId, setSelectedOptionId] = useState<string>('OPT-A');
  const [userRole, setUserRole] = useState<'PLANNER' | 'VP'>('VP');
  const [activeFormulaModal, setActiveFormulaModal] = useState<string | null>(null);
  const [showEvidenceDrawer, setShowEvidenceDrawer] = useState<boolean>(false);
  const [evidenceTab, setEvidenceTab] = useState<'SERP' | 'AIS' | 'AUDIT'>('SERP');
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [decisionExecuted, setDecisionExecuted] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Load initial incident dossier
  useEffect(() => {
    fetch('/api/incidents/INC-2026-PORT-KLANG-01')
      .then(res => res.json())
      .then(data => {
        setDossier(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('API error:', err);
        setLoading(false);
      });
  }, []);

  // What-If Simulation on Slider Change
  const handleSliderChange = (newDelay: number) => {
    setDelaySlider(newDelay);
    fetch('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delay_days: newDelay, as_of: '2026-10-03' })
    })
      .then(res => res.json())
      .then(data => {
        if (data.dossier) setDossier(data.dossier);
      })
      .catch(err => console.error('Simulate error:', err));
  };

  // Authorize decision
  const handleAuthorize = (action: 'APPROVE' | 'ESCALATE' | 'DECLINE') => {
    fetch('/api/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        incident_id: 'INC-2026-PORT-KLANG-01',
        option_id: selectedOptionId,
        action: action,
        approver_role: userRole === 'VP' ? 'VP Supply Chain' : 'Senior Planner'
      })
    })
      .then(res => res.json())
      .then(data => {
        setDecisionExecuted(data);
        setShowConfirmModal(false);
      });
  };

  if (loading || !dossier) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f8fafc] text-slate-600 font-mono text-xs">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 rounded-full border-2 border-slate-900 border-t-transparent animate-spin"></div>
          Connecting to enterprise decision engine...
        </div>
      </div>
    );
  }

  const selectedOpt = dossier.recovery_options_matrix.find(o => o.option_id === selectedOptionId) || dossier.recovery_options_matrix[0];

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans text-xs pb-16">
      
      {/* 1. OFFICIAL TOP NAVIGATION */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-between">
          
          {/* Brand & Stepper */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center font-bold text-white text-sm font-mono shadow-sm">
                ⬡
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-slate-900 tracking-tight">ApexX Enterprise</span>
                  <span className="text-slate-400 font-normal">/</span>
                  <span className="text-xs font-semibold text-slate-700">Disruption Control Tower</span>
                </div>
                <p className="text-[11px] text-slate-500">Autonomous Supply Chain Resolution Engine</p>
              </div>
            </div>

            {/* Stepper Status */}
            <div className="hidden xl:flex items-center gap-2 text-[11px] border-l border-slate-200 pl-5 font-medium">
              <span className="flex items-center gap-1 text-emerald-700">
                <Check className="w-3.5 h-3.5 text-emerald-600 stroke-[3]" /> Detected
              </span>
              <span className="text-slate-300">→</span>
              <span className="flex items-center gap-1 text-emerald-700">
                <Check className="w-3.5 h-3.5 text-emerald-600 stroke-[3]" /> Assessed
              </span>
              <span className="text-slate-300">→</span>
              <span className="flex items-center gap-1 text-emerald-700">
                <Check className="w-3.5 h-3.5 text-emerald-600 stroke-[3]" /> Options Formulated
              </span>
              <span className="text-slate-300">→</span>
              <span className={`px-2 py-0.5 rounded font-semibold text-[11px] ${
                decisionExecuted ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800 border border-amber-200'
              }`}>
                {decisionExecuted ? 'Executed ✓' : 'Awaiting VP Sign-Off'}
              </span>
            </div>
          </div>

          {/* Right Clock & Role Controls */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-slate-100 border border-slate-200 text-[11px] text-slate-600 font-mono">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              <span>DATA AS OF: <strong className="text-slate-900">2026-10-03 08:00 UTC</strong></span>
            </div>

            {/* Role Switcher */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200">
              <button 
                onClick={() => setUserRole('PLANNER')} 
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition ${
                  userRole === 'PLANNER' ? 'bg-white text-slate-900 shadow-sm font-semibold' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Planner View
              </button>
              <button 
                onClick={() => setUserRole('VP')} 
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition ${
                  userRole === 'VP' ? 'bg-slate-900 text-white shadow-sm font-semibold' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                VP Approver View
              </button>
            </div>

            <button 
              onClick={() => setShowEvidenceDrawer(true)} 
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 text-xs font-medium hover:bg-slate-50 transition shadow-sm"
            >
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              <span>Evidence Drawer</span>
            </button>
          </div>

        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="max-w-7xl mx-auto px-4 pt-4 space-y-4">
        
        {/* 2. OFFICIAL CRITICAL DISRUPTION BANNER */}
        <div className="bg-white border-l-4 border-l-rose-500 border border-slate-200 rounded-lg p-3.5 shadow-sm flex items-center justify-between">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 shrink-0 mt-0.5">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold font-mono bg-rose-100 text-rose-800 border border-rose-200">
                  INC-2026-PORT-KLANG-01
                </span>
                <span className="font-semibold text-slate-900 text-xs">
                  {dossier.disruption.event_name}
                </span>
                <span className="text-slate-400">•</span>
                <span className="text-[11px] text-slate-500 font-mono">Location: {dossier.disruption.location}</span>
              </div>
              <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                Component <strong className="text-slate-900 font-mono">STCOIL-440V</strong> delayed on vessel <strong className="text-slate-900">{dossier.disruption.vessel_name}</strong> (Shipment {dossier.disruption.shipment_id}, PO {dossier.disruption.po_id}). 
                Stockout begins <strong className="text-slate-900">{dossier.attribution_math.stockout_date}</strong>. Pre-existing 3-day baseline buffer deficit combined with +7-day storm delay creates a <strong className="text-rose-700 font-semibold">10-day net shortage gap</strong>.
              </p>
            </div>
          </div>

          <div className="text-right shrink-0 pl-6 border-l border-slate-200 font-mono">
            <span className="text-[10px] text-slate-500 uppercase block font-sans font-medium">Customer Exposure</span>
            <span className="text-base font-bold text-rose-700">$120,000.00</span>
            <span className="text-[11px] text-slate-600 block">SO-55102 (ACME Corp)</span>
          </div>
        </div>

        {/* 3. 4 VERIFIED KPI CARDS WITH EXPANDABLE FORMULA PROOFS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          
          {/* Tile 1: Stockout Date */}
          <div 
            onClick={() => setActiveFormulaModal('STOCKOUT')}
            className="bg-white border border-slate-200 rounded-lg p-3.5 hover:border-slate-300 transition cursor-pointer shadow-sm group"
          >
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-[11px] font-medium">Stockout Date (TTS)</span>
              <Info className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-700 transition" />
            </div>
            <div className="text-lg font-bold text-slate-900 font-mono">
              {dossier.attribution_math.stockout_date}
            </div>
            <div className="text-[11px] text-slate-600 font-mono mt-1 flex items-center justify-between">
              <span>TTS: {dossier.attribution_math.tts_days.toFixed(1)} Days</span>
              <span className="text-blue-600 text-[10px] hover:underline font-sans">Formula Proof →</span>
            </div>
          </div>

          {/* Tile 2: Revised Arrival */}
          <div 
            onClick={() => setActiveFormulaModal('REVISED_ETA')}
            className="bg-white border border-slate-200 rounded-lg p-3.5 hover:border-slate-300 transition cursor-pointer shadow-sm group"
          >
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-[11px] font-medium">Revised Arrival (TTR)</span>
              <Info className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-700 transition" />
            </div>
            <div className="text-lg font-bold text-slate-900 font-mono">
              {dossier.disruption.revised_eta}
            </div>
            <div className="text-[11px] text-slate-600 font-mono mt-1 flex items-center justify-between">
              <span>+{dossier.disruption.simulated_delay_days}d Disruption Delay</span>
              <span className="text-blue-600 text-[10px] hover:underline font-sans">Formula Proof →</span>
            </div>
          </div>

          {/* Tile 3: Net Gap Attribution */}
          <div 
            onClick={() => setActiveFormulaModal('GAP_ATTRIBUTION')}
            className="bg-white border border-slate-200 rounded-lg p-3.5 hover:border-slate-300 transition cursor-pointer shadow-sm group"
          >
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-[11px] font-medium">Net Shortage Gap</span>
              <Info className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-700 transition" />
            </div>
            <div className="text-lg font-bold text-rose-600 font-mono">
              {dossier.attribution_math.total_shortage_gap_days} Days Net
            </div>
            <div className="text-[11px] text-slate-600 font-mono mt-1 flex items-center justify-between">
              <span>{dossier.attribution_math.baseline_gap_days}d Base + {dossier.attribution_math.disruption_delay_days}d Storm</span>
              <span className="text-blue-600 text-[10px] hover:underline font-sans">Attribution →</span>
            </div>
          </div>

          {/* Tile 4: Verifiable OTIF Exposure */}
          <div 
            onClick={() => setActiveFormulaModal('EXPOSURE')}
            className="bg-white border border-slate-200 rounded-lg p-3.5 hover:border-slate-300 transition cursor-pointer shadow-sm group"
          >
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-[11px] font-medium">Revenue / OTIF at Risk</span>
              <Info className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-700 transition" />
            </div>
            <div className="text-lg font-bold text-slate-900 font-mono">
              ${dossier.verifiable_exposure.otif_exposure_usd.toLocaleString()}.00
            </div>
            <div className="text-[11px] text-slate-600 font-mono mt-1 flex items-center justify-between">
              <span>SLA: {dossier.verifiable_exposure.so_due_date} (ACME)</span>
              <span className="text-blue-600 text-[10px] hover:underline font-sans">Audit Proof →</span>
            </div>
          </div>

        </div>

        {/* 4. WORKSPACE: CENTER CHART & RIGHT MATRIX */}
        <div className="grid grid-cols-12 gap-4">
          
          {/* CENTER: Depletion Timeline & Digital Twin Simulator (7 cols) */}
          <div className="col-span-12 lg:col-span-7 space-y-4">
            
            <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider font-mono flex items-center gap-2">
                    <Sliders className="w-3.5 h-3.5 text-slate-700" />
                    Digital Twin: Inventory Depletion &amp; Residual Gap Curve
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Separates pre-existing planning deficit, disruption gap, and Option A residual coverage
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-100 text-slate-700 border border-slate-200 font-semibold">
                  SIMULATED: +{delaySlider}d DELAY
                </span>
              </div>

              {/* Slider Control */}
              <div className="bg-slate-50 p-2.5 rounded border border-slate-200 mb-4">
                <div className="flex justify-between text-[11px] text-slate-600 font-mono mb-1.5 font-medium">
                  <span>0d (On-Time Baseline)</span>
                  <span className="text-slate-900 font-bold">Simulate Delay: +{delaySlider} Days</span>
                  <span>20d (Severe Congestion)</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="20" 
                  value={delaySlider}
                  onChange={(e) => handleSliderChange(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-slate-200 rounded appearance-none cursor-pointer accent-slate-900"
                />
              </div>

              {/* SVG Depletion Chart */}
              <div className="h-56 w-full bg-[#f8fafc] rounded border border-slate-200 p-3 relative">
                <svg className="w-full h-full" viewBox="0 0 550 180" fill="none">
                  {/* Gridlines */}
                  <line x1="45" y1="30" x2="530" y2="30" stroke="#e2e8f0" strokeWidth="1"/>
                  <line x1="45" y1="80" x2="530" y2="80" stroke="#e2e8f0" strokeWidth="1"/>
                  <line x1="45" y1="130" x2="530" y2="130" stroke="#e2e8f0" strokeWidth="1"/>

                  {/* Y Axis Labels */}
                  <text x="5" y="34" fill="#64748b" fontSize="9" fontFamily="monospace">400 ea</text>
                  <text x="5" y="84" fill="#64748b" fontSize="9" fontFamily="monospace">200 ea</text>
                  <text x="5" y="134" fill="#64748b" fontSize="9" fontFamily="monospace">0 ea</text>

                  {/* Shading 1: Baseline Gap (Oct 8 to Oct 11 = 3 days) */}
                  <rect x="140" y="30" width="60" height="100" fill="#fef3c7" stroke="#f59e0b" strokeWidth="1" strokeDasharray="2 2"/>
                  <text x="145" y="55" fill="#b45309" fontSize="8" fontFamily="monospace" fontWeight="bold">BASELINE DEFICIT</text>
                  <text x="145" y="67" fill="#b45309" fontSize="8" fontFamily="monospace">3 Days</text>

                  {/* Shading 2: Disruption Gap (Oct 11 to Revised ETA) */}
                  <rect x="200" y="30" width={delaySlider * 15} height="100" fill="#fee2e2" stroke="#ef4444" strokeWidth="1" strokeDasharray="3 3"/>
                  <text x="210" y="90" fill="#b91c1c" fontSize="8" fontFamily="monospace" fontWeight="bold">DISRUPTION GAP</text>
                  <text x="210" y="102" fill="#b91c1c" fontSize="8" fontFamily="monospace">+{delaySlider} Days</text>

                  {/* Option A Residual Gap Overlay (Oct 8 to Oct 13 = 5 days) */}
                  {selectedOpt.option_id === 'OPT-A' && (
                    <g>
                      <rect x="140" y="30" width="100" height="100" fill="#dcfce7" fillOpacity="0.6" stroke="#16a34a" strokeWidth="1.5" strokeDasharray="4 2"/>
                      <text x="150" y="120" fill="#15803d" fontSize="8" fontFamily="monospace" fontWeight="bold">RESIDUAL GAP (5d)</text>
                    </g>
                  )}

                  {/* Depletion Curve Slope (Oct 3: 400 -> Oct 8: 0) */}
                  <path d="M 45,30 L 140,130 L 530,130" stroke="#0f172a" strokeWidth="2.5"/>
                  <circle cx="45" cy="30" r="3.5" fill="#0f172a"/>
                  <circle cx="140" cy="130" r="3.5" fill="#dc2626"/>

                  {/* Replenishment Inflow Spike at Revised ETA */}
                  <path d={`M ${200 + delaySlider * 15},130 L ${200 + delaySlider * 15},40 L ${320 + delaySlider * 15},50`} stroke="#64748b" strokeWidth="2" strokeDasharray="3 3"/>
                  <circle cx={200 + delaySlider * 15} cy="130" r="3.5" fill="#64748b"/>

                  {/* EuroCoils Inflow Spike at Oct 13 */}
                  {selectedOpt.option_id === 'OPT-A' && (
                    <g>
                      <path d="M 240,130 L 240,40 L 400,60" stroke="#16a34a" strokeWidth="2.5"/>
                      <circle cx="240" cy="130" r="4" fill="#16a34a"/>
                      <text x="245" y="45" fill="#15803d" fontSize="8" fontFamily="monospace" fontWeight="bold">EuroCoils Air Arrival (Oct 13)</text>
                    </g>
                  )}

                  {/* X Axis Time Labels */}
                  <text x="40" y="150" fill="#64748b" fontSize="9" fontFamily="monospace">Oct 03 (Ref)</text>
                  <text x="120" y="150" fill="#dc2626" fontSize="9" fontFamily="monospace">Stockout (Oct 08)</text>
                  <text x="190" y="150" fill="#b45309" fontSize="9" fontFamily="monospace">Planned (Oct 11)</text>
                  <text x={190 + delaySlider * 15} y="165" fill="#b91c1c" fontSize="9" fontFamily="monospace">Revised ({dossier.disruption.revised_eta})</text>
                </svg>
              </div>

              {/* Ontology Lineage Chain with Date Pegging */}
              <div className="mt-3 pt-3 border-t border-slate-200">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono mb-2">
                  Ontology Pegging Chain (Date-Tagged Nodes)
                </div>
                <div className="grid grid-cols-4 gap-2 text-[11px] font-mono">
                  <div className="bg-slate-50 p-2 rounded border border-slate-200">
                    <span className="text-slate-500 block text-[10px]">1. Shipment</span>
                    <span className="text-slate-900 font-bold block mt-0.5">SHIP-7010</span>
                    <span className="text-amber-700 text-[10px] block mt-0.5">ETA: {dossier.disruption.revised_eta}</span>
                  </div>
                  <div className="bg-slate-50 p-2 rounded border border-slate-200">
                    <span className="text-slate-500 block text-[10px]">2. Material</span>
                    <span className="text-blue-700 font-bold block mt-0.5">STCOIL-440V</span>
                    <span className="text-rose-700 text-[10px] block mt-0.5">Stockout: {dossier.attribution_math.stockout_date}</span>
                  </div>
                  <div className="bg-slate-50 p-2 rounded border border-slate-200">
                    <span className="text-slate-500 block text-[10px]">3. Work Order</span>
                    <span className="text-slate-900 font-bold block mt-0.5">WO-7782</span>
                    <span className="text-slate-600 text-[10px] block mt-0.5">Start: {dossier.verifiable_exposure.wo_planned_start} (3d)</span>
                  </div>
                  <div className="bg-slate-50 p-2 rounded border border-rose-200 bg-rose-50/40">
                    <span className="text-slate-500 block text-[10px]">4. Customer Order</span>
                    <span className="text-rose-900 font-bold block mt-0.5">SO-55102 (ACME)</span>
                    <span className="text-rose-700 text-[10px] block mt-0.5">Due: {dossier.verifiable_exposure.so_due_date}</span>
                  </div>
                </div>
              </div>

            </div>

          </div>

          {/* RIGHT: True C1-C8 Constraint Matrix Table (5 cols) */}
          <div className="col-span-12 lg:col-span-5 space-y-4">
            
            <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider font-mono">
                    Constraint Matrix (C1–C8)
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Options as rows • Hard deterministic rules C1–C8 as columns
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold">
                  1 Feasible Survivor
                </span>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] font-mono border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 text-[10px] bg-slate-50">
                      <th className="py-2 px-1 text-left font-semibold">OPTION</th>
                      <th className="py-2 px-1 text-center">MODE</th>
                      <th className="py-2 px-1 text-center" title="C1: Lead Time <= Revised ETA">C1</th>
                      <th className="py-2 px-1 text-center" title="C2: Minimum Order Qty">C2</th>
                      <th className="py-2 px-1 text-center" title="C3: PPAP Certification">C3</th>
                      <th className="py-2 px-1 text-center" title="C4: Frozen Schedule">C4</th>
                      <th className="py-2 px-1 text-center" title="C5: Budget >$30k VP Gate">C5</th>
                      <th className="py-2 px-1 text-center" title="C6: BOM Revision D">C6</th>
                      <th className="py-2 px-1 text-center" title="C7: Export/Customs">C7</th>
                      <th className="py-2 px-1 text-center" title="C8: Capacity">C8</th>
                      <th className="py-2 px-1 text-right">COST</th>
                      <th className="py-2 px-1 text-right">STATUS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dossier.recovery_options_matrix.map(opt => {
                      const isSelected = selectedOptionId === opt.option_id;
                      const isPass = opt.status === 'PASS' || opt.status === 'PASS_WITH_WARNING';
                      return (
                        <tr 
                          key={opt.option_id}
                          onClick={() => setSelectedOptionId(opt.option_id)}
                          className={`cursor-pointer transition ${
                            isSelected ? 'bg-blue-50/60 font-semibold' : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="py-2 px-1 font-bold text-slate-900">
                            <div className="flex items-center gap-1.5">
                              <span className={`w-1.5 h-1.5 rounded-full ${isPass ? 'bg-emerald-600' : 'bg-rose-500'}`}></span>
                              {opt.option_id}
                            </div>
                            <span className="text-[10px] text-slate-500 font-normal block">{opt.supplier_name.split(' ')[0]}</span>
                          </td>
                          <td className="py-2 px-1 text-center text-slate-600 text-[10px]">{opt.freight_mode}</td>
                          
                          {/* Rules C1-C8 Status Badges */}
                          {['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'].map(cid => {
                            const r = opt.rules[cid];
                            if (cid === 'C5') {
                              return (
                                <td key={cid} className="py-2 px-1 text-center" title={r.reason}>
                                  {r.warning ? <span className="text-amber-600 font-bold">⚠️</span> : <span className="text-emerald-600 font-bold">✓</span>}
                                </td>
                              );
                            }
                            return (
                              <td key={cid} className="py-2 px-1 text-center" title={r.reason}>
                                {r.pass ? <span className="text-emerald-600 font-bold">✓</span> : <span className="text-rose-600 font-bold">✗</span>}
                              </td>
                            );
                          })}

                          <td className="py-2 px-1 text-right font-bold text-slate-900">
                            ${(opt.estimated_cost_usd / 1000).toFixed(1)}k
                          </td>
                          <td className="py-2 px-1 text-right">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              isPass ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                            }`}>
                              {isPass ? 'SURVIVOR' : 'VETOED'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Selected Option Detail Panel */}
              <div className="mt-3 p-3 bg-slate-50 rounded border border-slate-200">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-xs text-slate-900">
                    {selectedOpt.option_id}: {selectedOpt.supplier_name}
                  </span>
                  <span className="text-slate-700 font-mono text-[11px] font-semibold">
                    Arrival: {selectedOpt.arrival_date}
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 mb-2 leading-relaxed">{selectedOpt.description}</p>
                
                {/* Residual Shortage Notice */}
                <div className="text-[11px] font-mono flex items-center justify-between text-slate-600 border-t border-slate-200 pt-2">
                  <span>Residual Shortage Gap:</span>
                  <strong className={selectedOpt.residual_gap_days > 0 ? "text-amber-800 font-bold" : "text-emerald-700"}>
                    {selectedOpt.residual_gap_days} Days Uncovered
                  </strong>
                </div>

                {/* Veto details if vetoed */}
                {selectedOpt.hard_vetoes.length > 0 && (
                  <div className="mt-2 p-2 rounded bg-rose-50 border border-rose-200 text-[11px] text-rose-800 font-mono space-y-1">
                    {selectedOpt.hard_vetoes.map(v => (
                      <div key={v} className="flex items-start gap-1">
                        <span>❌</span>
                        <span>{selectedOpt.rules[v].reason}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>

          </div>

        </div>

      </main>

      {/* 5. STICKY BOTTOM ROLE-AWARE DECISION BAR */}
      <footer className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 shadow-xl py-3">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-900 font-bold font-mono text-sm">
              ⚖
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs text-slate-900 font-mono">
                  ACTION: AUTHORIZE OPT-A (EuroCoils GmbH Air Freight)
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-100 text-amber-800 border border-amber-200 font-semibold">
                  Rule C5: Requires VP Supply Chain Approval
                </span>
              </div>
              <p className="text-[11px] text-slate-600 mt-0.5">
                Cost: <strong className="text-slate-900 font-mono">$30,150.00</strong> • 
                Penalty Avoided: <strong className="text-emerald-700 font-mono">$120,000.00</strong> (SO-55102, ACME) • 
                Net Value Saved: <strong className="text-emerald-700 font-mono">+$89,850.00</strong>
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button 
              onClick={() => handleAuthorize('DECLINE')}
              className="px-3.5 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              Decline
            </button>
            
            <button 
              onClick={() => handleAuthorize('ESCALATE')}
              className="px-3.5 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 transition font-mono"
            >
              Escalate to S&amp;OE Board
            </button>

            {userRole === 'VP' ? (
              <button 
                onClick={() => setShowConfirmModal(true)}
                className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition shadow-sm flex items-center gap-2 font-mono"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                Approve &amp; Issue PO
              </button>
            ) : (
              <button 
                onClick={() => alert("Notification sent to VP Supply Chain for Rule C5 sign-off.")}
                className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition shadow-sm flex items-center gap-2 font-mono"
              >
                <UserCheck className="w-4 h-4 text-blue-400" />
                Request VP Approval
              </button>
            )}
          </div>
        </div>
      </footer>

      {/* FORMULA MODAL */}
      {activeFormulaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 max-w-lg w-full shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-3">
              <span className="font-bold text-xs text-slate-900 uppercase tracking-wider font-mono">
                Verifiable Arithmetic Proof
              </span>
              <button onClick={() => setActiveFormulaModal(null)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            {activeFormulaModal === 'STOCKOUT' && (
              <div className="space-y-3 text-xs">
                <h4 className="font-bold text-slate-900 font-mono">Time-To-Survive (TTS) Calculation:</h4>
                <div className="bg-slate-50 p-3 rounded border border-slate-200 text-slate-900 font-mono font-semibold">
                  {dossier.attribution_math.tts_formula}
                </div>
                <p className="text-slate-600 leading-relaxed">
                  On-hand inventory at reference date (2026-10-03) is 400 coils. At 80 coils/day burn rate (40 drives/day × 2 coils/drive), the plant exhausts inventory exactly on Day 5 (2026-10-08).
                </p>
              </div>
            )}

            {activeFormulaModal === 'GAP_ATTRIBUTION' && (
              <div className="space-y-3 text-xs">
                <h4 className="font-bold text-slate-900 font-mono">Honest Gap Attribution Proof:</h4>
                <div className="bg-slate-50 p-3 rounded border border-slate-200 text-rose-700 font-mono font-semibold">
                  {dossier.attribution_math.gap_equation}
                </div>
                <p className="text-slate-600 leading-relaxed">
                  {dossier.attribution_math.baseline_explanation}. The storm is responsible for 7 days of delay, while pre-existing planning was already short by 3 days.
                </p>
              </div>
            )}

            {activeFormulaModal === 'EXPOSURE' && (
              <div className="space-y-3 text-xs">
                <h4 className="font-bold text-slate-900 font-mono">Verifiable Customer Penalty Proof:</h4>
                <div className="bg-slate-50 p-3 rounded border border-slate-200 text-rose-700 font-mono font-semibold">
                  500 Units × $240 Unit Price = $120,000 OTIF Exposure
                </div>
                <p className="text-slate-600 leading-relaxed">
                  {dossier.verifiable_exposure.proof_narrative}
                </p>
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-slate-200 text-right">
              <button 
                onClick={() => setActiveFormulaModal(null)}
                className="px-4 py-1.5 rounded bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition"
              >
                Close Proof
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRMATION PURCHASE ORDER MODAL */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 max-w-md w-full shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-3">
              <span className="font-bold text-xs text-slate-900 uppercase tracking-wider flex items-center gap-2 font-mono">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Confirm Emergency Expedite PO
              </span>
              <button onClick={() => setShowConfirmModal(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs text-slate-600 font-mono">
              <div className="flex justify-between py-1 border-b border-slate-100"><span className="text-slate-500">Supplier:</span> <span className="text-slate-900 font-bold">EuroCoils GmbH (Stuttgart)</span></div>
              <div className="flex justify-between py-1 border-b border-slate-100"><span className="text-slate-500">Material:</span> <span className="text-slate-900 font-bold">STCOIL-440V (900 Units)</span></div>
              <div className="flex justify-between py-1 border-b border-slate-100"><span className="text-slate-500">Freight Mode:</span> <span className="text-slate-900 font-bold">AIR_EXPEDITE (Pre-Cleared)</span></div>
              <div className="flex justify-between py-1 border-b border-slate-100"><span className="text-slate-500">Arrival Date:</span> <span className="text-emerald-700 font-bold">2026-10-13 (Bridges Gap)</span></div>
              <div className="flex justify-between py-1 border-b border-slate-100"><span className="text-slate-500">Authorized Spend:</span> <span className="text-slate-900 font-bold">$30,150.00</span></div>
              <div className="flex justify-between py-1 border-b border-slate-100"><span className="text-slate-500">Cost Center:</span> <span className="text-slate-700">CC-APEX-SUPPLY-CHAIN</span></div>
              <div className="flex justify-between py-1"><span className="text-slate-500">Governance:</span> <span className="text-amber-800 font-semibold">VP Supply Chain Sign-Off</span></div>
            </div>

            <div className="mt-5 flex gap-2 justify-end">
              <button 
                onClick={() => setShowConfirmModal(false)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button 
                onClick={() => handleAuthorize('APPROVE')}
                className="px-4 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow"
              >
                Confirm &amp; Issue PO
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EVIDENCE DRAWER */}
      {showEvidenceDrawer && (
        <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-white border-l border-slate-200 p-5 shadow-2xl flex flex-col font-sans">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
            <span className="font-bold text-xs text-slate-900 uppercase tracking-wider flex items-center gap-2 font-mono">
              <Layers className="w-4 h-4 text-slate-600" /> Evidence &amp; Intelligence Drawer
            </span>
            <button onClick={() => setShowEvidenceDrawer(false)} className="text-slate-400 hover:text-slate-700">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex gap-2 mb-4 border-b border-slate-200 pb-2">
            <button 
              onClick={() => setEvidenceTab('SERP')} 
              className={`px-3 py-1 rounded text-xs font-semibold ${
                evidenceTab === 'SERP' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              SerpAPI Signal
            </button>
            <button 
              onClick={() => setEvidenceTab('AIS')} 
              className={`px-3 py-1 rounded text-xs font-semibold ${
                evidenceTab === 'AIS' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Vessel AIS
            </button>
            <button 
              onClick={() => setEvidenceTab('AUDIT')} 
              className={`px-3 py-1 rounded text-xs font-semibold ${
                evidenceTab === 'AUDIT' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Audit Ledger
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 text-xs">
            {evidenceTab === 'SERP' && (
              <div className="space-y-3">
                <div className="bg-slate-50 p-3 rounded border border-slate-200">
                  <span className="text-slate-500 text-[10px] block font-mono">Query:</span>
                  <span className="text-slate-900 font-mono font-semibold">Port Klang port disruption OR delay OR strike</span>
                </div>
                <div className="bg-slate-50 p-3 rounded border border-slate-200">
                  <span className="text-slate-500 text-[10px] block font-mono">Extracted Article Headline:</span>
                  <p className="text-slate-900 font-medium mt-1">"Asia port congestion worsens amid bad weather, vessel bunching"</p>
                  <span className="text-[10px] text-slate-500 block mt-1 font-mono">Source: Journal of Commerce (JOC) • Confidence: 0.94</span>
                </div>
              </div>
            )}

            {evidenceTab === 'AIS' && (
              <div className="bg-slate-50 p-3 rounded border border-slate-200 space-y-2 font-mono">
                <div className="flex justify-between"><span className="text-slate-500">Vessel MMSI:</span> <span className="text-slate-900 font-semibold">538009214</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Coordinates:</span> <span className="text-slate-900 font-semibold">02°59'N, 101°24'E</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Destination:</span> <span className="text-slate-900 font-semibold">Chennai (INMAA)</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Speed / Course:</span> <span className="text-slate-900 font-semibold">0.0 kts (Anchored off Klang)</span></div>
              </div>
            )}

            {evidenceTab === 'AUDIT' && (
              <div className="space-y-2">
                {decisionExecuted ? (
                  <div className="bg-emerald-50 p-3 rounded border border-emerald-200 text-emerald-900 font-mono">
                    <div className="font-bold">Action: {decisionExecuted.action}</div>
                    <div>PO Issued: {decisionExecuted.po_number}</div>
                    <div>Authorized By: {decisionExecuted.approver_role}</div>
                    <div className="text-[10px] text-slate-500 mt-1">{decisionExecuted.timestamp}</div>
                  </div>
                ) : (
                  <p className="text-slate-500 font-mono">No human authorizations recorded yet. Pending sign-off.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
