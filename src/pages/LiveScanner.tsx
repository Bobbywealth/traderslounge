// Live Scanner — real-time view of the latest signal per configured pair.
// Pulls /api/pairs once, then /api/signals?pair=X for each pair.
// Auto-refreshes every 30s.

import React, { useEffect, useState } from 'react';
import { Activity, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { bwtsApi, type BwtsSignal, type SignalTier } from '../services/bwtsApi';

type PairRow = {
  pair: string;
  signal?: BwtsSignal;
  loading: boolean;
  error?: string;
};

const TIER_STYLES: Record<SignalTier, string> = {
  STRONG: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  GOOD: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  WATCHLIST: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  NO_TRADE: 'bg-gray-500/20 text-gray-400 border-gray-500/40',
};

const LiveScanner: React.FC = () => {
  const [rows, setRows] = useState<PairRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const refresh = async () => {
    setRefreshing(true);
    setGlobalError(null);
    try {
      const { pairs } = await bwtsApi.pairs();
      const next: PairRow[] = pairs.map((p) => ({ pair: p, loading: true }));
      setRows(next);
      // Fetch latest signal per pair in parallel
      const results = await Promise.all(
        pairs.map(async (pair) => {
          try {
            const { signals } = await bwtsApi.signals({ pair, limit: 1 });
            return { pair, signal: signals[0], loading: false } as PairRow;
          } catch (e: any) {
            return { pair, loading: false, error: e?.message || 'fetch failed' } as PairRow;
          }
        }),
      );
      setRows(results);
      setLastUpdate(new Date());
    } catch (e: any) {
      setGlobalError(e?.message || 'Failed to load pairs');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Activity className="w-8 h-8 text-emerald-400" />
            Live Scanner
          </h1>
          <p className="text-gray-400 mt-1">
            Latest confidence score per pair from the BWTS scanner.
            {lastUpdate && (
              <span className="ml-2 text-xs">
                Updated {lastUpdate.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {globalError && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg px-4 py-3">
          {globalError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {rows.map((row) => (
          <PairCard key={row.pair} row={row} />
        ))}
        {rows.length === 0 && !globalError && (
          <div className="col-span-full text-center text-gray-500 py-12">
            {refreshing ? 'Loading pairs…' : 'No pairs configured.'}
          </div>
        )}
      </div>
    </div>
  );
};

const PairCard: React.FC<{ row: PairRow }> = ({ row }) => {
  const { pair, signal, loading, error } = row;

  if (loading) {
    return (
      <div className="bg-gray-900/60 border border-gray-700/50 rounded-xl p-5 animate-pulse">
        <div className="h-5 w-20 bg-gray-700 rounded mb-3" />
        <div className="h-3 w-32 bg-gray-800 rounded" />
      </div>
    );
  }

  if (error || !signal) {
    return (
      <div className="bg-gray-900/60 border border-gray-700/50 rounded-xl p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">{pair}</h3>
          <span className="text-xs text-gray-500">no data</span>
        </div>
        <p className="text-sm text-gray-500 mt-2">{error || 'No signals scanned yet.'}</p>
      </div>
    );
  }

  const DirectionIcon =
    signal.direction === 'BUY' ? TrendingUp : signal.direction === 'SELL' ? TrendingDown : Activity;

  return (
    <div className="bg-gray-900/60 border border-gray-700/50 rounded-xl p-5 hover:border-emerald-500/40 transition-colors">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-white">{pair}</h3>
        <span className={`text-xs px-2 py-1 rounded border ${TIER_STYLES[signal.tier]}`}>
          {signal.tier}
        </span>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <DirectionIcon
          className={`w-4 h-4 ${
            signal.direction === 'BUY'
              ? 'text-emerald-400'
              : signal.direction === 'SELL'
              ? 'text-red-400'
              : 'text-gray-400'
          }`}
        />
        <span className="text-sm text-gray-300">{signal.direction}</span>
        <span className="ml-auto text-2xl font-bold text-white">
          {signal.confidence_score}
          <span className="text-sm text-gray-500">/80</span>
        </span>
      </div>
      <div className="text-xs text-gray-500 space-y-0.5">
        <div>Entry: {signal.entry.toFixed(5)}</div>
        <div>SL: {signal.stop_loss.toFixed(5)} · TP1: {signal.tp1.toFixed(5)}</div>
        <div className="truncate">{signal.pattern || 'No pattern'}</div>
      </div>
    </div>
  );
};

export default LiveScanner;
