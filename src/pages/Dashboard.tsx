import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowRight, Briefcase, CalendarClock, CheckCircle2,
  Clock3, Crosshair, Gauge, Radar, RefreshCw, ShieldAlert, Zap,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  bwtsApi,
  planReasonText,
  type BwtsConfig,
  type BwtsHealth,
  type BwtsPosition,
  type BwtsSignal,
  type CalendarGateStatus,
  type CryptoAnalysis,
  type DashboardSnapshot,
} from '../services/bwtsApi';
import { SetupCard } from '../components/SetupCard';
import InstitutionalIntelligencePanel, {
  type InstitutionalIntelligenceV2,
} from '../components/InstitutionalIntelligencePanel';

type IntelligenceAnalysis = CryptoAnalysis & {
  institutional_intelligence_v2?: InstitutionalIntelligenceV2;
};

type SnapshotContract = {
  id: string;
  generatedAt: string;
  marketDataTimestamp: string;
  modelVersion: string;
};

type FeedState = 'CONNECTING' | 'LIVE' | 'DEGRADED' | 'OFFLINE';

const PLAN_RANKS: Record<string, number> = { STRONG: 5, VALID: 4, WATCHLIST: 3, WAIT: 2, BLOCKED: 1 };
const planRank = (analysis?: CryptoAnalysis) => PLAN_RANKS[analysis?.trade_plan?.status || ''] || 0;

const isRenderableMarket = (market: unknown): market is DashboardSnapshot['markets'][number] => {
  if (!market || typeof market !== 'object') return false;
  const candidate = market as { signal?: unknown; analysis?: unknown };
  return Boolean(
    candidate.signal && typeof candidate.signal === 'object'
    && typeof (candidate.signal as { pair?: unknown }).pair === 'string'
    && candidate.analysis && typeof candidate.analysis === 'object'
  );
};

// ---- Trading session clock -------------------------------------------------
// Approximate UTC windows for the three major FX sessions.
const SESSIONS = [
  { name: 'Asia', startUtc: 23, endUtc: 8 },
  { name: 'London', startUtc: 7, endUtc: 16 },
  { name: 'New York', startUtc: 12, endUtc: 21 },
] as const;

const sessionIsOpen = (session: (typeof SESSIONS)[number], utcHour: number) =>
  session.startUtc < session.endUtc
    ? utcHour >= session.startUtc && utcHour < session.endUtc
    : utcHour >= session.startUtc || utcHour < session.endUtc;

const hoursUntil = (targetUtcHour: number, now: Date) => {
  const nowH = now.getUTCHours() + now.getUTCMinutes() / 60;
  let diff = targetUtcHour - nowH;
  if (diff <= 0) diff += 24;
  return diff;
};

