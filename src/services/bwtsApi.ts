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

export const bwtsApi = {
  health: () => get<BwtsHealth>('/api/health'),
  pairs: () => get<{ pairs: string[] }>('/api/pairs'),
  config: () => get<BwtsConfig>('/api/config'),
  signals: (opts?: { pair?: string; tier?: SignalTier; limit?: number }) =>
    get<{ signals: BwtsSignal[]; count: number }>('/api/signals', opts as any),
  signal: (id: number) => get<{ signal: BwtsSignal }>(`/api/signals/${id}`),
  baseUrl: () => BASE,
};

export default bwtsApi;
