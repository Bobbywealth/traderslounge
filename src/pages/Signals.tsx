import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2,
  Clock3, Hourglass, RefreshCw, ShieldCheck, Target, TrendingUp, Zap, Brain,
} from 'lucide-react';
import {
  bwtsApi, planReasonText,
  type CryptoAnalysis, type DashboardSnapshot, type PublishedSignal,
} from '../services/bwtsApi';
import { SESSIONS, formatHours, hoursUntil, sessionIsOpen, sessionsAt, type SessionName } from '../utils/sessions';

type FeedFilter = 'ACTIVE' | 'ALL';
type SessionFilter = 'ALL' | SessionName;

// Must mirror `minimum_score` in scanner/trade_planner.build_trade_plan — a
// lower number here renders progress bars that read "ready" for setups the
// backend will never publish.
const QUALIFY_SCORE = 60;
const FORMING_FLOOR = 25; // below this a market is just noise, not "forming"

type FormingSetup = {
  pair: string;
  direction: CryptoAnalysis['direction'];
  score: number;
  lifecycle: string;
  waitingFor: string;
  scenario: string;
};

const isRenderableMarket = (market: unknown): market is DashboardSnapshot['markets'][number] => {
  if (!market || typeof market !== 'object') return false;
  const candidate = market as { signal?: unknown; analysis?: unknown };
  return Boolean(
    candidate.signal && typeof candidate.signal === 'object'
    && typeof (candidate.signal as { pair?: unknown }).pair === 'string'
    && candidate.analysis && typeof candidate.analysis === 'object'
  );
};

