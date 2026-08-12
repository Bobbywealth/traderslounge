import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowUpRight, Brain, ChevronDown, ChevronUp, Clock, Loader2,
  RefreshCw, ShieldAlert, Sparkles, TrendingDown, TrendingUp, Users,
} from 'lucide-react';
import { bwtsApi, type DebateResult } from '../services/bwtsApi';

const SUPPORTED_TIMEFRAMES = ['1h', '4h', '1d', '1w'] as const;
type Timeframe = typeof SUPPORTED_TIMEFRAMES[number];

const VERDICT_TONE: Record<string, { text: string; bg: string; border: string; icon: React.ReactNode }> = {
  BUY:          { text: 'text-emerald-300', bg: 'bg-emerald-400/10', border: 'border-emerald-400/30', icon: <TrendingUp className="h-3 w-3" /> },
  SELL:         { text: 'text-rose-300',    bg: 'bg-rose-400/10',    border: 'border-rose-400/30',    icon: <TrendingDown className="h-3 w-3" /> },
  WAIT:         { text: 'text-amber-300',   bg: 'bg-amber-400/10',   border: 'border-amber-400/30',   icon: <Clock className="h-3 w-3" /> },
  PROCEED:      { text: 'text-cyan-300',    bg: 'bg-cyan-400/10',    border: 'border-cyan-400/30',    icon: <ShieldAlert className="h-3 w-3" /> },
  REDUCE_SIZE:  { text: 'text-amber-300',   bg: 'bg-amber-400/10',   border: 'border-amber-400/30',   icon: <ShieldAlert className="h-3 w-3" /> },
};

const MODE_BADGE: Record<string, { label: string; cls: string }> = {
  ai:                     { label: 'AI Council', cls: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-300' },
  partial:                { label: 'AI Council (partial)', cls: 'border-amber-400/30 bg-amber-400/10 text-amber-300' },
  deterministic_fallback: { label: 'Deterministic fallback', cls: 'border-slate-400/30 bg-slate-400/10 text-slate-300' },
};

const fmtAgo = (epochSeconds?: number) => {
  if (!epochSeconds) return '—';
  const delta = Math.max(0, Math.floor(Date.now() / 1000 - epochSeconds));
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  return `${Math.floor(delta / 3600)}h ago`;
};

const clampPct = (n: number) => Math.max(0, Math.min(100, Math.round(n * 100)));

const VerdictPill: React.FC<{ verdict: string; size?: 'sm' | 'md' }> = ({ verdict, size = 'sm' }) => {
  const tone = VERDICT_TONE[verdict] || VERDICT_TONE.WAIT;
  const sizeCls = size === 'md' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border font-black uppercase tracking-wider ${tone.bg} ${tone.border} ${tone.text} ${sizeCls}`}>
      {tone.icon}
      {verdict}
    </span>
  );
};

const AgentCard: React.FC<{
  title: string;
  tagline: string;
  icon: React.ReactNode;
  accent: 'emerald' | 'rose' | 'amber';
  agent: DebateResult['bull'] | DebateResult['bear'] | DebateResult['risk_macro'];
}> = ({ title, tagline, icon, accent, agent }) => {
  const [open, setOpen] = useState(false);
  const tone = VERDICT_TONE[agent.verdict] || VERDICT_TONE.WAIT;
  const accentBorder = {
    emerald: 'border-emerald-400/25',
    rose: 'border-rose-400/25',
    amber: 'border-amber-400/25',
  }[accent];

  return (
    <article className={`flex flex-col rounded-2xl border bg-slate-950/40 p-5 ${accentBorder}`}>
      <header className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${tone.bg} ${tone.text}`}>{icon}</div>
          <div>
            <div className="text-sm font-black tracking-wide text-slate-100">{title}</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400">{tagline}</div>
          </div>
        </div>
        <VerdictPill verdict={agent.verdict} />
      </header>

      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-400">
          <span>Confidence</span>
          <span className={`font-black ${tone.text}`}>{clampPct(agent.confidence)}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800/80">
          <div className={`h-full ${tone.bg.replace('/10', '/60')}`} style={{ width: `${clampPct(agent.confidence)}%` }} />
        </div>
      </div>

      <p className="mb-3 text-sm leading-snug text-slate-200">{agent.summary || '—'}</p>

      {agent.arguments.length > 0 && (
        <ul className="mb-3 space-y-1.5 text-sm text-slate-300">
          {agent.arguments.slice(0, open ? agent.arguments.length : 3).map((arg, i) => (
            <li key={i} className="flex gap-2">
              <span className={`mt-1 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${tone.bg.replace('/10', '')}`} />
              <span>{arg}</span>
            </li>
          ))}
        </ul>
      )}

      {agent.blocking_gates.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-400/20 bg-amber-400/5 p-2.5 text-xs text-amber-200/80">
          <div className="mb-1 font-black uppercase tracking-wider text-[10px] text-amber-300">Blocking gates</div>
          <ul className="space-y-0.5">
            {agent.blocking_gates.map((g, i) => <li key={i}>• {g}</li>)}
          </ul>
        </div>
      )}

      {(agent.arguments.length > 3 || agent.evidence_refs.length > 0) && (
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="mt-auto inline-flex items-center gap-1 self-start text-[10px] font-black uppercase tracking-wider text-slate-400 hover:text-slate-200"
        >
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {open ? 'Hide details' : 'Show evidence'}
        </button>
      )}

      {open && agent.evidence_refs.length > 0 && (
        <div className="mt-3 rounded-lg border border-slate-700/60 bg-slate-900/60 p-2.5 text-[11px] text-slate-400">
          <div className="mb-1 font-black uppercase tracking-wider text-[10px] text-slate-300">Evidence references</div>
          <ul className="space-y-0.5 font-mono">
            {agent.evidence_refs.map((ref, i) => <li key={i}>• {ref}</li>)}
          </ul>
        </div>
      )}
    </article>
  );
};

