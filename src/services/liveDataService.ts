// LIVE MARKET DATA SERVICE - Requires API keys for real data
import axios from 'axios';
import { calculateAdr, type AdrCandle } from '../indicators/adrCalculator';

// Canonical confirmation candle rules shared by all trade-trigger scanners:
// docs/strategy/confirmation-candle.md
export const CONFIRMATION_CANDLE_RULES_DOC = 'docs/strategy/confirmation-candle.md';

export interface LivePrice {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  timestamp: Date;
  change: number;
  changePercent: number;
  high24h: number;
  low24h: number;
  volume24h: number;
}

export interface HarmonicPattern {
  id: string;
  symbol: string;
  type: 'Gartley' | 'Butterfly' | 'Bat' | 'Crab' | 'Deep Crab' | 'Shark' | 'Cypher' | 'ABCD';
  direction: 'bullish' | 'bearish';
  completion: number;
  points: {
    X: { price: number; time: Date };
    A: { price: number; time: Date };
    B: { price: number; time: Date };
    C: { price: number; time: Date };
    D: { price: number; time: Date };
  };
  ratios: {
    AB_XA: number;
    BC_AB: number;
    CD_BC: number;
    AD_XA: number;
  };
  prz: {
    min: number;
    max: number;
  };
  confidence: number;
  status: 'forming' | 'completed' | 'triggered' | 'failed';
}

export interface FibonacciLevel {
  level: number;
  price: number;
  type: 'retracement' | 'extension';
  strength: 'weak' | 'medium' | 'strong';
}

export interface ADRData {
  symbol: string;
  averageDailyRange: number;
  currentRange: number;
  rangePercent: number;
  dailyHigh: number;
  dailyLow: number;
  projectedHigh: number;
  projectedLow: number;
  session: 'asian' | 'london' | 'newyork' | 'overlap';
}

export interface TrendLine {
  id: string;
  symbol: string;
  type: 'support' | 'resistance';
  points: Array<{ price: number; time: Date }>;
  slope: number;
  strength: number;
  touches: number;
  currentPrice: number;
  distance: number;
  isActive: boolean;
}

export interface SessionData {
  session: 'asian' | 'london' | 'newyork';
  isActive: boolean;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  volatility: number;
  timeRemaining: string;
}

