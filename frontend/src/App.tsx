import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  AlertTriangle, Shield, CheckCircle2, XCircle, Clock,
  Layers, Info, Anchor, DollarSign, Calendar, FileText,
  Sliders, UserCheck, X, Check, ArrowRight, ChevronRight,
  AlertCircle, Package, Truck, Factory, BarChart2,
  ExternalLink, Download, RefreshCw, Zap, Lock
} from 'lucide-react';

// ─── TYPES ─────────────────────────────────────────────────────────────────

type UserRole = 'PLANNER' | 'PLANT_LEAD' | 'VP' | 'AUDIT';
type AppScreen = 'GATEWAY' | 'WORKSPACE';
type FormulaKey = 'STOCKOUT' | 'REVISED_ETA' | 'GAP_ATTRIBUTION' | 'EXPOSURE' | null;
type EvidenceTab = 'SERP' | 'AIS' | 'AUDIT';

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

const RULE_DEFINITIONS: Record<string, string> = {
  C1: 'Supplier Lead Time — Option arrival must be ≤ revised ETA (2026-10-18) to bridge the gap',
  C2: 'Minimum Order Quantity — Order qty must be ≥ supplier MOQ',
  C3: 'Quality / PPAP Certification — Supplier must hold valid PPAP cert for ApexX-100 product line',
  C4: 'Frozen Schedule Window — Reschedule not permitted within 14-day frozen MPS boundary (until 2026-10-16)',
  C5: 'Approval Authority / Budget — Spend > $30k requires VP Supply Chain authorization (soft gate)',
  C6: 'BOM Revision Compatibility — Substitute material must match active BOM revision (REV-D)',
  C7: 'Route / Customs — No active export restrictions from origin country',
  C8: 'Supplier Capacity — Order qty must be ≤ supplier monthly production capacity',
};

const GLOSSARY: Record<string, string> = {
  TTS: 'Time-To-Survive — Days of on-hand inventory at current burn rate before stockout',
  TTR: 'Time-To-Recover — Days from reference date to revised component arrival',
  OTIF: 'On-Time In-Full — Contractual SLA metric; breach triggers financial penalty',
  'S&OE': 'Sales & Operations Execution — Tactical short-horizon supply chain planning',
  PPAP: 'Production Part Approval Process — Quality certification required for approved supplier parts',
  MPS: 'Master Production Schedule — Frozen production plan; cannot be changed within the frozen window',
  BOM: 'Bill of Materials — Structured list of components required to manufacture the finished product',
  MOQ: 'Minimum Order Quantity — Smallest order size a supplier will accept',
};

const PERSONA_CONFIG = {
  PLANNER: {
    icon: '⚡',
    label: 'S&OE Supply Chain Planner',
    sub: 'Triage disruption · 3d+7d gap attribution · What-if simulator',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
  },
  PLANT_LEAD: {
    icon: '🏭',
    label: 'Plant Floor / Mfg Lead',
    sub: 'WO-7782 pegging · C4 14d frozen window · Line 2 starvation',
    color: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
  },
  VP: {
    icon: '👑',
    label: 'VP Global Supply Chain',
    sub: '$30.1k vs $120k trade-off · C5 PO authorization',
    color: 'text-slate-900',
    bg: 'bg-slate-50',
    border: 'border-slate-300',
  },
  AUDIT: {
    icon: '📋',
    label: 'Governance & Audit Desk',
    sub: 'C1–C8 full matrix · Deterministic rule citations · Audit export',
    color: 'text-purple-700',
    bg: 'bg-purple-50',
    border: 'border-purple-200',
  },
};

// ─── SMALL COMPONENTS ───────────────────────────────────────────────────────

const Spinner = ({ size = 14, color = '#0f172a' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className="spin" style={{ display: 'inline-block' }}>
    <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="3" fill="none" opacity="0.25" />
    <path d="M12 2 A10 10 0 0 1 22 12" stroke={color} strokeWidth="3" fill="none" strokeLinecap="round" />
  </svg>
);

const StatusIcon = ({ pass, warn }: { pass: boolean; warn?: boolean }) => {
  if (warn) return <span style={{ color: '#f59e0b', fontSize: 13 }}>⚠</span>;
  if (pass) return <Check size={12} style={{ color: '#10b981', strokeWidth: 3 }} />;
  return <X size={12} style={{ color: '#ef4444', strokeWidth: 3 }} />;
};

const GlossaryTip = ({ term }: { term: string }) => (
  <span className="tooltip-wrap" style={{ marginLeft: 2 }}>
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 13, height: 13, borderRadius: '50%', background: '#e2e8f0',
      color: '#475569', fontSize: 9, fontWeight: 700, cursor: 'help',
      lineHeight: 1
    }}>?</span>
    <span className="tooltip-box">{term}: {GLOSSARY[term]}</span>
  </span>
);

const Tag = ({
  children, color = 'slate', size = 'sm'
}: { children: React.ReactNode; color?: 'red' | 'amber' | 'green' | 'slate' | 'navy'; size?: 'xs' | 'sm' }) => {
  const styles = {
    red: 'bg-red-50 text-red-700 border-red-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    green: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
    navy: 'bg-slate-900 text-white border-slate-800',
  };
  const sz = size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5';
  return (
    <span className={`inline-flex items-center gap-1 rounded border font-semibold font-mono ${sz} ${styles[color]}`}>
      {children}
    </span>
  );
};

// ─── GATEWAY SCREEN ─────────────────────────────────────────────────────────

