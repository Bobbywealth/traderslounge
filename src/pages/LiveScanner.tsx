import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Filter, FlaskConical, Loader2, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { bwtsApi, type CalendarGateStatus, type CryptoAnalysis, type V2BacktestReport } from '../services/bwtsApi';
import DataAttribution from '../components/DataAttribution';

type Row = {
  pair: string;
  analysis?: CryptoAnalysis;
  loading: boolean;
  error?: string;
  calendar?: CalendarGateStatus | null;
};

type DirectionFilter = 'all' | 'BUY' | 'SELL' | 'NEUTRAL';
type PlanFilter = 'all' | 'READY' | 'WAIT' | 'BLOCKED';
type CalendarFilter = 'all' | 'CLEAR' | 'CAUTION' | 'BLOCKED' | 'POST_NEWS';
type TimeframeFilter = '15m' | '1h' | '4h' | '1d';
type SortBy = 'plan' | 'score' | 'pair';

const TIMEFRAME_LABELS: Record<TimeframeFilter, string> = {
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1D',
};

const PLAN_RANK: Record<string, number> = { STRONG: 5, VALID: 4, WATCHLIST: 3, WAIT: 2, BLOCKED: 1 };

const effectiveScore = (analysis?: CryptoAnalysis) => {
  if (!analysis) return 0;
  // Use forming_score when total_score is 0 (direction not yet confirmed)
  return Number(analysis.total_score || analysis.forming_score || 0);
};

const heatScore = (analysis?: CryptoAnalysis) => {
  if (!analysis) return 0;
  const base = effectiveScore(analysis);
  const readyBonus = analysis.trade_plan?.eligible ? 35 : 0;
  const timingBonus = analysis.trade_timing?.status === 'READY' ? 15 : analysis.trade_timing?.status === 'WAIT' ? 5 : -10;
  const locationBonus = analysis.trade_timing?.location_ready ? 8 : 0;
  const penalty = analysis.data_quality?.data_stale ? 25 : 0;
  return Math.max(0, Math.min(100, base + readyBonus + timingBonus + locationBonus - penalty));
};

const statusLabel = (analysis?: CryptoAnalysis) => {
  if (!analysis) return 'Unavailable';
  if (analysis.trade_plan?.eligible) return 'Ready';
  if (analysis.trade_timing?.status === 'AVOID') return 'Avoid';
  const score = effectiveScore(analysis);
  if (score >= 55) return 'Almost';
  if (score >= 35) return 'Building';
  if (analysis.direction === 'NEUTRAL' && score > 0) return 'Forming';
  return 'Waiting';
};

const formatPrice = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) === 0) return '—';
  const n = Number(value);
  return n >= 100 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n.toLocaleString(undefined, { maximumFractionDigits: 5 });
};

const formatAge = (seconds?: number) => {
  const s = Math.max(0, Number(seconds || 0));
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
};

const firstBlocker = (analysis?: CryptoAnalysis) => {
  if (!analysis) return 'No analysis yet';
  const planReason = (analysis.trade_plan?.reasons || []).map((r) => (typeof r === 'string' ? r : r.message || r.code || '')).find(Boolean);
  const wait = analysis.trade_timing?.wait_for?.[0]?.replace(/_/g, ' ');
  const avoid = analysis.trade_timing?.avoid_reasons?.[0]?.replace(/_/g, ' ');
  const block = analysis.trade_plan?.blocking_reasons?.[0]?.message;
  return planReason || block || avoid || wait || 'Waiting for cleaner confirmation';
};

