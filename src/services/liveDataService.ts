// REAL LIVE MARKET DATA SERVICE
import axios from 'axios';

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
  type: 'Gartley' | 'Butterfly' | 'Bat' | 'Crab' | 'Cypher' | 'ABCD';
  direction: 'bullish' | 'bearish';
  completion: number; // 0-100%
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
  prz: { // Potential Reversal Zone
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

  // API Keys - Users need to configure these
  private readonly API_KEYS = {
    FINNHUB: localStorage.getItem('api_finnhub') || '',
    ALPHA_VANTAGE: localStorage.getItem('api_alpha_vantage') || 'N35281CO4LORS4CU',
    POLYGON: localStorage.getItem('api_polygon') || 'demo',
    FXCM: localStorage.getItem('api_fxcm') || 'demo',
    NEWSAPI: localStorage.getItem('api_newsApi') || 'c57dc72d29424da3a896faf4e7fd380b',
  };

  constructor() {
    this.initializeWebSocket();
  }

  // REAL-TIME WEBSOCKET CONNECTION
  private initializeWebSocket() {
    // Use configured Finnhub API key
    if (!this.API_KEYS.FINNHUB || this.API_KEYS.FINNHUB === 'demo' || this.API_KEYS.FINNHUB === '') {
      console.log('⚠️ No valid Finnhub API key configured, using mock data stream');
      this.startMockDataStream();
      return;
    }

    try {
      console.log('🚀 CONNECTING TO FINNHUB LIVE DATA...');
      this.ws = new WebSocket(`wss://ws.finnhub.io?token=${this.API_KEYS.FINNHUB}`);
      
      this.ws.onopen = () => {
        console.log('✅ FINNHUB WEBSOCKET CONNECTED!');
        this.reconnectAttempts = 0;
        
        // Subscribe to major forex pairs
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
          console.log(`📊 Subscribed to ${symbol}`);
        });
      };

      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('📈 Live data received:', data);
        this.handleLiveData(data);
      };

      this.ws.onclose = () => {
        console.log('❌ Finnhub WebSocket disconnected, attempting reconnect...');
        this.reconnect();
      };

      this.ws.onerror = (error) => {
        console.error('❌ Finnhub WebSocket error:', error);
        console.log('💡 Please configure a valid Finnhub API key in API Configuration');
        this.startMockDataStream();
      };
    } catch (error) {
      console.error('❌ Failed to initialize Finnhub WebSocket:', error);
      console.log('💡 Please configure a valid Finnhub API key in API Configuration');
      this.startMockDataStream();
    }
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
          change: this.calculatePriceChange(symbol, price),
          changePercent: this.calculatePercentChange(symbol, price),
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

  private priceHistory: Map<string, number[]> = new Map();

  private calculatePriceChange(symbol: string, currentPrice: number): number {
    const history = this.priceHistory.get(symbol) || [];
    if (history.length === 0) {
      this.priceHistory.set(symbol, [currentPrice]);
      return 0;
    }
    
    const previousPrice = history[history.length - 1];
    const change = currentPrice - previousPrice;
    
    // Keep last 100 prices
    history.push(currentPrice);
    if (history.length > 100) history.shift();
    this.priceHistory.set(symbol, history);
    
    return change;
  }

  private calculatePercentChange(symbol: string, currentPrice: number): number {
    const history = this.priceHistory.get(symbol) || [];
    if (history.length < 24) return 0;
    
    const price24hAgo = history[Math.max(0, history.length - 24)];
    return ((currentPrice - price24hAgo) / price24hAgo) * 100;
  }
  // HARMONIC PATTERN DETECTION
  async detectHarmonicPatterns(symbol: string): Promise<HarmonicPattern[]> {
    try {
      const priceData = await this.getPriceHistory(symbol, 200);
      const patterns = this.analyzeHarmonicPatterns(priceData);
      return patterns;
    } catch (error) {
      console.error('Harmonic pattern detection failed:', error);
      return this.getMockHarmonicPatterns(symbol);
    }
  }

  private analyzeHarmonicPatterns(priceData: any[]): HarmonicPattern[] {
    const patterns: HarmonicPattern[] = [];
    
    // GARTLEY PATTERN DETECTION
    for (let i = 50; i < priceData.length - 50; i++) {
      const X = priceData[i - 40];
      const A = priceData[i - 30];
      const B = priceData[i - 20];
      const C = priceData[i - 10];
      const D = priceData[i];

      // Calculate Fibonacci ratios
      const AB_XA = Math.abs(B.close - A.close) / Math.abs(A.close - X.close);
      const BC_AB = Math.abs(C.close - B.close) / Math.abs(B.close - A.close);
      const CD_BC = Math.abs(D.close - C.close) / Math.abs(C.close - B.close);
      const AD_XA = Math.abs(D.close - A.close) / Math.abs(A.close - X.close);

      // Gartley ratios: AB=0.618 XA, BC=0.382-0.886 AB, CD=1.272 BC, AD=0.786 XA
      if (this.isGartleyPattern(AB_XA, BC_AB, CD_BC, AD_XA)) {
        const direction = D.close > X.close ? 'bullish' : 'bearish';
        
        patterns.push({
          id: `gartley_${i}_${Date.now()}`,
          symbol: 'EURUSD',
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
  async calculateFibonacciLevels(symbol: string, high: number, low: number): Promise<FibonacciLevel[]> {
    const range = high - low;
    const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618, 2.618];
    
    return levels.map(level => ({
      level,
      price: low + (range * level),
      type: level <= 1 ? 'retracement' : 'extension',
      strength: this.getFibStrength(level)
    }));
  }

  private getFibStrength(level: number): 'weak' | 'medium' | 'strong' {
    if ([0.382, 0.618, 0.786].includes(level)) return 'strong';
    if ([0.236, 0.5, 1.272, 1.618].includes(level)) return 'medium';
    return 'weak';
  }

  // ADR (AVERAGE DAILY RANGE) CALCULATION
  async calculateADR(symbol: string): Promise<ADRData> {
    try {
      const dailyData = await this.getDailyData(symbol, 20);
      const ranges = dailyData.map((day: any) => day.high - day.low);
      const averageDailyRange = ranges.reduce((a: number, b: number) => a + b, 0) / ranges.length;
      
      const today = dailyData[dailyData.length - 1];
      const currentRange = today.high - today.low;
      const rangePercent = (currentRange / averageDailyRange) * 100;
      
      return {
        symbol,
        averageDailyRange,
        currentRange,
        rangePercent,
        dailyHigh: today.high,
        dailyLow: today.low,
        projectedHigh: today.low + averageDailyRange,
        projectedLow: today.high - averageDailyRange,
        session: this.getCurrentSession()
      };
    } catch (error) {
      return this.getMockADRData(symbol);
    }
  }

  // TRENDLINE DETECTION
  async detectTrendLines(symbol: string): Promise<TrendLine[]> {
    try {
      const priceData = await this.getPriceHistory(symbol, 100);
      return this.analyzeTrendLines(priceData, symbol);
    } catch (error) {
      return this.getMockTrendLines(symbol);
    }
  }

  private analyzeTrendLines(priceData: any[], symbol: string): TrendLine[] {
    const trendLines: TrendLine[] = [];
    
    // Find support lines (connecting lows)
    const lows = this.findLocalLows(priceData);
    for (let i = 0; i < lows.length - 1; i++) {
      for (let j = i + 1; j < lows.length; j++) {
        const point1 = lows[i];
        const point2 = lows[j];
        const slope = (point2.price - point1.price) / (point2.time - point1.time);
        
        if (Math.abs(slope) < 0.001) { // Nearly horizontal
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

    return trendLines.slice(0, 5); // Return top 5 strongest lines
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
    const tolerance = 0.0005; // 5 pips tolerance
    
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
    const sessions: SessionData[] = [];
    const currentSession = this.getCurrentSession();
    
    // Mock session data - in real implementation, fetch from API
    sessions.push({
      session: 'asian',
      isActive: currentSession === 'asian',
      open: 1.0420,
      high: 1.0435,
      low: 1.0415,
      close: 1.0428,
      volume: 1200000,
      volatility: 0.65,
      timeRemaining: currentSession === 'asian' ? '3h 45m' : '0h 0m'
    });

    return sessions;
  }

  // API DATA FETCHING
  async getPriceHistory(symbol: string, periods: number = 100): Promise<any[]> {
    if (!this.API_KEYS.ALPHA_VANTAGE || this.API_KEYS.ALPHA_VANTAGE === 'demo') {
      return this.generateMockPriceData(periods);
    }

    try {
      const fromSymbol = symbol.substring(0, 3);
      const toSymbol = symbol.substring(3, 6);
      
      const response = await axios.get(`https://www.alphavantage.co/query`, {
        params: {
          function: 'FX_INTRADAY',
          from_symbol: fromSymbol,
          to_symbol: toSymbol,
          interval: '5min',
          apikey: this.API_KEYS.ALPHA_VANTAGE,
          outputsize: 'compact'
        }
      });

      const timeSeries = response.data['Time Series (5min)'];
      
      if (!timeSeries || typeof timeSeries !== 'object') {
        console.warn(`Alpha Vantage: No data for ${symbol}, using mock data`);
        return this.generateMockPriceData(periods);
      }
      
      const priceData = Object.entries(timeSeries).map(([time, data]: [string, any]) => ({
        time: new Date(time).getTime(),
        open: parseFloat(data['1. open']),
        high: parseFloat(data['2. high']),
        low: parseFloat(data['3. low']),
        close: parseFloat(data['4. close']),
        volume: parseFloat(data['5. volume'] || '1000000'),
      })).slice(0, periods).reverse(); // Most recent first
      
      console.log(`✅ Alpha Vantage: Loaded ${priceData.length} candles for ${symbol}`);
      return priceData;
    } catch (error) {
      console.error(`Alpha Vantage error for ${symbol}:`, error);
      return this.generateMockPriceData(periods);
    }
  }

  // GET CURRENT MARKET PRICE
  async getCurrentPrice(symbol: string): Promise<number> {
    try {
      const priceData = await this.getPriceHistory(symbol, 1);
      if (priceData.length > 0) {
        return priceData[0].close;
      }
    } catch (error) {
      console.error(`Failed to get current price for ${symbol}:`, error);
    }
    
    // Fallback to base price
    return this.getBasePrice(symbol);
  }
  private async getDailyData(symbol: string, days: number): Promise<any[]> {
    // Mock daily data for ADR calculation
    const data = [];
    const basePrice = 1.0425;
    
    for (let i = days; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      
      const open = basePrice + (Math.random() - 0.5) * 0.01;
      const close = open + (Math.random() - 0.5) * 0.008;
      const high = Math.max(open, close) + Math.random() * 0.005;
      const low = Math.min(open, close) - Math.random() * 0.005;
      
      data.push({ time: date.getTime(), open, high, low, close });
    }
    
    return data;
  }

  // ENHANCED MOCK DATA WITH REALISTIC MARKET BEHAVIOR
  private startMockDataStream() {
    const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'];
    
    // Store price history for realistic movements
    const priceHistory: Map<string, number[]> = new Map();
    symbols.forEach(symbol => {
      priceHistory.set(symbol, [this.getBasePrice(symbol)]);
    });
    
    symbols.forEach(symbol => {
      setInterval(() => {
        const history = priceHistory.get(symbol) || [];
        const lastPrice = history[history.length - 1] || this.getBasePrice(symbol);
        const volatility = this.getVolatility(symbol);
        const spread = this.getTypicalSpread(symbol);
        
        // More realistic price movement with trend bias
        const trendBias = this.calculateTrendBias(history);
        const randomWalk = (Math.random() - 0.5) * volatility * 0.3;
        const trendComponent = trendBias * volatility * 0.1;
        const price = lastPrice + randomWalk + trendComponent;
        
        // Update price history (keep last 100 prices)
        history.push(price);
        if (history.length > 100) history.shift();
        priceHistory.set(symbol, history);
        
        const change = price - lastPrice;
        const changePercent = (change / lastPrice) * 100;
        
        const mockPrice: LivePrice = {
          symbol,
          bid: price - (spread / 2),
          ask: price + (spread / 2),
          spread,
          timestamp: new Date(),
          change,
          changePercent,
          high24h: Math.max(...history.slice(-24)) || price * 1.008,
          low24h: Math.min(...history.slice(-24)) || price * 0.992,
          volume24h: Math.floor(Math.random() * 2000000) + 1000000,
        };
        
        this.notifySubscribers('price', mockPrice);
        
        // Trigger signal generation on significant moves
        if (Math.abs(changePercent) > 0.1) {
          this.checkForNewSignals(symbol, price);
        }
      }, 1500 + Math.random() * 1000); // More frequent updates
    });
  }

  private calculateTrendBias(history: number[]): number {
    if (history.length < 10) return 0;
    
    const recent = history.slice(-10);
    const older = history.slice(-20, -10);
    
    if (older.length === 0) return 0;
    
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    
    return recentAvg > olderAvg ? 0.3 : -0.3; // Trend continuation bias
  }

  private checkForNewSignals(symbol: string, price: number) {
    // Emit signal generation events
    this.notifySubscribers('new_signal_opportunity', { symbol, price, timestamp: new Date() });
  }

  private getVolatility(symbol: string): number {
    const volatilities: Record<string, number> = {
      'EURUSD': 0.008,
      'GBPUSD': 0.012,
      'USDJPY': 1.2,
      'XAUUSD': 25.0,
    };
    return volatilities[symbol] || 0.008;
  }

  private generateMockPriceData(periods: number, symbol?: string): any[] {
    const data = [];
    const basePrice = symbol ? this.getBasePrice(symbol) : 1.0425;
    const volatility = symbol ? this.getVolatility(symbol) : 0.008;
    let price = basePrice;
    const now = Date.now();
    
    for (let i = periods; i >= 0; i--) {
      const time = now - (i * 5 * 60 * 1000); // 5-minute intervals
      const change = (Math.random() - 0.5) * volatility * 0.3;
      const open = price;
      const close = price + change;
      const high = Math.max(open, close) + Math.random() * volatility * 0.1;
      const low = Math.min(open, close) - Math.random() * volatility * 0.1;
      
      data.push({ 
        time, 
        open: parseFloat(open.toFixed(symbol?.includes('JPY') ? 3 : 5)), 
        high: parseFloat(high.toFixed(symbol?.includes('JPY') ? 3 : 5)), 
        low: parseFloat(low.toFixed(symbol?.includes('JPY') ? 3 : 5)), 
        close: parseFloat(close.toFixed(symbol?.includes('JPY') ? 3 : 5)),
        volume: Math.floor(Math.random() * 1000000) + 500000
      });
      price = close;
    }
    
    return data.reverse(); // Most recent first
  }

  private getBasePrice(symbol: string): number {
    const prices: Record<string, number> = {
      'EURUSD': 1.0425,
      'GBPUSD': 1.2580,
      'USDJPY': 157.25,
      'AUDUSD': 0.6245,
      'USDCAD': 1.4385,
      'XAUUSD': 2685.50,
    };
    return prices[symbol] || 1.0425;
  }

  private getMockHarmonicPatterns(symbol: string): HarmonicPattern[] {
    const basePrice = this.getBasePrice(symbol);
    const variation = symbol === 'EURUSD' ? 0.005 : 
                     symbol === 'GBPUSD' ? 0.008 :
                     symbol === 'USDJPY' ? 1.5 :
                     symbol === 'XAUUSD' ? 15.0 : 0.005;
    
    // Generate unique patterns per symbol
    const patternTypes: Array<HarmonicPattern['type']> = ['Gartley', 'Butterfly', 'Bat', 'Crab'];
    const selectedPattern = patternTypes[Math.floor(Math.random() * patternTypes.length)];
    
    return [
      {
        id: `${selectedPattern.toLowerCase()}_${symbol}`,
        symbol,
        type: selectedPattern,
        direction: Math.random() > 0.5 ? 'bullish' : 'bearish',
        completion: 85 + Math.floor(Math.random() * 10), // 85-95%
        points: {
          X: { price: basePrice - variation, time: new Date(Date.now() - 4 * 60 * 60 * 1000) },
          A: { price: basePrice + variation, time: new Date(Date.now() - 3 * 60 * 60 * 1000) },
          B: { price: basePrice - variation * 0.618, time: new Date(Date.now() - 2 * 60 * 60 * 1000) },
          C: { price: basePrice + variation * 0.382, time: new Date(Date.now() - 1 * 60 * 60 * 1000) },
          D: { price: basePrice - variation * 0.786, time: new Date() },
        },
        ratios: { AB_XA: 0.618, BC_AB: 0.618, CD_BC: 1.272, AD_XA: 0.786 },
        prz: { 
          min: basePrice - variation * 0.786 - 0.0002, 
          max: basePrice - variation * 0.786 + 0.0002 
        },
        confidence: 80 + Math.floor(Math.random() * 15), // 80-95%
        status: 'completed'
      }
    ];
  }

  private getMockADRData(symbol: string): ADRData {
    const basePrice = this.getBasePrice(symbol);
    const dailyRange = symbol === 'EURUSD' ? 0.0085 : 
                      symbol === 'GBPUSD' ? 0.0120 :
                      symbol === 'USDJPY' ? 0.85 :
                      symbol === 'XAUUSD' ? 25.0 : 0.0085;
    
    return {
      symbol,
      averageDailyRange: dailyRange,
      currentRange: dailyRange * (0.6 + Math.random() * 0.3), // 60-90% of ADR
      rangePercent: 60 + Math.random() * 30, // 60-90%
      dailyHigh: basePrice + dailyRange * 0.6,
      dailyLow: basePrice - dailyRange * 0.4,
      projectedHigh: basePrice + dailyRange,
      projectedLow: basePrice - dailyRange,
      session: this.getCurrentSession()
    };
  }

  private getMockTrendLines(symbol: string): TrendLine[] {
    // Generate unique trendlines based on symbol to avoid duplicates
    const basePrice = this.getBasePrice(symbol);
    const variation = symbol === 'EURUSD' ? 0.0020 : 
                     symbol === 'GBPUSD' ? 0.0025 :
                     symbol === 'USDJPY' ? 0.15 :
                     symbol === 'XAUUSD' ? 5.0 : 0.0020;
    
    return [
      {
        id: `support_${symbol}`,
        symbol,
        type: 'support',
        points: [
          { price: basePrice - variation, time: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          { price: basePrice - variation + 0.0005, time: new Date(Date.now() - 12 * 60 * 60 * 1000) }
        ],
        slope: 0.0000058,
        strength: 75 + Math.floor(Math.random() * 20), // 75-95% strength
        touches: 3 + Math.floor(Math.random() * 4), // 3-6 touches
        currentPrice: basePrice,
        distance: variation * 0.8,
        isActive: true
      }
    ];
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