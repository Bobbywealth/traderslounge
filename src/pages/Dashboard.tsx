import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowRight, BarChart3, CheckCircle2, Clock3, Flame, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { bwtsApi, planReasonText, type CalendarGateStatus, type CryptoAnalysis, type DashboardSnapshot } from '../services/bwtsApi';
import DataAttribution from '../components/DataAttribution';

type MarketRow = DashboardSnapshot['markets'][number] & { heat: number; blocker: string; statusLabel: string };
type FeedState = 'LOADING' | 'LIVE' | 'DEGRADED' | 'OFFLINE';

const uniqueMarkets = (markets: DashboardSnapshot['markets'] = []) => {
  const seen = new Set<string>();
  return markets.filter((market) => {
    const pair = String(market?.signal?.pair || market?.analysis?.pair || '').toUpperCase();
    if (!pair || seen.has(pair) || !market?.analysis) return false;
    seen.add(pair);
    return true;
  });
};

const firstBlocker = (analysis?: CryptoAnalysis) => {
  const planReason = (analysis?.trade_plan?.reasons || []).map(planReasonText).find(Boolean);
  const wait = analysis?.trade_timing?.wait_for?.[0]?.replace(/_/g, ' ');
  const avoid = analysis?.trade_timing?.avoid_reasons?.[0]?.replace(/_/g, ' ');
  const block = analysis?.trade_plan?.blocking_reasons?.[0]?.message;
  return planReason || block || avoid || wait || 'Waiting for cleaner confirmation';
};

