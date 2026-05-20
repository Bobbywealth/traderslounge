// Journal — closed-trade history with stats.

import React, { useEffect, useState } from 'react';
import { BookOpen, RefreshCw } from 'lucide-react';
import {
  bwtsApi,
  type BwtsClosedTrade,
  type BwtsJournalStats,
} from '../services/bwtsApi';

const Journal: React.FC = () => {
  const [trades, setTrades] = useState<BwtsClosedTrade[]>([]);
  const [stats, setStats] = useState<BwtsJournalStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const [j, s] = await Promise.all([bwtsApi.journal({ limit: 200 }), bwtsApi.journalStats()]);
      setTrades(j.trades);
      setStats(s);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load journal');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <BookOpen className="w-8 h-8 text-emerald-400" />
            Journal
          </h1>
          <p className="text-gray-400 mt-1">
            Closed-trade history. Win rate, profit factor, and average R per trade.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total trades"  value={String(stats.trades)} />
          <StatCard
            label="Win rate"
            value={`${(stats.win_rate * 100).toFixed(1)}%`}
            color={stats.win_rate >= 0.5 ? 'text-emerald-400' : 'text-amber-400'}
          />
          <StatCard
            label="Profit factor"
            value={stats.profit_factor.toFixed(2)}
            color={stats.profit_factor >= 1 ? 'text-emerald-400' : 'text-red-400'}
          />
          <StatCard
            label="Total P&L"
            value={`$${stats.total_pnl.toFixed(2)}`}
            color={stats.total_pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}
          />
        </div>
      )}

      {!error && trades.length === 0 && !loading && (
        <div className="bg-gray-900/60 border border-gray-700/50 rounded-xl p-8 text-center">
          <BookOpen className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">No closed trades yet.</p>
        </div>
      )}

      {trades.length > 0 && (
        <div className="bg-gray-900/60 border border-gray-700/50 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-800/60 text-xs text-gray-400 uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2">Pair</th>
                <th className="text-left px-4 py-2">Dir</th>
                <th className="text-right px-4 py-2">Entry</th>
                <th className="text-right px-4 py-2">Exit</th>
                <th className="text-right px-4 py-2">Lots</th>
                <th className="text-right px-4 py-2">P&L (USD)</th>
                <th className="text-right px-4 py-2">R</th>
                <th className="text-left px-4 py-2">Outcome</th>
                <th className="text-left px-4 py-2">Closed</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id} className="border-t border-gray-800 hover:bg-gray-800/30">
                  <td className="px-4 py-2 text-white font-medium">{t.pair}</td>
                  <td className={`px-4 py-2 ${t.direction === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {t.direction}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-300 font-mono">{t.entry.toFixed(5)}</td>
                  <td className="px-4 py-2 text-right text-gray-300 font-mono">{t.exit_price.toFixed(5)}</td>
                  <td className="px-4 py-2 text-right text-gray-400">{t.lot_size.toFixed(2)}</td>
                  <td className={`px-4 py-2 text-right font-mono ${t.pnl_usd >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {t.pnl_usd >= 0 ? '+' : ''}{t.pnl_usd.toFixed(2)}
                  </td>
                  <td className={`px-4 py-2 text-right ${t.r_multiple >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {t.r_multiple >= 0 ? '+' : ''}{t.r_multiple.toFixed(2)}R
                  </td>
                  <td className="px-4 py-2">
                    <span className="px-2 py-0.5 rounded text-xs bg-gray-800 border border-gray-700 text-gray-300">
                      {t.outcome}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">
                    {new Date(t.closed_at * 1000).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: string; color?: string }> = ({
  label,
  value,
  color,
}) => (
  <div className="bg-gray-900/60 border border-gray-700/50 rounded-xl p-4">
    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</p>
    <p className={`text-2xl font-bold ${color || 'text-white'}`}>{value}</p>
  </div>
);

export default Journal;