const GatewayScreen = ({ onEnter }: { onEnter: (role: UserRole) => void }) => {
  const metrics = [
    { value: '400', label: 'STCOIL-440V ON-HAND', unit: 'ea' },
    { value: '5.0d', label: 'TIME-TO-SURVIVE', unit: 'TTS' },
    { value: '10d', label: 'NET SHORTAGE WINDOW', unit: 'gap' },
    { value: '$120k', label: 'OTIF EXPOSURE', unit: 'SO-55102' },
  ];

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* ── LEFT: Dark Showcase ── */}
      <div style={{
        width: '50%', minWidth: 480, flexShrink: 0,
        background: 'linear-gradient(160deg, #0f172a 0%, #1e293b 60%, #0f2444 100%)',
        display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden',
      }}>
        {/* Background texture */}
        <div style={{
          position: 'absolute', inset: 0, opacity: 0.04,
          backgroundImage: `radial-gradient(circle at 20% 50%, white 1px, transparent 1px),
            radial-gradient(circle at 80% 20%, white 1px, transparent 1px)`,
          backgroundSize: '40px 40px',
          pointerEvents: 'none',
        }} />

        {/* Top Nav */}
        <div style={{ padding: '24px 36px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 8, background: '#3b82f6',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, fontWeight: 700, color: 'white', boxShadow: '0 2px 8px rgba(59,130,246,0.4)',
            }}>⬡</div>
            <div>
              <div style={{ color: 'white', fontWeight: 700, fontSize: 14, letterSpacing: '-0.01em' }}>APEX ENTERPRISE</div>
              <div style={{ color: '#64748b', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Disruption Control Tower</div>
            </div>
          </div>
          <nav style={{ display: 'flex', gap: 20 }}>
            {['MONITOR', 'RESOLVE', 'AUTHORIZE', 'AUDIT'].map((item, i) => (
              <span key={item} style={{
                color: i === 0 ? 'white' : '#64748b', fontSize: 12, fontWeight: 600,
                letterSpacing: '0.05em', cursor: 'default',
                borderBottom: i === 0 ? '2px solid #3b82f6' : '2px solid transparent',
                paddingBottom: 2,
              }}>{item}</span>
            ))}
          </nav>
        </div>

        {/* Shipment Corridor Card */}
        <div style={{ padding: '28px 36px 0', position: 'relative', zIndex: 2 }}>
          <div className="glass-card" style={{ borderRadius: 10, padding: '14px 18px' }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.12em', marginBottom: 10 }}>
              GLOBAL SHIPMENT CORRIDOR — ACTIVE DISRUPTION
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {/* Origin */}
              <div style={{ textAlign: 'center' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', margin: '0 auto 3px', boxShadow: '0 0 6px rgba(239,68,68,0.6)' }} />
                <div style={{ fontSize: 9, color: '#ef4444', fontWeight: 700 }}>PORT KLANG, MY</div>
                <div style={{ fontSize: 8, color: '#475569' }}>Origin</div>
              </div>
              {/* Storm segment */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{
                  width: '100%', height: 1,
                  background: 'repeating-linear-gradient(90deg, #ef4444, #ef4444 4px, transparent 4px, transparent 8px)',
                  marginBottom: 2,
                }} />
                <div style={{ fontSize: 8, color: '#ef4444', fontWeight: 700 }}>⚡ +7d STORM DELAY</div>
              </div>
              {/* Destination */}
              <div style={{ textAlign: 'center' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#64748b', margin: '0 auto 3px' }} />
                <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700 }}>CHENNAI, IN</div>
                <div style={{ fontSize: 8, color: '#475569' }}>Destination</div>
              </div>
              <div style={{ color: '#334155', fontSize: 9, padding: '0 4px' }}>|</div>
              {/* Air divert */}
              <div style={{ textAlign: 'center' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', margin: '0 auto 3px', boxShadow: '0 0 6px rgba(16,185,129,0.5)' }} />
                <div style={{ fontSize: 9, color: '#10b981', fontWeight: 700 }}>STUTTGART, DE</div>
                <div style={{ fontSize: 8, color: '#475569' }}>Air Divert OPT-A</div>
              </div>
              {/* Air leg */}
              <div style={{ flex: 0.5, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ width: '100%', height: 1, background: '#10b981', marginBottom: 2 }} />
                <div style={{ fontSize: 8, color: '#10b981', fontWeight: 700 }}>✈ AIR EXPEDITE</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', margin: '0 auto 3px' }} />
                <div style={{ fontSize: 9, color: '#10b981', fontWeight: 700 }}>CHENNAI, IN</div>
                <div style={{ fontSize: 8, color: '#475569' }}>Oct 13 Arrival</div>
              </div>
            </div>
            <div style={{ marginTop: 8, fontSize: 9, color: '#64748b' }}>
              Vessel: <span style={{ color: '#94a3b8', fontWeight: 600 }}>MV Sentinel</span> · SHIP-7010 · PO-7010 · Pacific Coils Sdn Bhd
            </div>
          </div>
        </div>

        {/* Hero Content */}
        <div style={{ flex: 1, padding: '32px 36px 24px', display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative', zIndex: 2 }}>
          <div style={{ marginBottom: 12 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 600,
              color: '#22d3ee', letterSpacing: '0.1em', textTransform: 'uppercase',
              background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.2)',
              padding: '4px 10px', borderRadius: 20,
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22d3ee', display: 'inline-block' }} />
              BUILT FOR ENTERPRISE SUPPLY CHAIN RESILIENCE
            </span>
          </div>

          <h1 style={{
            fontSize: 34, fontWeight: 800, color: 'white', lineHeight: 1.15,
            letterSpacing: '-0.03em', margin: '0 0 14px', maxWidth: 420,
          }}>
            Autonomous Disruption &<br />Resolution Engine
          </h1>

          <p style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.6, maxWidth: 380, margin: '0 0 28px' }}>
            From port intelligence to verified ERP stock recovery.<br />
            Every production commitment protected.
          </p>

          {/* Feature badges */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxWidth: 400 }}>
            {[
              { icon: '⚡', title: 'SerpAPI Port Intelligence', sub: 'JOC live disruption feed' },
              { icon: '📐', title: 'Honest Gap Attribution', sub: '3d baseline + 7d storm = 10d net' },
              { icon: '🛡️', title: 'C1–C8 Deterministic Guard', sub: 'LangGraph constraint engine' },
              { icon: '✅', title: '1-Click VP PO Execution', sub: 'Rule C5 governance gate' },
            ].map(b => (
              <div key={b.title} className="glass-card" style={{
                borderRadius: 8, padding: '10px 12px',
                display: 'flex', alignItems: 'flex-start', gap: 8,
              }}>
                <span style={{ fontSize: 16, lineHeight: 1 }}>{b.icon}</span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'white', lineHeight: 1.2 }}>{b.title}</div>
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{b.sub}</div>
                </div>
                <ArrowRight size={10} style={{ color: '#475569', marginLeft: 'auto', flexShrink: 0, marginTop: 2 }} />
              </div>
            ))}
          </div>
        </div>

        {/* Metric Strip */}
        <div style={{
          background: 'rgba(0,0,0,0.25)', borderTop: '1px solid rgba(255,255,255,0.06)',
          padding: '16px 36px', display: 'flex', gap: 0,
        }}>
          {metrics.map((m, i) => (
            <div key={m.label} style={{
              flex: 1,
              borderLeft: i > 0 ? '1px solid rgba(255,255,255,0.08)' : 'none',
              paddingLeft: i > 0 ? 20 : 0,
              paddingRight: 20,
            }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'white', letterSpacing: '-0.02em', lineHeight: 1 }}>
                {m.value}
              </div>
              <div style={{ fontSize: 9, color: '#64748b', fontWeight: 600, letterSpacing: '0.08em', marginTop: 4, textTransform: 'uppercase' }}>
                {m.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── RIGHT: Workspace Entry ── */}
      <div style={{
        flex: 1, background: '#f8fafc', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: '40px 48px', overflowY: 'auto',
      }}>
        <div style={{ width: '100%', maxWidth: 440 }} className="animate-fade-in">
          {/* Brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10, background: '#0f172a',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, color: 'white', fontWeight: 700,
              boxShadow: '0 4px 12px rgba(15,23,42,0.25)',
            }}>⬡</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.01em' }}>APEX SUPPLY ORCHESTRATOR</div>
              <div style={{ fontSize: 10, color: '#94a3b8', letterSpacing: '0.05em' }}>POD-TO-CASH SETTLEMENT ENGINE</div>
            </div>
          </div>

          {/* Trust badges */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 28 }}>
            {[
              { icon: <Shield size={11} />, label: 'Enterprise Gateway' },
              { icon: <Zap size={11} />, label: 'LangGraph 2.0 Active' },
            ].map(b => (
              <div key={b.label} style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0',
                background: 'white', fontSize: 11, color: '#475569', fontWeight: 500,
                boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
              }}>
                {b.icon} {b.label}
              </div>
            ))}
          </div>

          {/* Headline */}
          <h2 style={{ fontSize: 26, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.025em', margin: '0 0 6px' }}>
            Enter Disruption Workspace
          </h2>
          <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, margin: '0 0 24px' }}>
            Select your role to access the live incident console for <span style={{ fontWeight: 600, color: '#0f172a', fontFamily: 'monospace' }}>INC-2026-PORT-KLANG-01</span>.
          </p>

          {/* Active incident pill */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '9px 14px', borderRadius: 8,
            background: '#fff1f2', border: '1px solid #fecdd3', marginBottom: 24,
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#be123c', fontFamily: 'monospace' }}>CRITICAL</span>
            <span style={{ color: '#fca5a5', fontSize: 11 }}>·</span>
            <span style={{ fontSize: 11, color: '#9f1239', fontFamily: 'monospace' }}>INC-2026-PORT-KLANG-01</span>
            <span style={{ color: '#fca5a5', fontSize: 11 }}>·</span>
            <span style={{ fontSize: 11, color: '#be123c' }}>Port Klang → Chennai</span>
          </div>

          {/* Quick Role Presets */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Quick Role Presets
              </span>
              <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500 }}>Demo Access</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(Object.entries(PERSONA_CONFIG) as [UserRole, typeof PERSONA_CONFIG.PLANNER][]).map(([role, cfg]) => (
                <button
                  key={role}
                  onClick={() => onEnter(role)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '13px 16px', borderRadius: 8,
                    background: 'white', border: '1px solid #e2e8f0',
                    cursor: 'pointer', textAlign: 'left', width: '100%',
                    boxShadow: '0 1px 3px rgba(15,23,42,0.05)',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = '#0f172a';
                    (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 12px rgba(15,23,42,0.10)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = '#e2e8f0';
                    (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 3px rgba(15,23,42,0.05)';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                      background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 16,
                    }}>{cfg.icon}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 2 }}>{cfg.label}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{cfg.sub}</div>
                    </div>
                  </div>
                  <ArrowRight size={14} style={{ color: '#94a3b8', flexShrink: 0 }} />
                </button>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#94a3b8' }}>
              <Lock size={10} /> Role-based access
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>
              Scenario pinned: 2026-10-03
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#94a3b8' }}>
              <Zap size={10} /> LangGraph connected
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── HEADER ─────────────────────────────────────────────────────────────────

const WorkspaceHeader = ({
  role, setRole, decisionExecuted, onEvidenceOpen
}: {
  role: UserRole;
  setRole: (r: UserRole) => void;
  decisionExecuted: any;
  onEvidenceOpen: () => void;
}) => {
  const steps = ['Detected', 'Assessed', 'Options Formulated', decisionExecuted ? 'Executed ✓' : 'Awaiting VP Sign-Off'];
  const activeStep = decisionExecuted ? 3 : 3;

  return (
    <header style={{
      background: 'white', borderBottom: '1px solid #e2e8f0',
      position: 'sticky', top: 0, zIndex: 40,
      boxShadow: '0 1px 3px rgba(15,23,42,0.06)',
    }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 24px', height: 54, display: 'flex', alignItems: 'center', gap: 16 }}>

        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6, background: '#0f172a',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, color: 'white', fontWeight: 700,
          }}>⬡</div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.01em', lineHeight: 1.2 }}>ApexX Enterprise</div>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>Disruption Control Tower</div>
          </div>
        </div>

        <div style={{ width: 1, height: 28, background: '#e2e8f0', flexShrink: 0 }} />

        {/* Status Stepper */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
          {steps.map((step, i) => {
            const done = i < activeStep;
            const active = i === activeStep;
            return (
              <React.Fragment key={step}>
                <span style={{
                  fontSize: 11, fontWeight: done || active ? 600 : 400,
                  color: done ? '#10b981' : active ? (decisionExecuted ? '#10b981' : '#f59e0b') : '#94a3b8',
                  display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                }}>
                  {done && <Check size={11} style={{ color: '#10b981', strokeWidth: 3 }} />}
                  {active && !decisionExecuted && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />}
                  {active && decisionExecuted && <Check size={11} style={{ color: '#10b981', strokeWidth: 3 }} />}
                  {step}
                </span>
                {i < steps.length - 1 && <span style={{ color: '#e2e8f0', fontSize: 12 }}>→</span>}
              </React.Fragment>
            );
          })}
        </div>

        {/* Right controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {/* Clock */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px',
            borderRadius: 6, background: '#f1f5f9', border: '1px solid #e2e8f0',
            fontSize: 10, color: '#475569', fontFamily: 'monospace',
          }}>
            <Clock size={10} style={{ color: '#64748b' }} />
            DATA AS OF: <strong style={{ color: '#0f172a' }}>2026-10-03 08:00 UTC</strong>
          </div>

          {/* Role switcher */}
          <div style={{
            display: 'flex', background: '#f1f5f9', borderRadius: 7,
            border: '1px solid #e2e8f0', padding: 2, gap: 2,
          }}>
            {(Object.keys(PERSONA_CONFIG) as UserRole[]).map(r => (
              <button
                key={r}
                onClick={() => setRole(r)}
                style={{
                  padding: '4px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                  border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                  background: role === r ? (r === 'VP' ? '#0f172a' : 'white') : 'transparent',
                  color: role === r ? (r === 'VP' ? 'white' : '#0f172a') : '#64748b',
                  boxShadow: role === r ? '0 1px 3px rgba(15,23,42,0.12)' : 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                {PERSONA_CONFIG[r].icon} {r === 'PLANT_LEAD' ? 'Mfg Lead' : r === 'AUDIT' ? 'Audit' : r === 'VP' ? 'VP' : 'Planner'}
              </button>
            ))}
          </div>

          {/* Evidence drawer button */}
          <button
            onClick={onEvidenceOpen}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px',
              borderRadius: 6, border: '1px solid #e2e8f0', background: 'white',
              fontSize: 11, color: '#475569', fontWeight: 500, cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(15,23,42,0.04)', transition: 'all 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = '#0f172a')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = '#e2e8f0')}
          >
            <Layers size={11} style={{ color: '#64748b' }} />
            Evidence
          </button>
        </div>
      </div>
    </header>
  );
};

// ─── KPI TILES ──────────────────────────────────────────────────────────────

const KpiTiles = ({ dossier, onFormula }: { dossier: Dossier; onFormula: (k: FormulaKey) => void }) => {
  const tiles = [
    {
      key: 'STOCKOUT' as FormulaKey,
      label: 'Stockout Date',
      sub: <><GlossaryTip term="TTS" /> TTS: {dossier.attribution_math.tts_days.toFixed(1)} Days</>,
      value: dossier.attribution_math.stockout_date,
      accent: '#ef4444',
      icon: <AlertTriangle size={13} style={{ color: '#ef4444' }} />,
    },
    {
      key: 'REVISED_ETA' as FormulaKey,
      label: 'Revised Arrival',
      sub: <><GlossaryTip term="TTR" /> +{dossier.disruption.simulated_delay_days}d Disruption Delay</>,
      value: dossier.disruption.revised_eta,
      accent: '#f59e0b',
      icon: <Truck size={13} style={{ color: '#f59e0b' }} />,
    },
    {
      key: 'GAP_ATTRIBUTION' as FormulaKey,
      label: 'Net Shortage Gap',
      sub: <>{dossier.attribution_math.baseline_gap_days}d Baseline + {dossier.attribution_math.disruption_delay_days}d Storm</>,
      value: `${dossier.attribution_math.total_shortage_gap_days} Days`,
      accent: '#ef4444',
      icon: <BarChart2 size={13} style={{ color: '#ef4444' }} />,
    },
    {
      key: 'EXPOSURE' as FormulaKey,
      label: 'OTIF Penalty Exposure',
      sub: <><GlossaryTip term="OTIF" /> SLA: {dossier.verifiable_exposure.so_due_date} (ACME)</>,
      value: `$${dossier.verifiable_exposure.otif_exposure_usd.toLocaleString()}`,
      accent: '#0f172a',
      icon: <DollarSign size={13} style={{ color: '#0f172a' }} />,
    },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
      {tiles.map(t => (
        <button
          key={t.key}
          onClick={() => onFormula(t.key)}
          style={{
            background: 'white', border: '1px solid #e2e8f0', borderRadius: 8,
            padding: '14px 16px', textAlign: 'left', cursor: 'pointer', width: '100%',
            boxShadow: '0 1px 3px rgba(15,23,42,0.06)', transition: 'all 0.15s',
            borderTop: `3px solid ${t.accent}`,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 12px rgba(15,23,42,0.10)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 3px rgba(15,23,42,0.06)'; }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 500, color: '#64748b' }}>{t.label}</span>
            {t.icon}
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace', letterSpacing: '-0.01em', marginBottom: 4 }}>
            {t.value}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: '#64748b' }}>{t.sub}</span>
            <span style={{ fontSize: 10, color: '#3b82f6', fontWeight: 500 }}>Proof →</span>
          </div>
        </button>
      ))}
    </div>
  );
};

// ─── SVG DEPLETION CHART ─────────────────────────────────────────────────────

const DepletionChart = ({ dossier, selectedOptId, delaySlider, simulating }: {
  dossier: Dossier;
  selectedOptId: string;
  delaySlider: number;
  simulating: boolean;
}) => {
  // Date-based x-position computation
  const refDate = new Date('2026-10-03');
  const W = 520, H = 160, PAD_L = 44, PAD_R = 12, PAD_T = 10, PAD_B = 0;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const maxDays = 22;

  const dayToX = (d: number) => PAD_L + (d / maxDays) * chartW;
  const qtyToY = (q: number) => PAD_T + (1 - q / 400) * chartH;

  const stockoutDay = dossier.attribution_math.tts_days;
  const origEtaDay = 8; // Oct 11 - Oct 3 = 8
  const revisedEtaDay = delaySlider + origEtaDay;
  const optADay = 10; // EuroCoils 10-day lead from Oct 3 = Oct 13

  const stockoutX = dayToX(stockoutDay);
  const origEtaX = dayToX(origEtaDay);
  const revisedEtaX = dayToX(revisedEtaDay);
  const optAX = dayToX(optADay);

  // Depletion path points
  const depPath = `M ${dayToX(0)},${qtyToY(400)} L ${dayToX(stockoutDay)},${qtyToY(0)} L ${dayToX(maxDays)},${qtyToY(0)}`;

  return (
    <div style={{ position: 'relative' }}>
      {simulating && (
        <div style={{
          position: 'absolute', top: 8, right: 8, zIndex: 5,
          display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#64748b',
          background: 'white', padding: '3px 8px', borderRadius: 4, border: '1px solid #e2e8f0',
        }}>
          <Spinner size={10} /> Recalculating...
        </div>
      )}
      <svg width="100%" viewBox={`0 0 ${W} ${H + 28}`} style={{ overflow: 'visible' }}>
        {/* Grid lines */}
        {[0, 100, 200, 300, 400].map(q => (
          <line key={q} x1={PAD_L} x2={W - PAD_R} y1={qtyToY(q)} y2={qtyToY(q)}
            stroke="#e2e8f0" strokeWidth={q === 0 ? 1.5 : 0.75} />
        ))}

        {/* Y-axis labels */}
        {[0, 200, 400].map(q => (
          <text key={q} x={PAD_L - 4} y={qtyToY(q) + 3} textAnchor="end"
            fontSize={8} fill="#94a3b8" fontFamily="monospace">{q}</text>
        ))}
        <text x={PAD_L - 4} y={PAD_T - 4} textAnchor="end" fontSize={7} fill="#94a3b8" fontFamily="monospace">ea</text>

        {/* Baseline gap zone (amber) */}
        <rect x={stockoutX} y={PAD_T} width={origEtaX - stockoutX} height={chartH}
          fill="#fef3c7" stroke="#f59e0b" strokeWidth={0.75} strokeDasharray="3 2" />
        <text x={(stockoutX + origEtaX) / 2} y={PAD_T + 18} textAnchor="middle"
          fontSize={8} fill="#b45309" fontWeight="bold" fontFamily="monospace">BASELINE</text>
        <text x={(stockoutX + origEtaX) / 2} y={PAD_T + 28} textAnchor="middle"
          fontSize={7} fill="#b45309" fontFamily="monospace">3d deficit</text>

        {/* Disruption gap zone (red) */}
        <rect x={origEtaX} y={PAD_T} width={Math.max(0, revisedEtaX - origEtaX)} height={chartH}
          fill="#fee2e2" stroke="#ef4444" strokeWidth={0.75} strokeDasharray="4 2" />
        {revisedEtaX - origEtaX > 40 && (
          <>
            <text x={(origEtaX + revisedEtaX) / 2} y={PAD_T + 16} textAnchor="middle"
              fontSize={8} fill="#b91c1c" fontWeight="bold" fontFamily="monospace">DISRUPTION</text>
            <text x={(origEtaX + revisedEtaX) / 2} y={PAD_T + 26} textAnchor="middle"
              fontSize={7} fill="#b91c1c" fontFamily="monospace">+{delaySlider}d delay</text>
          </>
        )}

        {/* OPT-A residual gap (green overlay) */}
        {selectedOptId === 'OPT-A' && (
          <rect x={stockoutX} y={PAD_T} width={optAX - stockoutX} height={chartH}
            fill="rgba(16,185,129,0.15)" stroke="#10b981" strokeWidth={1} strokeDasharray="4 2" />
        )}

        {/* Depletion curve */}
        <path d={depPath} stroke="#0f172a" strokeWidth={2} fill="none" />
        <circle cx={dayToX(0)} cy={qtyToY(400)} r={3} fill="#0f172a" />
        <circle cx={stockoutX} cy={qtyToY(0)} r={4} fill="#ef4444" />

        {/* Original ETA vertical */}
        <line x1={origEtaX} y1={PAD_T} x2={origEtaX} y2={H} stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 2" />

        {/* Revised ETA vertical (unmitigated) */}
        <line x1={revisedEtaX} y1={PAD_T} x2={revisedEtaX} y2={H} stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 2" />
        <path d={`M ${revisedEtaX},${qtyToY(0)} L ${revisedEtaX},${PAD_T + 20} L ${Math.min(W - PAD_R, revisedEtaX + 60)},${PAD_T + 20}`}
          stroke="#94a3b8" strokeWidth={1.5} fill="none" />

        {/* OPT-A inflow spike */}
        {selectedOptId === 'OPT-A' && (
          <>
            <line x1={optAX} y1={qtyToY(0)} x2={optAX} y2={PAD_T + 10} stroke="#10b981" strokeWidth={2} />
            <path d={`M ${optAX},${PAD_T + 10} L ${Math.min(W - PAD_R - 4, optAX + 80)},${PAD_T + 10}`}
              stroke="#10b981" strokeWidth={1.5} fill="none" markerEnd="url(#arrowGreen)" />
            <circle cx={optAX} cy={qtyToY(0)} r={4} fill="#10b981" />
            <text x={optAX + 4} y={PAD_T + 8} fontSize={7.5} fill="#15803d" fontWeight="bold" fontFamily="monospace">
              EuroCoils Air (Oct 13)
            </text>
          </>
        )}

        {/* Arrow marker */}
        <defs>
          <marker id="arrowGreen" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#10b981" />
          </marker>
        </defs>

        {/* X-axis labels */}
        <text x={dayToX(0)} y={H + 14} textAnchor="middle" fontSize={8} fill="#94a3b8" fontFamily="monospace">Oct 03</text>
        <text x={stockoutX} y={H + 14} textAnchor="middle" fontSize={8} fill="#ef4444" fontFamily="monospace" fontWeight="bold">Oct 08↑STCKOUT</text>
        <text x={origEtaX} y={H + 14} textAnchor="middle" fontSize={8} fill="#b45309" fontFamily="monospace">Oct 11</text>
        {selectedOptId === 'OPT-A' && (
          <text x={optAX} y={H + 22} textAnchor="middle" fontSize={8} fill="#10b981" fontFamily="monospace" fontWeight="bold">Oct 13</text>
        )}
        <text x={Math.min(revisedEtaX, W - PAD_R - 20)} y={H + 22} textAnchor="middle" fontSize={8} fill="#94a3b8" fontFamily="monospace">
          {dossier.disruption.revised_eta}
        </text>
      </svg>
    </div>
  );
};

// ─── PEGGING CHAIN ───────────────────────────────────────────────────────────

const PeggingChain = ({ dossier }: { dossier: Dossier }) => {
  const nodes = [
    { id: dossier.disruption.shipment_id, label: 'Shipment', detail: `Vessel: ${dossier.disruption.vessel_name}`, date: `ETA: ${dossier.disruption.revised_eta}`, status: 'warn' },
    { id: dossier.disruption.material_id, label: 'Material', detail: `${dossier.attribution_math.on_hand_qty} on-hand`, date: `Stockout: ${dossier.attribution_math.stockout_date}`, status: 'critical' },
    { id: dossier.verifiable_exposure.work_order_id, label: 'Work Order', detail: `Line 2 · ${dossier.verifiable_exposure.wo_duration_days}d duration`, date: `Start: ${dossier.verifiable_exposure.wo_planned_start}`, status: 'warn' },
    { id: dossier.verifiable_exposure.customer_order_id, label: 'Customer Order', detail: dossier.verifiable_exposure.customer_name, date: `Due: ${dossier.verifiable_exposure.so_due_date}`, status: 'critical' },
  ];

  const statusColor: Record<string, string> = { warn: '#f59e0b', critical: '#ef4444', ok: '#10b981' };

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0 }}>
      {nodes.map((n, i) => (
        <React.Fragment key={n.id}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              background: 'white', border: `1px solid ${n.status === 'critical' ? '#fecdd3' : '#e2e8f0'}`,
              borderTop: `3px solid ${statusColor[n.status]}`,
              borderRadius: 8, padding: '10px 12px',
              boxShadow: '0 1px 3px rgba(15,23,42,0.05)',
            }}>
              <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 3 }}>{n.label.toUpperCase()}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace', marginBottom: 2 }}>{n.id}</div>
              <div style={{ fontSize: 10, color: '#64748b', marginBottom: 3 }}>{n.detail}</div>
              <div style={{ fontSize: 10, fontWeight: 600, color: statusColor[n.status], fontFamily: 'monospace' }}>{n.date}</div>
            </div>
          </div>
          {i < nodes.length - 1 && (
            <div style={{ display: 'flex', alignItems: 'center', padding: '0 4px', flexShrink: 0, marginTop: 20 }}>
              <ChevronRight size={14} style={{ color: '#94a3b8' }} />
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

// ─── CONSTRAINT MATRIX ───────────────────────────────────────────────────────

const ConstraintMatrix = ({ dossier, selectedId, onSelect }: {
  dossier: Dossier;
  selectedId: string;
  onSelect: (id: string) => void;
}) => {
  const survivorCount = dossier.recovery_options_matrix.filter(o => o.status !== 'VETOED').length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'monospace' }}>
            Constraint Matrix C1–C8
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 1 }}>Options × Hard Rules</div>
        </div>
        <Tag color={survivorCount > 0 ? 'green' : 'red'} size="xs">
          {survivorCount} Feasible Survivor{survivorCount !== 1 ? 's' : ''}
        </Tag>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
              <th style={{ padding: '6px 8px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: 10 }}>OPTION</th>
              <th style={{ padding: '6px 4px', textAlign: 'center', color: '#64748b', fontSize: 9 }}>MODE</th>
              {['C1','C2','C3','C4','C5','C6','C7','C8'].map(c => (
                <th key={c} style={{ padding: '6px 4px', textAlign: 'center' }}>
                  <span className="tooltip-wrap">
                    <span style={{ color: '#475569', fontWeight: 700, cursor: 'help', fontSize: 10 }}>{c}</span>
                    <span className="tooltip-box">{RULE_DEFINITIONS[c]}</span>
                  </span>
                </th>
              ))}
              <th style={{ padding: '6px 4px', textAlign: 'right', color: '#64748b', fontWeight: 600, fontSize: 10 }}>COST</th>
              <th style={{ padding: '6px 4px', textAlign: 'center', color: '#64748b', fontWeight: 600, fontSize: 10 }}>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {dossier.recovery_options_matrix.map(opt => {
              const isSel = selectedId === opt.option_id;
              const isPass = opt.status !== 'VETOED';
              return (
                <tr
                  key={opt.option_id}
                  onClick={() => onSelect(opt.option_id)}
                  style={{
                    borderBottom: '1px solid #f1f5f9', cursor: 'pointer', transition: 'background 0.1s',
                    background: isSel ? '#eff6ff' : 'white',
                  }}
                  onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLTableRowElement).style.background = '#f8fafc'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = isSel ? '#eff6ff' : 'white'; }}
                >
                  <td style={{ padding: '8px 8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: isPass ? '#10b981' : '#ef4444', flexShrink: 0 }} />
                      <div>
                        <div style={{ fontWeight: 700, color: '#0f172a', fontFamily: 'monospace', fontSize: 10 }}>{opt.option_id}</div>
                        <div style={{ fontSize: 9, color: '#64748b', maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {opt.supplier_name.split(' ')[0]}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', fontSize: 9, color: '#64748b', fontFamily: 'monospace' }}>
                    {opt.freight_mode === 'AIR' ? '✈ AIR' : opt.freight_mode === 'SEA' ? '⛵ SEA' : opt.freight_mode === 'LAND' ? '🚛 LAND' : '—'}
                  </td>
                  {['C1','C2','C3','C4','C5','C6','C7','C8'].map(cid => {
                    const r = opt.rules[cid];
                    return (
                      <td key={cid} style={{ padding: '8px 4px', textAlign: 'center' }}>
                        <span className="tooltip-wrap">
                          <StatusIcon pass={r.pass} warn={cid === 'C5' ? r.warning : false} />
                          <span className="tooltip-box">{r.reason}</span>
                        </span>
                      </td>
                    );
                  })}
                  <td style={{ padding: '8px 4px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#0f172a', fontSize: 10 }}>
                    {opt.estimated_cost_usd > 0 ? `$${(opt.estimated_cost_usd / 1000).toFixed(1)}k` : '—'}
                  </td>
                  <td style={{ padding: '8px 4px', textAlign: 'center' }}>
                    <Tag color={isPass ? 'green' : 'red'} size="xs">
                      {isPass ? 'SURVIVOR' : 'VETOED'}
                    </Tag>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── OPTION DETAIL PANEL ─────────────────────────────────────────────────────

const OptionDetail = ({ opt }: { opt: OptionItem }) => {
  const isPass = opt.status !== 'VETOED';
  return (
    <div style={{
      marginTop: 12, padding: '12px 14px', background: '#f8fafc',
      borderRadius: 8, border: `1px solid ${isPass ? '#a7f3d0' : '#fecdd3'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', marginBottom: 2, fontFamily: 'monospace' }}>
            {opt.option_id}: {opt.supplier_name}
          </div>
          <div style={{ fontSize: 10, color: '#64748b' }}>{opt.location} · {opt.category_label}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: '#0f172a' }}>
            {opt.arrival_date !== 'Schedule Shift (No Inflow)' ? `Arrives: ${opt.arrival_date}` : 'No inflow'}
          </div>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#64748b' }}>
            Cost: {opt.estimated_cost_usd > 0 ? `$${opt.estimated_cost_usd.toLocaleString()}` : 'No cost'}
          </div>
        </div>
      </div>

      <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.5, marginBottom: 8 }}>{opt.description}</div>

      {/* Residual gap */}
      {isPass && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 10px', background: opt.residual_gap_days > 0 ? '#fffbeb' : '#f0fdf4',
          border: `1px solid ${opt.residual_gap_days > 0 ? '#fde68a' : '#a7f3d0'}`,
          borderRadius: 6, fontSize: 11, fontFamily: 'monospace',
        }}>
          <span style={{ color: '#475569' }}>Residual shortage gap after arrival:</span>
          <strong style={{ color: opt.residual_gap_days > 0 ? '#b45309' : '#15803d' }}>
            {opt.residual_gap_days} days {opt.residual_gap_days > 0 ? '(covered by safety stock draw)' : '(fully bridged)'}
          </strong>
        </div>
      )}

      {/* Veto reasons */}
      {!isPass && opt.hard_vetoes.length > 0 && (
        <div style={{ marginTop: 8, padding: '8px 10px', background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 6 }}>
          {opt.hard_vetoes.map(v => (
            <div key={v} style={{ display: 'flex', gap: 6, fontSize: 11, color: '#be123c', lineHeight: 1.4, marginBottom: 3 }}>
              <X size={11} style={{ flexShrink: 0, color: '#ef4444', marginTop: 1 }} />
              <span><strong>{v}:</strong> {opt.rules[v].reason}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── PLANNER VIEW ────────────────────────────────────────────────────────────

const PlannerView = ({ dossier, setDossier }: { dossier: Dossier; setDossier: (d: Dossier) => void }) => {
  const [delaySlider, setDelaySlider] = useState(7);
  const [selectedOptId, setSelectedOptId] = useState('OPT-A');
  const [simulating, setSimulating] = useState(false);
  const [activeFormula, setActiveFormula] = useState<FormulaKey>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSlider = useCallback((val: number) => {
    setDelaySlider(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSimulating(true);
      fetch('/api/simulate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delay_days: val, as_of: '2026-10-03' }),
      })
        .then(r => r.json())
        .then(data => { if (data.dossier) setDossier(data.dossier); })
        .finally(() => setSimulating(false));
    }, 300);
  }, [setDossier]);

  const selectedOpt = dossier.recovery_options_matrix.find(o => o.option_id === selectedOptId) || dossier.recovery_options_matrix[0];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: 16 }}>
      {/* LEFT: Chart + slider + pegging chain */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Chart card */}
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: '16px 18px', boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sliders size={12} style={{ color: '#0f172a' }} />
                Digital Twin: Inventory Depletion Curve
              </div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                Separates pre-existing 3d planning deficit from +{delaySlider}d storm disruption
              </div>
            </div>
            <Tag color="slate" size="xs">SIMULATED: +{delaySlider}d DELAY</Tag>
          </div>

          {/* Slider */}
          <div style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 14px', border: '1px solid #e2e8f0', marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#64748b', marginBottom: 8, fontFamily: 'monospace' }}>
              <span>0d (On-Time Baseline)</span>
              <span style={{ fontWeight: 700, color: '#0f172a' }}>
                Simulate Delay: +{delaySlider} Days{simulating && <> <Spinner size={9} /></>}
              </span>
              <span>20d (Severe Congestion)</span>
            </div>
            <input
              type="range" min={0} max={20} value={delaySlider}
              onChange={e => handleSlider(parseInt(e.target.value))}
              aria-label="Simulated storm delay in days"
              aria-live="polite"
            />
          </div>

          <DepletionChart dossier={dossier} selectedOptId={selectedOptId} delaySlider={delaySlider} simulating={simulating} />
        </div>

        {/* Pegging chain */}
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: 10 }}>
            Ontology Pegging Chain — Date-Tagged Nodes
          </div>
          <PeggingChain dossier={dossier} />
        </div>
      </div>

      {/* RIGHT: C1-C8 Matrix + Detail */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}>
          <ConstraintMatrix dossier={dossier} selectedId={selectedOptId} onSelect={setSelectedOptId} />
          <OptionDetail opt={selectedOpt} />
        </div>
      </div>

      {/* Formula Modal */}
      {activeFormula && (
        <FormulaModal dossier={dossier} formulaKey={activeFormula} onClose={() => setActiveFormula(null)} />
      )}
    </div>
  );
};

// ─── PLANT LEAD VIEW ─────────────────────────────────────────────────────────

const PlantLeadView = ({ dossier }: { dossier: Dossier }) => {
  const vetoed = dossier.recovery_options_matrix.filter(o => o.status === 'VETOED');
  const optA = dossier.recovery_options_matrix.find(o => o.option_id === 'OPT-A');

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16 }}>
      {/* LEFT: Vertical pegging tree */}
      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: '16px', boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: 16 }}>
          Production Pegging Tree
        </div>
        {[
          { id: dossier.disruption.shipment_id, type: 'Shipment', detail: `MV Sentinel · PO-7010`, date: `Revised ETA: ${dossier.disruption.revised_eta}`, status: 'warn', badge: null },
          { id: dossier.disruption.material_id, type: 'Component', detail: `${dossier.attribution_math.on_hand_qty} on-hand · 80/day burn`, date: `Stockout: ${dossier.attribution_math.stockout_date}`, status: 'critical', badge: null },
          { id: dossier.verifiable_exposure.work_order_id, type: 'Work Order', detail: `Assembly Line 2 · 3-day production run`, date: `Planned Start: ${dossier.verifiable_exposure.wo_planned_start}`, status: 'warn', badge: 'FROZEN WINDOW' },
          { id: 'APEXM-100', type: 'Finished Good', detail: `ApexX-100 Motor Drive Unit`, date: `500 units for SO-55102`, status: 'warn', badge: null },
          { id: dossier.verifiable_exposure.customer_order_id, type: 'Customer Order', detail: `${dossier.verifiable_exposure.customer_name}`, date: `SLA Due: ${dossier.verifiable_exposure.so_due_date}`, status: 'critical', badge: '$120k OTIF' },
        ].map((node, i, arr) => (
          <div key={node.id} style={{ display: 'flex', gap: 0 }}>
            {/* Connector line + dot */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 20, flexShrink: 0 }}>
              {i > 0 && <div style={{ width: 2, height: 12, background: '#e2e8f0', flexShrink: 0 }} />}
              <div style={{
                width: 10, height: 10, borderRadius: '50%', flexShrink: 0, marginTop: i === 0 ? 4 : 0,
                background: node.status === 'critical' ? '#ef4444' : '#f59e0b',
                border: '2px solid white', boxShadow: '0 0 0 2px ' + (node.status === 'critical' ? '#fee2e2' : '#fef3c7'),
              }} />
              {i < arr.length - 1 && <div style={{ width: 2, flex: 1, background: '#e2e8f0', minHeight: 10 }} />}
            </div>

            {/* Node card */}
            <div style={{ flex: 1, marginBottom: 8, marginLeft: 8 }}>
              <div style={{
                background: node.status === 'critical' ? '#fff1f2' : '#fffbeb',
                border: `1px solid ${node.status === 'critical' ? '#fecdd3' : '#fde68a'}`,
                borderRadius: 8, padding: '8px 10px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>{node.type}</span>
                  {node.badge && (
                    <span style={{
                      fontSize: 8, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
                      background: node.badge.includes('FROZEN') ? '#dbeafe' : '#fee2e2',
                      color: node.badge.includes('FROZEN') ? '#1d4ed8' : '#be123c',
                      border: node.badge.includes('FROZEN') ? '1px solid #bfdbfe' : '1px solid #fecdd3',
                    }}>{node.badge}</span>
                  )}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace', marginBottom: 2 }}>{node.id}</div>
                <div style={{ fontSize: 10, color: '#64748b', marginBottom: 2 }}>{node.detail}</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: node.status === 'critical' ? '#be123c' : '#b45309', fontFamily: 'monospace' }}>{node.date}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* RIGHT: Veto analysis + OPT-A impact */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Vetoed options */}
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: '16px', boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: 12 }}>
            Vetoed Options — Constraint Citations
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {vetoed.map(opt => (
              <div key={opt.option_id} style={{ border: '1px solid #fecdd3', borderRadius: 8, padding: '12px', background: '#fff1f2' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <XCircle size={13} style={{ color: '#ef4444' }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>{opt.option_id}</span>
                  <span style={{ fontSize: 10, color: '#64748b' }}>— {opt.supplier_name.split(' ')[0]}</span>
                </div>
                <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8 }}>{opt.category_label}</div>
                {opt.hard_vetoes.map(v => (
                  <div key={v} style={{ fontSize: 10, color: '#be123c', lineHeight: 1.5, marginBottom: 4 }}>
                    <strong style={{ fontFamily: 'monospace' }}>{v}:</strong> {opt.rules[v].reason}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* OPT-A impact timeline */}
        {optA && (
          <div style={{ background: 'white', border: '1px solid #a7f3d0', borderRadius: 10, padding: '16px', boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <CheckCircle2 size={15} style={{ color: '#10b981' }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'monospace' }}>
                OPT-A: Production Impact Timeline
              </span>
              <Tag color="green" size="xs">SURVIVOR — WO-7782 UNAFFECTED</Tag>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {[
                { label: 'EuroCoils Air Arrives', date: '2026-10-13', note: '5d residual gap (safety stock)', color: '#10b981' },
                { label: 'WO-7782 Starts', date: '2026-10-14', note: 'Parts available from Oct 13', color: '#f59e0b' },
                { label: 'Production Completes', date: '2026-10-17', note: '3-day run, Line 2', color: '#475569' },
                { label: 'ACME Delivery', date: '2026-10-19', note: 'SLA met ✓ $120k protected', color: '#10b981' },
              ].map((step, i, arr) => (
                <React.Fragment key={step.label}>
                  <div style={{ flex: '0 0 auto', textAlign: 'center', maxWidth: 130 }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: '50%', background: step.color,
                      margin: '0 auto 4px', boxShadow: `0 0 0 3px ${step.color}20`,
                    }} />
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace', marginBottom: 1 }}>{step.date}</div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: '#334155', marginBottom: 2 }}>{step.label}</div>
                    <div style={{ fontSize: 9, color: '#64748b' }}>{step.note}</div>
                  </div>
                  {i < arr.length - 1 && (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 20 }}>
                      <div style={{ width: '100%', height: 2, background: 'linear-gradient(90deg, #e2e8f0, #10b981)', borderRadius: 1 }} />
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── VP VIEW ─────────────────────────────────────────────────────────────────

const VPView = ({ dossier, onApprove, onDecline, onEscalate, decisionExecuted }: {
  dossier: Dossier;
  onApprove: () => void;
  onDecline: () => void;
  onEscalate: () => void;
  decisionExecuted: any;
}) => {
  const es = dossier.executive_summary;
  const ex = dossier.verifiable_exposure;

  if (decisionExecuted?.action === 'APPROVE') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, textAlign: 'center', gap: 20 }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#f0fdf4', border: '2px solid #a7f3d0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CheckCircle2 size={32} style={{ color: '#10b981' }} />
        </div>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', margin: '0 0 8px' }}>PO Issued Successfully</h2>
          <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 16px' }}>EuroCoils GmbH air freight expedite authorized under Rule C5</p>
          <Tag color="green">{decisionExecuted.po_number}</Tag>
        </div>
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: '16px 24px', maxWidth: 380, width: '100%', textAlign: 'left' }}>
          {[
            ['Supplier', 'EuroCoils GmbH (Stuttgart, Germany)'],
            ['Material', 'STCOIL-440V · 900 Units'],
            ['Freight', 'AIR_EXPEDITE (Pre-Cleared)'],
            ['Arrival', '2026-10-13 · WO-7782 unaffected'],
            ['Authorized Spend', '$30,150.00'],
            ['Authorized By', `${decisionExecuted.approver_role} (Rule C5 Gate)`],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f1f5f9', fontSize: 12 }}>
              <span style={{ color: '#64748b' }}>{k}</span>
              <span style={{ color: '#0f172a', fontWeight: 600, fontFamily: 'monospace' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 16, maxWidth: 960, margin: '0 auto' }}>
      {/* LEFT: Trade-off summary */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Gemini briefing */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              AI Executive Briefing — Gemini Dual-Verification
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              `Vessel MV Sentinel, carrying 900 units of STCOIL-440V from Pacific Coils Sdn Bhd (Port Klang), has been delayed +7 days by tropical weather congestion, revising ETA from Oct 11 to Oct 18.`,
              `Without action, Assembly Line 2 will starve on Oct 8 (TTS = 5d). Work Order WO-7782 cannot start until Oct 18, completing Oct 21 — 2 days past ACME Corp's contractual SLA (Oct 19), triggering $120,000 in OTIF penalties.`,
              `OPT-A (EuroCoils GmbH air freight, $30,150) arrives Oct 13, preserving WO-7782's Oct 14 start date. The 5-day residual gap (Oct 8–13) is covered by safety stock draw. All 8 enterprise constraints (C1–C8) satisfied. VP sign-off required under Rule C5 (spend exceeds $30k threshold).`,
            ].map((text, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12, color: '#334155', lineHeight: 1.6 }}>
                <span style={{ color: '#94a3b8', fontWeight: 700, flexShrink: 0, fontSize: 11, marginTop: 1 }}>{i + 1}.</span>
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Trade-off table */}
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: '16px', boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: 12 }}>
            Financial Trade-Off Summary
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                {['', 'Amount', 'Details'].map(h => (
                  <th key={h} style={{ padding: '6px 8px', textAlign: h === 'Amount' ? 'right' : 'left', fontSize: 10, color: '#64748b', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'Air Freight Spend (OPT-A)', amount: `$${es.expedite_cost_usd.toLocaleString()}`, detail: 'EuroCoils GmbH Stuttgart · 10-day lead', color: '#475569' },
                { label: 'OTIF Penalty Avoided', amount: `$${es.penalty_avoided_usd.toLocaleString()}`, detail: `SO-55102 · ACME Corp · due ${ex.so_due_date}`, color: '#10b981' },
                { label: 'Net Value Protected', amount: `+$${es.net_value_saved_usd.toLocaleString()}`, detail: 'Penalty protection net of freight cost', color: '#10b981' },
                { label: 'Return on Spend', amount: `${es.roi_ratio}×`, detail: `$${es.net_value_saved_usd.toLocaleString()} ÷ $${es.expedite_cost_usd.toLocaleString()} (spend efficiency, not revenue ROI)`, color: '#0f172a' },
              ].map((row, i) => (
                <tr key={row.label} style={{ borderBottom: '1px solid #f1f5f9', background: i === 3 ? '#f8fafc' : 'white' }}>
                  <td style={{ padding: '10px 8px', fontSize: 12, fontWeight: i >= 2 ? 700 : 400, color: '#0f172a' }}>{row.label}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', fontSize: 14, fontWeight: 700, color: row.color, fontFamily: 'monospace' }}>{row.amount}</td>
                  <td style={{ padding: '10px 8px', fontSize: 10, color: '#64748b' }}>{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* RIGHT: PO Preview + Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: '16px', boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: 12 }}>
            Purchase Order Preview
          </div>
          {[
            ['Supplier', 'EuroCoils GmbH (Stuttgart, DE)'],
            ['Material', 'STCOIL-440V · 900 Units'],
            ['Freight Mode', 'AIR_EXPEDITE (Pre-Cleared)'],
            ['Est. Arrival', '2026-10-13'],
            ['Authorized Spend', `$${es.expedite_cost_usd.toLocaleString()}.00`],
            ['Cost Center', 'CC-APEX-SUPPLY-CHAIN'],
            ['Governance Gate', 'Rule C5: VP Sign-Off Required'],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f1f5f9', fontSize: 11 }}>
              <span style={{ color: '#64748b' }}>{k}</span>
              <span style={{ color: k === 'Governance Gate' ? '#b45309' : '#0f172a', fontWeight: 600, fontFamily: 'monospace', textAlign: 'right', maxWidth: 170 }}>{v}</span>
            </div>
          ))}
        </div>

        {/* C5 notice */}
        <div style={{ padding: '10px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 11, color: '#92400e', lineHeight: 1.5 }}>
          <strong>Rule C5 Gate:</strong> Air freight cost $30,150 exceeds $30,000 threshold requiring VP Supply Chain authorization. Plant Manager cannot approve.
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={onApprove}
            style={{
              width: '100%', padding: '14px', borderRadius: 8, border: 'none',
              background: '#0f172a', color: 'white', fontSize: 14, fontWeight: 700,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 8, boxShadow: '0 4px 12px rgba(15,23,42,0.25)', transition: 'all 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#1e293b')}
            onMouseLeave={e => (e.currentTarget.style.background = '#0f172a')}
          >
            <CheckCircle2 size={16} style={{ color: '#10b981' }} />
            Approve & Issue PO
          </button>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button
              onClick={onEscalate}
              style={{
                padding: '10px', borderRadius: 8, border: '1px solid #e2e8f0',
                background: 'white', color: '#475569', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = '#94a3b8')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = '#e2e8f0')}
            >
              Escalate to S&OE Board
            </button>
            <button
              onClick={onDecline}
              style={{
                padding: '10px', borderRadius: 8, border: '1px solid #e2e8f0',
                background: 'white', color: '#475569', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = '#94a3b8')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = '#e2e8f0')}
            >
              Decline
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── AUDIT VIEW ──────────────────────────────────────────────────────────────

const AuditView = ({ dossier, decisionExecuted }: { dossier: Dossier; decisionExecuted: any }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Full C1-C8 Matrix */}
      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: '16px', boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'monospace' }}>
            Full C1–C8 Constraint Verification Matrix
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: 'white', fontSize: 10, color: '#475569', cursor: 'pointer', fontWeight: 500 }}>
              <Download size={10} /> Export PDF
            </button>
            <button style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: 'white', fontSize: 10, color: '#475569', cursor: 'pointer', fontWeight: 500 }}>
              <Download size={10} /> Export CSV
            </button>
          </div>
        </div>
        <ConstraintMatrix dossier={dossier} selectedId="" onSelect={() => {}} />
      </div>

      {/* Rule definitions */}
      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: '16px', boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: 12 }}>
          Rule Definitions
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {Object.entries(RULE_DEFINITIONS).map(([id, def]) => (
            <div key={id} style={{ display: 'flex', gap: 8, padding: '8px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 11 }}>
              <Tag color="slate" size="xs">{id}</Tag>
              <span style={{ color: '#475569', lineHeight: 1.4 }}>{def}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Audit ledger */}
      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: '16px', boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: 12 }}>
          Immutable Audit Ledger
        </div>
        {decisionExecuted ? (
          <div style={{ padding: '12px 14px', background: '#f0fdf4', border: '1px solid #a7f3d0', borderRadius: 8, fontFamily: 'monospace', fontSize: 11 }}>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <span><strong>Decision:</strong> {decisionExecuted.decision_id}</span>
              <span><strong>Action:</strong> {decisionExecuted.action}</span>
              <span><strong>Option:</strong> {decisionExecuted.option_id}</span>
              {decisionExecuted.po_number && <span><strong>PO:</strong> {decisionExecuted.po_number}</span>}
              <span><strong>By:</strong> {decisionExecuted.approver_role}</span>
              <span><strong>Time:</strong> {new Date(decisionExecuted.timestamp).toLocaleString()}</span>
            </div>
          </div>
        ) : (
          <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: 12, fontFamily: 'monospace' }}>
            No authorizations recorded. Pending VP sign-off for INC-2026-PORT-KLANG-01.
          </div>
        )}
      </div>
    </div>
  );
};