const Signals: React.FC = () => {
  const [signals, setSignals] = useState<PublishedSignal[]>([]);
  const [forming, setForming] = useState<FormingSetup[]>([]);
  const [blockers, setBlockers] = useState<{ label: string; count: number }[]>([]);
  const [scanned, setScanned] = useState(0);
  const [filter, setFilter] = useState<FeedFilter>('ACTIVE');
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    // Forming setups come from the scanner snapshot — best effort, never blocks the feed.
    bwtsApi.dashboardSnapshot()
      .then((snapshot) => {
        const all = (Array.isArray(snapshot.markets) ? snapshot.markets : []).filter(isRenderableMarket);
        // The snapshot carries one entry per recent signal, so a pair can repeat.
        // Collapse to one entry per pair — otherwise the board double-counts and
        // React sees duplicate keys.
        const seen = new Set<string>();
        const markets = all.filter((market) => {
          const pair = market.signal.pair;
          if (seen.has(pair)) return false;
          seen.add(pair);
          return true;
        });
        setScanned(markets.length);

        // Why isn't anything publishing? Tally the actual gate that each market
        // is stuck behind so the empty state can say something useful.
        const tally = new Map<string, number>();
        markets.forEach((market) => {
          const analysis = market.analysis as CryptoAnalysis;
          if (analysis.trade_plan?.eligible) return;
          const reasons = (analysis.trade_plan?.reasons || [])
            .map(planReasonText)
            .filter(Boolean);
          const labels = reasons.length ? reasons : ['Still building confluence'];
          labels.forEach((label) => tally.set(label, (tally.get(label) ?? 0) + 1));
        });
        setBlockers(
          [...tally.entries()]
            .map(([label, count]) => ({ label, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)
        );

        const candidates: FormingSetup[] = markets
          .map((market) => {
            const analysis = market.analysis as CryptoAnalysis;
            return {
              pair: market.signal.pair,
              direction: analysis.direction,
              score: analysis.total_score ?? 0,
              lifecycle: analysis.direction_stability?.lifecycle
                || (analysis.trade_plan?.eligible ? 'READY' : 'FORMING'),
              waitingFor: analysis.trade_plan?.reasons?.map(planReasonText).find(Boolean)
                || analysis.trade_timing?.wait_for?.[0]
                || 'More confluence to line up',
              scenario: analysis.scenarios?.primary || '',
            };
          })
          .filter((setup) => !['READY'].includes(setup.lifecycle))
          .filter((setup) => setup.score >= FORMING_FLOOR)
          .sort((a, b) => b.score - a.score);
        setForming(candidates);
      })
      .catch(() => {
        setForming([]);
        setBlockers([]);
        setScanned(0);
      });

    try {
      bwtsApi.clearCache();
      const response = await bwtsApi.publishedSignals({
        status: filter === 'ACTIVE' ? 'ACTIVE' : undefined,
        limit: 100,
      });
      setSignals(Array.isArray(response.signals) ? response.signals : []);
      setUpdatedAt(new Date());
    } catch (err: any) {
      setError(err?.message || 'The signal feed is temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const visibleSignals = useMemo(() => (
    sessionFilter === 'ALL'
      ? signals
      : signals.filter((signal) => sessionsAt(new Date(signal.published_at)).includes(sessionFilter))
  ), [signals, sessionFilter]);

  const active = useMemo(() => signals.filter((signal) => signal.status === 'ACTIVE'), [signals]);
  const strong = active.filter((signal) => signal.setup_quality === 'STRONG').length;

  const utcHour = now.getUTCHours();
  const openSessions = SESSIONS.filter((session) => sessionIsOpen(session, utcHour));
  const sessionLine = openSessions.length > 1
    ? `${openSessions.map((s) => s.name).join(' + ')} overlap — the highest-liquidity window of the day`
    : openSessions.length === 1
      ? `${openSessions[0].name} session live — closes in ${formatHours(hoursUntil(openSessions[0].endUtc, now))}`
      : (() => {
        const next = [...SESSIONS].sort((a, b) => hoursUntil(a.startUtc, now) - hoursUntil(b.startUtc, now))[0];
        return `Between sessions — ${next.name} opens in ${formatHours(hoursUntil(next.startUtc, now))}`;
      })();

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[28px] border border-cyan-400/15 bg-[#080d1a] p-6 shadow-2xl shadow-black/20 sm:p-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(34,211,238,0.14),transparent_34%),radial-gradient(circle_at_90%_30%,rgba(139,92,246,0.16),transparent_38%)]" />
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-3 py-1 text-[10px] font-black tracking-[0.2em] text-emerald-300">
              <ShieldCheck className="h-3 w-3" /> QUALIFIED CALLS ONLY
            </div>
            <h1 className="text-3xl font-black tracking-[-0.04em] cx-text-strong sm:text-4xl">Trade Signals</h1>
            <p className="mt-2 max-w-2xl text-sm cx-text-muted">
              A call publishes only after every entry rule passes. Below the live calls, the Forming board
              shows what the scanner is building toward next.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-2.5 text-xs font-black text-cyan-200 transition hover:bg-cyan-400/15 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh feed
          </button>
        </div>
        <div className="relative z-10 mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Active calls" value={String(active.length)} />
          <Metric label="Strong setups" value={String(strong)} />
          <Metric label="Forming" value={String(forming.length)} />
          <Metric label="Session" value={openSessions.map((s) => s.name).join(' + ') || 'Closed'} />
        </div>
        <div className="relative z-10 mt-3 flex items-center gap-2 text-[11px] cx-text-faint">
          <Clock3 className="h-3.5 w-3.5" /> {sessionLine}
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border cx-border cx-bg-card p-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex rounded-xl border cx-border cx-bg-elev p-1">
            {(['ACTIVE', 'ALL'] as FeedFilter[]).map((value) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`rounded-lg px-4 py-2 text-[10px] font-black uppercase tracking-wider transition ${
                  filter === value ? 'bg-cyan-400/15 text-cyan-200' : 'cx-text-faint hover:cx-text-muted'
                }`}
              >
                {value === 'ACTIVE' ? 'Active signals' : 'Signal history'}
              </button>
            ))}
          </div>
          <div className="flex rounded-xl border cx-border cx-bg-elev p-1">
            {(['ALL', 'Asia', 'London', 'New York'] as SessionFilter[]).map((value) => (
              <button
                key={value}
                onClick={() => setSessionFilter(value)}
                className={`rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-wider transition ${
                  sessionFilter === value ? 'bg-violet-400/15 text-violet-200' : 'cx-text-faint hover:cx-text-muted'
                }`}
              >
                {value === 'ALL' ? 'All sessions' : value}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider cx-text-faint">
          <Clock3 className="h-3.5 w-3.5" />
          {updatedAt ? `Updated ${updatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Loading feed'}
        </div>
      </section>

      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200">
          <AlertTriangle className="h-5 w-5" /> {error}
        </div>
      )}

      {!loading && !error && visibleSignals.length === 0 && (
        <section className="rounded-[24px] border border-dashed cx-border-strong cx-bg-card px-6 py-10 text-center">
          <Activity className="mx-auto h-10 w-10 cx-text-faint" />
          <h2 className="mt-4 text-xl font-black cx-text-strong">
            {sessionFilter === 'ALL' ? 'No active call right now' : `No ${sessionFilter}-session calls`}
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm cx-text-faint">
            {sessionFilter === 'ALL'
              ? `The scanner is watching ${scanned || 'every'} tracked market${scanned === 1 ? '' : 's'}. Nothing has cleared every entry rule yet.`
              : 'Switch to All sessions to see every call, or check the Forming board below.'}
          </p>
          {sessionFilter === 'ALL' && blockers.length > 0 && (
            <div className="mx-auto mt-6 max-w-xl text-left">
              <div className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] cx-text-faint">
                What is holding setups back
              </div>
              <ul className="space-y-1.5">
                {blockers.map((blocker) => (
                  <li
                    key={blocker.label}
                    className="flex items-center justify-between gap-3 rounded-xl border cx-border bg-white/[0.02] px-3 py-2"
                  >
                    <span className="text-xs cx-text-muted">{blocker.label}</span>
                    <span className="shrink-0 rounded-md cx-bg-card-hover px-2 py-0.5 text-[10px] font-black cx-text-muted">
                      {blocker.count} {blocker.count === 1 ? 'market' : 'markets'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        {visibleSignals.map((signal) => <SignalCall key={signal.id} signal={signal} />)}
      </div>

      {/* Forming — future potential trades */}
      <section className="rounded-[24px] border cx-border cx-bg-card p-5 sm:p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-black tracking-[0.2em] text-amber-300">FORMING</div>
            <h2 className="mt-1 text-xl font-black cx-text-strong">Potential future trades</h2>
            <p className="mt-1 text-xs cx-text-faint">
              Setups building confluence but not yet qualified. Each shows how close it is and what it still needs.
            </p>
          </div>
          <Link to="/scanner" className="flex shrink-0 items-center gap-1 text-xs font-bold cx-text-muted hover:cx-text">
            Full scanner <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {forming.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl border border-dashed cx-border-strong px-5 py-6 text-sm cx-text-faint">
            <Hourglass className="h-5 w-5 shrink-0 cx-text-faint" />
            Nothing is close to setting up right now, or the scanner snapshot is unavailable.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {forming.slice(0, 9).map((setup) => <FormingCard key={setup.pair} setup={setup} />)}
          </div>
        )}
      </section>

      <div className="rounded-2xl border border-amber-400/15 bg-amber-400/[0.05] p-4 text-xs leading-5 text-amber-100/70">
        <strong className="text-amber-200">Risk note:</strong> Signals are deterministic market intelligence, not guaranteed outcomes or personalized financial advice. Confirm price is still within the entry area and size risk from the published stop before acting.
      </div>
    </div>
  );
};

const FormingCard: React.FC<{ setup: FormingSetup }> = ({ setup }) => {
  const progress = Math.min(100, Math.round((setup.score / QUALIFY_SCORE) * 100));
  const leaning = setup.direction === 'BUY' ? 'Leaning buy' : setup.direction === 'SELL' ? 'Leaning sell' : 'No lean yet';
  const lifecycleTone = setup.lifecycle === 'CONFIRMED'
    ? 'bg-cyan-400/10 text-cyan-300'
    : setup.lifecycle === 'WEAKENING' || setup.lifecycle === 'INVALIDATED'
      ? 'bg-rose-400/10 text-rose-300'
      : 'bg-amber-400/10 text-amber-300';
  return (
    <article className="rounded-2xl border cx-border cx-bg-elev p-4">
      <div className="flex items-center justify-between">
        <span className="font-black cx-text-strong">{setup.pair}</span>
        <span className={`rounded-md px-2 py-0.5 text-[10px] font-black ${lifecycleTone}`}>{setup.lifecycle}</span>
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[11px] font-bold cx-text-muted">
        {setup.direction === 'BUY' ? <TrendingUp className="h-3.5 w-3.5 text-emerald-400" /> : setup.direction === 'SELL' ? <TrendingUp className="h-3.5 w-3.5 rotate-180 text-rose-400" /> : null}
        {leaning}
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between text-[10px] font-bold cx-text-faint">
          <span>Confluence {setup.score}/{QUALIFY_SCORE} to qualify</span>
          <span>{progress}%</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full cx-bg-card-hover">
          <div
            className={`h-full rounded-full ${progress >= 80 ? 'bg-emerald-400/80' : progress >= 50 ? 'bg-cyan-400/70' : 'bg-slate-500/60'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      <div className="mt-3 text-[11px] leading-5 cx-text-muted">
        <span className="font-black uppercase tracking-wider cx-text-faint">Waiting for: </span>
        {setup.waitingFor}
      </div>
    </article>
  );
};

const SignalCall: React.FC<{ signal: PublishedSignal }> = ({ signal }) => {
  const isBuy = signal.direction === 'BUY';
  const published = new Date(signal.published_at);
  const publishedSessions = sessionsAt(published);
  return (
    <article className={`overflow-hidden rounded-[24px] border ${isBuy ? 'border-emerald-400/20' : 'border-rose-400/20'} bg-[#080d18] shadow-xl shadow-black/20`}>
      <div className={`flex items-center justify-between border-b px-5 py-4 ${isBuy ? 'border-emerald-400/15 bg-emerald-400/[0.06]' : 'border-rose-400/15 bg-rose-400/[0.06]'}`}>
        <div className="flex items-center gap-3">
          <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${isBuy ? 'bg-emerald-400/15 text-emerald-300' : 'bg-rose-400/15 text-rose-300'}`}>
            {isBuy ? <ArrowUpRight className="h-6 w-6" /> : <ArrowDownRight className="h-6 w-6" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black cx-text-strong">{signal.pair}</h2>
              <span className={`rounded-md px-2 py-0.5 text-[10px] font-black ${isBuy ? 'bg-emerald-400/15 text-emerald-300' : 'bg-rose-400/15 text-rose-300'}`}>{signal.direction}</span>
              {publishedSessions.length > 0 && (
                <span className="rounded-md bg-violet-400/10 px-2 py-0.5 text-[10px] font-black text-violet-300">
                  {publishedSessions.join(' + ').toUpperCase()}
                </span>
              )}
            </div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-wider cx-text-faint">{signal.timeframe} · Published {published.toLocaleString()}</div>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-[10px] font-black uppercase tracking-wider ${isBuy ? 'text-emerald-300' : 'text-rose-300'}`}>{signal.status.replace(/_/g, ' ')}</div>
          <div className="mt-1 text-lg font-black cx-text-strong">{signal.score}/100</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-b px-5 py-3 cx-border">
        <Link
          to={`/debate?pair=${encodeURIComponent(signal.pair)}&timeframe=${encodeURIComponent(signal.timeframe || '1h')}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-cyan-300 transition-colors hover:border-cyan-400/50 hover:bg-cyan-400/15"
          title="Run the AI Trade Debate Council on this setup"
        >
          <Brain className="h-3 w-3" />
          Open AI Debate
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-px cx-bg-card-hover sm:grid-cols-5">
        <Level label="Entry" value={formatPrice(signal.entry)} tone="cyan" />
        <Level label="Stop loss" value={formatPrice(signal.stop_loss)} tone="rose" />
        <Level label="TP1" value={formatPrice(signal.tp1)} tone="emerald" />
        <Level label="TP2" value={formatPrice(signal.tp2)} tone="emerald" />
        <Level label="TP3" value={formatPrice(signal.tp3)} tone="emerald" />
      </div>

      <div className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fact label="Setup" value={signal.setup_quality} icon={Zap} />
          <Fact label="Net available R:R" value={signal.net_rr ? `${signal.net_rr.toFixed(2)}R` : '—'} icon={Target} />
          <Fact label="Risk model" value={signal.risk_percent ? `${signal.risk_percent}% of account` : '—'} icon={ShieldCheck} />
          <Fact label="Calendar" value={signal.calendar_status} icon={CheckCircle2} />
        </div>
        <div>
          <div className="text-[9px] font-black uppercase tracking-[0.18em] cx-text-faint">Trade thesis</div>
          <p className="mt-1.5 text-sm leading-6 cx-text-muted">{signal.scenario}</p>
        </div>
        {signal.rationale?.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {signal.rationale.map((reason) => (
              <span key={reason} className="rounded-lg border cx-border bg-white/[0.03] px-2.5 py-1 text-[10px] font-bold cx-text-muted">{reason}</span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
};

const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-2xl border cx-border cx-bg-elev p-3">
    <div className="text-[9px] font-black uppercase tracking-widest cx-text-faint">{label}</div>
    <div className="mt-1 text-lg font-black cx-text-strong">{value}</div>
  </div>
);

const Level: React.FC<{ label: string; value: string; tone: 'cyan' | 'rose' | 'emerald' }> = ({ label, value, tone }) => (
  <div className="bg-[#0b101d] p-4 text-center">
    <div className="text-[9px] font-black uppercase tracking-widest cx-text-faint">{label}</div>
    <div className={`mt-1 text-sm font-black ${tone === 'rose' ? 'text-rose-300' : tone === 'emerald' ? 'text-emerald-300' : 'text-cyan-300'}`}>{value}</div>
  </div>
);

const Fact: React.FC<{ label: string; value: string; icon: React.ElementType }> = ({ label, value, icon: Icon }) => (
  <div className="rounded-xl border cx-border cx-bg-card p-3">
    <Icon className="h-4 w-4 cx-text-faint" />
    <div className="mt-2 text-[9px] font-black uppercase tracking-wider cx-text-faint">{label}</div>
    <div className="mt-0.5 text-xs font-black cx-text">{value}</div>
  </div>
);

const formatPrice = (value: number | null) => {
  if (value == null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (Math.abs(value) >= 10) return value.toFixed(2);
  return value.toFixed(5);
};

export default Signals;