const formatHours = (hours: number) => {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const SessionClock: React.FC<{ now: Date }> = ({ now }) => {
  const utcHour = now.getUTCHours();
  const open = SESSIONS.filter((session) => sessionIsOpen(session, utcHour));
  const isOverlap = open.length > 1;

  let statusLine: string;
  if (open.length === 0) {
    const next = [...SESSIONS].sort((a, b) => hoursUntil(a.startUtc, now) - hoursUntil(b.startUtc, now))[0];
    statusLine = `Markets quiet · ${next.name} opens in ${formatHours(hoursUntil(next.startUtc, now))}`;
  } else if (isOverlap) {
    statusLine = `${open.map((s) => s.name).join(' + ')} overlap · highest liquidity window`;
  } else {
    const session = open[0];
    statusLine = `${session.name} session · closes in ${formatHours(hoursUntil(session.endUtc, now))}`;
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex gap-1.5">
        {SESSIONS.map((session) => {
          const active = sessionIsOpen(session, utcHour);
          return (
            <span
              key={session.name}
              className={`rounded-lg px-2.5 py-1 text-[10px] font-black tracking-wide ${
                active
                  ? 'bg-cyan-400/15 text-cyan-300 ring-1 ring-cyan-400/30'
                  : 'bg-white/[0.04] text-slate-600'
              }`}
            >
              {active && <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300 align-middle" />}
              {session.name.toUpperCase()}
            </span>
          );
        })}
      </div>
      <div className="text-[11px] text-slate-500">{statusLine}</div>
    </div>
  );
};

// ---- Dashboard -------------------------------------------------------------
const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const [health, setHealth] = useState<BwtsHealth | null>(null);
  const [config, setConfig] = useState<BwtsConfig | null>(null);
  const [signals, setSignals] = useState<BwtsSignal[]>([]);
  const [analysisByPair, setAnalysisByPair] = useState<Record<string, IntelligenceAnalysis>>({});
  const [positions, setPositions] = useState<BwtsPosition[]>([]);
  const [positionsError, setPositionsError] = useState(false);
  const [calendarRisk, setCalendarRisk] = useState<CalendarGateStatus | null>(null);
  const [contract, setContract] = useState<SnapshotContract | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectTimedOut, setConnectTimedOut] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => new Date());
  const loadInFlight = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async (manual = false) => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    if (manual) setRefreshing(true);

    bwtsApi.positions()
      .then(({ positions: open }) => {
        setPositions(open.filter((position) => !position.closed_at));
        setPositionsError(false);
      })
      .catch(() => setPositionsError(true));

    try {
      const snapshot = await bwtsApi.dashboardSnapshot();
      const rawMarkets = Array.isArray(snapshot.markets) ? snapshot.markets : [];
      const markets = rawMarkets.filter(isRenderableMarket);
      const nextAnalysis: Record<string, IntelligenceAnalysis> = {};
      markets.forEach((market) => { nextAnalysis[market.signal.pair] = market.analysis as IntelligenceAnalysis; });
      setHealth(snapshot.scanner_health);
      setConfig(snapshot.config);
      setSignals(markets.map((market) => market.signal));
      setAnalysisByPair(nextAnalysis);
      setContract({
        id: snapshot.snapshot_id,
        generatedAt: snapshot.generated_at,
        marketDataTimestamp: snapshot.market_data_timestamp,
        modelVersion: snapshot.model_version,
      });
      setUpdatedAt(new Date(snapshot.generated_at || Date.now()));
      setError(markets.length < rawMarkets.length
        ? 'The scanner returned an incomplete snapshot. Existing results are marked degraded until the next complete refresh.'
        : null);
    } catch (loadError: any) {
      try {
        const [healthData, configData, signalData] = await Promise.all([
          bwtsApi.health(), bwtsApi.config(), bwtsApi.signals({ limit: 50 }),
        ]);
        const pairs = Array.from(new Set(signalData.signals.map((signal) => signal.pair)));
        const analyses = await Promise.allSettled(pairs.map((pair) => bwtsApi.cryptoAnalysis(pair)));
        const nextAnalysis: Record<string, IntelligenceAnalysis> = {};
        analyses.forEach((result, index) => {
          if (result.status === 'fulfilled') nextAnalysis[pairs[index]] = result.value as IntelligenceAnalysis;
        });
        setHealth(healthData);
        setConfig(configData);
        setSignals(signalData.signals);
        setAnalysisByPair(nextAnalysis);
        setContract(null);
        setUpdatedAt(new Date());
        setError(analyses.some((result) => result.status === 'rejected')
          ? 'Some market analyses are unavailable. Results are marked degraded.'
          : null);
      } catch (fallbackError: any) {
        setError(fallbackError?.message || loadError?.message || 'Market intelligence feed is unavailable');
      }
    } finally {
      loadInFlight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(() => load(), 30_000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (!loading) {
      setConnectTimedOut(false);
      return;
    }
    const timeout = setTimeout(() => setConnectTimedOut(true), 12_000);
    return () => clearTimeout(timeout);
  }, [loading]);

  const latestByPair = useMemo(() => {
    const seen = new Set<string>();
    return [...signals]
      .sort((a, b) => {
        const at = typeof a.created_at === 'number' ? a.created_at : new Date(a.created_at).getTime();
        const bt = typeof b.created_at === 'number' ? b.created_at : new Date(b.created_at).getTime();
        return bt - at;
      })
      .filter((signal) => {
        if (seen.has(signal.pair)) return false;
        seen.add(signal.pair);
        return true;
      });
  }, [signals]);

  const analyses = Object.values(analysisByPair);
  const hasMarketData = analyses.length > 0;
  const actionable = analyses.filter((analysis) => analysis.trade_plan?.eligible);
  const watching = analyses.filter((analysis) => !analysis.trade_plan?.eligible);
  const bullish = analyses.filter((analysis) => analysis.direction === 'BUY').length;
  const bearish = analyses.filter((analysis) => analysis.direction === 'SELL').length;

  const rankedSignals = [...latestByPair].sort((a, b) => {
    const aa = analysisByPair[a.pair];
    const ba = analysisByPair[b.pair];
    return planRank(ba) - planRank(aa)
      || (ba?.total_score ?? 0) - (aa?.total_score ?? 0)
      || (ba?.trade_plan?.net_available_rr ?? ba?.trade_plan?.available_rr ?? 0)
        - (aa?.trade_plan?.net_available_rr ?? aa?.trade_plan?.available_rr ?? 0);
  });

  const bestSignal = rankedSignals.find((signal) => analysisByPair[signal.pair]?.trade_plan?.eligible)
    || rankedSignals[0];
  const bestAnalysis = bestSignal ? analysisByPair[bestSignal.pair] : null;
  const bestPlan = bestAnalysis?.trade_plan || null;
  const planReady = Boolean(bestPlan?.eligible);

  useEffect(() => {
    if (!bestSignal) {
      setCalendarRisk(null);
      return;
    }
    setCalendarRisk(null);
    bwtsApi.calendarStatus(bestSignal.pair)
      .then(setCalendarRisk)
      .catch(() => setCalendarRisk({
        version: 1,
        status: 'UNAVAILABLE',
        evaluated_at: new Date().toISOString(),
        symbol: bestSignal.pair,
        source: 'unavailable',
        source_health: 'UNAVAILABLE',
        event: null,
        next_event: null,
        minutes_to_event: null,
        reason_code: 'calendar_unavailable',
      }));
  }, [bestSignal?.id, bestSignal?.pair]);

  const feedState: FeedState = loading
    ? connectTimedOut ? 'OFFLINE' : 'CONNECTING'
    : error && !hasMarketData ? 'OFFLINE'
      : error || health?.status !== 'ok' ? 'DEGRADED' : 'LIVE';

  const calendarStatus = calendarRisk?.status || (hasMarketData ? 'CHECKING' : 'UNAVAILABLE');
  const marketTimestamp = contract?.marketDataTimestamp
    ? new Date(contract.marketDataTimestamp)
    : bestAnalysis?.data_quality?.closed_bar_time
      ? new Date(bestAnalysis.data_quality.closed_bar_time * 1000)
      : null;
  const waitReason = bestPlan?.reasons?.map(planReasonText).find(Boolean)
    || bestAnalysis?.trade_timing?.wait_for?.[0]
    || 'No market currently passes every entry rule. The scanner keeps checking automatically.';

  const openPnl = positions.reduce((total, position) => total + (position.closed_pnl_usd || 0), 0);

  return (
    <div className="space-y-5 pb-8 text-slate-100">
      {/* Header: who / feed status / session clock */}
      <section className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
              Good {now.getHours() < 12 ? 'morning' : now.getHours() < 18 ? 'afternoon' : 'evening'}, {user?.name || 'Trader'}
            </h1>
            <StatusBadge state={feedState} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {hasMarketData
              ? `${analyses.length} markets scanned · ${bullish} leaning buy · ${bearish} leaning sell`
              : 'Waiting for the first scan to complete.'}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          <SessionClock now={now} />
          <button
            onClick={() => { bwtsApi.clearCache(); load(true); }}
            disabled={refreshing}
            className="flex w-fit items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-bold text-slate-300 transition hover:bg-white/[0.08] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </section>

      {(error || connectTimedOut) && (
        <div className={`flex items-start gap-3 rounded-2xl border px-5 py-4 text-sm ${hasMarketData ? 'border-amber-400/20 bg-amber-400/[0.06] text-amber-200' : 'border-rose-400/20 bg-rose-400/[0.06] text-rose-200'}`}>
          {hasMarketData ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />}
          <div><strong>{hasMarketData ? 'Degraded feed:' : 'Market data unavailable:'}</strong> {error || 'The dashboard snapshot did not respond within 12 seconds.'}</div>
        </div>
      )}

      {/* Decision Now */}
      <section className={`rounded-[24px] border p-6 ${planReady ? 'border-emerald-400/20 bg-emerald-400/[0.045]' : 'border-white/[0.08] bg-[#090d18]'}`}>
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <div className={`text-[10px] font-black tracking-[0.2em] ${planReady ? 'text-emerald-300' : 'text-slate-500'}`}>DECISION NOW</div>
            {!hasMarketData ? (
              <>
                <h2 className="mt-2 text-2xl font-black">No market data yet</h2>
                <p className="mt-2 text-sm text-slate-400">The scanner has not delivered a snapshot. Check that the backend is running, then refresh.</p>
              </>
            ) : planReady && bestSignal && bestAnalysis && bestPlan ? (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <h2 className="text-3xl font-black">{bestSignal.pair}</h2>
                  <span className={`rounded-lg px-3 py-1 text-xs font-black ${bestAnalysis.direction === 'BUY' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-rose-400/10 text-rose-300'}`}>{bestAnalysis.direction} · READY</span>
                  <span className="rounded-lg bg-cyan-400/10 px-3 py-1 text-xs font-black text-cyan-300">{bestAnalysis.total_score}/100 confluence</span>
                </div>
                <p className="mt-2 text-sm capitalize text-slate-300">{bestAnalysis.scenarios?.primary || 'Setup passed every entry rule'}</p>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <DecisionPoint label="Enter at" value={formatPrice(bestPlan.entry)} />
                  <DecisionPoint label="Wrong below/above" value={formatPrice(bestPlan.stop ?? bestPlan.invalidation)} />
                  <DecisionPoint label="First target" value={formatPrice(bestPlan.targets?.[0]?.price ?? bestPlan.tp1)} />
                </div>
              </>
            ) : (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <h2 className="text-3xl font-black">No trade right now</h2>
                  {bestSignal && bestAnalysis && <span className="rounded-lg bg-white/[0.05] px-3 py-1 text-xs font-black text-slate-300">Closest: {bestSignal.pair} · {bestAnalysis.total_score}/100</span>}
                </div>
                <p className="mt-3 text-sm text-slate-300"><strong className="text-amber-200">Waiting for:</strong> {waitReason}</p>
              </>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {bestSignal && <Link to="/tradingview" className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-xs font-black"><Crosshair className="h-4 w-4" /> View on chart</Link>}
            <Link to="/scanner" className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 px-4 py-3 text-xs font-black text-[#05070d]"><Radar className="h-4 w-4" /> Open scanner</Link>
          </div>
        </div>
      </section>

      {/* Open positions — the trade manager, surfaced */}
      <section className="rounded-[24px] border border-white/[0.08] bg-[#090d18] p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-black tracking-[0.2em] text-emerald-300">OPEN POSITIONS</div>
            <h2 className="mt-1 text-xl font-black">
              {positions.length > 0 ? `${positions.length} trade${positions.length > 1 ? 's' : ''} running` : 'No trades open'}
            </h2>
          </div>
          <div className="flex items-center gap-4">
            {positions.length > 0 && (
              <div className={`text-sm font-black ${openPnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {openPnl >= 0 ? '+' : ''}{openPnl.toFixed(2)} USD
              </div>
            )}
            <Link to="/positions" className="flex items-center gap-1 text-xs font-bold text-slate-400 hover:text-slate-200">
              Manage <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
        {positionsError ? (
          <div className="rounded-2xl border border-dashed border-white/10 px-5 py-6 text-sm text-slate-500">
            Position feed unavailable. The execution worker may be offline — open positions still exist at your broker.
          </div>
        ) : positions.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl border border-dashed border-white/10 px-5 py-6 text-sm text-slate-500">
            <Briefcase className="h-5 w-5 shrink-0 text-slate-600" />
            When the execution worker opens a trade, its size, entry, stop, and live result show here.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {positions.slice(0, 6).map((position) => (
              <div key={position.id} className="rounded-2xl border border-white/[0.07] bg-black/20 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-black">{position.pair}</span>
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-black ${position.direction === 'BUY' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-rose-400/10 text-rose-300'}`}>{position.direction}</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                  <div><div className="text-slate-600">Size</div><div className="font-mono font-bold text-slate-300">{position.lot_size}</div></div>
                  <div><div className="text-slate-600">Entry</div><div className="font-mono font-bold text-slate-300">{formatPrice(position.entry)}</div></div>
                  <div><div className="text-slate-600">Stop</div><div className="font-mono font-bold text-slate-300">{formatPrice(position.stop_loss)}</div></div>
                </div>
                {position.half_closed > 0 && <div className="mt-2 text-[10px] font-bold text-cyan-300">TP1 banked · stop at breakeven</div>}
              </div>
            ))}
          </div>
        )}
      </section>

      {bestAnalysis && (
        <InstitutionalIntelligencePanel
          intelligence={bestAnalysis.institutional_intelligence_v2}
          canonicalEligible={Boolean(bestPlan?.eligible)}
          timingStatus={bestAnalysis.trade_timing?.status}
        />
      )}

      <section className="grid gap-4 md:grid-cols-3">
        <IntelCard icon={Zap} label="Ready to trade" value={hasMarketData ? String(actionable.length) : 'Unavailable'} detail={hasMarketData ? 'Setups that passed every entry rule' : 'No trustworthy snapshot'} color="emerald" />
        <IntelCard icon={Gauge} label="Building up" value={hasMarketData ? String(watching.length) : 'Unavailable'} detail={hasMarketData ? 'Markets partway to qualifying' : 'No score or bias inferred'} color="cyan" />
        <IntelCard icon={CalendarClock} label="News risk" value={calendarStatus} detail={calendarRisk?.next_event ? `${calendarRisk.next_event.title}${calendarRisk.minutes_to_event !== null ? ` in ${calendarRisk.minutes_to_event}m` : ''}` : 'High-impact events pause trading automatically'} color="violet" />
      </section>

      <section className="rounded-[24px] border border-white/[0.08] bg-[#090d18] p-5 sm:p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-black tracking-[0.2em] text-cyan-300">WATCHLIST</div>
            <h2 className="mt-1 text-xl font-black">Closest to a trade</h2>
          </div>
          <Link to="/scanner" className="flex items-center gap-1 text-xs font-bold text-slate-400 hover:text-slate-200">All markets <ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>
        <div className="space-y-3">
          {rankedSignals.slice(0, 5).map((signal, index) => (
            <SetupCard key={signal.id} pair={signal.pair} analysis={analysisByPair[signal.pair]} calendar={signal.pair === bestSignal?.pair ? calendarRisk : null} variant="row" index={index} timestamp={signal.created_at} reason={analysisByPair[signal.pair]?.scenarios?.primary || 'Analysis pending'} />
          ))}
          {loading && [1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded-2xl bg-white/[0.035]" />)}
          {!loading && !hasMarketData && <div className="rounded-2xl border border-dashed border-white/10 py-12 text-center text-sm text-slate-500">No market rows are shown because the feed is unavailable.</div>}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1 text-[11px] text-slate-600">
        <span className="flex items-center gap-2"><Clock3 className="h-3.5 w-3.5" />Refreshed {updatedAt ? updatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'never'}</span>
        <span>Data as of {formatDateTime(marketTimestamp)}</span>
        <span>{config ? `Scans every ${Math.round(config.scan_interval_seconds / 60)} min` : ''}</span>
        <span>Engine {contract?.modelVersion || `V${bestAnalysis?.version || '2'}`}{contract?.id ? ` · ${contract.id.slice(0, 10)}` : ''}</span>
        <span>Decision support only — not financial advice.</span>
      </div>
    </div>
  );
};

const statusStyles: Record<FeedState, string> = {
  CONNECTING: 'border-slate-400/20 bg-slate-400/[0.07] text-slate-300',
  LIVE: 'border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-300',
  DEGRADED: 'border-amber-400/20 bg-amber-400/[0.07] text-amber-300',
  OFFLINE: 'border-rose-400/20 bg-rose-400/[0.07] text-rose-300',
};

const StatusBadge: React.FC<{ state: FeedState }> = ({ state }) => (
  <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-black tracking-[0.18em] ${statusStyles[state]}`}>
    {state === 'LIVE' ? <CheckCircle2 className="h-3 w-3" /> : state === 'CONNECTING' ? <Activity className="h-3 w-3 animate-pulse" /> : <AlertTriangle className="h-3 w-3" />}
    {state}
  </div>
);

const DecisionPoint: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3"><div className="text-[9px] font-black uppercase tracking-widest text-slate-600">{label}</div><div className="mt-1 font-mono text-sm font-bold text-slate-200">{value}</div></div>
);

const cardColors: Record<string, string> = {
  emerald: 'bg-emerald-400/10 text-emerald-300',
  cyan: 'bg-cyan-400/10 text-cyan-300',
  violet: 'bg-violet-400/10 text-violet-300',
};

const IntelCard: React.FC<{ icon: React.ElementType; label: string; value: string; detail: string; color: string }> = ({ icon: Icon, label, value, detail, color }) => (
  <div className="rounded-2xl border border-white/[0.08] bg-[#090d18] p-5"><div className={`flex h-10 w-10 items-center justify-center rounded-xl ${cardColors[color] || cardColors.cyan}`}><Icon className="h-5 w-5" /></div><div className={`mt-5 font-black tracking-tight ${value.length > 8 ? 'text-xl' : 'text-3xl'}`}>{value}</div><div className="mt-1 text-sm font-bold text-slate-300">{label}</div><div className="mt-1 line-clamp-2 text-xs text-slate-600">{detail}</div></div>
);

const formatDateTime = (date: Date | null) => date && !Number.isNaN(date.getTime())
  ? date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  : 'unavailable';

const formatPrice = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Unavailable';
  return value >= 100 ? value.toFixed(2) : value.toFixed(5);
};

export default Dashboard;