const LiveScanner: React.FC = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [validation, setValidation] = useState<V2BacktestReport | null>(null);
  const [validating, setValidating] = useState(false);

  const [timeframe, setTimeframe] = useState<TimeframeFilter>('1h');
  const [direction, setDirection] = useState<DirectionFilter>('all');
  const [planFilter, setPlanFilter] = useState<PlanFilter>('all');
  const [calendarFilter, setCalendarFilter] = useState<CalendarFilter>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('plan');

  const refreshInFlight = useRef(false);

  const refresh = useCallback(async (manual = false) => {
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
      setRows((prev) => pairList.map((pair) => prev.find((r) => r.pair === pair) || ({ pair, loading: true })));
      const withTimeout = <T,>(promise: Promise<T>, ms: number) => Promise.race([
        promise,
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('Timed out')), ms)),
      ]);
      await Promise.all(
        pairList.map(async (pair): Promise<void> => {
          let nextRow: Row;
          try {
            const analysis = await withTimeout(bwtsApi.cryptoAnalysis(pair, timeframe), 9000);
            if (!analysis || typeof analysis !== 'object') throw new Error('Incomplete V2 analysis');
            let calendar: CalendarGateStatus | null = null;
            try {
              calendar = await withTimeout(bwtsApi.calendarStatus(pair), 5000);
            } catch {
              calendar = null;
            }
            nextRow = { pair, analysis, loading: false, calendar };
          } catch (error: any) {
            nextRow = { pair, loading: false, error: error?.message || 'V2 analysis failed' };
          }
          setRows((current) => current.map((row) => row.pair === pair ? nextRow : row));
        })
      );
      setLastUpdate(new Date());
    } catch (error: any) {
      setGlobalError(error?.message || 'Failed to load tracked markets');
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }, [timeframe]);

  useEffect(() => {
    refresh();
    const id = window.setInterval(() => refresh(), 60_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const runValidation = useCallback(async () => {
    setValidating(true);
    try {
      setValidation(await bwtsApi.v2Backtest('EURUSD', timeframe === '1d' ? '1d' : timeframe, 10000));
    } catch (error: any) {
      setGlobalError(error?.message || 'Validation replay failed');
    } finally {
      setValidating(false);
    }
  }, [timeframe]);

  const loaded = useMemo(() => rows.filter((r) => r.analysis), [rows]);
  const eligible = loaded.filter((r) => r.analysis?.trade_plan?.eligible).length;
  const buyCount = loaded.filter((r) => r.analysis?.direction === 'BUY').length;
  const sellCount = loaded.filter((r) => r.analysis?.direction === 'SELL').length;
  const average = loaded.length
    ? Math.round(loaded.reduce((sum, r) => sum + (r.analysis?.total_score || 0), 0) / loaded.length)
    : 0;
  const hottest = useMemo(() => [...loaded]
    .sort((a, b) => (b.analysis?.total_score || 0) - (a.analysis?.total_score || 0))
    .slice(0, 4), [loaded]);

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
      if (calendarFilter !== 'all') {
        const status = row.calendar?.status || a.economic_calendar?.status;
        if (status !== calendarFilter) return false;
      }
      if (term && !row.pair.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [loaded, direction, planFilter, calendarFilter, search]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    if (sortBy === 'score') {
      list.sort((a, b) => (b.analysis!.total_score || 0) - (a.analysis!.total_score || 0));
    } else if (sortBy === 'pair') {
      list.sort((a, b) => a.pair.localeCompare(b.pair));
    } else {
      list.sort((a, b) => heatScore(b.analysis) - heatScore(a.analysis));
    }
    return list;
  }, [filtered, sortBy]);

  return (
    <div className="space-y-6 pb-8 cx-text">
      <section className="relative overflow-hidden rounded-[24px] border border-violet-400/15 cx-bg-app bg-gradient-to-br from-violet-500/10 to-cyan-500/[0.04] p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-[10px] font-black tracking-[0.22em] text-cyan-300">HOT SCANNER</div>
            <h1 className="mt-2 flex items-center gap-3 text-3xl font-black cx-text-strong"><Activity className="h-7 w-7 text-cyan-300" /> All Markets Deep Dive</h1>
            <p className="mt-2 text-sm cx-text-muted">
              Every tracked pair with full V2 details, filter by timeframe, direction, plan, calendar, and search. Auto-refreshes every 60 seconds.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select value={timeframe} onChange={(event) => setTimeframe(event.target.value as TimeframeFilter)} disabled={refreshing} className="rounded-lg border cx-border cx-bg-input px-2 py-2 text-xs cx-text">
              {(Object.keys(TIMEFRAME_LABELS) as TimeframeFilter[]).map((tf) => <option key={tf} value={tf}>{tf}</option>)}
            </select>
            <button onClick={runValidation} disabled={validating} className="flex items-center gap-2 rounded-xl border border-violet-400/20 bg-violet-400/10 px-4 py-2.5 text-xs font-black text-violet-200 transition hover:bg-violet-400/15 disabled:opacity-50">
              <FlaskConical className={`h-4 w-4 ${validating ? 'animate-pulse' : ''}`} /> {validating ? `Replaying 10K bars` : 'Run validation'}
            </button>
            <button onClick={() => { bwtsApi.clearCache(); refresh(); }} disabled={refreshing} className="flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-2.5 text-xs font-black text-cyan-200 transition hover:bg-cyan-400/15 disabled:opacity-50">
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
            </button>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="MARKETS" value={loaded.length ? `${loaded.length}/${rows.length}` : refreshing ? 'Loading' : '0'} />
          <Metric label="ELIGIBLE" value={loaded.length ? String(eligible) : 'Loading'} />
          <Metric label="BIAS" value={loaded.length ? `${buyCount} buy · ${sellCount} sell` : 'Loading'} />
          <Metric label="AVG SCORE" value={loaded.length ? `${average}/100` : 'Loading'} />
        </div>
      </section>

      {hottest.length > 0 && (
        <section className="rounded-[20px] border border-orange-400/15 cx-bg-card p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-[9px] font-black tracking-[0.2em] text-orange-300">HOT RIGHT NOW · {timeframe}</div>
              <h2 className="mt-1 text-lg font-black">Highest-readiness markets</h2>
            </div>
            <span className="text-[10px] cx-text-faint">Sorted by live V2 score</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {hottest.map((row) => (
              <Link key={row.pair} to={`/tradingview?symbol=${row.pair}&panel=full`} className="rounded-2xl border cx-border cx-bg-card p-4 transition hover:border-cyan-400/30">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-black cx-text-strong">{row.pair}</span>
                  <span className="rounded-lg bg-cyan-400/10 px-2 py-1 text-[10px] font-black text-cyan-300">{row.analysis?.total_score || 0}/100</span>
                </div>
                <div className="mt-1 text-[10px] cx-text-faint">{row.analysis?.direction || 'NEUTRAL'} · {row.analysis?.trade_timing?.status || 'WAIT'}</div>
                <div className="mt-2 text-xs cx-text-muted line-clamp-2">{firstBlocker(row.analysis)}</div>
                <div className="mt-3 text-[10px] cx-text-faint">{formatAge(row.analysis?.data_freshness_seconds)}</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {validation && (
        <section className="rounded-[20px] border border-violet-400/15 cx-bg-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] font-black tracking-[0.2em] text-violet-300">
                WALK-FORWARD VALIDATION · EURUSD {timeframe} · {validation.history?.years.toFixed(1) || '0.0'} YEARS
              </div>
              <h2 className="mt-1 text-lg font-black">Out-of-sample evidence</h2>
            </div>
            <span className={`rounded-md px-2 py-1 text-[9px] font-black ${validation.validation.status === 'PROMISING' ? 'bg-emerald-400/10 text-emerald-300' : validation.validation.status === 'REJECT' ? 'bg-rose-400/10 text-rose-300' : 'bg-amber-400/10 text-amber-300'}`}>
              {validation.validation.status.replace(/_/g, ' ')}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-3">
            <Metric label="TRADES" value={String(validation.overall.trades)} />
            <Metric label="WIN RATE" value={`${(validation.overall.win_rate * 100).toFixed(1)}%`} />
            <Metric label="EXPECTANCY" value={`${validation.overall.expectancy_r.toFixed(2)}R`} />
            <Metric label="OOS TRADES" value={String(validation.validation.observed_out_of_sample_trades)} />
          </div>
        </section>
      )}

      <section className="flex flex-wrap items-center gap-3 rounded-2xl border cx-border cx-bg-card p-4">
        <Filter className="h-4 w-4 cx-text-faint" />
        <FilterPill label="Direction" options={[{ v: 'all', l: 'All' }, { v: 'BUY', l: 'Bullish' }, { v: 'SELL', l: 'Bearish' }, { v: 'NEUTRAL', l: 'Neutral' }]} value={direction} onChange={(v) => setDirection(v as DirectionFilter)} accent="cyan" />
        <FilterPill label="Plan" options={[{ v: 'all', l: 'All' }, { v: 'READY', l: 'Ready' }, { v: 'WAIT', l: 'Wait' }, { v: 'BLOCKED', l: 'Blocked' }]} value={planFilter} onChange={(v) => setPlanFilter(v as PlanFilter)} accent="violet" />
        <FilterPill label="Calendar" options={[{ v: 'all', l: 'All' }, { v: 'CLEAR', l: 'Clear' }, { v: 'CAUTION', l: 'Caution' }, { v: 'BLOCKED', l: 'Blocked' }, { v: 'POST_NEWS', l: 'Post-news' }]} value={calendarFilter} onChange={(v) => setCalendarFilter(v as CalendarFilter)} accent="amber" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by symbol…" className="rounded-xl border cx-border cx-bg-input px-3 py-2 text-xs cx-text placeholder:cx-text-faint focus:border-cyan-400/40 focus:outline-none" />
        <div className="ml-auto flex items-center gap-2 text-[10px] font-black uppercase tracking-wider cx-text-faint">
          <span>Sort</span>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} className="rounded-lg border cx-border cx-bg-input px-2 py-1 text-[10px] font-black cx-text">
            <option value="plan">Heat</option>
            <option value="score">Score</option>
            <option value="pair">Symbol</option>
          </select>
        </div>
      </section>

      {globalError && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-rose-300">{globalError}</div>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {(loaded.length ? sorted : rows).map((row) => {
          if (row.loading) return <div key={row.pair} className="h-72 animate-pulse rounded-[20px] border cx-border cx-bg-card" />;
          if (row.error || !row.analysis) return (
            <div key={row.pair} className="rounded-[20px] border cx-border cx-bg-card p-5">
              <div className="flex justify-between">
                <h3 className="text-lg font-black">{row.pair}</h3>
                <span className="text-xs cx-text-faint">NO DATA</span>
              </div>
              <p className="mt-2 text-sm cx-text-faint">{row.error || 'No V2 analysis available.'}</p>
            </div>
          );
          return <ScannerCard key={row.pair} row={row} />;
        })}
        {rows.length === 0 && !globalError && <div className="col-span-full py-12 text-center cx-text-faint">{refreshing ? 'Loading V2 analysis…' : 'No markets configured.'}</div>}
      </div>

      {rows.length > 0 && sorted.length === 0 && !refreshing && (
        <div className="rounded-xl border cx-border cx-bg-card px-4 py-3 text-center text-xs cx-text-faint">Showing 0 of {rows.length} markets after filters.</div>
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1 text-[11px] cx-text-faint">
        <DataAttribution provider="Scanner" timestamp={lastUpdate} live={!refreshing} variant="inline" />
        {lastUpdate && <span>Refreshed {lastUpdate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {timeframe}</span>}
        <span>Decision support only, not financial advice.</span>
      </div>
    </div>
  );
};

const ScannerCard: React.FC<{ row: Row }> = ({ row }) => {
  const a = row.analysis!;
  const plan = a.trade_plan;
  const heat = heatScore(a);
  const label = statusLabel(a);
  const pillClass = label === 'Ready' ? 'bg-emerald-400/10 text-emerald-300' : label === 'Almost' ? 'bg-amber-400/10 text-amber-300' : label === 'Avoid' ? 'bg-rose-400/10 text-rose-300' : 'bg-cyan-400/10 text-cyan-300';
  return (
    <article className="rounded-[20px] border cx-border cx-bg-card p-5 transition hover:border-cyan-400/25">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/tradingview?symbol=${row.pair}&panel=full`} className="text-lg font-black hover:text-cyan-300">{row.pair}</Link>
            <span className={`rounded-md px-2 py-0.5 text-[9px] font-black ${a.direction === 'BUY' ? 'bg-emerald-400/10 text-emerald-300' : a.direction === 'SELL' ? 'bg-rose-400/10 text-rose-300' : 'bg-slate-400/10 cx-text-muted'}`}>{a.direction}</span>
            <span className={`rounded-md px-2 py-0.5 text-[9px] font-black ${pillClass}`}>{label} · {heat}/100</span>
            <span className="rounded-md bg-black/20 px-2 py-0.5 text-[9px] cx-text-faint">{a.trade_timing?.status || 'WAIT'}</span>
            <span className="rounded-md bg-black/20 px-2 py-0.5 text-[9px] cx-text-faint">{a.economic_calendar?.status || '—'}</span>
          </div>
          <p className="mt-1 text-xs cx-text-faint">{a.scenarios?.primary || firstBlocker(a)}</p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-black cx-text-strong">{a.total_score || 0}<span className="text-xs cx-text-faint">/100</span></div>
          <div className="text-[10px] cx-text-faint">{formatAge(a.data_freshness_seconds)}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        <MiniStat label="Entry" value={formatPrice(plan?.entry)} />
        <MiniStat label="Stop" value={formatPrice(plan?.stop ?? plan?.invalidation)} />
        <MiniStat label="TP1" value={formatPrice(plan?.targets?.[0]?.price ?? plan?.tp1)} />
        <MiniStat label="RR" value={`${Number(plan?.net_rr ?? plan?.available_rr ?? 0).toFixed(2)}R`} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] cx-text-faint">
        <span className="rounded-md cx-bg-elev px-2 py-1">Fib {String(a.zones?.fibonacci?.nearest?.ratio || '—')}</span>
        <span className="rounded-md cx-bg-elev px-2 py-1">Bias {a.market_context?.macro_bias || 'neutral'}</span>
        {a.zones?.fibonacci?.clusters?.[0] && <span className="rounded-md cx-bg-elev px-2 py-1">Cluster {a.zones.fibonacci.clusters[0].strength}×</span>}
        <Link to={`/tradingview?symbol=${row.pair}&panel=full`} className="ml-auto rounded-md bg-cyan-400/10 px-2 py-1 font-bold text-cyan-300 hover:bg-cyan-400/20">Full analysis</Link>
      </div>
    </article>
  );
};

const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl border cx-border cx-bg-card p-3">
    <div className="text-[9px] font-black tracking-widest cx-text-faint">{label}</div>
    <div className="mt-1 text-xl font-black cx-text-strong">{value}</div>
  </div>
);

const MiniStat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-lg border cx-border cx-bg-elev p-2">
    <div className="text-[9px] font-black uppercase tracking-widest cx-text-faint">{label}</div>
    <div className="mt-0.5 font-mono text-[11px] font-bold cx-text">{value}</div>
  </div>
);

const FilterPill: React.FC<{
  label: string;
  options: { v: string; l: string }[];
  value: string;
  onChange: (v: string) => void;
  accent: 'cyan' | 'violet' | 'amber';
}> = ({ label, options, value, onChange, accent }) => {
  const active = accent === 'cyan' ? 'bg-cyan-400/15 text-cyan-300' : accent === 'violet' ? 'bg-violet-400/15 text-violet-300' : 'bg-amber-400/15 text-amber-300';
  return (
    <div className="flex items-center gap-1 rounded-xl border cx-border cx-bg-input p-1 text-[10px] font-black uppercase tracking-wider">
      <span className="px-2 cx-text-faint">{label}</span>
      {options.map((opt) => (
        <button key={opt.v} onClick={() => onChange(opt.v)} className={`rounded-lg px-2 py-1 transition ${value === opt.v ? active : 'cx-text-muted hover:cx-text-strong'}`}>{opt.l}</button>
      ))}
    </div>
  );
};

export default LiveScanner;