// ─── FORMULA MODAL ───────────────────────────────────────────────────────────

const FormulaModal = ({ dossier, formulaKey, onClose }: { dossier: Dossier; formulaKey: FormulaKey; onClose: () => void }) => {
  const ex = dossier.verifiable_exposure;
  const am = dossier.attribution_math;

  const content: Record<string, { title: string; formula: string; explanation: string }> = {
    STOCKOUT: {
      title: 'Time-To-Survive (TTS) Calculation',
      formula: am.tts_formula,
      explanation: `On-hand inventory at reference date (2026-10-03) is ${am.on_hand_qty} coils. At ${am.daily_burn_rate} coils/day burn rate (40 drives/day × 2 coils/drive), the plant exhausts inventory exactly on Day ${am.tts_days.toFixed(1)} — Stockout Date: ${am.stockout_date}.`,
    },
    REVISED_ETA: {
      title: 'Revised ETA Calculation (TTR)',
      formula: `Original ETA ${dossier.disruption.original_eta} + ${dossier.disruption.simulated_delay_days}d Storm Delay = Revised ETA ${dossier.disruption.revised_eta}`,
      explanation: `Pacific Coils Sdn Bhd's vessel MV Sentinel had a planned arrival of ${dossier.disruption.original_eta}. Tropical weather congestion at Port Klang added ${dossier.disruption.simulated_delay_days} days of delay. TTR from reference date = ${(new Date(dossier.disruption.revised_eta).getTime() - new Date('2026-10-03').getTime()) / 86400000} days.`,
    },
    GAP_ATTRIBUTION: {
      title: 'Honest Gap Attribution Proof',
      formula: am.gap_equation,
      explanation: `${am.baseline_explanation}. The storm is responsible for ${am.disruption_delay_days} days, while pre-existing planning was already short by ${am.baseline_gap_days} days. Attributing the full gap to the storm would be inaccurate.`,
    },
    EXPOSURE: {
      title: 'Verifiable OTIF Penalty Proof',
      formula: `500 Units × $240 Unit Price = $${ex.otif_exposure_usd.toLocaleString()} OTIF Penalty Exposure`,
      explanation: ex.proof_narrative,
    },
  };

  if (!formulaKey || !content[formulaKey]) return null;
  const c = content[formulaKey];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)', padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: 'white', borderRadius: 12, padding: 24, maxWidth: 520, width: '100%',
        boxShadow: '0 20px 60px rgba(15,23,42,0.22)', position: 'relative',
      }} onClick={e => e.stopPropagation()} className="animate-fade-in">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Shield size={14} style={{ color: '#0f172a' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'monospace' }}>
              Verifiable Arithmetic Proof
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
            <X size={16} style={{ color: '#94a3b8' }} />
          </button>
        </div>
        <h4 style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', margin: '0 0 10px' }}>{c.title}</h4>
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', fontFamily: 'monospace', fontSize: 12, color: '#0f172a', fontWeight: 700, marginBottom: 12 }}>
          {c.formula}
        </div>
        <p style={{ fontSize: 12, color: '#475569', lineHeight: 1.7, margin: 0 }}>{c.explanation}</p>
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '7px 16px', borderRadius: 6, background: '#0f172a', color: 'white', fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
            Close Proof
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── EVIDENCE DRAWER ─────────────────────────────────────────────────────────

