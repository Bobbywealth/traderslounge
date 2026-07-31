import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickSeries } from 'lightweight-charts';
import {
  BrainCircuit,
  Settings,
  Maximize2,
  Search,
  Wifi,
  WifiOff,
  BarChart3,
  Activity,
  Target,
  RefreshCw,
  Pencil,
  LineChart,
  MousePointer2,
  Minus,
  Square,
  Percent,
  Type,
  Trash2,
  Undo2,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Copy,
  Magnet,
  Tag,
  Hand,
  ChevronRight,
  ChevronLeft
} from 'lucide-react';
import { liveDataService, HarmonicPattern, TrendLine, FibonacciLevel } from '../services/liveDataService';
import { tradeLockerService, TradeLockerConfig } from '../services/tradeLockerService';
import { tradeLockerApi, LEGACY_API_BASE_URL } from '../services/apiService';
import ConfluenceXLogo from '../components/ConfluenceXLogo';
import ChartAiAnalysisPanel from '../components/ChartAiAnalysisPanel';
import TradeSetupPanel from '../components/TradeSetupPanel';
import TradeExamplesPanel from '../components/TradeExamplesPanel';
import TradeValidationPanel from '../components/TradeValidationPanel';
import { bwtsApi, type ChartAiAnalysis, type CryptoAnalysis } from '../services/bwtsApi';
import { useCandles } from '../features/chart/useCandles';
import { useBinanceStream } from '../features/chart/useBinanceStream';
import { useDrawings } from '../features/chart/useDrawings';
import { authenticatedChartFetch } from '../features/chart/authenticatedFetch';
import { CHART_COLORS, CHART_TIMEFRAMES, timeframeSeconds } from '../features/chart/constants';
import {
  getPlanGating,
  useAdrLevelSeries,
  useAnalysisLevelSeries,
  useConditionalSetupOverlay,
  useHarmonicPatternSeries,
  useHarmonicSvgOverlay,
  useSetupZoneOverlay,
  useTrendLineSeries,
  type ChartAdr,
  type SetupZone,
} from '../features/chart/overlays';

interface SymbolInfo {
  symbol: string;
  name: string;
  exchange: string;
  type: 'forex' | 'stock' | 'crypto' | 'commodity';
  price?: number;
}

const BWTS_SYMBOLS: SymbolInfo[] = [
  // Crypto (Binance market-data feed)
  { symbol: 'BTCUSD', name: 'Bitcoin / US Dollar', exchange: 'Binance Market Data', type: 'crypto' },
  { symbol: 'ETHUSD', name: 'Ethereum / US Dollar', exchange: 'Binance Market Data', type: 'crypto' },
  // Forex majors (Twelve Data feed)
  { symbol: 'EURUSD', name: 'Euro / US Dollar', exchange: 'Twelve Data', type: 'forex' },
  { symbol: 'GBPUSD', name: 'British Pound / US Dollar', exchange: 'Twelve Data', type: 'forex' },
  { symbol: 'USDJPY', name: 'US Dollar / Japanese Yen', exchange: 'Twelve Data', type: 'forex' },
  { symbol: 'USDCHF', name: 'US Dollar / Swiss Franc', exchange: 'Twelve Data', type: 'forex' },
  { symbol: 'AUDUSD', name: 'Australian Dollar / US Dollar', exchange: 'Twelve Data', type: 'forex' },
  { symbol: 'USDCAD', name: 'US Dollar / Canadian Dollar', exchange: 'Twelve Data', type: 'forex' },
  { symbol: 'NZDUSD', name: 'New Zealand Dollar / US Dollar', exchange: 'Twelve Data', type: 'forex' },
  // Metals (Twelve Data feed)
  { symbol: 'XAUUSD', name: 'Gold / US Dollar', exchange: 'Twelve Data', type: 'commodity' },
];

const apiBase = () => import.meta.env.VITE_BWTS_API_URL || import.meta.env.VITE_API_URL || '';

async function fetchBwtsHarmonics(symbol: string, tf: string): Promise<HarmonicPattern[]> {
  const params = new URLSearchParams({ pair: symbol, timeframe: tf });
  const response = await authenticatedChartFetch(`${apiBase()}/api/harmonics?${params.toString()}`);
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
}

async function fetchBwtsAdr(symbol: string): Promise<ChartAdr> {
  const params = new URLSearchParams({ pair: symbol });
  const response = await authenticatedChartFetch(`${apiBase()}/api/adr?${params.toString()}`);
  if (!response.ok) throw new Error(`Failed to fetch ADR: ${response.status}`);
  return response.json();
}

type RawRecord = Record<string, unknown>;

const mapTradeLockerType = (instrument: RawRecord): SymbolInfo['type'] => {
  const rawType = String(
    instrument.type ??
    instrument.instrumentType ??
    instrument.assetType ??
    instrument.category ??
    ''
  ).toLowerCase();

  if (rawType.includes('crypto')) return 'crypto';
  if (rawType.includes('stock') || rawType.includes('equity')) return 'stock';
  if (rawType.includes('commodity') || rawType.includes('metal')) return 'commodity';
  return 'forex';
};

const parseTradeLockerInstruments = (payload: unknown): SymbolInfo[] => {
  const record = (payload ?? {}) as RawRecord;
  const rawItems = Array.isArray(payload)
    ? payload
    : (record.d || record.instruments || record.data || []);

  if (!Array.isArray(rawItems)) return [];

  return rawItems
    .map((item: unknown): SymbolInfo | null => {
      const instrument = (item ?? {}) as RawRecord;
      const symbol = String(
        instrument.symbol ??
        instrument.name ??
        instrument.code ??
        ''
      ).trim();
      if (!symbol) return null;

      return {
        symbol,
        name: String(instrument.description ?? instrument.displayName ?? symbol),
        exchange: String(instrument.exchange ?? 'TradeLocker'),
        type: mapTradeLockerType(instrument),
        price: Number(instrument.lastPrice ?? instrument.price ?? 0) || undefined,
      };
    })
    .filter((item): item is SymbolInfo => item !== null);
};

const getDecimalPlaces = (symbol: string): number => {
  if (symbol.includes('JPY')) return 3;
  if (symbol.includes('BTC') || symbol.includes('ETH')) return 2;
  if (['AAPL', 'GOOGL', 'MSFT', 'TSLA'].includes(symbol)) return 2;
  if (symbol.includes('XAU')) return 2;
  return 5;
};

