import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Filter, FlaskConical, Loader2, RefreshCw } from 'lucide-react';
import { bwtsApi, type CalendarGateStatus, type CryptoAnalysis, type V2BacktestReport } from '../services/bwtsApi';
import { SetupCard } from '../components/SetupCard';
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
type SortBy = 'plan' | 'score' | 'pair';

const PLAN_RANK: Record<string, number> = { STRONG: 5, VALID: 4, WATCHLIST: 3, WAIT: 2, BLOCKED: 1 };

const LiveScanner: React.FC = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [validation, setValidation] = useState<V2BacktestReport | null>(null);
  const [validating, setValidating] = useState(false);
  const [validationTimeframe, setValidationTimeframe] = useState('1h');
  const [validationDepth, setValidationDepth] = useState(20000);

  const [direction, setDirection] = useState<DirectionFilter>('all');
  const [planFilter, setPlanFilter] = useState<PlanFilter>('all');
  const [calendarFilter, setCalendarFilter] = useState<CalendarFilter>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('plan');

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
      await Promise.all(
        pairList.map(async (pair): Promise<void> => {
          let nextRow: Row;
          try {
            const analysis = await bwtsApi.cryptoAnalysis(pair);
            if (!analysis || typeof analysis !== 'object') throw new Error('Incomplete V2 analysis');
            let calendar: CalendarGateStatus | null = null;
            try {
              calendar = await bwtsApi.calendarStatus(pair);
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
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  const runValidation = async () => {
    setValidating(true);
    try {
      setValidation(await bwtsApi.v2Backtest('EURUSD', validationTimeframe, validationDepth));
    } catch (error: any) {
      setGlobalError(error?.message || 'Validation replay failed');
    } finally {
      setValidating(false);
    }
  };

  const loaded = useMemo(() => rows.filter((r) => r.analysis), [rows]);
  const eligible = loaded.filter((r) => r.analysis?.trade_plan?.eligible).length;
  const buyCount = loaded.filter((r) => r.analysis?.direction === 'BUY').length;
  const sellCount = loaded.filter((r) => r.analysis?.direction === 'SELL').length;
  const average = loaded.length
    ? Math.round(loaded.reduce((sum, r) => sum + (r.analysis?.total_score || 0), 0) / loaded.length)
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
      list.sort(
        (a, b) =>
          (PLAN_RANK[b.analysis!.trade_plan?.status || ''] || 0) -
          (PLAN_RANK[a.analysis!.trade_plan?.status || ''] || 0)
      );
    }
    return list;
  }, [filtered, sortBy]);

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[24px] border border-violet-400/15 bg-[#090d18] bg-gradient-to-br from-violet-500/10 to-cyan-500/[0.04] p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-[10px] font-black tracking-[0.22em] text-cyan-300">
              V2 MARKET INTELLIGENCE
            </div>
            <h1 className="mt-2 flex items-center gap-3 text-3xl font-black text-white">
              <Activity className="h-7 w-7 text-cyan-300" /> Live Scanner
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              One engine for score, direction, movement, and trade eligibility.{' '}
              {lastUpdate && (
                <span className="ml-2 inline-block">
                  <DataAttribution
                    provider="Scanner"
                    timestamp={lastUpdate}
                    live={!refreshing}
                    variant="inline"
                  />
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={validationTimeframe}
              onChange={(event) => setValidationTimeframe(event.target.value)}
              disabled={validating}
              className="rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-xs text-slate-300"
            >
              <option value="15m">15m</option>
              <option value="1h">1h</option>
              <option value="4h">4h</option>
            </select>
            <select
              value={validationDepth}
              onChange={(event) => setValidationDepth(Number(event.target.value))}
              disabled={validating}
              className="rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-xs text-slate-300"
            >
              <option value={5000}>5K bars</option>
              <option value={10000}>10K bars</option>
              <option value={20000}>20K bars</option>
            </select>
            <button
              onClick={runValidation}
              disabled={validating}
              className="flex items-center gap-2 rounded-xl border border-violet-400/20 bg-violet-400/10 px-4 py-2.5 text-xs font-black text-violet-200 transition hover:bg-violet-400/15 disabled:opacity-50"
            >
              <FlaskConical className={`h-4 w-4 ${validating ? 'animate-pulse' : ''}`} />
              {validating ? `Replaying ${validationDepth.toLocaleString()} bars` : 'Run validation'}
            </button>
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
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="MARKETS" value={String(rows.length)} />
          <Metric label="ELIGIBLE PLANS" value={String(eligible)} />
          <Metric label="BIAS" value={`${buyCount} buy · ${sellCount} sell`} />
          <Metric label="AVERAGE SCORE" value={`${average}/100`} />
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.07] bg-[#090d18] p-4">
        <Filter className="h-4 w-4 text-slate-500" />
        <FilterPill
          label="Direction"
          options={[
            { v: 'all', l: 'All' },
            { v: 'BUY', l: 'Bullish' },
            { v: 'SELL', l: 'Bearish' },
            { v: 'NEUTRAL', l: 'Neutral' },
          ]}
          value={direction}
          onChange={(v) => setDirection(v as DirectionFilter)}
          accent="cyan"
        />
        <FilterPill
          label="Plan"
          options={[
            { v: 'all', l: 'All' },
            { v: 'READY', l: 'Ready' },
            { v: 'WAIT', l: 'Wait' },
            { v: 'BLOCKED', l: 'Blocked' },
          ]}
          value={planFilter}
          onChange={(v) => setPlanFilter(v as PlanFilter)}
          accent="violet"
        />
        <FilterPill
          label="Calendar"
          options={[
            { v: 'all', l: 'All' },
            { v: 'CLEAR', l: 'Clear' },
            { v: 'CAUTION', l: 'Caution' },
            { v: 'BLOCKED', l: 'Blocked' },
            { v: 'POST_NEWS', l: 'Post-news' },
          ]}
          value={calendarFilter}
          onChange={(v) => setCalendarFilter(v as CalendarFilter)}
          accent="amber"
        />
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
            <option value="plan">Plan status</option>
            <option value="score">Score</option>
            <option value="pair">Symbol</option>
          </select>
        </div>
      </section>

      {globalError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-rose-300">
          {globalError}
        </div>
      )}

      {validation && (
        <section className="rounded-[20px] border border-violet-400/15 bg-[#090d18] p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] font-black tracking-[0.2em] text-violet-300">
                WALK-FORWARD VALIDATION · {validation.pair} {validation.timeframe} ·{' '}
                {validation.history?.years.toFixed(1) || '0.0'} YEARS
              </div>
              <h2 className="mt-1 text-lg font-black">Out-of-sample evidence</h2>
            </div>
            <span
              className={`rounded-md px-2 py-1 text-[9px] font-black ${
                validation.validation.status === 'PROMISING'
                  ? 'bg-emerald-400/10 text-emerald-300'
                  : validation.validation.status === 'REJECT'
                  ? 'bg-rose-400/10 text-rose-300'
                  : 'bg-amber-400/10 text-amber-300'
              }`}
            >
              {validation.validation.status.replace(/_/g, ' ')}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-3">
            <Metric label="TRADES" value={String(validation.overall.trades)} />
            <Metric label="WIN RATE" value={`${(validation.overall.win_rate * 100).toFixed(1)}%`} />
            <Metric label="EXPECTANCY" value={`${validation.overall.expectancy_r.toFixed(2)}R`} />
            <Metric
              label="OOS TRADES"
              value={String(validation.validation.observed_out_of_sample_trades)}
            />
          </div>
          <p className="mt-3 text-[10px] text-slate-500">{validation.validation.warning}</p>
        </section>
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
              calendar={row.calendar}
              variant="full"
              to="/tradingview"
              timestamp={lastUpdate?.toISOString()}
              showSparkline={false}
            />
          );
        })}
        {rows.length === 0 && !globalError && (
          <div className="col-span-full py-12 text-center text-slate-500">
            {refreshing ? 'Loading V2 analysis…' : 'No markets configured.'}
          </div>
        )}
      </div>

      {rows.length > 0 && sorted.length === 0 && !refreshing && (
        <div className="rounded-xl border border-white/[0.06] bg-[#090d18] px-4 py-3 text-center text-xs text-slate-500">
          Showing 0 of {rows.length} markets after filters.
        </div>
      )}
    </div>
  );
};

const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
    <div className="text-[9px] font-black tracking-widest text-slate-500">{label}</div>
    <div className="mt-1 text-xl font-black text-white">{value}</div>
  </div>
);

const FilterPill: React.FC<{
  label: string;
  options: { v: string; l: string }[];
  value: string;
  onChange: (v: string) => void;
  accent: 'cyan' | 'violet' | 'amber';
}> = ({ label, options, value, onChange, accent }) => {
  const active =
    accent === 'cyan'
      ? 'bg-cyan-400/15 text-cyan-200'
      : accent === 'violet'
      ? 'bg-violet-400/15 text-violet-200'
      : 'bg-amber-400/15 text-amber-200';
  return (
    <div className="flex items-center gap-1 rounded-xl border border-white/[0.07] bg-black/20 p-1 text-[10px] font-black uppercase tracking-wider">
      <span className="px-2 text-slate-500">{label}</span>
      {options.map((opt) => (
        <button
          key={opt.v}
          onClick={() => onChange(opt.v)}
          className={`rounded-lg px-2 py-1 transition ${
            value === opt.v ? active : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {opt.l}
        </button>
      ))}
    </div>
  );
};

export default LiveScanner;