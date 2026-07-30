import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, ArrowRight, BarChart3, BrainCircuit, CalendarClock, Clock3, Crosshair, Gauge,
  Layers3, RefreshCw, Radar, ShieldCheck, Sparkles, TrendingDown,
  TrendingUp, Zap
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { bwtsApi, planReasonText, type AiSignalAnalysis, type BwtsConfig, type BwtsHealth, type BwtsSignal, type CalendarGateStatus, type CryptoAnalysis, type LifecycleState, type DashboardSnapshot } from '../services/bwtsApi';
import TriggerDisplay from '../components/TriggerDisplay';
import EconomicRiskBanner from '../components/EconomicRiskBanner';
import { SetupCard } from '../components/SetupCard';

const tierStyles: Record<string, string> = {
  STRONG: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  GOOD: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-300',
  WATCHLIST: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  NO_TRADE: 'border-slate-500/30 bg-slate-500/10 text-slate-400',
  VALID: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-300',
  WAIT: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  BLOCKED: 'border-rose-400/30 bg-rose-400/10 text-rose-300',
};

const lifecycleDisplay: Record<LifecycleState, { label: string; icon: string; color: string }> = {
  observing: { label: 'Observing', icon: '👁', color: 'text-slate-400' },
  developing: { label: 'Developing', icon: '⏳', color: 'text-amber-300' },
  near_trigger: { label: 'Near Trigger', icon: '🎯', color: 'text-orange-300' },
  ready: { label: 'Ready', icon: '✅', color: 'text-emerald-300' },
  active: { label: 'Active', icon: '🚀', color: 'text-cyan-300' },
  tp1_reached: { label: 'TP1 Reached', icon: '🎯', color: 'text-emerald-300' },
  tp2_reached: { label: 'TP2 Reached', icon: '🎯', color: 'text-emerald-300' },
  tp3_reached: { label: 'TP3 Reached', icon: '🎯', color: 'text-emerald-300' },
  break_even: { label: 'Break Even', icon: '⚖', color: 'text-cyan-300' },
  stopped: { label: 'Stopped', icon: '🛑', color: 'text-rose-300' },
  expired: { label: 'Expired', icon: '⏰', color: 'text-slate-400' },
  invalidated: { label: 'Invalidated', icon: '❌', color: 'text-rose-300' },
  blocked_by_news: { label: 'News Blocked', icon: '📰', color: 'text-amber-300' },
  blocked_by_data: { label: 'Data Blocked', icon: '📊', color: 'text-amber-300' },
  blocked_by_spread: { label: 'Spread Blocked', icon: '📉', color: 'text-amber-300' },
  blocked_by_risk: { label: 'Risk Blocked', icon: '⚠', color: 'text-amber-300' },
  closed: { label: 'Closed', icon: '✓', color: 'text-slate-400' },
};

const getLifecycleDisplay = (state: LifecycleState | string | undefined) => {
  if (!state) return null;
  const normalized = state.toLowerCase() as LifecycleState;
  return lifecycleDisplay[normalized] || null;
};