const TradingView: React.FC = () => {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const chartInitialized = useRef<boolean>(false);
  const lastUiPriceUpdateRef = useRef(0);
  const revisionKeyRef = useRef('');

  const [chartRevision, setChartRevision] = useState(0);
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSD');
  const [timeframe, setTimeframe] = useState('1h');
  const [currentPrice, setCurrentPrice] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [symbolSuggestions, setSymbolSuggestions] = useState<SymbolInfo[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [availableSymbols, setAvailableSymbols] = useState<SymbolInfo[]>(BWTS_SYMBOLS);

  // Technical analysis data
  const [harmonicPatterns, setHarmonicPatterns] = useState<HarmonicPattern[]>([]);
  const [adrData, setAdrData] = useState<ChartAdr | null>(null);
  const [trendLines, setTrendLines] = useState<TrendLine[]>([]);
  const [fibonacciLevels, setFibonacciLevels] = useState<FibonacciLevel[]>([]);
  const [symbolDataRevision, setSymbolDataRevision] = useState(0);
  const [showHarmonics, setShowHarmonics] = useState(true);
  const [showTrendLines, setShowTrendLines] = useState(true);
  const [showFibonacci, setShowFibonacci] = useState(true);
  const [showSupportResistance, setShowSupportResistance] = useState(true);
  const [showSetups, setShowSetups] = useState(true);
  const [showSetupGuide, setShowSetupGuide] = useState(true);
  const [showManualDrawings, setShowManualDrawings] = useState(true);
  const [cryptoAnalysis, setCryptoAnalysis] = useState<CryptoAnalysis | null>(null);
  const [chartAiAnalysis, setChartAiAnalysis] = useState<ChartAiAnalysis | null>(null);
  const [chartAiConfigured, setChartAiConfigured] = useState<boolean | null>(null);
  const [chartAiLoading, setChartAiLoading] = useState(false);
  const [chartAiError, setChartAiError] = useState<string | null>(null);
  const [showChartContext, setShowChartContext] = useState(false);
  const [showTechnicalControls, setShowTechnicalControls] = useState(false);
  const [drawingRailCollapsed, setDrawingRailCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [setupPanelExpanded, setSetupPanelExpanded] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<'setup' | 'examples'>('setup');
  const [examplesPanelExpanded, setExamplesPanelExpanded] = useState(true);

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
      const response = await fetch(`${LEGACY_API_BASE_URL}/api/tradelocker/instruments?${params.toString()}`);
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
      '1M': 30 * 24 * 60 * 60 * 1000,
    };
    return timeframes[timeframe] || 60 * 60 * 1000;
  };

  // Initialize chart. Declared before useCandles so the series exists by the
  // time the candle hook's first refresh runs on mount.
  useEffect(() => {
    if (!chartContainerRef.current || chartInitialized.current) return;

    try {
      const chart = createChart(chartContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: CHART_COLORS.background },
          textColor: CHART_COLORS.text,
        },
        grid: {
          vertLines: { color: CHART_COLORS.grid },
          horzLines: { color: CHART_COLORS.grid },
        },
        crosshair: { mode: 1 },
        rightPriceScale: {
          borderColor: CHART_COLORS.axisBorder,
        },
        timeScale: {
          borderColor: CHART_COLORS.axisBorder,
        },
        width: chartContainerRef.current.clientWidth,
        height: chartContainerRef.current.clientHeight,
      });

      const candlestickSeries = chart.addSeries(CandlestickSeries, {
        upColor: CHART_COLORS.candleUp,
        downColor: CHART_COLORS.candleDown,
        borderDownColor: CHART_COLORS.candleDown,
        borderUpColor: CHART_COLORS.candleUp,
        wickDownColor: CHART_COLORS.candleDown,
        wickUpColor: CHART_COLORS.candleUp,
      });

      chartRef.current = chart;
      candlestickSeriesRef.current = candlestickSeries;
      chartInitialized.current = true;
      setChartRevision((revision) => revision + 1);

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

  const handleCandlesLoaded = useCallback(() => {
    // Bump the overlay revision only when a new symbol/timeframe finishes its
    // full history load, so overlays re-anchor without thrashing on polls.
    const key = `${selectedSymbol}:${timeframe}`;
    if (revisionKeyRef.current !== key) {
      revisionKeyRef.current = key;
      setChartRevision((revision) => revision + 1);
    }
  }, [selectedSymbol, timeframe]);

  const handlePrice = useCallback((price: number) => {
    const now = performance.now();
    if (now - lastUiPriceUpdateRef.current >= 100) {
      lastUiPriceUpdateRef.current = now;
      setCurrentPrice(price);
    }
  }, []);

  const {
    loading: candlesLoading,
    connected: candlesConnected,
    error: candleError,
    refresh: refreshCandles,
    mergeLive,
    getCachedCandles,
  } = useCandles({
    symbol: selectedSymbol,
    timeframe,
    seriesRef: candlestickSeriesRef,
    onLoaded: handleCandlesLoaded,
    onPrice: handlePrice,
  });

  // Native-feeling live candles: REST loads history once, then the global
  // public Binance market-data stream updates the active candle trade-by-trade.
  const { streaming } = useBinanceStream({
    symbol: selectedSymbol,
    timeframe,
    getLastCandle: () => {
      const cached = getCachedCandles();
      return cached[cached.length - 1];
    },
    onCandle: mergeLive,
  });

  const isConnected = candlesConnected || streaming;

  // Slow REST reconciliation is only a fallback for missed WebSocket events.
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!document.hidden) void refreshCandles(true);
    }, 30000);
    return () => window.clearInterval(interval);
  }, [refreshCandles]);

  // V2 analysis runs server-side for any asset class via the same
  // /api/analysis endpoint (MultiSourceClient routes FX/gold to Twelve
  // Data). Show it for crypto, forex and commodities — not just crypto.
  useEffect(() => {
    const assetType = availableSymbols.find((symbol) => symbol.symbol === selectedSymbol)?.type;
    if (!assetType || !['crypto', 'forex', 'commodity', 'stock'].includes(assetType)) {
      setCryptoAnalysis(null);
      return;
    }
    let active = true;
    setCryptoAnalysis(null);
    setChartAiAnalysis(null);
    setChartAiConfigured(null);
    setChartAiError(null);
    bwtsApi.cryptoAnalysis(selectedSymbol, timeframe)
      .then((analysis) => { if (active) setCryptoAnalysis(analysis); })
      .catch(() => { if (active) setCryptoAnalysis(null); });
    return () => { active = false; };
  }, [selectedSymbol, timeframe, availableSymbols]);

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
  }, [selectedSymbol]);

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
  }, [selectedSymbol, timeframe, showHarmonics]);

  // Trendlines and fibonacci levels from the live-data service.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (showTrendLines) {
          const trendlines = await liveDataService.detectTrendLines(selectedSymbol);
          if (active) setTrendLines(trendlines);
        }
        if (showFibonacci) {
          const priceHistory = await liveDataService.getPriceHistory(selectedSymbol, 50);
          if (priceHistory.length > 10) {
            const recentHigh = Math.max(...priceHistory.slice(-20).map((p) => p.high));
            const recentLow = Math.min(...priceHistory.slice(-20).map((p) => p.low));
            const fibLevels = await liveDataService.calculateFibonacciLevels(selectedSymbol, recentHigh, recentLow);
            if (active) setFibonacciLevels(fibLevels);
          }
        }
      } catch (error) {
        console.error('Failed to load symbol analysis:', error);
      }
    })();
    return () => { active = false; };
  }, [selectedSymbol, showTrendLines, showFibonacci, symbolDataRevision]);

  // Restore a previously-connected TradeLocker session and its instrument
  // list once on mount.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const status = await tradeLockerApi.connect();
        if (!status.connected || !active) return;
        const sessionId = localStorage.getItem('tl_session_id');
        const params = new URLSearchParams(sessionId ? { sessionId } : {});
        const API_BASE = import.meta.env.VITE_API_URL || '';
        const response = await fetch(`${API_BASE}/api/tradelocker/instruments?${params.toString()}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch instruments: ${response.status}`);
        }
        const instruments = parseTradeLockerInstruments(await response.json());
        if (!active || instruments.length === 0) return;
        setAvailableSymbols(instruments);
        if (!instruments.some((item) => item.symbol === selectedSymbol)) {
          setSelectedSymbol(instruments[0].symbol);
          setSearchTerm(instruments[0].symbol);
        } else if (!searchTerm) {
          setSearchTerm(selectedSymbol);
        }
      } catch (error) {
        console.error('Failed to restore TradeLocker session:', error);
      }
    })();
    return () => { active = false; };
    // Mount-only: subsequent symbol changes must not re-fetch instruments.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getCandlesForDrawing = useCallback(() => getCachedCandles(), [getCachedCandles]);
  const getDuplicateShift = useCallback(() => ({
    time: timeframeSeconds(timeframe) * 5,
    price: Number(cryptoAnalysis?.indicators?.atr || currentPrice * 0.002) * 0.2,
  }), [timeframe, cryptoAnalysis, currentPrice]);

  const {
    drawings,
    draftDrawing,
    selectedDrawing,
    selectedDrawingId,
    setSelectedDrawingId,
    drawingTool,
    setDrawingTool,
    drawingColor,
    setDrawingColor,
    magnetDrawing,
    setMagnetDrawing,
    drawingRevision,
    canUndo,
    saveDrawingChange,
    handleDrawingPointerDown,
    handleDrawingPointerMove,
    handleDrawingPointerUp,
    handleAnchorPointerDown,
    handleAnchorPointerMove,
    handleAnchorPointerUp,
    undoDrawing,
    updateSelectedDrawing,
    deleteSelectedDrawing,
    duplicateSelectedDrawing,
    clearDrawings,
    drawingCoordinates,
  } = useDrawings({
    symbol: selectedSymbol,
    timeframe,
    chartRef,
    seriesRef: candlestickSeriesRef,
    containerRef: chartContainerRef,
    getCandles: getCandlesForDrawing,
    getDuplicateShift,
    chartRevision,
  });

  // Chart overlays: harmonic geometry, ADR levels, trendlines, V2 levels,
  // and the deterministic setup zones.
  useHarmonicPatternSeries(chartRef, harmonicPatterns, showHarmonics, chartRevision);
  useHarmonicSvgOverlay(chartRef, candlestickSeriesRef, chartContainerRef, harmonicPatterns, showHarmonics, cryptoAnalysis, chartRevision);
  useAdrLevelSeries(chartRef, adrData, chartRevision);
  useTrendLineSeries(chartRef, trendLines, showTrendLines, chartRevision);
  useAnalysisLevelSeries(chartRef, cryptoAnalysis, showSupportResistance, showFibonacci, currentPrice, chartRevision);
  useSetupZoneOverlay(chartRef, candlestickSeriesRef, chartContainerRef, cryptoAnalysis, showSetups, chartRevision, currentPrice);
  useConditionalSetupOverlay(chartRef, candlestickSeriesRef, chartContainerRef, cryptoAnalysis, showSetups, chartRevision, currentPrice);

  const refreshAll = () => {
    void refreshCandles(true);
    setSymbolDataRevision((revision) => revision + 1);
  };

  const symbolDatabase = availableSymbols.length > 0 ? availableSymbols : BWTS_SYMBOLS;
  const currentSymbolInfo = symbolDatabase.find((s) => s.symbol === selectedSymbol);

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) await workspaceRef.current?.requestFullscreen();
    else await document.exitFullscreen();
    setIsFullscreen(Boolean(document.fullscreenElement));
  };

  const analyzeChartWithAi = useCallback(async () => {
    const screenshot = chartRef.current?.takeScreenshot();
    const candles = getCachedCandles().slice(-120).map((candle) => ({
      time: Number(candle.time), open: candle.open, high: candle.high, low: candle.low, close: candle.close,
    }));
    if (!screenshot || candles.length === 0) {
      setChartAiError('The chart is still loading. Wait for candles, then try again.');
      return;
    }
    setChartAiLoading(true);
    setChartAiError(null);
    try {
      const overlays = {
        harmonics: harmonicPatterns.map((pattern) => ({
          type: pattern.type,
          direction: pattern.direction,
          confidence: pattern.confidence,
          prz: pattern.prz,
          points: Object.fromEntries(Object.entries(pattern.points).map(([label, point]) => [label, { price: point.price, time: point.time.getTime() / 1000 }])),
        })),
        adr: adrData,
        trend_lines: trendLines.map((line) => ({ type: line.type, slope: line.slope, strength: line.strength, touches: line.touches, currentPrice: line.currentPrice, distance: line.distance, points: line.points.map((point) => ({ price: point.price, time: point.time.getTime() / 1000 })) })),
        fibonacci: fibonacciLevels,
      };
      const result = await bwtsApi.chartAnalyze({
        pair: selectedSymbol,
        timeframe,
        image_data_url: screenshot.toDataURL('image/png'),
        chart: { current_price: currentPrice, candles, overlays, manual_drawings: drawings },
        analysis: cryptoAnalysis,
      });
      setChartAiAnalysis(result.analysis);
      setChartAiConfigured(result.configured);
    } catch (error: unknown) {
      setChartAiError(error instanceof Error ? error.message : 'Chart AI analysis failed');
    } finally {
      setChartAiLoading(false);
    }
  }, [getCachedCandles, selectedSymbol, timeframe, currentPrice, harmonicPatterns, adrData, trendLines, fibonacciLevels, drawings, cryptoAnalysis]);

  const setupPlan = cryptoAnalysis?.trade_plan;
  const planGating = getPlanGating(cryptoAnalysis);
  const setupReady = planGating.ready;
  const setupHardBlocked = planGating.hardBlocked;
  const setupZones = ((Array.isArray(cryptoAnalysis?.zones?.setup_zones) ? cryptoAnalysis.zones.setup_zones : []) as SetupZone[])
    .filter((zone) => ['BUY', 'SELL'].includes(String(zone.direction)) && Number.isFinite(Number(zone.low)) && Number.isFinite(Number(zone.high)))
    .filter((zone, index, zones) => zones.findIndex((item) => item.direction === zone.direction) === index)
    .slice(0, 2);
  const setupPrice = (value: number | string | null | undefined) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div ref={workspaceRef} className="relative h-full w-full min-w-0 min-h-0 overflow-hidden bg-gray-900 text-white flex flex-col">
      {/* Sidebar Toggle */}
      <button
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        className="absolute right-0 top-32 z-35 p-2 bg-gray-800/80 hover:bg-gray-700 rounded-l transition-colors"
        title={sidebarCollapsed ? 'Open sidebar' : 'Close sidebar'}
      >
        {sidebarCollapsed ? (
          <ChevronLeft className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400" />
        )}
      </button>
      {/* Enhanced Top Controls */}
      <div className="relative bg-gray-800 border-b border-gray-700 px-4 py-3">
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
                  <div className={`font-mono text-lg ${currentPrice > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {currentPrice > 0 ? currentPrice.toFixed(getDecimalPlaces(selectedSymbol)) : '—'}
                  </div>
                  <div className="text-xs text-slate-500">{currentPrice > 0 ? 'Latest completed candle / live tick' : 'Waiting for market data'}</div>
                </div>
              </div>
            )}
          </div>

          {/* Center Section - Timeframes */}
          <div className="flex items-center space-x-1">
            {CHART_TIMEFRAMES.map(tf => (
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
            {/* Connection Status */}
            <div className="flex items-center space-x-2">
              {isConnected ? (
                <Wifi className="w-5 h-5 text-emerald-500" />
              ) : (
                <WifiOff className="w-5 h-5 text-red-500" />
              )}
              <div className={`w-3 h-3 rounded-full ${streaming ? 'bg-emerald-500 animate-pulse' : isConnected ? 'bg-sky-500' : 'bg-gray-400'}`}></div>
              <span className="text-sm text-gray-400">
                {streaming ? 'Streaming' : candlesLoading ? 'Loading...' : isConnected ? 'Connected' : 'Connecting...'}
              </span>
            </div>

            <button
              onClick={() => void analyzeChartWithAi()}
              disabled={chartAiLoading}
              className="flex items-center gap-1.5 rounded bg-violet-500/15 px-2.5 py-2 text-xs font-bold text-violet-300 transition-colors hover:bg-violet-500/25 disabled:opacity-50"
              title="Analyze the visible chart with AI"
            >
              <BrainCircuit className={`w-4 h-4 ${chartAiLoading ? 'animate-pulse' : ''}`} />
              {chartAiLoading ? 'Analyzing...' : 'AI Analysis'}
            </button>

            <button
              onClick={refreshAll}
              className="p-2 bg-gray-700 rounded hover:bg-gray-600 transition-colors"
              title="Refresh candles and analysis data"
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
              onClick={toggleFullscreen}
              className="p-2 bg-gray-700 rounded hover:bg-gray-600 transition-colors"
              title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>
        {showSettings && <div className="absolute right-4 top-14 z-50 w-56 rounded-xl border border-white/10 bg-[#0b1020] p-3 shadow-2xl"><div className="mb-2 text-[9px] font-black tracking-widest text-slate-500">OVERLAYS</div>{[[showHarmonics,setShowHarmonics,'Harmonics'],[showSupportResistance,setShowSupportResistance,'Support / resistance'],[showFibonacci,setShowFibonacci,'Fibonacci'],[showSetups,setShowSetups,'Possible setups'],[showSetupGuide,setShowSetupGuide,'Setup guide'],[showManualDrawings,setShowManualDrawings,'Manual drawings']].map(([checked,setChecked,label]) => <label key={String(label)} className="flex items-center justify-between py-1.5 text-xs text-slate-300"><span>{String(label)}</span><input type="checkbox" checked={Boolean(checked)} onChange={(event) => (setChecked as React.Dispatch<React.SetStateAction<boolean>>)(event.target.checked)}/></label>)}</div>}
      </div>

      {/* Manual drawing toolbar. Drawings persist independently per symbol and timeframe. */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-white/[0.08] bg-[#080d18] px-4 py-1.5">
        <button
          onClick={() => setDrawingRailCollapsed((c) => !c)}
          title={drawingRailCollapsed ? 'Expand drawing rail' : 'Collapse drawing rail'}
          className="mr-2 flex items-center gap-1 rounded-md bg-white/[0.04] px-2 py-1 text-[9px] font-black tracking-widest text-cyan-300 hover:bg-white/[0.08]"
        >
          <Pencil className="h-3 w-3" />
          {drawingRailCollapsed ? 'DRAW' : 'HIDE DRAW'}
        </button>
        {!drawingRailCollapsed && (
          <>
        <span className="mr-2 text-[9px] font-black tracking-widest text-slate-600">DRAW</span>
        {([
          ['pan', Hand, 'Pan chart'], ['select', MousePointer2, 'Select drawing'], ['trend', LineChart, 'Trend line'], ['horizontal', Minus, 'Horizontal line'],
          ['sr', Target, 'S/R level'], ['rectangle', Square, 'Rectangle / zone'], ['fib', Percent, 'Fibonacci retracement'], ['text', Type, 'Text annotation'],
        ] as const).map(([tool, Icon, label]) => <button key={tool} onClick={() => setDrawingTool(tool)} title={label} className={`rounded-md p-2 transition ${drawingTool === tool ? 'bg-cyan-400/15 text-cyan-300' : 'text-slate-500 hover:bg-white/[0.06] hover:text-slate-200'}`}><Icon className="h-4 w-4"/></button>)}
        <div className="mx-2 h-5 w-px bg-white/10"/>
        <input type="color" value={selectedDrawing?.color || drawingColor} onChange={(event) => { setDrawingColor(event.target.value); if (selectedDrawing) updateSelectedDrawing({color:event.target.value}); }} title="Drawing color" className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"/>
        <button onClick={() => selectedDrawing && updateSelectedDrawing({locked:!selectedDrawing.locked})} disabled={!selectedDrawing} title={selectedDrawing?.locked ? 'Unlock drawing' : 'Lock drawing'} className={`rounded-md p-2 disabled:opacity-25 ${selectedDrawing?.locked ? 'bg-amber-400/10 text-amber-300' : 'text-slate-500 hover:text-slate-200'}`}>{selectedDrawing?.locked ? <Lock className="h-4 w-4"/> : <Unlock className="h-4 w-4"/>}</button>
        <button onClick={duplicateSelectedDrawing} disabled={!selectedDrawing} title="Duplicate drawing" className="rounded-md p-2 text-slate-500 hover:text-slate-200 disabled:opacity-25"><Copy className="h-4 w-4"/></button>
        <button onClick={() => selectedDrawing && updateSelectedDrawing({lineStyle:selectedDrawing.lineStyle === 'dashed' ? 'solid' : 'dashed'})} disabled={!selectedDrawing || selectedDrawing.type === 'text'} title="Toggle solid / dashed" className="rounded-md px-2 py-1.5 text-[10px] font-black text-slate-500 hover:text-slate-200 disabled:opacity-25">{selectedDrawing?.lineStyle === 'dashed' ? 'DASH' : 'SOLID'}</button>
        <button onClick={() => selectedDrawing && updateSelectedDrawing({showPrice:!selectedDrawing.showPrice})} disabled={!selectedDrawing || selectedDrawing.type === 'text'} title="Toggle price labels" className={`rounded-md p-2 disabled:opacity-25 ${selectedDrawing?.showPrice ? 'text-cyan-300' : 'text-slate-500'}`}><Tag className="h-4 w-4"/></button>
        <button onClick={() => setMagnetDrawing((value)=>!value)} title="Magnet to candle OHLC" className={`rounded-md p-2 ${magnetDrawing ? 'bg-cyan-400/10 text-cyan-300' : 'text-slate-500'}`}><Magnet className="h-4 w-4"/></button>
        <button onClick={deleteSelectedDrawing} disabled={!selectedDrawingId || selectedDrawing?.locked} title="Delete selected" className="rounded-md p-2 text-slate-500 hover:bg-rose-400/10 hover:text-rose-300 disabled:opacity-25"><Trash2 className="h-4 w-4"/></button>
        <button onClick={undoDrawing} disabled={!canUndo} title="Undo" className="rounded-md p-2 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200 disabled:opacity-25"><Undo2 className="h-4 w-4"/></button>
        <button onClick={clearDrawings} disabled={!drawings.length} title="Clear drawings" className="rounded-md px-2 py-1.5 text-[10px] font-black text-slate-500 hover:bg-rose-400/10 hover:text-rose-300 disabled:opacity-25">CLEAR</button>
        <button onClick={() => setShowManualDrawings((visible) => !visible)} title="Show / hide drawings" className="ml-auto rounded-md p-2 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200">{showManualDrawings ? <Eye className="h-4 w-4"/> : <EyeOff className="h-4 w-4"/>}</button>
        <span className="text-[9px] font-bold text-slate-600">{drawings.length} · {selectedSymbol} {timeframe}</span>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 overflow-x-auto border-b border-white/[0.08] bg-[#080d18] px-4 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500">
        <span className="text-cyan-300">MARKET CONTEXT</span>
        {harmonicPatterns.length > 0 && <span className="rounded bg-emerald-400/10 px-2 py-1 text-emerald-300">{harmonicPatterns.length} harmonic</span>}
        {adrData && <span className={`rounded px-2 py-1 ${adrData.exhausted ? 'bg-rose-400/10 text-rose-300' : 'bg-sky-400/10 text-sky-300'}`}>ADR {adrData.percent_used.toFixed(0)}%</span>}
        {cryptoAnalysis && <><span className="rounded bg-violet-400/10 px-2 py-1 text-violet-300">V2 {cryptoAnalysis.total_score}/100</span><span className={cryptoAnalysis.direction === 'BUY' ? 'text-emerald-300' : cryptoAnalysis.direction === 'SELL' ? 'text-rose-300' : 'text-slate-400'}>{cryptoAnalysis.direction}</span><span>{timeframe}</span><span className="text-slate-400">{cryptoAnalysis.trade_timing?.status || 'WAIT'}</span>{cryptoAnalysis.trade_plan && <span className={`rounded px-2 py-1 ${cryptoAnalysis.trade_plan.direction === 'BUY' ? 'bg-emerald-400/10 text-emerald-300' : cryptoAnalysis.trade_plan.direction === 'SELL' ? 'bg-rose-400/10 text-rose-300' : 'bg-slate-400/10 text-slate-400'}`}>{cryptoAnalysis.trade_plan.direction === 'NEUTRAL' ? 'NO ACTIVE SETUP' : `${cryptoAnalysis.trade_plan.direction} SETUP ${cryptoAnalysis.trade_plan.eligible ? 'ELIGIBLE' : 'WAIT'}`}</span>}</>}
        <button onClick={() => setShowTechnicalControls((value) => !value)} className="ml-auto rounded bg-white/[0.06] px-2.5 py-1 text-[9px] text-slate-300 hover:bg-white/[0.1]">{showTechnicalControls ? 'Hide tools' : 'Analysis tools'}</button>
        <button onClick={() => setShowChartContext((value) => !value)} className="rounded bg-cyan-400/10 px-2.5 py-1 text-[9px] text-cyan-300 hover:bg-cyan-400/20">{showChartContext ? 'Hide details' : 'Details'}</button>
        {!showSetupGuide && <button onClick={() => setShowSetupGuide(true)} className="rounded bg-emerald-400/10 px-2.5 py-1 text-[9px] text-emerald-300 hover:bg-emerald-400/20">Guide</button>}
      </div>

      {showTechnicalControls && <div className="shrink-0 overflow-x-auto bg-gray-800 border-b border-gray-700 px-4 py-2">
        <div className="flex min-w-max items-center justify-between gap-6">
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
      </div>}

      {showChartContext && <>
      {showHarmonics && (
        <div className={`px-4 py-2 border-b text-sm ${
          harmonicPatterns.length > 0
            ? 'bg-emerald-950 border-emerald-800 text-emerald-200'
            : 'bg-gray-900 border-gray-700 text-gray-400'
        }`}>
          {harmonicPatterns.length > 0 ? (
            harmonicPatterns.map((pattern) => (
              <span key={pattern.id} className="font-medium">
                CANDIDATE · {pattern.direction.toUpperCase()} {pattern.type} on {selectedSymbol} {timeframe} · PRZ {pattern.prz.min.toFixed(2)}–{pattern.prz.max.toFixed(2)} · unvalidated geometry, X-A-B-C-D drawn below
              </span>
            ))
          ) : (
            <span>No harmonic candidate on {selectedSymbol} {timeframe}. Scanning live candles.</span>
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
        <div className="flex flex-wrap items-center gap-2 border-b border-violet-500/20 bg-[#0d1020] px-4 py-2 text-xs text-slate-400">
          <span className="rounded-md border border-violet-400/20 bg-violet-400/10 px-2 py-1 font-black tracking-wider text-violet-300">V2</span>
          <span className="rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-sm font-black text-cyan-300">{cryptoAnalysis.total_score}<span className="text-[10px] text-cyan-500">/100</span></span>
          <span className={`rounded-md border px-2 py-1 text-[9px] font-black ${cryptoAnalysis.direction === 'BUY' ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' : cryptoAnalysis.direction === 'SELL' ? 'border-rose-400/20 bg-rose-400/10 text-rose-300' : 'border-slate-400/20 bg-slate-400/10 text-slate-400'}`}>{cryptoAnalysis.direction}</span>
          {cryptoAnalysis.direction_stability && <span title={cryptoAnalysis.direction_stability.reason} className={`rounded-md border px-2 py-1 text-[9px] font-black ${cryptoAnalysis.direction_stability.lifecycle === 'READY' || cryptoAnalysis.direction_stability.lifecycle === 'CONFIRMED' ? 'border-cyan-400/20 bg-cyan-400/10 text-cyan-300' : cryptoAnalysis.direction_stability.lifecycle === 'INVALIDATED' ? 'border-rose-400/20 bg-rose-400/10 text-rose-300' : 'border-amber-400/20 bg-amber-400/10 text-amber-300'}`}>{cryptoAnalysis.direction_stability.lifecycle}{cryptoAnalysis.direction_stability.raw_direction !== cryptoAnalysis.direction_stability.confirmed_direction ? ` · RAW ${cryptoAnalysis.direction_stability.raw_direction}` : ''}</span>}
          {cryptoAnalysis.decision_quality && <>
            <span className="rounded-md border border-cyan-400/15 bg-cyan-400/[0.06] px-2 py-1 text-[9px] font-black text-cyan-200">BIAS {cryptoAnalysis.decision_quality.market_bias_confidence}%</span>
            <span className="rounded-md border border-violet-400/15 bg-violet-400/[0.06] px-2 py-1 text-[9px] font-black text-violet-200">SETUP {cryptoAnalysis.decision_quality.setup_quality}%</span>
            <span className="rounded-md border border-amber-400/15 bg-amber-400/[0.06] px-2 py-1 text-[9px] font-black text-amber-200">READY {cryptoAnalysis.decision_quality.execution_readiness}%</span>
          </>}
          <span className="rounded-md border border-white/[0.06] bg-white/[0.04] px-2 py-1 text-[10px] font-black text-slate-300">STR {cryptoAnalysis.category_breakdown.structure}/20</span>
          <span className="rounded-md border border-white/[0.06] bg-white/[0.04] px-2 py-1 text-[10px] font-black text-slate-300">VOL {cryptoAnalysis.category_breakdown.volume}/10</span>
          <span className="rounded-md border border-white/[0.06] bg-white/[0.04] px-2 py-1 text-[10px] font-black text-slate-300">MOM {cryptoAnalysis.category_breakdown.momentum}/10</span>
          <span className="rounded-md border border-white/[0.06] bg-white/[0.04] px-2 py-1 text-[10px] font-black text-slate-300">LIQ {cryptoAnalysis.category_breakdown.liquidity}/15</span>
          <span className="ml-auto rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 font-semibold uppercase text-cyan-300">{cryptoAnalysis.data_quality.primary_timeframe}</span>
          <span className="rounded-md border border-white/[0.06] bg-white/[0.04] px-2 py-1 font-semibold uppercase text-slate-300">{cryptoAnalysis.data_quality.status} data</span>
        </div>
      )}

      {cryptoAnalysis?.market_context && (
        <div className="flex items-center gap-5 border-b border-cyan-500/15 bg-[#09131b] px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          <span className="text-cyan-300">MARKET DIRECTION</span>
          <span>Month <b className={cryptoAnalysis.market_context.timeframes.mn1?.trend === 'bullish' ? 'text-emerald-300' : cryptoAnalysis.market_context.timeframes.mn1?.trend === 'bearish' ? 'text-rose-300' : 'text-slate-400'}>{cryptoAnalysis.market_context.timeframes.mn1?.trend || 'neutral'}</b></span>
          <span>Week <b className={cryptoAnalysis.market_context.timeframes.w1?.trend === 'bullish' ? 'text-emerald-300' : cryptoAnalysis.market_context.timeframes.w1?.trend === 'bearish' ? 'text-rose-300' : 'text-slate-400'}>{cryptoAnalysis.market_context.timeframes.w1?.trend || 'neutral'}</b></span>
          <span>{timeframe} <b className={cryptoAnalysis.market_context.timeframes.selected?.trend === 'bullish' ? 'text-emerald-300' : cryptoAnalysis.market_context.timeframes.selected?.trend === 'bearish' ? 'text-rose-300' : 'text-slate-400'}>{cryptoAnalysis.market_context.timeframes.selected?.trend || 'neutral'}</b></span>
          <span>Alignment <b className="text-slate-200">{cryptoAnalysis.market_context.alignment_score}%</b></span>
          <span className={`ml-auto rounded px-2 py-1 ${cryptoAnalysis.trade_timing?.status === 'READY' ? 'bg-emerald-400/10 text-emerald-300' : cryptoAnalysis.trade_timing?.status === 'AVOID' ? 'bg-rose-400/10 text-rose-300' : 'bg-amber-400/10 text-amber-300'}`}>TIMING {cryptoAnalysis.trade_timing?.status || 'WAIT'}</span>
          {(cryptoAnalysis.trade_timing?.status === 'AVOID' ? cryptoAnalysis.trade_timing.avoid_reasons?.[0] : cryptoAnalysis.trade_timing?.wait_for?.[0]) && <span className="normal-case tracking-normal text-slate-500">{cryptoAnalysis.trade_timing.status === 'AVOID' ? 'Avoid: ' : 'Wait: '}{String(cryptoAnalysis.trade_timing.status === 'AVOID' ? cryptoAnalysis.trade_timing.avoid_reasons?.[0] : cryptoAnalysis.trade_timing.wait_for[0]).replace(/_/g, ' ')}</span>}
        </div>
      )}

      {cryptoAnalysis && (
        <div className="border-b border-slate-500/15 bg-[#050a0f] px-4 py-3">
          <TradeValidationPanel analysis={cryptoAnalysis} currentPrice={currentPrice} />
        </div>
      )}

      {cryptoAnalysis?.trade_plan && <div className="flex flex-wrap items-center gap-4 border-b border-emerald-500/15 bg-[#091611] px-4 py-2 text-[11px] text-slate-300">
        <span className="font-black tracking-wider text-emerald-300">POSSIBLE SETUP</span>
        <span className={cryptoAnalysis.trade_plan.direction === 'BUY' ? 'text-emerald-300' : cryptoAnalysis.trade_plan.direction === 'SELL' ? 'text-rose-300' : 'text-slate-400'}>{cryptoAnalysis.trade_plan.direction}</span>
        {cryptoAnalysis.trade_plan.entry != null && <span>Entry {Number(cryptoAnalysis.trade_plan.entry).toLocaleString()}</span>}
        {cryptoAnalysis.trade_plan.stop != null && <span className="text-rose-300">Invalidation {Number(cryptoAnalysis.trade_plan.stop).toLocaleString()}</span>}
        {cryptoAnalysis.trade_plan.targets?.slice(0, 3).map((target) => <span key={target.label} className="text-cyan-300">{target.label} {Number(target.price).toLocaleString()}</span>)}
        <span className={`ml-auto rounded px-2 py-1 text-[9px] font-black ${cryptoAnalysis.trade_plan.eligible ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-300'}`}>{cryptoAnalysis.trade_plan.eligible ? 'ELIGIBLE' : 'WATCH / WAIT'}</span>
      </div>}

      </>}

      <ChartAiAnalysisPanel
        analysis={chartAiAnalysis}
        error={chartAiError}
        configured={chartAiConfigured}
        currentPrice={currentPrice}
        onClose={() => { setChartAiAnalysis(null); setChartAiError(null); }}
      />

      {/* Chart Area with Sidebar */}
      <div className="flex-1 min-w-0 min-h-0 overflow-hidden relative bg-gray-900 flex">
        {/* Main Chart */}
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden relative">
          <div
            ref={chartContainerRef}
            className="w-full h-full min-w-0 min-h-0 overflow-hidden"
          />
        {candleError && (
          <div className="absolute inset-x-0 top-0 z-40 flex items-center justify-between gap-3 border-b border-rose-500/30 bg-rose-950/90 px-4 py-2 text-xs text-rose-200">
            <span>Failed to load {selectedSymbol} {timeframe} candles: {candleError.message}</span>
            <button
              onClick={() => void refreshCandles(false)}
              className="shrink-0 rounded bg-rose-500/20 px-2.5 py-1 font-bold hover:bg-rose-500/30"
            >
              Retry
            </button>
          </div>
        )}
        {showSetupGuide && setupPlan && <div className="absolute right-4 top-4 z-30 w-[min(350px,calc(100%-2rem))] rounded-xl border border-white/10 bg-[#0b1020]/95 p-3 text-xs text-slate-300 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <span className="font-black tracking-widest text-cyan-300">SETUP GUIDE</span>
            <div className="flex items-center gap-2">
              <span className={`rounded px-2 py-1 text-[9px] font-black ${setupReady ? 'bg-emerald-400/15 text-emerald-300' : setupHardBlocked ? 'bg-rose-400/15 text-rose-300' : 'bg-amber-400/15 text-amber-300'}`}>{setupReady ? `${setupPlan.direction} READY` : setupHardBlocked ? 'BLOCKED' : 'WAIT'}</span>
              <button onClick={() => setShowSetupGuide(false)} className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-white/[0.08] hover:text-slate-200" aria-label="Hide setup guide">×</button>
            </div>
          </div>
          {setupPlan.direction !== 'NEUTRAL' && setupPlan.entry != null ? <div className="mt-3 space-y-2">
            <div className="flex justify-between gap-3"><span className="text-slate-500">Possible {setupPlan.direction.toLowerCase()} area</span><b className={setupPlan.direction === 'BUY' ? 'text-emerald-300' : 'text-rose-300'}>{setupPrice(setupPlan.entry)}</b></div>
            <div className="flex justify-between gap-3"><span className="text-slate-500">Invalid if price reaches</span><b className="text-rose-300">{setupPrice(setupPlan.stop ?? setupPlan.invalidation)}</b></div>
            <div className="flex justify-between gap-3"><span className="text-slate-500">Targets</span><b className="text-cyan-300">{setupPlan.targets?.slice(0, 3).map((target) => setupPrice(target.price)).join(' · ') || 'Waiting'}</b></div>
          </div> : (() => {
            const belowThreshold = planGating.v2Score < 60;
            const calendarBlocked = setupHardBlocked;
            const timingWait = planGating.timingStatus !== 'READY';
            // Only show zones that the backend marked as actionable. When none
            // qualify, the panel truthfully shows "no reference areas".
            const displayZones = setupReady
              ? setupZones.filter((zone) => zone.actionable !== false)
              : [];
            const isReferenceMode = displayZones.length > 0 && !setupReady;
            return (
              <div className="mt-3 space-y-2">
                <p className="font-semibold text-slate-200">NO ACTIVE SETUP</p>
                {belowThreshold && <p className="text-[10px] leading-relaxed text-rose-300">V2 score is {planGating.v2Score}/100 — below the 60 threshold. Zones are not actionable until score clears.</p>}
                {calendarBlocked && <p className="text-[10px] leading-relaxed text-rose-300">Economic calendar gate is BLOCKED. No new entries until the gate clears.</p>}
                {timingWait && !belowThreshold && !calendarBlocked && <p className="text-[10px] leading-relaxed text-amber-300">Timing is WAIT — waiting on a confirming candle, volume, ADR, and V2 direction.</p>}
                {displayZones.length === 0 && !belowThreshold && !calendarBlocked && !timingWait && <p className="text-[10px] leading-relaxed text-slate-500">No qualifying zones on this timeframe yet.</p>}
                {displayZones.map((zone) => {
                  const actionable = zone.actionable !== false;
                  const conflicting = zone.conflicting_with_harmonic === true;
                  const scoreLabel = actionable && zone.score != null ? <small className="text-slate-500"> {zone.score}/100</small> : null;
                  const labelClass = actionable
                    ? (zone.direction === 'BUY' ? 'text-emerald-300' : 'text-rose-300')
                    : 'text-slate-500';
                  const prefix = actionable
                    ? `${zone.direction} only if price returns here`
                    : (conflicting ? 'Harmonic conflict — wait for confirmation' : 'Reference area — not actionable');
                  return (
                    <div key={`${zone.direction}-${zone.center}`} className="flex justify-between gap-3">
                      <span className={labelClass}>{prefix}{scoreLabel}</span>
                      <b className={actionable ? 'text-slate-200' : 'text-slate-500'}>{setupPrice(zone.low)} – {setupPrice(zone.high)}</b>
                    </div>
                  );
                })}
                {(displayZones[0]?.reasons?.length ?? 0) > 0 && <p className="text-[10px] leading-relaxed text-slate-500">Why: {displayZones[0].reasons!.slice(0, 3).join(' · ')}</p>}
                {!isReferenceMode && (belowThreshold || calendarBlocked || timingWait) && <p className="text-[10px] leading-relaxed text-slate-500">Then wait for a confirming candle, volume, ADR, and V2 direction.</p>}
              </div>
            );
          })()}

          <p className="mt-3 border-t border-white/[0.08] pt-2 text-[10px] leading-relaxed text-slate-500">{setupReady ? 'Deterministic gates are clear. Confirm the trigger before acting.' : setupHardBlocked ? 'Calendar gate is blocking this setup.' : `Wait for ${(cryptoAnalysis?.trade_timing?.wait_for || ['confirmation']).slice(0, 2).join(' and ').replace(/_/g, ' ')}.`}</p>
        </div>}
        {showManualDrawings && <svg data-revision={drawingRevision} className="absolute inset-0 z-20 h-full w-full" style={{ pointerEvents: drawingTool === 'pan' ? 'none' : 'auto', cursor: drawingTool === 'select' ? 'default' : drawingTool === 'pan' ? 'grab' : 'crosshair' }} onPointerDown={handleDrawingPointerDown} onPointerMove={handleDrawingPointerMove} onPointerUp={handleDrawingPointerUp}>
          {[...drawings, ...(draftDrawing ? [draftDrawing] : [])].map((drawing) => {
            const points = drawingCoordinates(drawing); if (!points.length || points.some((point) => point.x == null || point.y == null)) return null;
            const selected = drawing.id === selectedDrawingId; const stroke = selected ? CHART_COLORS.drawingSelected : drawing.color || '#e2e8f0'; const dash = drawing.lineStyle === 'dashed' ? '7 4' : undefined;
            const select = (event: React.PointerEvent<SVGElement>) => { event.stopPropagation(); if (drawingTool === 'select') setSelectedDrawingId(drawing.id); };
            const anchors = selected && !drawing.locked ? points.map((point,index)=><circle key={`anchor-${index}`} cx={point.x!} cy={point.y!} r="5" fill="#0b1020" stroke={CHART_COLORS.drawingSelected} strokeWidth="2" style={{pointerEvents:'all',cursor:'move'}} onPointerDown={(event)=>handleAnchorPointerDown(event,drawing)} onPointerMove={(event)=>handleAnchorPointerMove(event,drawing.id,index)} onPointerUp={handleAnchorPointerUp}/>) : null;
            if (drawing.type === 'horizontal' || drawing.type === 'sr') return <g key={drawing.id}><line x1="0" x2="100%" y1={points[0].y!} y2={points[0].y!} stroke="transparent" strokeWidth="14" onPointerDown={select} style={{pointerEvents:'stroke'}}/><line x1="0" x2="100%" y1={points[0].y!} y2={points[0].y!} stroke={stroke} strokeWidth={selected ? 2 : 1.5} strokeDasharray={dash}/>{drawing.showPrice !== false && <text x="8" y={points[0].y!-5} fill={stroke} fontSize="10">{drawing.locked ? 'LOCK ' : ''}{drawing.type === 'sr' ? 'S/R' : 'H'} {drawing.points[0].price.toFixed(2)}</text>}{anchors}</g>;
            if (drawing.type === 'text') return <g key={drawing.id}>{<text x={points[0].x!} y={points[0].y!} fill={stroke} fontSize="12" fontWeight="700" onPointerDown={select} onDoubleClick={() => { if (!drawing.locked) { const text=window.prompt('Edit annotation',drawing.text || ''); if (text?.trim()) saveDrawingChange(drawings.map((item)=>item.id===drawing.id?{...item,text:text.trim()}:item)); } }} style={{ pointerEvents: 'all' }}>{drawing.text}</text>}{anchors}</g>;
            if (points.length < 2) return null;
            if (drawing.type === 'trend') return <g key={drawing.id}><line x1={points[0].x!} y1={points[0].y!} x2={points[1].x!} y2={points[1].y!} stroke="transparent" strokeWidth="14" onPointerDown={select} style={{pointerEvents:'stroke'}}/><line x1={points[0].x!} y1={points[0].y!} x2={points[1].x!} y2={points[1].y!} stroke={stroke} strokeWidth={selected ? 2.5 : 1.7} strokeDasharray={dash} onPointerDown={select} style={{ pointerEvents: 'stroke' }}/>{drawing.showPrice && <text x={points[1].x!+5} y={points[1].y!-5} fill={stroke} fontSize="9">{drawing.points[1].price.toFixed(2)}</text>}{anchors}</g>;
            if (drawing.type === 'rectangle') { const x=Math.min(points[0].x!,points[1].x!), y=Math.min(points[0].y!,points[1].y!), width=Math.abs(points[1].x!-points[0].x!), height=Math.abs(points[1].y!-points[0].y!); return <g key={drawing.id}><rect x={x} y={y} width={width} height={height} fill={`${stroke}18`} stroke={stroke} strokeDasharray={dash} strokeWidth={selected ? 2 : 1.5} onPointerDown={select} style={{ pointerEvents: 'all' }}/>{drawing.showPrice && <text x={x+4} y={y+12} fill={stroke} fontSize="9">{Math.min(...drawing.points.map((point)=>point.price)).toFixed(2)}–{Math.max(...drawing.points.map((point)=>point.price)).toFixed(2)}</text>}{anchors}</g>; }
            if (drawing.type === 'fib') { const ratios=[0,.236,.382,.5,.618,.786,1,1.272,1.618]; const ax=Math.min(points[0].x!,points[1].x!), bx=Math.max(points[0].x!,points[1].x!); return <g key={drawing.id} onPointerDown={select} style={{ pointerEvents: 'stroke' }}><rect x={ax} y={Math.min(points[0].y!,points[1].y!)} width={Math.max(0,bx-ax)} height={Math.max(0,Math.abs(points[1].y!-points[0].y!))} fill={`${stroke}0f`} stroke="none" style={{ pointerEvents: 'none' }}/>{ratios.map((ratio) => { const y=points[0].y!+(points[1].y!-points[0].y!)*ratio; const price=drawing.points[0].price+(drawing.points[1].price-drawing.points[0].price)*ratio; const golden=String(ratio)==='0.618'; const color=golden?CHART_COLORS.fibGolden:stroke; return <g key={ratio}><line x1="0" x2="100%" y1={y} y2={y} stroke="transparent" strokeWidth="14" style={{ pointerEvents: 'stroke' }}/><line x1="0" x2="100%" y1={y} y2={y} stroke={color} strokeWidth={selected ? 2 : 1} strokeDasharray={dash || '4 3'} style={{ pointerEvents: 'none' }}/>{drawing.showPrice !== false && <text x="100%" dx={-6} y={y+3} textAnchor="end" fill={color} fontSize="9" style={{ pointerEvents: 'none' }}>{ratio} · {price.toFixed(2)}</text>}</g>; })}<line x1={points[0].x!} y1={points[0].y!} x2={points[1].x!} y2={points[1].y!} stroke={stroke} strokeWidth={selected ? 2 : 1.4} strokeDasharray="2 3" style={{ pointerEvents: 'none' }}/>{anchors}</g>; }
            return null;
          })}
        </svg>}

        {/* Pattern Info Overlay */}
        {(harmonicPatterns.length > 0 || trendLines.length > 0) && (
          <div className="absolute top-4 left-4 bg-gray-800 bg-opacity-90 rounded-lg p-4 max-w-sm">
            <h4 className="text-white font-semibold mb-2 flex items-center">
              <BarChart3 className="w-4 h-4 mr-2" />
              Technical Analysis
            </h4>

            {harmonicPatterns.map((pattern) => (
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

            {trendLines.map((line) => (
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

        {/* Right Sidebar - Tabbed Panel */}
        {!sidebarCollapsed && (
          <div className="flex flex-col w-80 bg-[#0a0e1a] border-l border-white/[0.08] overflow-hidden">
            {/* Tabs */}
            <div className="flex items-center border-b border-white/[0.08] bg-gray-900">
              <button
                onClick={() => setActiveTab('setup')}
                className={`flex-1 px-4 py-3 text-xs font-bold tracking-wide transition-colors ${
                  activeTab === 'setup'
                    ? 'text-emerald-300 border-b-2 border-emerald-500'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                SETUP
              </button>
              <button
                onClick={() => setActiveTab('examples')}
                className={`flex-1 px-4 py-3 text-xs font-bold tracking-wide transition-colors ${
                  activeTab === 'examples'
                    ? 'text-cyan-300 border-b-2 border-cyan-500'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                EXAMPLES
              </button>
            </div>

            {/* Tab Content */}
            {activeTab === 'setup' && (
              <TradeSetupPanel
                analysis={cryptoAnalysis}
                currentPrice={currentPrice}
                symbol={selectedSymbol}
                timeframe={timeframe}
                isExpanded={setupPanelExpanded}
                onToggle={() => setSetupPanelExpanded(!setupPanelExpanded)}
              />
            )}
            {activeTab === 'examples' && (
              <TradeExamplesPanel
                isExpanded={examplesPanelExpanded}
                onToggle={() => setExamplesPanelExpanded(!examplesPanelExpanded)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TradingView;
