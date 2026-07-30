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
  BrainCircuit,
  Activity,
  Target,
  Zap,
  RefreshCw,
  LineChart,
  CandlestickChart,
  BarChart2,
  Link,
  Link2Off,
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
  Hand
} from 'lucide-react';
import { liveDataService, HarmonicPattern, TrendLine, FibonacciLevel } from '../services/liveDataService';
import { tradeLockerService, TradeLockerConfig } from '../services/tradeLockerService';
import { tradeLockerApi } from '../services/apiService';
import ConfluenceXLogo from '../components/ConfluenceXLogo';
import { bwtsApi, type ChartAiAnalysis, type CryptoAnalysis } from '../services/bwtsApi';

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
type DrawingTool = 'pan' | 'select' | 'trend' | 'horizontal' | 'sr' | 'rectangle' | 'fib' | 'text';
type DrawingPoint = { time: number; price: number };
type ManualDrawing = { id: string; type: Exclude<DrawingTool, 'select' | 'pan'>; points: DrawingPoint[]; text?: string; color?: string; locked?: boolean; lineStyle?: 'solid' | 'dashed'; showPrice?: boolean };

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

const TradingView: React.FC = () => {
  const workspaceRef = useRef<HTMLDivElement>(null);
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
  const trendSeriesRefs = useRef<ISeriesApi<'Line'>[]>([]);
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
  const [showSetups, setShowSetups] = useState(true);
  const [showSetupGuide, setShowSetupGuide] = useState(true);
  const [cryptoAnalysis, setCryptoAnalysis] = useState<CryptoAnalysis | null>(null);
  const [chartAiAnalysis, setChartAiAnalysis] = useState<ChartAiAnalysis | null>(null);
  const [chartAiConfigured, setChartAiConfigured] = useState<boolean | null>(null);
  const [chartAiLoading, setChartAiLoading] = useState(false);
  const [chartAiError, setChartAiError] = useState<string | null>(null);
  const [drawingTool, setDrawingTool] = useState<DrawingTool>('pan');
  const [drawings, setDrawings] = useState<ManualDrawing[]>([]);
  const [draftDrawing, setDraftDrawing] = useState<ManualDrawing | null>(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [showManualDrawings, setShowManualDrawings] = useState(true);
  const [showChartContext, setShowChartContext] = useState(false);
  const [showTechnicalControls, setShowTechnicalControls] = useState(false);
  const [drawingRevision, setDrawingRevision] = useState(0);
  const [drawingColor, setDrawingColor] = useState('#22d3ee');
  const [magnetDrawing, setMagnetDrawing] = useState(true);
  const drawingUndoRef = useRef<ManualDrawing[][]>([]);
  const drawingStorageKeyRef = useRef('');

  useEffect(() => {
    const assetType = availableSymbols.find((symbol) => symbol.symbol === selectedSymbol)?.type;
    // V2 analysis runs server-side for any asset class via the same
    // /api/analysis endpoint (MultiSourceClient routes FX/gold to Twelve
    // Data). Show it for crypto, forex and commodities — not just crypto.
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

  const drawingKey = `confluencex:drawings:${selectedSymbol}:${timeframe}`;
  useEffect(() => {
    drawingStorageKeyRef.current = drawingKey;
    try { setDrawings(JSON.parse(localStorage.getItem(drawingKey) || '[]')); } catch { setDrawings([]); }
    setDraftDrawing(null); setSelectedDrawingId(null); drawingUndoRef.current = [];
  }, [drawingKey]);
  useEffect(() => {
    if (drawingStorageKeyRef.current === drawingKey) localStorage.setItem(drawingKey, JSON.stringify(drawings));
  }, [drawings, drawingKey]);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const redraw = () => setDrawingRevision((value) => value + 1);
    chart.timeScale().subscribeVisibleTimeRangeChange(redraw);
    return () => chart.timeScale().unsubscribeVisibleTimeRangeChange(redraw);
  }, [chartRevision]);

  const saveDrawingChange = useCallback((next: ManualDrawing[]) => {
    drawingUndoRef.current.push(drawings);
    if (drawingUndoRef.current.length > 40) drawingUndoRef.current.shift();
    setDrawings(next);
  }, [drawings]);
  const drawingPointFromClient = useCallback((clientX: number, clientY: number): DrawingPoint | null => {
    const chart = chartRef.current; const series = candlestickSeriesRef.current || mainSeriesRef.current; const container = chartContainerRef.current;
    if (!chart || !series || !container) return null;
    const rect = container.getBoundingClientRect();
    const time = chart.timeScale().coordinateToTime(clientX-rect.left);
    const price = series.coordinateToPrice(clientY-rect.top);
    if (time == null || price == null || typeof time !== 'number') return null;
    let point = { time: Number(time), price: Number(price) };
    if (magnetDrawing) {
      const candles = candleCacheRef.current[`${selectedSymbol}:${timeframe}`] || [];
      const candle = candles.reduce<CandlestickData | null>((nearest, item) => !nearest || Math.abs(Number(item.time)-point.time) < Math.abs(Number(nearest.time)-point.time) ? item : nearest, null);
      if (candle) { const prices=[candle.open,candle.high,candle.low,candle.close]; point={time:Number(candle.time),price:prices.reduce((nearest,value)=>Math.abs(value-point.price)<Math.abs(nearest-point.price)?value:nearest,prices[0])}; }
    }
    return point;
  }, [magnetDrawing, selectedSymbol, timeframe]);
  const drawingPointFromEvent = useCallback((event: React.PointerEvent<SVGSVGElement>) => drawingPointFromClient(event.clientX,event.clientY), [drawingPointFromClient]);
  const handleDrawingPointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (drawingTool === 'select' || drawingTool === 'pan') return;
    const point = drawingPointFromEvent(event); if (!point) return;
    if (drawingTool === 'horizontal' || drawingTool === 'sr') {
      saveDrawingChange([...drawings, { id: crypto.randomUUID(), type: drawingTool, points: [point], color: drawingColor, lineStyle: drawingTool === 'sr' ? 'dashed' : 'solid', showPrice: true }]);
      return;
    }
    if (drawingTool === 'text') {
      const text = window.prompt('Annotation text');
      if (text?.trim()) saveDrawingChange([...drawings, { id: crypto.randomUUID(), type: 'text', points: [point], text: text.trim(), color: drawingColor, showPrice: false }]);
      return;
    }
    setDraftDrawing({ id: crypto.randomUUID(), type: drawingTool, points: [point, point], color: drawingColor, lineStyle: drawingTool === 'fib' ? 'dashed' : 'solid', showPrice: true });
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [drawingTool, drawingPointFromEvent, drawings, saveDrawingChange, drawingColor]);
  const handleDrawingPointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!draftDrawing) return; const point = drawingPointFromEvent(event); if (!point) return;
    setDraftDrawing({ ...draftDrawing, points: [draftDrawing.points[0], point] });
  }, [draftDrawing, drawingPointFromEvent]);
  const handleDrawingPointerUp = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!draftDrawing) return; const point = drawingPointFromEvent(event) || draftDrawing.points[1];
    const next = { ...draftDrawing, points: [draftDrawing.points[0], point] };
    if (Math.abs(next.points[0].time-next.points[1].time) > 0 || Math.abs(next.points[0].price-next.points[1].price) > 0) saveDrawingChange([...drawings, next]);
    setDraftDrawing(null);
  }, [draftDrawing, drawingPointFromEvent, drawings, saveDrawingChange]);
  const undoDrawing = () => { const previous = drawingUndoRef.current.pop(); if (previous) { setDrawings(previous); setSelectedDrawingId(null); } };
  const selectedDrawing = drawings.find((drawing) => drawing.id === selectedDrawingId) || null;
  const updateSelectedDrawing = (changes: Partial<ManualDrawing>) => { if (!selectedDrawingId) return; saveDrawingChange(drawings.map((drawing) => drawing.id === selectedDrawingId ? { ...drawing, ...changes } : drawing)); };
  const deleteSelectedDrawing = () => { if (selectedDrawingId && !selectedDrawing?.locked) { saveDrawingChange(drawings.filter((drawing) => drawing.id !== selectedDrawingId)); setSelectedDrawingId(null); } };
  const duplicateSelectedDrawing = () => { if (!selectedDrawing) return; const seconds={ '1m':60,'5m':300,'15m':900,'30m':1800,'1h':3600,'4h':14400,'1d':86400,'1w':604800 }[timeframe] || 3600; const priceShift=Number(cryptoAnalysis?.indicators?.atr || currentPrice*.002); const copy={...selectedDrawing,id:crypto.randomUUID(),locked:false,points:selectedDrawing.points.map((point)=>({time:point.time+seconds*5,price:point.price+priceShift*.2}))}; saveDrawingChange([...drawings,copy]); setSelectedDrawingId(copy.id); };
  const handleAnchorPointerDown = (event: React.PointerEvent<SVGCircleElement>, drawing: ManualDrawing) => { event.stopPropagation(); if (drawing.locked) return; drawingUndoRef.current.push(drawings); event.currentTarget.setPointerCapture(event.pointerId); };
  const handleAnchorPointerMove = (event: React.PointerEvent<SVGCircleElement>, drawingId: string, pointIndex: number) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const point=drawingPointFromClient(event.clientX,event.clientY); if (!point) return; setDrawings((current)=>current.map((drawing)=>drawing.id===drawingId?{...drawing,points:drawing.points.map((existing,index)=>index===pointIndex?point:existing)}:drawing)); };
  const handleAnchorPointerUp = (event: React.PointerEvent<SVGCircleElement>) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); };
  const clearDrawings = () => { if (drawings.length && window.confirm('Clear drawings for this symbol and timeframe?')) { saveDrawingChange([]); setSelectedDrawingId(null); } };
  const drawingCoordinates = (drawing: ManualDrawing) => { const series = candlestickSeriesRef.current || mainSeriesRef.current; return drawing.points.map((point) => ({ x: chartRef.current?.timeScale().timeToCoordinate(point.time as UTCTimestamp) ?? null, y: series?.priceToCoordinate(point.price) ?? null })); };

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

      // Keep the user's current zoom and pan. Pattern overlays must never
      // force the visible range when scans refresh.
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
    const chart = chartRef.current;
    if (!chart) return;
    for (const series of trendSeriesRefs.current) {
      try { chart.removeSeries(series); } catch { /* chart was rebuilt */ }
    }
    trendSeriesRefs.current = [];
    if (!showTrendLines) return;

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
          trendSeriesRefs.current.push(trendSeries);
        } catch (error) {
          console.warn('Failed to draw trendline:', error);
        }
      }
    });
  }, [trendLines, showTrendLines, chartRevision]);

  // Draw V2 Fibonacci plus support/resistance from the same analysis used by the dashboard.
  // Only shows the STRONGEST zones close to current price to avoid clutter.
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
      const detailed = cryptoAnalysis.zones.support_resistance || [];
      if (detailed.length) {
        // Sort by strength first (strong first), then by distance (closest first)
        // Show only top 2 of each type that are within 5*ATR of current price
        const atrForFilter = Number(cryptoAnalysis.indicators.atr || 0) * 5;
        ['support', 'resistance'].forEach((type) => {
          const zonesOfType = detailed
            .filter((zone: any) => zone.type === type)
            .filter((zone: any) => !atrForFilter || Math.abs(Number(zone.level) - currentPrice) <= atrForFilter)
            .sort((a: any, b: any) => {
              const strengthOrder = { strong: 0, moderate: 1, weak: 2 };
              const aStr = strengthOrder[a.strength as keyof typeof strengthOrder] ?? 2;
              const bStr = strengthOrder[b.strength as keyof typeof strengthOrder] ?? 2;
              if (aStr !== bStr) return aStr - bStr;
              return (a.distance_atr || 99) - (b.distance_atr || 99);
            })
            .slice(0, 2);
          zonesOfType.forEach((zone: any, index: number) => {
            const emoji = zone.strength === 'strong' ? '◆' : '◇';
            levels.push({
              title: `${type === 'support' ? 'S' : 'R'}${index + 1} ${emoji} ${zone.touches}×`,
              value: Number(zone.level),
              color: type === 'support' ? '#22c55e' : '#f43f5e',
              style: zone.strength === 'strong' ? LineStyle.Solid : LineStyle.Dashed
            });
          });
        });
      } else {
        // Fallback: only show zones within 3*ATR of current price
        const atrForFilter = Number(cryptoAnalysis.indicators.atr || 0) * 3;
        (cryptoAnalysis.zones.support || [])
          .filter((value: number) => !atrForFilter || Math.abs(value - currentPrice) <= atrForFilter)
          .slice(0, 2)
          .forEach((value: number, index: number) => levels.push({ title: `S${index + 1}`, value, color: '#22c55e', style: LineStyle.Dashed }));
        (cryptoAnalysis.zones.resistance || [])
          .filter((value: number) => !atrForFilter || Math.abs(value - currentPrice) <= atrForFilter)
          .slice(0, 2)
          .forEach((value: number, index: number) => levels.push({ title: `R${index + 1}`, value, color: '#f43f5e', style: LineStyle.Dashed }));
      }
    }
    if (showFibonacci) {
      const fibData = cryptoAnalysis.zones.fibonacci || {};
      const confluenceRatios = new Set((fibData.sr_confluence || []).map((item: any) => String(item.ratio)));
      const atrDistance = Number(cryptoAnalysis.indicators.atr || 0) * 4; // Tighter filter than before

      // Only show KEY fibonacci levels: 0.382, 0.5, 0.618, 0.65, 0.786
      const keyRatios = ['0.382', '0.5', '0.618', '0.65', '0.786'];
      Object.entries(fibData.levels || {})
        .filter(([ratio]) => keyRatios.includes(String(ratio)))
        .filter(([, value]) => !atrDistance || Math.abs(Number(value) - currentPrice) <= atrDistance)
        .forEach(([ratio, value]) => {
          levels.push({
            title: `Fib ${ratio}${confluenceRatios.has(ratio) ? ' ★' : ''}`,
            value: Number(value),
            color: ['0.618', '0.65'].includes(ratio) ? '#c084fc' : confluenceRatios.has(ratio) ? '#22d3ee' : '#6366f1',
            style: LineStyle.Dotted
          });
        });
    }

    levels.filter((level) => Number.isFinite(level.value)).forEach((level) => {
      const showAxisLabel = /^[SR]\d/.test(level.title) || level.title.startsWith('Fib 0.618') || level.title.startsWith('Fib 0.65');
      const series = chart.addSeries(LineSeries, { color: level.color, lineWidth: 1, lineStyle: level.style, title: level.title, lastValueVisible: showAxisLabel, priceLineVisible: false });
      series.setData([{ time: start, value: level.value }, { time: end, value: level.value }]);
      v2LevelSeriesRefs.current.push(series);
    });
  }, [cryptoAnalysis, showFibonacci, showSupportResistance, chartRevision, currentPrice]);

  // Deterministic possible-setup overlay. It visualizes the BWTS trade plan,
  // but never turns a blocked or WAIT plan into an actionable signal.
  useEffect(() => {
    const chart = chartRef.current;
    const priceSeries = candlestickSeriesRef.current;
    const container = chartContainerRef.current;
    if (!chart || !priceSeries || !container) return;
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const removeOverlay = () => container.querySelector('[data-setup-overlay]')?.remove();

    const renderOverlay = () => {
      removeOverlay();
      const plan = cryptoAnalysis?.trade_plan;
      if (!showSetups || !cryptoAnalysis || !plan || plan.direction === 'NEUTRAL' || plan.entry == null) return;
      const entry = Number(plan.entry);
      if (!Number.isFinite(entry)) return;
      const atr = Number(plan.atr || cryptoAnalysis.indicators?.atr || 0);
      const halfBand = Math.max(atr > 0 ? atr * 0.2 : 0, Math.abs(entry) * 0.0005);
      const yEntryLow = priceSeries.priceToCoordinate(entry - halfBand);
      const yEntryHigh = priceSeries.priceToCoordinate(entry + halfBand);
      if (yEntryLow == null || yEntryHigh == null) return;

      const calendarStatus = String(plan.calendar_status || cryptoAnalysis.economic_calendar?.status || '').toUpperCase();
      const timingStatus = String(plan.timing_status || cryptoAnalysis.trade_timing?.status || 'WAIT').toUpperCase();
      const hardBlocked = ['BLOCKED', 'POST_NEWS', 'UNAVAILABLE'].includes(calendarStatus);
      const actionable = Boolean(plan.eligible) && timingStatus === 'READY' && !hardBlocked;
      const directionColor = plan.direction === 'BUY' ? '#22c55e' : '#ef4444';
      const statusColor = actionable ? directionColor : '#f59e0b';
      const status = actionable ? 'READY' : hardBlocked ? 'BLOCKED' : timingStatus;
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('data-setup-overlay', 'true');
      svg.setAttribute('width', String(container.clientWidth));
      svg.setAttribute('height', String(container.clientHeight));
      svg.style.position = 'absolute'; svg.style.inset = '0'; svg.style.zIndex = '11';
      svg.style.pointerEvents = 'none'; svg.style.overflow = 'visible';

      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', '0'); rect.setAttribute('y', String(Math.min(yEntryLow, yEntryHigh)));
      rect.setAttribute('width', String(container.clientWidth));
      rect.setAttribute('height', String(Math.max(8, Math.abs(yEntryLow - yEntryHigh))));
      rect.setAttribute('fill', directionColor); rect.setAttribute('fill-opacity', actionable ? '0.16' : '0.07');
      rect.setAttribute('stroke', statusColor); rect.setAttribute('stroke-width', '2');
      rect.setAttribute('stroke-dasharray', actionable ? 'none' : '7 5');
      svg.appendChild(rect);

      const addLine = (price: number | null | undefined, color: string, label: string, dash = '7 5') => {
        if (price == null || !Number.isFinite(Number(price))) return;
        const y = priceSeries.priceToCoordinate(Number(price));
        if (y == null) return;
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', '0'); line.setAttribute('x2', String(container.clientWidth));
        line.setAttribute('y1', String(y)); line.setAttribute('y2', String(y));
        line.setAttribute('stroke', color); line.setAttribute('stroke-width', '2'); line.setAttribute('stroke-dasharray', dash);
        line.setAttribute('stroke-opacity', actionable ? '0.9' : '0.55'); svg.appendChild(line);
        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('x', '10'); text.setAttribute('y', String(Math.max(14, Number(y) - 5)));
        text.setAttribute('fill', color); text.setAttribute('font-size', '11'); text.setAttribute('font-weight', '800');
        text.setAttribute('paint-order', 'stroke'); text.setAttribute('stroke', '#080d18'); text.setAttribute('stroke-width', '4');
        text.textContent = `${label} ${Number(price).toFixed(2)}`; svg.appendChild(text);
      };
      addLine(entry, statusColor, `${plan.direction} ENTRY`, 'none');
      addLine(plan.stop ?? plan.invalidation, '#fb7185', 'INVALIDATION');
      plan.targets?.slice(0, 3).forEach((target, index) => addLine(target.price, '#67e8f9', target.label || `TP${index + 1}`));

      const zoneLabel = document.createElementNS(SVG_NS, 'text');
      zoneLabel.setAttribute('x', '10'); zoneLabel.setAttribute('y', String(Math.max(16, Math.min(yEntryLow, yEntryHigh) - 8)));
      zoneLabel.setAttribute('fill', statusColor); zoneLabel.setAttribute('font-size', '12'); zoneLabel.setAttribute('font-weight', '900');
      zoneLabel.setAttribute('paint-order', 'stroke'); zoneLabel.setAttribute('stroke', '#080d18'); zoneLabel.setAttribute('stroke-width', '4');
      zoneLabel.textContent = `${plan.direction} SETUP ZONE · ${status}`; svg.appendChild(zoneLabel);
      container.appendChild(svg);
    };
    const deferredRender = () => requestAnimationFrame(renderOverlay);
    deferredRender(); chart.timeScale().subscribeVisibleTimeRangeChange(deferredRender); window.addEventListener('resize', deferredRender);
    return () => { chart.timeScale().unsubscribeVisibleTimeRangeChange(deferredRender); window.removeEventListener('resize', deferredRender); removeOverlay(); };
  }, [cryptoAnalysis, showSetups, chartRevision, currentPrice]);

  // When no directional trade plan is eligible, show conditional areas from
  // deterministic support/resistance so the chart still explains where a
  // future buy or sell setup could form.
  useEffect(() => {
    const chart = chartRef.current;
    const priceSeries = candlestickSeriesRef.current;
    const container = chartContainerRef.current;
    if (!chart || !priceSeries || !container) return;
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const removeOverlay = () => container.querySelector('[data-conditional-setup-overlay]')?.remove();
    const renderOverlay = () => {
      removeOverlay();
      const plan = cryptoAnalysis?.trade_plan;
      if (!showSetups || !cryptoAnalysis || (plan?.direction && plan.direction !== 'NEUTRAL' && plan.entry != null)) return;
      const detailed = Array.isArray(cryptoAnalysis.zones?.support_resistance) ? cryptoAnalysis.zones.support_resistance : [];
      const atr = Number(cryptoAnalysis.indicators?.atr || 0);
      const nearby = detailed
        .filter((zone: any) => ['support', 'resistance'].includes(zone.type) && Number.isFinite(Number(zone.low)) && Number.isFinite(Number(zone.high)))
        .filter((zone: any) => !atr || Math.abs(Number(zone.level) - currentPrice) <= atr * 2.5)
        .sort((a: any, b: any) => (Number(a.distance_atr) || 99) - (Number(b.distance_atr) || 99));
      const zones = ['support', 'resistance'].flatMap((type) => nearby.filter((zone: any) => zone.type === type).slice(0, 1));
      if (!zones.length) return;
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('data-conditional-setup-overlay', 'true');
      svg.setAttribute('width', String(container.clientWidth)); svg.setAttribute('height', String(container.clientHeight));
      svg.style.position = 'absolute'; svg.style.inset = '0'; svg.style.zIndex = '11'; svg.style.pointerEvents = 'none'; svg.style.overflow = 'visible';
      zones.forEach((zone: any) => {
        const bullish = zone.type === 'support';
        const color = bullish ? '#22c55e' : '#ef4444';
        const low = priceSeries.priceToCoordinate(Number(zone.low));
        const high = priceSeries.priceToCoordinate(Number(zone.high));
        if (low == null || high == null) return;
        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', '0'); rect.setAttribute('y', String(Math.min(low, high))); rect.setAttribute('width', String(container.clientWidth));
        rect.setAttribute('height', String(Math.max(10, Math.abs(low - high)))); rect.setAttribute('fill', color); rect.setAttribute('fill-opacity', '0.08');
        rect.setAttribute('stroke', color); rect.setAttribute('stroke-opacity', '0.7'); rect.setAttribute('stroke-width', '2'); rect.setAttribute('stroke-dasharray', '7 5'); svg.appendChild(rect);
        const label = document.createElementNS(SVG_NS, 'text');
        label.setAttribute('x', '10'); label.setAttribute('y', String(Math.max(16, Math.min(low, high) - 7))); label.setAttribute('fill', color); label.setAttribute('font-size', '12'); label.setAttribute('font-weight', '900');
        label.setAttribute('paint-order', 'stroke'); label.setAttribute('stroke', '#080d18'); label.setAttribute('stroke-width', '4');
        label.textContent = bullish ? 'BUY AREA' : 'SELL AREA'; svg.appendChild(label);
      });
      container.appendChild(svg);
    };
    const deferredRender = () => requestAnimationFrame(renderOverlay);
    deferredRender(); chart.timeScale().subscribeVisibleTimeRangeChange(deferredRender); window.addEventListener('resize', deferredRender);
    return () => { chart.timeScale().unsubscribeVisibleTimeRangeChange(deferredRender); window.removeEventListener('resize', deferredRender); removeOverlay(); };
  }, [cryptoAnalysis, showSetups, chartRevision, currentPrice]);

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
  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) await workspaceRef.current?.requestFullscreen();
    else await document.exitFullscreen();
    setIsFullscreen(Boolean(document.fullscreenElement));
  };

  const analyzeChartWithAi = useCallback(async () => {
    const screenshot = chartRef.current?.takeScreenshot();
    const candles = (candleCacheRef.current[`${selectedSymbol}:${timeframe}`] || []).slice(-120).map((candle) => ({
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
  }, [selectedSymbol, timeframe, currentPrice, harmonicPatterns, adrData, trendLines, fibonacciLevels, drawings, cryptoAnalysis]);

  const setupPlan = cryptoAnalysis?.trade_plan;
  const setupCalendarStatus = String(setupPlan?.calendar_status || cryptoAnalysis?.economic_calendar?.status || '').toUpperCase();
  const setupTimingStatus = String(setupPlan?.timing_status || cryptoAnalysis?.trade_timing?.status || 'WAIT').toUpperCase();
  const setupHardBlocked = ['BLOCKED', 'POST_NEWS', 'UNAVAILABLE'].includes(setupCalendarStatus);
  const setupReady = Boolean(setupPlan?.eligible) && setupTimingStatus === 'READY' && !setupHardBlocked;
  const setupZones = (Array.isArray(cryptoAnalysis?.zones?.support_resistance) ? cryptoAnalysis.zones.support_resistance : [])
    .filter((zone: any) => ['support', 'resistance'].includes(zone.type) && Number.isFinite(Number(zone.low)) && Number.isFinite(Number(zone.high)))
    .filter((zone: any) => !cryptoAnalysis?.indicators?.atr || Math.abs(Number(zone.level) - currentPrice) <= Number(cryptoAnalysis.indicators.atr) * 2.5)
    .sort((a: any, b: any) => (Number(a.distance_atr) || 99) - (Number(b.distance_atr) || 99))
    .filter((zone: any, index: number, zones: any[]) => zones.findIndex((item) => item.type === zone.type) === index)
    .slice(0, 2);
  const setupPrice = (value: number | null | undefined) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div ref={workspaceRef} className="relative h-full w-full min-w-0 min-h-0 overflow-hidden bg-gray-900 text-white flex flex-col">
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

            <button
              onClick={analyzeChartWithAi}
              disabled={chartAiLoading}
              className="flex items-center space-x-2 rounded bg-violet-600 px-3 py-2 transition-colors hover:bg-violet-700 disabled:cursor-wait disabled:opacity-60"
              title="Analyze the visible chart with ConfluenceX AI"
            >
              <BrainCircuit className={`h-4 w-4 ${chartAiLoading ? 'animate-pulse' : ''}`} />
              <span>{chartAiLoading ? 'Reading chart…' : 'AI Analyze Chart'}</span>
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
        <button onClick={undoDrawing} disabled={!drawingUndoRef.current.length} title="Undo" className="rounded-md p-2 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200 disabled:opacity-25"><Undo2 className="h-4 w-4"/></button>
        <button onClick={clearDrawings} disabled={!drawings.length} title="Clear drawings" className="rounded-md px-2 py-1.5 text-[10px] font-black text-slate-500 hover:bg-rose-400/10 hover:text-rose-300 disabled:opacity-25">CLEAR</button>
        <button onClick={() => setShowManualDrawings((visible) => !visible)} title="Show / hide drawings" className="ml-auto rounded-md p-2 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200">{showManualDrawings ? <Eye className="h-4 w-4"/> : <EyeOff className="h-4 w-4"/>}</button>
        <span className="text-[9px] font-bold text-slate-600">{drawings.length} · {selectedSymbol} {timeframe}</span>
      </div>

      <div className="flex shrink-0 items-center gap-3 overflow-x-auto border-b border-white/[0.08] bg-[#080d18] px-4 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500">
        <span className="text-cyan-300">MARKET CONTEXT</span>
        {harmonicPatterns.length > 0 && <span className="rounded bg-emerald-400/10 px-2 py-1 text-emerald-300">{harmonicPatterns.length} harmonic</span>}
        {adrData && <span className={`rounded px-2 py-1 ${adrData.exhausted ? 'bg-rose-400/10 text-rose-300' : 'bg-sky-400/10 text-sky-300'}`}>ADR {adrData.percent_used.toFixed(0)}%</span>}
        {cryptoAnalysis && <><span className="rounded bg-violet-400/10 px-2 py-1 text-violet-300">V2 {cryptoAnalysis.total_score}/100</span><span className={cryptoAnalysis.direction === 'BUY' ? 'text-emerald-300' : cryptoAnalysis.direction === 'SELL' ? 'text-rose-300' : 'text-slate-400'}>{cryptoAnalysis.direction}</span><span>{timeframe}</span><span className="text-slate-400">{cryptoAnalysis.trade_timing?.status || 'WAIT'}</span>{cryptoAnalysis.trade_plan && <span className={`rounded px-2 py-1 ${cryptoAnalysis.trade_plan.direction === 'BUY' ? 'bg-emerald-400/10 text-emerald-300' : cryptoAnalysis.trade_plan.direction === 'SELL' ? 'bg-rose-400/10 text-rose-300' : 'bg-slate-400/10 text-slate-400'}`}>{cryptoAnalysis.trade_plan.direction} SETUP {cryptoAnalysis.trade_plan.eligible ? 'ELIGIBLE' : 'WATCH'}</span>}</>}
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
          {cryptoAnalysis.direction_stability && <span title={cryptoAnalysis.direction_stability.reason} className={`rounded px-2 py-1 text-[9px] font-black ${cryptoAnalysis.direction_stability.lifecycle === 'READY' || cryptoAnalysis.direction_stability.lifecycle === 'CONFIRMED' ? 'bg-cyan-400/10 text-cyan-300' : cryptoAnalysis.direction_stability.lifecycle === 'INVALIDATED' ? 'bg-rose-400/10 text-rose-300' : 'bg-amber-400/10 text-amber-300'}`}>{cryptoAnalysis.direction_stability.lifecycle}{cryptoAnalysis.direction_stability.raw_direction !== cryptoAnalysis.direction_stability.confirmed_direction ? ` · RAW ${cryptoAnalysis.direction_stability.raw_direction}` : ''}</span>}
          <span>Structure {cryptoAnalysis.category_breakdown.structure}/20</span>
          <span>Volume {cryptoAnalysis.category_breakdown.volume}/10</span>
          <span>Momentum {cryptoAnalysis.category_breakdown.momentum}/10</span>
          <span>Liquidity {cryptoAnalysis.category_breakdown.liquidity}/15</span>
          <span className="ml-auto font-semibold uppercase text-cyan-500">{cryptoAnalysis.data_quality.primary_timeframe}</span>
          <span className="font-semibold uppercase text-slate-500">{cryptoAnalysis.data_quality.status} data</span>
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

      {cryptoAnalysis?.trade_plan && <div className="flex flex-wrap items-center gap-4 border-b border-emerald-500/15 bg-[#091611] px-4 py-2 text-[11px] text-slate-300">
        <span className="font-black tracking-wider text-emerald-300">POSSIBLE SETUP</span>
        <span className={cryptoAnalysis.trade_plan.direction === 'BUY' ? 'text-emerald-300' : cryptoAnalysis.trade_plan.direction === 'SELL' ? 'text-rose-300' : 'text-slate-400'}>{cryptoAnalysis.trade_plan.direction}</span>
        {cryptoAnalysis.trade_plan.entry != null && <span>Entry {Number(cryptoAnalysis.trade_plan.entry).toLocaleString()}</span>}
        {cryptoAnalysis.trade_plan.stop != null && <span className="text-rose-300">Invalidation {Number(cryptoAnalysis.trade_plan.stop).toLocaleString()}</span>}
        {cryptoAnalysis.trade_plan.targets?.slice(0, 3).map((target) => <span key={target.label} className="text-cyan-300">{target.label} {Number(target.price).toLocaleString()}</span>)}
        <span className={`ml-auto rounded px-2 py-1 text-[9px] font-black ${cryptoAnalysis.trade_plan.eligible ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-300'}`}>{cryptoAnalysis.trade_plan.eligible ? 'ELIGIBLE' : 'WATCH / WAIT'}</span>
      </div>}

      </>}

      {(chartAiError || chartAiAnalysis) && (
        <div className="absolute left-4 right-4 top-[160px] z-40 max-h-[min(42vh,380px)] overflow-y-auto rounded-xl border border-violet-500/20 bg-[#0d1020]/95 px-4 py-3 text-xs text-slate-300 shadow-2xl backdrop-blur">
          <div className="flex items-start gap-3">
            <BrainCircuit className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-black tracking-widest text-violet-300">AI CHART ANALYSIS</span>
                {chartAiConfigured !== null && <span className="rounded bg-white/[0.06] px-2 py-0.5 text-[9px] font-black text-slate-500">{chartAiConfigured ? 'MINIMAX VISION' : 'DETERMINISTIC FALLBACK'}</span>}
                {chartAiAnalysis && <span className="rounded bg-cyan-400/10 px-2 py-0.5 text-[9px] font-black text-cyan-300">{chartAiAnalysis.visual_bias} · {chartAiAnalysis.confidence}/100</span>}
              </div>
              {chartAiError && <p className="mt-1 text-rose-300">{chartAiError}</p>}
              {chartAiAnalysis && <>
                <p className="mt-1 max-w-5xl leading-relaxed text-slate-300">{chartAiAnalysis.summary}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {chartAiAnalysis.visible_patterns?.slice(0, 3).map((pattern) => <span key={pattern} className="rounded bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-300">{pattern}</span>)}
                  {chartAiAnalysis.key_levels?.slice(0, 4).map((level) => <span key={`${level.label}-${level.price}`} className="rounded bg-cyan-400/10 px-2 py-1 text-[10px] text-cyan-200">{level.label}: {Number(level.price).toLocaleString()}</span>)}
                  {chartAiAnalysis.conflicts?.slice(0, 2).map((conflict) => <span key={conflict} className="rounded bg-amber-400/10 px-2 py-1 text-[10px] text-amber-200">Conflict: {conflict}</span>)}
                </div>
                <div className="mt-2 grid gap-2 text-[10px] text-slate-500 md:grid-cols-3"><span><b className="text-slate-300">Wait for:</b> {chartAiAnalysis.wait_for}</span><span><b className="text-slate-300">Invalidation:</b> {chartAiAnalysis.invalidation}</span><span><b className="text-slate-300">Risk:</b> {chartAiAnalysis.risk_factors?.slice(0, 2).join(' · ') || 'No additional visual risk flagged'}</span></div>
              </>}
            </div>
            <button onClick={() => { setChartAiAnalysis(null); setChartAiError(null); }} className="rounded px-2 py-1 text-[10px] font-black text-slate-500 hover:bg-white/[0.06] hover:text-slate-200">CLOSE</button>
          </div>
        </div>
      )}

      {/* Chart Area */}
      <div className="flex-1 min-w-0 min-h-0 overflow-hidden relative bg-gray-900">
        <div
          ref={chartContainerRef}
          className="w-full h-full min-w-0 min-h-0 overflow-hidden"
        />
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
          </div> : <div className="mt-3 space-y-2">
            <p className="font-semibold text-slate-200">No confirmed buy or sell yet.</p>
            {setupZones.map((zone: any) => <div key={`${zone.type}-${zone.level}`} className="flex justify-between gap-3"><span className={zone.type === 'support' ? 'text-emerald-300' : 'text-rose-300'}>{zone.type === 'support' ? 'BUY area' : 'SELL area'}</span><b className="text-slate-200">{setupPrice(zone.low)} – {setupPrice(zone.high)}</b></div>)}
          </div>}
          <p className="mt-3 border-t border-white/[0.08] pt-2 text-[10px] leading-relaxed text-slate-500">{setupReady ? 'Deterministic gates are clear. Confirm the trigger before acting.' : setupHardBlocked ? 'Calendar gate is blocking this setup.' : `Wait for ${(cryptoAnalysis?.trade_timing?.wait_for || ['confirmation']).slice(0, 2).join(' and ').replace(/_/g, ' ')}.`}</p>
        </div>}
        {showManualDrawings && <svg data-revision={drawingRevision} className="absolute inset-0 z-20 h-full w-full" style={{ pointerEvents: drawingTool === 'pan' ? 'none' : 'auto', cursor: drawingTool === 'select' ? 'default' : drawingTool === 'pan' ? 'grab' : 'crosshair' }} onPointerDown={handleDrawingPointerDown} onPointerMove={handleDrawingPointerMove} onPointerUp={handleDrawingPointerUp}>
          {[...drawings, ...(draftDrawing ? [draftDrawing] : [])].map((drawing) => {
            const points = drawingCoordinates(drawing); if (!points.length || points.some((point) => point.x == null || point.y == null)) return null;
            const selected = drawing.id === selectedDrawingId; const stroke = selected ? '#facc15' : drawing.color || '#e2e8f0'; const dash = drawing.lineStyle === 'dashed' ? '7 4' : undefined;
            const select = (event: React.PointerEvent<SVGElement>) => { event.stopPropagation(); if (drawingTool === 'select') setSelectedDrawingId(drawing.id); };
            const anchors = selected && !drawing.locked ? points.map((point,index)=><circle key={`anchor-${index}`} cx={point.x!} cy={point.y!} r="5" fill="#0b1020" stroke="#facc15" strokeWidth="2" style={{pointerEvents:'all',cursor:'move'}} onPointerDown={(event)=>handleAnchorPointerDown(event,drawing)} onPointerMove={(event)=>handleAnchorPointerMove(event,drawing.id,index)} onPointerUp={handleAnchorPointerUp}/>) : null;
            if (drawing.type === 'horizontal' || drawing.type === 'sr') return <g key={drawing.id}><line x1="0" x2="100%" y1={points[0].y!} y2={points[0].y!} stroke="transparent" strokeWidth="14" onPointerDown={select} style={{pointerEvents:'stroke'}}/><line x1="0" x2="100%" y1={points[0].y!} y2={points[0].y!} stroke={stroke} strokeWidth={selected ? 2 : 1.5} strokeDasharray={dash}/>{drawing.showPrice !== false && <text x="8" y={points[0].y!-5} fill={stroke} fontSize="10">{drawing.locked ? 'LOCK ' : ''}{drawing.type === 'sr' ? 'S/R' : 'H'} {drawing.points[0].price.toFixed(2)}</text>}{anchors}</g>;
            if (drawing.type === 'text') return <g key={drawing.id}>{<text x={points[0].x!} y={points[0].y!} fill={stroke} fontSize="12" fontWeight="700" onPointerDown={select} onDoubleClick={() => { if (!drawing.locked) { const text=window.prompt('Edit annotation',drawing.text || ''); if (text?.trim()) saveDrawingChange(drawings.map((item)=>item.id===drawing.id?{...item,text:text.trim()}:item)); } }} style={{ pointerEvents: 'all' }}>{drawing.text}</text>}{anchors}</g>;
            if (points.length < 2) return null;
            if (drawing.type === 'trend') return <g key={drawing.id}><line x1={points[0].x!} y1={points[0].y!} x2={points[1].x!} y2={points[1].y!} stroke="transparent" strokeWidth="14" onPointerDown={select} style={{pointerEvents:'stroke'}}/><line x1={points[0].x!} y1={points[0].y!} x2={points[1].x!} y2={points[1].y!} stroke={stroke} strokeWidth={selected ? 2.5 : 1.7} strokeDasharray={dash} onPointerDown={select} style={{ pointerEvents: 'stroke' }}/>{drawing.showPrice && <text x={points[1].x!+5} y={points[1].y!-5} fill={stroke} fontSize="9">{drawing.points[1].price.toFixed(2)}</text>}{anchors}</g>;
            if (drawing.type === 'rectangle') { const x=Math.min(points[0].x!,points[1].x!), y=Math.min(points[0].y!,points[1].y!), width=Math.abs(points[1].x!-points[0].x!), height=Math.abs(points[1].y!-points[0].y!); return <g key={drawing.id}><rect x={x} y={y} width={width} height={height} fill={`${stroke}18`} stroke={stroke} strokeDasharray={dash} strokeWidth={selected ? 2 : 1.5} onPointerDown={select} style={{ pointerEvents: 'all' }}/>{drawing.showPrice && <text x={x+4} y={y+12} fill={stroke} fontSize="9">{Math.min(...drawing.points.map((point)=>point.price)).toFixed(2)}–{Math.max(...drawing.points.map((point)=>point.price)).toFixed(2)}</text>}{anchors}</g>; }
            if (drawing.type === 'fib') { const ratios=[0,.236,.382,.5,.618,.65,.786,1,1.272,1.618]; const ax=Math.min(points[0].x!,points[1].x!), bx=Math.max(points[0].x!,points[1].x!); return <g key={drawing.id} onPointerDown={select} style={{ pointerEvents: 'stroke' }}><rect x={ax} y={Math.min(points[0].y!,points[1].y!)} width={Math.max(0,bx-ax)} height={Math.max(0,Math.abs(points[1].y!-points[0].y!))} fill={`${stroke}0f`} stroke="none" style={{ pointerEvents: 'none' }}/>{ratios.map((ratio) => { const y=points[0].y!+(points[1].y!-points[0].y!)*ratio; const price=drawing.points[0].price+(drawing.points[1].price-drawing.points[0].price)*ratio; const golden=['0.618','0.65'].includes(String(ratio)); const color=golden?'#c084fc':stroke; return <g key={ratio}><line x1="0" x2="100%" y1={y} y2={y} stroke="transparent" strokeWidth="14" style={{ pointerEvents: 'stroke' }}/><line x1="0" x2="100%" y1={y} y2={y} stroke={color} strokeWidth={selected ? 2 : 1} strokeDasharray={dash || '4 3'} style={{ pointerEvents: 'none' }}/>{drawing.showPrice !== false && <text x="100%" dx={-6} y={y+3} textAnchor="end" fill={color} fontSize="9" style={{ pointerEvents: 'none' }}>{ratio} · {price.toFixed(2)}</text>}</g>; })}<line x1={points[0].x!} y1={points[0].y!} x2={points[1].x!} y2={points[1].y!} stroke={stroke} strokeWidth={selected ? 2 : 1.4} strokeDasharray="2 3" style={{ pointerEvents: 'none' }}/>{anchors}</g>; }
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
