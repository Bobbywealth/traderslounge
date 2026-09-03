// API Service for communicating with backend server
import { applyHtfBiasPenalty, evaluateHtfBias, type BiasStatus } from '../strategy/htfBias';
import apiClient from './apiClient';

const API_BASE_URL = apiClient.getBaseUrl();

const buildTradeLockerUrl = (path: string, params: Record<string, string | null | undefined> = {}): string => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      query.set(key, value);
    }
  });

  const queryString = query.toString();
  return queryString ? `${API_BASE_URL}${path}?${queryString}` : `${API_BASE_URL}${path}`;
};

export interface SignalAnalysis {
  id: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  risk_reward_ratio: number;
  confidence: number;
  adjusted_confidence?: number;
  bias_status?: BiasStatus;
  no_trade?: boolean;
  trend: string;
  trend_strength: number;
  sentiment: string;
  reasoning: string;
  market_summary: string;
  support_levels: number[];
  resistance_levels: number[];
  key_levels: {
    key_level_1: { price: number; significance: string };
    key_level_2: { price: number; significance: string };
  };
  timeframes: {
    H1: { trend: string; signal: string };
    H4: { trend: string; signal: string };
    D1: { trend: string; signal: string };
  };
  trade_setup: {
    type: string;
    timeframe: string;
    best_entry: string;
    explanation: string;
    pattern?: string | null;
    tp1?: number | null;
    tp2?: number | null;
    tp3?: number | null;
    score_breakdown?: Record<string, number>;
    alert_level?: 'strong' | 'good' | 'watchlist' | 'no_trade';
    risk_level?: 'low' | 'medium' | 'high';
    session?: string;
    adr?: {
      adr?: number;
      percentUsed?: number;
      nearAdrHigh?: boolean;
      nearAdrLow?: boolean;
      exhausted?: boolean;
    } | null;
  };
  risk_factors: string[];
  expires_at: string;
  created_at: string;
  updated_at: string;
  tp1?: number | null;
  tp2?: number | null;
  tp3?: number | null;
  score_breakdown?: Record<string, number>;
  alert_level?: 'strong' | 'good' | 'watchlist' | 'no_trade';
  risk_level?: 'low' | 'medium' | 'high';
  session?: string;
  pattern?: string | null;
  adr_percent_used?: number | null;
  news_status?: {
    blocked: boolean;
    configured?: boolean;
    event?: { name: string; currency: string; impact: string; time: string } | null;
    nextEvent?: { name: string; currency: string; impact: string; time: string; minutesAway: number } | null;
  } | null;
}

export interface RefreshResult {
  symbol: string;
  success: boolean;
  signal?: SignalAnalysis;
  error?: string;
}

export interface RefreshMetadata {
  startedAt: string | null;
  finishedAt: string | null;
  nextAllowedRefreshAt: string | null;
  inProgress: boolean;
}

export interface RefreshSignalsResponse extends RefreshMetadata {
  success: boolean;
  results: RefreshResult[];
  error?: string;
}

// TradeLocker API
export const tradeLockerApi = {
  async connect(): Promise<{ connected: boolean; demo?: boolean; hasCredentials?: boolean }> {
    const sessionId = localStorage.getItem('tl_session_id');
    return apiClient.get('/api/tradelocker/status', { sessionId });
  },

  async authenticate(email: string, password: string, server: string, isDemo: boolean = true): Promise<any> {
    const sessionId = crypto.randomUUID();
    const data = await apiClient.post('/api/tradelocker/auth', { email, password, server, isDemo, sessionId });
    localStorage.setItem('tl_session_id', sessionId);
    return data;
  },

  async getAccount(): Promise<any> {
    const sessionId = localStorage.getItem('tl_session_id');
    return apiClient.get('/api/tradelocker/account', { sessionId });
  },

  async getPositions(accountId: string): Promise<any[]> {
    const sessionId = localStorage.getItem('tl_session_id');
    return apiClient.get('/api/tradelocker/positions', { sessionId, accountId });
  },

  async getOrders(accountId: string): Promise<any[]> {
    const sessionId = localStorage.getItem('tl_session_id');
    return apiClient.get('/api/tradelocker/orders', { sessionId, accountId });
  },

  async executeSignal(signal: SignalAnalysis, accountId?: string, quantity: number = 1): Promise<any> {
    const sessionId = localStorage.getItem('tl_session_id');
    return apiClient.post('/api/tradelocker/execute-signal', {
      sessionId,
      signal: {
        symbol: signal.symbol,
        direction: signal.direction,
        entry_price: signal.entry_price,
        stop_loss: signal.stop_loss,
        take_profit: signal.take_profit,
      },
      accountId,
      quantity
    });
  },

  async disconnect(): Promise<void> {
    const sessionId = localStorage.getItem('tl_session_id');
    await apiClient.post('/api/tradelocker/disconnect', { sessionId });
    localStorage.removeItem('tl_session_id');
  }
};


const numOrNull = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const safeNum = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const mapSignal = (s: any): SignalAnalysis => {
  const timeframes = s.timeframes || {};
  const bias = evaluateHtfBias(timeframes);
  const confidence = safeNum(s.confidence) ?? 0;
  const setup = s.trade_setup || {};

  return {
    ...s,
    direction: s.direction ?? 'buy',
    entry_price: safeNum(s.entry_price) ?? 0,
    stop_loss: safeNum(s.stop_loss) ?? 0,
    take_profit: safeNum(s.take_profit) ?? 0,
    risk_reward_ratio: safeNum(s.risk_reward_ratio) ?? 0,
    confidence,
    adjusted_confidence: applyHtfBiasPenalty(confidence, bias),
    bias_status: bias.status,
    no_trade: bias.hardInvalid,
    trend_strength: safeNum(s.trend_strength) ?? 0,
    tp1: numOrNull(setup.tp1),
    tp2: numOrNull(setup.tp2),
    tp3: numOrNull(setup.tp3),
    score_breakdown: setup.score_breakdown || undefined,
    alert_level: setup.alert_level,
    risk_level: setup.risk_level,
    session: setup.session,
    pattern: setup.pattern || null,
    adr_percent_used: numOrNull(setup.adr?.percentUsed),
    news_status: setup.news_status || null,
  };
};

// Signals API removed — Signals.tsx now uses bwtsApi.publishedSignals
// (V2 published_signals table) and bwtsApi.dashboardSnapshot for forming
// setups. The legacy /api/signals endpoint still exists server-side for
// backwards compat but no production code calls it.

export default { tradeLockerApi };
