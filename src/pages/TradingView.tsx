import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, LineStyle, UTCTimestamp, CandlestickSeries, LineSeries } from 'lightweight-charts';
import {
  Settings, 
  Maximize2, 
  Search, 
  Wifi, 
  WifiOff, 
  Play, 
  Pause,
  BarChart3,
  Activity,
  Target,
  Zap,
  RefreshCw,
  LineChart,
  CandlestickChart,
  BarChart2,
  Link,
  Link2Off
} from 'lucide-react';
import { liveDataService, HarmonicPattern, TrendLine, FibonacciLevel } from '../services/liveDataService';
import { tradeLockerService, TradeLockerConfig } from '../services/tradeLockerService';
import { tradeLockerApi } from '../services/apiService';
import ConfluenceXLogo from '../components/ConfluenceXLogo';
import { bwtsApi, type CryptoAnalysis } from '../services/bwtsApi';

interface CandlestickData {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface LineDataPoint {
  time: UTCTimestamp;
  value: number;
}

interface VolumeData {
  time: UTCTimestamp;
  value: number;
  color: string;
}

interface TradeLockerHistoryCandle {
  t?: number | string;
  time?: number | string;
  timestamp?: number | string;
  o?: number | string;
  h?: number | string;
  l?: number | string;
  c?: number | string;
  open?: number | string;
  high?: number | string;
  low?: number | string;
  close?: number | string;
  [key: string]: unknown;
}

type ChartType = 'candlestick' | 'line' | 'area';

interface SymbolInfo {
  symbol: string;
  name: string;
  exchange: string;
  type: 'forex' | 'stock' | 'crypto' | 'commodity';
  price?: number;
}

interface ChartAdr {
  pair: string;
  period: number;
  day_time: number;
  adr: number;
  day_open: number;
  day_high: number;
  day_low: number;
  current_range: number;
  percent_used: number;
  adr_high: number;
  adr_low: number;
  near_adr_high: boolean;
  near_adr_low: boolean;
  exhausted: boolean;
}

const BWTS_SYMBOLS: SymbolInfo[] = [
  { symbol: 'BTCUSD', name: 'Bitcoin / US Dollar', exchange: 'Binance Market Data', type: 'crypto' },
  { symbol: 'ETHUSD', name: 'Ethereum / US Dollar', exchange: 'Binance Market Data', type: 'crypto' },
];

const TradingView: React.FC = () => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const volumeContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const volumeChartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | ISeriesApi<'Area'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const chartInitialized = useRef<boolean>(false);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const harmonicSeriesRefs = useRef<ISeriesApi<'Line'>[]>([]);
  const adrSeriesRefs = useRef<ISeriesApi<'Line'>[]>([]);
  const v2LevelSeriesRefs = useRef<ISeriesApi<'Line'>[]>([]);
  const candleCacheRef = useRef<Record<string, CandlestickData[]>>({});
  const loadedChartKeyRef = useRef('');
  const candleRequestRef = useRef(0);
  const marketWsRef = useRef<WebSocket | null>(null);
  const lastUiPriceUpdateRef = useRef(0);
  const [chartType, setChartType] = useState<ChartType>('candlestick');
  const [showVolume, setShowVolume] = useState(true);
  const [chartRevision, setChartRevision] = useState(0);
  