const v2Tier = (analysis?: CryptoAnalysis) => analysis?.trade_plan?.status || (analysis && analysis.total_score >= 40 ? 'WATCHLIST' : 'NO_TRADE');
const planRank = (analysis?: CryptoAnalysis) => ({ STRONG: 5, VALID: 4, WATCHLIST: 3, WAIT: 2, BLOCKED: 1 }[analysis?.trade_plan?.status || ''] || 0);
const isRenderableMarket = (market: unknown): market is DashboardSnapshot['markets'][number] => {
  if (!market || typeof market !== 'object') return false;
  const candidate = market as { signal?: unknown; analysis?: unknown };
  return Boolean(
    candidate.signal && typeof candidate.signal === 'object' &&
    typeof (candidate.signal as { pair?: unknown }).pair === 'string' &&
    candidate.analysis && typeof candidate.analysis === 'object'
  );
};

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const [health, setHealth] = useState<BwtsHealth | null>(null);
  const [config, setConfig] = useState<BwtsConfig | null>(null);
  const [signals, setSignals] = useState<BwtsSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [calendarRisk, setCalendarRisk] = useState<CalendarGateStatus | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<AiSignalAnalysis | null>(null);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisByPair, setAnalysisByPair] = useState<Record<string, CryptoAnalysis>>({});
  const loadInFlight = useRef(false);

  const load = useCallback(async (manual = false) => {
    if (loadInFlight.current) return;
    loadInFlight.current = true; if (manual) setRefreshing(true);
    try {
      // Try unified dashboard snapshot endpoint first
      const snapshot = await bwtsApi.dashboardSnapshot();
      const rawMarkets = Array.isArray(snapshot.markets) ? snapshot.markets : [];
      const markets = rawMarkets.filter(isRenderableMarket);
      setHealth(snapshot.scanner_health);
      setConfig(snapshot.config);
      setSignals(markets.map((market) => market.signal));
      const nextAnalysis: Record<string, CryptoAnalysis> = {};
      markets.forEach((market) => {
        nextAnalysis[market.signal.pair] = market.analysis;
      });
      setAnalysisByPair(nextAnalysis);
      setUpdatedAt(new Date());
      setError(markets.length < rawMarkets.length ? 'Scanner returned an incomplete market snapshot. Waiting for the next refresh.' : null);
    } catch (loadError: any) {
      // Fallback to legacy N+1 pattern if snapshot endpoint unavailable
      if (loadError?.message?.includes('unknown route') || loadError?.message?.includes('404')) {
        try {
          const [healthData, configData, signalData] = await Promise.all([
            bwtsApi.health(), bwtsApi.config(), bwtsApi.signals({ limit: 50 }),
          ]);
          setHealth(healthData);
          setConfig(configData);
          setSignals(signalData.signals);
          const pairs = Array.from(new Set(signalData.signals.map((signal) => signal.pair)));
          const analyses = await Promise.allSettled(pairs.map((pair) => bwtsApi.cryptoAnalysis(pair)));
          const nextAnalysis: Record<string, CryptoAnalysis> = {};
          analyses.forEach((result, index) => {
            if (result.status === 'fulfilled') nextAnalysis[pairs[index]] = result.value;
          });
          setAnalysisByPair(nextAnalysis);
          setUpdatedAt(new Date());
          setError(null);
        } catch (fallbackError: any) {
          setError(fallbackError?.message || 'Market intelligence feed is unavailable');
        }
      } else {
        setError(loadError?.message || 'Market intelligence feed is unavailable');
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

  const latestByPair = useMemo(() => {
    const seen = new Set<string>();
    const ordered = [...signals].sort((a, b) => { const at=typeof a.created_at === 'number' ? a.created_at : new Date(a.created_at).getTime(); const bt=typeof b.created_at === 'number' ? b.created_at : new Date(b.created_at).getTime(); return bt-at; });
    return ordered.filter((signal) => {
      if (seen.has(signal.pair)) return false;
      seen.add(signal.pair);
      return true;
    });
  }, [signals]);

  const v2Analyses = Object.values(analysisByPair);
  const actionable = v2Analyses.filter((analysis) => analysis.trade_plan?.eligible);
  const strong = v2Analyses.filter((analysis) => analysis.trade_plan?.eligible && analysis.total_score >= 70).length;
  const bullish = v2Analyses.filter((analysis) => analysis.direction === 'BUY').length;
  const bearish = v2Analyses.filter((analysis) => analysis.direction === 'SELL').length;
  const averageScore = v2Analyses.length
    ? Math.round(v2Analyses.reduce((total, analysis) => total + analysis.total_score, 0) / v2Analyses.length)
    : 0;
  const rankedSignals = [...latestByPair].sort((a, b) => { const aa=analysisByPair[a.pair], ba=analysisByPair[b.pair]; return planRank(ba)-planRank(aa) || (ba?.total_score ?? 0)-(aa?.total_score ?? 0) || (ba?.trade_plan?.net_available_rr ?? ba?.trade_plan?.available_rr ?? 0)-(aa?.trade_plan?.net_available_rr ?? aa?.trade_plan?.available_rr ?? 0); });
  const bestSignal = rankedSignals[0];
  const cryptoAnalysis = bestSignal ? analysisByPair[bestSignal.pair] || null : null;
  const tradePlan = cryptoAnalysis?.trade_plan || null;
  const planReady = Boolean(tradePlan?.eligible);

  useEffect(() => {
    if (!bestSignal) {
      setCalendarRisk(null);
      return;
    }
    bwtsApi.calendarStatus(bestSignal.pair).then(setCalendarRisk).catch(() => setCalendarRisk(null));
    bwtsApi.aiStatus().then((status) => setAiConfigured(status.configured)).catch(() => setAiConfigured(false));
    setAiAnalysis(null);
  }, [bestSignal?.id]);

  const analyzeTopSignal = async () => {
    if (!bestSignal) return;
    setAnalyzing(true);
    try {
      const result = await bwtsApi.analyzeSignal(bestSignal.pair, bestSignal, cryptoAnalysis || undefined);
      setAiAnalysis(result.analysis);
      setAiConfigured(result.configured);
      setCalendarRisk(result.calendar);
    } catch {
      setAiAnalysis(null);
    } finally {
      setAnalyzing(false);
    }
  };

  const formatTime = (value: number | string) => {
    const date = typeof value === 'number'
      ? new Date(value < 10_000_000_000 ? value * 1000 : value)
      : new Date(value);
    return Number.isNaN(date.getTime()) ? 'recently' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  return (
    <div className="space-y-6 pb-8 text-slate-100">
      <section className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#080d1a] p-6 shadow-2xl shadow-black/20 sm:p-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(34,211,238,0.14),transparent_30%),radial-gradient(circle_at_90%_30%,rgba(139,92,246,0.18),transparent_34%)]" />
        <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full border border-violet-400/10" />
        <div className="relative z-10 flex flex-col justify-between gap-7 xl:flex-row xl:items-end">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/[0.07] px-3 py-1.5 text-[10px] font-black tracking-[0.2em] text-cyan-300">
              <span className="relative flex h-2 w-2"><span className="absolute h-full w-full animate-ping rounded-full bg-cyan-400"/><span className="relative h-2 w-2 rounded-full bg-cyan-300"/></span>
              INTELLIGENCE FEED {health?.status === 'ok' ? `LIVE · ${updatedAt ? Math.max(0, Math.floor((Date.now() - updatedAt.getTime()) / 1000)) + 's ago' : 'CONNECTING'}` : 'CONNECTING'}
            </div>
            <h1 className="text-3xl font-black tracking-[-0.04em] sm:text-5xl">Your edge, <span className="bg-gradient-to-r from-cyan-300 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent">in one view.</span></h1>
            <p className="mt-3 max-w-2xl text-slate-400">Welcome back, {user?.name || 'Trader'}. Start with the strongest confluence, validate the structure, then build the plan.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => { bwtsApi.clearCache(); load(true); }} disabled={refreshing} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold text-slate-300 transition hover:bg-white/[0.08] disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}/> Refresh</button>
            <Link to="/scanner" className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 px-5 py-3 text-sm font-black text-[#05070d] shadow-[0_0_26px_rgba(34,211,238,0.16)] transition hover:-translate-y-0.5"><Radar className="h-4 w-4"/> Open live scanner</Link>
          </div>
        </div>
        <div className="relative z-10 mt-7 flex flex-wrap gap-x-6 gap-y-2 border-t border-white/[0.07] pt-5 text-xs text-slate-500">
          <span className="flex items-center gap-2"><Clock3 className="h-3.5 w-3.5 text-cyan-400"/>{updatedAt ? `Updated ${updatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Loading market state'}</span>
          <span>{config ? `${config.scan_interval_seconds}s scan cycle` : 'Scanner configuration loading'}</span>
          <span>{health ? `${health.pairs.length} markets tracked` : 'Connecting to markets'}</span>
        </div>
      </section>

      {error && <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] px-5 py-4 text-sm text-amber-200">Live scanner connection: {error}</div>}

      <EconomicRiskBanner />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <IntelCard icon={Radar} label="Markets tracked" value={loading ? '—' : String(health?.pairs.length ?? 0)} detail="Continuous scanner coverage" color="cyan" />
        <IntelCard icon={Zap} label="Actionable now" value={loading ? '—' : String(actionable.length)} detail={`${strong} strong signal${strong === 1 ? '' : 's'}`} color="violet" />
        <IntelCard icon={Gauge} label="Average Confluence score" value={loading ? '—' : `${averageScore}/100`} detail="Multi-Asset Confluence Engine" color="fuchsia" />
        <IntelCard icon={Activity} label="Market bias" value={loading ? '—' : bullish === bearish ? 'Balanced' : bullish > bearish ? 'Bullish' : 'Bearish'} detail={`${bullish} buy · ${bearish} sell`} color="cyan" />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.55fr_.85fr]">
        <div className="rounded-[24px] border border-white/[0.08] bg-[#090d18] p-5 sm:p-6">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div><div className="text-[10px] font-black tracking-[0.2em] text-cyan-300">OPPORTUNITY QUEUE</div><h2 className="mt-1 text-xl font-black">Ranked Market Opportunities</h2></div>
            <Link to="/signals" className="flex items-center gap-1 text-xs font-bold text-slate-400 transition hover:text-cyan-300">All signals <ArrowRight className="h-3.5 w-3.5"/></Link>
          </div>
          <div className="space-y-3">
            {(rankedSignals.length ? rankedSignals.slice(0, 5) : []).map((signal, index) => (
              <SetupCard
                key={signal.id}
                pair={signal.pair}
                analysis={analysisByPair[signal.pair]}
                calendar={calendarRisk?.status === 'LOADING' ? null : calendarRisk}
                variant="row"
                index={index}
                timestamp={signal.created_at}
                reason={analysisByPair[signal.pair]?.scenarios?.primary || 'Full-spectrum analysis loading'}
              />
            ))}
            {!loading && latestByPair.length === 0 && <div className="rounded-2xl border border-dashed border-white/10 py-14 text-center"><Radar className="mx-auto h-8 w-8 text-slate-700"/><p className="mt-3 text-sm text-slate-500">The scanner is online. New setups will appear here when the evidence aligns.</p></div>}
            {loading && [1,2,3].map(item => <div key={item} className="h-20 animate-pulse rounded-2xl bg-white/[0.035]"/>)}
          </div>
        </div>

        <div className="space-y-6">
          <div className="relative overflow-hidden rounded-[24px] border border-violet-400/15 bg-[#090d18] bg-gradient-to-br from-violet-500/10 to-cyan-500/[0.04] p-6">
            <Sparkles className="absolute -right-2 -top-2 h-24 w-24 text-violet-400/[0.06]"/>
            <div className="text-[10px] font-black tracking-[0.2em] text-violet-300">TOP CONFLUENCE</div>
            {bestSignal && cryptoAnalysis ? <>
              <div className="mt-5 flex items-start justify-between"><div><div className="flex items-center gap-2"><div className="text-3xl font-black">{bestSignal.pair}</div><span className={`rounded-md px-2 py-1 text-[9px] font-black ${cryptoAnalysis.direction === 'BUY' ? 'bg-emerald-400/10 text-emerald-300' : cryptoAnalysis.direction === 'SELL' ? 'bg-rose-400/10 text-rose-300' : 'bg-slate-400/10 text-slate-400'}`}>{planReady ? cryptoAnalysis.direction : tradePlan?.status || 'WAIT'}</span>{cryptoAnalysis.direction_stability && (() => { const info = getLifecycleDisplay(cryptoAnalysis.lifecycle_state || cryptoAnalysis.direction_stability.lifecycle); return info ? <span title={cryptoAnalysis.direction_stability.reason} className={`rounded-md bg-white/[0.05] px-2 py-1 text-[9px] font-black ${info.color}`}>{info.icon} {info.label}</span> : <span title={cryptoAnalysis.direction_stability.reason} className="rounded-md bg-white/[0.05] px-2 py-1 text-[9px] font-black text-slate-300">{cryptoAnalysis.direction_stability.lifecycle}</span>; })()}</div><div className="mt-1 text-sm capitalize text-slate-400">{cryptoAnalysis.scenarios?.primary || 'Scenario pending'}</div></div><div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-center"><div className="text-2xl font-black text-cyan-300">{cryptoAnalysis.total_score}</div><div className="text-[8px] font-bold tracking-widest text-cyan-500">V2 / 100</div></div></div>
              <div className="mt-4 flex items-center justify-between rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2.5"><div className="flex items-center gap-2 text-xs text-slate-400"><CalendarClock className="h-4 w-4 text-amber-300"/>Economic calendar</div><span className={`rounded-md px-2 py-1 text-[9px] font-black ${calendarRisk?.status === 'CLEAR' ? 'bg-emerald-400/10 text-emerald-300' : calendarRisk?.status === 'CAUTION' ? 'bg-amber-400/10 text-amber-300' : calendarRisk?.status === 'BLOCKED' || calendarRisk?.status === 'POST_NEWS' ? 'bg-rose-400/10 text-rose-300' : 'bg-slate-400/10 text-slate-400'}`}>{calendarRisk?.status || 'LOADING'}</span></div>
              {calendarRisk?.next_event && <div className="mt-2 text-[10px] text-slate-500">{calendarRisk.next_event.title} ({calendarRisk.next_event.currency}) {calendarRisk.minutes_to_event !== null ? `in ${calendarRisk.minutes_to_event}m` : ''}</div>}
              {cryptoAnalysis.market_context && <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[9px] font-bold uppercase tracking-wider"><div className="rounded-lg bg-black/20 p-2 text-slate-500">Month <span className="block mt-1 text-slate-200">{cryptoAnalysis.market_context?.timeframes?.mn1?.trend || 'neutral'}</span></div><div className="rounded-lg bg-black/20 p-2 text-slate-500">Week <span className="block mt-1 text-slate-200">{cryptoAnalysis.market_context?.timeframes?.w1?.trend || 'neutral'}</span></div><div className="rounded-lg bg-black/20 p-2 text-slate-500">Timing <span className={`block mt-1 ${cryptoAnalysis.trade_timing?.status === 'READY' ? 'text-emerald-300' : cryptoAnalysis.trade_timing?.status === 'AVOID' ? 'text-rose-300' : 'text-amber-300'}`}>{cryptoAnalysis.trade_timing?.status || 'WAIT'}</span></div></div>}
              {tradePlan && planReady && tradePlan.entry !== null && tradePlan.stop !== null ? <><div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs"><DataPoint label="ENTRY" value={tradePlan.entry}/><DataPoint label="STOP" value={tradePlan.stop}/><DataPoint label="TP1" value={tradePlan.targets?.[0]?.price ?? 0}/></div><div className="mt-2 flex items-center justify-between text-[10px] text-slate-500"><span>Net movement: {Number(tradePlan.net_available_rr ?? tradePlan.available_rr ?? 0).toFixed(2)}R</span><span>Account risk: {Number(tradePlan.account_risk_percent ?? 0).toFixed(2)}%</span></div></> : <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.07] p-3 text-xs leading-relaxed text-amber-200"><strong>{tradePlan?.status || 'WAIT'}:</strong> {tradePlan?.reasons?.map(planReasonText).find(Boolean) || 'V2 has not produced an eligible trade plan.'}</div>}
              {(tradePlan?.triggers?.length || tradePlan?.blocking_reasons?.length) ? <div className="mt-4"><TriggerDisplay triggers={tradePlan?.triggers || []} blockingReasons={tradePlan?.blocking_reasons || []} /></div> : null}
              {aiAnalysis && <div className="mt-4 rounded-xl border border-violet-400/15 bg-violet-400/[0.06] p-3"><div className="mb-1 flex items-center gap-2 text-[9px] font-black tracking-widest text-violet-300"><BrainCircuit className="h-3.5 w-3.5"/>{aiConfigured ? 'MINIMAX ANALYSIS' : 'DETERMINISTIC ANALYSIS'}</div><p className="text-xs leading-relaxed text-slate-300">{aiAnalysis.summary}</p><div className="mt-2 text-[10px] text-slate-500">Wait for: {aiAnalysis.wait_for}</div></div>}
              <div className="mt-5 grid grid-cols-2 gap-2"><Link to="/tradingview" className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] py-3 text-xs font-black transition hover:bg-white/[0.09]">Validate chart <Crosshair className="h-4 w-4"/></Link><button onClick={analyzeTopSignal} disabled={analyzing} className="flex items-center justify-center gap-2 rounded-xl border border-violet-400/20 bg-violet-400/10 py-3 text-xs font-black text-violet-200 transition hover:bg-violet-400/15 disabled:opacity-50"><BrainCircuit className={`h-4 w-4 ${analyzing ? 'animate-pulse' : ''}`}/>{analyzing ? 'Analyzing' : 'Analyze setup'}</button></div>
            </> : <div className="py-12 text-center text-sm text-slate-500">Waiting for the next confirmed setup.</div>}
          </div>

          <div className="rounded-[24px] border border-white/[0.08] bg-[#090d18] p-6"><div className="flex items-center justify-between"><div><div className="text-[10px] font-black tracking-[0.2em] text-slate-500">SYSTEM STATE</div><h3 className="mt-1 font-black">Confluence pipeline</h3></div><ShieldCheck className="h-5 w-5 text-emerald-300"/></div><div className="mt-5 space-y-4">{[['01','Scan markets',health?.status === 'ok'],['02','Rank V2 confluence',v2Analyses.length > 0],['03','Confirm direction',cryptoAnalysis?.direction !== 'NEUTRAL'],['04','Build V2 plan',planReady]].map(([number,label,complete]) => <div key={String(number)} className="flex items-center gap-3"><div className={`flex h-8 w-8 items-center justify-center rounded-lg text-[10px] font-black ${complete ? 'bg-cyan-400/10 text-cyan-300' : 'bg-white/[0.04] text-slate-600'}`}>{number}</div><div className={`flex-1 text-sm ${complete ? 'text-slate-200' : 'text-slate-500'}`}>{String(label)}</div><div className={`h-2 w-2 rounded-full ${complete ? 'bg-cyan-300 shadow-[0_0_10px_#22d3ee]' : 'bg-slate-700'}`}/></div>)}</div></div>
        </div>
      </section>

      {cryptoAnalysis && <section className="rounded-[24px] border border-cyan-400/15 bg-[#080d18] p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><div className="text-[10px] font-black tracking-[0.2em] text-cyan-300">CONFLUENCE INTELLIGENCE · V{cryptoAnalysis.version}</div><h2 className="mt-1 text-2xl font-black">Multi-Asset Confluence Analysis</h2><p className="mt-1 text-sm text-slate-500">Category-capped scoring prevents correlated indicators from inflating confidence.</p></div><div className="flex items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-3"><div><div className="text-[9px] font-black tracking-widest text-slate-600">CONFLUENCE SCORE</div><div className="text-3xl font-black text-cyan-300">{cryptoAnalysis.confluence_score ?? cryptoAnalysis.total_score}<span className="text-sm text-slate-600">/100</span></div></div><div className="flex flex-col items-center gap-1"><div className="text-[9px] font-black tracking-widest text-slate-600">COVERAGE</div><div className="text-xl font-black text-violet-300">{Math.round((cryptoAnalysis.coverage ?? 0) * 100)}%</div></div><div className="flex flex-col items-center gap-1"><div className="text-[9px] font-black tracking-widest text-slate-600">CONFIDENCE</div><div className={`text-sm font-black ${(cryptoAnalysis.confidence_tier ?? 'watch') === 'high' ? 'text-emerald-300' : (cryptoAnalysis.confidence_tier ?? 'watch') === 'qualified' ? 'text-cyan-300' : (cryptoAnalysis.confidence_tier ?? 'watch') === 'developing' ? 'text-amber-300' : 'text-slate-400'}`}>{((cryptoAnalysis.confidence_tier ?? 'watch').charAt(0).toUpperCase() + (cryptoAnalysis.confidence_tier ?? 'watch').slice(1))}</div></div><div className={`rounded-lg px-3 py-2 text-xs font-black ${cryptoAnalysis.direction === 'BUY' ? 'bg-emerald-400/10 text-emerald-300' : cryptoAnalysis.direction === 'SELL' ? 'bg-rose-400/10 text-rose-300' : 'bg-slate-400/10 text-slate-400'}`}>{cryptoAnalysis.direction}</div></div></div>
        <div className="mt-4 flex items-center gap-2 text-xs text-slate-500"><Layers3 className="h-3.5 w-3.5 text-cyan-400"/>{cryptoAnalysis.categories_available ?? 0} of {cryptoAnalysis.categories_total ?? 9} evidence groups available</div>
        <div className="mt-6 grid gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-3">{Object.entries(cryptoAnalysis.category_breakdown || {}).map(([category, value]) => { const caps: Record<string, number> = {structure:20,liquidity:15,volume:10,momentum:10,moving_averages:10,fibonacci:10,patterns:10,volatility:10,relative_strength:5}; const cap = caps[category] || 10; return <div key={category}><div className="mb-2 flex items-center justify-between text-xs"><span className="font-bold capitalize text-slate-400">{category.replace(/_/g, ' ')}</span><span className="font-black text-slate-200">{value}/{cap}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-500 transition-all duration-700" style={{width:`${Math.min(100,(value/cap)*100)}%`}}/></div></div>; })}</div>
        <div className="mt-6 grid gap-3 border-t border-white/[0.07] pt-5 md:grid-cols-3"><div className="rounded-xl bg-white/[0.025] p-4"><div className="text-[9px] font-black tracking-widest text-slate-600">PRIMARY SCENARIO</div><div className="mt-2 text-sm font-bold capitalize text-slate-200">{cryptoAnalysis.scenarios?.primary || 'Scenario pending'}</div></div><div className="rounded-xl bg-white/[0.025] p-4"><div className="text-[9px] font-black tracking-widest text-slate-600">INVALIDATION</div><div className="mt-2 text-sm text-slate-300">{cryptoAnalysis.scenarios?.invalidation || 'Waiting for a confirmed invalidation level.'}</div></div><div className="rounded-xl bg-white/[0.025] p-4"><div className="text-[9px] font-black tracking-widest text-slate-600">DATA QUALITY</div><div className="mt-2 text-sm font-bold uppercase text-emerald-300">{cryptoAnalysis.data_quality?.status || 'UNKNOWN'}</div></div></div>
      </section>}

      <section className="grid gap-4 md:grid-cols-3">
        <WorkflowLink to="/scanner" icon={Radar} eyebrow="DISCOVER" title="Scan the market" copy="See every tracked pair and its latest confidence tier." />
        <WorkflowLink to="/tradingview" icon={BarChart3} eyebrow="CONFIRM" title="Open the chart" copy="Validate harmonics, ADR, structure, and live price action." />
        <WorkflowLink to="/journal" icon={Layers3} eyebrow="IMPROVE" title="Review the process" copy="Capture decisions and turn repetition into an edge." />
      </section>
    </div>
  );
};

const cardColors: Record<string, string> = {
  cyan: 'bg-cyan-400/10 text-cyan-300',
  violet: 'bg-violet-400/10 text-violet-300',
  fuchsia: 'bg-fuchsia-400/10 text-fuchsia-300',
};

const IntelCard: React.FC<{icon: React.ElementType; label: string; value: string; detail: string; color: string}> = ({ icon: Icon, label, value, detail, color }) => (
  <div className="group rounded-2xl border border-white/[0.08] bg-[#090d18] p-5 transition hover:-translate-y-1 hover:border-cyan-400/20">
    <div className="flex items-center justify-between"><div className={`flex h-10 w-10 items-center justify-center rounded-xl ${cardColors[color] || cardColors.cyan}`}><Icon className="h-5 w-5"/></div><Activity className="h-3.5 w-3.5 text-slate-700"/></div><div className="mt-5 text-3xl font-black tracking-tight">{value}</div><div className="mt-1 text-sm font-bold text-slate-300">{label}</div><div className="mt-1 text-xs text-slate-600">{detail}</div>
  </div>
);

const DataPoint: React.FC<{label: string; value: number}> = ({ label, value }) => <div className="rounded-lg bg-white/[0.04] p-2"><div className="text-[8px] font-bold tracking-wider text-slate-600">{label}</div><div className="mt-1 truncate font-mono text-[11px] text-slate-300">{Number.isFinite(value) ? value.toFixed(2) : '—'}</div></div>;

const WorkflowLink: React.FC<{to: string; icon: React.ElementType; eyebrow: string; title: string; copy: string}> = ({to, icon: Icon, eyebrow, title, copy}) => <Link to={to} className="group rounded-2xl border border-white/[0.08] bg-[#090d18] p-5 transition hover:-translate-y-1 hover:border-violet-400/25"><div className="flex items-start justify-between"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400/10 to-violet-400/10 text-cyan-300"><Icon className="h-5 w-5"/></div><ArrowRight className="h-4 w-4 text-slate-700 transition group-hover:translate-x-1 group-hover:text-cyan-300"/></div><div className="mt-5 text-[9px] font-black tracking-[0.2em] text-slate-600">{eyebrow}</div><h3 className="mt-1 text-lg font-black">{title}</h3><p className="mt-2 text-sm leading-relaxed text-slate-500">{copy}</p></Link>;

export default Dashboard;
