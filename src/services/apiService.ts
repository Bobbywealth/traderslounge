// API Service for communicating with backend server
const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://traderslounge.onrender.com';

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
  
  async getPositions(accountId: string): Promise<any[]> {
    const sessionId = localStorage.getItem('tl_session_id');
    const response = await fetch(
      `${API_BASE_URL}/api/tradelocker/positions?sessionId=${sessionId}&accountId=${accountId}`
    );
    return response.json();
  },
  
  async getOrders(accountId: string): Promise<any[]> {
    const sessionId = localStorage.getItem('tl_session_id');
    const response = await fetch(
      `${API_BASE_URL}/api/tradelocker/orders?sessionId=${sessionId}&accountId=${accountId}`
    );
    return response.json();
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
    
    return data.signals;
  },
  
  async getSignal(symbol: string): Promise<SignalAnalysis | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/signals/${symbol}`);
      const data = await response.json();
      return data.success ? data.signal : null;
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
    
    return data.results;
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
