import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Star, Clock, Target, AlertTriangle, CheckCircle, RefreshCw, Wifi, WifiOff, Settings, Loader2, Brain } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { signalsApi, SignalAnalysis } from '../services/apiService';

const Signals: React.FC = () => {
  const [signals, setSignals] = useState<SignalAnalysis[]>([]);
  const [filteredSignals, setFilteredSignals] = useState<SignalAnalysis[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Load signals from database
  useEffect(() => {
    loadSignals();
  }, []);

  const loadSignals = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await signalsApi.getSignals();
      setSignals(data);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load signals');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setError(null);
    try {
      await signalsApi.refreshSignals(['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD']);
      await loadSignals();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh signals');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Filter signals
  useEffect(() => {
    let filtered = signals;

    if (searchTerm) {
      filtered = filtered.filter(signal => 
        signal.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
        signal.reasoning?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        signal.trend?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    setFilteredSignals(filtered);
  }, [signals, searchTerm]);

  const getDirectionColor = (direction: string) => {
    return direction === 'buy' 
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
      : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
  };

  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case 'bullish': return 'text-emerald-600';
      case 'bearish': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const renderConfidenceStars = (confidence: number) => {
    const stars = Math.round(confidence / 20);
    return (
      <div className="flex space-x-1">
        {[1, 2, 3, 4, 5].map(i => (
          <Star
            key={i}
            className={`w-4 h-4 ${
              i <= stars
                ? 'text-yellow-400 fill-current'
                : 'text-gray-300 dark:text-gray-600'
            }`}
          />
        ))}
      </div>
    );
  };

  const calculatePips = (signal: SignalAnalysis) => {
    const pips = Math.abs(signal.take_profit - signal.entry_price) * 10000;
    return pips.toFixed(1);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🤖 AI Trading Signals</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Perplexity AI-powered market analysis with trend, levels, and trade setups
          </p>
        </div>
        <div className="flex items-center space-x-4">
          {lastUpdated && (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Updated {formatDistanceToNow(lastUpdated, { addSuffix: true })}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center space-x-2 px-4 py-2 bg-emerald-500 text-white rounded-lg font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50"
          >
            {isRefreshing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Analyzing...</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-5 h-5" />
                <span>Refresh Analysis</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Active Signals</p>
              <p className="text-2xl font-bold text-emerald-600">{filteredSignals.length}</p>
            </div>
            <Target className="w-8 h-8 text-emerald-500" />
          </div>
        </div>
        
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Buy Signals</p>
              <p className="text-2xl font-bold text-emerald-600">
                {filteredSignals.filter(s => s.direction === 'buy').length}
              </p>
            </div>
            <TrendingUp className="w-8 h-8 text-emerald-500" />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Sell Signals</p>
              <p className="text-2xl font-bold text-red-600">
                {filteredSignals.filter(s => s.direction === 'sell').length}
              </p>
            </div>
            <TrendingDown className="w-8 h-8 text-red-500" />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Avg Confidence</p>
              <p className="text-2xl font-bold text-blue-600">
                {filteredSignals.length > 0 
                  ? Math.round(filteredSignals.reduce((sum, s) => sum + s.confidence, 0) / filteredSignals.length)
                  : 0}%
              </p>
            </div>
            <Brain className="w-8 h-8 text-blue-500" />
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
          <div className="flex items-center space-x-3">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            <p className="text-red-800 dark:text-red-200">{error}</p>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
        <input
          type="text"
          placeholder="Search by symbol, trend, or analysis..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
        />
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-12 border border-gray-200 dark:border-gray-700 text-center">
          <Loader2 className="w-12 h-12 text-emerald-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Loading AI analysis...</p>
        </div>
      )}

      {/* Signals Grid */}
      {!isLoading && filteredSignals.length === 0 && !error && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-12 border border-gray-200 dark:border-gray-700 text-center">
          <Brain className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No AI Analysis Available
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Click "Refresh Analysis" to generate new trading signals using Perplexity AI.
          </p>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="px-6 py-3 bg-emerald-500 text-white rounded-lg font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50"
          >
            Generate Analysis
          </button>
        </div>
      )}

      {!isLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {filteredSignals.map((signal) => (
            <div
              key={signal.id}
              className={`bg-white dark:bg-gray-800 rounded-xl border-2 transition-all duration-200 hover:shadow-lg ${
                signal.direction === 'buy'
                  ? 'border-emerald-200 dark:border-emerald-800'
                  : 'border-red-200 dark:border-red-800'
              }`}
            >
              {/* Header */}
              <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className={`p-3 rounded-xl ${
                      signal.direction === 'buy'
                        ? 'bg-emerald-100 dark:bg-emerald-900/30'
                        : 'bg-red-100 dark:bg-red-900/30'
                    }`}>
                      {signal.direction === 'buy' ? (
                        <TrendingUp className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <TrendingDown className="w-8 h-8 text-red-600 dark:text-red-400" />
                      )}
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                        {signal.symbol}
                      </h3>
                      <div className="flex items-center space-x-2 mt-1">
                        <span className={`px-3 py-1 rounded-full text-sm font-medium ${getDirectionColor(signal.direction)}`}>
                          {signal.direction.toUpperCase()}
                        </span>
                        <span className={`text-sm font-medium ${getSentimentColor(signal.sentiment)}`}>
                          {signal.sentiment}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center space-x-1">
                      <span className="text-sm text-gray-500">Confidence:</span>
                      <span className="font-bold text-gray-900 dark:text-white">{signal.confidence}%</span>
                    </div>
                    {renderConfidenceStars(signal.confidence)}
                  </div>
                </div>
              </div>

              {/* Price Levels */}
              <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                    <p className="text-xs text-gray-500 mb-1">Entry</p>
                    <p className="text-lg font-bold text-blue-600">{signal.entry_price?.toFixed(5)}</p>
                  </div>
                  <div className="text-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                    <p className="text-xs text-gray-500 mb-1">Stop Loss</p>
                    <p className="text-lg font-bold text-red-600">{signal.stop_loss?.toFixed(5)}</p>
                  </div>
                  <div className="text-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                    <p className="text-xs text-gray-500 mb-1">Take Profit</p>
                    <p className="text-lg font-bold text-emerald-600">{signal.take_profit?.toFixed(5)}</p>
                  </div>
                </div>
                
                <div className="flex items-center justify-between mt-4">
                  <div className="flex items-center space-x-4">
                    <div className="text-sm">
                      <span className="text-gray-500">Risk/Reward: </span>
                      <span className="font-medium">1:{signal.risk_reward_ratio?.toFixed(1)}</span>
                    </div>
                    <div className="text-sm">
                      <span className="text-gray-500">Target: </span>
                      <span className="font-medium text-emerald-600">{calculatePips(signal)} pips</span>
                    </div>
                  </div>
                  <div className="text-sm">
                    <span className="text-gray-500">Trend: </span>
                    <span className={`font-medium ${
                      signal.trend === 'bullish' ? 'text-emerald-600' : 
                      signal.trend === 'bearish' ? 'text-red-600' : 'text-gray-600'
                    }`}>
                      {signal.trend} ({signal.trend_strength?.toFixed(0)}%)
                    </span>
                  </div>
                </div>
              </div>

              {/* Support/Resistance Levels */}
              {(signal.support_levels?.length > 0 || signal.resistance_levels?.length > 0) && (
                <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Key Levels</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-gray-500 mb-2">Support</p>
                      <div className="space-y-1">
                        {signal.support_levels?.slice(0, 2).map((level, i) => (
                          <div key={i} className="flex items-center justify-between text-sm">
                            <span className="text-emerald-600">{level?.toFixed(5)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-2">Resistance</p>
                      <div className="space-y-1">
                        {signal.resistance_levels?.slice(0, 2).map((level, i) => (
                          <div key={i} className="flex items-center justify-between text-sm">
                            <span className="text-red-600">{level?.toFixed(5)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Timeframe Signals */}
              {signal.timeframes && (
                <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Multi-Timeframe Analysis</h4>
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(signal.timeframes).map(([tf, data]: [string, any]) => (
                      <div key={tf} className="text-center p-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                        <p className="text-xs text-gray-500">{tf}</p>
                        <p className={`text-sm font-medium ${
                          data.trend === 'bullish' ? 'text-emerald-600' :
                          data.trend === 'bearish' ? 'text-red-600' : 'text-gray-600'
                        }`}>
                          {data.trend}
                        </p>
                        <p className="text-xs text-gray-500">{data.signal}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Trade Setup */}
              {signal.trade_setup && (
                <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">Trade Setup</h4>
                  <div className="flex items-center space-x-4 text-sm">
                    <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                      {signal.trade_setup.type}
                    </span>
                    <span className="text-gray-500">{signal.trade_setup.timeframe}</span>
                    <span className="text-gray-500">→</span>
                    <span className="text-gray-700 dark:text-gray-300">{signal.trade_setup.best_entry}</span>
                  </div>
                </div>
              )}

              {/* Reasoning */}
              <div className="p-6">
                <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">AI Analysis</h4>
                <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                  {signal.reasoning || signal.market_summary || 'No analysis available'}
                </p>
                
                {/* Meta info */}
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                  <div className="flex items-center space-x-2 text-xs text-gray-500">
                    <Clock className="w-3 h-3" />
                    <span>{format(new Date(signal.updated_at || signal.created_at), 'MMM d, HH:mm')}</span>
                  </div>
                  {signal.expires_at && (
                    <div className="text-xs text-gray-500">
                      Expires {formatDistanceToNow(new Date(signal.expires_at), { addSuffix: true })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Signals;
