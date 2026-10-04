import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  AlertTriangle, Shield, CheckCircle2, XCircle, Clock,
  Layers, Info, DollarSign, Calendar, FileText,
  Sliders, UserCheck, X, Check, ArrowRight, ChevronRight,
  AlertCircle, Truck, BarChart2, ExternalLink, Download,
  RefreshCw, Zap, Lock, Eye, Building2, HelpCircle, Factory
} from 'lucide-react';

// ─── TYPES ─────────────────────────────────────────────────────────────────

type UserRole = 'PLANNER' | 'PLANT_LEAD' | 'VP' | 'AUDIT';
type AppScreen = 'GATEWAY' | 'WORKSPACE';
type FormulaKey = 'STOCKOUT' | 'REVISED_ETA' | 'GAP_ATTRIBUTION' | 'EXPOSURE' | null;

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

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

const RULE_METADATA: Record<string, { short: string; name: string; desc: string }> = {
  C1: { short: 'Lead Time', name: 'Supplier Lead Time', desc: 'Arrival date must bridge gap before revised ETA' },
  C2: { short: 'MOQ', name: 'Minimum Order Quantity', desc: 'Order qty must meet supplier MOQ' },
  C3: { short: 'PPAP', name: 'Quality / PPAP Certification', desc: 'Active PPAP Level 3 certification required for ApexX-100' },
  C4: { short: 'Frozen MPS', name: 'Frozen Schedule Window', desc: 'Rescheduling prohibited inside 14-day frozen planning fence' },
  C5: { short: 'Budget/VP', name: 'Approval Authority Gate', desc: 'Spend > $30,000 requires VP Global Supply Chain authorization' },
  C6: { short: 'BOM Rev', name: 'BOM Revision Compatibility', desc: 'Substitute part must strictly match active BOM REV-D' },
  C7: { short: 'Customs', name: 'Route / Export Clearance', desc: 'No export holds; pre-cleared customs corridor' },
  C8: { short: 'Capacity', name: 'Supplier Capacity', desc: 'Order qty must not exceed monthly manufacturing limit' },
};

const GLOSSARY: Record<string, string> = {
  TTS: 'Time-To-Survive: Days of on-hand inventory remaining at current burn rate before line-starvation',
  TTR: 'Time-To-Recover: Days until arrival of replacement components',
  OTIF: 'On-Time In-Full: Customer SLA contract delivery metric. Failure incurs liquidated damages',
  'S&OE': 'Sales & Operations Execution: Tactical short-horizon disruption management',
  PPAP: 'Production Part Approval Process: Automotive/aerospace standard verifying production quality',
  MPS: 'Master Production Schedule: Firm factory schedule frozen inside lead-time boundaries',
};

const PERSONA_CONFIG: Record<UserRole, { icon: string; label: string; sub: string; roleDesc: string }> = {
  PLANNER: {
    icon: '⚡',
    label: 'S&OE Supply Chain Planner',
    sub: 'Triage disruption · 3d+7d gap breakdown · What-if simulator',
    roleDesc: 'Tactical Planner Cockpit: Review sensor alerts, test buffer sensitivities, and recommend mitigation.',
  },
  PLANT_LEAD: {
    icon: '🏭',
    label: 'Plant Floor / Mfg Lead',
    sub: 'Line 2 protection · C4 frozen window · Work order pegging',
    roleDesc: 'Plant Operations: Protect Assembly Line 2 against component starvation and frozen window breaches.',
  },
  VP: {
    icon: '👑',
    label: 'VP Global Supply Chain',
    sub: 'Executive briefing · $30,150 vs $120k trade-off · C5 PO sign-off',
    roleDesc: 'Executive Approval Desk: Authorize emergency expedite spend under Rule C5 governance.',
  },
  AUDIT: {
    icon: '📋',
    label: 'Governance & Audit Desk',
    sub: 'C1–C8 full matrix · Deterministic rule citations · Audit ledger',
    roleDesc: 'Compliance & Audit: Interrogate deterministic rule citations and export immutable ledgers.',
  },
};

// ─── HELPERS ────────────────────────────────────────────────────────────────

const formatUSD = (val: number) => `$${Math.round(val).toLocaleString()}`;

const Spinner = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin inline-block text-slate-800">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.25" />
    <path d="M12 2 A10 10 0 0 1 22 12" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
  </svg>
);

const GlossaryTip = ({ term }: { term: string }) => (
  <span className="group relative inline-flex items-center ml-1 cursor-help">
    <HelpCircle size={12} className="text-slate-400 group-hover:text-slate-700 transition" />
    <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block w-56 rounded-md bg-slate-900 p-2 text-xs font-normal text-slate-100 shadow-xl z-50 leading-relaxed text-center">
      <strong className="text-white block font-semibold">{term}</strong>
      {GLOSSARY[term]}
    </span>
  </span>
);

// ─── GATEWAY SCREEN (50/50 SPLIT SHOWCASE) ──────────────────────────────────

