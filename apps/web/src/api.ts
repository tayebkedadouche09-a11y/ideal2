/** Typed API client for /api/v1. Handles attach + refresh rotation. */

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; companyId: string; roles: string[]; scopes?: Record<string,string> };
}

const BASE = '/api/v1';

export function getAuth(): AuthSession | null {
  try {
    const raw = localStorage.getItem('cos.auth');
    return raw ? (JSON.parse(raw) as AuthSession) : null;
  } catch {
    return null;
  }
}

export function setAuth(s: AuthSession | null): void {
  if (s) localStorage.setItem('cos.auth', JSON.stringify(s));
  else localStorage.removeItem('cos.auth');
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const session = getAuth();
      if (!session?.refreshToken) return false;
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      if (!res.ok) return false;
      const next = (await res.json()) as { accessToken: string; refreshToken: string };
      setAuth({ ...session, ...next });
      return true;
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const session = getAuth();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(session ? { authorization: `Bearer ${session.accessToken}` } : {}),
      ...(init.body && !(init.body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401 && retry && session) {
    if (await tryRefresh()) return api<T>(path, init, false);
    setAuth(null);
    window.location.reload();
    throw new Error('Session expirée');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(body.error ?? body.message ?? `HTTP ${res.status}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export function login(email: string, password: string): Promise<AuthSession> {
  return api<AuthSession>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

// ---- Dashboard ----
export interface DashboardData {
  projectsByStatus: { status: string; count: number }[];
  delayedProjects: { id: string; code: string; name: string; planned_end: string | null }[];
  unpaidInvoices?: { count: number; amount: string };
  stockAlerts: { name: string; physical: string; min_stock: string; unit: string }[];
  maintenanceDue: { registration: string; next_due_date: string }[];
  attendanceToday: { kind: string; count: number }[];
  openIncidents: { id: string; title: string; severity: string }[];
}
export const fetchDashboard = () => api<DashboardData>('/dashboard');

export interface Briefing {
  generatedAt: string;
  projects: { active: number; delayed: { code: string; name: string }[]; requiringAttention: { code: string; name: string }[] };
  stock: { name: string; unit: string; physical: string; min_stock: string; days_left: string }[];
  fleet: { registration: string; next_due_date: string }[];
  finance: { overdueInvoices: number; overdueAmount: string };
}
export const fetchBriefing = () => api<Briefing>('/dashboard/daily-briefing');

// ---- Generic list/create for resource pages ----
export const list = <T>(path: string, qs = '') => api<{ [k: string]: T[] }>(`${path}${qs}`);
export const createOne = (path: string, body: unknown) => api<{ id?: string; ok?: boolean }>(path, { method: 'POST', body: JSON.stringify(body) });
export const patchOne = (path: string, body: unknown) => api<unknown>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const transition = (path: string, to: string) => api<unknown>(path, { method: 'POST', body: JSON.stringify({ to }) });

// ---- Quotes ----
export interface QuoteLine { kind: string; description: string; quantity: number; unit?: string; unit_price: number; discount_percent?: number; material_id?: string }
export interface QuoteDetail { quote: Record<string, unknown>; lines: QuoteLine[] & Record<string, unknown>[]; versions: { id: string; version: number; created_at: string }[] }
export const fetchQuote = (id: string) => api<QuoteDetail>(`/quotes/${id}`);
export const createQuote = (body: unknown) => createOne('/quotes', body);
export const updateQuote = (id: string, body: unknown) => api<unknown>(`/quotes/${id}`, { method: 'PUT', body: JSON.stringify(body) });
export const convertQuote = (id: string) => api<{ projectId: string; code: string }>(`/quotes/${id}/convert-to-project`, { method: 'POST' });

// ---- Finance ----
export const fetchInvoice = (id: string) => api<{ invoice: Record<string, unknown>; lines: Record<string, unknown>[]; payments: Record<string, unknown>[]; paid: number; due: number }>(`/invoices/${id}`);
export const createInvoice = (body: unknown) => createOne('/invoices', body);
export const addPayment = (invoiceId: string, body: unknown) => createOne(`/invoices/${invoiceId}/payments`, body);

// ---- Projects ----
export interface ProjectDetail {
  project: Record<string, unknown>;
  measurements: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  dailyReports: Record<string, unknown>[];
  team: Record<string, unknown>[];
  consumption: Record<string, unknown>[];
  incidents: Record<string, unknown>[];
  expenses: Record<string, unknown>[];
  documents: Record<string, unknown>[];
}
export const fetchProject = (id: string) => api<ProjectDetail>(`/projects/${id}`);
export const fetchProfitability = (id: string) => api<{ profitability: Record<string, unknown> }>(`/projects/${id}/profitability`);
export const fetchTimeline = (id: string) => api<Record<string, unknown>>(`/projects/${id}/timeline`);

// ---- Stock ----
export interface StockRow { material_id: string; sku: string; name: string; unit: string; location_name: string | null; physical: string; reserved: string; available: string; min_stock: string }
export const fetchStock = () => api<{ levels: StockRow[]; alerts: unknown[] }>('/stock');

// ---- Documents ----
export async function uploadDocument(file: File, links: { entity_type: string; entity_id: string }[], customerVisible = false): Promise<{ id: string }> {
  const fd = new FormData();
  fd.append('file', file);
  for (const l of links) {
    fd.append('entity_type', l.entity_type);
    fd.append('entity_id', l.entity_id);
  }
  if (customerVisible) fd.append('customer_visible', 'true');
  return api('/documents/upload', { method: 'POST', body: fd });
}

// ---- Notifications ----
export interface Notification { id: string; kind: string; severity: string; title: string; body: string | null; created_at: string; read_at: string | null }
export const fetchNotifications = () => api<{ notifications: Notification[] }>('/notifications');
export const markNotificationRead = (id: string) => api(`/notifications/${id}/read`, { method: 'POST' });
export const evaluateNotifications = () => api<{ created: number }>('/notifications/evaluate', { method: 'POST' });

// ---- Intelligence ----
export interface Comparison { projects: { id: string; code: string; name: string; revenue: number; cost: number; margin: number; incidents: number; delay_days: number | null }[] }
export const fetchComparison = () => api<Comparison>('/intelligence/project-comparison');
export const fetchAnomalies = () => api<{ anomalies: Record<string, unknown>[] }>('/intelligence/anomalies');
export const fetchForecasts = () => api<{ forecasts: Record<string, unknown>[] }>('/intelligence/forecast');
export const runScenario = (body: unknown) => api<Record<string, unknown>>('/intelligence/scenarios', { method: 'POST', body: JSON.stringify(body) });
export const fetchAudit = (qs = '') => api<{ entries: Record<string, unknown>[] }>(`/audit${qs}`);

// ---- Portal ----
export interface PortalData {
  clients: Record<string, unknown>[];
  projects: Record<string, unknown>[];
  invoices: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  documents: Record<string, unknown>[];
  communications: Record<string, unknown>[];
  notifications: Record<string, unknown>[];
}
export const fetchPortalHome = async (): Promise<Partial<PortalData>> => {
  const [profile, projects, invoices, payments, documents, communications] = await Promise.all([
    api<{ clients: Record<string, unknown>[] }>('/portal/profile'),
    api<{ projects: Record<string, unknown>[] }>('/portal/projects'),
    api<{ invoices: Record<string, unknown>[] }>('/portal/invoices'),
    api<{ payments: Record<string, unknown>[] }>('/portal/payments'),
    api<{ documents: Record<string, unknown>[] }>('/portal/documents'),
    api<{ communications: Record<string, unknown>[] }>('/portal/communications'),
  ]);
  return { clients: profile.clients, projects: projects.projects, invoices: invoices.invoices, payments: payments.payments, documents: documents.documents, communications: communications.communications };
};


export interface CaptureItem {
  id:string; capture_type:string; project_id:string|null; document_id:string|null;
  title:string|null; note:string|null; latitude:number|null; longitude:number|null;
  file_name?:string|null; mime_type?:string|null; size_bytes?:number|null; created_at:string;
}
export const fetchProjectCaptures = (projectId:string) => api<{captures:CaptureItem[]}>(`/projects/${projectId}/captures`);
export async function uploadCapture(file:File, fields:{capture_type:string;project_id?:string;title?:string;note?:string;latitude?:number;longitude?:number}):Promise<{id:string;documentId:string}> {
  const fd=new FormData(); fd.append('file',file);
  Object.entries(fields).forEach(([k,v])=>{ if(v!==undefined&&v!==null) fd.append(k,String(v)); });
  return api('/captures/upload',{method:'POST',body:fd});
}
export async function fetchCaptureBlob(id:string):Promise<Blob>{
  const s=getAuth(); const res=await fetch(`${BASE}/captures/${id}/content`,{headers:s?{authorization:`Bearer ${s.accessToken}`}:{}});
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

export interface KnowledgeItem { id:string; title:string; content:string; kind:string; project_id:string|null; tags:string[]; confidence:number|null; created_at:string; created_by_name?:string|null; }
export const fetchKnowledge = (qs='') => api<{items:KnowledgeItem[]}>(`/knowledge${qs}`);
export const createKnowledge = (body:unknown) => api<{id:string}>('/knowledge',{method:'POST',body:JSON.stringify(body)});
export const deleteKnowledge = (id:string) => api<{ok:boolean}>(`/knowledge/${id}`,{method:'DELETE'});

export interface ApprovalRequest { id:string; action:string; entity_type:string|null; entity_id:string|null; amount:number|null; risk:string; status:string; reason:string; decision_note:string|null; requested_by_name?:string|null; created_at:string; }
export const fetchApprovals = (status='') => api<{approvals:ApprovalRequest[]}>(`/approvals${status?`?status=${encodeURIComponent(status)}`:''}`);
export const createApproval = (body:unknown) => api<{id:string}>('/approvals',{method:'POST',body:JSON.stringify(body)});
export const decideApproval = (id:string,decision:'approved'|'rejected',note?:string) => api<{ok:boolean;status:string}>(`/approvals/${id}/decision`,{method:'POST',body:JSON.stringify({decision,note})});
