import type {
  DecisionRecord,
  Dossier,
  EvidencePayload,
  IncidentSummary,
  InvestigationRecord,
  OperationShipment,
  SignalSearchResponse,
  SimulationResponse,
} from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload as T;
}

export const api = {
  operations: () => request<{ shipments: OperationShipment[] }>('/api/operations/shipments'),
  signalSearch: (input: { entity_id: string; query?: string; mode?: 'live_with_fallback' | 'live' | 'cache' | 'demo' }) =>
    request<SignalSearchResponse>('/api/signal-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_type: 'shipment', ...input }),
    }),
  incidents: () => request<{ queue: IncidentSummary[] }>('/api/incidents'),
  dossier: (id: string) => request<Dossier>(`/api/incidents/${id}`),
  evidence: (id: string) => request<EvidencePayload>(`/api/evidence/${id}`),
  simulate: (id: string, delayDays: number, asOf: string) =>
    request<SimulationResponse>('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ incident_id: id, delay_days: delayDays, as_of: asOf }),
    }),
  decide: (input: {
    incident_id: string;
    option_id: string;
    action: 'APPROVE' | 'ESCALATE' | 'DECLINE';
    approver_role: string;
    notes: string;
  }) =>
    request<DecisionRecord>('/api/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  audit: () => request<{ audit_trail: DecisionRecord[]; investigations: InvestigationRecord[] }>('/api/audit'),
};