const heatScore = (analysis?: CryptoAnalysis) => {
  if (!analysis) return 0;
  const base = Number(analysis.total_score || 0);
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
  if ((analysis.total_score || 0) >= 55) return 'Almost';
  if ((analysis.total_score || 0) >= 35) return 'Building';
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

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [calendar, setCalendar] = useState<CalendarGateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    setError(null);
    try {
      const protectedSnapshot = Promise.race([
        bwtsApi.dashboardSnapshot(),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('Protected snapshot timed out')), 8000)),
      ]);
      const data = await protectedSnapshot.catch(() => bwtsApi.publicDashboardSnapshot());
      setSnapshot(data);
      setUpdatedAt(new Date(data.generated_at || Date.now()));
      const top = uniqueMarkets(data.markets).sort((a, b) => heatScore(b.analysis) - heatScore(a.analysis))[0];
      if (top?.signal?.pair) {
        bwtsApi.calendarStatus(top.signal.pair).then(setCalendar).catch(() => setCalendar(null));
      }
    } catch (err: any) {
      setError(err?.message || 'Dashboard snapshot failed to load');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(() => load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const markets = useMemo<MarketRow[]>(() => uniqueMarkets(snapshot?.markets).map((market) => ({
    ...market,
    heat: heatScore(market.analysis),
    blocker: firstBlocker(market.analysis),
    statusLabel: statusLabel(market.analysis),
  })), [snapshot]);

  const hot = useMemo(() => [...markets].sort((a, b) => b.heat - a.heat), [markets]);
  const active = hot.filter((row) => row.analysis?.trade_plan?.eligible);
  const forming = hot.filter((row) => !row.analysis?.trade_plan?.eligible && (row.analysis?.total_score || 0) >= 35).slice(0, 6);
  const strongest = hot[0];
  const feedState: FeedState = loading ? 'LOADING' : error && !markets.length ? 'OFFLINE' : error ? 'DEGRADED' : 'LIVE';
  const providerHealth = snapshot?.provider_health as any;
  const buyCount = markets.filter((m) => m.analysis?.direction === 'BUY').length;
  const sellCount = markets.filter((m) => m.analysis?.direction === 'SELL').length;
  const avgScore = markets.length ? Math.round(markets.reduce((sum, row) => sum + (row.analysis?.total_score || 0), 0) / markets.length) : 0;
  const blockers = useMemo(() => {
    const counts = new Map<string, number>();
    markets.forEach((row) => counts.set(row.blocker, (counts.get(row.blocker) || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [markets]);

  return (
    <div className="space-y-6 pb-8 text-slate-100">
      <section className="relative overflow-hidden rounded-[28px] border border-cyan-400/15 bg-[#070b14] bg-gradient-to-br from-cyan-500/10 via-violet-500/[0.06] to-transparent p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-[10px] font-black tracking-[0.22em] text-cyan-300">MARKET COMMAND CENTER</span>
              <FeedBadge state={feedState} />
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">What is hot right now, {user?.name?.split(' ')[0] || 'Trader'}?</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
              One clean readout for trade readiness, forming setups, blockers, session risk, and where to click next. No broker clutter, no fake trade rows.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { bwtsApi.clearCache(); load(true); }} disabled={refreshing} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-xs font-black text-slate-200 transition hover:bg-white/[0.08] disabled:opacity-50">
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
            </button>
            <Link to="/scanner" className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 px-4 py-2.5 text-xs font-black text-[#05070d]"><Flame className="h-4 w-4" /> Hot scanner</Link>
            <Link to="/tradingview" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-xs font-black text-slate-200"><BarChart3 className="h-4 w-4" /> Chart</Link>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="Markets scanned" value={loading ? '...' : String(markets.length)} />
          <Metric label="Ready now" value={String(active.length)} accent="emerald" />
          <Metric label="Forming" value={String(forming.length)} accent="amber" />
          <Metric label="Bias" value={`${buyCount} buy · ${sellCount} sell`} />
          <Metric label="Avg score" value={`${avgScore}/100`} />
        </div>
      </section>

      {error && <div className="flex items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.07] p-4 text-sm text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4" /><span><b>Dashboard degraded:</b> {error}</span></div>}

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-[24px] border border-white/[0.08] bg-[#090d18] p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div><div className="text-[10px] font-black tracking-[0.2em] text-emerald-300">DECISION NOW</div><h2 className="mt-1 text-2xl font-black">{active.length ? 'Qualified setup available' : 'No active trade right now'}</h2></div>
            {strongest && <span className="rounded-xl bg-white/[0.05] px-3 py-1 text-xs font-black text-slate-300">Closest: {strongest.signal.pair} · {strongest.analysis.total_score}/100</span>}
          </div>
          {loading && !markets.length ? <SkeletonRows /> : active[0] ? <ReadySetup row={active[0]} /> : strongest ? (
            <div className="rounded-2xl border border-amber-400/15 bg-amber-400/[0.05] p-5">
              <div className="flex flex-wrap items-center gap-3"><span className="text-2xl font-black">{strongest.signal.pair}</span><HeatBadge row={strongest} /><DirectionBadge direction={strongest.analysis.direction} /></div>
              <p className="mt-3 text-sm text-slate-300"><b className="text-amber-200">Waiting for:</b> {strongest.blocker}</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <MiniStat label="Score" value={`${strongest.analysis.total_score}/100`} />
                <MiniStat label="Timing" value={strongest.analysis.trade_timing?.status || 'WAIT'} />
                <MiniStat label="Nearest Fib" value={String(strongest.analysis.zones?.fibonacci?.nearest?.ratio || '—')} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2"><Link to={`/analysis/${strongest.signal.pair}`} className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-black text-slate-200">Analyze</Link><Link to="/tradingview" className="rounded-lg bg-cyan-400 px-3 py-2 text-xs font-black text-[#05070d]">Open chart</Link></div>
            </div>
          ) : <EmptyState title="Scanner data unavailable" detail="The command center will populate when the dashboard snapshot returns market rows." />}
        </div>

        <div className="rounded-[24px] border border-white/[0.08] bg-[#090d18] p-5">
          <div className="text-[10px] font-black tracking-[0.2em] text-violet-300">MARKET CONDITIONS</div>
          <div className="mt-4 space-y-3 text-sm">
            <Condition label="Market data" value={String(providerHealth?.market_data || 'checking')} good={String(providerHealth?.market_data).toLowerCase() === 'ok'} />
            <Condition label="Calendar" value={String(providerHealth?.calendar || 'checking')} good={String(providerHealth?.calendar).toUpperCase() === 'LIVE'} />
            <Condition label="News risk" value={`${snapshot?.economic_event_risk?.level || 'unknown'}${snapshot?.economic_event_risk?.high_impact_count ? ` · ${snapshot.economic_event_risk.high_impact_count} high impact` : ''}`} good={snapshot?.economic_event_risk?.level !== 'blocked'} />
            <Condition label="Top calendar" value={calendar?.status || 'checking'} good={calendar?.status === 'CLEAR'} />
            <Condition label="Snapshot" value={updatedAt ? updatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'loading'} good={feedState === 'LIVE'} />
          </div>
        </div>
      </section>

      <section className="rounded-[24px] border border-white/[0.08] bg-[#090d18] p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div><div className="text-[10px] font-black tracking-[0.2em] text-orange-300">HOT RIGHT NOW</div><h2 className="mt-1 text-xl font-black">Markets ranked by readiness</h2></div>
          <Link to="/scanner" className="inline-flex items-center gap-1 text-xs font-bold text-slate-400 hover:text-slate-200">Full scanner <ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {hot.slice(0, 8).map((row) => <HotMarketCard key={row.signal.pair} row={row} />)}
          {loading && !hot.length && <SkeletonRows />}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-[24px] border border-white/[0.08] bg-[#090d18] p-5">
          <div className="mb-4"><div className="text-[10px] font-black tracking-[0.2em] text-cyan-300">FORMING SETUPS</div><h2 className="mt-1 text-xl font-black">Closest to qualifying</h2></div>
          <div className="space-y-3">{forming.length ? forming.map((row) => <QueueRow key={row.signal.pair} row={row} />) : <EmptyState title="Nothing forming yet" detail="No market is above watchlist quality right now." />}</div>
        </div>
        <div className="rounded-[24px] border border-white/[0.08] bg-[#090d18] p-5">
          <div className="mb-4"><div className="text-[10px] font-black tracking-[0.2em] text-rose-300">WHAT IS BLOCKING TRADES?</div><h2 className="mt-1 text-xl font-black">Top wait reasons</h2></div>
          <div className="space-y-3">{blockers.map(([reason, count]) => <div key={reason} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"><div className="flex items-center justify-between gap-4"><span className="text-sm font-semibold text-slate-300">{reason}</span><b className="text-amber-300">{count}</b></div></div>)}</div>
        </div>
      </section>

      <section className="rounded-[24px] border border-white/[0.08] bg-[#090d18] p-5">
        <div className="mb-4 flex items-center justify-between"><div><div className="text-[10px] font-black tracking-[0.2em] text-emerald-300">ACTIVE SIGNALS</div><h2 className="mt-1 text-xl font-black">Qualified calls only</h2></div><Link to="/signals" className="text-xs font-bold text-slate-400 hover:text-slate-200">Signals page</Link></div>
        {active.length ? active.map((row) => <ReadySetup key={row.signal.pair} row={row} compact />) : <EmptyState title="No qualified calls right now" detail="That is good. ConfluenceX should wait until every rule passes instead of forcing trades." />}
      </section>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1 text-[11px] text-slate-600">
        <DataAttribution provider="Scanner" timestamp={updatedAt} live={feedState === 'LIVE'} variant="inline" />
        <span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />Auto-refresh every 30s</span>
        <span>Engine {snapshot?.model_version || 'V2'}</span>
        <span>Decision support only, not financial advice.</span>
      </div>
    </div>
  );
};

const FeedBadge: React.FC<{ state: FeedState }> = ({ state }) => {
  const classes = state === 'LIVE' ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' : state === 'OFFLINE' ? 'border-rose-400/20 bg-rose-400/10 text-rose-300' : state === 'DEGRADED' ? 'border-amber-400/20 bg-amber-400/10 text-amber-300' : 'border-slate-400/20 bg-slate-400/10 text-slate-300';
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[9px] font-black tracking-widest ${classes}`}>{state === 'LIVE' ? <CheckCircle2 className="h-3 w-3" /> : state === 'LOADING' ? <Activity className="h-3 w-3 animate-pulse" /> : <ShieldAlert className="h-3 w-3" />}{state}</span>;
};

const Metric: React.FC<{ label: string; value: string; accent?: 'emerald' | 'amber' }> = ({ label, value, accent }) => <div className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-4"><div className="text-[9px] font-black tracking-widest text-slate-500">{label}</div><div className={`mt-2 text-2xl font-black ${accent === 'emerald' ? 'text-emerald-300' : accent === 'amber' ? 'text-amber-300' : 'text-white'}`}>{value}</div></div>;
const MiniStat: React.FC<{ label: string; value: string }> = ({ label, value }) => <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3"><div className="text-[9px] font-black uppercase tracking-widest text-slate-600">{label}</div><div className="mt-1 font-mono text-sm font-bold text-slate-200">{value}</div></div>;
const DirectionBadge: React.FC<{ direction: string }> = ({ direction }) => <span className={`rounded-lg px-2 py-1 text-[10px] font-black ${direction === 'BUY' ? 'bg-emerald-400/10 text-emerald-300' : direction === 'SELL' ? 'bg-rose-400/10 text-rose-300' : 'bg-slate-400/10 text-slate-400'}`}>{direction}</span>;
const HeatBadge: React.FC<{ row: MarketRow }> = ({ row }) => <span className={`rounded-lg px-2 py-1 text-[10px] font-black ${row.statusLabel === 'Ready' ? 'bg-emerald-400/10 text-emerald-300' : row.statusLabel === 'Almost' ? 'bg-amber-400/10 text-amber-300' : row.statusLabel === 'Avoid' ? 'bg-rose-400/10 text-rose-300' : 'bg-cyan-400/10 text-cyan-300'}`}>{row.statusLabel} · {row.heat}/100 heat</span>;
const Condition: React.FC<{ label: string; value: string; good?: boolean }> = ({ label, value, good }) => <div className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2"><span className="text-slate-500">{label}</span><b className={good ? 'text-emerald-300' : 'text-amber-300'}>{value}</b></div>;

const ReadySetup: React.FC<{ row: MarketRow; compact?: boolean }> = ({ row, compact }) => {
  const plan = row.analysis.trade_plan;
  return <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4"><div className="flex flex-wrap items-center gap-3"><span className="text-xl font-black">{row.signal.pair}</span><DirectionBadge direction={row.analysis.direction} /><HeatBadge row={row} /></div>{!compact && <p className="mt-2 text-sm text-slate-300">{row.analysis.scenarios?.primary || 'Setup passed every entry rule.'}</p>}<div className="mt-3 grid gap-2 sm:grid-cols-4"><MiniStat label="Entry" value={formatPrice(plan?.entry)} /><MiniStat label="Stop" value={formatPrice(plan?.stop ?? plan?.invalidation)} /><MiniStat label="TP1" value={formatPrice(plan?.targets?.[0]?.price ?? plan?.tp1)} /><MiniStat label="RR" value={`${Number(plan?.net_rr ?? plan?.available_rr ?? 0).toFixed(2)}R`} /></div></div>;
};

const HotMarketCard: React.FC<{ row: MarketRow }> = ({ row }) => <article className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 transition hover:border-cyan-400/25 hover:bg-white/[0.04]"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><span className="text-lg font-black">{row.signal.pair}</span><DirectionBadge direction={row.analysis.direction} /><HeatBadge row={row} /></div><p className="mt-2 line-clamp-2 text-xs text-slate-500">{row.blocker}</p></div><div className="text-right"><div className="text-2xl font-black text-white">{row.analysis.total_score}<span className="text-xs text-slate-600">/100</span></div><div className="text-[10px] text-slate-600">{formatAge(row.analysis.data_freshness_seconds)}</div></div></div><div className="mt-3 flex flex-wrap gap-2 text-[10px] text-slate-400"><span className="rounded-md bg-black/20 px-2 py-1">Timing {row.analysis.trade_timing?.status || 'WAIT'}</span><span className="rounded-md bg-black/20 px-2 py-1">Fib {String(row.analysis.zones?.fibonacci?.nearest?.ratio || '—')}</span><span className="rounded-md bg-black/20 px-2 py-1">Calendar {row.analysis.economic_calendar?.status || '—'}</span></div><div className="mt-3 flex gap-2"><Link to={`/analysis/${row.signal.pair}`} className="text-xs font-bold text-cyan-300 hover:text-cyan-200">Analyze</Link><Link to="/tradingview" className="text-xs font-bold text-violet-300 hover:text-violet-200">Chart</Link></div></article>;
const QueueRow: React.FC<{ row: MarketRow }> = ({ row }) => <div className="grid items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 sm:grid-cols-[1fr_auto]"><div><div className="flex flex-wrap items-center gap-2"><span className="font-black">{row.signal.pair}</span><HeatBadge row={row} /></div><p className="mt-1 text-xs text-slate-500">{row.blocker}</p></div><div className="text-right"><div className="font-black text-white">{row.analysis.total_score}/60</div><div className="text-[10px] text-slate-600">to qualify</div></div></div>;
const EmptyState: React.FC<{ title: string; detail: string }> = ({ title, detail }) => <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center"><div className="font-black text-slate-300">{title}</div><p className="mt-1 text-sm text-slate-500">{detail}</p></div>;
const SkeletonRows = () => <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-white/[0.035]" />)}</div>;

export default Dashboard;
