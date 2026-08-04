import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, CheckCircle2, Clock3, Flame, History, Loader2, RefreshCw, ShieldAlert, XCircle, Zap,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { bwtsApi, planReasonText, type CalendarGateStatus, type CryptoAnalysis, type DashboardSnapshot, type PublishedSignal } from '../services/bwtsApi';
import DataAttribution from '../components/DataAttribution';

type MarketRow = DashboardSnapshot['markets'][number] & { heat: number; blocker: string; statusLabel: string };
type FeedState = 'LOADING' | 'LIVE' | 'DEGRADED' | 'OFFLINE';
type Tab = 'hot' | 'all' | 'signals' | 'history';
type DirectionFilter = 'all' | 'BUY' | 'SELL' | 'NEUTRAL';

const uniqueMarkets = (markets: DashboardSnapshot['markets'] = []) => {
  const seen = new Set<string>();
  return markets.filter((market) => {
    const pair = String(market?.signal?.pair || market?.analysis?.pair || '').toUpperCase();
    if (!pair || seen.has(pair) || !market?.analysis) return false;
    seen.add(pair);
    return true;
  });
};

const SCORE_FLOOR = 60;
const NET_R_FLOOR = 2.0;
const BLOCKING_CALENDAR = new Set(['BLOCKED', 'POST_NEWS']);

const gateScore = (analysis?: CryptoAnalysis) => {
  const score = Number(analysis?.total_score || 0);
  return { label: 'Score', value: `${score}/100`, pass: score >= SCORE_FLOOR, note: score >= SCORE_FLOOR ? `≥ ${SCORE_FLOOR} floor` : `< ${SCORE_FLOOR} floor` };
};
const gateTiming = (analysis?: CryptoAnalysis) => {
  const status = analysis?.trade_timing?.status || 'WAIT';
  return { label: 'Timing', value: status, pass: status === 'READY', note: status === 'READY' ? 'gates cleared' : status === 'AVOID' ? 'hard avoid' : 'still confirming' };
};
const gateCalendar = (analysis?: CryptoAnalysis) => {
  const status = String(analysis?.economic_calendar?.status || 'CLEAR').toUpperCase();
  return { label: 'Calendar', value: status, pass: !BLOCKING_CALENDAR.has(status), note: BLOCKING_CALENDAR.has(status) ? 'news blackout' : 'no blackout' };
};
const gateNetR = (analysis?: CryptoAnalysis) => {
  const plan = analysis?.trade_plan;
  const net = Number(plan?.net_rr ?? plan?.available_rr ?? 0);
  return { label: 'Net R', value: `${net.toFixed(2)}R`, pass: Number.isFinite(net) && net >= NET_R_FLOOR, note: Number.isFinite(net) && net >= NET_R_FLOOR ? `≥ ${NET_R_FLOOR} floor` : `< ${NET_R_FLOOR} floor · cost-adjusted` };
};

