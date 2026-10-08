import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRight, BarChart3, Bell, Check, CheckCircle2, ChevronRight,
  ClipboardCheck, Clock3, Download, Factory, FileSearch, HelpCircle, Layers,
  LayoutDashboard, LogIn, Network, Package, RotateCw, Search, ShieldCheck,
  SlidersHorizontal, Truck, UserCheck, Users, X, XCircle, Zap, Briefcase
} from 'lucide-react';
import { api } from './api';
import type {
  DecisionRecord, Dossier, EvidencePayload, IncidentSummary, InvestigationRecord,
  OperationShipment, OptionItem, SignalSearchMode, SignalSearchResponse, UserRole
} from './types';

const ROLE_CONFIG: Record<UserRole, { label: string; name: string; title: string; subtitle: string; icon: any }> = {
  PLANNER: {
    label: 'Supply Planner',
    name: 'Control Room / Planner',
    title: 'Supply Control Room',
    subtitle: 'PLANT BLR-01  /  Planning Horizon: 07–21 OCT 2026',
    icon: LayoutDashboard,
  },
  PLANT_LEAD: {
    label: 'Plant Operations',
    name: 'Plant',
    title: 'Plant Operations Workbench',
    subtitle: 'PLANT BLR-01  /  Shift: 07:00–15:30 (Day Shift)',
    icon: Factory,
  },
  VP: {
    label: 'Executive Review',
    name: 'Executive',
    title: 'Executive Decision Center',
    subtitle: 'Global Supply Network  /  As of 07 Oct 2026',
    icon: Briefcase,
  },
  AUDIT: {
    label: 'Audit / Governance',
    name: 'Audit',
    title: 'Decision Audit Center',
    subtitle: 'Compliance & Governance  /  SOX-404 & Internal Controls',
    icon: ShieldCheck,
  },
};

const RULE_MAP: Record<string, string> = {
  C1: 'Supplier Lead Time',
  C2: 'Minimum Order Qty',
  C3: 'PPAP Quality Cert',
  C4: 'Frozen Window',
  C5: 'Spend Authority Gate',
  C6: 'BOM Revision Match',
  C7: 'Export / Trade Sanction',
  C8: 'Supplier Capacity',
};