class LiveDataService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private subscribers: Map<string, Function[]> = new Map();
  private isInitialized = false;

  // API Keys from environment
  private readonly FINNHUB_API_KEY = import.meta.env.VITE_FINNHUB_API_KEY || '';
  private readonly PERPLEXITY_API_KEY = import.meta.env.VITE_PERPLEXITY_API_KEY || '';

  constructor() {
    if (this.FINNHUB_API_KEY) {
      this.initializeWebSocket();
    }
  }

  // Check if service is configured
  isConfigured(): boolean {
    return !!this.FINNHUB_API_KEY;
  }

  // REAL-TIME WEBSOCKET CONNECTION
  private initializeWebSocket() {
    if (!this.FINNHUB_API_KEY) {
      console.log('⚠️ No Finnhub API key configured. Please add VITE_FINNHUB_API_KEY to your environment.');
      this.isInitialized = true;
      return;
    }

    try {
      console.log('🚀 CONNECTING TO FINNHUB LIVE DATA...');
      this.ws = new WebSocket(`wss://ws.finnhub.io?token=${this.FINNHUB_API_KEY}`);
      
      this.ws.onopen = () => {
        console.log('✅ FINNHUB WEBSOCKET CONNECTED!');
        this.reconnectAttempts = 0;
        
        const symbols = [
          'OANDA:EUR_USD', 
          'OANDA:GBP_USD', 
          'OANDA:USD_JPY', 
          'OANDA:AUD_USD', 
          'OANDA:USD_CAD',
          'OANDA:XAU_USD'
        ];
        symbols.forEach(symbol => {
          this.ws?.send(JSON.stringify({ type: 'subscribe', symbol }));
        });
      };

      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        this.handleLiveData(data);
      };

      this.ws.onclose = () => {
        console.log('❌ Finnhub WebSocket disconnected');
        this.reconnect();
      };

      this.ws.onerror = (error) => {
        console.error('❌ Finnhub WebSocket error:', error);
      };
    } catch (error) {
      console.error('❌ Failed to initialize Finnhub WebSocket:', error);
    }
    
    this.isInitialized = true;
  }

  private reconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => {
        this.initializeWebSocket();
      }, 5000 * this.reconnectAttempts);
    }
  }

  private handleLiveData(data: any) {
    if (data.type === 'trade') {
      data.data.forEach((trade: any) => {
        const symbol = trade.s.replace('OANDA:', '').replace('_', '');
        const price = trade.p;
        const spread = this.getTypicalSpread(symbol);
        
        const livePrice: LivePrice = {
          symbol,
          bid: price - (spread / 2),
          ask: price + (spread / 2),
          spread,
          timestamp: new Date(trade.t),
          change: 0,
          changePercent: 0,
          high24h: price * 1.008,
          low24h: price * 0.992,
          volume24h: trade.v || 1000000,
        };
        
        this.notifySubscribers('price', livePrice);
      });
    }
  }

  private getTypicalSpread(symbol: string): number {
    const spreads: Record<string, number> = {
      'EURUSD': 0.00015,
      'GBPUSD': 0.00020,
      'USDJPY': 0.015,
      'AUDUSD': 0.00018,
      'USDCAD': 0.00022,
      'XAUUSD': 0.35,
    };
    return spreads[symbol] || 0.0002;
  }

  // HARMONIC PATTERN DETECTION
  async detectHarmonicPatterns(symbol: string): Promise<HarmonicPattern[]> {
    if (!this.isConfigured()) {
      console.warn('⚠️ Service not configured. Add VITE_FINNHUB_API_KEY to environment.');
      return [];
    }

    try {
      const priceData = await this.getPriceHistory(symbol, 200);
      const patterns = this.analyzeHarmonicPatterns(priceData, symbol);
      return patterns;
    } catch (error) {
      console.error('Harmonic pattern detection failed:', error);
      return [];
    }
  }

  private analyzeHarmonicPatterns(priceData: any[], symbol: string): HarmonicPattern[] {
    const patterns: HarmonicPattern[] = [];
    
    for (let i = 50; i < priceData.length - 50; i++) {
      const X = priceData[i - 40];
      const A = priceData[i - 30];
      const B = priceData[i - 20];
      const C = priceData[i - 10];
      const D = priceData[i];

      const AB_XA = Math.abs(B.close - A.close) / Math.abs(A.close - X.close);
      const BC_AB = Math.abs(C.close - B.close) / Math.abs(B.close - A.close);
      const CD_BC = Math.abs(D.close - C.close) / Math.abs(C.close - B.close);
      const AD_XA = Math.abs(D.close - A.close) / Math.abs(A.close - X.close);

      if (this.isGartleyPattern(AB_XA, BC_AB, CD_BC, AD_XA)) {
        const direction = D.close > X.close ? 'bullish' : 'bearish';
        
        patterns.push({
          id: `gartley_${i}_${Date.now()}`,
          symbol,
          type: 'Gartley',
          direction,
          completion: 95,
          points: {
            X: { price: X.close, time: new Date(X.time) },
            A: { price: A.close, time: new Date(A.time) },
            B: { price: B.close, time: new Date(B.time) },
            C: { price: C.close, time: new Date(C.time) },
            D: { price: D.close, time: new Date(D.time) },
          },
          ratios: { AB_XA, BC_AB, CD_BC, AD_XA },
          prz: {
            min: D.close * 0.999,
            max: D.close * 1.001,
          },
          confidence: this.calculatePatternConfidence(AB_XA, BC_AB, CD_BC, AD_XA),
          status: 'completed'
        });
      }
    }

    return patterns;
  }

  private isGartleyPattern(AB_XA: number, BC_AB: number, CD_BC: number, AD_XA: number): boolean {
    return (
      Math.abs(AB_XA - 0.618) < 0.05 &&
      BC_AB >= 0.382 && BC_AB <= 0.886 &&
      Math.abs(CD_BC - 1.272) < 0.1 &&
      Math.abs(AD_XA - 0.786) < 0.05
    );
  }

  private calculatePatternConfidence(AB_XA: number, BC_AB: number, CD_BC: number, AD_XA: number): number {
    let confidence = 100;
    confidence -= Math.abs(AB_XA - 0.618) * 100;
    confidence -= Math.abs(CD_BC - 1.272) * 50;
    confidence -= Math.abs(AD_XA - 0.786) * 100;
    return Math.max(60, Math.min(95, confidence));
  }

  // FIBONACCI LEVELS
  async calculateFibonacciLevels(symbol: string, _high?: number, _low?: number): Promise<FibonacciLevel[]> {
    try {
      const priceData = await this.getPriceHistory(symbol, 250);
      const bars = priceData.map((candle: any) => ({
        time: candle.time,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));

      const { levels } = calculateFibonacciFromSwings(bars, {
        swingDetector: {
          leftBars: 3,
          rightBars: 3,
          minSwingDistance: { mode: 'atr', value: 0.5, atrPeriod: 14 },
          invalidation: { replaceWithMoreExtreme: true, requireAlternation: true },
        },
      });

      return levels;
    } catch (error) {
      console.error('Fibonacci calculation failed:', error);
      return [];
    }
  }


  // ADR CALCULATION
  async calculateADR(symbol: string): Promise<ADRData | null> {
    if (!this.isConfigured()) {
      return null;
    }

    try {
      const dailyData = await this.getDailyData(symbol, 40);
      const adr = calculateAdr(symbol, dailyData as AdrCandle[]);
      if (!adr) return null;

      return {
        symbol,
        ...adr,
        session: this.getCurrentSession()
      };
    } catch (error) {
      console.error('ADR calculation failed:', error);
      return null;
    }
  }

  // TRENDLINE DETECTION
  async detectTrendLines(symbol: string): Promise<TrendLine[]> {
    if (!this.isConfigured()) {
      return [];
    }

    try {
      const priceData = await this.getPriceHistory(symbol, 100);
      return this.analyzeTrendLines(priceData, symbol);
    } catch (error) {
      console.error('Trendline detection failed:', error);
      return [];
    }
  }

  private analyzeTrendLines(priceData: any[], symbol: string): TrendLine[] {
    const trendLines: TrendLine[] = [];
    
    const lows = this.findLocalLows(priceData);
    for (let i = 0; i < lows.length - 1; i++) {
      for (let j = i + 1; j < lows.length; j++) {
        const point1 = lows[i];
        const point2 = lows[j];
        const slope = (point2.price - point1.price) / (point2.time - point1.time);
        
        if (Math.abs(slope) < 0.001) {
          const touches = this.countTrendLineTouches(priceData, point1, point2, 'support');
          
          if (touches >= 2) {
            trendLines.push({
              id: `support_${i}_${j}`,
              symbol,
              type: 'support',
              points: [
                { price: point1.price, time: new Date(point1.time) },
                { price: point2.price, time: new Date(point2.time) }
              ],
              slope,
              strength: touches * 20,
              touches,
              currentPrice: priceData[priceData.length - 1].close,
              distance: Math.abs(priceData[priceData.length - 1].close - point2.price),
              isActive: true
            });
          }
        }
      }
    }

    return trendLines.slice(0, 5);
  }

  private findLocalLows(data: any[]): any[] {
    const lows = [];
    for (let i = 2; i < data.length - 2; i++) {
      if (data[i].low < data[i-1].low && data[i].low < data[i-2].low && 
          data[i].low < data[i+1].low && data[i].low < data[i+2].low) {
        lows.push({ price: data[i].low, time: data[i].time });
      }
    }
    return lows;
  }

  private countTrendLineTouches(data: any[], point1: any, point2: any, type: 'support' | 'resistance'): number {
    let touches = 0;
    const tolerance = 0.0005;
    
    for (const candle of data) {
      const linePrice = this.calculateTrendLinePrice(point1, point2, candle.time);
      const testPrice = type === 'support' ? candle.low : candle.high;
      
      if (Math.abs(testPrice - linePrice) <= tolerance) {
        touches++;
      }
    }
    
    return touches;
  }

  private calculateTrendLinePrice(point1: any, point2: any, time: number): number {
    const slope = (point2.price - point1.price) / (point2.time - point1.time);
    return point1.price + slope * (time - point1.time);
  }

  // SESSION ANALYSIS
  getCurrentSession(): 'asian' | 'london' | 'newyork' {
    const now = new Date();
    const utcHour = now.getUTCHours();
    
    if (utcHour >= 0 && utcHour < 8) return 'asian';
    if (utcHour >= 8 && utcHour < 16) return 'london';
    return 'newyork';
  }

  async getSessionData(): Promise<SessionData[]> {
    return [];
  }

  // API DATA FETCHING
  async getPriceHistory(symbol: string, periods: number = 100): Promise<any[]> {
    if (!this.FINNHUB_API_KEY) {
      console.warn('⚠️ No API key configured. Cannot fetch price history.');
      return [];
    }

    try {
      const response = await axios.get(`https://finnhub.io/api/v1/forex/candle`, {
        params: {
          symbol: `OANDA:${symbol.substring(0, 3)}_${symbol.substring(3, 6)}`,
          resolution: '5',
          from: Math.floor(Date.now() / 1000) - (periods * 5 * 60),
          to: Math.floor(Date.now() / 1000),
          token: this.FINNHUB_API_KEY
        }
      });

      if (response.data.s === 'no_data') {
        console.warn(`Finnhub: No data for ${symbol}`);
        return [];
      }

      const candles = response.data.t || [];
      const opens = response.data.o || [];
      const highs = response.data.h || [];
      const lows = response.data.l || [];
      const closes = response.data.c || [];

      return candles.map((time: number, i: number) => ({
        time: time * 1000,
        open: opens[i],
        high: highs[i],
        low: lows[i],
        close: closes[i]
      })).slice(-periods);
    } catch (error) {
      console.error(`Price history fetch failed for ${symbol}:`, error);
      return [];
    }
  }

  async getCurrentPrice(symbol: string): Promise<number | null> {
    if (!this.FINNHUB_API_KEY) {
      return null;
    }

    try {
      const response = await axios.get(`https://finnhub.io/api/v1/quote`, {
        params: {
          symbol: `OANDA:${symbol.substring(0, 3)}_${symbol.substring(3, 6)}`,
          token: this.FINNHUB_API_KEY
        }
      });

      if (response.data.c) {
        return response.data.c;
      }
      return null;
    } catch (error) {
      console.error(`Failed to get current price for ${symbol}:`, error);
      return null;
    }
  }

  private async getDailyData(symbol: string, days: number): Promise<any[]> {
    if (!this.FINNHUB_API_KEY) {
      return [];
    }

    try {
      const response = await axios.get(`https://finnhub.io/api/v1/forex/candle`, {
        params: {
          symbol: `OANDA:${symbol.substring(0, 3)}_${symbol.substring(3, 6)}`,
          resolution: 'D',
          from: Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60),
          to: Math.floor(Date.now() / 1000),
          token: this.FINNHUB_API_KEY
        }
      });

      if (response.data.s === 'no_data') {
        return [];
      }

      const candles = response.data.t || [];
      const opens = response.data.o || [];
      const highs = response.data.h || [];
      const lows = response.data.l || [];
      const closes = response.data.c || [];

      return candles.map((time: number, i: number) => ({
        time: time * 1000,
        open: opens[i],
        high: highs[i],
        low: lows[i],
        close: closes[i]
      }));
    } catch (error) {
      console.error(`Daily data fetch failed for ${symbol}:`, error);
      return [];
    }
  }

  // SUBSCRIPTION SYSTEM
  subscribe(event: string, callback: Function) {
    if (!this.subscribers.has(event)) {
      this.subscribers.set(event, []);
    }
    this.subscribers.get(event)!.push(callback);
  }

  unsubscribe(event: string, callback: Function) {
    const callbacks = this.subscribers.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  private notifySubscribers(event: string, data: any) {
    const callbacks = this.subscribers.get(event);
    if (callbacks) {
      callbacks.forEach(callback => callback(data));
    }
  }

  // CLEANUP
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscribers.clear();
  }
}

export const liveDataService = new LiveDataService();
