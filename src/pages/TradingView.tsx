import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, LineStyle } from 'lightweight-charts';
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
  RefreshCw
} from 'lucide-react';
import { liveDataService, HarmonicPattern, TrendLine, FibonacciLevel } from '../services/liveDataService';

interface CandlestickData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface SymbolInfo {
  symbol: string;
  name: string;
  exchange: string;
  type: 'forex' | 'stock' | 'crypto' | 'commodity';
  price?: number;
}

const TradingView: React.FC = () => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const chartInitialized = useRef<boolean>(false);
  
  // State management
  const [selectedSymbol, setSelectedSymbol] = useState('EURUSD');
  const [timeframe, setTimeframe] = useState('1h');
  const [currentPrice, setCurrentPrice] = useState(1.12031);
  const [isConnected, setIsConnected] = useState(false);
  const [isLive, setIsLive] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [symbolSuggestions, setSymbolSuggestions] = useState<SymbolInfo[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedBroker, setSelectedBroker] = useState('polygon');
  
  // Technical analysis data
  const [harmonicPatterns, setHarmonicPatterns] = useState<HarmonicPattern[]>([]);
  const [trendLines, setTrendLines] = useState<TrendLine[]>([]);
  const [fibonacciLevels, setFibonacciLevels] = useState<FibonacciLevel[]>([]);
  const [showHarmonics, setShowHarmonics] = useState(true);
  const [showTrendLines, setShowTrendLines] = useState(true);
  const [showFibonacci, setShowFibonacci] = useState(false);

  // Symbol database
  const symbolDatabase: SymbolInfo[] = [
    // Forex Major Pairs
    { symbol: 'EURUSD', name: 'Euro / US Dollar', exchange: 'FX', type: 'forex' },
    { symbol: 'GBPUSD', name: 'British Pound / US Dollar', exchange: 'FX', type: 'forex' },
    { symbol: 'USDJPY', name: 'US Dollar / Japanese Yen', exchange: 'FX', type: 'forex' },
    { symbol: 'AUDUSD', name: 'Australian Dollar / US Dollar', exchange: 'FX', type: 'forex' },
    { symbol: 'USDCAD', name: 'US Dollar / Canadian Dollar', exchange: 'FX', type: 'forex' },
    { symbol: 'USDCHF', name: 'US Dollar / Swiss Franc', exchange: 'FX', type: 'forex' },
    { symbol: 'NZDUSD', name: 'New Zealand Dollar / US Dollar', exchange: 'FX', type: 'forex' },
    
    // Forex Minor Pairs
    { symbol: 'EURGBP', name: 'Euro / British Pound', exchange: 'FX', type: 'forex' },
    { symbol: 'EURJPY', name: 'Euro / Japanese Yen', exchange: 'FX', type: 'forex' },
    { symbol: 'GBPJPY', name: 'British Pound / Japanese Yen', exchange: 'FX', type: 'forex' },
    
    // Commodities
    { symbol: 'XAUUSD', name: 'Gold / US Dollar', exchange: 'COMEX', type: 'commodity' },
    { symbol: 'XAGUSD', name: 'Silver / US Dollar', exchange: 'COMEX', type: 'commodity' },
    { symbol: 'WTIUSD', name: 'WTI Crude Oil', exchange: 'NYMEX', type: 'commodity' },
    { symbol: 'BCOUSD', name: 'Brent Crude Oil', exchange: 'ICE', type: 'commodity' },
    
    // Cryptocurrencies
    { symbol: 'BTCUSD', name: 'Bitcoin / US Dollar', exchange: 'Crypto', type: 'crypto' },
    { symbol: 'ETHUSD', name: 'Ethereum / US Dollar', exchange: 'Crypto', type: 'crypto' },
    { symbol: 'ADAUSD', name: 'Cardano / US Dollar', exchange: 'Crypto', type: 'crypto' },
    { symbol: 'SOLUSD', name: 'Solana / US Dollar', exchange: 'Crypto', type: 'crypto' },
    
    // Major Stocks
    { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', type: 'stock' },
    { symbol: 'GOOGL', name: 'Alphabet Inc.', exchange: 'NASDAQ', type: 'stock' },
    { symbol: 'MSFT', name: 'Microsoft Corporation', exchange: 'NASDAQ', type: 'stock' },
    { symbol: 'TSLA', name: 'Tesla Inc.', exchange: 'NASDAQ', type: 'stock' },
    { symbol: 'AMZN', name: 'Amazon.com Inc.', exchange: 'NASDAQ', type: 'stock' },
    { symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ', type: 'stock' },
  ];

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

  const brokers = [
    { value: 'polygon', label: 'Polygon.io', status: 'connected' },
    { value: 'alpha_vantage', label: 'Alpha Vantage', status: 'connected' },
    { value: 'finnhub', label: 'Finnhub', status: 'disconnected' },
    { value: 'iex', label: 'IEX Cloud', status: 'demo' },
  ];

  // Symbol search functionality
  const handleSymbolSearch = (term: string) => {
    setSearchTerm(term);
    if (term.length > 0) {
      const filtered = symbolDatabase.filter(symbol =>
        symbol.symbol.toLowerCase().includes(term.toLowerCase()) ||
        symbol.name.toLowerCase().includes(term.toLowerCase())
      ).slice(0, 10);
      setSymbolSuggestions(filtered);
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
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

  // Generate realistic OHLC data
  const generateCandlestickData = (): CandlestickData[] => {
    const data: CandlestickData[] = [];
    const basePrices: Record<string, number> = {
      'EURUSD': 1.0425, 'GBPUSD': 1.2580, 'USDJPY': 157.25, 'AUDUSD': 0.6245,
      'USDCAD': 1.4385, 'XAUUSD': 2685.50, 'BTCUSD': 119000, 'ETHUSD': 3850,
      'AAPL': 225.50, 'GOOGL': 175.80, 'MSFT': 415.20, 'TSLA': 248.90
    };
    
    let basePrice = basePrices[selectedSymbol] || 1.0425;
    const now = new Date();
    
    for (let i = 100; i >= 0; i--) {
      const time = new Date(now.getTime() - i * getTimeframeMs(timeframe));
      const volatility = getSymbolVolatility(selectedSymbol);
      
      const change = (Math.random() - 0.5) * volatility;
      const open = basePrice;
      const close = open + change;
      const high = Math.max(open, close) + Math.random() * volatility * 0.5;
      const low = Math.min(open, close) - Math.random() * volatility * 0.5;
      
      data.push({
        time: Math.floor(time.getTime() / 1000) as any, // Use timestamp for better chart performance
        open: parseFloat(open.toFixed(getDecimalPlaces(selectedSymbol))),
        high: parseFloat(high.toFixed(getDecimalPlaces(selectedSymbol))),
        low: parseFloat(low.toFixed(getDecimalPlaces(selectedSymbol))),
        close: parseFloat(close.toFixed(getDecimalPlaces(selectedSymbol))),
      });
      
      basePrice = close;
    }
    
    return data;
  };

  const getSymbolVolatility = (symbol: string): number => {
    const volatilities: Record<string, number> = {
      'EURUSD': 0.008, 'GBPUSD': 0.012, 'USDJPY': 1.2, 'XAUUSD': 25.0,
      'BTCUSD': 2000, 'ETHUSD': 50, 'AAPL': 5.0, 'GOOGL': 4.0, 'TSLA': 8.0
    };
    return volatilities[symbol] || 0.008;
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
          textColor: '#d1d5db',
        },
        timeScale: {
          borderColor: '#485563',
          textColor: '#d1d5db',
        },
        width: chartContainerRef.current.clientWidth,
        height: chartContainerRef.current.clientHeight,
      });

      const candlestickSeries = chart.addCandlestickSeries({
        upColor: '#10b981',
        downColor: '#ef4444',
        borderDownColor: '#ef4444',
        borderUpColor: '#10b981',
        wickDownColor: '#ef4444',
        wickUpColor: '#10b981',
      });

      // Add initial data
      const initialData = generateCandlestickData();
      candlestickSeries.setData(initialData);

      chartRef.current = chart;
      candlestickSeriesRef.current = candlestickSeries;
      chartInitialized.current = true;

      // Load technical analysis for initial symbol
      loadSymbolData(selectedSymbol);

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
        const patternSeries = chartRef.current!.addLineSeries({
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
          const przSeries = chartRef.current!.addLineSeries({
            color: pattern.direction === 'bullish' ? '#10b98150' : '#ef444450',
            lineWidth: 8,
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
        const trendSeries = chartRef.current!.addLineSeries({
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
      const fibSeries = chartRef.current!.addLineSeries({
        color: level.strength === 'strong' ? '#8b5cf6' : 
               level.strength === 'medium' ? '#a78bfa' : '#c4b5fd',
        lineWidth: level.strength === 'strong' ? 2 : 1,
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

  // Real-time price updates
  useEffect(() => {
    if (!isLive) return;

    const interval = setInterval(() => {
      if (candlestickSeriesRef.current) {
        const volatility = getSymbolVolatility(selectedSymbol) * 0.1;
        const change = (Math.random() - 0.5) * volatility;
        const newPrice = currentPrice + change;
        
        const newCandle = {
          time: Math.floor(Date.now() / 1000) as any,
          open: currentPrice,
          high: Math.max(currentPrice, newPrice) + Math.random() * volatility * 0.3,
          low: Math.min(currentPrice, newPrice) - Math.random() * volatility * 0.3,
          close: newPrice,
        };

        try {
          candlestickSeriesRef.current.update(newCandle);
        } catch (error) {
          console.warn('Chart update failed:', error);
        }
        setCurrentPrice(newPrice);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [currentPrice, isLive, selectedSymbol]);

  // Handle symbol change
  const handleSymbolChange = (newSymbol: string) => {
    setSelectedSymbol(newSymbol);
    setSearchTerm(newSymbol);
    
    // Update chart data
    if (candlestickSeriesRef.current) {
      const newData = generateCandlestickData();
      candlestickSeriesRef.current.setData(newData);
      setCurrentPrice(newData[newData.length - 1].close);
    }
    
    // Load new technical analysis
    loadSymbolData(newSymbol);
  };

  const getSymbolInfo = (symbol: string): SymbolInfo | undefined => {
    return symbolDatabase.find(s => s.symbol === symbol);
  };

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
                  onFocus={() => setShowSuggestions(true)}
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
            {/* Broker Selection */}
            <select 
              value={selectedBroker}
              onChange={(e) => setSelectedBroker(e.target.value)}
              className="bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:border-emerald-500 focus:outline-none"
            >
              {brokers.map(broker => (
                <option key={broker.value} value={broker.value}>
                  {broker.label} ({broker.status})
                </option>
              ))}
            </select>

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

            <button className="p-2 bg-gray-700 rounded hover:bg-gray-600 transition-colors">
              <Settings className="w-4 h-4" />
            </button>
            
            <button className="p-2 bg-gray-700 rounded hover:bg-gray-600 transition-colors">
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
    </div>
  );
};

export default TradingView;