const EvidenceDrawer = ({ onClose, decisionExecuted }: { onClose: () => void; decisionExecuted: any }) => {
  const [tab, setTab] = useState<EvidenceTab>('SERP');

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50 }} onClick={onClose}>
      {/* Backdrop */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.3)' }} />
      {/* Panel */}
      <div
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, width: '100%', maxWidth: 460,
          background: 'white', borderLeft: '1px solid #e2e8f0',
          boxShadow: '-8px 0 32px rgba(15,23,42,0.12)', display: 'flex', flexDirection: 'column',
          padding: 0, overflowY: 'auto',
        }}
        className="animate-slide-right"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '18px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Layers size={14} style={{ color: '#64748b' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'monospace' }}>
              Evidence & Intelligence Drawer
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={16} style={{ color: '#94a3b8' }} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', padding: '12px 20px 0', gap: 6, borderBottom: '1px solid #e2e8f0' }}>
          {(['SERP', 'AIS', 'AUDIT'] as EvidenceTab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '7px 14px', borderRadius: '6px 6px 0 0', fontSize: 11, fontWeight: 600,
                border: '1px solid ' + (tab === t ? '#e2e8f0' : 'transparent'),
                borderBottom: tab === t ? '1px solid white' : '1px solid transparent',
                background: tab === t ? 'white' : 'transparent',
                color: tab === t ? '#0f172a' : '#64748b', cursor: 'pointer',
                marginBottom: -1,
              }}
            >
              {t === 'SERP' ? 'SerpAPI Signal' : t === 'AIS' ? 'Vessel AIS' : 'Audit Ledger'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, padding: '18px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tab === 'SERP' && (
            <>
              <div style={{ padding: '10px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 4 }}>AGENT STATUS</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>DISRUPTION_DETECTED</span>
                  <span style={{ fontSize: 10, color: '#64748b' }}>2026-10-03T06:18:50 UTC</span>
                </div>
              </div>
              <div style={{ padding: '10px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 4 }}>SEARCH QUERY</div>
                <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#0f172a', fontWeight: 600 }}>
                  Port Klang port disruption OR delay OR strike OR weather
                </div>
              </div>
              <div style={{ padding: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 6 }}>EXTRACTED ARTICLE</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', lineHeight: 1.4, marginBottom: 6 }}>
                  "Asia port congestion worsens amid bad weather, vessel bunching"
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Tag color="slate" size="xs">Journal of Commerce (JOC)</Tag>
                  <Tag color="green" size="xs">Confidence: 0.94</Tag>
                  <Tag color="slate" size="xs">Delay extracted: 7 days</Tag>
                </div>
                <a href="https://www.joc.com/article/asia-port-congestion-worsens-amid-bad-weather-vessel-bunching-6247280"
                  target="_blank" rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#3b82f6', marginTop: 8, textDecoration: 'none' }}>
                  <ExternalLink size={9} /> View Original Article
                </a>
              </div>
              <div style={{ padding: '10px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 6 }}>ENTITY RESOLUTION</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontFamily: 'monospace', fontSize: 10 }}>
                  {['Port Klang → SHIP-7010', 'MV Sentinel → PO-7010', 'Pacific Coils → STCOIL-440V', '+7d delay extracted'].map(s => (
                    <Tag key={s} color="slate" size="xs">{s}</Tag>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === 'AIS' && (
            <div style={{ padding: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, fontFamily: 'monospace' }}>
              <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 10 }}>VESSEL AIS TELEMETRY</div>
              {[
                ['Vessel Name', 'MV Sentinel'],
                ['MMSI', '538009214'],
                ['Coordinates', "02°59'N, 101°24'E"],
                ['Port', 'Port Klang, Malaysia'],
                ['Destination', 'Chennai (INMAA)'],
                ['Speed / Course', '0.0 kts — Anchored off Port Klang'],
                ['Status', 'DISRUPTED — Weather Hold'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #e2e8f0', fontSize: 11 }}>
                  <span style={{ color: '#64748b' }}>{k}</span>
                  <span style={{ color: k === 'Status' ? '#ef4444' : '#0f172a', fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
          )}

          {tab === 'AUDIT' && (
            <div>
              <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 10 }}>AUTHORIZATION LEDGER — INC-2026-PORT-KLANG-01</div>
              {decisionExecuted ? (
                <div style={{ padding: '12px', background: '#f0fdf4', border: '1px solid #a7f3d0', borderRadius: 8, fontFamily: 'monospace', fontSize: 11 }}>
                  {[
                    ['Decision ID', decisionExecuted.decision_id],
                    ['Incident', decisionExecuted.incident_id],
                    ['Action', decisionExecuted.action],
                    ['Option', decisionExecuted.option_id],
                    ['PO Issued', decisionExecuted.po_number || 'N/A'],
                    ['Authorized By', decisionExecuted.approver_role],
                    ['Timestamp', new Date(decisionExecuted.timestamp).toLocaleString()],
                    ['Status', decisionExecuted.status],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #d1fae5', fontSize: 11 }}>
                      <span style={{ color: '#064e3b' }}>{k}</span>
                      <span style={{ color: '#0f172a', fontWeight: 600 }}>{v}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: 12, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  No human authorizations recorded yet.<br />Pending VP sign-off for INC-2026-PORT-KLANG-01.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── CONFIRM MODAL ───────────────────────────────────────────────────────────

const ConfirmModal = ({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) => (
  <div style={{
    position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)', padding: 16,
  }}>
    <div style={{ background: 'white', borderRadius: 12, padding: 24, maxWidth: 440, width: '100%', boxShadow: '0 20px 60px rgba(15,23,42,0.22)' }} className="animate-fade-in">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #e2e8f0' }}>
        <CheckCircle2 size={16} style={{ color: '#10b981' }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'monospace' }}>
          Confirm Emergency Expedite PO
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginBottom: 16, fontFamily: 'monospace', fontSize: 11 }}>
        {[
          ['Supplier', 'EuroCoils GmbH (Stuttgart, Germany)'],
          ['Material', 'STCOIL-440V — 900 Units'],
          ['Freight Mode', 'AIR_EXPEDITE (Pre-Cleared Customs)'],
          ['Arrival Date', '2026-10-13 — WO-7782 Unaffected'],
          ['Authorized Spend', '$30,150.00'],
          ['Cost Center', 'CC-APEX-SUPPLY-CHAIN'],
          ['Governance', 'VP Supply Chain Sign-Off (Rule C5)'],
        ].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
            <span style={{ color: '#64748b' }}>{k}</span>
            <span style={{ color: k === 'Governance' ? '#b45309' : '#0f172a', fontWeight: 600 }}>{v}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #e2e8f0', background: 'white', fontSize: 11, color: '#475569', cursor: 'pointer', fontWeight: 500 }}>
          Cancel
        </button>
        <button onClick={onConfirm} style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: '#0f172a', color: 'white', fontSize: 11, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(15,23,42,0.2)' }}>
          Confirm & Issue PO
        </button>
      </div>
    </div>
  </div>
);

// ─── ALERT BANNER ────────────────────────────────────────────────────────────

const AlertBanner = ({ dossier }: { dossier: Dossier }) => (
  <div style={{
    background: 'white', borderLeft: '4px solid #ef4444', border: '1px solid #fecdd3',
    borderRadius: 8, padding: '12px 16px', boxShadow: '0 1px 3px rgba(15,23,42,0.06)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: '#fff1f2', border: '1px solid #fecdd3', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
        <AlertTriangle size={14} style={{ color: '#ef4444' }} />
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <Tag color="red" size="xs">{dossier.incident_id}</Tag>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>{dossier.disruption.event_name}</span>
          <span style={{ color: '#e2e8f0' }}>·</span>
          <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>
            {dossier.disruption.location} · Vessel: {dossier.disruption.vessel_name}
          </span>
        </div>
        <p style={{ fontSize: 11, color: '#475569', margin: 0, lineHeight: 1.5 }}>
          Component <strong style={{ color: '#0f172a', fontFamily: 'monospace' }}>{dossier.disruption.material_id}</strong> delayed on <strong style={{ color: '#0f172a' }}>SHIP-{dossier.disruption.shipment_id.split('-')[1]}</strong> (PO-{dossier.disruption.po_id.split('-')[1]}) via {dossier.disruption.supplier_name}.
          Stockout begins <strong style={{ color: '#0f172a', fontFamily: 'monospace' }}>{dossier.attribution_math.stockout_date}</strong>.
          Pre-existing <strong>{dossier.attribution_math.baseline_gap_days}d baseline deficit</strong> + <strong>+{dossier.attribution_math.disruption_delay_days}d storm delay</strong> = <strong style={{ color: '#be123c' }}>{dossier.attribution_math.total_shortage_gap_days}-day net shortage gap</strong>.
        </p>
      </div>
    </div>
    <div style={{ textAlign: 'right', flexShrink: 0, paddingLeft: 12, borderLeft: '1px solid #fecdd3' }}>
      <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>OTIF Penalty Exposure</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: '#be123c', fontFamily: 'monospace' }}>$120,000</div>
      <div style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>SO-55102 · ACME Corp</div>
    </div>
  </div>
);

// ─── STICKY DECISION BAR ─────────────────────────────────────────────────────

const DecisionBar = ({ role, dossier, decisionExecuted, onApprove, onEscalate, onDecline }: {
  role: UserRole;
  dossier: Dossier;
  decisionExecuted: any;
  onApprove: () => void;
  onEscalate: () => void;
  onDecline: () => void;
}) => {
  if (decisionExecuted) {
    return (
      <footer style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 35, background: '#f0fdf4', borderTop: '1px solid #a7f3d0', boxShadow: '0 -4px 16px rgba(15,23,42,0.08)', padding: '10px 24px' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <CheckCircle2 size={16} style={{ color: '#10b981' }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#064e3b', fontFamily: 'monospace' }}>
            {decisionExecuted.action === 'APPROVE' ? `PO ISSUED: ${decisionExecuted.po_number} · Authorized by ${decisionExecuted.approver_role}` : `DECISION: ${decisionExecuted.action} · Recorded at ${new Date(decisionExecuted.timestamp).toLocaleString()}`}
          </span>
        </div>
      </footer>
    );
  }

  if (role === 'AUDIT') return null;

  const es = dossier.executive_summary;

  return (
    <footer style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 35, background: 'white', borderTop: '1px solid #e2e8f0', boxShadow: '0 -4px 16px rgba(15,23,42,0.08)', padding: '12px 24px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        {/* Left info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: '#f1f5f9', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>⚖</div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>
                RECOMMENDED: OPT-A · EuroCoils GmbH Air Freight
              </span>
              <Tag color="amber" size="xs">Rule C5: Requires VP Authorization</Tag>
            </div>
            <div style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>
              Freight: <strong style={{ color: '#0f172a' }}>${es.expedite_cost_usd.toLocaleString()}</strong>
              {' · '}Penalty Avoided: <strong style={{ color: '#10b981' }}>${es.penalty_avoided_usd.toLocaleString()}</strong>
              {' · '}Net Protected: <strong style={{ color: '#10b981' }}>+${es.net_value_saved_usd.toLocaleString()}</strong>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button onClick={onDecline} style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid #e2e8f0', background: 'white', fontSize: 11, color: '#475569', fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s' }}>
            Decline
          </button>
          <button onClick={onEscalate} style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid #e2e8f0', background: 'white', fontSize: 11, color: '#475569', fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s' }}>
            Escalate to S&OE Board
          </button>
          {role === 'VP' ? (
            <button onClick={onApprove} style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: '#0f172a', color: 'white', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 2px 8px rgba(15,23,42,0.25)', transition: 'all 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#1e293b')}
              onMouseLeave={e => (e.currentTarget.style.background = '#0f172a')}
            >
              <CheckCircle2 size={13} style={{ color: '#10b981' }} /> Approve & Issue PO
            </button>
          ) : role === 'PLANT_LEAD' ? (
            <button onClick={() => alert('Production timeline for WO-7782 endorsed. Notifying VP for C5 authorization.')} style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: '#0f172a', color: 'white', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 2px 8px rgba(15,23,42,0.2)' }}>
              <Check size={13} style={{ color: '#10b981' }} /> Endorse Production Timeline
            </button>
          ) : (
            <button onClick={() => alert('VP notification sent for Rule C5 sign-off on INC-2026-PORT-KLANG-01.')} style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: '#0f172a', color: 'white', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 2px 8px rgba(15,23,42,0.2)' }}>
              <UserCheck size={13} style={{ color: '#3b82f6' }} /> Request VP Approval
            </button>
          )}
        </div>
      </div>
    </footer>
  );
};

// ─── MAIN APP ────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('GATEWAY');
  const [role, setRole] = useState<UserRole>('PLANNER');
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState(false);
  const [activeFormula, setActiveFormula] = useState<FormulaKey>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [decisionExecuted, setDecisionExecuted] = useState<any>(null);

  const loadDossier = useCallback(() => {
    setLoading(true);
    setApiError(false);
    fetch('/api/incidents/INC-2026-PORT-KLANG-01')
      .then(r => { if (!r.ok) throw new Error('API error'); return r.json(); })
      .then(data => { setDossier(data); setLoading(false); })
      .catch(() => { setApiError(true); setLoading(false); });
  }, []);

  const handleEnter = useCallback((selectedRole: UserRole) => {
    setRole(selectedRole);
    setScreen('WORKSPACE');
    loadDossier();
  }, [loadDossier]);

  const handleDecision = useCallback((action: 'APPROVE' | 'ESCALATE' | 'DECLINE') => {
    fetch('/api/decisions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        incident_id: 'INC-2026-PORT-KLANG-01',
        option_id: 'OPT-A',
        action,
        approver_role: role === 'VP' ? 'VP Supply Chain' : role === 'PLANT_LEAD' ? 'Plant Floor Lead' : 'Senior S&OE Planner',
      }),
    })
      .then(r => r.json())
      .then(data => { setDecisionExecuted(data); setShowConfirm(false); })
      .catch(err => console.error('Decision error:', err));
  }, [role]);

  // Loading screen
  if (screen === 'WORKSPACE' && loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', gap: 12 }}>
        <Spinner size={24} />
        <div style={{ fontSize: 13, color: '#475569', fontFamily: 'monospace' }}>Connecting to decision engine...</div>
        <div style={{ fontSize: 11, color: '#94a3b8' }}>Loading INC-2026-PORT-KLANG-01 dossier from LangGraph</div>
      </div>
    );
  }

  // Error screen
  if (screen === 'WORKSPACE' && apiError) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', gap: 12 }}>
        <AlertCircle size={32} style={{ color: '#ef4444' }} />
        <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Cannot reach backend (port 8000)</div>
        <div style={{ fontSize: 12, color: '#64748b' }}>Ensure the Flask server is running: python server.py</div>
        <button onClick={loadDossier} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 6, border: '1px solid #e2e8f0', background: 'white', fontSize: 12, cursor: 'pointer', color: '#0f172a', fontWeight: 500 }}>
          <RefreshCw size={12} /> Retry
        </button>
      </div>
    );
  }

  // Gateway
  if (screen === 'GATEWAY') {
    return <GatewayScreen onEnter={handleEnter} />;
  }

  // Workspace (needs dossier)
  if (!dossier) return null;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#f8fafc' }}>
      <WorkspaceHeader
        role={role} setRole={setRole}
        decisionExecuted={decisionExecuted}
        onEvidenceOpen={() => setShowEvidence(true)}
      />

      {/* Main scroll area */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 80 }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Alert Banner — always visible */}
          <AlertBanner dossier={dossier} />

          {/* KPI Tiles — always visible */}
          <KpiTiles dossier={dossier} onFormula={setActiveFormula} />

          {/* Role-specific workspace */}
          <div className="animate-fade-in" key={role}>
            {role === 'PLANNER' && <PlannerView dossier={dossier} setDossier={setDossier} />}
            {role === 'PLANT_LEAD' && <PlantLeadView dossier={dossier} />}
            {role === 'VP' && (
              <VPView
                dossier={dossier}
                onApprove={() => setShowConfirm(true)}
                onDecline={() => handleDecision('DECLINE')}
                onEscalate={() => handleDecision('ESCALATE')}
                decisionExecuted={decisionExecuted}
              />
            )}
            {role === 'AUDIT' && <AuditView dossier={dossier} decisionExecuted={decisionExecuted} />}
          </div>
        </div>
      </div>

      {/* Sticky decision bar */}
      <DecisionBar
        role={role} dossier={dossier} decisionExecuted={decisionExecuted}
        onApprove={() => setShowConfirm(true)}
        onEscalate={() => handleDecision('ESCALATE')}
        onDecline={() => handleDecision('DECLINE')}
      />

      {/* Overlays */}
      {activeFormula && <FormulaModal dossier={dossier} formulaKey={activeFormula} onClose={() => setActiveFormula(null)} />}
      {showEvidence && <EvidenceDrawer onClose={() => setShowEvidence(false)} decisionExecuted={decisionExecuted} />}
      {showConfirm && <ConfirmModal onConfirm={() => handleDecision('APPROVE')} onCancel={() => setShowConfirm(false)} />}
    </div>
  );
}
