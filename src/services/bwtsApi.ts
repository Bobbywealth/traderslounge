// Client for the Bobby Wealth Trading System Python read API.
// Endpoints implemented in scanner/api.py.
//
// VITE_BWTS_API_URL takes precedence; falls back to VITE_API_URL.
// In dev with no env set, points at the local default (8000).

const BASE =
  (import.meta as any).env?.VITE_BWTS_API_URL ||
  (import.meta as any).env?.VITE_API_URL ||
  'http://localhost:8000';

const REFRESH_TOKEN_KEY = 'confluencex_refresh_token';
let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;

export interface BackendAuthUser {
  id: number | string;
  email: string;
  name: string;
  role: string;
  plan: string;
}

interface AuthResponse {
  user?: BackendAuthUser;
  access_token: string;
  refresh_token: string;
}

const rawAuthRequest = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error || `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
};

const saveTokens = (payload: AuthResponse) => {
  accessToken = payload.access_token;
  localStorage.setItem(REFRESH_TOKEN_KEY, payload.refresh_token);
};

const refreshAccessToken = async (): Promise<boolean> => {
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) return false;
  refreshInFlight = rawAuthRequest<AuthResponse>('/api/auth/refresh', { refresh_token: refreshToken })
    .then((payload) => { saveTokens(payload); return true; })
    .catch(() => { accessToken = null; localStorage.removeItem(REFRESH_TOKEN_KEY); return false; })
    .finally(() => { refreshInFlight = null; });
  return refreshInFlight;
};

const fetchWithAuth = async (url: string, init: RequestInit = {}, retry = true): Promise<Response> => {
  if (!accessToken) await refreshAccessToken();
  const headers = new Headers(init.headers || {});
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const response = await fetch(url, { ...init, headers });
  if (response.status === 401 && retry && await refreshAccessToken()) {
    return fetchWithAuth(url, init, false);
  }
  return response;
};

export const bwtsAuth = {
  login: async (email: string, password: string) => {
    const payload = await rawAuthRequest<AuthResponse>('/api/auth/login', { email, password });
    saveTokens(payload);
    return payload.user || null;
  },
  signup: async (email: string, password: string, name: string) => {
    const payload = await rawAuthRequest<AuthResponse>('/api/auth/register', { email, password, name });
    saveTokens(payload);
    return payload.user || null;
  },
  restore: refreshAccessToken,
  clear: () => { accessToken = null; localStorage.removeItem(REFRESH_TOKEN_KEY); },
  hasRefreshToken: () => Boolean(localStorage.getItem(REFRESH_TOKEN_KEY)),
};

export type SignalTier = 'STRONG' | 'GOOD' | 'WATCHLIST' | 'NO_TRADE';
export type SignalDirection = 'BUY' | 'SELL' | 'NEUTRAL';

export type LifecycleState =
  | 'observing' | 'developing' | 'near_trigger' | 'ready'
  | 'active' | 'tp1_reached' | 'tp2_reached' | 'tp3_reached'
  | 'break_even' | 'stopped' | 'expired' | 'invalidated'
  | 'blocked_by_news' | 'blocked_by_data' | 'blocked_by_spread'
  | 'blocked_by_risk' | 'closed';

export interface LifecycleTransition {
  id: string;
  fromState: LifecycleState | null;
  toState: LifecycleState;
  reasonCode: string;
  humanReadable: string;
  timestamp: string;
}

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

export interface PublishedSignal {
  id: number;
  published_at: string;
  updated_at: string;
  pair: string;
  direction: 'BUY' | 'SELL';
  timeframe: string;
  score: number;
  setup_quality: 'STRONG' | 'VALID';
  entry: number;
  stop_loss: number;
  tp1: number;
  tp2: number | null;
  tp3: number | null;
  net_rr: number | null;
  risk_percent: number | null;
  calendar_status: CalendarRiskStatus;
  scenario: string;
  rationale: string[];
  source_candle_time: number | null;
  engine_version: string;
  status: 'ACTIVE' | 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT' | 'STOPPED' | 'EXPIRED' | 'CANCELLED';
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

export interface Trigger {
  type: 'candle_close_above' | 'candle_close_below' | 'price_enters_zone' |
        'score_crosses_above' | 'coverage_crosses_above' | 'news_blackout_ends' |
        'direction_conflict_resolves' | 'adr_resets' | 'spread_below_threshold';
  symbol: string;
  timeframe?: string;
  price?: number;
  priceLow?: number;
  priceHigh?: number;
  threshold?: number;
  requiredCandleState?: string;
  currentValue?: number;
  completed: boolean;
  humanReadable: string;
}

export interface BlockingReason {
  code: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
}

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

export interface CalendarGlobalStatus {
  status: CalendarRiskStatus;
  event_title: string | null;
  currency: string | null;
  impact: string | null;
  time_until_event_minutes: number | null;
  blackout_start: string | null;
  blackout_end: string | null;
  affected_symbols: string[];
  next_eligible_time: string | null;
  existing_trades_affected: boolean;
  source: string;
  source_health: string;
  source_fetched_at: string | null;
  event: { id: string; title: string; currency: string; impact: string; scheduled_at: string; source: string } | null;
  next_event: { id: string; title: string; currency: string; impact: string; scheduled_at: string; source: string } | null;
  window: {
    caution_before_minutes: number;
    block_before_minutes: number;
    post_news_minutes: number;
  };
}

export type PlanReason = string | {
  code?: string;
  message?: string;
  severity?: string;
  blocks_trading?: boolean;
  data?: unknown;
};

export const planReasonText = (reason: PlanReason | unknown): string => {
  if (typeof reason === 'string') return reason;
  if (reason && typeof reason === 'object' && 'message' in reason && typeof (reason as { message?: unknown }).message === 'string') {
    return (reason as { message: string }).message;
  }
  return '';
};

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
  total_transaction_cost_bps?: number;
  spread_assumption_bps?: number;
  slippage_assumption_bps?: number;
  minimum_rr: number;
  targets: { label: string; price: number; r_multiple: number; reachable: boolean; gross_rr?: number; net_rr?: number }[];
  tp1?: number | null;
  tp2?: number | null;
  tp3?: number | null;
  gross_rr?: number | null;
  net_rr?: number | null;
  asset_class?: string;
  entry_type?: string;
  account_risk_percent: number;
  calendar_status: string;
  timing_status?: string;
  timing?: CryptoAnalysis['trade_timing'];
  reasons: PlanReason[];
  triggers: Trigger[];
  blocking_reasons: BlockingReason[];
}

export type ConfidenceTier = 'high' | 'qualified' | 'developing' | 'watch';

export interface CoverageInfo {
  coverage: number;
  confidenceTier: ConfidenceTier;
  categoriesAvailable: number;
  categoriesTotal: number;
  missingCategories: string[];
  staleCategories: string[];
  dataFreshnessSeconds: number;
}

export interface InstitutionalAnalysis {
  methodology: string;
  limitations: string[];
  market_structure: { timeframes: Record<string, { trend: string; swing_labels: string[]; latest_structure_event: string | null; confidence: string }>; overall: string; confidence: string; support: number[]; resistance: number[] };
  momentum_detail: { rsi: number | null; rsi_state: string; rsi_divergences: Array<{ type: string; confidence: string }>; macd: number | null; macd_signal: number | null; macd_histogram: number | null; agreement: { supporting: number; evaluated: number; summary: string } };
  elliott_wave: { classification: string; estimated_wave: number | null; primary_direction: string; alternative_count: string; confidence: string; pivot_count: number; status?: string; validated?: boolean };
  abcd_pattern: { detected: boolean; ab_cd_ratio?: number; bc_retracement?: number; completion_price?: number; direction?: string; confidence: string; status?: string; validated?: boolean };
  volatility_detail: { atr: number | null; historical_volatility_annualized_pct: number | null; bollinger_width: number | null; keltner_width: number | null; compression: boolean; regime: string };
  scenario_analysis?: { label?: string; method: string; calibrated?: boolean; position_sizing_allowed?: boolean; disclaimer?: string; bull_case: { weight_pct?: number; probability_pct: number; target: number | null }; base_case: { weight_pct?: number; probability_pct: number; expected_range: number[] }; bear_case: { weight_pct?: number; probability_pct: number; target: number | null } };
  trading_strategies?: Record<string, any>;
  risk_assessment?: { overall_risk_1_to_10: number; rating: string; largest_risks: string[]; calendar_status: string };
  monitoring_plan?: Record<string, any>;
  executive_summary?: { overall_bias: string; conviction_0_to_100: number; confidence: string; best_setup_status: string; recommended_time_horizon: string; entry: number | null; stop: number | null; targets: number[]; clear_invalidation: number | null; plain_english_thesis: string };
}

export interface DecisionQuality {
  scenario_weights: {
    label: string;
    weights: { bull?: number; base?: number; bear?: number };
    calibrated: boolean;
    forecast_probabilities: boolean;
    position_sizing_allowed: boolean;
    method: string;
    disclaimer: string;
  };
  scenario_weight_disclaimer: string;
  market_bias_confidence: number;
  setup_quality: number;
  execution_readiness: number;
  evidence_ledger: {
    canonical_score?: number;
    final_setup_score: number;
    method?: string;
    entries: Array<{ kind: string; points: number; polarity: 'positive' | 'negative' | 'neutral'; reason: string; available: boolean }>;
  };
  entry_alert?: {
    status: 'TRIGGERED' | 'ARMED' | 'MONITORING';
    entry: number | null;
    invalidation: number | null;
    conditions: unknown[];
    blocking_reasons: unknown[];
    message: string;
  };
  financial_risk_profile: {
    stop_pct: number | null;
    atr_normalized_stop: number | null;
    spread_bps: number | null;
    slippage_bps: number | null;
    liquidity_available: boolean;
    portfolio_correlation_available: boolean;
    news_status: string;
    news_proximity_minutes: number | null;
    historical_drawdown_available: boolean;
    net_rr_after_fees: number | null;
    risk_score_1_to_10: number;
    max_recommended_account_exposure_pct: number;
    exposure_basis: string;
    sizing_rule_status: string;
  };
}

export interface CryptoAnalysis {
  version: string;
  asset_class: string;
  pair: string;
  direction: 'BUY' | 'SELL' | 'NEUTRAL';
  raw_direction?: 'BUY' | 'SELL' | 'NEUTRAL';
  direction_stability?: { lifecycle: 'FORMING' | 'CONFIRMED' | 'READY' | 'WEAKENING' | 'INVALIDATED'; confirmed_direction: 'BUY' | 'SELL' | 'NEUTRAL'; raw_direction: 'BUY' | 'SELL' | 'NEUTRAL'; candidate_direction: 'BUY' | 'SELL' | 'NEUTRAL'; candidate_closes: number; required_closes: number; cooldown_bars: number; bars_since_change: number; reversal_margin: number; reason: string; last_closed_bar_time: number | null; last_change_time: number | null };
  lifecycle_state?: LifecycleState;
  recent_transitions?: LifecycleTransition[];
  total_score: number;
  category_breakdown: Record<string, number>;
  data_quality: { status: string; issues: string[]; primary_timeframe: string; bars: number; closed_bar_time?: number | null; timeframes_available: string[] };
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
  triggers: Trigger[];
  economic_calendar?: CalendarGateStatus;
  trade_plan?: CryptoTradePlan;
  confluence_score?: number;
  coverage?: number;
  confidence_tier?: ConfidenceTier;
  categories_available?: number;
  categories_total?: number;
  missing_categories?: string[];
  stale_categories?: string[];
  data_freshness_seconds?: number;
  institutional_analysis?: InstitutionalAnalysis;
  decision_quality?: DecisionQuality;
}

export interface CalibrationMetrics {
  sample_size: number;
  brier_score: number;
  calibration_error: number;
  precision: number;
  recall: number;
  expectancy_r: number;
  average_mae: number;
  max_mae: number;
  calibrated: boolean;
  reliability_bins: Array<{ lower_bound: number; upper_bound: number; sample_size: number; mean_forecast: number | null; observed_rate: number | null; gap: number | null }>;
}

export interface ValidationReport {
  status: 'CALIBRATED' | 'INSUFFICIENT_DATA';
  pending: number;
  resolved: number;
  calibration: CalibrationMetrics;
  segments: Record<string, Record<string, CalibrationMetrics>>;
  walk_forward: { no_lookahead: boolean; folds_used: number; out_of_sample: CalibrationMetrics };
  warning: string;
  dimensions: string[];
}

export interface V2BacktestReport {
  version: string; pair: string; timeframe: string; bars: number; history?: { start: number | null; end: number | null; years: number }; candidates: number;
  overall: { trades: number; wins: number; losses: number; win_rate: number; expectancy_r: number; profit_factor: number };
  in_sample_70pct: Record<string, number>; out_of_sample_30pct: Record<string, number>;
  validation: { status: 'INSUFFICIENT_DATA' | 'PROMISING' | 'REJECT'; minimum_out_of_sample_trades: number; observed_out_of_sample_trades: number; warning: string };
  calibration?: { sample_size: number; brier_score: number; calibration_error: number; precision: number; recall: number; expectancy_r: number; average_mae: number; max_mae: number; calibrated: boolean; reliability_bins: Array<{ lower_bound: number; upper_bound: number; sample_size: number; mean_forecast: number | null; observed_rate: number | null; gap: number | null }> };
  walk_forward?: { no_lookahead: boolean; folds_used: number; out_of_sample: Record<string, any> };
  calibration_segments?: Record<string, Record<string, any>>;
  calibration_disclaimer?: string;
  by_setup: Record<string, any>; by_confirmation: Record<string, any>; by_score_band: Record<string, any>; by_session: Record<string, any>; by_volatility_regime?: Record<string, any>;
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

export interface ChartAiAnalysis {
  summary: string;
  visual_bias: string;
  confidence: number;
  visible_patterns: string[];
  key_levels: { label: string; price: number; reason: string }[];
  confirmations: string[];
  conflicts: string[];
  risk_factors: string[];
  wait_for: string;
  invalidation: string;
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
  const res = await fetchWithAuth(url.toString(), {
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

export interface ScoreHistory {
  scores: number[];
  count: number;
}

export interface LifecycleTransition {
  from: string;
  to: string;
  timestamp: string;
}

export interface LifecycleState {
  state: string;
  since?: string;
}

export interface MarketInfo {
  status: string;
  current_price?: number;
  bid?: number;
  ask?: number;
  volume_24h?: number;
}

export interface ProviderHealth {
  market_data: string;
  calendar: string;
  minimax: string;
}

export interface EconomicRisk {
  level: string;
  active_events: number;
  high_impact_count?: number;
}

export interface PerformanceSummary {
  trades: number;
  win_rate: number;
  avg_r: number;
}

export interface PerformanceStats {
  source: 'backtested' | 'forward_tested' | 'paper_traded' | 'user_journal' | 'live_broker';
  sampleSize: number;
  dateRange: string;
  lastUpdated: string;
  winRate: number;
  tp1HitRate: number;
  tp2HitRate: number;
  tp3HitRate: number;
  stopLossRate: number;
  breakEvenRate: number;
  expirationRate: number;
  avgR: number;
  medianR: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdown: number;
  maxConsecutiveLosses: number;
  mfe: number;
  mae: number;
  avgHoldingBars: number;
  avgTimeToTP1: number;
  avgTimeToStop: number;
}

export interface MarketSnapshot {
  signal: BwtsSignal;
  analysis: CryptoAnalysis;
  market_info: MarketInfo;
  lifecycle_state: LifecycleState;
  recent_transitions: LifecycleTransition[];
  score_history: ScoreHistory;
}

export interface DashboardSnapshot {
  snapshot_id: string;
  generated_at: string;
  market_data_timestamp: string;
  scanner_health: BwtsHealth;
  config: BwtsConfig;
  provider_health: Record<string, ProviderHealth>;
  economic_event_risk: EconomicRisk;
  markets: MarketSnapshot[];
  performance_summary: PerformanceSummary;
  model_version: string;
}

async function post<T>(path: string, body: any): Promise<T> {
  const res = await fetchWithAuth(`${BASE}${path}`, {
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
  dashboardSnapshot: () => get<DashboardSnapshot>('/api/dashboard-snapshot'),
  signals: (opts?: { pair?: string; tier?: SignalTier; limit?: number }) =>
    getCached<{ signals: BwtsSignal[]; count: number }>('/api/signals', opts as any, 10_000),
  publishedSignals: (opts?: { status?: string; limit?: number }) =>
    getCached<{ signals: PublishedSignal[]; count: number; source: string }>('/api/published-signals', opts as any, 10_000),
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
  calendarGlobalStatus: () => getCached<CalendarGlobalStatus>('/api/calendar/status', {}, 30_000),
  calendarEvents: (pair?: string) => get<{ source: string; source_health: string; events: any[]; count: number }>('/api/calendar/events', pair ? { pair } : undefined),
  aiStatus: () => get<{ configured: boolean }>('/api/ai/status'),
  cryptoAnalysis: (pair: string, timeframe?: string) => getCached<CryptoAnalysis>('/api/analysis', timeframe ? { pair, timeframe } : { pair }, 20_000),
  v2Backtest: (pair: string, timeframe = '1h', limit = 10000) => get<V2BacktestReport>('/api/backtest/v2', { pair, timeframe, limit }),
  validationReport: (limit = 5000) => getCached<ValidationReport>('/api/validation/report', { limit }, 30_000),
  analyzeSignal: (pair: string, signal: BwtsSignal, analysis?: CryptoAnalysis) => post<{ configured: boolean; analysis: AiSignalAnalysis; calendar: CalendarGateStatus }>('/api/ai/analyze', { pair, signal, analysis }),
  chartAnalyze: (payload: {
    pair: string;
    timeframe: string;
    image_data_url: string;
    chart: {
      current_price: number;
      candles: Array<{ time: number; open: number; high: number; low: number; close: number }>;
      overlays: Record<string, unknown>;
      manual_drawings: unknown[];
    };
    analysis?: CryptoAnalysis | null;
  }) => post<{ configured: boolean; model?: string; analysis: ChartAiAnalysis; calendar: CalendarGlobalStatus }>('/api/ai/chart-analyze', payload),

  getPerformanceStats: (filters?: { assetClass?: string; symbol?: string; direction?: string; scoreBand?: string; confidenceTier?: string; dateFrom?: string; dateTo?: string }) =>
    get<PerformanceStats>('/api/performance/stats', filters as Record<string, string>),

  baseUrl: () => BASE,
  alertPreferences: () => get<AlertPreferences>('/api/alerts/preferences'),
  saveAlertPreferences: (prefs: Partial<AlertPreferences>) => post<AlertPreferences>('/api/alerts/preferences', prefs as Record<string, unknown>),
  alertFeed: (limit = 50) => get<{ events: AlertEvent[]; count: number }>('/api/alerts/feed', { limit }),
};

export interface AlertPreferences {
  user_id: number;
  watchlist: string[];
  timeframes: Record<string, boolean>;
  sessions: string[];
  setup_quality_minimum: number;
  timing_minimum: number;
  risk_per_trade_pct: number;
  enabled_alert_types: string[];
  delivery_channels: string[];
  telegram_chat_id: string | null;
  daily_briefing_enabled: boolean;
  weekly_briefing_enabled: boolean;
  last_daily_briefing_at: string | null;
  last_weekly_briefing_at: string | null;
}

export interface AlertEvent {
  user_id: number;
  alert_type: string;
  pair: string;
  timeframe: string | null;
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
  payload: Record<string, unknown>;
  created_at: string;
}

export default bwtsApi;