const ChiefTraderCard: React.FC<{ chief: DebateResult['chief_trader']; calendar: DebateResult['calendar'] }> = ({ chief, calendar }) => {
  const tone = VERDICT_TONE[chief.verdict] || VERDICT_TONE.WAIT;
  const calendarTone = calendar.status === 'CLEAR'
    ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
    : calendar.status === 'BLOCKED' || calendar.status === 'POST_NEWS'
      ? 'border-rose-400/30 bg-rose-400/10 text-rose-300'
      : 'border-amber-400/25 bg-amber-400/10 text-amber-300';

  return (
    <section className={`relative overflow-hidden rounded-3xl border ${tone.border} bg-slate-950/60 p-6 shadow-lg`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,rgba(34,211,238,0.10),transparent_50%),radial-gradient(circle_at_100%_100%,rgba(139,92,246,0.10),transparent_55%)]" />
      <div className="relative">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone.bg} ${tone.text}`}>
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Chief Trader verdict</div>
              <div className="text-base font-black text-slate-100">Council synthesis</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${calendarTone}`}>
              Calendar: {calendar.status}
            </span>
            <VerdictPill verdict={chief.verdict} size="md" />
          </div>
        </div>

        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-400">
            <span>Council confidence</span>
            <span className={`font-black ${tone.text}`}>{clampPct(chief.confidence)}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800/80">
            <div className={`h-full ${tone.bg.replace('/10', '/70')}`} style={{ width: `${clampPct(chief.confidence)}%` }} />
          </div>
        </div>

        <p className="mb-4 text-base font-medium leading-snug text-slate-100">{chief.summary}</p>

        {chief.narrative && (
          <p className="mb-4 text-sm leading-relaxed text-slate-300">{chief.narrative}</p>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {chief.supporting.length > 0 && (
            <div>
              <div className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300">Supporting</div>
              <ul className="space-y-1.5 text-sm text-slate-200">
                {chief.supporting.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400/80" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {chief.against.length > 0 && (
            <div>
              <div className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-rose-300">Against</div>
              <ul className="space-y-1.5 text-sm text-slate-200">
                {chief.against.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-rose-400/80" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {chief.blocking_gates.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/5 p-3 text-xs text-amber-100/85">
            <div className="mb-1.5 flex items-center gap-1.5 font-black uppercase tracking-wider text-[10px] text-amber-300">
              <AlertTriangle className="h-3 w-3" />
              Blocking gates before acting
            </div>
            <ul className="space-y-1">
              {chief.blocking_gates.map((g, i) => <li key={i}>• {g}</li>)}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
};

const DeterministicSection: React.FC<{ det: DebateResult['deterministic'] }> = ({ det }) => {
  if (!det || (!det.bull_case?.length && !det.bear_case?.length && !det.agents?.length)) return null;
  return (
    <section className="rounded-2xl border border-slate-700/60 bg-slate-950/40 p-5">
      <div className="mb-3 flex items-center gap-2">
        <Users className="h-4 w-4 text-slate-300" />
        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Deterministic consensus</div>
        <span className="ml-auto text-[10px] text-slate-500">Always shown alongside AI agents</span>
      </div>
      {det.agents?.length ? (
        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          {det.agents.map(a => (
            <div key={a.agent} className="rounded-lg border border-slate-700/60 bg-slate-900/60 p-2.5">
              <div className="mb-0.5 flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-400">
                <span>{a.label}</span>
                <span className="font-black text-slate-200">{a.vote}</span>
              </div>
              <div className="text-[11px] text-slate-400">{a.reason}</div>
              <div className="mt-1 text-[10px] text-slate-500">Confidence {Math.round(a.confidence)}%</div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-emerald-300">Bull case</div>
          <ul className="space-y-1 text-sm text-slate-300">
            {det.bull_case?.map((b, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400/80" />
                <span>{b.argument}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-rose-300">Bear case</div>
          <ul className="space-y-1 text-sm text-slate-300">
            {det.bear_case?.map((b, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-rose-400/80" />
                <span>{b.argument}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
};

const ErrorBanner: React.FC<{ errors: Record<string, string> }> = ({ errors }) => {
  const keys = Object.keys(errors || {});
  if (!keys.length) return null;
  return (
    <div className="rounded-xl border border-amber-400/25 bg-amber-400/5 p-3 text-xs text-amber-100/85">
      <div className="mb-1 flex items-center gap-1.5 font-black uppercase tracking-wider text-[10px] text-amber-300">
        <AlertTriangle className="h-3 w-3" />
        Council ran partially — these stages used the deterministic fallback
      </div>
      <ul className="space-y-0.5">
        {keys.map(k => <li key={k}>• <span className="font-mono">{k}</span>: {errors[k]}</li>)}
      </ul>
    </div>
  );
};

const Debate: React.FC = () => {
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const pairParam = (params.pair || searchParams.get('pair') || 'BTCUSD').toUpperCase();
  const tfParam = (searchParams.get('timeframe') || '1h').toLowerCase() as Timeframe;
  const timeframe = SUPPORTED_TIMEFRAMES.includes(tfParam) ? tfParam : '1h';

  const [data, setData] = useState<DebateResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allPairs, setAllPairs] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await bwtsApi.getDebate(pairParam, timeframe);
      setData(res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [pairParam, timeframe]);

  useEffect(() => {
    let cancelled = false;
    bwtsApi.pairs()
      .then((r) => { if (!cancelled && Array.isArray(r?.pairs)) setAllPairs(r.pairs.map(p => p.toUpperCase())); })
      .catch(() => { /* keep empty list, current pair still works */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { load(); }, [load]);

  const mode = data?.mode || 'deterministic_fallback';
  const modeBadge = MODE_BADGE[mode] || MODE_BADGE.deterministic_fallback;

  const onTimeframeChange = (tf: Timeframe) => {
    const next = new URLSearchParams(searchParams);
    next.set('timeframe', tf);
    setSearchParams(next, { replace: true });
  };

  const onPairChange = (p: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('pair', p.toUpperCase());
    setSearchParams(next, { replace: true });
  };

  const pairOptions = useMemo(() => {
    const fallback = ['BTCUSD', 'ETHUSD', 'SOLUSD'];
    const base = allPairs.length > 0 ? allPairs : fallback;
    const withCurrent = base.includes(pairParam) ? base : [pairParam, ...base];
    return Array.from(new Set(withCurrent.map(p => p.toUpperCase())));
  }, [allPairs, pairParam]);

  return (
    <div className="space-y-6">
      <header className="relative overflow-hidden rounded-3xl border border-slate-700/60 bg-slate-950/50 p-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,rgba(139,92,246,0.10),transparent_45%),radial-gradient(circle_at_100%_100%,rgba(34,211,238,0.10),transparent_45%)]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-400/30 bg-cyan-400/10 text-cyan-300">
              <Brain className="h-6 w-6" />
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-300">AI Trade Debate</div>
              <h1 className="mt-1 text-2xl font-black text-slate-50">{pairParam} <span className="text-slate-400 text-base font-medium">· {timeframe.toUpperCase()} council</span></h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-400">
                Four agents argue the case, then the Chief Trader adjudicates. Advisory only — canonical V2 direction,
                score, and trade plan remain the source of truth.
              </p>
            </div>
          </div>
          <div className="flex flex-col items-stretch gap-2 lg:items-end">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${modeBadge.cls}`}>
                {modeBadge.label}
              </span>
              <div className="flex rounded-lg border border-slate-700 bg-slate-900 p-0.5">
                {SUPPORTED_TIMEFRAMES.map(tf => (
                  <button
                    key={tf}
                    onClick={() => onTimeframeChange(tf)}
                    className={`rounded-md px-2.5 py-1 text-[10px] font-black uppercase tracking-wider transition-colors ${
                      timeframe === tf ? 'bg-cyan-400/20 text-cyan-300' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={load}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-slate-200 hover:border-cyan-400/40 disabled:opacity-50"
                data-testid="debate-refresh"
              >
                <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2">
              <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Pair</span>
              <div className="-mx-1 flex max-w-full overflow-x-auto" data-testid="debate-pair-row">
                <div className="flex items-center gap-1 px-1">
                  {pairOptions.map(p => (
                    <button
                      key={p}
                      onClick={() => onPairChange(p)}
                      className={`whitespace-nowrap rounded-md px-2.5 py-1 text-[10px] font-black uppercase tracking-wider transition-colors ${
                        p === pairParam
                          ? 'bg-cyan-400/25 text-cyan-200 ring-1 ring-cyan-400/40'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'
                      }`}
                      title={`Run the AI Debate Council on ${p}`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
        {data && (
          <div className="relative mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
            <span>Generated {fmtAgo(data.generated_at)}</span>
            {data.elapsed_ms !== undefined && <span>· {data.elapsed_ms}ms</span>}
            {data.cache?.stale && (
              <span className="inline-flex items-center gap-1 text-amber-300">
                <AlertTriangle className="h-3 w-3" />
                Underlying market data is stale
              </span>
            )}
            <Link
              to={`/tradingview?symbol=${pairParam}&timeframe=${timeframe}`}
              className="ml-auto inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200"
            >
              Open in Chart <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        )}
      </header>

      {error && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200">
          <div className="mb-1 flex items-center gap-1.5 font-black uppercase tracking-wider text-[10px] text-rose-300">
            <AlertTriangle className="h-3 w-3" />
            Could not load debate
          </div>
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center rounded-2xl border border-slate-700/60 bg-slate-950/40 p-12 text-slate-400">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Council is convening…
        </div>
      )}

      {data && (
        <>
          <ErrorBanner errors={data.errors || {}} />
          <ChiefTraderCard chief={data.chief_trader} calendar={data.calendar} />
          <div className="grid gap-4 lg:grid-cols-3">
            <AgentCard
              title="Bull Advocate"
              tagline="Argues the upside"
              icon={<TrendingUp className="h-4 w-4" />}
              accent="emerald"
              agent={data.bull}
            />
            <AgentCard
              title="Bear Advocate"
              tagline="Argues the downside"
              icon={<TrendingDown className="h-4 w-4" />}
              accent="rose"
              agent={data.bear}
            />
            <AgentCard
              title="Risk / Macro"
              tagline="Calendar & volatility lens"
              icon={<ShieldAlert className="h-4 w-4" />}
              accent="amber"
              agent={data.risk_macro}
            />
          </div>
          <DeterministicSection det={data.deterministic} />
          <p className="text-[11px] leading-relaxed text-slate-500">
            The AI Trade Debate Council is advisory. It does not execute trades, change canonical V2 direction or score,
            or override the economic-calendar gate. The deterministic V2 scanner, intelligence consensus, and economic
            calendar remain the source of truth.
          </p>
        </>
      )}
    </div>
  );
};

export default Debate;