  // State management
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSD');
  const [timeframe, setTimeframe] = useState('1h');
  const [currentPrice, setCurrentPrice] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLive, setIsLive] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [symbolSuggestions, setSymbolSuggestions] = useState<SymbolInfo[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [availableSymbols, setAvailableSymbols] = useState<SymbolInfo[]>(BWTS_SYMBOLS);
  const [selectedBroker, setSelectedBroker] = useState('polygon');
  
  // Technical analysis data
  const [harmonicPatterns, setHarmonicPatterns] = useState<HarmonicPattern[]>([]);
  const [adrData, setAdrData] = useState<ChartAdr | null>(null);
  const [trendLines, setTrendLines] = useState<TrendLine[]>([]);
  const [fibonacciLevels, setFibonacciLevels] = useState<FibonacciLevel[]>([]);
  const [showHarmonics, setShowHarmonics] = useState(true);
  const [showTrendLines, setShowTrendLines] = useState(true);
  const [showFibonacci, setShowFibonacci] = useState(true);
  const [showSupportResistance, setShowSupportResistance] = useState(true);
  const [cryptoAnalysis, setCryptoAnalysis] = useState<CryptoAnalysis | null>(null);

  useEffect(() => {
    const assetType = availableSymbols.find((symbol) => symbol.symbol === selectedSymbol)?.type;
    if (assetType !== 'crypto') {
      setCryptoAnalysis(null);
      return;
    }
    bwtsApi.cryptoAnalysis(selectedSymbol)
      .then(setCryptoAnalysis)
      .catch(() => setCryptoAnalysis(null));
  }, [selectedSymbol, availableSymbols]);

  const mapTradeLockerType = (instrument: any): SymbolInfo['type'] => {
    const rawType = String(
      instrument?.type ??
      instrument?.instrumentType ??
      instrument?.assetType ??
      instrument?.category ??
      ''
    ).toLowerCase();

    if (rawType.includes('crypto')) return 'crypto';
    if (rawType.includes('stock') || rawType.includes('equity')) return 'stock';
    if (rawType.includes('commodity') || rawType.includes('metal')) return 'commodity';
    return 'forex';
  };

  const parseTradeLockerInstruments = (payload: any): SymbolInfo[] => {
    const rawItems = Array.isArray(payload)
      ? payload
      : (payload?.d || payload?.instruments || payload?.data || []);

    if (!Array.isArray(rawItems)) return [];

    return rawItems
      .map((instrument: any): SymbolInfo | null => {
        const symbol = String(
          instrument?.symbol ??
          instrument?.name ??
          instrument?.code ??
          ''
        ).trim();
        if (!symbol) return null;

        return {
          symbol,
          name: String(instrument?.description ?? instrument?.displayName ?? symbol),
          exchange: String(instrument?.exchange ?? 'TradeLocker'),
          type: mapTradeLockerType(instrument),
          price: Number(instrument?.lastPrice ?? instrument?.price ?? 0) || undefined,
        };
      })
      .filter((item): item is SymbolInfo => item !== null);
  };

  const timeframes = [
    { value: '1m', label: '1m' },
    { value: '5m', label: '5m' },
    { value: '15m', label: '15m' },
    { value: '30m', label: '30m' },
    { value: '1h', label: '1h' },
    { value: '4h', label: '4h' },
    { value: '1d', label: '1D' },
    { value: '1w', label: '1W' },
  ];

  // TradeLocker connection state
  const [tradeLockerConnected, setTradeLockerConnected] = useState(false);
  const [tradeLockerCredentials, setTradeLockerCredentials] = useState({
    email: '',
    password: '',
    server: 'demo',
    isDemo: true
  });
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const normalizeHistoryCandle = (candle: TradeLockerHistoryCandle | (number | string)[]): CandlestickData | null => {
    const isTuple = Array.isArray(candle);
    const tuple = isTuple ? candle : null;

    const timeRaw = tuple?.[0] ?? (candle as TradeLockerHistoryCandle).t ?? (candle as TradeLockerHistoryCandle).time ?? (candle as TradeLockerHistoryCandle).timestamp;
    const openRaw = tuple?.[1] ?? (candle as TradeLockerHistoryCandle).o ?? (candle as TradeLockerHistoryCandle).open;
    const highRaw = tuple?.[2] ?? (candle as TradeLockerHistoryCandle).h ?? (candle as TradeLockerHistoryCandle).high;
    const lowRaw = tuple?.[3] ?? (candle as TradeLockerHistoryCandle).l ?? (candle as TradeLockerHistoryCandle).low;
    const closeRaw = tuple?.[4] ?? (candle as TradeLockerHistoryCandle).c ?? (candle as TradeLockerHistoryCandle).close;

    if (timeRaw == null || openRaw == null || highRaw == null || lowRaw == null || closeRaw == null) {
      return null;
    }

    const rawTime = Number(timeRaw);
    const normalizedTime = rawTime > 1_000_000_000_000 ? Math.floor(rawTime / 1000) : Math.floor(rawTime);

    const open = Number(openRaw);
    const high = Number(highRaw);
    const low = Number(lowRaw);
    const close = Number(closeRaw);
    if (![normalizedTime, open, high, low, close].every(Number.isFinite)) {
      return null;
    }

    return {
      time: normalizedTime as UTCTimestamp,
      open,
      high,
      low,
      close,
    };
  };

  const fetchBwtsCandles = useCallback(async (
    symbol: string, tf: string, limit?: number
  ): Promise<CandlestickData[]> => {
    const params = new URLSearchParams({
      pair: symbol,
      timeframe: tf,
      ...(limit ? { limit: String(limit) } : {}),
    });
    const API_BASE = import.meta.env.VITE_BWTS_API_URL || import.meta.env.VITE_API_URL || '';
    const response = await fetch(`${API_BASE}/api/candles?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch BWTS candles: ${response.status}`);
    }
    const payload = await response.json();
    const rawCandles: Array<TradeLockerHistoryCandle | (number | string)[]> = payload?.candles || [];
    return rawCandles
      .map(normalizeHistoryCandle)
      .filter((candle): candle is CandlestickData => candle !== null)
      .sort((a, b) => a.time - b.time);
  }, []);

  const fetchBwtsHarmonics = useCallback(async (symbol: string, tf: string): Promise<HarmonicPattern[]> => {
    const params = new URLSearchParams({ pair: symbol, timeframe: tf });
    const API_BASE = import.meta.env.VITE_BWTS_API_URL || import.meta.env.VITE_API_URL || '';
    const response = await fetch(`${API_BASE}/api/harmonics?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch BWTS harmonics: ${response.status}`);
    }
    const payload = await response.json();
    const pattern = payload?.pattern;
    if (!pattern) return [];
    const point = (label: 'X' | 'A' | 'B' | 'C' | 'D') => ({
      price: Number(pattern.points[label].price),
      time: new Date(Number(pattern.points[label].time) * 1000),
    });
    return [{
      id: `${symbol}-${tf}-${pattern.name}-${pattern.points.D.time}`,
      symbol,
      type: pattern.name as HarmonicPattern['type'],
      direction: pattern.direction,
      completion: 100,
      points: { X: point('X'), A: point('A'), B: point('B'), C: point('C'), D: point('D') },
      ratios: {
        AB_XA: Number(pattern.ratios.ab_xa),
        BC_AB: Number(pattern.ratios.bc_ab),
        CD_BC: Number(pattern.ratios.cd_bc),
        AD_XA: Number(pattern.ratios.ad_xa),
      },
      prz: { min: Number(pattern.prz.low), max: Number(pattern.prz.high) },
      confidence: 100,
      status: 'completed',
    }];
  }, []);

  const fetchBwtsAdr = useCallback(async (symbol: string): Promise<ChartAdr> => {
    const params = new URLSearchParams({ pair: symbol });
    const API_BASE = import.meta.env.VITE_BWTS_API_URL || import.meta.env.VITE_API_URL || '';
    const response = await fetch(`${API_BASE}/api/adr?${params.toString()}`);
    if (!response.ok) throw new Error(`Failed to fetch ADR: ${response.status}`);
    return response.json();
  }, []);
  // TradeLocker connection function
  const connectToTradeLocker = async () => {
    if (!tradeLockerCredentials.email || !tradeLockerCredentials.password) {
      alert('Please enter your TradeLocker credentials');
      return;
    }

    try {
      console.log('🔌 Connecting to TradeLocker...');
      
      // Authenticate with TradeLocker
      const authResponse = await tradeLockerService.authenticate({
        email: tradeLockerCredentials.email,
        password: tradeLockerCredentials.password,
        server: tradeLockerCredentials.server,
        isDemo: tradeLockerCredentials.isDemo,
      });

      console.log('✅ TradeLocker authenticated:', authResponse.accessToken ? 'Token received' : 'No token');
      setTradeLockerConnected(true);
      setIsConnected(true);
      setShowLoginModal(false);
      await loadTradeLockerInstruments();

      // Initialize WebSocket for real-time data
      initializeTradeLockerWebSocket();
      
    } catch (error) {
      console.error('❌ TradeLocker connection failed:', error);
      alert('Failed to connect to TradeLocker. Please check your credentials.');
      setTradeLockerConnected(false);
      setIsConnected(false);
    }
  };

  // Initialize WebSocket connection to TradeLocker
  const initializeTradeLockerWebSocket = () => {
    const wsUrl = tradeLockerCredentials.isDemo 
      ? 'wss://demo.tradelocker.com/streaming-api' 
      : 'wss://live.tradelocker.com/streaming-api';

    try {
      console.log(`🔗 Connecting to WebSocket: ${wsUrl}`);
      
      // Note: TradeLocker may use different WebSocket URL format
      // This is a placeholder - you'll need to check TradeLocker's actual WebSocket API
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('✅ WebSocket connected');
        setIsConnected(true);
        
        // Subscribe to symbol data
        ws.send(JSON.stringify({
          type: 'subscribe',
          symbol: selectedSymbol,
          timeframe: timeframe
        }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'quote' || data.type === 'candlestick') {
            // Update chart with real data
            const newCandle = {
              time: Math.floor(new Date(data.timestamp).getTime() / 1000) as any,
              open: data.open,
              high: data.high,
              low: data.low,
              close: data.close,
            };
            
            if (candlestickSeriesRef.current) {
              candlestickSeriesRef.current.update(newCandle);
            }
            
            setCurrentPrice(data.close);
          }
        } catch (error) {
          console.warn('WebSocket data parse error:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      ws.onclose = () => {
        console.log('🔌 WebSocket disconnected');
        setIsConnected(false);
        // Attempt reconnection after 5 seconds
        setTimeout(() => {
          if (tradeLockerConnected) {
            initializeTradeLockerWebSocket();
          }
        }, 5000);
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('Failed to initialize WebSocket:', error);
    }
  };

  // Disconnect from TradeLocker
  const disconnectFromTradeLocker = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    tradeLockerService.disconnect();
    setTradeLockerConnected(false);
    setIsConnected(false);
  };

  // Subscribe to symbol changes
  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'unsubscribe',
        symbol: selectedSymbol,
      }));
      wsRef.current.send(JSON.stringify({
        type: 'subscribe',
        symbol: selectedSymbol,
        timeframe: timeframe
      }));
    }
  }, [selectedSymbol, timeframe]);

  // Symbol search functionality
  const updateSymbolSuggestions = useCallback((term: string) => {
    const normalizedTerm = term.trim().toLowerCase();
    const filtered = availableSymbols
      .filter((symbol) =>
        normalizedTerm.length === 0 ||
        symbol.symbol.toLowerCase().includes(normalizedTerm) ||
        symbol.name.toLowerCase().includes(normalizedTerm)
      )
      .slice(0, 20);

    setSymbolSuggestions(filtered);
    setShowSuggestions(filtered.length > 0);
  }, [availableSymbols]);

  const handleSymbolSearch = (term: string) => {
    setSearchTerm(term);
    updateSymbolSuggestions(term);
  };

  const selectSymbol = (symbol: SymbolInfo) => {
    setSelectedSymbol(symbol.symbol);
    setSearchTerm(symbol.symbol);
    setShowSuggestions(false);
    loadSymbolData(symbol.symbol);
  };

  // Load symbol data and technical analysis
  const loadSymbolData = async (symbol: string) => {
    try {
      console.log(`🔄 Loading data for ${symbol}...`);
      
      // Harmonics are loaded independently from the BWTS Python scanner so
      // they refresh whenever the symbol or timeframe changes.

      // Load trendlines
      if (showTrendLines) {
        const trendlines = await liveDataService.detectTrendLines(symbol);
        setTrendLines(trendlines);
        console.log(`📈 Loaded ${trendlines.length} trendlines`);
      }

      // Load fibonacci levels
      if (showFibonacci) {
        const priceHistory = await liveDataService.getPriceHistory(symbol, 50);
        if (priceHistory.length > 10) {
          const recentHigh = Math.max(...priceHistory.slice(-20).map(p => p.high));
          const recentLow = Math.min(...priceHistory.slice(-20).map(p => p.low));
          const fibLevels = await liveDataService.calculateFibonacciLevels(symbol, recentHigh, recentLow);
          setFibonacciLevels(fibLevels);
          console.log(`🔢 Loaded ${fibLevels.length} fibonacci levels`);
        }
      }

      setIsConnected(true);
    } catch (error) {
      console.error('Failed to load symbol data:', error);
      setIsConnected(false);
    }
  };

  const loadCandlesForSymbol = useCallback(async (
    symbol: string, tf: string, incremental = false
  ) => {
    const series = candlestickSeriesRef.current;
    if (!series) return;
    const key = `${symbol}:${tf}`;
    const requestId = ++candleRequestRef.current;
    try {
      const useTinyUpdate = incremental && loadedChartKeyRef.current === key;
      const candles = await fetchBwtsCandles(symbol, tf, useTinyUpdate ? 2 : undefined);
      if (requestId !== candleRequestRef.current || candles.length === 0) return;
      const previous = candleCacheRef.current[key] || [];
      const last = candles[candles.length - 1];
      if (loadedChartKeyRef.current !== key || previous.length === 0) {
        // Full history is loaded only for a new symbol/timeframe.
        series.setData(candles);
        loadedChartKeyRef.current = key;
        setChartRevision((revision) => revision + 1);
      } else {
        // Polls only update the newest candle, preserving zoom and overlays.
        const oldLast = previous[previous.length - 1];
        if (!oldLast || oldLast.time !== last.time || oldLast.close !== last.close ||
            oldLast.high !== last.high || oldLast.low !== last.low) {
          series.update(last);
        }
      }
      candleCacheRef.current[key] = candles;
      setCurrentPrice(last.close);
      setIsConnected(true);
    } catch (error) {
      if (requestId !== candleRequestRef.current) return;
      console.error('Failed to load BWTS candles:', error);
      setIsConnected(false);
      // Keep already-rendered candles visible during a transient API failure.
      if (loadedChartKeyRef.current !== key) series.setData([]);
    }
  }, [fetchBwtsCandles]);

  const loadTradeLockerInstruments = useCallback(async () => {
    try {
      const sessionId = localStorage.getItem('tl_session_id');
      const params = new URLSearchParams(sessionId ? { sessionId } : {});
      const API_BASE = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_BASE}/api/tradelocker/instruments?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch instruments: ${response.status}`);
      }

      const payload = await response.json();
      const instruments = parseTradeLockerInstruments(payload);
      setAvailableSymbols(instruments);

      if (!searchTerm && selectedSymbol) {
        setSearchTerm(selectedSymbol);
      }

      updateSymbolSuggestions(searchTerm || selectedSymbol);

      const selectedExists = instruments.some((item) => item.symbol === selectedSymbol);
      if (!selectedExists && instruments.length > 0) {
        const defaultSymbol = instruments[0].symbol;
        setSelectedSymbol(defaultSymbol);
        setSearchTerm(defaultSymbol);
        loadCandlesForSymbol(defaultSymbol, timeframe);
        loadSymbolData(defaultSymbol);
      }
    } catch (error) {
      console.error('Failed to load TradeLocker instruments:', error);
      setAvailableSymbols([]);
    }
  }, [loadCandlesForSymbol, selectedSymbol, timeframe]);



  const checkExistingTradeLockerConnection = useCallback(async () => {
    try {
      const status = await tradeLockerApi.connect();
      if (!status.connected) {
        setTradeLockerConnected(false);
        return;
      }

      setTradeLockerConnected(true);
      setIsConnected(true);
      setSelectedBroker('tradelocker');
      await loadTradeLockerInstruments();
    } catch (error) {
      console.error('Failed to restore TradeLocker session:', error);
      setTradeLockerConnected(false);
    }
  }, [loadTradeLockerInstruments]);

  const getSymbolVolatility = (symbol: string): number => {
    // No mock volatility - return 0, real data should come from broker
    return 0;
  };

  const getDecimalPlaces = (symbol: string): number => {
    if (symbol.includes('JPY')) return 3;
    if (symbol.includes('BTC') || symbol.includes('ETH')) return 2;
    if (['AAPL', 'GOOGL', 'MSFT', 'TSLA'].includes(symbol)) return 2;
    if (symbol.includes('XAU')) return 2;
    return 5;
  };

  const getTimeframeMs = (timeframe: string): number => {
    const timeframes: Record<string, number> = {
      '1m': 60 * 1000, '5m': 5 * 60 * 1000, '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000, '1h': 60 * 60 * 1000, '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000, '1w': 7 * 24 * 60 * 60 * 1000,
    };
    return timeframes[timeframe] || 60 * 60 * 1000;
  };

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current || chartInitialized.current) return;

    try {
      const chart = createChart(chartContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: '#070a12' },
          textColor: '#9aa7c3',
        },
        grid: {
          vertLines: { color: '#17203a' },
          horzLines: { color: '#17203a' },
        },
        crosshair: { mode: 1 },
        rightPriceScale: {
          borderColor: '#273452',
        },
        timeScale: {
          borderColor: '#273452',
        },
        width: chartContainerRef.current.clientWidth,
        height: chartContainerRef.current.clientHeight,
      });

      const candlestickSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#10b981',
        downColor: '#ef4444',
        borderDownColor: '#ef4444',
        borderUpColor: '#10b981',
        wickDownColor: '#ef4444',
        wickUpColor: '#10b981',
      });

      chartRef.current = chart;
      candlestickSeriesRef.current = candlestickSeries;
      chartInitialized.current = true;

      // Load non-candle technical analysis once; the dedicated candle effect
      // below performs the single initial market-data request.
      loadSymbolData(selectedSymbol);

      // Observe the actual container, not just window resize. This catches
      // sidebar collapse and async harmonic/ADR status bars without leaving
      // a stale canvas that creates page overflow.
      const resizeObserver = new ResizeObserver(([entry]) => {
        if (!entry || !chartRef.current) return;
        const width = Math.max(1, Math.floor(entry.contentRect.width));
        const height = Math.max(1, Math.floor(entry.contentRect.height));
        chartRef.current.applyOptions({ width, height });
      });
      resizeObserver.observe(chartContainerRef.current);

      return () => {
        resizeObserver.disconnect();
        if (chartRef.current) {
          chartRef.current.remove();
          chartRef.current = null;
          candlestickSeriesRef.current = null;
        }
        chartInitialized.current = false;
      };
    } catch (error) {
      console.error('Chart initialization failed:', error);
    }
  }, []);

  // ADR changes slowly, so refresh once per minute rather than on every
  // candle poll.
  useEffect(() => {
    let active = true;
    const refreshAdr = () => fetchBwtsAdr(selectedSymbol)
      .then((data) => { if (active) setAdrData(data); })
      .catch((error) => {
        console.error('Failed to load ADR:', error);
        if (active) setAdrData(null);
      });
    refreshAdr();
    const interval = window.setInterval(refreshAdr, 60000);
    return () => { active = false; window.clearInterval(interval); };
  }, [fetchBwtsAdr, selectedSymbol]);

  // Refresh harmonics from the same live candles displayed on the chart.
  useEffect(() => {
    let active = true;
    if (!showHarmonics) {
      setHarmonicPatterns([]);
      return () => { active = false; };
    }
    fetchBwtsHarmonics(selectedSymbol, timeframe)
      .then((patterns) => { if (active) setHarmonicPatterns(patterns); })
      .catch((error) => {
        console.error('Failed to load BWTS harmonics:', error);
        if (active) setHarmonicPatterns([]);
      });
    return () => { active = false; };
  }, [fetchBwtsHarmonics, selectedSymbol, timeframe, showHarmonics]);

  // Draw X-A-B-C-D, point labels, and both edges of the PRZ.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const series of harmonicSeriesRefs.current) {
      try { chart.removeSeries(series); } catch { /* already removed */ }
    }
    harmonicSeriesRefs.current = [];
    if (!showHarmonics) return;

    for (const pattern of harmonicPatterns) {
      if (pattern.status !== 'completed') continue;
      const color = pattern.direction === 'bullish' ? '#10b981' : '#ef4444';
      const patternSeries = chart.addSeries(LineSeries, {
        color,
        lineWidth: 3,
        lineStyle: LineStyle.Dashed,
        title: `${pattern.direction.toUpperCase()} ${pattern.type}`,
      });
      harmonicSeriesRefs.current.push(patternSeries);
      const labels = ['X', 'A', 'B', 'C', 'D'] as const;
      const lineData = labels.map((label) => ({
        time: Math.floor(pattern.points[label].time.getTime() / 1000) as UTCTimestamp,
        value: pattern.points[label].price,
      }));
      patternSeries.setData(lineData);

      const xTime = lineData[0].time as number;
      const dTime = lineData[4].time as number;
      // PRZ is rendered as a compact SVG box around D below. Do not add
      // horizontal series that bleed through the rest of the chart.
      const patternSpan = Math.max(3600, dTime - xTime);
      chart.timeScale().setVisibleRange({
        from: Math.floor(xTime - patternSpan * 0.3) as UTCTimestamp,
        to: Math.floor(dTime + patternSpan * 0.7) as UTCTimestamp,
      });
    }
  }, [harmonicPatterns, showHarmonics]);

  // Prominent filled XABCD geometry, rendered above the chart canvases.
  useEffect(() => {
    const chart = chartRef.current;
    const priceSeries = candlestickSeriesRef.current;
    const container = chartContainerRef.current;
    if (!chart || !priceSeries || !container) return;
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const removeOverlay = () => container.querySelector('[data-harmonic-overlay]')?.remove();

    const renderOverlay = () => {
      removeOverlay();
      if (!showHarmonics || harmonicPatterns.length === 0) return;
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('data-harmonic-overlay', 'true');
      svg.setAttribute('width', String(container.clientWidth));
      svg.setAttribute('height', String(container.clientHeight));
      svg.style.position = 'absolute';
      svg.style.inset = '0';
      svg.style.zIndex = '10';
      svg.style.pointerEvents = 'none';
      svg.style.overflow = 'visible';

      for (const pattern of harmonicPatterns) {
        const labels = ['X', 'A', 'B', 'C', 'D'] as const;
        const coords = labels.map((label) => {
          const point = pattern.points[label];
          return {
            label,
            price: point.price,
            x: chart.timeScale().timeToCoordinate(
              Math.floor(point.time.getTime() / 1000) as UTCTimestamp
            ),
            y: priceSeries.priceToCoordinate(point.price),
          };
        });
        if (coords.some((point) => point.x == null || point.y == null)) continue;
        const color = pattern.direction === 'bullish' ? '#22c55e' : '#ef4444';
        const fill = pattern.direction === 'bullish' ? '#22c55e' : '#ef4444';
        const xy = (indexes: number[]) => indexes
          .map((index) => `${coords[index].x},${coords[index].y}`)
          .join(' ');

        // Two shaded triangles make the harmonic structure impossible to miss.
        for (const indexes of [[0, 1, 2], [2, 3, 4]]) {
          const polygon = document.createElementNS(SVG_NS, 'polygon');
          polygon.setAttribute('points', xy(indexes));
          polygon.setAttribute('fill', fill);
          polygon.setAttribute('fill-opacity', '0.22');
          polygon.setAttribute('stroke', color);
          polygon.setAttribute('stroke-opacity', '0.55');
          polygon.setAttribute('stroke-width', '1.5');
          svg.appendChild(polygon);
        }

        const zigzag = document.createElementNS(SVG_NS, 'polyline');
        zigzag.setAttribute('points', xy([0, 1, 2, 3, 4]));
        zigzag.setAttribute('fill', 'none');
        zigzag.setAttribute('stroke', color);
        zigzag.setAttribute('stroke-width', '4');
        zigzag.setAttribute('stroke-linecap', 'round');
        zigzag.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(zigzag);

        for (const point of coords) {
          const circle = document.createElementNS(SVG_NS, 'circle');
          circle.setAttribute('cx', String(point.x));
          circle.setAttribute('cy', String(point.y));
          circle.setAttribute('r', '6');
          circle.setAttribute('fill', color);
          circle.setAttribute('stroke', '#ffffff');
          circle.setAttribute('stroke-width', '2');
          svg.appendChild(circle);

          const text = document.createElementNS(SVG_NS, 'text');
          text.setAttribute('x', String(Number(point.x) + 9));
          text.setAttribute('y', String(Number(point.y) - 9));
          text.setAttribute('fill', '#ffffff');
          text.setAttribute('font-size', '13');
          text.setAttribute('font-weight', '700');
          text.setAttribute('paint-order', 'stroke');
          text.setAttribute('stroke', '#111827');
          text.setAttribute('stroke-width', '4');
          text.setAttribute('stroke-linejoin', 'round');
          text.textContent = `${point.label} (${point.price.toFixed(2)})`;
          svg.appendChild(text);
        }

        const d = coords[4];
        const yLow = priceSeries.priceToCoordinate(pattern.prz.min);
        const yHigh = priceSeries.priceToCoordinate(pattern.prz.max);
        if (yLow != null && yHigh != null && d.x != null) {
          const top = Math.min(yLow, yHigh);
          const height = Math.max(8, Math.abs(yLow - yHigh));
          const boxX = Math.max(0, Number(d.x) - 8);
          const boxWidth = Math.max(60, Math.min(140, container.clientWidth - boxX));
          const prz = document.createElementNS(SVG_NS, 'rect');
          prz.setAttribute('x', String(boxX));
          prz.setAttribute('y', String(top));
          prz.setAttribute('width', String(boxWidth));
          prz.setAttribute('height', String(height));
          prz.setAttribute('fill', color);
          prz.setAttribute('fill-opacity', '0.18');
          prz.setAttribute('stroke', color);
          prz.setAttribute('stroke-width', '2');
          prz.setAttribute('stroke-dasharray', '7 5');
          svg.appendChild(prz);

          const przLabel = document.createElementNS(SVG_NS, 'text');
          przLabel.setAttribute('x', String(boxX + 8));
          przLabel.setAttribute('y', String(top - 7));
          przLabel.setAttribute('fill', color);
          przLabel.setAttribute('font-size', '13');
          przLabel.setAttribute('font-weight', '800');
          przLabel.textContent = `${pattern.type} PRZ ${pattern.prz.min.toFixed(2)}–${pattern.prz.max.toFixed(2)}`;
          svg.appendChild(przLabel);
        }
      }
      container.appendChild(svg);
    };

    const deferredRender = () => requestAnimationFrame(renderOverlay);
    deferredRender();
    chart.timeScale().subscribeVisibleTimeRangeChange(deferredRender);
    window.addEventListener('resize', deferredRender);
    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(deferredRender);
      window.removeEventListener('resize', deferredRender);
      removeOverlay();
    };
  }, [chartRevision, harmonicPatterns, showHarmonics]);

  // ADR(14) high, low, and day-open reference lines.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const series of adrSeriesRefs.current) {
      try { chart.removeSeries(series); } catch { /* already removed */ }
    }
    adrSeriesRefs.current = [];
    if (!adrData) return;
    const start = adrData.day_time as UTCTimestamp;
    const end = Math.max(Math.floor(Date.now() / 1000), adrData.day_time + 60) as UTCTimestamp;
    const levels = [
      { title: 'ADR High', value: adrData.adr_high, color: '#f97316', style: LineStyle.Dashed },
      { title: 'Day Open', value: adrData.day_open, color: '#94a3b8', style: LineStyle.Dotted },
      { title: 'ADR Low', value: adrData.adr_low, color: '#06b6d4', style: LineStyle.Dashed },
    ] as const;
    for (const level of levels) {
      const series = chart.addSeries(LineSeries, {
        color: level.color,
        lineWidth: 2,
        lineStyle: level.style,
        title: `${level.title} ${level.value.toFixed(2)}`,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      series.setData([{ time: start, value: level.value }, { time: end, value: level.value }]);
      adrSeriesRefs.current.push(series);
    }
  }, [adrData, chartRevision]);

  // Draw trendlines on chart
  useEffect(() => {
    if (!chartRef.current || !showTrendLines) return;

    trendLines.forEach((trendLine) => {
      if (trendLine.isActive && trendLine.points.length >= 2) {
        const trendSeries = chartRef.current!.addSeries(LineSeries, {
          color: trendLine.type === 'support' ? '#3b82f6' : '#f59e0b',
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          title: `${trendLine.type} Line`,
        });

        try {
          const lineData = trendLine.points.map(point => ({
            time: Math.floor(point.time.getTime() / 1000) as any,
            value: point.price,
          }));

          trendSeries.setData(lineData);
        } catch (error) {
          console.warn('Failed to draw trendline:', error);
        }
      }
    });
  }, [trendLines, showTrendLines]);

  // Draw V2 Fibonacci plus support/resistance from the same analysis used by the dashboard.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const series of v2LevelSeriesRefs.current) {
      try { chart.removeSeries(series); } catch { /* chart was rebuilt */ }
    }
    v2LevelSeriesRefs.current = [];
    if (!cryptoAnalysis) return;

    const visible = chart.timeScale().getVisibleRange();
    const now = Math.floor(Date.now() / 1000);
    const start = (typeof visible?.from === 'number' ? visible.from : now - 7 * 86400) as any;
    const end = (typeof visible?.to === 'number' ? visible.to : now + 86400) as any;
    const levels: { title: string; value: number; color: string; style: LineStyle }[] = [];

    if (showSupportResistance) {
      (cryptoAnalysis.zones.support || []).slice(-3).forEach((value: number, index: number) => levels.push({ title: `S${index + 1}`, value, color: '#22c55e', style: LineStyle.Dashed }));
      (cryptoAnalysis.zones.resistance || []).slice(-3).forEach((value: number, index: number) => levels.push({ title: `R${index + 1}`, value, color: '#f43f5e', style: LineStyle.Dashed }));
    }
    if (showFibonacci) {
      const fib = cryptoAnalysis.zones.fibonacci?.levels || {};
      Object.entries(fib).forEach(([ratio, value]) => levels.push({ title: `Fib ${ratio}`, value: Number(value), color: ['0.5', '0.618', '0.786'].includes(ratio) ? '#a78bfa' : '#6366f1', style: LineStyle.Dotted }));
    }

    levels.filter((level) => Number.isFinite(level.value)).forEach((level) => {
      const series = chart.addSeries(LineSeries, { color: level.color, lineWidth: 1, lineStyle: level.style, title: level.title, lastValueVisible: true, priceLineVisible: false });
      series.setData([{ time: start, value: level.value }, { time: end, value: level.value }]);
      v2LevelSeriesRefs.current.push(series);
    });
  }, [cryptoAnalysis, showFibonacci, showSupportResistance, chartRevision]);

  // Native-feeling live candles: REST loads history once, then the global
  // public Binance market-data stream updates the active candle trade-by-trade.
  useEffect(() => {
    const symbolMap: Record<string, string> = {
      BTCUSD: 'btcusdt', ETHUSD: 'ethusdt',
    };
    const timeframeSeconds: Record<string, number> = {
      '1m': 60, '5m': 300, '15m': 900, '30m': 1800,
      '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800,
    };
    const streamSymbol = symbolMap[selectedSymbol];
    const bucketSeconds = timeframeSeconds[timeframe];
    if (!isLive || !streamSymbol || !bucketSeconds) {
      setIsStreaming(false);
      return;
    }

    let disposed = false;
    let reconnectTimer: number | undefined;
    const key = `${selectedSymbol}:${timeframe}`;
    const connect = () => {
      if (disposed) return;
      const ws = new WebSocket(
        `wss://data-stream.binance.vision/ws/${streamSymbol}@trade`
      );
      marketWsRef.current = ws;
      ws.onopen = () => {
        if (!disposed) { setIsStreaming(true); setIsConnected(true); }
      };
      ws.onmessage = (event) => {
        if (disposed || loadedChartKeyRef.current !== key) return;
        try {
          const message = JSON.parse(event.data);
          const price = Number(message?.p);
          const tradeTime = Math.floor(Number(message?.T) / 1000);
          if (!Number.isFinite(price) || !Number.isFinite(tradeTime) ||
              !candlestickSeriesRef.current) return;
          const bucketTime = Math.floor(tradeTime / bucketSeconds) * bucketSeconds;
          const cached = candleCacheRef.current[key] || [];
          const previous = cached[cached.length - 1];
          const candle: CandlestickData = previous && Number(previous.time) === bucketTime
            ? {
                ...previous,
                high: Math.max(previous.high, price),
                low: Math.min(previous.low, price),
                close: price,
              }
            : {
                time: bucketTime as UTCTimestamp,
                open: price, high: price, low: price, close: price,
              };
          candlestickSeriesRef.current.update(candle);
          if (previous && Number(previous.time) === bucketTime) {
            cached[cached.length - 1] = candle;
          } else {
            cached.push(candle);
            if (cached.length > 250) cached.shift();
          }
          candleCacheRef.current[key] = cached;
          const now = performance.now();
          if (now - lastUiPriceUpdateRef.current >= 100) {
            lastUiPriceUpdateRef.current = now;
            setCurrentPrice(price);
          }
        } catch (error) {
          console.warn('Invalid Binance market-data event:', error);
        }
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (marketWsRef.current === ws) marketWsRef.current = null;
        if (!disposed) {
          setIsStreaming(false);
          reconnectTimer = window.setTimeout(connect, 2000);
        }
      };
    };
    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (marketWsRef.current) {
        marketWsRef.current.onclose = null;
        marketWsRef.current.close();
        marketWsRef.current = null;
      }
      setIsStreaming(false);
    };
  }, [isLive, selectedSymbol, timeframe]);

  // Slow REST reconciliation is only a fallback for missed WebSocket events.
  useEffect(() => {
    if (!isLive) return;
    const interval = window.setInterval(() => {
      if (!document.hidden) loadCandlesForSymbol(selectedSymbol, timeframe, true);
    }, 30000);
    return () => window.clearInterval(interval);
  }, [isLive, loadCandlesForSymbol, selectedSymbol, timeframe]);

  useEffect(() => {
    checkExistingTradeLockerConnection();
  }, [checkExistingTradeLockerConnection]);

  // Handle symbol change
  const handleSymbolChange = (newSymbol: string) => {
    setSelectedSymbol(newSymbol);
    setSearchTerm(newSymbol);
    loadCandlesForSymbol(newSymbol, timeframe);
    
    // Load new technical analysis
    loadSymbolData(newSymbol);
  };

  useEffect(() => {
    loadCandlesForSymbol(selectedSymbol, timeframe);
  }, [loadCandlesForSymbol, selectedSymbol, timeframe]);

  const getSymbolInfo = (symbol: string): SymbolInfo | undefined => {
    return symbolDatabase.find(s => s.symbol === symbol);
  };

  const symbolDatabase = availableSymbols.length > 0 ? availableSymbols : BWTS_SYMBOLS;

  const currentSymbolInfo = getSymbolInfo(selectedSymbol);

  return (
    <div className="h-full w-full min-w-0 min-h-0 overflow-hidden bg-gray-900 text-white flex flex-col">
      {/* Enhanced Top Controls */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Left Section - Logo & Symbol Search */}
          <div className="flex items-center space-x-4">
            <ConfluenceXLogo size="sm" />
            
            {/* Symbol Search */}
            <div className="relative">
              <div className="flex items-center space-x-2 bg-gray-700 rounded-lg px-3 py-2">
                <Search className="w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => handleSymbolSearch(e.target.value)}
                  onFocus={() => updateSymbolSuggestions(searchTerm)}
                  placeholder="Search symbols..."
                  className="bg-transparent text-white placeholder-gray-400 outline-none w-48"
                />
              </div>
              
              {/* Symbol Suggestions Dropdown */}
              {showSuggestions && symbolSuggestions.length > 0 && (
                <div className="absolute top-full left-0 mt-1 w-80 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 max-h-64 overflow-y-auto">
                  {symbolSuggestions.map((symbol) => (
                    <button
                      key={symbol.symbol}
                      onClick={() => selectSymbol(symbol)}
                      className="w-full px-4 py-3 text-left hover:bg-gray-700 transition-colors border-b border-gray-700 last:border-b-0"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-white">{symbol.symbol}</div>
                          <div className="text-sm text-gray-400">{symbol.name}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-gray-500">{symbol.exchange}</div>
                          <div className={`text-xs px-2 py-1 rounded-full ${
                            symbol.type === 'forex' ? 'bg-blue-900 text-blue-300' :
                            symbol.type === 'stock' ? 'bg-green-900 text-green-300' :
                            symbol.type === 'crypto' ? 'bg-purple-900 text-purple-300' :
                            'bg-orange-900 text-orange-300'
                          }`}>
                            {symbol.type.toUpperCase()}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Current Symbol Info */}
            {currentSymbolInfo && (
              <div className="flex items-center space-x-3 bg-gray-700 rounded-lg px-4 py-2">
                <div>
                  <div className="font-semibold text-white">{currentSymbolInfo.symbol}</div>
                  <div className="text-xs text-gray-400">{currentSymbolInfo.exchange}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-lg text-emerald-400">
                    {currentPrice.toFixed(getDecimalPlaces(selectedSymbol))}
                  </div>
                  <div className="text-xs text-emerald-400">+0.0012 (+0.12%)</div>
                </div>
              </div>
            )}
          </div>

          {/* Center Section - Timeframes */}
          <div className="flex items-center space-x-1">
            {timeframes.map(tf => (
              <button
                key={tf.value}
                onClick={() => setTimeframe(tf.value)}
                className={`px-3 py-1 text-sm rounded transition-colors ${
                  timeframe === tf.value 
                    ? 'bg-emerald-500 text-white' 
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>

          {/* Right Section - Controls */}
          <div className="flex items-center space-x-4">
            {/* TradeLocker Connection */}
            {tradeLockerConnected ? (
              <button
                onClick={disconnectFromTradeLocker}
                className="flex items-center space-x-2 px-4 py-2 rounded bg-red-600 hover:bg-red-700 transition-colors"
              >
                <Link2Off className="w-4 h-4" />
                <span>Disconnect TradeLocker</span>
              </button>
            ) : (
              <button
                onClick={() => setShowLoginModal(true)}
                className="flex items-center space-x-2 px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 transition-colors"
              >
                <Link className="w-4 h-4" />
                <span>Connect TradeLocker</span>
              </button>
            )}

            {/* Live Data Toggle */}
            <button
              onClick={() => setIsLive(!isLive)}
              className={`flex items-center space-x-2 px-3 py-2 rounded transition-colors ${
                isLive ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-600 hover:bg-gray-700'
              }`}
            >
              {isLive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              <span>{isLive ? 'LIVE' : 'PAUSED'}</span>
            </button>

            {/* Connection Status */}
            <div className="flex items-center space-x-2">
              {isConnected ? (
                <Wifi className="w-5 h-5 text-emerald-500" />
              ) : (
                <WifiOff className="w-5 h-5 text-red-500" />
              )}
              <div className={`w-3 h-3 rounded-full ${isStreaming && isLive ? 'bg-emerald-500 animate-pulse' : isConnected ? 'bg-sky-500' : 'bg-gray-400'}`}></div>
              <span className="text-sm text-gray-400">
                {isStreaming ? 'Streaming' : isConnected ? 'Connected' : 'Connecting...'}
              </span>
            </div>

            <button 
              onClick={() => loadSymbolData(selectedSymbol)}
              className="p-2 bg-gray-700 rounded hover:bg-gray-600 transition-colors"
              title="Refresh Data"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            <button 
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 bg-gray-700 rounded hover:bg-gray-600 transition-colors"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            
            <button 
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-2 bg-gray-700 rounded hover:bg-gray-600 transition-colors"
              title="Toggle Fullscreen"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Technical Analysis Controls */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-400">Technical Analysis:</span>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={showHarmonics}
                onChange={(e) => setShowHarmonics(e.target.checked)}
                className="rounded border-gray-600 text-emerald-500 focus:ring-emerald-500"
              />
              <span className="text-sm text-white">Harmonic Patterns</span>
              {harmonicPatterns.length > 0 && (
                <span className="bg-emerald-600 text-white text-xs px-2 py-1 rounded-full">
                  {harmonicPatterns.length}
                </span>
              )}
            </label>

            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={showTrendLines}
                onChange={(e) => setShowTrendLines(e.target.checked)}
                className="rounded border-gray-600 text-blue-500 focus:ring-blue-500"
              />
              <span className="text-sm text-white">Trend Lines</span>
              {trendLines.length > 0 && (
                <span className="bg-blue-600 text-white text-xs px-2 py-1 rounded-full">
                  {trendLines.length}
                </span>
              )}
            </label>

            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={showSupportResistance}
                onChange={(e) => setShowSupportResistance(e.target.checked)}
                className="rounded border-gray-600 text-cyan-500 focus:ring-cyan-500"
              />
              <span className="text-sm text-white">Support / Resistance</span>
            </label>

            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={showFibonacci}
                onChange={(e) => setShowFibonacci(e.target.checked)}
                className="rounded border-gray-600 text-purple-500 focus:ring-purple-500"
              />
              <span className="text-sm text-white">Fibonacci Levels</span>
              {fibonacciLevels.length > 0 && (
                <span className="bg-purple-600 text-white text-xs px-2 py-1 rounded-full">
                  {fibonacciLevels.length}
                </span>
              )}
            </label>
          </div>

          {/* Pattern Summary */}
          <div className="flex items-center space-x-4 text-sm">
            {harmonicPatterns.length > 0 && (
              <div className="flex items-center space-x-2">
                <Target className="w-4 h-4 text-emerald-500" />
                <span className="text-gray-300">
                  {harmonicPatterns.filter(p => p.status === 'completed').length} Active Patterns
                </span>
              </div>
            )}
            {trendLines.length > 0 && (
              <div className="flex items-center space-x-2">
                <Activity className="w-4 h-4 text-blue-500" />
                <span className="text-gray-300">
                  {trendLines.filter(t => t.isActive).length} Active Lines
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {showHarmonics && (
        <div className={`px-4 py-2 border-b text-sm ${
          harmonicPatterns.length > 0
            ? 'bg-emerald-950 border-emerald-800 text-emerald-200'
            : 'bg-gray-900 border-gray-700 text-gray-400'
        }`}>
          {harmonicPatterns.length > 0 ? (
            harmonicPatterns.map((pattern) => (
              <span key={pattern.id} className="font-medium">
                {pattern.direction.toUpperCase()} {pattern.type} detected on {selectedSymbol} {timeframe} · PRZ {pattern.prz.min.toFixed(2)}–{pattern.prz.max.toFixed(2)} · X-A-B-C-D drawn below
              </span>
            ))
          ) : (
            <span>No completed harmonic pattern on {selectedSymbol} {timeframe}. Scanning live candles.</span>
          )}
        </div>
      )}

      {adrData && (
        <div className={`px-4 py-2 border-b text-sm flex items-center gap-5 ${
          adrData.exhausted
            ? 'bg-red-950 border-red-800 text-red-200'
            : 'bg-sky-950 border-sky-800 text-sky-200'
        }`}>
          <span className="font-semibold">ADR(14): {adrData.adr.toFixed(2)}</span>
          <span>{adrData.percent_used.toFixed(0)}% used</span>
          <span>Range: {adrData.current_range.toFixed(2)}</span>
          <span>ADR Low: {adrData.adr_low.toFixed(2)}</span>
          <span>Open: {adrData.day_open.toFixed(2)}</span>
          <span>ADR High: {adrData.adr_high.toFixed(2)}</span>
          {adrData.exhausted && <span className="font-bold">Range exhausted</span>}
        </div>
      )}

      {cryptoAnalysis && (
        <div className="flex items-center gap-4 border-b border-violet-500/20 bg-[#0d1020] px-4 py-2 text-xs text-slate-400">
          <span className="font-black tracking-wider text-violet-300">CONFLUENCE V2</span>
          <span className="text-base font-black text-cyan-300">{cryptoAnalysis.total_score}<span className="text-[10px] text-slate-600">/100</span></span>
          <span className={`rounded px-2 py-1 text-[9px] font-black ${cryptoAnalysis.direction === 'BUY' ? 'bg-emerald-400/10 text-emerald-300' : cryptoAnalysis.direction === 'SELL' ? 'bg-rose-400/10 text-rose-300' : 'bg-slate-400/10 text-slate-400'}`}>{cryptoAnalysis.direction}</span>
          <span>Structure {cryptoAnalysis.category_breakdown.structure}/20</span>
          <span>Volume {cryptoAnalysis.category_breakdown.volume}/10</span>
          <span>Momentum {cryptoAnalysis.category_breakdown.momentum}/10</span>
          <span>Liquidity {cryptoAnalysis.category_breakdown.liquidity}/15</span>
          <span className="ml-auto font-semibold uppercase text-slate-500">{cryptoAnalysis.data_quality.status} data</span>
        </div>
      )}

      {/* Chart Area */}
      <div className="flex-1 min-w-0 min-h-0 overflow-hidden relative bg-gray-900">
        <div
          ref={chartContainerRef}
          className="w-full h-full min-w-0 min-h-0 overflow-hidden"
        />
        
        {/* Pattern Info Overlay */}
        {(harmonicPatterns.length > 0 || trendLines.length > 0) && (
          <div className="absolute top-4 left-4 bg-gray-800 bg-opacity-90 rounded-lg p-4 max-w-sm">
            <h4 className="text-white font-semibold mb-2 flex items-center">
              <BarChart3 className="w-4 h-4 mr-2" />
              Technical Analysis
            </h4>
            
            {harmonicPatterns.map((pattern, index) => (
              <div key={pattern.id} className="mb-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className={`font-medium ${
                    pattern.direction === 'bullish' ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {pattern.type} Pattern
                  </span>
                  <span className="text-gray-400">{pattern.confidence.toFixed(0)}%</span>
                </div>
                <div className="text-gray-400 text-xs">
                  PRZ: {pattern.prz.min.toFixed(5)} - {pattern.prz.max.toFixed(5)}
                </div>
              </div>
            ))}

            {trendLines.map((line, index) => (
              <div key={line.id} className="mb-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className={`font-medium ${
                    line.type === 'support' ? 'text-blue-400' : 'text-orange-400'
                  }`}>
                    {line.type} Line
                  </span>
                  <span className="text-gray-400">{line.strength}%</span>
                </div>
                <div className="text-gray-400 text-xs">
                  {line.touches} touches • {(line.distance * 10000).toFixed(1)} pips away
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* TradeLocker Login Modal */}
      {showLoginModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md">
            <h2 className="text-2xl font-bold text-white mb-4 flex items-center">
              <Link className="w-6 h-6 mr-2 text-emerald-500" />
              Connect to TradeLocker
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Email</label>
                <input
                  type="email"
                  value={tradeLockerCredentials.email}
                  onChange={(e) => setTradeLockerCredentials({ ...tradeLockerCredentials, email: e.target.value })}
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 border border-gray-600 focus:border-emerald-500 focus:outline-none"
                  placeholder="your@email.com"
                />
              </div>
              
              <div>
                <label className="block text-sm text-gray-400 mb-1">Password</label>
                <input
                  type="password"
                  value={tradeLockerCredentials.password}
                  onChange={(e) => setTradeLockerCredentials({ ...tradeLockerCredentials, password: e.target.value })}
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 border border-gray-600 focus:border-emerald-500 focus:outline-none"
                  placeholder="Your password"
                />
              </div>
              
              <div>
                <label className="block text-sm text-gray-400 mb-1">Server</label>
                <select
                  value={tradeLockerCredentials.server}
                  onChange={(e) => setTradeLockerCredentials({ ...tradeLockerCredentials, server: e.target.value })}
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 border border-gray-600 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="demo">Demo Server</option>
                  <option value="HEROFX">HEROFX Server</option>
                  <option value="live">Live Server</option>
                </select>
              </div>
              
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="isDemo"
                  checked={tradeLockerCredentials.isDemo}
                  onChange={(e) => setTradeLockerCredentials({ ...tradeLockerCredentials, isDemo: e.target.checked })}
                  className="rounded border-gray-600 text-emerald-500 focus:ring-emerald-500"
                />
                <label htmlFor="isDemo" className="text-sm text-gray-400">Use Demo Account</label>
              </div>
            </div>
            
            <div className="flex space-x-3 mt-6">
              <button
                onClick={connectToTradeLocker}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2 px-4 rounded transition-colors"
              >
                Connect
              </button>
              <button
                onClick={() => setShowLoginModal(false)}
                className="flex-1 bg-gray-600 hover:bg-gray-700 text-white py-2 px-4 rounded transition-colors"
              >
                Cancel
              </button>
            </div>
            
            <p className="text-xs text-gray-500 mt-4 text-center">
              Your credentials are only used to authenticate with TradeLocker and are never stored on our servers.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default TradingView;