const GatewayScreen = ({ onEnter }: { onEnter: (role: UserRole) => void }) => {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 font-sans">
      {/* ── LEFT: Dark Cinematic Showcase Panel ── */}
      <div className="relative flex w-1/2 flex-col justify-between p-10 lg:p-14 text-white overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border-r border-slate-800/80">
        
        {/* Subtle grid backdrop */}
        <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:28px_28px] opacity-40 pointer-events-none" />

        {/* Top Brand Bar */}
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 font-bold text-white shadow-lg shadow-blue-600/30">
              ⬡
            </div>
            <div>
              <div className="text-sm font-bold tracking-tight text-white">APEX ORCHESTRATOR</div>
              <div className="text-[11px] font-medium tracking-wider text-slate-400 uppercase">POD-TO-CASH SETTLEMENT ENGINE</div>
            </div>
          </div>
          <div className="flex items-center gap-5 text-xs font-semibold tracking-wider text-slate-400">
            <span className="text-white border-b-2 border-blue-500 pb-0.5">SENSORS</span>
            <span>PEGGING</span>
            <span>RESOLVE</span>
            <span>AUDIT</span>
          </div>
        </div>

        {/* Center Disruption Corridor Card & Hero Narrative */}
        <div className="relative z-10 my-auto space-y-6 max-w-xl">
          {/* Corridor Pill Card */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/80 backdrop-blur-md p-4 shadow-2xl">
            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-3">
              <span>Live Maritime Corridor</span>
              <span className="flex items-center gap-1.5 text-rose-400">
                <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" /> Disruption Alert
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 text-xs">
              <div className="space-y-0.5">
                <div className="font-bold text-slate-200">Port Klang, MY</div>
                <div className="text-[11px] text-slate-400 font-mono">MV Sentinel</div>
              </div>
              <div className="flex-1 flex flex-col items-center px-2">
                <span className="text-[11px] font-bold text-rose-400 mb-1">⚡ +7d Typhoon Squall</span>
                <div className="w-full h-0.5 bg-gradient-to-r from-rose-500 via-amber-500 to-emerald-500" />
              </div>
              <div className="space-y-0.5 text-right">
                <div className="font-bold text-slate-200">Plant Detroit / Chennai</div>
                <div className="text-[11px] text-emerald-400 font-mono">Line 2 (WO-7782)</div>
              </div>
            </div>
          </div>

          {/* Headline */}
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-300">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
              Autonomous S&OE Decision System
            </div>
            <h1 className="text-3xl lg:text-4xl font-extrabold tracking-tight text-white leading-tight">
              Disruption Orchestration <br />& Contract Protection
            </h1>
            <p className="text-sm lg:text-base text-slate-300 leading-relaxed max-w-lg">
              Real-time port intelligence to verifiable ERP recovery. Resolves line-starvation risk and protects $120,000 OTIF customer commitments.
            </p>
          </div>

          {/* 4 Feature Badges */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            {[
              { title: 'Live SerpAPI Sensors', desc: 'Real JOC maritime disruption feeds' },
              { title: 'Deterministic Attribution', desc: '3d baseline + 7d storm = 10d gap' },
              { title: 'C1–C8 Constraint Agent', desc: 'Strict multi-tier rule enforcement' },
              { title: '1-Click VP Sign-Off', desc: 'Rule C5 governance PO authorization' },
            ].map(f => (
              <div key={f.title} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <div className="text-xs font-bold text-white flex items-center justify-between">
                  <span>{f.title}</span>
                  <ArrowRight size={12} className="text-slate-500" />
                </div>
                <div className="text-[11px] text-slate-400 mt-1">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom Ground-Truth Metric Strip */}
        <div className="relative z-10 grid grid-cols-4 gap-4 border-t border-slate-800/90 pt-5 text-left font-mono">
          <div>
            <div className="text-xs font-medium text-slate-400 font-sans uppercase">On-Hand</div>
            <div className="text-lg lg:text-xl font-bold text-white mt-0.5">400 units</div>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-400 font-sans uppercase">Time-To-Survive</div>
            <div className="text-lg lg:text-xl font-bold text-amber-400 mt-0.5">5.0 Days</div>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-400 font-sans uppercase">Net Shortage</div>
            <div className="text-lg lg:text-xl font-bold text-rose-400 mt-0.5">10 Days</div>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-400 font-sans uppercase">OTIF Penalty</div>
            <div className="text-lg lg:text-xl font-bold text-rose-400 mt-0.5">$120,000</div>
          </div>
        </div>
      </div>

      {/* ── RIGHT: Role Gateway & Access Console ── */}
      <div className="flex w-1/2 flex-col justify-center bg-slate-50 px-10 lg:px-16 overflow-y-auto">
        <div className="mx-auto w-full max-w-md space-y-6">
          
          {/* Header */}
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-800 font-mono">
              <span className="h-2 w-2 rounded-full bg-rose-600" />
              INC-2026-PORT-KLANG-01 (ACTIVE)
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-950">
              Select Workspace Role
            </h2>
            <p className="text-sm text-slate-600">
              Choose an enterprise role to enter the live decision console:
            </p>
          </div>

          {/* Quick Role Presets Grid */}
          <div className="space-y-3">
            {(Object.entries(PERSONA_CONFIG) as [UserRole, typeof PERSONA_CONFIG.PLANNER][]).map(([role, cfg]) => (
              <button
                key={role}
                onClick={() => onEnter(role)}
                className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-slate-400 hover:shadow-md transition-all group flex items-center justify-between gap-4"
              >
                <div className="flex items-start gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-lg group-hover:bg-slate-900 group-hover:text-white transition">
                    {cfg.icon}
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition flex items-center gap-1.5">
                      {cfg.label}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                      {cfg.sub}
                    </div>
                  </div>
                </div>
                <ArrowRight size={16} className="text-slate-400 group-hover:text-slate-900 group-hover:translate-x-0.5 transition shrink-0" />
              </button>
            ))}
          </div>

          {/* Security & Provenance Badge */}
          <div className="flex items-center justify-between border-t border-slate-200 pt-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <Shield size={13} className="text-slate-400" /> Deterministic Engine Active
            </span>
            <span className="font-mono">Scenario Clock: 2026-10-03</span>
          </div>

        </div>
      </div>
    </div>
  );
};

// ─── SLIM ROLE-AWARE KPI STRIP ───────────────────────────────────────────────

const SlimKpiStrip = ({ dossier, role, onFormula }: { dossier: Dossier; role: UserRole; onFormula: (k: FormulaKey) => void }) => {
  if (role === 'AUDIT') {
    return (
      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs shadow-sm">
        <div className="flex items-center gap-4 text-slate-600">
          <span><strong className="text-slate-900">Incident:</strong> {dossier.incident_id}</span>
          <span className="text-slate-300">|</span>
          <span><strong className="text-slate-900">Rules Evaluated:</strong> C1 through C8</span>
          <span className="text-slate-300">|</span>
          <span><strong className="text-slate-900">Audit Status:</strong> Verifiable Ground Truth</span>
        </div>
        <div className="flex items-center gap-2 font-mono">
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
            1 Feasible Option
          </span>
          <span className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700 border border-rose-200">
            3 Vetoed
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {/* Tile 1: Stockout Date */}
      <button
        onClick={() => onFormula('STOCKOUT')}
        className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-left shadow-sm hover:border-slate-300 hover:shadow transition group"
      >
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Stockout Date <GlossaryTip term="TTS" />
          </div>
          <div className="text-base font-bold text-slate-900 font-mono mt-0.5">
            {dossier.attribution_math.stockout_date}
          </div>
          <div className="text-[11px] text-slate-500">
            TTS: {dossier.attribution_math.tts_days.toFixed(1)} Days ({dossier.attribution_math.on_hand_qty} on-hand)
          </div>
        </div>
        <ArrowRight size={14} className="text-slate-300 group-hover:text-blue-600 transition" />
      </button>

      {/* Tile 2: Revised ETA */}
      <button
        onClick={() => onFormula('REVISED_ETA')}
        className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-left shadow-sm hover:border-slate-300 hover:shadow transition group"
      >
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Revised Arrival <GlossaryTip term="TTR" />
          </div>
          <div className="text-base font-bold text-slate-900 font-mono mt-0.5">
            {dossier.disruption.revised_eta}
          </div>
          <div className="text-[11px] text-slate-500">
            +{dossier.disruption.simulated_delay_days}d storm delay (orig: {dossier.disruption.original_eta})
          </div>
        </div>
        <ArrowRight size={14} className="text-slate-300 group-hover:text-blue-600 transition" />
      </button>

      {/* Tile 3: Net Shortage Gap */}
      <button
        onClick={() => onFormula('GAP_ATTRIBUTION')}
        className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-left shadow-sm hover:border-slate-300 hover:shadow transition group border-l-4 border-l-rose-500"
      >
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Net Shortage Gap
          </div>
          <div className="text-base font-bold text-rose-600 font-mono mt-0.5">
            {dossier.attribution_math.total_shortage_gap_days} Days Net
          </div>
          <div className="text-[11px] text-slate-500">
            {dossier.attribution_math.baseline_gap_days}d baseline + {dossier.attribution_math.disruption_delay_days}d disruption
          </div>
        </div>
        <ArrowRight size={14} className="text-slate-300 group-hover:text-blue-600 transition" />
      </button>

      {/* Tile 4: Exposure */}
      <button
        onClick={() => onFormula('EXPOSURE')}
        className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-left shadow-sm hover:border-slate-300 hover:shadow transition group border-l-4 border-l-rose-600"
      >
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            OTIF Penalty Exposure <GlossaryTip term="OTIF" />
          </div>
          <div className="text-base font-bold text-rose-700 font-mono mt-0.5">
            {formatUSD(dossier.verifiable_exposure.otif_exposure_usd)}
          </div>
          <div className="text-[11px] text-slate-500">
            ACME SO-55102 ({dossier.verifiable_exposure.days_past_sla}d past SLA)
          </div>
        </div>
        <ArrowRight size={14} className="text-slate-300 group-hover:text-blue-600 transition" />
      </button>
    </div>
  );
};

// ─── REBUILT CLEAN DEPLETION CHART ──────────────────────────────────────────

const RebuiltDepletionChart = ({ dossier, selectedOptId, delaySlider, simulating }: {
  dossier: Dossier;
  selectedOptId: string;
  delaySlider: number;
  simulating: boolean;
}) => {
  const W = 680;
  const H = 210;
  const PAD_L = 65;
  const PAD_R = 30;
  const PAD_T = 30;
  const PAD_B = 35;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const maxDays = 22;

  const dayToX = (d: number) => PAD_L + (d / maxDays) * chartW;
  const qtyToY = (q: number) => PAD_T + (1 - Math.min(400, Math.max(0, q)) / 400) * chartH;

  const stockoutDay = dossier.attribution_math.tts_days; // 5.0 (Oct 8)
  const origEtaDay = 8; // Oct 11
  const revisedEtaDay = origEtaDay + delaySlider; // Oct 18 if +7d
  const optADay = 10; // Oct 13

  const stockoutX = dayToX(stockoutDay);
  const origEtaX = dayToX(origEtaDay);
  const revisedEtaX = dayToX(revisedEtaDay);
  const optAX = dayToX(optADay);

  return (
    <div className="relative w-full rounded-lg border border-slate-200 bg-slate-50/50 p-3 font-mono">
      {simulating && (
        <div className="absolute top-3 right-3 z-10 flex items-center gap-2 rounded bg-white px-2.5 py-1 text-xs text-slate-600 shadow-sm border border-slate-200">
          <Spinner size={12} /> Recalculating Digital Twin...
        </div>
      )}

      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible select-none">
        {/* Horizontal gridlines */}
        {[0, 200, 400].map(q => (
          <g key={q}>
            <line x1={PAD_L} x2={W - PAD_R} y1={qtyToY(q)} y2={qtyToY(q)} stroke="#e2e8f0" strokeWidth={q === 0 ? 1.5 : 1} />
            <text x={PAD_L - 8} y={qtyToY(q) + 4} textAnchor="end" fontSize="10" fill="#64748b" fontWeight="600">
              {q} units
            </text>
          </g>
        ))}

        {/* 1. Baseline Deficit Band (Oct 8 - Oct 11) */}
        <rect
          x={stockoutX}
          y={PAD_T}
          width={Math.max(0, origEtaX - stockoutX)}
          height={chartH}
          fill="#fef3c7"
          stroke="#f59e0b"
          strokeWidth="1"
          strokeDasharray="3 2"
          opacity="0.75"
        />
        <text x={(stockoutX + origEtaX) / 2} y={PAD_T + 16} textAnchor="middle" fontSize="9" fill="#b45309" fontWeight="700">
          3d Baseline Deficit
        </text>

        {/* 2. Disruption Gap Band (Oct 11 - Revised ETA) */}
        {delaySlider > 0 && (
          <g>
            <rect
              x={origEtaX}
              y={PAD_T}
              width={Math.max(0, revisedEtaX - origEtaX)}
              height={chartH}
              fill="#fee2e2"
              stroke="#ef4444"
              strokeWidth="1"
              strokeDasharray="4 2"
              opacity="0.8"
            />
            <text x={(origEtaX + revisedEtaX) / 2} y={PAD_T + 28} textAnchor="middle" fontSize="9" fill="#b91c1c" fontWeight="700">
              +{delaySlider}d Disruption Delay
            </text>
          </g>
        )}

        {/* 3. OPT-A Residual Shortage Overlay (Oct 8 - Oct 13) */}
        {selectedOptId === 'OPT-A' && (
          <rect
            x={stockoutX}
            y={PAD_T + 40}
            width={Math.max(0, optAX - stockoutX)}
            height={chartH - 40}
            fill="#dcfce7"
            stroke="#16a34a"
            strokeWidth="1.5"
            strokeDasharray="4 2"
            opacity="0.6"
          />
        )}

        {/* Depletion Curve Line (Oct 3: 400 -> Oct 8: 0) */}
        <path
          d={`M ${dayToX(0)},${qtyToY(400)} L ${stockoutX},${qtyToY(0)} L ${dayToX(maxDays)},${qtyToY(0)}`}
          stroke="#0f172a"
          strokeWidth="2.5"
          fill="none"
        />
        <circle cx={dayToX(0)} cy={qtyToY(400)} r="4" fill="#0f172a" />
        <circle cx={stockoutX} cy={qtyToY(0)} r="4" fill="#dc2626" />

        {/* Leader lines for milestones */}
        {/* Stockout vertical marker */}
        <line x1={stockoutX} y1={PAD_T} x2={stockoutX} y2={H - PAD_B} stroke="#dc2626" strokeWidth="1.5" strokeDasharray="3 3" />
        
        {/* Revised ETA vertical marker */}
        <line x1={revisedEtaX} y1={PAD_T} x2={revisedEtaX} y2={H - PAD_B} stroke="#64748b" strokeWidth="1.5" strokeDasharray="3 3" />

        {/* EuroCoils Air Inflow Spike on Oct 13 */}
        {selectedOptId === 'OPT-A' && (
          <g>
            <line x1={optAX} y1={qtyToY(0)} x2={optAX} y2={qtyToY(400)} stroke="#16a34a" strokeWidth="2.5" />
            <circle cx={optAX} cy={qtyToY(0)} r="4" fill="#16a34a" />
            <circle cx={optAX} cy={qtyToY(400)} r="4" fill="#16a34a" />
            <path d={`M ${optAX},${qtyToY(400)} L ${Math.min(W - PAD_R, optAX + 70)},${qtyToY(400)}`} stroke="#16a34a" strokeWidth="2" strokeDasharray="3 2" />
            <rect x={optAX + 6} y={qtyToY(400) - 18} width="165" height="18" rx="3" fill="#15803d" />
            <text x={optAX + 12} y={qtyToY(400) - 5} fontSize="9" fill="#ffffff" fontWeight="700">
              ✈ EuroCoils Air Inflow (Oct 13)
            </text>
          </g>
        )}

        {/* Consistent X-Axis Date Labels with Leader Ticks */}
        {[
          { day: 0, label: 'Oct 03 (Ref)', color: '#475569' },
          { day: stockoutDay, label: 'Oct 08 (Stockout)', color: '#dc2626', bold: true },
          { day: origEtaDay, label: 'Oct 11 (Orig ETA)', color: '#b45309' },
          ...(selectedOptId === 'OPT-A' ? [{ day: optADay, label: 'Oct 13 (Air)', color: '#16a34a', bold: true }] : []),
          { day: revisedEtaDay, label: `Oct ${11 + delaySlider} (Revised)`, color: '#64748b' },
        ].map((pt, idx) => (
          <g key={idx}>
            <line x1={dayToX(pt.day)} y1={H - PAD_B} x2={dayToX(pt.day)} y2={H - PAD_B + 5} stroke={pt.color} strokeWidth="1" />
            <text
              x={dayToX(pt.day)}
              y={H - PAD_B + 16 + (idx % 2 === 1 ? 10 : 0)}
              textAnchor="middle"
              fontSize="9"
              fill={pt.color}
              fontWeight={pt.bold ? '700' : '500'}
            >
              {pt.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
};

// ─── AUDITABLE EXECUTIVE PO CONFIRMATION MODAL ──────────────────────────────

const ExecutivePOConfirmModal = ({
  dossier,
  onConfirm,
  onCancel,
}: {
  dossier: Dossier;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) => {
  const [reason, setReason] = useState('Authorized under Rule C5 governance to bridge 10-day shortage and eliminate $120,000 contractual OTIF penalty for ACME Industrial Robotics (SO-55102).');
  const es = dossier.executive_summary;
  const ex = dossier.verifiable_exposure;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 font-sans animate-fade-in">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-5">
        
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white font-mono font-bold">
              ⚖
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-950">
                Authorize Emergency Expedite Purchase Order
              </h3>
              <p className="text-xs text-slate-500">
                Rule C5 Executive Sign-Off Desk • Irreversible Action
              </p>
            </div>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-700 transition">
            <X size={18} />
          </button>
        </div>

        {/* PO Snapshot Box */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-2.5 text-xs font-mono">
          <div className="flex justify-between py-1 border-b border-slate-200/60">
            <span className="text-slate-500 font-sans">Vendor / Supplier:</span>
            <strong className="text-slate-900">EuroCoils GmbH (Stuttgart, Germany)</strong>
          </div>
          <div className="flex justify-between py-1 border-b border-slate-200/60">
            <span className="text-slate-500 font-sans">Material SKU & Quantity:</span>
            <strong className="text-slate-900">STCOIL-440V • 900 Units (Pre-Cleared)</strong>
          </div>
          <div className="flex justify-between py-1 border-b border-slate-200/60">
            <span className="text-slate-500 font-sans">Freight Mode & Carrier:</span>
            <strong className="text-slate-900">AIR_EXPEDITE • Lufthansa Cargo (LH-8422)</strong>
          </div>
          <div className="flex justify-between py-1 border-b border-slate-200/60">
            <span className="text-slate-500 font-sans">Guaranteed Plant Arrival:</span>
            <strong className="text-emerald-700">2026-10-13 (Bridges WO-7782 gap)</strong>
          </div>
          <div className="flex justify-between py-1 border-b border-slate-200/60">
            <span className="text-slate-500 font-sans">Authorized Expedite Spend:</span>
            <strong className="text-slate-950 text-sm font-bold">{formatUSD(es.expedite_cost_usd)}</strong>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-slate-500 font-sans">Financial Net Return:</span>
            <strong className="text-emerald-700 font-bold">+{formatUSD(es.net_value_saved_usd)} protected ({es.roi_ratio}× return on spend)</strong>
          </div>
        </div>

        {/* Required Rationale Textarea */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 font-mono">
            Executive Authorization Rationale (Recorded to Audit Trail):
          </label>
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-800 focus:border-slate-900 focus:outline-none leading-relaxed"
          />
        </div>

        {/* Audit Entry Preview */}
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-[11px] font-mono text-emerald-950 leading-relaxed">
          <div className="font-bold flex items-center gap-1.5 text-emerald-800 mb-1">
            <Shield size={12} /> Cryptographic Audit Entry to be Logged:
          </div>
          <code>
            SIGN_AUTHORITY: "VP Global Supply Chain" | RULE: "C5" | ACTION: "APPROVE_PO" | AMOUNT: ${es.expedite_cost_usd} | BENEFICIARY: "ACME Corp SO-55102"
          </code>
        </div>

        {/* Modal Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason)}
            className="rounded-lg bg-slate-950 px-5 py-2 text-xs font-bold text-white shadow-md hover:bg-slate-800 transition flex items-center gap-2"
          >
            <CheckCircle2 size={14} className="text-emerald-400" />
            Confirm & Issue Formal PO
          </button>
        </div>

      </div>
    </div>
  );
};

// ─── PLANNER WORKSPACE ───────────────────────────────────────────────────────

const PlannerWorkspace = ({
  dossier,
  setDossier,
  selectedOptId,
  setSelectedOptId,
}: {
  dossier: Dossier;
  setDossier: (d: Dossier) => void;
  selectedOptId: string;
  setSelectedOptId: (id: string) => void;
}) => {
  const [delaySlider, setDelaySlider] = useState(7);
  const [simulating, setSimulating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSlider = useCallback((val: number) => {
    setDelaySlider(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSimulating(true);
      fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delay_days: val, as_of: '2026-10-03' }),
      })
        .then(r => r.json())
        .then(data => { if (data.dossier) setDossier(data.dossier); })
        .finally(() => setSimulating(false));
    }, 250);
  }, [setDossier]);

  const selectedOpt = dossier.recovery_options_matrix.find(o => o.option_id === selectedOptId) || dossier.recovery_options_matrix[0];
  const survivorCount = dossier.recovery_options_matrix.filter(o => o.status !== 'VETOED').length;

  return (
    <div className="space-y-4">
      {/* Top Split: Left Depletion Curve (6 cols) & Right C1-C8 Matrix (6 cols) */}
      <div className="grid grid-cols-12 gap-4">
        
        {/* Left: Chart & Simulator */}
        <div className="col-span-12 lg:col-span-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider font-mono flex items-center gap-1.5">
                <Sliders size={13} className="text-slate-700" /> Digital Twin Depletion Simulator
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Dynamic inventory exhaustion curve with leader annotations
              </p>
            </div>
            <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
              +{delaySlider}d DELAY
            </span>
          </div>

          {/* Slider */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
            <div className="flex justify-between text-xs font-mono text-slate-600 mb-1.5">
              <span>0d Baseline (Oct 11)</span>
              <strong className="text-slate-900">Simulate Storm Delay: +{delaySlider} Days</strong>
              <span>20d Max Congestion</span>
            </div>
            <input
              type="range"
              min={0}
              max={20}
              value={delaySlider}
              onChange={(e) => handleSlider(parseInt(e.target.value))}
              className="w-full"
            />
          </div>

          {/* SVG Chart */}
          <RebuiltDepletionChart
            dossier={dossier}
            selectedOptId={selectedOptId}
            delaySlider={delaySlider}
            simulating={simulating}
          />
        </div>

        {/* Right: Full C1–C8 Matrix Table */}
        <div className="col-span-12 lg:col-span-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider font-mono">
                Constraint Matrix (Rules C1–C8)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Deterministic rule checks • Click row to project onto Digital Twin
              </p>
            </div>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold font-mono ${
              survivorCount > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
            }`}>
              {survivorCount > 0 ? `${survivorCount} Feasible Survivor` : '0 Survivors (All Vetoed)'}
            </span>
          </div>

          {/* Full Table (Ample Width, No Clipped STATUS) */}
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left text-xs font-mono border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 text-[11px]">
                  <th className="py-2 px-2 font-semibold">OPTION</th>
                  <th className="py-2 px-1 text-center font-semibold">MODE</th>
                  {Object.keys(RULE_METADATA).map(cid => (
                    <th key={cid} className="py-2 px-1 text-center" title={`${RULE_METADATA[cid].name}: ${RULE_METADATA[cid].desc}`}>
                      <span className="cursor-help hover:text-slate-950 font-bold">{cid}</span>
                    </th>
                  ))}
                  <th className="py-2 px-2 text-right font-semibold">COST</th>
                  <th className="py-2 px-2 text-center font-semibold">VERDICT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dossier.recovery_options_matrix.map(opt => {
                  const isSelected = selectedOptId === opt.option_id;
                  const isSurvivor = opt.status !== 'VETOED';

                  return (
                    <tr
                      key={opt.option_id}
                      onClick={() => setSelectedOptId(opt.option_id)}
                      className={`cursor-pointer transition ${
                        isSelected ? 'bg-blue-50 font-semibold' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-2.5 px-2">
                        <div className="font-bold text-slate-900">{opt.option_id}</div>
                        <div className="text-[10px] text-slate-500 font-sans">{opt.supplier_name.split(' ')[0]}</div>
                      </td>
                      <td className="py-2.5 px-1 text-center text-slate-600 font-sans text-[11px]">
                        {opt.freight_mode}
                      </td>

                      {/* Rules C1 to C8 */}
                      {Object.keys(RULE_METADATA).map(cid => {
                        const r = opt.rules[cid];
                        if (cid === 'C5') {
                          return (
                            <td key={cid} className="py-2.5 px-1 text-center" title={r.reason}>
                              {r.warning ? <span className="text-amber-600 font-bold">⚠️</span> : <span className="text-emerald-600 font-bold">✓</span>}
                            </td>
                          );
                        }
                        return (
                          <td key={cid} className="py-2.5 px-1 text-center" title={r.reason}>
                            {r.pass ? <span className="text-emerald-600 font-bold">✓</span> : <span className="text-rose-600 font-bold">✗</span>}
                          </td>
                        );
                      })}

                      <td className="py-2.5 px-2 text-right font-bold text-slate-900 font-mono">
                        {opt.estimated_cost_usd > 0 ? formatUSD(opt.estimated_cost_usd) : '—'}
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold ${
                          opt.status === 'PASS_WITH_WARNING'
                            ? 'bg-amber-100 text-amber-800 border border-amber-200'
                            : isSurvivor
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}>
                          {opt.status === 'PASS_WITH_WARNING' ? 'SURVIVOR (VP)' : isSurvivor ? 'PASSED' : 'VETOED'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Selected Option Detail Box */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1.5">
            <div className="flex items-center justify-between font-mono">
              <strong className="text-slate-900 text-sm font-sans">{selectedOpt.option_id}: {selectedOpt.supplier_name}</strong>
              <span className="text-slate-700 font-bold">
                Arrival: {selectedOpt.arrival_date} ({formatUSD(selectedOpt.estimated_cost_usd)})
              </span>
            </div>
            <p className="text-slate-600 font-sans text-xs leading-relaxed">{selectedOpt.description}</p>
            
            {selectedOpt.hard_vetoes.length > 0 ? (
              <div className="rounded border border-rose-200 bg-rose-50 p-2 text-rose-800 text-[11px] font-mono space-y-1">
                {selectedOpt.hard_vetoes.map(v => (
                  <div key={v} className="flex items-start gap-1">
                    <span>✗</span>
                    <span><strong>Rule {v}:</strong> {selectedOpt.rules[v].reason}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-between text-xs font-mono pt-1 border-t border-slate-200">
                <span className="text-slate-600">Residual shortage gap (safety stock draw):</span>
                <strong className="text-emerald-700">{selectedOpt.residual_gap_days} Days Uncovered</strong>
              </div>
            )}
          </div>

        </div>

      </div>

      {/* Bottom: 4-Node Ontology Pegging Chain */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-2">
        <div className="text-xs font-bold text-slate-700 uppercase tracking-wider font-mono">
          Ontology Pegging Chain (Date-Tagged Production Nodes)
        </div>
        <div className="grid grid-cols-4 gap-3 text-xs">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-[10px] text-slate-500 uppercase font-mono font-bold">1. Inbound Shipment</div>
            <div className="text-sm font-bold text-slate-900 font-mono mt-0.5">{dossier.disruption.shipment_id}</div>
            <div className="text-[11px] text-slate-600 mt-1 font-mono">Vessel: {dossier.disruption.vessel_name}</div>
            <div className="text-[11px] text-amber-700 font-bold font-mono">ETA: {dossier.disruption.revised_eta}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-[10px] text-slate-500 uppercase font-mono font-bold">2. Critical Component</div>
            <div className="text-sm font-bold text-blue-700 font-mono mt-0.5">{dossier.disruption.material_id}</div>
            <div className="text-[11px] text-slate-600 mt-1 font-mono">{dossier.attribution_math.on_hand_qty} units on-hand</div>
            <div className="text-[11px] text-rose-700 font-bold font-mono">Stockout: {dossier.attribution_math.stockout_date}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-[10px] text-slate-500 uppercase font-mono font-bold">3. Production Work Order</div>
            <div className="text-sm font-bold text-slate-900 font-mono mt-0.5">{dossier.verifiable_exposure.work_order_id}</div>
            <div className="text-[11px] text-slate-600 mt-1 font-mono">Assembly Line 2 (3d run)</div>
            <div className="text-[11px] text-slate-800 font-mono">Planned: {dossier.verifiable_exposure.wo_planned_start}</div>
          </div>
          <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-3">
            <div className="text-[10px] text-rose-700 uppercase font-mono font-bold">4. Customer Commitment</div>
            <div className="text-sm font-bold text-rose-950 font-mono mt-0.5">{dossier.verifiable_exposure.customer_order_id}</div>
            <div className="text-[11px] text-rose-800 mt-1">{dossier.verifiable_exposure.customer_name}</div>
            <div className="text-[11px] text-rose-700 font-bold font-mono">SLA Due: {dossier.verifiable_exposure.so_due_date}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── PLANT LEAD WORKSPACE ────────────────────────────────────────────────────

const PlantLeadWorkspace = ({ dossier }: { dossier: Dossier }) => {
  const optA = dossier.recovery_options_matrix.find(o => o.option_id === 'OPT-A');
  const vetoedOptions = dossier.recovery_options_matrix.filter(o => o.status === 'VETOED');

  return (
    <div className="space-y-4">
      {/* Top Banner: Assembly Line 2 Status */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Factory size={22} className="text-amber-800" />
          <div>
            <h3 className="text-sm font-bold text-amber-950 font-mono">
              Assembly Line 2 (ApexX-100 Motor Drives) — Starvation Defense
            </h3>
            <p className="text-xs text-amber-800 mt-0.5">
              Work Order WO-7782 scheduled for 2026-10-14. Frozen planning window is active until 2026-10-16 (Rule C4).
            </p>
          </div>
        </div>
        <span className="font-mono text-xs font-bold px-3 py-1 rounded bg-amber-200 text-amber-900 border border-amber-300">
          Line 2: Action Required
        </span>
      </div>

      {/* Production Impact Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        
        {/* Unmitigated Scenario */}
        <div className="rounded-xl border border-rose-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-rose-100 pb-2">
            <h4 className="text-xs font-bold text-rose-800 uppercase font-mono">Unmitigated Disruption Timeline</h4>
            <span className="text-xs font-bold text-rose-700 font-mono">Misses SLA by 2 Days</span>
          </div>
          <div className="space-y-2 text-xs font-mono text-slate-700">
            <div className="flex justify-between"><span>Stockout Occurs:</span> <strong className="text-rose-700">2026-10-08</strong></div>
            <div className="flex justify-between"><span>Line Starvation Window:</span> <strong className="text-rose-700">Oct 08 to Oct 18 (10 Days)</strong></div>
            <div className="flex justify-between"><span>Revised Shipment Arrival:</span> <strong>2026-10-18</strong></div>
            <div className="flex justify-between"><span>WO-7782 Delayed Start:</span> <strong>2026-10-18</strong></div>
            <div className="flex justify-between"><span>WO-7782 Delayed End:</span> <strong>2026-10-21</strong></div>
            <div className="flex justify-between border-t border-rose-100 pt-2 font-bold text-rose-900">
              <span>Customer Penalty:</span> <span>$120,000 OTIF Liquidated Damages</span>
            </div>
          </div>
        </div>

        {/* Mitigated Scenario with OPT-A */}
        <div className="rounded-xl border border-emerald-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-emerald-100 pb-2">
            <h4 className="text-xs font-bold text-emerald-800 uppercase font-mono">Mitigated Timeline (EuroCoils Air)</h4>
            <span className="text-xs font-bold text-emerald-700 font-mono">SLA Met on 2026-10-17</span>
          </div>
          <div className="space-y-2 text-xs font-mono text-slate-700">
            <div className="flex justify-between"><span>Air Freight Arrival:</span> <strong className="text-emerald-700">2026-10-13</strong></div>
            <div className="flex justify-between"><span>Residual Shortage (Safety Stock):</span> <strong>5 Days (Oct 08–13)</strong></div>
            <div className="flex justify-between"><span>WO-7782 Start Date:</span> <strong className="text-emerald-700">2026-10-14 (On-Time)</strong></div>
            <div className="flex justify-between"><span>WO-7782 Completion:</span> <strong>2026-10-17</strong></div>
            <div className="flex justify-between"><span>ACME Delivery Date:</span> <strong>2026-10-19 (0 Days Past SLA)</strong></div>
            <div className="flex justify-between border-t border-emerald-100 pt-2 font-bold text-emerald-900">
              <span>Net Penalty Saved:</span> <span>+$89,850 protected ($120k − $30,150)</span>
            </div>
          </div>
        </div>

      </div>

      {/* 3 Balanced Veto Cards (Clean 3-Column Grid, Zero Dead Space) */}
      <div className="space-y-2">
        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider font-mono">
          Why Shop-Floor Alternatives Were Eliminated (Veto Proofs):
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {vetoedOptions.map(opt => (
            <div key={opt.option_id} className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between font-mono">
                <strong className="text-slate-900 font-sans text-sm">{opt.option_id}: {opt.supplier_name.split(' ')[0]}</strong>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-200 text-rose-800">VETOED</span>
              </div>
              <div className="text-[11px] text-slate-500 font-mono">{opt.category_label}</div>
              <p className="text-slate-700 text-xs leading-relaxed">{opt.description}</p>
              <div className="border-t border-rose-200 pt-2 space-y-1 font-mono text-[11px] text-rose-900">
                {opt.hard_vetoes.map(v => (
                  <div key={v} className="flex items-start gap-1">
                    <span>✗</span>
                    <span><strong>Rule {v}:</strong> {opt.rules[v].reason}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── VP EXECUTIVE WORKSPACE ──────────────────────────────────────────────────

const VPExecutiveWorkspace = ({
  dossier,
  decisionExecuted,
  onOpenConfirm,
}: {
  dossier: Dossier;
  decisionExecuted: any;
  onOpenConfirm: () => void;
}) => {
  const es = dossier.executive_summary;
  const ex = dossier.verifiable_exposure;

  if (decisionExecuted?.action === 'APPROVE') {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-8 text-center space-y-4 max-w-xl mx-auto my-6 font-sans">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-600/30">
          <CheckCircle2 size={32} />
        </div>
        <div>
          <h3 className="text-xl font-bold text-emerald-950 font-mono">
            PO-EURO-{decisionExecuted.po_number || 'EXECUTED'} Authorized
          </h3>
          <p className="text-xs text-emerald-800 mt-1">
            Formal expedite order dispatched to EuroCoils GmbH via Lufthansa Cargo (ETA 2026-10-13).
          </p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-white p-4 text-xs font-mono space-y-2 text-left">
          <div className="flex justify-between"><span>Status:</span> <strong className="text-emerald-700">TRANSMITTED TO ERP</strong></div>
          <div className="flex justify-between"><span>Authorized By:</span> <strong>{decisionExecuted.approver_role}</strong></div>
          <div className="flex justify-between"><span>Spend Approved:</span> <strong>{formatUSD(es.expedite_cost_usd)}</strong></div>
          <div className="flex justify-between"><span>Timestamp:</span> <strong>{new Date(decisionExecuted.timestamp).toLocaleString()}</strong></div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5 font-sans">
      {/* 3-Bullet Executive Briefing Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-blue-600" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 font-mono">
              AI Executive Trade-Off Briefing (Dual-Verified)
            </h3>
          </div>
          <span className="text-xs font-mono text-slate-500">Decision SLA: 4 Hours</span>
        </div>
        <ul className="space-y-2.5 text-xs text-slate-700 leading-relaxed list-disc list-inside">
          <li>
            <strong className="text-slate-950">Disruption Confirmed:</strong> Vessel MV Sentinel (SHIP-7010) delayed +7 days at Port Klang. STCOIL-440V arrives Oct 18, causing Assembly Line 2 to starve on Oct 8 (TTS 5.0 days).
          </li>
          <li>
            <strong className="text-slate-950">Contractual Penalty:</strong> Work Order WO-7782 will be delayed 2 days past ACME Industrial Robotics' SLA (Oct 19), triggering an immediate <strong className="text-rose-700 font-bold">$120,000 OTIF penalty</strong> on SO-55102.
          </li>
          <li>
            <strong className="text-slate-950">Deterministic Resolution:</strong> Option A (EuroCoils Air Freight) arrives Oct 13, bridges the production window, and eliminates the $120,000 penalty for an authorized freight spend of $30,150. Requires Rule C5 VP authorization.
          </li>
        </ul>
      </div>

      {/* Honest Financial Trade-Off Table */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 font-mono">
          Executive Decision Calculus:
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-center font-mono">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs text-slate-500 font-sans uppercase">Expedite Air Freight</div>
            <div className="text-xl font-bold text-slate-950 mt-1">{formatUSD(es.expedite_cost_usd)}</div>
            <div className="text-[11px] text-slate-500 mt-1 font-sans">EuroCoils GmbH (Stuttgart)</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs text-slate-500 font-sans uppercase">OTIF Penalty Avoided</div>
            <div className="text-xl font-bold text-emerald-700 mt-1">{formatUSD(es.penalty_avoided_usd)}</div>
            <div className="text-[11px] text-slate-500 mt-1 font-sans">ACME Corp (SO-55102)</div>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-xs text-emerald-800 font-sans uppercase font-bold">Net Protected Value</div>
            <div className="text-xl font-bold text-emerald-800 mt-1">+{formatUSD(es.net_value_saved_usd)}</div>
            <div className="text-[11px] text-emerald-700 mt-1 font-sans">Penalty saved less freight</div>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <div className="text-xs text-blue-800 font-sans uppercase font-bold">Spend Efficiency</div>
            <div className="text-xl font-bold text-blue-900 mt-1">{es.roi_ratio}×</div>
            <div className="text-[11px] text-blue-700 mt-1 font-sans">Return on spend ratio</div>
          </div>
        </div>

        {/* Single Primary Action Banner (No Duplicate Buttons) */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="text-xs font-bold text-slate-900 font-mono">
              AUTHORIZE EXPEDITE PURCHASE ORDER
            </div>
            <div className="text-xs text-slate-500">
              Opens the verification confirmation sheet before formal dispatch
            </div>
          </div>
          <button
            onClick={onOpenConfirm}
            className="rounded-lg bg-slate-950 px-5 py-2.5 text-xs font-bold text-white shadow-md hover:bg-slate-800 transition flex items-center gap-2 font-mono"
          >
            <CheckCircle2 size={15} className="text-emerald-400" />
            Review & Sign Authorization →
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── GOVERNANCE & AUDIT WORKSPACE ───────────────────────────────────────────

const GovernanceAuditWorkspace = ({
  dossier,
  decisionExecuted,
}: {
  dossier: Dossier;
  decisionExecuted: any;
}) => {
  return (
    <div className="space-y-4 font-sans">
      {/* C1-C8 Matrix Reference */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 font-mono">
            Deterministic Constraint Verification Proofs (C1–C8)
          </h3>
          <div className="flex gap-2">
            <button className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 font-mono">
              <Download size={12} /> Export Audit CSV
            </button>
          </div>
        </div>

        {/* Rule Definitions Legend Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 text-xs font-mono">
          {Object.entries(RULE_METADATA).map(([cid, meta]) => (
            <div key={cid} className="rounded border border-slate-200 bg-slate-50 p-2 space-y-1">
              <div className="flex items-center justify-between font-bold text-slate-900">
                <span>{cid}: {meta.short}</span>
              </div>
              <div className="text-[10px] text-slate-600 font-sans leading-tight">{meta.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Immutable Governance Ledger */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 font-mono flex items-center gap-2">
          <Shield size={14} className="text-slate-700" /> Immutable Event Audit Ledger
        </h3>

        {decisionExecuted ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 font-mono text-xs text-emerald-950 space-y-2">
            <div className="flex items-center justify-between font-bold text-emerald-900 border-b border-emerald-200 pb-2">
              <span>Decision Record: {decisionExecuted.decision_id}</span>
              <span>Action: {decisionExecuted.action}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>PO Reference: <strong>{decisionExecuted.po_number || 'N/A'}</strong></div>
              <div>Approver Role: <strong>{decisionExecuted.approver_role}</strong></div>
              <div>Option Authorized: <strong>{decisionExecuted.option_id}</strong></div>
              <div>Timestamp: <strong>{new Date(decisionExecuted.timestamp).toLocaleString()}</strong></div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-8 text-center space-y-2">
            <Shield size={24} className="mx-auto text-slate-400" />
            <div className="text-xs font-bold text-slate-700 font-mono">
              Audit Trail Initialized — Pending Human Authorization
            </div>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              All executive decisions, rule checks, timestamps, and PO payloads will be cryptographically recorded here once sign-off occurs.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── EXPANDABLE ARITHMETIC FORMULA MODALS ────────────────────────────────────

const FormulaModal = ({
  dossier,
  formulaKey,
  onClose,
}: {
  dossier: Dossier;
  formulaKey: FormulaKey;
  onClose: () => void;
}) => {
  if (!formulaKey) return null;
  const am = dossier.attribution_math;
  const ex = dossier.verifiable_exposure;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 font-sans animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Info size={16} className="text-blue-600" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-950 font-mono">
              Verifiable Ground-Truth Proof
            </h4>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
        </div>

        {formulaKey === 'STOCKOUT' && (
          <div className="space-y-3 text-xs">
            <div className="font-bold text-slate-900 font-mono">Time-To-Survive (TTS) Formula:</div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-sm text-slate-900 font-bold">
              {am.tts_formula}
            </div>
            <p className="text-slate-600 leading-relaxed">
              On-hand stock is exactly {am.on_hand_qty} units of STCOIL-440V. At factory consumption of {am.daily_burn_rate} coils/day (40 ApexX-100 motor units × 2 coils each), inventory reaches zero on {am.stockout_date} (Day 5).
            </p>
          </div>
        )}

        {formulaKey === 'REVISED_ETA' && (
          <div className="space-y-3 text-xs">
            <div className="font-bold text-slate-900 font-mono">Time-To-Recover (TTR) Formula:</div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-sm text-slate-900 font-bold">
              Original ETA ({dossier.disruption.original_eta}) + {dossier.disruption.simulated_delay_days}d Storm Delay = {dossier.disruption.revised_eta}
            </div>
            <p className="text-slate-600 leading-relaxed">
              Vessel MV Sentinel was scheduled for Oct 11. Typhoon congestion at Port Klang anchorage added {dossier.disruption.simulated_delay_days} days of transit hold, pushing arrival to {dossier.disruption.revised_eta}.
            </p>
          </div>
        )}

        {formulaKey === 'GAP_ATTRIBUTION' && (
          <div className="space-y-3 text-xs">
            <div className="font-bold text-slate-900 font-mono">Honest Gap Attribution Equation:</div>
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 font-mono text-sm text-rose-800 font-bold">
              {am.gap_equation}
            </div>
            <p className="text-slate-600 leading-relaxed">
              {am.baseline_explanation}. The storm is responsible for {am.disruption_delay_days} days of delay. The engine separates pre-existing planning deficits from external disruptions.
            </p>
          </div>
        )}

        {formulaKey === 'EXPOSURE' && (
          <div className="space-y-3 text-xs">
            <div className="font-bold text-slate-900 font-mono">Verifiable Customer OTIF Penalty:</div>
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 font-mono text-sm text-rose-800 font-bold">
              500 Units × $240 Unit Price = {formatUSD(ex.otif_exposure_usd)} Penalty Exposure
            </div>
            <p className="text-slate-600 leading-relaxed">
              {ex.proof_narrative}
            </p>
          </div>
        )}

        <div className="pt-2 text-right">
          <button onClick={onClose} className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800">
            Close Proof
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── EVIDENCE SENSOR DRAWER ──────────────────────────────────────────────────

const EvidenceSensorDrawer = ({
  onClose,
  decisionExecuted,
}: {
  onClose: () => void;
  decisionExecuted: any;
}) => {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-xs font-sans animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-md bg-white p-6 shadow-2xl space-y-5 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-slate-700" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-950 font-mono">
              Live Sensor & Telemetry Drawer
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        {/* Live SerpAPI Extraction */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2.5 text-xs font-mono">
          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <span>SerpAPI Sensor Feed</span>
            <span className="text-emerald-700 font-bold flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" /> Confidence: 0.94
            </span>
          </div>
          <div className="text-xs font-bold font-sans text-slate-900">
            "Asia port congestion worsens amid bad weather, vessel bunching"
          </div>
          <div className="text-[11px] text-slate-600 font-sans">
            Source: Journal of Commerce (JOC) • Maritime Port Radar
          </div>
          <div className="pt-1 text-[11px] text-blue-600 font-sans flex items-center gap-1">
            <ExternalLink size={11} /> Verified Live Article Payload
          </div>
        </div>

        {/* AIS Vessel Telemetry */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-xs font-mono">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            AIS Telemetry (MV Sentinel)
          </div>
          <div className="space-y-1.5 text-slate-700">
            <div className="flex justify-between"><span>Vessel MMSI:</span> <strong>538009214</strong></div>
            <div className="flex justify-between"><span>Anchorage:</span> <strong>02°59'N, 101°24'E (Klang)</strong></div>
            <div className="flex justify-between"><span>Speed / Status:</span> <strong className="text-rose-600">0.0 kts (Congested Hold)</strong></div>
            <div className="flex justify-between"><span>Shipment ID:</span> <strong>SHIP-7010</strong></div>
            <div className="flex justify-between"><span>Purchase Order:</span> <strong>PO-7010 (900 Units)</strong></div>
          </div>
        </div>

      </div>
    </div>
  );
};

// ─── ROOT COMPONENT ─────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('GATEWAY');
  const [role, setRole] = useState<UserRole>('PLANNER');
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [selectedOptId, setSelectedOptId] = useState<string>('OPT-A');
  const [loading, setLoading] = useState(false);
  const [activeFormula, setActiveFormula] = useState<FormulaKey>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [showPOConfirmModal, setShowPOConfirmModal] = useState(false);
  const [decisionExecuted, setDecisionExecuted] = useState<any>(null);

  // Load initial dossier
  const loadDossier = useCallback(() => {
    setLoading(true);
    fetch('/api/incidents/INC-2026-PORT-KLANG-01')
      .then(res => res.json())
      .then(data => {
        setDossier(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error fetching incident:', err);
        setLoading(false);
      });
  }, []);

  const handleEnterRole = (selectedRole: UserRole) => {
    setRole(selectedRole);
    setScreen('WORKSPACE');
    loadDossier();
  };

  const handleExecuteDecision = (reason: string) => {
    fetch('/api/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        incident_id: 'INC-2026-PORT-KLANG-01',
        option_id: 'OPT-A',
        action: 'APPROVE',
        approver_role: role === 'VP' ? 'VP Global Supply Chain' : 'Senior S&OE Planner',
        notes: reason,
      }),
    })
      .then(res => res.json())
      .then(data => {
        setDecisionExecuted(data);
        setShowPOConfirmModal(false);
      })
      .catch(err => console.error('Execution error:', err));
  };

  if (screen === 'GATEWAY') {
    return <GatewayScreen onEnter={handleEnterRole} />;
  }

  if (loading || !dossier) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 text-slate-700 font-mono text-xs">
        <div className="flex items-center gap-3">
          <Spinner size={18} />
          Connecting to Enterprise Decision Engine...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-20">
      
      {/* 1. Global Navigation Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          
          {/* Brand + Status Stepper */}
          <div className="flex items-center gap-5">
            <button
              onClick={() => setScreen('GATEWAY')}
              className="flex items-center gap-2 hover:opacity-80 transition"
              title="Return to Gateway"
            >
              <div className="h-7 w-7 rounded-lg bg-slate-950 flex items-center justify-center font-bold text-white text-xs">
                ⬡
              </div>
              <span className="font-bold text-sm text-slate-950 tracking-tight">Apex Orchestrator</span>
            </button>

            {/* Stepper Status */}
            <div className="hidden lg:flex items-center gap-2 text-xs border-l border-slate-200 pl-4 text-slate-600 font-medium">
              <span className="flex items-center gap-1 text-emerald-700 font-semibold">
                <Check size={13} className="text-emerald-600 stroke-[3]" /> Detected
              </span>
              <span className="text-slate-300">→</span>
              <span className="flex items-center gap-1 text-emerald-700 font-semibold">
                <Check size={13} className="text-emerald-600 stroke-[3]" /> Assessed
              </span>
              <span className="text-slate-300">→</span>
              <span className="flex items-center gap-1 text-emerald-700 font-semibold">
                <Check size={13} className="text-emerald-600 stroke-[3]" /> Options Formulated
              </span>
              <span className="text-slate-300">→</span>
              <span className={`px-2 py-0.5 rounded-full font-bold text-[11px] font-mono ${
                decisionExecuted ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800 border border-amber-300'
              }`}>
                {decisionExecuted ? 'Executed ✓' : 'Awaiting VP Sign-Off'}
              </span>
            </div>
          </div>

          {/* Right Role Switcher & Clock */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded bg-slate-100 border border-slate-200 text-xs font-mono text-slate-600">
              <Clock size={12} className="text-slate-500" />
              <span>AS OF: <strong className="text-slate-900">{dossier.as_of} 08:00 UTC</strong></span>
            </div>

            {/* Role Switcher Tabs */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs font-medium">
              {(Object.keys(PERSONA_CONFIG) as UserRole[]).map(r => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={`px-3 py-1 rounded-md transition ${
                    role === r ? 'bg-white text-slate-950 font-bold shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {PERSONA_CONFIG[r].icon} <span className="hidden md:inline">{PERSONA_CONFIG[r].label.split(' ')[0]}</span>
                </button>
              ))}
            </div>

            {/* Evidence Drawer Button */}
            <button
              onClick={() => setShowEvidence(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-xs"
            >
              <Layers size={13} />
              <span className="hidden sm:inline">Sensors</span>
            </button>
          </div>

        </div>
      </header>

      {/* 2. Main Workspace Body */}
      <main className="max-w-7xl mx-auto px-4 pt-4 space-y-4">
        
        {/* Slim Role-Aware KPI Strip */}
        <SlimKpiStrip dossier={dossier} role={role} onFormula={setActiveFormula} />

        {/* Persona Workspace Views */}
        {role === 'PLANNER' && (
          <PlannerWorkspace
            dossier={dossier}
            setDossier={setDossier}
            selectedOptId={selectedOptId}
            setSelectedOptId={setSelectedOptId}
          />
        )}

        {role === 'PLANT_LEAD' && (
          <PlantLeadWorkspace dossier={dossier} />
        )}

        {role === 'VP' && (
          <VPExecutiveWorkspace
            dossier={dossier}
            decisionExecuted={decisionExecuted}
            onOpenConfirm={() => setShowPOConfirmModal(true)}
          />
        )}

        {role === 'AUDIT' && (
          <GovernanceAuditWorkspace
            dossier={dossier}
            decisionExecuted={decisionExecuted}
          />
        )}

      </main>

      {/* 3. Sticky Bottom Decision Bar (Clear Role-Based CTAs) */}
      <footer className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 shadow-xl py-3">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white font-mono font-bold text-sm">
              ⚖
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs text-slate-900 font-mono">
                  ACTION: {dossier.executive_summary.recommended_option_id} ({dossier.executive_summary.recommended_supplier})
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-100 text-amber-800 border border-amber-200 font-semibold">
                  Rule C5: Requires VP Sign-Off
                </span>
              </div>
              <div className="text-[11px] text-slate-600 mt-0.5">
                Spend: <strong className="text-slate-900 font-mono">{formatUSD(dossier.executive_summary.expedite_cost_usd)}</strong>
                {' • '}Penalty Avoided: <strong className="text-emerald-700 font-mono">{formatUSD(dossier.executive_summary.penalty_avoided_usd)}</strong>
                {' • '}Net Saved: <strong className="text-emerald-700 font-mono">+{formatUSD(dossier.executive_summary.net_value_saved_usd)}</strong>
              </div>
            </div>
          </div>

          {/* Action Button Strip */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => alert("Mitigation declined. Incident logged for review.")}
              className="px-3.5 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              Decline
            </button>
            <button
              onClick={() => alert("Escalated to Executive S&OE Governance Committee.")}
              className="px-3.5 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 transition font-mono"
            >
              Escalate to S&OE Board
            </button>
            {role === 'VP' ? (
              <button
                onClick={() => setShowPOConfirmModal(true)}
                className="px-4 py-2 rounded-lg bg-slate-950 hover:bg-slate-800 text-white text-xs font-bold transition shadow-sm flex items-center gap-2 font-mono"
              >
                <CheckCircle2 size={14} className="text-emerald-400" />
                Authorize & Issue PO
              </button>
            ) : role === 'PLANT_LEAD' ? (
              <button
                onClick={() => alert("Line 2 schedule confirmed. Handing off to VP Supply Chain.")}
                className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition shadow-sm flex items-center gap-2 font-mono"
              >
                <Check size={14} className="text-emerald-400" />
                Endorse Production Schedule
              </button>
            ) : (
              <button
                onClick={() => alert("Request transmitted to VP Global Supply Chain for Rule C5 authorization.")}
                className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition shadow-sm flex items-center gap-2 font-mono"
              >
                <UserCheck size={14} className="text-blue-400" />
                Request VP Authorization
              </button>
            )}
          </div>
        </div>
      </footer>

      {/* 4. Modals & Drawers */}
      {showPOConfirmModal && (
        <ExecutivePOConfirmModal
          dossier={dossier}
          onConfirm={handleExecuteDecision}
          onCancel={() => setShowPOConfirmModal(false)}
        />
      )}

      {activeFormula && (
        <FormulaModal
          dossier={dossier}
          formulaKey={activeFormula}
          onClose={() => setActiveFormula(null)}
        />
      )}

      {showEvidence && (
        <EvidenceSensorDrawer
          onClose={() => setShowEvidence(false)}
          decisionExecuted={decisionExecuted}
        />
      )}

    </div>
  );
}
