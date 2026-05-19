import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Star, Clock, Target, AlertTriangle, CheckCircle, X, Filter, Search, BarChart3, Activity, Wifi, WifiOff, Settings } from 'lucide-react';
import { format } from 'date-fns';
import { liveDataService, HarmonicPattern, FibonacciLevel, ADRData, TrendLine, SessionData, LivePrice } from '../services/liveDataService';

interface LiveTradingSignal {
  id: string;
  symbol: string;
  direction: 'buy' | 'sell';
  type: 'harmonic' | 'fibonacci' | 'trendline' | 'adr' | 'session';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  currentPrice: number;
  confidence: number;
  timeframe: string;
  reason: string;
  timestamp: Date;
  status: 'active' | 'hit_tp' | 'hit_sl' | 'expired';
  pips?: number;
  riskReward: number;
  harmonicPattern?: HarmonicPattern;
  fibonacciLevels?: FibonacciLevel[];
  adrData?: ADRData;
  trendLine?: TrendLine;
  sessionData?: SessionData;
  probability: number;
  livePrice?: LivePrice;
}

const Signals: React.FC = () => {
  const [signals, setSignals] = useState<LiveTradingSignal[]>([]);
  const [filteredSignals, setFilteredSignals] = useState<LiveTradingSignal[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'closed'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'harmonic' | 'fibonacci' | 'trendline' | 'adr'>('all');
  const [isLive, setIsLive] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [livePrices, setLivePrices] = useState<Map<string, LivePrice>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [notifications, setNotifications] = useState<string[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isConfigured, setIsConfigured] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);

  // Check if service is configured
  useEffect(() => {
    setIsConfigured(liveDataService.isConfigured());
    
    if (!liveDataService.isConfigured()) {
      setIsLoading(false);
    }
  }, []);

  // LIVE DATA INITIALIZATION
  useEffect(() => {
    if (!liveDataService.isConfigured()) {
      setIsLoading(false);
      return;
    }

    console.log('🚀 INITIALIZING LIVE TRADING SYSTEM...');
    
    const handlePriceUpdate = (price: LivePrice) => {
      setLivePrices(prev => new Map(prev.set(price.symbol, price)));
      setIsConnected(true);
    };

    const handleNewSignalOpportunity = (data: any) => {
      console.log(`🎯 New signal opportunity detected for ${data.symbol} at ${data.price}`);
      setTimeout(() => loadLiveSignals(), 1000);
    };

    liveDataService.subscribe('price', handlePriceUpdate);
    liveDataService.subscribe('new_signal_opportunity', handleNewSignalOpportunity);
    
    loadLiveSignals();

    const refreshInterval = setInterval(() => {
      if (isConnected && liveDataService.isConfigured()) {
        console.log('🔄 Auto-refreshing signals...');
        loadLiveSignals();
      }
    }, 30000);

    return () => {
      liveDataService.unsubscribe('price', handlePriceUpdate);
      liveDataService.unsubscribe('new_signal_opportunity', handleNewSignalOpportunity);
      clearInterval(refreshInterval);
      liveDataService.disconnect();
    };
  }, [isConnected]);

  // GENERATE REAL LIVE SIGNALS
  const loadLiveSignals = async () => {
    if (!liveDataService.isConfigured()) {
      setSignals([]);
      setIsLoading(false);
      return;
    }

    console.log('📊 LOADING LIVE SIGNALS...');
    setIsLoading(true);
    const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'];
    const newSignals: LiveTradingSignal[] = [];
    const processedSignals = new Set<string>();

    for (const symbol of symbols) {
      try {
        const currentPrice = await liveDataService.getCurrentPrice(symbol);
        if (currentPrice === null) continue;
        
        console.log(`📈 ${symbol} current price: ${currentPrice}`);
        
        // HARMONIC PATTERNS
        const harmonicPatterns = await liveDataService.detectHarmonicPatterns(symbol);
        harmonicPatterns.forEach(pattern => {
          const signalKey = `harmonic_${symbol}_${pattern.type}_${pattern.direction}`;
          if (pattern.status === 'completed' && !processedSignals.has(signalKey)) {
            const signal = createHarmonicSignal(pattern, currentPrice);
            newSignals.push(signal);
            processedSignals.add(signalKey);
          }
        });

        // FIBONACCI RETRACEMENTS
        const priceHistory = await liveDataService.getPriceHistory(symbol, 50);
        if (priceHistory.length > 10) {
          const recentHigh = Math.max(...priceHistory.slice(-20).map(p => p.high));
          const recentLow = Math.min(...priceHistory.slice(-20).map(p => p.low));
          const fibLevels = await liveDataService.calculateFibonacciLevels(symbol, recentHigh, recentLow);
          const fibSignal = createFibonacciSignal(symbol, fibLevels, currentPrice);
          const fibKey = `fibonacci_${symbol}`;
          if (fibSignal && !processedSignals.has(fibKey)) {
            newSignals.push(fibSignal);
            processedSignals.add(fibKey);
          }
        }

        // ADR BREAKOUTS
        const adrData = await liveDataService.calculateADR(symbol);
        if (adrData) {
          const adrSignal = createADRSignal(adrData, currentPrice);
          const adrKey = `adr_${symbol}`;
          if (adrSignal && !processedSignals.has(adrKey)) {
            newSignals.push(adrSignal);
            processedSignals.add(adrKey);
          }
        }

        // TRENDLINE BREAKS
        const trendLines = await liveDataService.detectTrendLines(symbol);
        const strongestTrendLine = trendLines
          .filter(tl => tl.isActive)
          .sort((a, b) => b.strength - a.strength)[0];
        
        if (strongestTrendLine) {
          const trendKey = `trendline_${symbol}_${strongestTrendLine.type}`;
          if (!processedSignals.has(trendKey)) {
            const signal = createTrendLineSignal(strongestTrendLine, currentPrice);
            if (signal) {
              newSignals.push(signal);
              processedSignals.add(trendKey);
            }
          }
        }

      } catch (error) {
        console.error(`Failed to load signals for ${symbol}:`, error);
      }
    }

    const uniqueSignals = newSignals.filter((signal, index, self) => 
      index === self.findIndex(s => 
        s.symbol === signal.symbol && 
        s.type === signal.type && 
        s.direction === signal.direction
      )
    );
    setSignals(uniqueSignals);
    console.log(`✅ LOADED ${uniqueSignals.length} LIVE SIGNALS`);
    setIsLoading(false);
  };

  // CREATE HARMONIC PATTERN SIGNAL
  const createHarmonicSignal = (pattern: HarmonicPattern, marketPrice: number): LiveTradingSignal => {
    const currentPrice = marketPrice;
    const direction = pattern.direction === 'bullish' ? 'buy' : 'sell';
    
    const patternRange = Math.abs(pattern.prz.max - pattern.prz.min);
    const riskMultiplier = pattern.symbol === 'XAUUSD' ? 2.0 : 
                          pattern.symbol.includes('JPY') ? 0.3 : 1.5;
    const rewardMultiplier = riskMultiplier * 2;
    
    let entry, stopLoss, takeProfit;
    if (direction === 'buy') {
      entry = Math.min(pattern.prz.max, currentPrice + (patternRange * 0.1));
      stopLoss = pattern.prz.min - (patternRange * riskMultiplier);
      takeProfit = entry + (Math.abs(entry - stopLoss) * 2);
    } else {
      entry = Math.max(pattern.prz.min, currentPrice - (patternRange * 0.1));
      stopLoss = pattern.prz.max + (patternRange * riskMultiplier);
      takeProfit = entry - (Math.abs(stopLoss - entry) * 2);
    }

    return {
      id: `harmonic_${pattern.id}`,
      symbol: pattern.symbol,
      direction,
      type: 'harmonic',
      entry,
      stopLoss,
      takeProfit,
      currentPrice,
      confidence: Math.floor(pattern.confidence / 20),
      timeframe: '1H',
      reason: `${pattern.type} harmonic pattern completed at ${pattern.completion}% with ${pattern.confidence.toFixed(0)}% confidence. PRZ: ${pattern.prz.min.toFixed(5)}-${pattern.prz.max.toFixed(5)}`,
      timestamp: new Date(),
      status: 'active',
      pips: Math.abs(takeProfit - entry) * 10000,
      riskReward: Math.abs(takeProfit - entry) / Math.abs(entry - stopLoss),
      harmonicPattern: pattern,
      probability: pattern.confidence,
    };
  };

  // CREATE FIBONACCI SIGNAL
  const createFibonacciSignal = (symbol: string, fibLevels: FibonacciLevel[], marketPrice: number): LiveTradingSignal | null => {
    const strongLevels = fibLevels.filter(level => level.strength === 'strong' && Math.abs(level.price - marketPrice) < marketPrice * 0.01);
    if (strongLevels.length === 0) return null;

    const fibLevel = strongLevels[0];
    const currentPrice = marketPrice;
    const direction = currentPrice < fibLevel.price ? 'buy' : 'sell';

    const priceDistance = Math.abs(fibLevel.price - currentPrice);
    const riskDistance = symbol === 'XAUUSD' ? Math.max(8.0, priceDistance * 1.5) : 
                        symbol.includes('JPY') ? Math.max(0.25, priceDistance * 1.5) :
                        Math.max(0.0015, priceDistance * 1.5);
    
    let entry, stopLoss, takeProfit;
    if (direction === 'buy') {
      entry = fibLevel.price;
      stopLoss = fibLevel.price - riskDistance;
      takeProfit = fibLevel.price + (riskDistance * 2);
    } else {
      entry = fibLevel.price;
      stopLoss = fibLevel.price + riskDistance;
      takeProfit = fibLevel.price - (riskDistance * 2);
    }

    return {
      id: `fib_${symbol}_${Date.now()}`,
      symbol,
      direction,
      type: 'fibonacci',
      entry,
      stopLoss,
      takeProfit,
      currentPrice,
      confidence: fibLevel.strength === 'strong' ? 4 : 3,
      timeframe: '4H',
      reason: `Price approaching ${fibLevel.level * 100}% Fibonacci ${fibLevel.type} level at ${fibLevel.price.toFixed(5)}. Strong ${fibLevel.strength} level with high probability reversal.`,
      timestamp: new Date(),
      status: 'active',
      pips: Math.abs(takeProfit - entry) * 10000,
      riskReward: Math.abs(takeProfit - entry) / Math.abs(entry - stopLoss),
      fibonacciLevels: [fibLevel],
      probability: fibLevel.strength === 'strong' ? 78 : 65,
    };
  };

  // CREATE ADR SIGNAL
  const createADRSignal = (adrData: ADRData, marketPrice: number): LiveTradingSignal | null => {
    if (adrData.rangePercent > 80) return null;

    const midRange = (adrData.dailyHigh + adrData.dailyLow) / 2;
    const direction = marketPrice < midRange ? 'buy' : 'sell';
    const currentPrice = marketPrice;

    const adrRisk = adrData.averageDailyRange * 0.15;
    const remainingRange = direction === 'buy' ? 
      (adrData.projectedHigh - currentPrice) : 
      (currentPrice - adrData.projectedLow);
    
    let entry, stopLoss, takeProfit;
    if (direction === 'buy') {
      entry = currentPrice;
      stopLoss = Math.max(adrData.dailyLow - (adrRisk * 0.5), currentPrice - adrRisk);
      takeProfit = Math.min(adrData.projectedHigh, currentPrice + (adrRisk * 2));
    } else {
      entry = currentPrice;
      stopLoss = Math.min(adrData.dailyHigh + (adrRisk * 0.5), currentPrice + adrRisk);
      takeProfit = Math.max(adrData.projectedLow, currentPrice - (adrRisk * 2));
    }

    return {
      id: `adr_${adrData.symbol}_${Date.now()}`,
      symbol: adrData.symbol,
      direction,
      type: 'adr',
      entry,
      stopLoss,
      takeProfit,
      currentPrice,
      confidence: 4,
      timeframe: '1D',
      reason: `ADR breakout setup. Current range: ${adrData.rangePercent.toFixed(1)}% of average. Target: ${direction === 'buy' ? 'projected high' : 'projected low'} based on ${adrData.session} session volatility.`,
      timestamp: new Date(),
      status: 'active',
      pips: Math.abs(takeProfit - entry) * 10000,
      riskReward: Math.abs(takeProfit - entry) / Math.abs(entry - stopLoss),
      adrData,
      probability: 72,
    };
  };

  // CREATE TRENDLINE SIGNAL
  const createTrendLineSignal = (trendLine: TrendLine, marketPrice: number): LiveTradingSignal | null => {
    const maxDistance = trendLine.symbol === 'XAUUSD' ? 8.0 : 
                       trendLine.symbol.includes('JPY') ? 0.15 : 0.003;
    if (trendLine.distance > maxDistance) return null;

    const direction = trendLine.type === 'support' ? 'buy' : 'sell';
    const trendLinePrice = trendLine.points[trendLine.points.length - 1].price;
    const entry = direction === 'buy' ? 
      Math.max(trendLinePrice, marketPrice - (trendLine.distance * 0.5)) :
      Math.min(trendLinePrice, marketPrice + (trendLine.distance * 0.5));
    const currentPrice = marketPrice;

    const baseRisk = trendLine.symbol === 'XAUUSD' ? 5.0 : 
                    trendLine.symbol.includes('JPY') ? 0.20 : 0.0012;
    const riskAdjustment = (100 - trendLine.strength) / 100;
    const actualRisk = baseRisk * (1 + riskAdjustment);
    
    let stopLoss, takeProfit;
    if (direction === 'buy') {
      stopLoss = trendLinePrice - actualRisk;
      takeProfit = entry + (Math.abs(entry - stopLoss) * 2);
    } else {
      stopLoss = trendLinePrice + actualRisk;
      takeProfit = entry - (Math.abs(stopLoss - entry) * 2);
    }

    return {
      id: `trendline_${trendLine.id}`,
      symbol: trendLine.symbol,
      direction,
      type: 'trendline',
      entry,
      stopLoss,
      takeProfit,
      currentPrice,
      confidence: Math.min(5, Math.floor(trendLine.strength / 20)),
      timeframe: '1H',
      reason: `${trendLine.type} trendline bounce. Line tested ${trendLine.touches} times with ${trendLine.strength}% strength. Distance: ${(trendLine.distance * 10000).toFixed(1)} pips.`,
      timestamp: new Date(),
      status: 'active',
      pips: Math.abs(takeProfit - entry) * 10000,
      riskReward: Math.abs(takeProfit - entry) / Math.abs(entry - stopLoss),
      trendLine,
      probability: Math.min(85, trendLine.strength),
    };
  };

  // LIVE PRICE UPDATES
  useEffect(() => {
    if (!isLive || !liveDataService.isConfigured()) return;

    const interval = setInterval(() => {
      setSignals(prevSignals => {
        return prevSignals.map(signal => {
          const livePrice = livePrices.get(signal.symbol);
          if (!livePrice) return signal;

          const newPrice = livePrice.bid;
          let newStatus = signal.status;

          if (signal.status === 'active') {
            if (signal.direction === 'buy') {
              if (newPrice >= signal.takeProfit) newStatus = 'hit_tp';
              else if (newPrice <= signal.stopLoss) newStatus = 'hit_sl';
            } else {
              if (newPrice <= signal.takeProfit) newStatus = 'hit_tp';
              else if (newPrice >= signal.stopLoss) newStatus = 'hit_sl';
            }
          }

          return {
            ...signal,
            currentPrice: newPrice,
            status: newStatus,
            livePrice
          };
        });
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isLive, livePrices]);

  // NOTIFICATION SYSTEM
  const addNotification = (message: string) => {
    setNotifications(prev => [message, ...prev.slice(0, 4)]);
  };

  // Monitor for signal status changes
  useEffect(() => {
    signals.forEach(signal => {
      if (signal.status === 'hit_tp') {
        addNotification(`🎯 ${signal.symbol} ${signal.direction.toUpperCase()} signal hit Take Profit!`);
      } else if (signal.status === 'hit_sl') {
        addNotification(`⚠️ ${signal.symbol} ${signal.direction.toUpperCase()} signal hit Stop Loss.`);
      }
    });
  }, [signals]);

  // FILTER SIGNALS
  useEffect(() => {
    let filtered = signals;

    if (searchTerm) {
      filtered = filtered.filter(signal => 
        signal.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
        signal.reason.toLowerCase().includes(searchTerm.toLowerCase()) ||
        signal.type.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (statusFilter !== 'all') {
      if (statusFilter === 'active') {
        filtered = filtered.filter(signal => signal.status === 'active');
      } else {
        filtered = filtered.filter(signal => ['hit_tp', 'hit_sl', 'expired'].includes(signal.status));
      }
    }

    if (typeFilter !== 'all') {
      filtered = filtered.filter(signal => signal.type === typeFilter);
    }

    setFilteredSignals(filtered);
  }, [signals, searchTerm, statusFilter, typeFilter]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
      case 'hit_tp':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300';
      case 'hit_sl':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
      case 'expired':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'harmonic':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300';
      case 'fibonacci':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300';
      case 'trendline':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
      case 'adr':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
    }
  };

  const renderConfidenceStars = (confidence: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <Star
        key={i}
        className={`w-4 h-4 ${
          i < confidence
            ? 'text-yellow-400 fill-current'
            : 'text-gray-300 dark:text-gray-600'
        }`}
      />
    ));
  };

  const calculatePnL = (signal: LiveTradingSignal) => {
    if (signal.status === 'active') return 0;
    
    let pnl = 0;
    if (signal.status === 'hit_tp') {
      pnl = Math.abs(signal.takeProfit - signal.entry);
    } else if (signal.status === 'hit_sl') {
      pnl = -Math.abs(signal.entry - signal.stopLoss);
    }
    
    return pnl * 10000;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🚀 LIVE TRADING SIGNALS</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Real-time harmonic patterns, Fibonacci levels, trendlines & ADR analysis
          </p>
        </div>
        <div className="flex items-center space-x-4">
          {liveDataService.isConfigured() && (
            <button
              onClick={() => setIsLive(!isLive)}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors duration-200 ${
                isLive 
                  ? 'bg-emerald-500 text-white hover:bg-emerald-600' 
                  : 'bg-gray-500 text-white hover:bg-gray-600'
              }`}
            >
              <span>{isLive ? 'LIVE' : 'PAUSED'}</span>
            </button>
          )}
          <div className="flex items-center space-x-2">
            {isConfigured && isConnected ? (
              <Wifi className="w-5 h-5 text-emerald-500" />
            ) : (
              <WifiOff className="w-5 h-5 text-gray-400" />
            )}
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {isConfigured ? (isConnected ? 'LIVE DATA' : 'CONNECTING...') : 'NOT CONFIGURED'}
            </span>
          </div>
        </div>
      </div>

      {/* API Key Not Configured Warning */}
      {!isConfigured && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-6">
          <div className="flex items-start space-x-4">
            <Settings className="w-6 h-6 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-1" />
            <div>
              <h4 className="font-semibold text-amber-900 dark:text-amber-100">API Keys Required</h4>
              <p className="text-sm text-amber-800 dark:text-amber-200 mt-1">
                To display live trading signals, you need to configure the following API keys:
              </p>
              <ul className="mt-2 space-y-1 text-sm text-amber-800 dark:text-amber-200">
                <li>• <strong>VITE_FINNHUB_API_KEY</strong> - For live market data and price feeds</li>
                <li>• <strong>VITE_PERPLEXITY_API_KEY</strong> - For AI-powered analysis (optional)</li>
              </ul>
              <p className="text-sm text-amber-800 dark:text-amber-200 mt-3">
                Add these environment variables in your Render dashboard or .env file.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Notifications */}
      {notifications.length > 0 && (
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3 flex items-center">
            <AlertTriangle className="w-4 h-4 mr-2 text-yellow-500" />
            Live Notifications
          </h3>
          <div className="space-y-2">
            {notifications.slice(0, 3).map((notification, index) => (
              <div
                key={index}
                className="text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 rounded px-3 py-2 border-l-4 border-emerald-500"
              >
                {notification}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live Stats */}
      {isConfigured && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Active Signals</p>
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {filteredSignals.filter(s => s.status === 'active').length}
                </p>
              </div>
              <Activity className="w-8 h-8 text-emerald-500" />
            </div>
          </div>
          
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Win Rate</p>
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {((filteredSignals.filter(s => s.status === 'hit_tp').length / Math.max(1, filteredSignals.filter(s => s.status !== 'active').length)) * 100).toFixed(0)}%
                </p>
              </div>
              <Target className="w-8 h-8 text-blue-500" />
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Total Pips</p>
                <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                  {filteredSignals.reduce((sum, s) => sum + calculatePnL(s), 0).toFixed(0)}
                </p>
              </div>
              <TrendingUp className="w-8 h-8 text-purple-500" />
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Pairs Tracked</p>
                <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                  {livePrices.size}
                </p>
              </div>
              <BarChart3 className="w-8 h-8 text-orange-500" />
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0 md:space-x-4">
          <div className="flex items-center space-x-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search signals..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
            </div>
            
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            >
              <option value="all">All Status</option>
              <option value="active">Active Only</option>
              <option value="closed">Closed Only</option>
            </select>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            >
              <option value="all">All Types</option>
              <option value="harmonic">Harmonic Patterns</option>
              <option value="fibonacci">Fibonacci</option>
              <option value="trendline">Trendlines</option>
              <option value="adr">ADR Breakouts</option>
            </select>
          </div>

          <div className="flex items-center space-x-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {filteredSignals.length} signals
            </span>
          </div>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-8 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-center space-x-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
            <span className="text-gray-600 dark:text-gray-400">Loading trading signals...</span>
          </div>
        </div>
      )}

      {/* Error State */}
      {loadingError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
          <div className="flex items-center space-x-3">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
            <div>
              <h4 className="font-medium text-red-900 dark:text-red-100">Loading Error</h4>
              <p className="text-sm text-red-800 dark:text-red-200">{loadingError}</p>
            </div>
          </div>
        </div>
      )}

      {/* Signals Grid */}
      {!isLoading && !loadingError && (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredSignals.map((signal) => (
          <div
            key={signal.id}
            className={`bg-white dark:bg-gray-800 rounded-xl p-6 border-2 transition-all duration-200 hover:shadow-lg ${
              signal.status === 'active'
                ? signal.direction === 'buy'
                  ? 'border-emerald-200 dark:border-emerald-800'
                  : 'border-red-200 dark:border-red-800'
                : signal.status === 'hit_tp'
                ? 'border-emerald-300 dark:border-emerald-700'
                : signal.status === 'hit_sl'
                ? 'border-red-300 dark:border-red-700'
                : 'border-gray-200 dark:border-gray-700 opacity-75'
            }`}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className={`p-2 rounded-lg ${
                  signal.direction === 'buy'
                    ? 'bg-emerald-100 dark:bg-emerald-900/30'
                    : 'bg-red-100 dark:bg-red-900/30'
                }`}>
                  {signal.direction === 'buy' ? (
                    <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <TrendingDown className="w-5 h-5 text-red-600 dark:text-red-400" />
                  )}
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white">
                    {signal.symbol}
                  </h3>
                  <div className="flex items-center space-x-2">
                    <span className={`text-sm font-medium ${
                      signal.direction === 'buy'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}>
                      {signal.direction.toUpperCase()}
                    </span>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${getTypeColor(signal.type)}`}>
                      {signal.type.toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>
              <div className={`flex items-center px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(signal.status)}`}>
                {signal.status === 'active' && <Activity className="w-3 h-3 mr-1" />}
                {signal.status === 'hit_tp' && <CheckCircle className="w-3 h-3 mr-1" />}
                {signal.status === 'hit_sl' && <X className="w-3 h-3 mr-1" />}
                <span className="capitalize">{signal.status.replace('_', ' ')}</span>
              </div>
            </div>

            {/* Live Price */}
            {signal.livePrice && (
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 mb-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Live Price:</span>
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-lg font-bold text-gray-900 dark:text-white">
                      {signal.livePrice.bid.toFixed(5)}
                    </span>
                    <span className={`text-sm ${
                      signal.livePrice.change >= 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}>
                      {signal.livePrice.change >= 0 ? '+' : ''}{(signal.livePrice.change * 10000).toFixed(1)} pips
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Confidence & Probability */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-600 dark:text-gray-400">Confidence:</span>
                <div className="flex space-x-1">
                  {renderConfidenceStars(signal.confidence)}
                </div>
              </div>
              <div className="text-sm">
                <span className="text-gray-600 dark:text-gray-400">Probability: </span>
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  {signal.probability.toFixed(0)}%
                </span>
              </div>
            </div>

            {/* Price Levels */}
            <div className="space-y-3 mb-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400 flex items-center">
                  <Target className="w-4 h-4 mr-1" />
                  Entry
                </span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {signal.entry.toFixed(5)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-red-600 dark:text-red-400">Stop Loss</span>
                <span className="font-medium text-red-600 dark:text-red-400">
                  {signal.stopLoss.toFixed(5)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-emerald-600 dark:text-emerald-400">Take Profit</span>
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  {signal.takeProfit.toFixed(5)}
                </span>
              </div>
            </div>

            {/* Signal Details */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-gray-600 dark:text-gray-400">Risk/Reward:</span>
                <span className="font-medium text-gray-900 dark:text-white">1:{signal.riskReward.toFixed(1)}</span>
              </div>
              {signal.pips && (
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-gray-600 dark:text-gray-400">Target Pips:</span>
                  <span className="font-medium text-gray-900 dark:text-white">{signal.pips.toFixed(0)}</span>
                </div>
              )}
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                {signal.reason}
              </p>

              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-500">
                <div className="flex items-center">
                  <Clock className="w-3 h-3 mr-1" />
                  {format(signal.timestamp, 'HH:mm')}
                </div>
                {signal.status !== 'active' && (
                  <div className={`font-medium ${
                    signal.status === 'hit_tp' ? 'text-emerald-600' : 'text-red-600'
                  }`}>
                    P&L: {signal.status === 'hit_tp' ? '+' : ''}{calculatePnL(signal).toFixed(0)} pips
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      )}

      {/* No Signals State */}
      {!isLoading && !loadingError && filteredSignals.length === 0 && (
        <div className="text-center py-12">
          <BarChart3 className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            {isConfigured ? 'No signals found' : 'API Not Configured'}
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            {isConfigured 
              ? 'Analyzing markets for new opportunities...' 
              : 'Configure your API keys to enable live trading signals.'}
          </p>
        </div>
      )}
    </div>
  );
};

export default Signals;