const money = (val: number) => `$${(val || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const dateFmt = (val?: string) => {
  if (!val || val === 'Schedule Shift (No Inflow)') return 'No Inflow';
  return new Date(`${val}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function App() {
  const [role, setRole] = useState<UserRole>('PLANNER');
  const [incidents, setIncidents] = useState<IncidentSummary[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string>('INC-SHIP-8100');
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [evidence, setEvidence] = useState<EvidencePayload | null>(null);
  const [audit, setAudit] = useState<DecisionRecord[]>([]);
  const [investigations, setInvestigations] = useState<InvestigationRecord[]>([]);
  const [operations, setOperations] = useState<OperationShipment[]>([]);
  
  // UI Modals & Drawers
  const [showEvidence, setShowEvidence] = useState(false);
  const [showApproval, setShowApproval] = useState(false);
  const [showMaterialDrawer, setShowMaterialDrawer] = useState(false);
  const [showWorkOrderDrawer, setShowWorkOrderDrawer] = useState(false);
  const [showDeviationModal, setShowDeviationModal] = useState(false);
  const [selectedOption, setSelectedOption] = useState<OptionItem | null>(null);
  const [activeTab, setActiveTab] = useState<'control' | 'operations' | 'simulator'>('control');
  
  // Loading & State
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [delaySlider, setDelaySlider] = useState(7);
  const [decision, setDecision] = useState<DecisionRecord | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchResult, setSearchResult] = useState<SignalSearchResponse | null>(null);

  // Load initial backend data
  const loadData = async () => {
    setLoading(true);
    try {
      const [incRes, opsRes, auditRes] = await Promise.all([
        api.incidents(),
        api.operations(),
        api.audit()
      ]);
      setIncidents(incRes.queue || []);
      setOperations(opsRes.shipments || []);
      setAudit(auditRes.audit_trail || []);
      setInvestigations(auditRes.investigations || []);

      const defaultInc = incRes.queue[0]?.incident_id || 'INC-SHIP-8100';
      setSelectedIncidentId(defaultInc);
      
      const d = await api.dossier(defaultInc);
      setDossier(d);
      setDelaySlider(d.disruption.simulated_delay_days || 7);
    } catch (err) {
      console.error('Failed to load ERP backend:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const selectIncident = async (incId: string) => {
    setSelectedIncidentId(incId);
    setLoading(true);
    try {
      const d = await api.dossier(incId);
      setDossier(d);
      setDelaySlider(d.disruption.simulated_delay_days || 7);
      setEvidence(null);
    } catch (err) {
      console.error('Failed to load incident detail:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSimulate = async (days: number) => {
    if (!dossier) return;
    setDelaySlider(days);
    setSimulating(true);
    try {
      const res = await api.simulate(dossier.incident_id, days, dossier.as_of);
      setDossier(res.dossier);
    } catch (err) {
      console.error('Simulation error:', err);
    } finally {
      setSimulating(false);
    }
  };

  const handleApproval = async (notes: string) => {
    if (!dossier) return;
    const recOpt = dossier.executive_summary.recommended_option_id || 'OPT-REDSEA-A';
    try {
      const dec = await api.decide({
        incident_id: dossier.incident_id,
        option_id: recOpt,
        action: 'APPROVE',
        approver_role: 'VP Supply Chain',
        notes: notes.trim()
      });
      setDecision(dec);
      setAudit(prev => [dec, ...prev]);
      setShowApproval(false);
    } catch (err) {
      alert('Approval failed: ' + err);
    }
  };

  const handleSignalSearch = async (shipment: OperationShipment) => {
    setSearchBusy(true);
    try {
      const res = await api.signalSearch({
        entity_id: shipment.shipment_id,
        query: searchQuery || undefined,
        mode: 'live_with_fallback'
      });
      setSearchResult(res);
      if (res.incident_id && res.dossier) {
        setDossier(res.dossier);
        setSelectedIncidentId(res.incident_id);
      }
    } catch (err) {
      alert('Search failed: ' + err);
    } finally {
      setSearchBusy(false);
    }
  };

  if (loading && !dossier) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#f2f4f7] text-[#152b45]">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#165bcd] font-bold text-white shadow-md">
            <Network className="h-6 w-6" />
          </div>
          <span className="font-semibold text-lg">Connecting to APEXX Supply Control Tower...</span>
          <span className="text-sm text-[#627287]">Querying ERP DB & LangGraph Decision Engines</span>
        </div>
      </div>
    );
  }

  const recOption = dossier?.recovery_options_matrix.find(
    o => o.option_id === dossier.executive_summary.recommended_option_id
  );
  const isAbsorbed = dossier?.impact_status === 'ABSORBED';

  return (
    <div className="flex flex-col h-screen w-screen bg-[#f2f4f7] font-sans overflow-hidden">
      {/* 1. TOPBAR */}
      <header className="topbar">
        <div className="topbar-brand">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-[#165bcd] text-white">
            <Network className="h-4 w-4" />
          </div>
          <span>SUPPLY / OPS</span>
          <span className="text-xs font-normal text-[#8b98a5] ml-2">v2.4 Enterprise Control Tower</span>
        </div>

        <div className="topbar-search">
          <Search className="h-4 w-4 text-[#8b98a5]" />
          <input
            type="text"
            placeholder="Search incident, material, PO or work order"
            className="bg-transparent border-0 outline-none text-xs w-full"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <kbd>⌘ K</kbd>
        </div>

        <div className="topbar-right">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#fff1f2] border border-[#fecdd3] text-[#ba2531] text-xs font-bold">
            <Bell className="h-3.5 w-3.5" />
            <span>1 CRITICAL</span>
          </div>

          <div className="flex items-center gap-2 border-l border-[#e2e8f0] pl-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#172636] text-white text-xs font-semibold">
              SP
            </div>
            <select
              value={role}
              onChange={e => setRole(e.target.value as UserRole)}
              aria-label="Switch Persona"
              className="bg-transparent text-xs font-semibold text-[#152b45] border-0 outline-none cursor-pointer"
            >
              <option value="PLANNER">Supply Planner</option>
              <option value="PLANT_LEAD">Plant Operations</option>
              <option value="VP">Executive Review (VP)</option>
              <option value="AUDIT">Audit / Governance</option>
            </select>
          </div>
        </div>
      </header>

      {/* 2. BODY LAYOUT: SIDEBAR + MAIN VIEWPORT */}
      <div className="app-container">
        {/* SIDEBAR NAVIGATION */}
        <aside className="sidebar">
          <div className="sidebar-label">OPERATIONS WORKSPACE</div>
          
          <nav className="flex flex-col gap-1 mt-1">
            {(Object.keys(ROLE_CONFIG) as UserRole[]).map(rKey => {
              const cfg = ROLE_CONFIG[rKey];
              const Icon = cfg.icon;
              const active = role === rKey;
              return (
                <button
                  key={rKey}
                  onClick={() => setRole(rKey)}
                  className={`sidebar-nav-item ${active ? 'active' : ''}`}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <span>{cfg.name}</span>
                </button>
              );
            })}
          </nav>

          {/* INCIDENT CONTEXT CARD */}
          {dossier && (
            <div className="sidebar-context-card">
              <div className="context-tag">SELECTED INCIDENT</div>
              <div className="incident-id">{dossier.incident_id}</div>
              <button
                onClick={() => setShowMaterialDrawer(true)}
                className="material-link"
              >
                <span>{dossier.disruption.material_id}</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div className="mt-4 px-2">
            <button
              onClick={() => setActiveTab('operations')}
              className={`flex items-center gap-2 w-full text-xs font-semibold py-2 px-2.5 rounded transition ${
                activeTab === 'operations' ? 'bg-[#2c465f] text-white' : 'text-[#acbacb] hover:bg-white/5'
              }`}
            >
              <FileSearch className="h-4 w-4" />
              <span>Operations Queue</span>
            </button>
          </div>

          <div className="sidebar-footer">
            <div className="sidebar-plant-scope">PLANT BLR-01</div>
            <div className="sidebar-date-scope">07 OCT 2026 · LIVE DISRUPTION</div>
          </div>
        </aside>

        {/* MAIN VIEWPORT */}
        <main className="main-viewport">
          {activeTab === 'operations' ? (
            /* OPERATIONS / SHIPMENT DISCOVERY VIEW */
            <div className="space-y-4">
              <div className="page-header-row">
                <div>
                  <div className="page-scope">IN-TRANSIT MARITIME SHIPMENTS</div>
                  <h1 className="page-title">Operations Signal Discovery</h1>
                </div>
                <button
                  onClick={() => setActiveTab('control')}
                  className="btn btn-outline"
                >
                  Back to Workspace
                </button>
              </div>

              <div className="panel-card">
                <div className="flex items-center justify-between border-b border-[#e2e8f0] pb-3 mb-4">
                  <div>
                    <h3 className="font-bold text-sm text-[#152b45]">Active Shipments in mock_erp.db</h3>
                    <p className="text-xs text-[#627287]">Select a shipment to perform a targeted SerpAPI external search</p>
                  </div>
                  <span className="text-xs font-semibold text-[#8b98a5]">{operations.length} Shipments Monitored</span>
                </div>

                <div className="divide-y divide-[#e2e8f0]">
                  {operations.map(op => (
                    <div key={op.shipment_id} className="py-3 flex items-center justify-between hover:bg-[#f7f9fb] px-2 rounded transition">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#edf3fc] text-[#165bcd]">
                          <Truck className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-[#152b45]">{op.shipment_id}</span>
                            <span className="text-xs text-[#627287]">({op.vessel_name})</span>
                            <span className={`status-badge ${op.status === 'IN_TRANSIT' ? 'warning' : 'success'}`}>
                              {op.status}
                            </span>
                          </div>
                          <div className="text-xs text-[#627287] mt-0.5">
                            {op.origin} → {op.destination} · Part: <strong className="text-[#152b45]">{op.material_id}</strong> · Qty: {op.quantity.toLocaleString()}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleSignalSearch(op)}
                          disabled={searchBusy}
                          className="btn btn-primary text-xs"
                        >
                          <FileSearch className="h-3.5 w-3.5" />
                          <span>{searchBusy ? 'Searching...' : 'Search Signals'}</span>
                        </button>
                        <button
                          onClick={() => {
                            selectIncident(op.shipment_id === 'SHIP-8100' ? 'INC-SHIP-8100' : `INC-${op.shipment_id}`);
                            setActiveTab('control');
                          }}
                          className="btn btn-outline text-xs"
                        >
                          <span>Open Dossier</span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* ROLE-SPECIFIC WORKSPACE (PLANNER, PLANT LEAD, VP, AUDIT) */
            <div className="space-y-5">
              {/* PAGE HEADER */}
              <div className="page-header-row">
                <div>
                  <div className="page-scope">{ROLE_CONFIG[role].subtitle}</div>
                  <h1 className="page-title">{ROLE_CONFIG[role].title}</h1>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowEvidence(true)}
                    className="btn btn-outline text-xs"
                  >
                    <FileSearch className="h-3.5 w-3.5 text-[#165bcd]" />
                    <span>Evidence Drawer</span>
                  </button>
                  <button
                    onClick={loadData}
                    className="btn btn-outline text-xs"
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                    <span>Refresh</span>
                  </button>
                  {role === 'PLANNER' && (
                    <button
                      onClick={() => handleSimulate(delaySlider)}
                      className="btn btn-primary text-xs"
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      <span>Simulate Delay</span>
                    </button>
                  )}
                </div>
              </div>

              {/* CRITICAL DISRUPTION BANNER */}
              {dossier && (
                <div className="panel-card critical-banner bg-white p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#fff1f2] text-[#ba2531] mt-0.5">
                        <AlertTriangle className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="status-badge critical">CRITICAL SHORTAGE</span>
                          <span className="font-bold text-base text-[#152b45]">{dossier.disruption.event_name}</span>
                          <span className="text-xs font-mono text-[#627287]">({dossier.incident_id})</span>
                          <span className="status-badge warning">+{dossier.disruption.simulated_delay_days} DAYS DELAY</span>
                        </div>
                        <p className="text-xs text-[#627287] mt-1">
                          {dossier.disruption.location} disruption affecting <strong>{dossier.disruption.supplier_name}</strong> · Part <strong>{dossier.disruption.material_id}</strong>
                        </p>
                        <div className="flex items-center gap-3 text-xs text-[#152b45] mt-2 font-medium">
                          <span>Original ETA: <strong>{dateFmt(dossier.disruption.original_eta)}</strong></span>
                          <span>→</span>
                          <span className="text-[#ba2531]">Revised ETA: <strong>{dateFmt(dossier.disruption.revised_eta)}</strong></span>
                          <span className="text-[#627287]">|</span>
                          <span>Stockout Date: <strong className="text-[#ba2531]">{dateFmt(dossier.attribution_math.stockout_date)}</strong></span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-end">
                      <div className="text-right">
                        <div className="text-xs text-[#627287]">OTIF Penalty Exposure</div>
                        <div className="text-xl font-bold text-[#ba2531] font-mono">{money(dossier.verifiable_exposure.otif_exposure_usd)}</div>
                        <div className="text-[11px] text-[#627287]">{dossier.verifiable_exposure.customer_name} ({dossier.verifiable_exposure.customer_order_id})</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* =========================================================
                  ROLE 1: SUPPLY PLANNER CONTROL ROOM
                  ========================================================= */}
              {role === 'PLANNER' && dossier && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                  {/* Left Column: PAB Time-Phased Grid & Simulator (2 cols) */}
                  <div className="lg:col-span-2 space-y-5">
                    {/* Time-Phased PAB Grid */}
                    <div className="panel-card">
                      <div className="flex items-center justify-between border-b border-[#e2e8f0] pb-3 mb-2">
                        <div>
                          <h3 className="font-bold text-sm text-[#152b45]">
                            {dossier.disruption.material_id}: Projected Available Balance (PAB)
                          </h3>
                          <p className="text-xs text-[#627287]">
                            Opening Stock: {dossier.attribution_math.on_hand_qty} units · Daily Burn: {dossier.attribution_math.daily_burn_rate} units/day
                          </p>
                        </div>
                        <span className="status-badge critical">
                          {dateFmt(dossier.attribution_math.stockout_date)} / ZERO BALANCE
                        </span>
                      </div>

                      <div className="mrp-table-container">
                        <table className="mrp-table">
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>07 Oct</th>
                              <th>08 Oct</th>
                              <th>09 Oct</th>
                              <th>10 Oct</th>
                              <th>11 Oct</th>
                              <th>12 Oct</th>
                              <th>13 Oct</th>
                              <th>14 Oct</th>
                              <th>21 Oct</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td>Stock</td>
                              <td>150</td>
                              <td>120</td>
                              <td>90</td>
                              <td>60</td>
                              <td>30</td>
                              <td className="pab-zero">0</td>
                              <td className="pab-negative">-30</td>
                              <td className="pab-negative">-60</td>
                              <td className="pab-negative">-270</td>
                            </tr>
                            <tr>
                              <td>Demand</td>
                              <td>-30</td>
                              <td>-30</td>
                              <td>-30</td>
                              <td>-30</td>
                              <td>-30</td>
                              <td>-30</td>
                              <td>-30</td>
                              <td>-30</td>
                              <td>-30</td>
                            </tr>
                            <tr>
                              <td>PO Inbound</td>
                              <td>—</td>
                              <td>—</td>
                              <td>—</td>
                              <td>—</td>
                              <td>—</td>
                              <td>—</td>
                              <td>—</td>
                              <td className="text-xs text-[#8b98a5]">Original ◇</td>
                              <td className="text-xs font-bold text-[#ba2531]">Revised ◆ (+500)</td>
                            </tr>
                            <tr>
                              <td>PAB</td>
                              <td>150</td>
                              <td>120</td>
                              <td>90</td>
                              <td>60</td>
                              <td>30</td>
                              <td className="pab-zero">0 ⚠️</td>
                              <td className="pab-negative">-30 🚨</td>
                              <td className="pab-negative">-60 🚨</td>
                              <td className="font-bold text-[#15803d]">+230 🟢</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <p className="text-[11px] text-[#8b98a5] mt-3">
                        * Original Inbound: 14 Oct → Revised Inbound: 21 Oct. The 13-day net shortage gap creates an immediate risk of line shutdown.
                      </p>
                    </div>

                    {/* What-If Simulator */}
                    <div className="panel-card bg-white">
                      <div className="flex items-center justify-between border-b border-[#e2e8f0] pb-3 mb-3">
                        <div className="flex items-center gap-2">
                          <SlidersHorizontal className="h-4 w-4 text-[#165bcd]" />
                          <h3 className="font-bold text-sm text-[#152b45]">Digital Twin Delay Simulator</h3>
                        </div>
                        <span className="status-badge info">{simulating ? 'Calculating...' : `+${delaySlider} Days Delay`}</span>
                      </div>

                      <div className="space-y-3">
                        <div className="flex justify-between text-xs font-semibold text-[#152b45]">
                          <span>On-Time Arrival (0d)</span>
                          <span className="text-[#165bcd] font-bold text-sm">+{delaySlider} Days</span>
                          <span>Severe Disruption (20d)</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="20"
                          value={delaySlider}
                          onChange={e => handleSimulate(Number(e.target.value))}
                          className="w-full h-2 bg-[#e2e8f0] rounded-lg appearance-none cursor-pointer accent-[#165bcd]"
                        />
                        <div className="grid grid-cols-3 gap-2 pt-2 text-center text-xs">
                          <div className="p-2 rounded bg-[#f7f9fb] border border-[#e2e8f0]">
                            <span className="text-[#627287]">Stockout Date</span>
                            <div className="font-bold text-[#ba2531] mt-0.5">{dateFmt(dossier.attribution_math.stockout_date)}</div>
                          </div>
                          <div className="p-2 rounded bg-[#f7f9fb] border border-[#e2e8f0]">
                            <span className="text-[#627287]">Disrupted ETA</span>
                            <div className="font-bold text-[#152b45] mt-0.5">{dateFmt(dossier.disruption.revised_eta)}</div>
                          </div>
                          <div className="p-2 rounded bg-[#f7f9fb] border border-[#e2e8f0]">
                            <span className="text-[#627287]">Net Shortage Gap</span>
                            <div className="font-bold text-[#ba2531] mt-0.5">{dossier.attribution_math.total_shortage_gap_days} Days</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Incident Impact & Candidate Recovery Options */}
                  <div className="space-y-5">
                    {/* Impact Summary Card */}
                    <div className="panel-card">
                      <h3 className="font-bold text-sm text-[#152b45] border-b border-[#e2e8f0] pb-2 mb-3">
                        Incident Impact Summary
                      </h3>
                      <div className="space-y-2.5 text-xs">
                        <div className="flex justify-between">
                          <span className="text-[#627287]">Material Shortage:</span>
                          <strong className="text-[#152b45]">{dossier.disruption.material_id}</strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#627287]">Affected Work Order:</span>
                          <button onClick={() => setShowWorkOrderDrawer(true)} className="font-bold text-[#165bcd] hover:underline">
                            {dossier.verifiable_exposure.work_order_id} →
                          </button>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#627287]">Planned Quantity:</span>
                          <strong className="text-[#152b45]">{dossier.operational_context.planned_production_quantity} Units</strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#627287]">Customer Commitment:</span>
                          <strong className="text-[#152b45]">{dossier.verifiable_exposure.customer_name}</strong>
                        </div>
                        <div className="flex justify-between border-t border-[#e2e8f0] pt-2">
                          <span className="text-[#627287]">OTIF Penalty Exposure:</span>
                          <strong className="text-[#ba2531] font-mono font-bold">{money(dossier.verifiable_exposure.otif_exposure_usd)}</strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#627287]">Revenue at Risk:</span>
                          <strong className="text-[#ba2531] font-mono font-bold">$450,000</strong>
                        </div>
                      </div>
                    </div>

                    {/* Evaluated Recovery Options Matrix */}
                    <div className="panel-card">
                      <div className="flex items-center justify-between border-b border-[#e2e8f0] pb-2 mb-3">
                        <h3 className="font-bold text-sm text-[#152b45]">Recovery Options Matrix</h3>
                        <span className="text-[11px] font-semibold text-[#8b98a5]">
                          {dossier.recovery_options_matrix.length} Evaluated
                        </span>
                      </div>

                      <div className="space-y-2.5">
                        {dossier.recovery_options_matrix.map(opt => (
                          <div
                            key={opt.option_id}
                            onClick={() => setSelectedOption(opt)}
                            className={`p-2.5 rounded border cursor-pointer transition ${
                              opt.status === 'VETOED'
                                ? 'bg-[#fff1f2]/40 border-[#fecdd3] hover:border-[#ba2531]'
                                : 'bg-[#f0fdf4]/50 border-[#bbf7d0] hover:border-[#165bcd]'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-xs text-[#152b45]">{opt.option_id}: {opt.supplier_name}</span>
                              <span className={`status-badge ${opt.status === 'VETOED' ? 'critical' : 'success'}`}>
                                {opt.status}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-[#627287] mt-1">
                              <span>Arrival: {dateFmt(opt.arrival_date)} ({opt.freight_mode})</span>
                              <span className="font-bold text-[#152b45]">{opt.estimated_cost_usd ? money(opt.estimated_cost_usd) : '—'}</span>
                            </div>
                            {opt.hard_vetoes.length > 0 && (
                              <div className="text-[10px] font-bold text-[#ba2531] mt-1">
                                VETOED by: {opt.hard_vetoes.map(v => `${v} (${RULE_MAP[v] || v})`).join(', ')}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* =========================================================
                  ROLE 2: PLANT OPERATIONS WORKBENCH
                  ========================================================= */}
              {role === 'PLANT_LEAD' && dossier && (
                <div className="space-y-5">
                  {/* Shift KPI Header */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div className="panel-card p-3 text-center">
                      <span className="text-xs text-[#627287]">Planned Output</span>
                      <div className="text-xl font-bold text-[#152b45] mt-0.5">1,200 <small className="text-xs font-normal">units</small></div>
                    </div>
                    <div className="panel-card p-3 text-center">
                      <span className="text-xs text-[#627287]">Completed (Shift)</span>
                      <div className="text-xl font-bold text-[#15803d] mt-0.5">940 <small className="text-xs font-normal">units</small></div>
                    </div>
                    <div className="panel-card p-3 text-center">
                      <span className="text-xs text-[#627287]">Scrap Qty</span>
                      <div className="text-xl font-bold text-[#ba2531] mt-0.5">12 <small className="text-xs font-normal">units</small></div>
                    </div>
                    <div className="panel-card p-3 text-center">
                      <span className="text-xs text-[#627287]">Line Yield</span>
                      <div className="text-xl font-bold text-[#152b45] mt-0.5">97.4%</div>
                    </div>
                    <div className="panel-card p-3 text-center bg-[#fff1f2] border-[#fecdd3]">
                      <span className="text-xs text-[#ba2531] font-bold">Exceptions</span>
                      <div className="text-xl font-bold text-[#ba2531] mt-0.5">1 Critical</div>
                    </div>
                  </div>

                  {/* Work Center Utilization & Readiness */}
                  <div className="panel-card">
                    <h3 className="font-bold text-sm text-[#152b45] border-b border-[#e2e8f0] pb-2 mb-3">
                      Work Center Line Status & Buffer Readiness
                    </h3>
                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between text-xs font-semibold mb-1">
                          <span>Line 1: Main Motor Assembly (Running WO-7781)</span>
                          <span className="text-[#15803d]">92% Capacity (Normal)</span>
                        </div>
                        <div className="w-full bg-[#e2e8f0] h-2.5 rounded-full overflow-hidden">
                          <div className="bg-[#15803d] h-full" style={{ width: '92%' }}></div>
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs font-semibold mb-1">
                          <span>Line 2: Electronics Subassembly (WO-7790 Pending Microcontroller)</span>
                          <span className="text-[#ba2531]">64% Capacity (MATERIAL SHORTAGE RISK)</span>
                        </div>
                        <div className="w-full bg-[#e2e8f0] h-2.5 rounded-full overflow-hidden">
                          <div className="bg-[#ba2531] h-full" style={{ width: '64%' }}></div>
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs font-semibold mb-1">
                          <span>Line 3: Housing Fabrication</span>
                          <span className="text-[#15803d]">87% Capacity (Normal)</span>
                        </div>
                        <div className="w-full bg-[#e2e8f0] h-2.5 rounded-full overflow-hidden">
                          <div className="bg-[#15803d] h-full" style={{ width: '87%' }}></div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Shop Floor Work Order Dispatch Table */}
                  <div className="panel-card">
                    <div className="flex items-center justify-between border-b border-[#e2e8f0] pb-2 mb-3">
                      <div>
                        <h3 className="font-bold text-sm text-[#152b45]">Shop Floor Work Order Dispatch List</h3>
                        <p className="text-xs text-[#627287]">Real-time operational execution status</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => setShowDeviationModal(true)} className="btn btn-outline text-xs">
                          Deviation Request
                        </button>
                        <button onClick={() => alert('Work orders re-sequenced successfully.')} className="btn btn-outline text-xs">
                          Re-sequence Orders
                        </button>
                      </div>
                    </div>

                    <div className="divide-y divide-[#e2e8f0] text-xs">
                      <div className="py-2.5 flex items-center justify-between bg-[#fff1f2]/50 px-2 rounded">
                        <div className="flex items-center gap-3">
                          <span className="status-badge critical">MATERIAL SHORTAGE</span>
                          <div>
                            <strong>{dossier.verifiable_exposure.work_order_id}</strong> (APEXM-100 for {dossier.verifiable_exposure.customer_name})
                            <div className="text-[#627287]">Missing {dossier.disruption.material_id} · Frozen schedule through {dateFmt(dossier.operational_context.frozen_until)}</div>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => setShowWorkOrderDrawer(true)} className="btn btn-outline text-xs">Details</button>
                          <button onClick={() => alert('Order placed on MATERIAL HOLD.')} className="btn btn-danger text-xs">Place on Hold</button>
                        </div>
                      </div>

                      <div className="py-2.5 flex items-center justify-between px-2">
                        <div className="flex items-center gap-3">
                          <span className="status-badge success">IN PROCESS</span>
                          <div>
                            <strong>WO-7781</strong> (APEXM-100 Standard Run)
                            <div className="text-[#627287]">Planned: 200 units · Line 1 · 92% completion</div>
                          </div>
                        </div>
                        <button className="btn btn-outline text-xs">Details</button>
                      </div>

                      <div className="py-2.5 flex items-center justify-between px-2">
                        <div className="flex items-center gap-3">
                          <span className="status-badge success">RELEASED</span>
                          <div>
                            <strong>WO-7783</strong> (Housing Fabrication Run)
                            <div className="text-[#627287]">Planned: 400 units · Line 3 · Material staging complete</div>
                          </div>
                        </div>
                        <button className="btn btn-outline text-xs">Details</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* =========================================================
                  ROLE 3: VP SUPPLY CHAIN EXECUTIVE REVIEW
                  ========================================================= */}
              {role === 'VP' && dossier && (
                <div className="space-y-5">
                  {/* Executive KPI Bar */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="panel-card p-4 text-center">
                      <span className="text-xs text-[#627287]">Global OTIF Rate</span>
                      <div className="text-2xl font-bold text-[#152b45] mt-1">94.2%</div>
                      <span className="text-[10px] text-[#ba2531]">▼ 1.8% vs Monthly Target</span>
                    </div>
                    <div className="panel-card p-4 text-center bg-[#fff1f2] border-[#fecdd3]">
                      <span className="text-xs text-[#ba2531] font-bold">Total Penalty Exposure</span>
                      <div className="text-2xl font-bold text-[#ba2531] font-mono mt-1">
                        {money(dossier.verifiable_exposure.otif_exposure_usd)}
                      </div>
                      <span className="text-[10px] text-[#627287]">100% Contractual SLA Risk</span>
                    </div>
                    <div className="panel-card p-4 text-center">
                      <span className="text-xs text-[#627287]">Revenue at Risk</span>
                      <div className="text-2xl font-bold text-[#152b45] font-mono mt-1">$450,000</div>
                      <span className="text-[10px] text-[#627287]">Siemens Energy Mobility</span>
                    </div>
                    <div className="panel-card p-4 text-center">
                      <span className="text-xs text-[#627287]">Supply Corridor Risk</span>
                      <div className="text-2xl font-bold text-[#ba2531] mt-1">HIGH</div>
                      <span className="text-[10px] text-[#ba2531]">Red Sea Missile Rerouting</span>
                    </div>
                  </div>

                  {/* Financial Trade-off & Governance Spend Gate */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* Financial ROI Card */}
                    <div className="panel-card">
                      <div className="flex items-center justify-between border-b border-[#e2e8f0] pb-2 mb-3">
                        <div className="flex items-center gap-2">
                          <BarChart3 className="h-4 w-4 text-[#165bcd]" />
                          <h3 className="font-bold text-sm text-[#152b45]">Executive Financial Trade-off</h3>
                        </div>
                        <span className="status-badge success">5.2× ROI</span>
                      </div>

                      <div className="space-y-3 text-xs">
                        <div className="p-3 bg-[#f7f9fb] rounded border border-[#e2e8f0]">
                          <div className="flex justify-between mb-1">
                            <span className="text-[#627287]">Air Freight Spot-Buy Cost ({recOption?.option_id || 'OPT-REDSEA-A'}):</span>
                            <strong className="text-[#152b45] font-mono">{money(recOption?.estimated_cost_usd || 26000)}</strong>
                          </div>
                          <div className="flex justify-between mb-1">
                            <span className="text-[#627287]">Customer OTIF Penalty Avoided:</span>
                            <strong className="text-[#15803d] font-mono">+{money(dossier.verifiable_exposure.otif_exposure_usd)}</strong>
                          </div>
                          <div className="flex justify-between border-t border-[#e2e8f0] pt-1.5 text-sm font-bold">
                            <span className="text-[#15803d]">Net Protected Value:</span>
                            <span className="text-[#15803d] font-mono">
                              +{money(dossier.verifiable_exposure.otif_exposure_usd - (recOption?.estimated_cost_usd || 26000))}
                            </span>
                          </div>
                        </div>

                        <p className="text-[11px] text-[#627287] leading-relaxed">
                          Authorizing <strong>{recOption?.option_id}</strong> spot-buys 500 units of {dossier.disruption.material_id} via air freight from <strong>{recOption?.supplier_name}</strong>, arriving <strong>{dateFmt(recOption?.arrival_date)}</strong> to completely preserve delivery SLA.
                        </p>
                      </div>
                    </div>

                    {/* Decision Action Box */}
                    <div className="panel-card bg-white flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between border-b border-[#e2e8f0] pb-2 mb-3">
                          <div className="flex items-center gap-2">
                            <ShieldCheck className="h-4 w-4 text-[#165bcd]" />
                            <h3 className="font-bold text-sm text-[#152b45]">Governance Authorization Gate</h3>
                          </div>
                          <span className="status-badge warning">Rule C5 Gate</span>
                        </div>
                        <p className="text-xs text-[#627287] leading-relaxed mb-4">
                          Because the expedite spend exceeds the Plant Manager authorization threshold of $30,000, VP Supply Chain sign-off is required.
                        </p>
                      </div>

                      {decision ? (
                        <div className="p-3 bg-[#f0fdf4] border border-[#bbf7d0] rounded text-xs space-y-1">
                          <div className="flex items-center gap-1.5 font-bold text-[#15803d]">
                            <CheckCircle2 className="h-4 w-4" />
                            <span>Purchase Order Issued: {decision.po_number}</span>
                          </div>
                          <div className="text-[#627287]">Decision ID: {decision.decision_id} · Recorded by: {decision.approver_role}</div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <button
                            onClick={() => setShowApproval(true)}
                            className="btn btn-primary w-full"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            <span>Review and Approve (Issue PO)</span>
                          </button>
                          <div className="flex gap-2">
                            <button
                              onClick={() => alert('Decision escalated to Executive Board.')}
                              className="btn btn-outline flex-1 text-xs"
                            >
                              Escalate for Review
                            </button>
                            <button
                              onClick={() => alert('Recovery option declined.')}
                              className="btn btn-outline flex-1 text-xs text-[#ba2531]"
                            >
                              Decline
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* =========================================================
                  ROLE 4: AUDIT & GOVERNANCE CONTROL CENTER
                  ========================================================= */}
              {role === 'AUDIT' && dossier && (
                <div className="space-y-5">
                  {/* Traceability Proof Chain */}
                  <div className="panel-card">
                    <div className="flex items-center justify-between border-b border-[#e2e8f0] pb-2 mb-3">
                      <div>
                        <h3 className="font-bold text-sm text-[#152b45]">9-Point Explainability Proof Chain</h3>
                        <p className="text-xs text-[#627287]">Verifiable lineage from external news signal to purchase order</p>
                      </div>
                      <button
                        onClick={() => {
                          const blob = new Blob([JSON.stringify({ dossier, audit, investigations }, null, 2)], { type: 'application/json' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `Audit-Dossier-${dossier.incident_id}.json`;
                          a.click();
                        }}
                        className="btn btn-outline text-xs"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>Export Audit JSON</span>
                      </button>
                    </div>

                    <div className="space-y-2">
                      {(dossier.executive_summary.recommendation_reasons || []).map((reason, idx) => (
                        <div key={idx} className="flex items-start gap-2.5 text-xs text-[#152b45] p-2 rounded bg-[#f7f9fb] border border-[#e2e8f0]">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#165bcd] text-white text-[10px] font-bold flex-shrink-0 mt-0.5">
                            {idx + 1}
                          </span>
                          <span>{reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Constraint Evaluation Rulebook Table */}
                  <div className="panel-card">
                    <h3 className="font-bold text-sm text-[#152b45] border-b border-[#e2e8f0] pb-2 mb-3">
                      C1–C8 Deterministic Rule Matrix
                    </h3>
                    <div className="mrp-table-container">
                      <table className="mrp-table text-xs">
                        <thead>
                          <tr>
                            <th>Option</th>
                            <th>C1: Lead Time</th>
                            <th>C2: MOQ</th>
                            <th>C3: PPAP</th>
                            <th>C4: Frozen</th>
                            <th>C5: Budget</th>
                            <th>C6: BOM Rev</th>
                            <th>C7: Customs</th>
                            <th>C8: Capacity</th>
                            <th>Verdict</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dossier.recovery_options_matrix.map(opt => (
                            <tr key={opt.option_id}>
                              <td className="font-bold">{opt.option_id} ({opt.supplier_name.split(' ')[0]})</td>
                              <td>{opt.rules.C1?.pass ? '✓' : '✗'}</td>
                              <td>{opt.rules.C2?.pass ? '✓' : '✗'}</td>
                              <td>{opt.rules.C3?.pass ? '✓' : '✗'}</td>
                              <td>{opt.rules.C4?.pass ? '✓' : '✗'}</td>
                              <td>{opt.rules.C5?.warning ? '⚠️ VP' : '✓'}</td>
                              <td>{opt.rules.C6?.pass ? '✓' : '✗'}</td>
                              <td>{opt.rules.C7?.pass ? '✓' : '✗'}</td>
                              <td>{opt.rules.C8?.pass ? '✓' : '✗'}</td>
                              <td>
                                <span className={`status-badge ${opt.status === 'VETOED' ? 'critical' : 'success'}`}>
                                  {opt.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* SQLite Decision & Investigation Audit Ledger */}
                  <div className="panel-card">
                    <h3 className="font-bold text-sm text-[#152b45] border-b border-[#e2e8f0] pb-2 mb-3">
                      Immutable SQLite Decision Ledger ({audit.length} Records)
                    </h3>
                    <div className="divide-y divide-[#e2e8f0] text-xs">
                      {audit.map(log => (
                        <div key={log.decision_id} className="py-2 flex items-center justify-between">
                          <div>
                            <span className="font-bold text-[#152b45]">{log.decision_id}</span> · Action: <span className="font-semibold text-[#165bcd]">{log.action}</span> · PO: <strong>{log.po_number || 'None'}</strong>
                            <div className="text-[#627287]">{log.notes || 'Governed decision recorded'}</div>
                          </div>
                          <div className="text-right text-[11px] text-[#8b98a5]">
                            <div>{log.approver_role}</div>
                            <div>{new Date(log.timestamp).toLocaleString()}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* =========================================================
          MODALS & DRAWERS
          ========================================================= */}

      {/* 1. EVIDENCE DRAWER */}
      {showEvidence && (
        <div className="drawer-overlay" onClick={() => setShowEvidence(false)}>
          <div className="drawer-content p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#e2e8f0] pb-3 mb-4">
              <div className="flex items-center gap-2">
                <FileSearch className="h-5 w-5 text-[#165bcd]" />
                <h3 className="font-bold text-base text-[#152b45]">Live Evidence & Provenance</h3>
              </div>
              <button onClick={() => setShowEvidence(false)} className="text-[#8b98a5] hover:text-[#152b45]">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="p-3 bg-[#edf3fc] rounded-lg border border-[#c7d9f7]">
                <div className="font-bold text-[#165bcd] mb-1">Source Tier Provenance</div>
                <div className="text-[#152b45]">Tier 1: Live SerpAPI Google News Feed</div>
                <div className="text-[#627287] mt-0.5">Confidence Score: 0.94 (Verified Maritime Entity Match)</div>
              </div>

              <div>
                <span className="text-[#627287] font-semibold">Extracted News Headline:</span>
                <p className="font-bold text-sm text-[#152b45] mt-1">
                  "Red Sea Cargo Ships Face Multi-Week Delays as Major Carriers Reroute via Cape"
                </p>
                <div className="text-[#8b98a5] mt-1">Publisher: Global Maritime & Logistics Intelligence · 2026-10-02</div>
              </div>

              <div className="p-3 bg-[#f7f9fb] rounded border border-[#e2e8f0]">
                <span className="text-[#627287] font-semibold">Extracted Operational Signal:</span>
                <ul className="list-disc list-inside mt-1 space-y-1 text-[#152b45]">
                  <li>Location: <strong>Red Sea Corridor</strong></li>
                  <li>Extracted Delay: <strong>+7 to +14 Days</strong></li>
                  <li>Vessel Matched: <strong>CMA CGM Palais</strong></li>
                  <li>Disrupted Inbound: <strong>PO-8100 / SHIP-8100</strong></li>
                </ul>
              </div>

              <div className="p-3 bg-[#f7f9fb] rounded border border-[#e2e8f0]">
                <span className="text-[#627287] font-semibold">AIS Telemetry Status:</span>
                <p className="text-[#8b98a5] mt-1 italic">
                  UNAVAILABLE / NOT MONITORED (Satellite AIS tracking omitted from trust-critical evidence per product specification).
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. APPROVAL MODAL */}
      {showApproval && dossier && (
        <div className="modal-overlay" onClick={() => setShowApproval(false)}>
          <div className="modal-content p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#e2e8f0] pb-3 mb-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-[#165bcd]" />
                <h3 className="font-bold text-base text-[#152b45]">Authorize Purchase Order (Rule C5 Gate)</h3>
              </div>
              <button onClick={() => setShowApproval(false)} className="text-[#8b98a5] hover:text-[#152b45]">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="p-3 bg-[#f7f9fb] rounded border border-[#e2e8f0] space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-[#627287]">Authorized Supplier:</span>
                  <strong>{recOption?.supplier_name || 'Munich Semiconductor Express'}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#627287]">Material:</span>
                  <strong>{dossier.disruption.material_id} (500 Units)</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#627287]">Freight Mode:</span>
                  <strong>AIR FREIGHT EXPRESS</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#627287]">Estimated Cost:</span>
                  <strong className="font-mono text-sm">{money(recOption?.estimated_cost_usd || 26000)}</strong>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-[#152b45] mb-1">
                  Approval Justification Note <span className="text-[#ba2531]">*</span>
                </label>
                <textarea
                  rows={3}
                  defaultValue="Approved critical air freight spot buy from Munich Semiconductor to protect Siemens Energy delivery and prevent $135k penalty."
                  className="w-full p-2.5 border border-[#e2e8f0] rounded-lg text-xs outline-none focus:border-[#165bcd]"
                  id="approval-notes"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#e2e8f0]">
                <button onClick={() => setShowApproval(false)} className="btn btn-outline text-xs">
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const txt = (document.getElementById('approval-notes') as HTMLTextAreaElement)?.value || 'Approved';
                    handleApproval(txt);
                  }}
                  className="btn btn-primary text-xs"
                >
                  Confirm & Issue Purchase Order
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. MATERIAL DRAWER */}
      {showMaterialDrawer && dossier && (
        <div className="drawer-overlay" onClick={() => setShowMaterialDrawer(false)}>
          <div className="drawer-content p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#e2e8f0] pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-[#165bcd]" />
                <h3 className="font-bold text-base text-[#152b45]">Material Detail: {dossier.disruption.material_id}</h3>
              </div>
              <button onClick={() => setShowMaterialDrawer(false)} className="text-[#8b98a5] hover:text-[#152b45]">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between py-1 border-b border-[#e2e8f0]">
                <span className="text-[#627287]">Material Name:</span>
                <strong>Main Microcontroller Module 800</strong>
              </div>
              <div className="flex justify-between py-1 border-b border-[#e2e8f0]">
                <span className="text-[#627287]">Active BOM Revision:</span>
                <strong>REV-D (Compatible with REV-E)</strong>
              </div>
              <div className="flex justify-between py-1 border-b border-[#e2e8f0]">
                <span className="text-[#627287]">Plant On-Hand Stock:</span>
                <strong>{dossier.attribution_math.on_hand_qty} units</strong>
              </div>
              <div className="flex justify-between py-1 border-b border-[#e2e8f0]">
                <span className="text-[#627287]">Daily Consumption:</span>
                <strong>{dossier.attribution_math.daily_burn_rate} units/day</strong>
              </div>
              <div className="flex justify-between py-1 border-b border-[#e2e8f0]">
                <span className="text-[#627287]">Safety Stock Limit:</span>
                <strong>50 units</strong>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. WORK ORDER DRAWER */}
      {showWorkOrderDrawer && dossier && (
        <div className="drawer-overlay" onClick={() => setShowWorkOrderDrawer(false)}>
          <div className="drawer-content p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#e2e8f0] pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Factory className="h-5 w-5 text-[#165bcd]" />
                <h3 className="font-bold text-base text-[#152b45]">Work Order: {dossier.verifiable_exposure.work_order_id}</h3>
              </div>
              <button onClick={() => setShowWorkOrderDrawer(false)} className="text-[#8b98a5] hover:text-[#152b45]">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between py-1 border-b border-[#e2e8f0]">
                <span className="text-[#627287]">Finished Good:</span>
                <strong>APEXM-100 Industrial Motor</strong>
              </div>
              <div className="flex justify-between py-1 border-b border-[#e2e8f0]">
                <span className="text-[#627287]">Planned Quantity:</span>
                <strong>300 units</strong>
              </div>
              <div className="flex justify-between py-1 border-b border-[#e2e8f0]">
                <span className="text-[#627287]">Customer Commitment:</span>
                <strong>{dossier.verifiable_exposure.customer_name} ({dossier.verifiable_exposure.customer_order_id})</strong>
              </div>
              <div className="flex justify-between py-1 border-b border-[#e2e8f0]">
                <span className="text-[#627287]">Schedule Status:</span>
                <span className="status-badge critical">FROZEN SCHEDULE (14-DAY WINDOW)</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#e2e8f0]">
                <span className="text-[#627287]">Shortage Component:</span>
                <strong className="text-[#ba2531]">{dossier.disruption.material_id} (300 units needed)</strong>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
