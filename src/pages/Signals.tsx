import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, CalendarClock, Loader2, RefreshCw, Sparkles, TrendingUp, Zap } from 'lucide-react';
import { bwtsApi, type CryptoAnalysis } from '../services/bwtsApi';
import { SetupCard } from '../components/SetupCard';

type Row = { pair: string; analysis?: CryptoAnalysis; loading: boolean; error?: string };

type DirectionFilter = 'all' | 'BUY' | 'SELL' | 'NEUTRAL';
type PlanFilter = 'all' | 'READY' | 'WAIT' | 'BLOCKED';
type SortBy = 'score' | 'pair' | 'plan';

const directionLabel: Record<DirectionFilter, string> = {
  all: 'All directions',
  BUY: 'Bullish',
  SELL: 'Bearish',
  NEUTRAL: 'Neutral',
};

const Signals: React.FC = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [direction, setDirection] = useState<DirectionFilter>('all');
  const [planFilter, setPlanFilter] = useState<PlanFilter>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('score');
  const refreshInFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    setGlobalError(null);
    try {
      const { pairs } = await bwtsApi.pairs();
      const pairList = Array.isArray(pairs)
        ? pairs.filter((p): p is string => typeof p === 'string' && p.length > 0)
        : [];
      if (!pairList.length) throw new Error('Scanner returned no tracked markets');
      setRows(pairList.map((pair) => ({ pair, loading: true })));
      const results = await Promise.all(
        pairList.map(async (pair): Promise<Row> => {
          try {
            const analysis = await bwtsApi.cryptoAnalysis(pair);
            if (!analysis || typeof analysis !== 'object') throw new Error('Incomplete V2 analysis');
            return { pair, analysis, loading: false };
          } catch (error: any) {
            return { pair, loading: false, error: error?.message || 'V2 analysis failed' };
          }
        })
      );
      setRows(results);
      setLastUpdate(new Date());
    } catch (error: any) {
      setGlobalError(error?.message || 'Failed to load V2 signals');
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  const loaded = useMemo(() => rows.filter((r) => r.analysis), [rows]);
  const eligible = loaded.filter((r) => r.analysis?.trade_plan?.eligible).length;
  const buyCount = loaded.filter((r) => r.analysis?.direction === 'BUY').length;
  const sellCount = loaded.filter((r) => r.analysis?.direction === 'SELL').length;
  const avgScore = loaded.length
    ? Math.round(loaded.reduce((s, r) => s + (r.analysis?.total_score || 0), 0) / loaded.length)
    : 0;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return loaded.filter((row) => {
      const a = row.analysis!;
      if (direction !== 'all' && a.direction !== direction) return false;
      if (planFilter !== 'all') {
        const status = a.trade_plan?.status || 'WAIT';
        if (planFilter === 'READY' && status !== 'STRONG' && status !== 'VALID') return false;
        if (planFilter === 'WAIT' && status !== 'WAIT' && status !== 'WATCHLIST') return false;
        if (planFilter === 'BLOCKED' && status !== 'BLOCKED') return false;
      }
      if (term && !row.pair.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [loaded, direction, planFilter, search]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    if (sortBy === 'score') {
      list.sort((a, b) => (b.analysis!.total_score || 0) - (a.analysis!.total_score || 0));
    } else if (sortBy === 'pair') {
      list.sort((a, b) => a.pair.localeCompare(b.pair));
    } else {
      const rank = { STRONG: 5, VALID: 4, WATCHLIST: 3, WAIT: 2, BLOCKED: 1 } as Record<string, number>;
      list.sort(
        (a, b) =>
          (rank[b.analysis!.trade_plan?.status || ''] || 0) -
          (rank[a.analysis!.trade_plan?.status || ''] || 0)
      );
    }
    return list;
  }, [filtered, sortBy]);

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#080d1a] p-6 shadow-2xl shadow-black/20 sm:p-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(34,211,238,0.12),transparent_32%),radial-gradient(circle_at_90%_30%,rgba(139,92,246,0.16),transparent_36%)]" />
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/[0.07] px-3 py-1 text-[10px] font-black tracking-[0.2em] text-cyan-300">
              <Sparkles className="h-3 w-3" /> V2 MARKET INTELLIGENCE
            </div>
            <h1 className="text-3xl font-black tracking-[-0.04em] text-white sm:text-4xl">Signals</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              V2 engine view of every tracked market. Filter by direction or plan status, sort by the
              metric you trade on. Same setup card used across Dashboard and Live Scanner.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                bwtsApi.clearCache();
                refresh();
              }}
              disabled={refreshing}
              className="flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-2.5 text-xs font-black text-cyan-200 transition hover:bg-cyan-400/15 disabled:opacity-50"
            >
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh V2
            </button>
          </div>
        </div>
        <div className="relative z-10 mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Markets tracked" value={String(rows.length)} icon={Activity} />
          <Tile label="Ready plans" value={String(eligible)} icon={Zap} tone="cyan" />
          <Tile
            label="Bias"
            value={`${buyCount} buy · ${sellCount} sell`}
            icon={TrendingUp}
            tone="violet"
          />
          <Tile label="Avg V2 score" value={`${avgScore}/100`} icon={Sparkles} tone="fuchsia" />
        </div>
      </section>

      {globalError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-rose-300">
          {globalError}
        </div>
      )}

      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.07] bg-[#090d18] p-4">
        <div className="flex items-center gap-1 rounded-xl border border-white/[0.07] bg-black/20 p-1 text-[10px] font-black uppercase tracking-wider">
          {(['all', 'BUY', 'SELL', 'NEUTRAL'] as DirectionFilter[]).map((d) => (
            <button
              key={d}
              onClick={() => setDirection(d)}
              className={`rounded-lg px-3 py-1.5 transition ${
                direction === d
                  ? 'bg-cyan-400/15 text-cyan-200'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {directionLabel[d]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-white/[0.07] bg-black/20 p-1 text-[10px] font-black uppercase tracking-wider">
          {(['all', 'READY', 'WAIT', 'BLOCKED'] as PlanFilter[]).map((p) => (
            <button
              key={p}
              onClick={() => setPlanFilter(p)}
              className={`rounded-lg px-3 py-1.5 transition ${
                planFilter === p
                  ? 'bg-violet-400/15 text-violet-200'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by symbol…"
          className="rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:border-cyan-400/30 focus:outline-none"
        />
        <div className="ml-auto flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-slate-500">
          <span>Sort</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="rounded-lg border border-white/[0.07] bg-black/20 px-2 py-1 text-[10px] font-black text-slate-300"
          >
            <option value="score">Score</option>
            <option value="plan">Plan status</option>
            <option value="pair">Symbol</option>
          </select>
        </div>
        {lastUpdate && (
          <span className="ml-2 text-[10px] text-slate-600">
            <CalendarClock className="mr-1 inline h-3 w-3" />
            {lastUpdate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
        )}
      </section>

      {sorted.length === 0 && !refreshing && !globalError && (
        <div className="rounded-2xl border border-dashed border-white/10 bg-[#090d18] p-12 text-center">
          <Activity className="mx-auto h-10 w-10 text-slate-700" />
          <h3 className="mt-4 text-lg font-black text-slate-200">No signals match your filters</h3>
          <p className="mt-2 text-sm text-slate-500">
            Widen the direction, plan filter, or clear the symbol search to see more setups.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {rows.map((row) => {
          if (row.loading) {
            return (
              <div
                key={row.pair}
                className="h-72 animate-pulse rounded-[20px] border border-white/[0.06] bg-[#090d18]"
              />
            );
          }
          if (row.error || !row.analysis) {
            return (
              <div
                key={row.pair}
                className="rounded-[20px] border border-white/[0.06] bg-[#090d18] p-5"
              >
                <div className="flex justify-between">
                  <h3 className="text-lg font-black">{row.pair}</h3>
                  <span className="text-xs text-slate-600">NO DATA</span>
                </div>
                <p className="mt-2 text-sm text-slate-500">
                  {row.error || 'No V2 analysis available.'}
                </p>
              </div>
            );
          }
          return (
            <SetupCard
              key={row.pair}
              pair={row.pair}
              analysis={row.analysis}
              variant="full"
              to="/tradingview"
            />
          );
        })}
      </div>
    </div>
  );
};

const Tile: React.FC<{
  label: string;
  value: string;
  icon: React.ElementType;
  tone?: 'cyan' | 'violet' | 'fuchsia';
}> = ({ label, value, icon: Icon, tone = 'cyan' }) => {
  const toneCls =
    tone === 'violet'
      ? 'border-violet-400/15 bg-violet-400/[0.07] text-violet-300'
      : tone === 'fuchsia'
      ? 'border-fuchsia-400/15 bg-fuchsia-400/[0.07] text-fuchsia-300'
      : 'border-cyan-400/15 bg-cyan-400/[0.07] text-cyan-300';
  return (
    <div className={`flex items-center gap-3 rounded-2xl border ${toneCls} p-3`}>
      <Icon className="h-5 w-5" />
      <div>
        <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">{label}</div>
        <div className="text-lg font-black text-white">{value}</div>
      </div>
    </div>
  );
};

export default Signals;