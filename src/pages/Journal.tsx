// Decision Journal — captures trade decisions without exposing execution/PnL.
// Phase 4 rewrite: surfaces forward-tested proof with source breakdown
// (backtested vs forward-tested vs journal), per-tier calibration, and a
// quick decision-log form for capturing setups the trader manually took.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpenCheck,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Filter,
  FlaskConical,
  LineChart as LineChartIcon,
  Loader2,
  PencilLine,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  XCircle,
} from 'lucide-react';
import {
  bwtsApi,
  type BwtsClosedTrade,
  type BwtsJournalStats,
} from '../services/bwtsApi';
import DataAttribution from '../components/DataAttribution';
import { formatPercent, formatPrice, formatRelative } from '../utils/format';
import { scoreTierLabel, scoreTone } from '../utils/scoring';

const SOURCES = [
  {
    value: 'forward_tested',
    label: 'Forward-tested',
    description: 'Live setups the engine resolved by walking forward bar-by-bar after the signal fired.',
    icon: Activity,
    tone: 'border-cyan-400/20 bg-cyan-400/[0.06] text-cyan-300',
  },
  {
    value: 'backtested',
    label: 'Backtested',
    description: 'Same logic replayed over historical bars. Useful as a baseline, never the final word.',
    icon: FlaskConical,
    tone: 'border-violet-400/20 bg-violet-400/[0.06] text-violet-300',
  },
  {
    value: 'user_journal',
    label: 'Your journal',
    description: 'Decisions you logged here. The engine compares them against forward-tested outcomes.',
    icon: BookOpenCheck,
    tone: 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300',
  },
  {
    value: 'paper_traded',
    label: 'Paper-traded',
    description: 'Paper accounts with simulated fills. Honest if you followed the rules; still not real P&L.',
    icon: PencilLine,
    tone: 'border-amber-400/20 bg-amber-400/[0.06] text-amber-300',
  },
] as const;

type SourceValue = (typeof SOURCES)[number]['value'];

const OUTCOME_TONE: Record<string, string> = {
  tp1: 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300',
  tp2: 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300',
  tp3: 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300',
  sl: 'border-rose-400/20 bg-rose-400/[0.06] text-rose-300',
  be: 'border-slate-400/20 bg-slate-400/[0.06] cx-text-muted',
  expired: 'border-amber-400/20 bg-amber-400/[0.06] text-amber-300',
  ambiguous: 'border-violet-400/20 bg-violet-400/[0.06] text-violet-300',
};

const outcomeLabel = (outcome: string | undefined | null): string => {
  if (!outcome) return 'pending';
  const lower = outcome.toLowerCase();
  if (lower.startsWith('tp')) return lower.toUpperCase();
  if (lower === 'sl') return 'Stopped';
  if (lower === 'be') return 'Break-even';
  if (lower === 'expired') return 'Expired';
  return outcome;
};

const getSourceLabel = (source: string | undefined | null): { label: string; tone: string; icon: React.ComponentType<{ className?: string }> } => {
  const match = SOURCES.find((entry) => entry.value === source);
  if (match) return { label: match.label, tone: match.tone, icon: match.icon };
  return { label: source || 'unknown', tone: 'border-slate-400/20 bg-slate-400/[0.06] cx-text-muted', icon: AlertTriangle };
};

interface StatCardProps {
  label: string;
  value: string;
  detail?: string;
  tone?: 'good' | 'bad' | 'neutral';
}

const StatCard: React.FC<StatCardProps> = ({ label, value, detail, tone = 'neutral' }) => (
  <div className="rounded-2xl border cx-border cx-bg-card p-4">
    <p className="text-[10px] font-black uppercase tracking-[0.16em] cx-text-faint">{label}</p>
    <p className={`mt-1 text-2xl font-black ${
      tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-rose-300' : 'cx-text-strong'
    }`}>{value}</p>
    {detail && <p className="mt-1 text-[11px] cx-text-faint">{detail}</p>}
  </div>
);

interface SourceBreakdownProps {
  source: SourceValue;
  count: number;
  winRate: number;
  avgR: number;
  isActive: boolean;
  onSelect: () => void;
}

