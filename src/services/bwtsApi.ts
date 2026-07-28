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

export type CalendarRiskStatus = 'CLEAR' | 'CAUTION' | 'BLOCKED' | 'POST_NEWS' | 'UNAVAILABLE';
export interface CalendarGateStatus {
  version: number;
  status: CalendarRiskStatus;
  evaluated_at: string;
  symbol: string;
  source: string;
  source_health: 'LIVE' | 'STALE' | 'UNAVAILABLE';
  event: { id: string; title: string; currency: string; impact: string; scheduled_at: string; source: string } | null;
  next_event: { id: string; title: string; currency: string; impact: string; scheduled_at: string; source: string } | null;
  minutes_to_event: number | null;
  reason_code: string;
}

export interface CryptoTradePlan {
  version: string;
  status: 'STRONG' | 'VALID' | 'WATCHLIST' | 'WAIT' | 'BLOCKED';
  eligible: boolean;
  direction: 'BUY' | 'SELL' | 'NEUTRAL';
  score: number;
  entry: number | null;
  invalidation: number | null;
  stop: number | null;
  atr: number | null;
  atr_buffer: number | null;
  risk_distance: number | null;
  risk_percent_of_price: number | null;
  expected_movement: number | null;
  expected_move_percent: number | null;
  available_rr: number;
  net_available_rr?: number;
  estimated_cost_r?: number | null;
  estimated_round_trip_cost_bps?: number;
  minimum_rr: number;
  targets: { label: string; price: number; r_multiple: number; reachable: boolean }[];
  account_risk_percent: number;
  calendar_status: string;
  timing_status?: string;
  timing?: CryptoAnalysis['trade_timing'];
  reasons: string[];
}

export interface CryptoAnalysis {
  version: string;
  asset_class: 'crypto';
  pair: string;
  direction: 'BUY' | 'SELL' | 'NEUTRAL';
  total_score: number;
  category_breakdown: Record<string, number>;
  data_quality: { status: string; issues: string[]; primary_timeframe: string; bars: number; timeframes_available: string[] };
  indicators: Record<string, any>;
  zones: Record<string, any>;
  market_context: {
    macro_bias: 'bullish' | 'bearish' | 'neutral';
    timeframes: Record<string, { trend: 'bullish' | 'bearish' | 'neutral'; labels: string[] }>;
    aligned_frames: string[];
    opposing_frames: string[];
    alignment_score: number;
  };
  trade_timing: {
    status: 'READY' | 'WAIT' | 'AVOID';
    checks: Record<string, boolean>;
    location_ready: boolean;
    nearest_sr?: any;
    nearest_fibonacci?: any;
    avoid_reasons?: string[];
    wait_for: string[];
  };
  scenarios: { primary: string; invalidation: string; confidence: string };
  risk: { atr_stop: number | null; atr_multiple: number; warning: string };
  monitoring: string[];
  economic_calendar?: CalendarGateStatus;
  trade_plan?: CryptoTradePlan;
}

export interface V2BacktestReport {
  version: string; pair: string; timeframe: string; bars: number; candidates: number;
  overall: { trades: number; wins: number; losses: number; win_rate: number; expectancy_r: number; profit_factor: number };
  in_sample_70pct: Record<string, number>; out_of_sample_30pct: Record<string, number>;
  validation: { status: 'INSUFFICIENT_DATA' | 'PROMISING' | 'REJECT'; minimum_out_of_sample_trades: number; observed_out_of_sample_trades: number; warning: string };
  by_setup: Record<string, any>; by_confirmation: Record<string, any>; by_score_band: Record<string, any>; by_session: Record<string, any>;
  blocked_reasons: Record<string, number>;
}

export interface AiSignalAnalysis {
  summary: string;
  setup_quality: string;
  confirmations: string[];
  conflicts: string[];
  calendar_risk: CalendarRiskStatus;
  invalidation: string | number | null;
  wait_for: string;
  educational_note: string;
}

const responseCache = new Map<string, { expires: number; value: unknown }>();
const inFlight = new Map<string, Promise<unknown>>();

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

async function getCached<T>(path: string, query?: Record<string, string | number>, ttlMs = 15_000): Promise<T> {
  const params = new URLSearchParams(Object.entries(query || {}).map(([name, value]) => [name, String(value)]));
  const key = `${path}?${params.toString()}`;
  const cached = responseCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value as T;
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const request = get<T>(path, query)
    .then((value) => { responseCache.set(key, { expires: Date.now()+ttlMs, value }); return value; })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
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
  clearCache: () => responseCache.clear(),
  health: () => get<BwtsHealth>('/api/health'),
  pairs: () => get<{ pairs: string[] }>('/api/pairs'),
  config: () => get<BwtsConfig>('/api/config'),
  signals: (opts?: { pair?: string; tier?: SignalTier; limit?: number }) =>
    getCached<{ signals: BwtsSignal[]; count: number }>('/api/signals', opts as any, 10_000),
  signal: (id: number) => get<{ signal: BwtsSignal }>(`/api/signals/${id}`),

  positions: () => get<{ positions: BwtsPosition[]; count: number }>('/api/positions'),
  journal: (opts?: { pair?: string; limit?: number }) =>
    get<{ trades: BwtsClosedTrade[]; count: number }>('/api/journal', opts as any),
  journalStats: () => get<BwtsJournalStats>('/api/journal/stats'),

  killStatus: () => get<BwtsKillStatus>('/api/kill-switch'),
  setKill: (engaged: boolean, reason?: string) =>
    post<BwtsKillStatus>('/api/kill-switch', { engaged, reason }),

  requestScan: () => post<{ queued: boolean }>('/api/scans/refresh', {}),
  calendarStatus: (pair: string) => getCached<CalendarGateStatus>('/api/calendar/status', { pair }, 30_000),
  calendarEvents: (pair?: string) => get<{ source: string; source_health: string; events: any[]; count: number }>('/api/calendar/events', pair ? { pair } : undefined),
  aiStatus: () => get<{ configured: boolean }>('/api/ai/status'),
  cryptoAnalysis: (pair: string, timeframe?: string) => getCached<CryptoAnalysis>('/api/analysis', timeframe ? { pair, timeframe } : { pair }, 20_000),
  v2Backtest: (pair: string, timeframe = '15m', limit = 3000) => get<V2BacktestReport>('/api/backtest/v2', { pair, timeframe, limit }),
  analyzeSignal: (pair: string, signal: BwtsSignal, analysis?: CryptoAnalysis) => post<{ configured: boolean; analysis: AiSignalAnalysis; calendar: CalendarGateStatus }>('/api/ai/analyze', { pair, signal, analysis }),

  baseUrl: () => BASE,
};

export default bwtsApi;
