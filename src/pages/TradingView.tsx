import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, LineStyle, UTCTimestamp, CandlestickSeries, LineSeries } from 'lightweight-charts';
import { 
  TrendingUp, 
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

const TradingView: React.FC = () => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const volumeContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const volumeChartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | ISeriesApi<'Area'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const chartInitialized = useRef<boolean>(false);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const [chartType, setChartType] = useState<ChartType>('candlestick');
  const [showVolume, setShowVolume] = useState(true);
  
  // State management
  const [selectedSymbol, setSelectedSymbol] = useState('EURUSD');
  const [timeframe, setTimeframe] = useState('1h');
  const [currentPrice, setCurrentPrice] = useState(1.12031);
  const [isConnected, setIsConnected] = useState(false);
  const [isLive, setIsLive] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [symbolSuggestions, setSymbolSuggestions] = useState<SymbolInfo[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [availableSymbols, setAvailableSymbols] = useState<SymbolInfo[]>([]);
  const [selectedBroker, setSelectedBroker] = useState('polygon');
  
  // Technical analysis data
  const [harmonicPatterns, setHarmonicPatterns] = useState<HarmonicPattern[]>([]);
  const [trendLines, setTrendLines] = useState<TrendLine[]>([]);
  const [fibonacciLevels, setFibonacciLevels] = useState<FibonacciLevel[]>([]);
  const [showHarmonics, setShowHarmonics] = useState(true);
  const [showTrendLines, setShowTrendLines] = useState(true);
  const [showFibonacci, setShowFibonacci] = useState(false);

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

  const fetchTradeLockerCandles = useCallback(async (symbol: string, tf: string): Promise<CandlestickData[]> => {
    const sessionId = localStorage.getItem('tl_session_id');
    const params = new URLSearchParams({
      symbol,
      timeframe: tf,
      count: '250',
      ...(sessionId ? { sessionId } : {}),
    });
    const response = await fetch(`/api/tradelocker/history?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch history: ${response.status}`);
    }
    const payload = await response.json();
    const rawCandles: Array<TradeLockerHistoryCandle | (number | string)[]> = Array.isArray(payload)
      ? payload
      : (payload?.d || payload?.candles || payload?.history || []);
    return rawCandles
      .map(normalizeHistoryCandle)
      .filter((candle): candle is CandlestickData => candle !== null)
      .sort((a, b) => a.time - b.time);
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
      
      // Load harmonic patterns
      if (showHarmonics) {
        const patterns = await liveDataService.detectHarmonicPatterns(symbol);
        setHarmonicPatterns(patterns);
        console.log(`📊 Loaded ${patterns.length} harmonic patterns`);
      }

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

  const loadCandlesForSymbol = useCallback(async (symbol: string, tf: string) => {
    if (!candlestickSeriesRef.current) return;
    try {
      const candles = await fetchTradeLockerCandles(symbol, tf);
      candlestickSeriesRef.current.setData(candles);
      if (candles.length > 0) {
        setCurrentPrice(candles[candles.length - 1].close);
        setIsConnected(true);
      }
    } catch (error) {
      console.error('Failed to load TradeLocker candles:', error);
      setIsConnected(false);
      candlestickSeriesRef.current.setData([]);
    }
  }, [fetchTradeLockerCandles]);

  const loadTradeLockerInstruments = useCallback(async () => {
    try {
      const sessionId = localStorage.getItem('tl_session_id');
      const params = new URLSearchParams(sessionId ? { sessionId } : {});
      const response = await fetch(`/api/tradelocker/instruments?${params.toString()}`);
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
          background: { type: ColorType.Solid, color: '#1a1a1a' },
          textColor: '#d1d5db',
        },
        grid: {
          vertLines: { color: '#374151' },
          horzLines: { color: '#374151' },
        },
        crosshair: { mode: 1 },
        rightPriceScale: {
          borderColor: '#485563',
        },
        timeScale: {
          borderColor: '#485563',
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

      // Load technical analysis for initial symbol
      loadSymbolData(selectedSymbol);
      loadCandlesForSymbol(selectedSymbol, timeframe);

      // Handle resize
      const handleResize = () => {
        if (chartContainerRef.current && chartRef.current) {
          chartRef.current.applyOptions({
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
          });
        }
      };

      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
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

  // Draw harmonic patterns on chart
  useEffect(() => {
    if (!chartRef.current || !showHarmonics) return;

    // Clear existing patterns
    // Note: In a real implementation, you'd track and remove previous drawings

    harmonicPatterns.forEach((pattern, index) => {
      if (pattern.status === 'completed') {
        // Draw pattern lines
        const patternSeries = chartRef.current!.addSeries(LineSeries, {
          color: pattern.direction === 'bullish' ? '#10b981' : '#ef4444',
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          title: `${pattern.type} Pattern`,
        });

        try {
          // Create line data for the pattern
          const lineData = [
            { time: Math.floor(pattern.points.X.time.getTime() / 1000) as any, value: pattern.points.X.price },
            { time: Math.floor(pattern.points.A.time.getTime() / 1000) as any, value: pattern.points.A.price },
            { time: Math.floor(pattern.points.B.time.getTime() / 1000) as any, value: pattern.points.B.price },
            { time: Math.floor(pattern.points.C.time.getTime() / 1000) as any, value: pattern.points.C.price },
            { time: Math.floor(pattern.points.D.time.getTime() / 1000) as any, value: pattern.points.D.price },
          ];

          patternSeries.setData(lineData);

          // Draw PRZ (Potential Reversal Zone)
          const przSeries = chartRef.current!.addSeries(LineSeries, {
            color: pattern.direction === 'bullish' ? '#10b98150' : '#ef444450',
            lineWidth: 2,
            title: 'PRZ',
          });

          const przTime = Math.floor(pattern.points.D.time.getTime() / 1000) as any;
          przSeries.setData([
            { time: przTime, value: pattern.prz.min },
            { time: przTime, value: pattern.prz.max },
          ]);
        } catch (error) {
          console.warn('Failed to draw harmonic pattern:', error);
        }
      }
    });
  }, [harmonicPatterns, showHarmonics]);

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

  // Draw fibonacci levels
  useEffect(() => {
    if (!chartRef.current || !showFibonacci) return;

    fibonacciLevels.forEach((level) => {
      const fibSeries = chartRef.current!.addSeries(LineSeries, {
        color: level.strength === 'strong' ? '#8b5cf6' : 
               level.strength === 'medium' ? '#a78bfa' : '#c4b5fd',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        title: `Fib ${(level.level * 100).toFixed(1)}%`,
      });

      try {
        const now = new Date();
        const startTime = Math.floor((now.getTime() - 24 * 60 * 60 * 1000) / 1000) as any;
        const endTime = Math.floor(now.getTime() / 1000) as any;
        
        fibSeries.setData([
          { time: startTime, value: level.price },
          { time: endTime, value: level.price },
        ]);
      } catch (error) {
        console.warn('Failed to draw fibonacci level:', error);
      }
    });
  }, [fibonacciLevels, showFibonacci]);

  // Poll TradeLocker candles for near-real-time updates
  useEffect(() => {
    if (!isLive) return;

    const interval = setInterval(() => {
      loadCandlesForSymbol(selectedSymbol, timeframe);
    }, 5000);

    return () => clearInterval(interval);
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
  }, [loadCandlesForSymbol, searchTerm, selectedSymbol, timeframe, updateSymbolSuggestions]);

  const getSymbolInfo = (symbol: string): SymbolInfo | undefined => {
    return symbolDatabase.find(s => s.symbol === symbol);
  };

  const symbolDatabase = availableSymbols;

  const currentSymbolInfo = getSymbolInfo(selectedSymbol);

  return (
    <div className="h-screen bg-gray-900 text-white flex flex-col">
      {/* Enhanced Top Controls */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Left Section - Logo & Symbol Search */}
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold text-white">TradingView Pro</span>
            </div>
            
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
              <div className={`w-3 h-3 rounded-full ${isConnected && isLive ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`}></div>
              <span className="text-sm text-gray-400">
                {isConnected ? 'Connected' : 'Connecting...'}
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

      {/* Chart Area */}
      <div className="flex-1 relative bg-gray-900">
        <div 
          ref={chartContainerRef}
          className="w-full h-full"
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