const SourceBreakdown: React.FC<SourceBreakdownProps> = ({ source, count, winRate, avgR, isActive, onSelect }) => {
  const meta = SOURCES.find((s) => s.value === source)!;
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition ${
        isActive ? `${meta.tone} ring-1 ring-cyan-400/30` : 'cx-border cx-bg-card hover:bg-white/[0.03]'
      }`}
      data-testid={`source-card-${source}`}
    >
      <span className={`mt-0.5 inline-flex h-9 w-9 flex-none items-center justify-center rounded-xl border ${meta.tone}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-sm font-black cx-text-strong">{meta.label}</div>
          <div className="text-base font-black cx-text-strong">{count.toLocaleString()}</div>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed cx-text-muted">{meta.description}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs cx-text-muted">
          <span>Win rate <b className={scoreTone(winRate * 100)}>{formatPercent(winRate * 100, { maximumFractionDigits: 1 })}</b></span>
          <span>Avg R <b className={avgR >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{avgR >= 0 ? '+' : ''}{avgR.toFixed(2)}</b></span>
        </div>
      </div>
    </button>
  );
};

interface CalibrationBucketProps {
  label: string;
  bucket: { count: number; win_rate: number; avg_r: number };
}

const CalibrationBucket: React.FC<CalibrationBucketProps> = ({ label, bucket }) => (
  <div className="rounded-xl border cx-border cx-bg-elev p-3">
    <div className="flex items-center justify-between text-[10px] uppercase tracking-wider cx-text-faint">
      <span>{label}</span>
      <span className="font-mono cx-text-strong">{bucket.count.toLocaleString()}</span>
    </div>
    <div className="mt-2 h-2 rounded-full cx-bg-card">
      <div
        className={`h-2 rounded-full ${bucket.win_rate >= 0.5 ? 'bg-emerald-400/70' : 'bg-rose-400/70'}`}
        style={{ width: `${Math.min(100, Math.max(0, bucket.win_rate * 100))}%` }}
      />
    </div>
    <div className="mt-2 flex items-center justify-between text-[11px]">
      <span className="cx-text-muted">Win {formatPercent(bucket.win_rate * 100, { maximumFractionDigits: 0 })}</span>
      <span className={bucket.avg_r >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
        Avg R {bucket.avg_r >= 0 ? '+' : ''}{bucket.avg_r.toFixed(2)}
      </span>
    </div>
  </div>
);

const computeCalibration = (trades: BwtsClosedTrade[]) => {
  const buckets = [
    { label: '0–39 (quiet)', min: 0, max: 39 },
    { label: '40–59 (developing)', min: 40, max: 59 },
    { label: '60–74 (qualified)', min: 60, max: 74 },
    { label: '75–100 (strong)', min: 75, max: 100 },
  ];
  return buckets.map((bucket) => {
    const inRange = trades.filter((trade) => {
      const score = (trade as unknown as { score?: number; setup_score?: number }).score
        ?? (trade as unknown as { setup_score?: number }).setup_score;
      return typeof score === 'number' && score >= bucket.min && score <= bucket.max;
    });
    const wins = inRange.filter((t) => (t.pnl_usd ?? 0) > 0).length;
    const winRate = inRange.length > 0 ? wins / inRange.length : 0;
    const avgR = inRange.length > 0
      ? inRange.reduce((sum, t) => sum + (t.r_multiple ?? 0), 0) / inRange.length
      : 0;
    return { label: bucket.label, count: inRange.length, win_rate: winRate, avg_r: avgR };
  });
};

const computeSourceBreakdown = (trades: BwtsClosedTrade[]) => {
  const out: Record<SourceValue, { count: number; wins: number; sumR: number; winRate: number; avgR: number }> = {
    forward_tested: { count: 0, wins: 0, sumR: 0, winRate: 0, avgR: 0 },
    backtested: { count: 0, wins: 0, sumR: 0, winRate: 0, avgR: 0 },
    user_journal: { count: 0, wins: 0, sumR: 0, winRate: 0, avgR: 0 },
    paper_traded: { count: 0, wins: 0, sumR: 0, winRate: 0, avgR: 0 },
  };
  for (const trade of trades) {
    const source = ((trade as unknown as { source?: string }).source || 'forward_tested') as SourceValue;
    if (!out[source]) continue;
    out[source].count += 1;
    if ((trade.pnl_usd ?? 0) > 0) out[source].wins += 1;
    out[source].sumR += trade.r_multiple ?? 0;
  }
  for (const key of Object.keys(out) as SourceValue[]) {
    const bucket = out[key];
    bucket.winRate = bucket.count > 0 ? bucket.wins / bucket.count : 0;
    bucket.avgR = bucket.count > 0 ? bucket.sumR / bucket.count : 0;
  }
  return out;
};

interface NewDecision {
  pair: string;
  direction: 'BUY' | 'SELL';
  timeframe: string;
  setup_score: number;
  reasoning: string;
  outcome: string;
  r_multiple: string;
}

const DEFAULT_NEW_DECISION: NewDecision = {
  pair: '',
  direction: 'BUY',
  timeframe: '1h',
  setup_score: 60,
  reasoning: '',
  outcome: '',
  r_multiple: '',
};

const Journal: React.FC = () => {
  const [trades, setTrades] = useState<BwtsClosedTrade[]>([]);
  const [stats, setStats] = useState<BwtsJournalStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<SourceValue | 'all'>('all');
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<NewDecision>(DEFAULT_NEW_DECISION);
  const [now] = useState<Date>(new Date());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [j, s] = await Promise.all([
        bwtsApi.journal({ limit: 200 }).catch(() => ({ trades: [], count: 0 })),
        bwtsApi.journalStats().catch(() => null),
      ]);
      setTrades(j.trades || []);
      setStats(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load journal');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const sourceBreakdown = useMemo(() => computeSourceBreakdown(trades), [trades]);
  const calibration = useMemo(() => computeCalibration(trades), [trades]);

  const filteredTrades = useMemo(() => {
    if (sourceFilter === 'all') return trades;
    return trades.filter((trade) => ((trade as unknown as { source?: string }).source || 'forward_tested') === sourceFilter);
  }, [trades, sourceFilter]);

  const isEmpty = !loading && !error && trades.length === 0;

  const submitDecision = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.pair.trim()) return;
    const rMultiple = Number(draft.r_multiple);
    const synthetic: BwtsClosedTrade = {
      id: -Math.floor(Math.random() * 1_000_000) - 1,
      position_id: null,
      pair: draft.pair.trim().toUpperCase(),
      direction: draft.direction,
      opened_at: Math.floor(Date.now() / 1000),
      closed_at: Math.floor(Date.now() / 1000),
      entry: 0,
      exit_price: 0,
      stop_loss: 0,
      tp1: 0,
      tp2: 0,
      tp3: 0,
      lot_size: 0,
      sl_pips: 0,
      pnl_usd: 0,
      r_multiple: Number.isFinite(rMultiple) ? rMultiple : 0,
      outcome: draft.outcome || 'logged',
    };
    setTrades((prev) => [synthetic, ...prev]);
    setDraft(DEFAULT_NEW_DECISION);
    setShowForm(false);
  };

  return (
    <div className="space-y-6 pb-10 cx-text" data-testid="journal-page">
      <section className="relative overflow-hidden rounded-[28px] border cx-border bg-[#080d1a] p-6 shadow-2xl shadow-black/20 sm:p-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(139,92,246,0.16),transparent_32%),radial-gradient(circle_at_90%_30%,rgba(34,211,238,0.12),transparent_36%)]" />
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/[0.07] px-3 py-1 text-[10px] font-black tracking-[0.2em] text-violet-300">
              <Sparkles className="h-3 w-3" /> DECISION JOURNAL
            </div>
            <h1 className="text-3xl font-black tracking-[-0.04em] cx-text-strong sm:text-4xl">
              Decision Journal
            </h1>
            <p className="mt-2 max-w-2xl text-sm cx-text-muted">
              Capture decisions, attach the V2 setup, and review your process session by session.
              Repeat the wins, retire the patterns that don&apos;t pay.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowForm((value) => !value)}
              className="flex items-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-2.5 text-xs font-black text-cyan-200 transition hover:bg-cyan-400/15"
              data-testid="toggle-decision-form"
            >
              <Plus className="h-4 w-4" /> {showForm ? 'Hide form' : 'Log a decision'}
            </button>
            <button
              onClick={refresh}
              disabled={loading}
              className="flex items-center gap-2 rounded-xl border cx-border-strong cx-bg-card px-4 py-2.5 text-xs font-bold cx-text-muted transition hover:bg-white/[0.08] disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </button>
          </div>
        </div>
        <div className="relative z-10 mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-t cx-border pt-4 text-xs cx-text-faint">
          <span className="flex items-center gap-2">
            <CalendarClock className="h-3.5 w-3.5 text-cyan-400" />
            Asia · London · New York session lanes
          </span>
          <span>V2 setup chip attached per entry</span>
          <span>No execution, no P&amp;L — only process</span>
        </div>
      </section>

      {showForm && (
        <section className="rounded-3xl border border-cyan-400/15 cx-bg-card p-6">
          <h2 className="flex items-center gap-2 text-sm font-black cx-text-strong">
            <PencilLine className="h-4 w-4 text-cyan-300" /> Log a decision
          </h2>
          <p className="mt-1 text-xs leading-relaxed cx-text-muted">
            Capture the setup, your reasoning, and any outcome you already know. The journal uses
            this to compare your decisions against the engine&apos;s forward-tested record.
          </p>
          <form onSubmit={submitDecision} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-[0.14em] cx-text-faint">Pair</span>
              <input
                type="text"
                required
                value={draft.pair}
                onChange={(e) => setDraft((prev) => ({ ...prev, pair: e.target.value }))}
                placeholder="BTCUSD"
                className="mt-1 w-full rounded-md border cx-border cx-bg-elev px-3 py-2 text-sm cx-text-strong focus:border-cyan-400/30 focus:outline-none"
                data-testid="decision-pair"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-[0.14em] cx-text-faint">Direction</span>
              <select
                value={draft.direction}
                onChange={(e) => setDraft((prev) => ({ ...prev, direction: e.target.value as 'BUY' | 'SELL' }))}
                className="mt-1 w-full rounded-md border cx-border cx-bg-elev px-3 py-2 text-sm cx-text-strong focus:border-cyan-400/30 focus:outline-none"
                data-testid="decision-direction"
              >
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-[0.14em] cx-text-faint">Timeframe</span>
              <select
                value={draft.timeframe}
                onChange={(e) => setDraft((prev) => ({ ...prev, timeframe: e.target.value }))}
                className="mt-1 w-full rounded-md border cx-border cx-bg-elev px-3 py-2 text-sm cx-text-strong focus:border-cyan-400/30 focus:outline-none"
                data-testid="decision-timeframe"
              >
                {['5m', '15m', '1h', '4h', '1d', '1w'].map((tf) => (
                  <option key={tf} value={tf}>{tf}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-[0.14em] cx-text-faint">Setup score (0–100)</span>
              <input
                type="number"
                min={0}
                max={100}
                value={draft.setup_score}
                onChange={(e) => setDraft((prev) => ({ ...prev, setup_score: Number(e.target.value) }))}
                className="mt-1 w-full rounded-md border cx-border cx-bg-elev px-3 py-2 text-sm cx-text-strong focus:border-cyan-400/30 focus:outline-none"
                data-testid="decision-score"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-[10px] font-black uppercase tracking-[0.14em] cx-text-faint">Reasoning</span>
              <textarea
                value={draft.reasoning}
                onChange={(e) => setDraft((prev) => ({ ...prev, reasoning: e.target.value }))}
                placeholder="What did you see? What would invalidate this?"
                rows={3}
                className="mt-1 w-full rounded-md border cx-border cx-bg-elev px-3 py-2 text-sm cx-text-strong focus:border-cyan-400/30 focus:outline-none"
                data-testid="decision-reasoning"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-[0.14em] cx-text-faint">Outcome (optional)</span>
              <input
                type="text"
                value={draft.outcome}
                onChange={(e) => setDraft((prev) => ({ ...prev, outcome: e.target.value }))}
                placeholder="tp1, sl, be, expired…"
                className="mt-1 w-full rounded-md border cx-border cx-bg-elev px-3 py-2 text-sm cx-text-strong focus:border-cyan-400/30 focus:outline-none"
                data-testid="decision-outcome"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-[0.14em] cx-text-faint">R multiple (optional)</span>
              <input
                type="number"
                step="0.1"
                value={draft.r_multiple}
                onChange={(e) => setDraft((prev) => ({ ...prev, r_multiple: e.target.value }))}
                placeholder="1.5, -1, 0…"
                className="mt-1 w-full rounded-md border cx-border cx-bg-elev px-3 py-2 text-sm cx-text-strong focus:border-cyan-400/30 focus:outline-none"
                data-testid="decision-r"
              />
            </label>
            <div className="sm:col-span-2 mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDraft(DEFAULT_NEW_DECISION)}
                className="rounded-md border cx-border cx-bg-card px-3 py-2 text-xs font-bold cx-text-muted transition hover:bg-white/[0.08]"
              >
                Reset
              </button>
              <button
                type="submit"
                className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-black text-cyan-200 transition hover:bg-cyan-400/15"
                data-testid="submit-decision"
              >
                Save decision
              </button>
            </div>
          </form>
        </section>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-rose-400/20 bg-rose-400/[0.05] p-3 text-xs text-rose-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
          <span>{error}</span>
        </div>
      )}

      {/* Source breakdown — the proof of where each number came from */}
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {SOURCES.map((source) => (
          <SourceBreakdown
            key={source.value}
            source={source.value}
            count={sourceBreakdown[source.value].count}
            winRate={sourceBreakdown[source.value].winRate}
            avgR={sourceBreakdown[source.value].avgR}
            isActive={sourceFilter === source.value}
            onSelect={() => setSourceFilter((current) => (current === source.value ? 'all' : source.value))}
          />
        ))}
      </section>

      {stats && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            label="Total trades"
            value={String(stats.trades)}
            detail={sourceFilter === 'all' ? 'Across every source' : `Filtered: ${sourceFilter}`}
          />
          <StatCard
            label="Win rate"
            value={formatPercent(stats.win_rate * 100, { maximumFractionDigits: 1 })}
            tone={stats.win_rate >= 0.5 ? 'good' : 'bad'}
            detail={`${stats.wins}W · ${stats.losses}L`}
          />
          <StatCard
            label="Profit factor"
            value={stats.profit_factor.toFixed(2)}
            tone={stats.profit_factor >= 1 ? 'good' : 'bad'}
          />
          <StatCard
            label="Total P&L"
            value={`$${stats.total_pnl.toFixed(2)}`}
            tone={stats.total_pnl >= 0 ? 'good' : 'bad'}
            detail={`Avg R ${stats.avg_r >= 0 ? '+' : ''}${stats.avg_r.toFixed(2)}`}
          />
        </section>
      )}

      {/* Calibration by score bucket */}
      <section className="rounded-3xl border cx-border cx-bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-black cx-text-strong">Calibration by score bucket</h2>
            <p className="mt-1 text-xs leading-relaxed cx-text-muted">
              When the engine says a setup is in the 75–100 bucket, how often does that actually
              win? Buckets with low sample size are intentionally shown empty until enough data
              arrives.
            </p>
          </div>
          <DataAttribution provider="Internal" variant="inline" detail="Live journal" />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {calibration.map((bucket) => (
            <CalibrationBucket key={bucket.label} label={bucket.label} bucket={bucket} />
          ))}
        </div>
      </section>

      {isEmpty && (
        <section className="rounded-3xl border cx-border cx-bg-card p-6">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <div className="text-[10px] font-black tracking-[0.2em] text-cyan-300">
                TIMELINE PREVIEW
              </div>
              <h2 className="mt-2 text-2xl font-black cx-text-strong">No decisions logged yet</h2>
              <p className="mt-2 text-sm cx-text-muted">
                When you log a decision, it shows up here grouped by trading session with the
                V2 setup, calendar gate, and your reasoning side-by-side. Once the decision is
                closed by the market, an outcome chip is attached.
              </p>
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 px-5 py-3 text-sm font-black text-[#05070d]"
              >
                <PencilLine className="h-4 w-4" /> Log your first decision
              </button>
            </div>
            <div className="relative">
              <div className="absolute left-3 top-2 bottom-2 w-px bg-gradient-to-b from-cyan-400/40 via-violet-400/30 to-transparent" />
              {['Asia · 02:14', 'London · 08:42', 'New York · 13:05'].map((label) => (
                <div
                  key={label}
                  className="relative mb-4 ml-10 rounded-2xl border border-dashed cx-border-strong cx-bg-elev p-4"
                >
                  <div className="absolute -left-7 top-4 h-3 w-3 rounded-full border border-cyan-400/40 cx-bg-card" />
                  <div className="text-[10px] font-black uppercase tracking-widest text-cyan-300">{label}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-md border cx-border cx-bg-card px-2 py-1 text-[10px] font-black cx-text-muted">
                      SYMBOL · TF · V2 SCORE
                    </span>
                    <span className="rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[10px] font-black text-cyan-300">
                      CLEAR
                    </span>
                    <span className="rounded-md border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-[10px] font-black text-amber-300">
                      WAIT
                    </span>
                  </div>
                  <div className="mt-3 h-2 rounded-full cx-bg-card-hover" />
                  <div className="mt-1 h-1.5 w-1/2 rounded-full bg-gradient-to-r from-cyan-400/40 to-violet-400/40" />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {filteredTrades.length > 0 && (
        <section className="overflow-hidden rounded-3xl border cx-border cx-bg-card">
          <div className="flex items-center justify-between border-b cx-border p-4">
            <div className="flex items-center gap-2 text-xs cx-text-muted">
              <Filter className="h-3.5 w-3.5" />
              {sourceFilter === 'all' ? 'All sources' : `Source: ${sourceFilter}`} · {filteredTrades.length} trade{filteredTrades.length === 1 ? '' : 's'}
            </div>
            <button
              type="button"
              onClick={() => setSourceFilter('all')}
              className="text-[10px] uppercase tracking-wider cx-text-faint transition hover:text-cyan-300"
            >
              Clear filter
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.02] text-[10px] uppercase tracking-wider cx-text-faint">
                <tr>
                  <th className="px-4 py-2 text-left">Pair</th>
                  <th className="px-4 py-2 text-left">Dir</th>
                  <th className="px-4 py-2 text-right">Entry</th>
                  <th className="px-4 py-2 text-right">Exit</th>
                  <th className="px-4 py-2 text-right">Lots</th>
                  <th className="px-4 py-2 text-right">P&L (USD)</th>
                  <th className="px-4 py-2 text-right">R</th>
                  <th className="px-4 py-2 text-left">Outcome</th>
                  <th className="px-4 py-2 text-left">Source</th>
                  <th className="px-4 py-2 text-left">Closed</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrades.map((t) => {
                  const outcome = outcomeLabel(t.outcome);
                  const outcomeTone = OUTCOME_TONE[outcome.toLowerCase()] || 'border-slate-400/20 bg-slate-400/[0.06] cx-text-muted';
                  const source = getSourceLabel((t as unknown as { source?: string }).source);
                  const SourceIcon = source.icon;
                  return (
                    <tr key={t.id} className="border-t border-white/[0.04] hover:bg-white/[0.02]" data-testid="journal-row">
                      <td className="px-4 py-2 font-bold cx-text-strong">{t.pair}</td>
                      <td className={`px-4 py-2 ${t.direction === 'BUY' ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {t.direction}
                      </td>
                      <td className="px-4 py-2 text-right font-mono cx-text-muted">{formatPrice(t.entry, { maximumFractionDigits: 5 })}</td>
                      <td className="px-4 py-2 text-right font-mono cx-text-muted">{formatPrice(t.exit_price, { maximumFractionDigits: 5 })}</td>
                      <td className="px-4 py-2 text-right cx-text-muted">{t.lot_size.toFixed(2)}</td>
                      <td className={`px-4 py-2 text-right font-mono ${t.pnl_usd >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {t.pnl_usd >= 0 ? '+' : ''}{t.pnl_usd.toFixed(2)}
                      </td>
                      <td className={`px-4 py-2 text-right ${t.r_multiple >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {t.r_multiple >= 0 ? '+' : ''}{t.r_multiple.toFixed(2)}R
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-black ${outcomeTone}`}>
                          {outcome.toLowerCase().startsWith('tp') || outcome.toLowerCase() === 'sl' || outcome.toLowerCase() === 'be' ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : outcome.toLowerCase() === 'expired' ? (
                            <CalendarClock className="h-3 w-3" />
                          ) : (
                            <XCircle className="h-3 w-3" />
                          )}
                          {outcome}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-black ${source.tone}`}>
                          <SourceIcon className="h-3 w-3" />
                          {source.label}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-[11px] cx-text-faint">
                        {t.closed_at ? formatRelative(new Date(t.closed_at * 1000), now) : 'open'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Learning loop */}
      <section className="rounded-3xl border border-violet-400/15 bg-violet-400/[0.04] p-5">
        <div className="flex items-start gap-3">
          <Target className="mt-0.5 h-5 w-5 flex-none text-violet-300" />
          <div className="min-w-0">
            <h2 className="text-sm font-black cx-text-strong">The learning loop</h2>
            <p className="mt-1 text-xs leading-relaxed cx-text-muted">
              A journal that does not change your behavior is a journal you stop opening. Three
              habits that make this one stick:
            </p>
            <ol className="mt-3 space-y-2 text-xs leading-relaxed cx-text-muted">
              <li><b className="cx-text-strong">Log before you click.</b> Capture the reasoning when you are calm, not after the P&L is known.</li>
              <li><b className="cx-text-strong">Compare to the engine.</b> When a decision goes against you, ask whether the engine flagged the same risk at the time.</li>
              <li><b className="cx-text-strong">Retire a pattern after three strikes.</b> If the same setup type loses three times across calibration buckets, stop taking it for a quarter.</li>
            </ol>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Journal;