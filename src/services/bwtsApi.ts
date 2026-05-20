// Client for the Bobby Wealth Trading System Python read API.
// Endpoints implemented in scanner/api.py.
//
// VITE_BWTS_API_URL takes precedence; falls back to VITE_API_URL.
// In dev with no env set, points at the local default (8000).

const BASE =
  (import.meta as any).env?.VITE_BWTS_API_URL ||
  (import.meta as any).env?.VITE_API_URL ||
  'http://localhost:8000';

export type SignalTier = 'STRONG' | 'GOOD' | 'WATCHLIST' | 'NO_TRADE';
export type SignalDirection = 'BUY' | 'SELL' | 'NEUTRAL';

export interface BwtsSignal {
  id: number;
  created_at: number | string;
  pair: string;
  direction: SignalDirection;
  tier: SignalTier;
  confidence_score: number;
  entry: number;
  stop_loss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  risk_level: string;
  session: string;
  adr_status: string;
  htf_bias: string;
  pattern: string;
  reasons: string[];
}

export interface BwtsHealth {
  status: string;
  db_signals: number;
  pairs: string[];
}

export interface BwtsConfig {
  pairs: string[];
  thresholds: { strong: number; good: number; watchlist: number };
  scan_interval_seconds: number;
  news_blackout_minutes: number;
}

async function get<T>(path: string, query?: Record<string, string | number>): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      msg = body?.error || msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export interface BwtsPosition {
  id: string;
  opened_at: number;
  closed_at: number | null;
  pair: string;
  direction: SignalDirection;
  lot_size: number;
  entry: number;
  stop_loss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  status: string;
  half_closed: number;
  closed_pnl_usd: number;
}

export interface BwtsClosedTrade {
  id: number;
  position_id: string | null;
  pair: string;
  direction: SignalDirection;
  opened_at: number;
  closed_at: number;
  entry: number;
  exit_price: number;
  stop_loss: number;
  tp1: number;
  tp2: number;
  lot_size: number;
  sl_pips: number;
  pnl_usd: number;
  r_multiple: number;
  outcome: string;
}

export interface BwtsJournalStats {
  trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  gross_profit: number;
  gross_loss: number;
  profit_factor: number;
  avg_r: number;
  total_pnl: number;
}

export interface BwtsKillStatus {
  engaged: boolean;
  reason: string;
  path?: string;
}

async function post<T>(path: string, body: any): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const b = await res.json();
      msg = b?.error || msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return (await res.json().catch(() => ({}))) as T;
}

export const bwtsApi = {
  health: () => get<BwtsHealth>('/api/health'),
  pairs: () => get<{ pairs: string[] }>('/api/pairs'),
  config: () => get<BwtsConfig>('/api/config'),
  signals: (opts?: { pair?: string; tier?: SignalTier; limit?: number }) =>
    get<{ signals: BwtsSignal[]; count: number }>('/api/signals', opts as any),
  signal: (id: number) => get<{ signal: BwtsSignal }>(`/api/signals/${id}`),

  positions: () => get<{ positions: BwtsPosition[]; count: number }>('/api/positions'),
  journal: (opts?: { pair?: string; limit?: number }) =>
    get<{ trades: BwtsClosedTrade[]; count: number }>('/api/journal', opts as any),
  journalStats: () => get<BwtsJournalStats>('/api/journal/stats'),

  killStatus: () => get<BwtsKillStatus>('/api/kill-switch'),
  setKill: (engaged: boolean, reason?: string) =>
    post<BwtsKillStatus>('/api/kill-switch', { engaged, reason }),

  requestScan: () => post<{ queued: boolean }>('/api/scans/refresh', {}),

  baseUrl: () => BASE,
};

export default bwtsApi;