const formatAsOf = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
  const [signals, setSignals] = useState<PublishedSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [tab, setTab] = useState<Tab>('hot');
  const [timeframe, setTimeframe] = useState<'15m' | '1h' | '4h' | '1d'>('1h');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = params.get('tab');
    if (next === 'hot' || next === 'all' || next === 'signals' || next === 'history') setTab(next);
  }, []);
  const [direction, setDirection] = useState<DirectionFilter>('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    setError(null);
    try {
      const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string) => Promise.race([
        promise,
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
      ]);
      const [snapshotResult, published] = await Promise.allSettled([
        withTimeout(bwtsApi.dashboardSnapshot(), 30_000, 'dashboard snapshot'),
        bwtsApi.publishedSignals({ limit: 50 }).catch(() => ({ signals: [], count: 0, source: 'fallback' })),
      ]);
      if (snapshotResult.status !== 'fulfilled') {
        throw (snapshotResult.reason as Error) || new Error('snapshot unavailable');
      }
      const data = snapshotResult.value as DashboardSnapshot;
      const markets = uniqueMarkets(data.markets);
      const publishedList = published.status === 'fulfilled' ? (published.value.signals || []) : [];
      setSnapshot(data);
      setUpdatedAt(new Date(data.generated_at || Date.now()));
      setSignals(publishedList);
      const top = [...markets].sort((a, b) => heatScore(b.analysis) - heatScore(a.analysis))[0];
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

  const filteredMarkets = useMemo(() => {
    const term = search.trim().toLowerCase();
    return hot.filter((row) => {
      if (direction !== 'all' && row.analysis?.direction !== direction) return false;
      if (term && !row.signal.pair.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [hot, direction, search]);

  const tabs: { id: Tab; label: string; count: number; icon: React.ElementType }[] = [
    { id: 'hot', label: 'Hot Now', count: hot.length, icon: Flame },
    { id: 'all', label: 'All Markets', count: markets.length, icon: Activity },
    { id: 'signals', label: 'Active Signals', count: active.length, icon: Zap },
    { id: 'history', label: 'Signal History', count: signals.length, icon: History },
  ];

  return (
    <div className="space-y-6 pb-8 cx-text">
      <section className="relative overflow-hidden rounded-[28px] border border-cyan-400/15 cx-bg-app bg-gradient-to-br from-cyan-500/10 via-violet-500/[0.06] to-transparent p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-[10px] font-black tracking-[0.22em] text-cyan-300">MARKET COMMAND CENTER</span>
              <FeedBadge state={feedState} />
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">What is hot right now, {user?.name?.split(' ')[0] || 'Trader'}?</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed cx-text-muted">
              One clean readout for trade readiness, forming setups, blockers, session risk, and where to click next. Tab through active signals and history without leaving the dashboard.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { bwtsApi.clearCache(); load(true); }} disabled={refreshing} className="inline-flex items-center gap-2 rounded-xl border cx-border-strong cx-bg-card-hover px-4 py-2.5 text-xs font-black cx-text transition hover:bg-white/[0.08] disabled:opacity-50">
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
            </button>
            <Link to="/tradingview" className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 px-4 py-2.5 text-xs font-black text-[#05070d]"><BarChart3 className="h-4 w-4" /> Open chart</Link>
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
        <div className="rounded-[24px] border cx-border cx-bg-card p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div><div className="text-[10px] font-black tracking-[0.2em] text-emerald-300">DECISION NOW</div><h2 className="mt-1 text-2xl font-black">{active.length ? 'Qualified setup available' : 'No active trade right now'}</h2></div>
            {strongest && <span className="rounded-xl cx-bg-card-hover px-3 py-1 text-xs font-black cx-text-muted">Closest: {strongest.signal.pair} · {strongest.analysis.total_score}/100</span>}
          </div>
          {loading && !markets.length ? <SkeletonRows /> : active[0] ? <ReadySetup row={active[0]} /> : strongest ? (
            <DecisionNowBlocked row={strongest} snapshot={snapshot} />
          ) : <EmptyState title="Scanner data unavailable" detail="The command center will populate when the dashboard snapshot returns market rows." />}
        </div>

        <div className="rounded-[24px] border cx-border cx-bg-card p-5">
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

      <section className="rounded-[24px] border cx-border cx-bg-card p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {tabs.map(({ id, label, count, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black transition ${tab === id ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-300' : 'cx-border cx-bg-card-hover cx-text-muted hover:cx-text'}`}>
              <Icon className="h-3.5 w-3.5" /> {label} <span className="rounded-md cx-bg-elev px-1.5 py-0.5 text-[10px]">{count}</span>
            </button>
          ))}
        </div>

        {tab === 'hot' && (
          <div className="grid gap-3 lg:grid-cols-2">
            {hot.slice(0, 8).map((row) => <HotMarketCard key={row.signal.pair} row={row} />)}
            {loading && !hot.length && <SkeletonRows />}
          </div>
        )}

        {tab === 'all' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 cx-text-muted">
              <div className="flex items-center gap-1 rounded-xl border cx-border cx-bg-input p-1 text-[10px] font-black uppercase tracking-wider">
                <span className="px-2 cx-text-faint">Timeframe</span>
                {(['15m', '1h', '4h', '1d'] as const).map((tf) => (
                  <button key={tf} onClick={() => setTimeframe(tf)} className={`rounded-lg px-2 py-1 transition ${timeframe === tf ? 'bg-cyan-400/15 text-cyan-300' : 'cx-text-muted hover:cx-text-strong'}`}>{tf}</button>
                ))}
              </div>
              <span className="mx-2 h-5 w-px cx-border" />
              <button onClick={() => setDirection('all')} className={`rounded-lg border px-2 py-1 text-[10px] font-black ${direction === 'all' ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-300' : 'cx-border'}`}>All</button>
              <button onClick={() => setDirection('BUY')} className={`rounded-lg border px-2 py-1 text-[10px] font-black ${direction === 'BUY' ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' : 'cx-border'}`}>Bullish</button>
              <button onClick={() => setDirection('SELL')} className={`rounded-lg border px-2 py-1 text-[10px] font-black ${direction === 'SELL' ? 'border-rose-400/40 bg-rose-400/10 text-rose-300' : 'cx-border'}`}>Bearish</button>
              <button onClick={() => setDirection('NEUTRAL')} className={`rounded-lg border px-2 py-1 text-[10px] font-black ${direction === 'NEUTRAL' ? 'border-slate-400/40 bg-slate-400/10 cx-text' : 'cx-border'}`}>Neutral</button>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by symbol…" className="cx-input ml-auto" />
            </div>
            <div className="text-[10px] cx-text-faint">Showing {filteredMarkets.length} of {hot.length} markets · {timeframe}</div>
            <div className="grid gap-3 lg:grid-cols-2">
              {filteredMarkets.map((row) => <HotMarketCard key={row.signal.pair} row={row} />)}
            </div>
            {!loading && !filteredMarkets.length && <EmptyState title="No markets match" detail="Adjust direction filter or search." />}
          </div>
        )}

        {tab === 'signals' && (
          <div className="space-y-3">
            {active.length ? active.map((row) => <ReadySetup key={row.signal.pair} row={row} compact />) : (
              <EmptyState title="No qualified calls right now" detail="That is good. ConfluenceX should wait until every rule passes instead of forcing trades." />
            )}
          </div>
        )}

        {tab === 'history' && (
          <div className="space-y-3">
            {signals.length === 0 && <EmptyState title="No published signals yet" detail="Qualified calls publish here once the engine confirms them across timeframes." />}
            {signals.map((sig) => (
              <div key={sig.id} className="rounded-2xl border cx-border cx-bg-card p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-black">{sig.pair}</span>
                  <span className={`rounded-lg px-2 py-1 text-[10px] font-black ${sig.direction === 'BUY' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-rose-400/10 text-rose-300'}`}>{sig.direction}</span>
                  <span className="rounded-md bg-black/20 px-2 py-1 text-[10px] cx-text-muted">{sig.timeframe}</span>
                  <span className="rounded-md bg-black/20 px-2 py-1 text-[10px] cx-text-muted">Score {sig.score}</span>
                  <span className="ml-auto text-[10px] cx-text-faint">{new Date(sig.published_at).toLocaleString()}</span>
                </div>
                <p className="mt-2 text-xs cx-text-muted">{sig.scenario || 'Qualified call'}</p>
                <div className="mt-3 grid grid-cols-4 gap-2 text-[10px]">
                  <MiniStat label="Entry" value={formatPrice(sig.entry)} />
                  <MiniStat label="Stop" value={formatPrice(sig.stop_loss)} />
                  <MiniStat label="TP1" value={formatPrice(sig.tp1)} />
                  <MiniStat label="Status" value={sig.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-[24px] border cx-border cx-bg-card p-5">
          <div className="mb-4"><div className="text-[10px] font-black tracking-[0.2em] text-cyan-300">FORMING SETUPS</div><h2 className="mt-1 text-xl font-black">Closest to qualifying</h2></div>
          <div className="space-y-3">{forming.length ? forming.map((row) => <QueueRow key={row.signal.pair} row={row} />) : <EmptyState title="Nothing forming yet" detail="No market is above watchlist quality right now." />}</div>
        </div>
        <div className="rounded-[24px] border cx-border cx-bg-card p-5">
          <div className="mb-4"><div className="text-[10px] font-black tracking-[0.2em] text-rose-300">WHAT IS BLOCKING TRADES?</div><h2 className="mt-1 text-xl font-black">Top wait reasons</h2></div>
          <div className="space-y-3">{blockers.length ? blockers.map(([reason, count]) => <div key={reason} className="rounded-2xl border cx-border cx-bg-card p-4"><div className="flex items-center justify-between gap-4"><span className="text-sm font-semibold cx-text-muted">{reason}</span><b className="text-amber-300">{count}</b></div></div>) : <EmptyState title="Nothing blocking" detail="All markets are in a clean state." />}</div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1 text-[11px] cx-text-faint">
        <DataAttribution provider="Scanner" timestamp={updatedAt} live={feedState === 'LIVE'} variant="inline" />
        <span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />Auto-refresh every 30s</span>
        <span>Engine {snapshot?.model_version || 'V2'}</span>
        <span>Decision support only, not financial advice.</span>
      </div>
    </div>
  );
};

const FeedBadge: React.FC<{ state: FeedState }> = ({ state }) => {
  const classes = state === 'LIVE' ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' : state === 'OFFLINE' ? 'border-rose-400/20 bg-rose-400/10 text-rose-300' : state === 'DEGRADED' ? 'border-amber-400/20 bg-amber-400/10 text-amber-300' : 'border-slate-400/20 bg-slate-400/10 cx-text-muted';
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[9px] font-black tracking-widest ${classes}`}>{state === 'LIVE' ? <CheckCircle2 className="h-3 w-3" /> : state === 'LOADING' ? <Activity className="h-3 w-3 animate-pulse" /> : <ShieldAlert className="h-3 w-3" />}{state}</span>;
};

const Metric: React.FC<{ label: string; value: string; accent?: 'emerald' | 'amber' }> = ({ label, value, accent }) => <div className="rounded-2xl border cx-border cx-bg-card p-4"><div className="text-[9px] font-black tracking-widest cx-text-faint">{label}</div><div className={`mt-2 text-2xl font-black ${accent === 'emerald' ? 'text-emerald-300' : accent === 'amber' ? 'text-amber-300' : 'cx-text-strong'}`}>{value}</div></div>;
const MiniStat: React.FC<{ label: string; value: string }> = ({ label, value }) => <div className="rounded-xl border cx-border cx-bg-elev p-3"><div className="text-[9px] font-black uppercase tracking-widest cx-text-faint">{label}</div><div className="mt-1 font-mono text-sm font-bold cx-text">{value}</div></div>;
const DirectionBadge: React.FC<{ direction: string; eligible?: boolean }> = ({ direction, eligible }) => {
  const muted = eligible === false;
  return <span className={`rounded-lg px-2 py-1 text-[10px] font-black ${direction === 'BUY' ? (muted ? 'bg-emerald-400/5 text-emerald-300/50 ring-1 ring-emerald-400/15' : 'bg-emerald-400/10 text-emerald-300') : direction === 'SELL' ? (muted ? 'bg-rose-400/5 text-rose-300/50 ring-1 ring-rose-400/15' : 'bg-rose-400/10 text-rose-300') : 'bg-slate-400/10 cx-text-muted'}`}>{direction}{muted ? ' · no trade' : ''}</span>;
};
const HeatBadge: React.FC<{ row: MarketRow }> = ({ row }) => <span className={`rounded-lg px-2 py-1 text-[10px] font-black ${row.statusLabel === 'Ready' ? 'bg-emerald-400/10 text-emerald-300' : row.statusLabel === 'Almost' ? 'bg-amber-400/10 text-amber-300' : row.statusLabel === 'Avoid' ? 'bg-rose-400/10 text-rose-300' : 'bg-cyan-400/10 text-cyan-300'}`}>{row.statusLabel} · {row.heat}/100 heat</span>;
const Condition: React.FC<{ label: string; value: string; good?: boolean }> = ({ label, value, good }) => <div className="flex items-center justify-between gap-4 rounded-xl border cx-border cx-bg-card px-3 py-2"><span className="cx-text-faint">{label}</span><b className={good ? 'text-emerald-300' : 'text-amber-300'}>{value}</b></div>;

const ReadySetup: React.FC<{ row: MarketRow; compact?: boolean }> = ({ row, compact }) => {
  const plan = row.analysis.trade_plan;
  return <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4"><div className="flex flex-wrap items-center gap-3"><span className="text-xl font-black">{row.signal.pair}</span><DirectionBadge direction={row.analysis.direction} eligible={plan?.eligible} /><HeatBadge row={row} /></div>{!compact && <p className="mt-2 text-sm cx-text-muted">{row.analysis.scenarios?.primary || 'Setup passed every entry rule.'}</p>}<div className="mt-3 grid gap-2 sm:grid-cols-4"><MiniStat label="Entry" value={formatPrice(plan?.entry)} /><MiniStat label="Stop" value={formatPrice(plan?.stop ?? plan?.invalidation)} /><MiniStat label="TP1" value={formatPrice(plan?.targets?.[0]?.price ?? plan?.tp1)} /><MiniStat label="RR" value={`${Number(plan?.net_rr ?? plan?.available_rr ?? 0).toFixed(2)}R`} /></div></div>;
};

const HotMarketCard: React.FC<{ row: MarketRow }> = ({ row }) => {
  const eligible = row.analysis.trade_plan?.eligible;
  const tf = row.analysis.data_quality?.primary_timeframe || '1h';
  return <article className="rounded-2xl border cx-border cx-bg-card p-4 transition hover:border-cyan-400/25 hover:cx-bg-card"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><span className="text-lg font-black">{row.signal.pair}</span><DirectionBadge direction={row.analysis.direction} eligible={eligible} /><HeatBadge row={row} /></div><p className="mt-2 line-clamp-2 text-xs cx-text-faint">{row.blocker}</p></div><div className="text-right"><div className="text-2xl font-black cx-text-strong">{row.analysis.total_score}<span className="text-xs cx-text-faint">/100</span></div><div className="text-[10px] cx-text-faint">{tf} · {formatAge(row.analysis.data_freshness_seconds)}</div></div></div><div className="mt-3 flex flex-wrap gap-2 text-[10px] cx-text-muted"><span className="rounded-md cx-bg-elev px-2 py-1">Timing {row.analysis.trade_timing?.status || 'WAIT'}</span><span className="rounded-md cx-bg-elev px-2 py-1">Fib {String(row.analysis.zones?.fibonacci?.nearest?.ratio || '—')}</span><span className="rounded-md cx-bg-elev px-2 py-1">Calendar {row.analysis.economic_calendar?.status || '—'}</span></div><div className="mt-3 flex gap-2"><Link to={`/tradingview?symbol=${row.signal.pair}&panel=full`} className="text-xs font-bold text-cyan-300 hover:text-cyan-200">Full analysis</Link><Link to={`/tradingview?symbol=${row.signal.pair}`} className="text-xs font-bold text-violet-300 hover:text-violet-200">Chart</Link></div></article>;
};
const QueueRow: React.FC<{ row: MarketRow }> = ({ row }) => <div className="grid items-center gap-3 rounded-2xl border cx-border cx-bg-card p-4 sm:grid-cols-[1fr_auto]"><div><div className="flex flex-wrap items-center gap-2"><span className="font-black">{row.signal.pair}</span><HeatBadge row={row} /></div><p className="mt-1 text-xs cx-text-faint">{row.blocker}</p></div><div className="text-right"><div className="font-black cx-text-strong">{row.analysis.total_score}/60</div><div className="text-[10px] cx-text-faint">to qualify</div></div></div>;
const EmptyState: React.FC<{ title: string; detail: string }> = ({ title, detail }) => <div className="rounded-2xl border border-dashed cx-border-strong p-6 text-center"><div className="font-black cx-text-muted">{title}</div><p className="mt-1 text-sm cx-text-faint">{detail}</p></div>;
const SkeletonRows = () => <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl cx-bg-card" />)}</div>;

const CanonicalContract: React.FC<{ pair: string; timeframe: string; score: number; asOf?: string | null; engine?: string }> = ({ pair, timeframe, score, asOf, engine }) => (
  <div className="flex flex-wrap items-center gap-2 text-[10px] font-black tracking-widest cx-text-muted">
    <span className="rounded-md cx-bg-elev px-2 py-1 text-cyan-300">{pair}</span>
    <span className="rounded-md cx-bg-elev px-2 py-1">{timeframe}</span>
    <span className="rounded-md cx-bg-elev px-2 py-1">Score {score}/100</span>
    <span className="rounded-md cx-bg-elev px-2 py-1">as-of {formatAsOf(asOf)}</span>
    <span className="rounded-md cx-bg-elev px-2 py-1">{engine || 'V2'}</span>
  </div>
);

const DecisionNowBlocked: React.FC<{ row: MarketRow; snapshot: DashboardSnapshot | null }> = ({ row, snapshot }) => {
  const gates = [gateScore(row.analysis), gateTiming(row.analysis), gateCalendar(row.analysis), gateNetR(row.analysis)];
  const failed = gates.filter((g) => !g.pass);
  const tf = row.analysis.data_quality?.primary_timeframe || '1h';
  const eligible = row.analysis.trade_plan?.eligible;
  return (
    <div className="rounded-2xl border border-amber-400/15 bg-amber-400/[0.05] p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-2xl font-black">{row.signal.pair}</span>
        <DirectionBadge direction={row.analysis.direction} eligible={eligible} />
      </div>
      <div className="mt-3">
        <CanonicalContract pair={row.signal.pair} timeframe={tf} score={row.analysis.total_score || 0} asOf={snapshot?.generated_at} engine={snapshot?.model_version} />
      </div>
      <p className="mt-3 text-sm cx-text-muted"><b className="text-amber-200">Waiting for:</b> {row.blocker}</p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {gates.map((gate) => (
          <li key={gate.label} className={`rounded-xl border p-3 ${gate.pass ? 'border-emerald-400/25 bg-emerald-400/[0.06]' : 'border-rose-400/25 bg-rose-400/[0.06]'}`}>
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-black tracking-widest cx-text-faint">{gate.label}</span>
              {gate.pass ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" /> : <XCircle className="h-3.5 w-3.5 text-rose-300" />}
            </div>
            <div className={`mt-1 font-mono text-sm font-bold ${gate.pass ? 'text-emerald-200' : 'text-rose-200'}`}>{gate.value}</div>
            <div className="text-[10px] cx-text-faint">{gate.note}</div>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="rounded-xl cx-bg-card-hover px-3 py-1 text-xs font-black cx-text-muted">Nearest Fib {String(row.analysis.zones?.fibonacci?.nearest?.ratio || '—')}</span>
        <span className="rounded-xl cx-bg-card-hover px-3 py-1 text-xs font-black cx-text-muted">Bias {row.analysis.market_context?.macro_bias || 'neutral'}</span>
        <Link to={`/tradingview?symbol=${row.signal.pair}`} className="rounded-lg border cx-border-strong cx-bg-card-hover px-3 py-2 text-xs font-black cx-text">Open on chart</Link>
        <Link to={`/tradingview?symbol=${row.signal.pair}&panel=full`} className="rounded-lg bg-cyan-400 px-3 py-2 text-xs font-black text-[#05070d]">Full analysis</Link>
      </div>
      {failed.length > 0 && <p className="mt-3 text-[11px] cx-text-faint">Failing gates: {failed.map((g) => g.label).join(' · ')}.</p>}
    </div>
  );
};

export default Dashboard;
