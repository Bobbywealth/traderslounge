// API Service for communicating with backend server
const FALLBACK_API_URL = 'https://traderslounge-api.onrender.com';
const API_BASE_URL = import.meta.env.VITE_API_URL || FALLBACK_API_URL;

if (!import.meta.env.VITE_API_URL && import.meta.env.DEV) {
  console.warn(`VITE_API_URL is not set. Falling back to ${FALLBACK_API_URL}.`);
}

export interface SignalAnalysis {
  id: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  risk_reward_ratio: number;
  confidence: number;
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
  };
  risk_factors: string[];
  chart_urls?: {
    M15: string;
    H1: string;
    H4: string;
    D1: string;
    W1: string;
    MN: string;
  };
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface RefreshResult {
  symbol: string;
  success: boolean;
  signal?: SignalAnalysis;
  error?: string;
}

// TradeLocker API
export const tradeLockerApi = {
  async connect(): Promise<{ connected: boolean; demo?: boolean; hasCredentials?: boolean }> {
    const sessionId = localStorage.getItem('tl_session_id');
    const response = await fetch(
      `${API_BASE_URL}/api/tradelocker/status?sessionId=${sessionId || ''}`
    );
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
    const url = sessionId
      ? `${API_BASE_URL}/api/tradelocker/account?sessionId=${sessionId}`
      : `${API_BASE_URL}/api/tradelocker/account`;
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to get account');
    return data;
  },

  async getPositions(accountId: string): Promise<any[]> {
    const sessionId = localStorage.getItem('tl_session_id');
    const response = await fetch(
      `${API_BASE_URL}/api/tradelocker/positions?sessionId=${sessionId || ''}&accountId=${accountId}`
    );
    return response.json();
  },

  async getOrders(accountId: string): Promise<any[]> {
    const sessionId = localStorage.getItem('tl_session_id');
    const response = await fetch(
      `${API_BASE_URL}/api/tradelocker/orders?sessionId=${sessionId || ''}&accountId=${accountId}`
    );
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
    
    return data.signals.map((s: any) => ({
      ...s,
      entry_price: parseFloat(s.entry_price),
      stop_loss: parseFloat(s.stop_loss),
      take_profit: parseFloat(s.take_profit),
      risk_reward_ratio: parseFloat(s.risk_reward_ratio),
      confidence: parseFloat(s.confidence),
      trend_strength: parseFloat(s.trend_strength),
    }));
  },
  
  async getSignal(symbol: string): Promise<SignalAnalysis | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/signals/${symbol}`);
      const data = await response.json();
      const s = data.signal;
      return s ? {
        ...s,
        entry_price: parseFloat(s.entry_price),
        stop_loss: parseFloat(s.stop_loss),
        take_profit: parseFloat(s.take_profit),
        risk_reward_ratio: parseFloat(s.risk_reward_ratio),
        confidence: parseFloat(s.confidence),
        trend_strength: parseFloat(s.trend_strength),
      } : null;
    } catch {
      return null;
    }
  },
  
  async refreshSignals(symbols: string[] = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'AUDUSD', 'USDCAD']): Promise<RefreshResult[]> {
    const response = await fetch(`${API_BASE_URL}/api/signals/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols })
    });
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to refresh signals');
    }
    
    return data.results.map((r: any) => r.signal ? {
      ...r,
      signal: {
        ...r.signal,
        entry_price: parseFloat(r.signal.entry_price),
        stop_loss: parseFloat(r.signal.stop_loss),
        take_profit: parseFloat(r.signal.take_profit),
        risk_reward_ratio: parseFloat(r.signal.risk_reward_ratio),
        confidence: parseFloat(r.signal.confidence),
        trend_strength: parseFloat(r.signal.trend_strength),
      }
    } : r);
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
