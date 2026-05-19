// API Service for communicating with backend server
import { applyHtfBiasPenalty, evaluateHtfBias, type BiasStatus } from '../strategy/htfBias';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://traderslounge.onrender.com';

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
    const response = await fetch(buildTradeLockerUrl('/api/tradelocker/status', { sessionId }));
    return response.json();
  },

  async authenticate(email: string, password: string, server: string, isDemo: boolean = true): Promise<any> {
    const sessionId = crypto.randomUUID();
    const response = await fetch(`${API_BASE_URL}/api/tradelocker/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, server, isDemo, sessionId })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Authentication failed');
    }

    const data = await response.json();
    localStorage.setItem('tl_session_id', sessionId);
    return data;
  },

  async getAccount(): Promise<any> {
    const sessionId = localStorage.getItem('tl_session_id');
    const url = buildTradeLockerUrl('/api/tradelocker/account', { sessionId });
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to get account');
    return data;
  },

  async getPositions(accountId: string): Promise<any[]> {
    const sessionId = localStorage.getItem('tl_session_id');
    const response = await fetch(buildTradeLockerUrl('/api/tradelocker/positions', { sessionId, accountId }));
    return response.json();
  },

  async getOrders(accountId: string): Promise<any[]> {
    const sessionId = localStorage.getItem('tl_session_id');
    const response = await fetch(buildTradeLockerUrl('/api/tradelocker/orders', { sessionId, accountId }));
    return response.json();
  },

  async executeSignal(signal: SignalAnalysis, accountId?: string, quantity: number = 1): Promise<any> {
    const sessionId = localStorage.getItem('tl_session_id');
    const response = await fetch(`${API_BASE_URL}/api/tradelocker/execute-signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || data.message || 'Failed to execute trade');
    return data;
  },

  async disconnect(): Promise<void> {
    const sessionId = localStorage.getItem('tl_session_id');
    await fetch(`${API_BASE_URL}/api/tradelocker/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId })
    });
    localStorage.removeItem('tl_session_id');
  }
};


const numOrNull = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const mapSignal = (s: any): SignalAnalysis => {
  const bias = evaluateHtfBias(s.timeframes);
  const confidence = parseFloat(s.confidence);
  const setup = s.trade_setup || {};

  return {
    ...s,
    entry_price: parseFloat(s.entry_price),
    stop_loss: parseFloat(s.stop_loss),
    take_profit: parseFloat(s.take_profit),
    risk_reward_ratio: parseFloat(s.risk_reward_ratio),
    confidence,
    adjusted_confidence: applyHtfBiasPenalty(confidence, bias),
    bias_status: bias.status,
    no_trade: bias.hardInvalid,
    trend_strength: parseFloat(s.trend_strength),
    tp1: numOrNull(setup.tp1),
    tp2: numOrNull(setup.tp2),
    tp3: numOrNull(setup.tp3),
    score_breakdown: setup.score_breakdown || undefined,
    alert_level: setup.alert_level,
    risk_level: setup.risk_level,
    session: setup.session,
    pattern: setup.pattern || null,
    adr_percent_used: numOrNull(setup.adr?.percentUsed),
  };
};

// Signals API
export const signalsApi = {
  async getSignals(symbol?: string, limit: number = 50): Promise<SignalAnalysis[]> {
    const params = new URLSearchParams();
    if (symbol) params.set('symbol', symbol);
    params.set('limit', limit.toString());
    
    const response = await fetch(`${API_BASE_URL}/api/signals?${params}`);
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch signals');
    }
    
    return data.signals.map(mapSignal);
  },
  
  async getSignal(symbol: string): Promise<SignalAnalysis | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/signals/${symbol}`);
      const data = await response.json();
      const s = data.signal;
      return s ? mapSignal(s) : null;
    } catch {
      return null;
    }
  },
  
  async refreshSignals(
    symbols: string[] = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'AUDUSD', 'USDCAD'],
    options: { force?: boolean } = {}
  ): Promise<RefreshSignalsResponse> {
    const params = new URLSearchParams();
    if (options.force) params.set('force', 'true');

    const response = await fetch(`${API_BASE_URL}/api/signals/refresh?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols })
    });
    
    const data = await response.json();

    const mappedResults = (data.results || []).map((r: any) => r.signal ? {
      ...r,
      signal: mapSignal(r.signal)
    } : r);

    const payload: RefreshSignalsResponse = {
      success: data.success,
      error: data.error,
      startedAt: data.startedAt ?? null,
      finishedAt: data.finishedAt ?? null,
      nextAllowedRefreshAt: data.nextAllowedRefreshAt ?? null,
      inProgress: !!data.inProgress,
      results: mappedResults
    };

    if (!response.ok || !data.success) {
      const message = data.error || 'Failed to refresh signals';
      const error = new Error(message) as Error & { details?: RefreshSignalsResponse };
      error.details = payload;
      throw error;
    }

    return payload;
  },
  
  async cleanup(): Promise<number> {
    const response = await fetch(`${API_BASE_URL}/api/signals/cleanup`, {
      method: 'DELETE'
    });
    const data = await response.json();
    return data.deleted || 0;
  }
};

export default { tradeLockerApi, signalsApi };
