// Decision Journal — captures trade decisions without exposing execution/PnL.
// Reads from the BWTS journal endpoint when execution data exists, but the
// product itself does not execute trades, so most users will see the empty
// timeline state and a clear CTA to start logging decisions.

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Loader2, PencilLine, RefreshCw, Sparkles } from 'lucide-react';
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
      const [j, s] = await Promise.all([
        bwtsApi.journal({ limit: 200 }).catch(() => ({ trades: [], count: 0 })),
        bwtsApi.journalStats().catch(() => null),
      ]);
      setTrades(j.trades || []);
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

  const isEmpty = !loading && !error && trades.length === 0;

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#080d1a] p-6 shadow-2xl shadow-black/20 sm:p-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(139,92,246,0.16),transparent_32%),radial-gradient(circle_at_90%_30%,rgba(34,211,238,0.12),transparent_36%)]" />
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/[0.07] px-3 py-1 text-[10px] font-black tracking-[0.2em] text-violet-300">
              <Sparkles className="h-3 w-3" /> DECISION JOURNAL
            </div>
            <h1 className="text-3xl font-black tracking-[-0.04em] text-white sm:text-4xl">
              Decision Journal
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Capture decisions, attach the V2 setup, and review your process session by session.
              Repeat the wins, retire the patterns that don&apos;t pay.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/backtester"
              className="flex items-center gap-2 rounded-xl border border-violet-400/20 bg-violet-400/10 px-4 py-2.5 text-xs font-black text-violet-200 hover:bg-violet-400/15"
            >
              <PencilLine className="h-4 w-4" /> Review outcomes
            </Link>
            <button
              onClick={refresh}
              disabled={loading}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs font-bold text-slate-300 transition hover:bg-white/[0.08] disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </button>
          </div>
        </div>
        <div className="relative z-10 mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/[0.07] pt-4 text-xs text-slate-500">
          <span className="flex items-center gap-2">
            <CalendarClock className="h-3.5 w-3.5 text-cyan-400" />
            Asia · London · New York session lanes
          </span>
          <span>V2 setup chip attached per entry</span>
          <span>No execution, no P&amp;L — only process</span>
        </div>
      </section>

      {error && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-rose-300">
          {error}
        </div>
      )}

      {isEmpty && (
        <section className="rounded-3xl border border-white/[0.07] bg-[#090d18] p-6">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <div className="text-[10px] font-black tracking-[0.2em] text-cyan-300">
                TIMELINE PREVIEW
              </div>
              <h2 className="mt-2 text-2xl font-black text-white">No decisions logged yet</h2>
              <p className="mt-2 text-sm text-slate-400">
                When you log a decision, it shows up here grouped by trading session with the
                V2 setup, calendar gate, and your reasoning side-by-side. Once the decision
                is closed by the market, an outcome chip is attached.
              </p>
              <Link
                to="/backtester"
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 px-5 py-3 text-sm font-black text-[#05070d]"
              >
                <PencilLine className="h-4 w-4" /> Open outcome validation
              </Link>
              <p className="mt-2 text-[10px] text-slate-600">
                The journal remains read-only until resolved setup outcomes are available.
              </p>
            </div>
            <div className="relative">
              <div className="absolute left-3 top-2 bottom-2 w-px bg-gradient-to-b from-cyan-400/40 via-violet-400/30 to-transparent" />
              {['Asia · 02:14', 'London · 08:42', 'New York · 13:05'].map((label) => (
                <div
                  key={label}
                  className="relative mb-4 ml-10 rounded-2xl border border-dashed border-white/10 bg-black/20 p-4"
                >
                  <div className="absolute -left-7 top-4 h-3 w-3 rounded-full border border-cyan-400/40 bg-[#090d18]" />
                  <div className="text-[10px] font-black uppercase tracking-widest text-cyan-300">
                    {label}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-md border border-white/[0.07] bg-white/[0.04] px-2 py-1 text-[10px] font-black text-slate-400">
                      SYMBOL · TF · V2 SCORE
                    </span>
                    <span className="rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[10px] font-black text-cyan-300">
                      CLEAR
                    </span>
                    <span className="rounded-md border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-[10px] font-black text-amber-300">
                      WAIT
                    </span>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-white/[0.05]" />
                  <div className="mt-1 h-1.5 w-1/2 rounded-full bg-gradient-to-r from-cyan-400/40 to-violet-400/40" />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {!isEmpty && stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Total trades" value={String(stats.trades)} />
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
