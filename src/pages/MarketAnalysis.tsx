import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Clock,
  Gauge,
  History,
  LineChart as LineChartIcon,
  ShieldAlert,
  Target,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import bwtsApi, { type CryptoAnalysis } from '../services/bwtsApi';
import { formatPercent, formatPrice, formatRelative } from '../utils/format';
import { formatScoreOver100, scoreTone } from '../utils/scoring';
import DataAttribution from '../components/DataAttribution';

const TIMEFRAMES: ReadonlyArray<{ key: string; label: string }> = [
  { key: '1h', label: '1H' },
  { key: '4h', label: '4H' },
  { key: '1d', label: '1D' },
  { key: '1w', label: '1W' },
];

const DIRECTION_LABEL: Record<string, string> = {
  BUY: 'Buy setup',
  SELL: 'Sell setup',
  NEUTRAL: 'No clear direction',
};

const DIRECTION_COLOR: Record<string, string> = {
  BUY: 'text-emerald-300',
  SELL: 'text-rose-300',
  NEUTRAL: 'text-slate-300',
};

const TIMING_TONE: Record<string, { chip: string; label: string }> = {
  READY: { chip: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300', label: 'Ready now' },
  WAIT: { chip: 'border-amber-400/25 bg-amber-400/10 text-amber-300', label: 'Wait' },
  AVOID: { chip: 'border-rose-400/25 bg-rose-400/10 text-rose-300', label: 'Avoid' },
};

const CALENDAR_LABEL: Record<string, { chip: string; label: string }> = {
  CLEAR: { chip: 'border-emerald-400/20 bg-emerald-400/5 text-emerald-300', label: 'News clear' },
  CAUTION: { chip: 'border-amber-400/20 bg-amber-400/5 text-amber-300', label: 'News caution' },
  BLOCKED: { chip: 'border-rose-400/20 bg-rose-400/5 text-rose-300', label: 'News blocked' },
  POST_NEWS: { chip: 'border-violet-400/20 bg-violet-400/5 text-violet-300', label: 'Post-news cooldown' },
  UNAVAILABLE: { chip: 'border-slate-400/20 bg-slate-400/5 text-slate-400', label: 'News feed unavailable' },
};

interface BreadcrumbProps {
  pair: string;
}

const Breadcrumb: React.FC<BreadcrumbProps> = ({ pair }) => (
  <div className="flex items-center gap-2 text-xs text-slate-500">
    <Link
      to="/scanner"
      className="inline-flex items-center gap-1 rounded-md border border-white/[0.06] bg-white/[0.025] px-2 py-1 text-slate-300 transition hover:bg-white/[0.06]"
    >
      <ArrowLeft className="h-3 w-3" />
      Scanner
    </Link>
    <span className="text-slate-600">/</span>
    <span className="text-slate-400">Analysis</span>
    <span className="text-slate-600">/</span>
    <span className="font-black text-white">{pair}</span>
  </div>
);

interface MetricBoxProps {
  label: string;
  value: number;
  hint: string;
  icon: React.ReactNode;
  isCurrency?: boolean;
}

const MetricBox: React.FC<MetricBoxProps> = ({ label, value, hint, icon, isCurrency }) => (
  <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-4">
    <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
      <span className="inline-flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <span className={`text-base font-black ${scoreTone(value)}`}>
        {isCurrency ? formatPrice(value) : formatScoreOver100(value)}
      </span>
    </div>
    <p className="mt-2 text-xs leading-relaxed text-slate-400">{hint}</p>
  </div>
);

interface MeasurementExplainerProps {
  analysis: CryptoAnalysis;
}

const MeasurementExplainer: React.FC<MeasurementExplainerProps> = ({ analysis }) => {
  const dq = analysis.decision_quality;
  const bias = dq?.market_bias_confidence ?? analysis.confluence_score ?? analysis.total_score ?? 0;
  const quality = dq?.setup_quality ?? 0;
  const timing = dq?.execution_readiness ?? 0;
  return (
    <section
      data-testid="measurement-explainer"
      className="rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.03] p-5"
    >
      <div className="flex items-start gap-3">
        <Gauge className="mt-0.5 h-5 w-5 flex-none text-cyan-300" />
        <div className="min-w-0">
          <h2 className="text-sm font-black text-white">How to read these three numbers</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            ConfluenceX scores every market on three independent measurements. Each one answers a
            different question. Use all three together — never any one alone.
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <MetricBox
          label="Bias"
          value={bias}
          hint="How strongly the structure leans bullish or bearish across all timeframes. Higher means more agreement — not that the trade is ready."
          icon={<Activity className="h-3 w-3" />}
        />
        <MetricBox
          label="Quality"
          value={quality}
          hint="How clean the setup is — categories aligned, indicators confirming, no contradictions. Higher means a more textbook setup."
          icon={<Target className="h-3 w-3" />}
        />
        <MetricBox
          label="Timing"
          value={timing}
          hint="Whether NOW is the moment to act. This is the gate — a high quality setup still requires a high timing score to be considered actionable."
          icon={<Clock className="h-3 w-3" />}
        />
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        Bias, quality, and timing are independent. A 90/90/30 setup means the picture is strong but
        the moment is not right. Wait for timing to climb before sizing in.
      </p>
    </section>
  );
};

interface ScenariosPanelProps {
  analysis: CryptoAnalysis;
}

const ScenariosPanel: React.FC<ScenariosPanelProps> = ({ analysis }) => {
  const dq = analysis.decision_quality;
  const primary = analysis.scenarios?.primary;
  const invalidation = analysis.scenarios?.invalidation;
  const conditions = Array.isArray(dq?.entry_alert?.conditions)
    ? (dq!.entry_alert!.conditions as unknown[]).map((c) => String(c)).filter(Boolean)
    : [];
  const monitoring = Array.isArray(analysis.monitoring) ? analysis.monitoring : [];
  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-5">
      <div className="flex items-start gap-3">
        <LineChartIcon className="mt-0.5 h-5 w-5 flex-none text-violet-300" />
        <div className="min-w-0">
          <h2 className="text-sm font-black text-white">What would confirm the setup, and what would break it</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            The primary scenario is what the engine expects if conditions stay as they are.
            Invalidation is the line price cannot cross without the idea being wrong.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04] p-4">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-300">
            <CheckCircle2 className="h-3 w-3" /> Primary scenario
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-200">{primary || 'No primary scenario yet.'}</p>
        </div>
        <div className="rounded-xl border border-rose-400/15 bg-rose-400/[0.04] p-4">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-rose-300">
            <XCircle className="h-3 w-3" /> Invalidation
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-200">{invalidation || 'No invalidation level yet.'}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-cyan-300">
            <CheckCircle2 className="h-3 w-3" /> Confirmations to wait for
          </div>
          <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-300">
            {(conditions.length > 0 ? conditions : ['No confirmations pending — engine will surface them when setup stabilizes.']).map(
              (line, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className="text-cyan-400">•</span>
                  <span>{line}</span>
                </li>
              ),
            )}
          </ul>
        </div>
        <div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-violet-300">
            <BarChart3 className="h-3 w-3" /> What we monitor
          </div>
          <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-300">
            {(monitoring.length > 0 ? monitoring : ['Standard structural monitoring is active.']).map((line, idx) => (
              <li key={idx} className="flex gap-2">
                <span className="text-violet-400">•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
};

interface HistoryTileProps {
  pair: string;
  timeframe: string;
}

const HistoryTile: React.FC<HistoryTileProps> = ({ pair, timeframe }) => {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ready'; report: { samples: number; win_rate: number | null; expectancy_r: number | null } }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const report = await bwtsApi.v2Backtest(pair, timeframe, 5000);
      const samples = (report as unknown as { total_trades?: number }).total_trades ?? 0;
      const winRate = (report as unknown as { win_rate?: number }).win_rate ?? null;
      const expectancy = (report as unknown as { avg_r?: number }).avg_r ?? null;
      setState({ kind: 'ready', report: { samples, win_rate: winRate, expectancy_r: expectancy } });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [pair, timeframe]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-5">
      <div className="flex items-start gap-3">
        <History className="mt-0.5 h-5 w-5 flex-none text-amber-300" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-black text-white">How similar setups performed</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            The engine replays historical bars through the same logic and reports the actual
            distribution. Forward-tested samples (live, not in-sample) will replace this in Phase 4.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="rounded-md border border-white/[0.06] bg-white/[0.025] px-2.5 py-1.5 text-[11px] font-black text-slate-300 transition hover:bg-white/[0.06]"
        >
          Refresh
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {state.kind === 'loading' && (
          <div className="col-span-full py-6 text-center text-xs text-slate-500">Loading historical replay…</div>
        )}
        {state.kind === 'error' && (
          <div className="col-span-full rounded-lg border border-rose-400/20 bg-rose-400/[0.04] p-3 text-xs text-rose-300">
            {state.message}
          </div>
        )}
        {state.kind === 'ready' && (
          <>
            <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Samples</div>
              <div className="mt-1 text-base font-black text-white">{state.report.samples.toLocaleString()}</div>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Win rate</div>
              <div className="mt-1 text-base font-black text-white">
                {state.report.win_rate == null ? '—' : formatPercent(state.report.win_rate, { maximumFractionDigits: 1 })}
              </div>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Avg R</div>
              <div className="mt-1 text-base font-black text-white">
                {state.report.expectancy_r == null ? '—' : state.report.expectancy_r.toFixed(2)}
              </div>
            </div>
          </>
        )}
        {state.kind === 'idle' && (
          <div className="col-span-full py-6 text-center text-xs text-slate-500">Preparing historical replay…</div>
        )}
      </div>
    </section>
  );
};

interface RiskPanelProps {
  analysis: CryptoAnalysis;
}

const RiskPanel: React.FC<RiskPanelProps> = ({ analysis }) => {
  const dq = analysis.decision_quality;
  const profile = dq?.financial_risk_profile;
  const stop = profile?.stop_pct;
  const atrStop = analysis.risk?.atr_stop ?? null;
  const spread = profile?.spread_bps;
  const riskScore = profile?.risk_score_1_to_10;
  const exposure = profile?.max_recommended_account_exposure_pct;
  const rr = profile?.net_rr_after_fees;
  const sizingStatus = profile?.sizing_rule_status;
  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-5">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 flex-none text-rose-300" />
        <div className="min-w-0">
          <h2 className="text-sm font-black text-white">Risk reality check</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            These numbers describe the risk of trading this market RIGHT NOW. They do not recommend
            a trade — they describe the trade you would be taking if you entered.
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">ATR stop distance</div>
          <div className="mt-1 text-base font-black text-white">{atrStop == null ? '—' : formatPrice(atrStop)}</div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Stop % of price</div>
          <div className="mt-1 text-base font-black text-white">
            {stop == null ? '—' : `${(stop * 100).toFixed(2)}%`}
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Spread (bps)</div>
          <div className="mt-1 text-base font-black text-white">{spread == null ? '—' : spread}</div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Risk score (1–10)</div>
          <div className="mt-1 text-base font-black text-white">{riskScore == null ? '—' : riskScore}</div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Max exposure %</div>
          <div className="mt-1 text-base font-black text-white">
            {exposure == null ? '—' : `${exposure.toFixed(1)}%`}
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Net R after fees</div>
          <div className="mt-1 text-base font-black text-white">{rr == null ? '—' : rr.toFixed(2)}</div>
        </div>
      </div>
      {sizingStatus && (
        <div
          className={`mt-3 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
            sizingStatus === 'ok'
              ? 'border-emerald-400/20 bg-emerald-400/[0.04] text-emerald-300'
              : 'border-amber-400/20 bg-amber-400/[0.04] text-amber-300'
          }`}
        >
          Sizing rule status: <span className="font-black uppercase tracking-wider">{sizingStatus}</span>
        </div>
      )}
    </section>
  );
};

interface NewsPanelProps {
  analysis: CryptoAnalysis;
}

const NewsPanel: React.FC<NewsPanelProps> = ({ analysis }) => {
  const cal = analysis.economic_calendar;
  const status = cal?.status;
  const tone = (status && CALENDAR_LABEL[status]) || CALENDAR_LABEL.UNAVAILABLE;
  const upcoming = Array.isArray(cal?.upcoming_events) ? cal!.upcoming_events! : [];
  const reasons = Array.isArray(cal?.blocking_reasons) ? cal!.blocking_reasons! : [];
  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-5">
      <div className="flex items-start gap-3">
        <CalendarClock className="mt-0.5 h-5 w-5 flex-none text-violet-300" />
        <div className="min-w-0">
          <h2 className="text-sm font-black text-white">News risk on this pair</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            News and economic events can invalidate a setup mid-bar. The status below blocks entries
            in real time.
          </p>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-black uppercase tracking-wider ${tone.chip}`}>
          {tone.label}
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {reasons.length > 0 && (
          <div className="rounded-lg border border-amber-400/15 bg-amber-400/[0.04] p-3 text-xs leading-relaxed text-amber-200">
            <div className="mb-1 text-[10px] font-black uppercase tracking-[0.14em] text-amber-300">
              Why this is gated
            </div>
            <ul className="space-y-1">
              {reasons.map((r, idx) => (
                <li key={idx}>• {r}</li>
              ))}
            </ul>
          </div>
        )}
        {upcoming.length === 0 && reasons.length === 0 && (
          <p className="text-xs text-slate-500">No flagged events on the near horizon for this pair.</p>
        )}
      </div>
    </section>
  );
};

const MarketAnalysis: React.FC = () => {
  const { pair } = useParams<{ pair: string }>();
  const normalizedPair = (pair || '').toUpperCase();
  const [timeframe, setTimeframe] = useState<string>('1h');
  const [analysis, setAnalysis] = useState<CryptoAnalysis | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [now, setNow] = useState<Date>(new Date());
  const refreshTimer = useRef<number | null>(null);

  useEffect(() => {
    const handle = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(handle);
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!normalizedPair) return;
      setLoading(true);
      setError(null);
      try {
        const result = await bwtsApi.cryptoAnalysis(normalizedPair, timeframe);
        if (signal?.aborted) return;
        setAnalysis(result);
        setUpdatedAt(new Date());
      } catch (err) {
        if (signal?.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [normalizedPair, timeframe],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Soft auto-refresh every 20s — same cadence as the cache TTL on the backend.
  useEffect(() => {
    if (refreshTimer.current) window.clearInterval(refreshTimer.current);
    refreshTimer.current = window.setInterval(() => load(), 20_000);
    return () => {
      if (refreshTimer.current) window.clearInterval(refreshTimer.current);
    };
  }, [load]);

  const direction = analysis?.direction ?? 'NEUTRAL';
  const timingStatus = analysis?.trade_timing?.status ?? 'WAIT';
  const totalScore = analysis?.total_score ?? 0;
  const confluence = analysis?.confluence_score ?? totalScore;
  const stale = useMemo(() => {
    if (!updatedAt) return false;
    return now.getTime() - updatedAt.getTime() > 5 * 60_000;
  }, [updatedAt, now]);

  return (
    <div className="space-y-5 pb-10 text-slate-100">
      <Breadcrumb pair={normalizedPair} />

      <header className="rounded-[24px] border border-violet-400/15 bg-[#090d18] bg-gradient-to-br from-violet-500/10 to-cyan-500/[0.04] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[10px] font-black tracking-[0.22em] text-cyan-300">MARKET ANALYSIS</div>
            <h1 className="mt-2 flex items-center gap-3 text-3xl font-black text-white">
              {direction === 'BUY' ? (
                <TrendingUp className="h-7 w-7 text-emerald-300" />
              ) : direction === 'SELL' ? (
                <TrendingDown className="h-7 w-7 text-rose-300" />
              ) : (
                <Activity className="h-7 w-7 text-cyan-300" />
              )}
              {normalizedPair || '—'}
            </h1>
            <p className={`mt-2 text-sm ${DIRECTION_COLOR[direction]}`}>{DIRECTION_LABEL[direction] || 'No setup'}</p>
          </div>
          <div className="flex flex-col items-end gap-3">
            <div className="flex flex-wrap gap-1.5">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf.key}
                  type="button"
                  onClick={() => setTimeframe(tf.key)}
                  className={`rounded-md border px-3 py-1.5 text-[11px] font-black uppercase tracking-wider transition ${
                    timeframe === tf.key
                      ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-300'
                      : 'border-white/[0.06] bg-white/[0.025] text-slate-400 hover:bg-white/[0.06]'
                  }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>
            <DataAttribution
              provider="Scanner"
              timestamp={updatedAt}
              live={!loading && !stale}
              variant="inline"
              detail={`Score ${formatScoreOver100(confluence)} · Timing ${TIMING_TONE[timingStatus]?.label ?? timingStatus}`}
            />
          </div>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-400/[0.05] p-3 text-xs leading-relaxed text-rose-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
            <span>{error}</span>
          </div>
        )}
      </header>

      {analysis && <MeasurementExplainer analysis={analysis} />}
      {analysis && <ScenariosPanel analysis={analysis} />}
      {analysis && <NewsPanel analysis={analysis} />}
      {analysis && <RiskPanel analysis={analysis} />}
      {normalizedPair && <HistoryTile pair={normalizedPair} timeframe={timeframe} />}

      <p className="text-center text-[11px] text-slate-500">
        Updated {updatedAt ? formatRelative(updatedAt, now) : 'never'}
      </p>
    </div>
  );
};

export default MarketAnalysis;