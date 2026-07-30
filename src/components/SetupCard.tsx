import React from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  CalendarClock,
  Crosshair,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { planReasonText, type CalendarGateStatus, type CryptoAnalysis } from '../services/bwtsApi';

export type SetupCardVariant = 'full' | 'compact' | 'row' | 'highlight';

export interface SetupCardProps {
  pair: string;
  analysis?: CryptoAnalysis | null;
  calendar?: CalendarGateStatus | null;
  sparkline?: number[];
  variant?: SetupCardVariant;
  to?: string;
  rightSlot?: React.ReactNode;
  showSparkline?: boolean;
  index?: number;
  timestamp?: string | number;
  reason?: string;
  className?: string;
}

const CATEGORY_CAPS: Record<string, number> = {
  structure: 20,
  liquidity: 15,
  volume: 10,
  momentum: 10,
  moving_averages: 10,
  fibonacci: 10,
  patterns: 10,
  volatility: 10,
  relative_strength: 5,
};

const PLAN_STYLE: Record<string, string> = {
  STRONG: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  VALID: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-300',
  WATCHLIST: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  WAIT: 'border-slate-400/20 bg-slate-400/10 text-slate-400',
  BLOCKED: 'border-rose-400/30 bg-rose-400/10 text-rose-300',
};

const CALENDAR_STYLE: Record<string, string> = {
  CLEAR: 'bg-cyan-400/10 text-cyan-300 border-cyan-400/20',
  CAUTION: 'bg-amber-400/10 text-amber-300 border-amber-400/20',
  BLOCKED: 'bg-rose-400/10 text-rose-300 border-rose-400/20',
  POST_NEWS: 'bg-violet-400/10 text-violet-300 border-violet-400/20',
  UNAVAILABLE: 'bg-slate-400/10 text-slate-400 border-slate-400/20',
};

const DIRECTION_TEXT: Record<string, string> = {
  BUY: 'text-emerald-300',
  SELL: 'text-rose-300',
  NEUTRAL: 'text-slate-400',
};

const DIRECTION_BG: Record<string, string> = {
  BUY: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20',
  SELL: 'bg-rose-400/10 text-rose-300 border-rose-400/20',
  NEUTRAL: 'bg-slate-400/10 text-slate-400 border-slate-400/20',
};

const calendarColor = (status?: string) =>
  CALENDAR_STYLE[status || ''] || CALENDAR_STYLE.UNAVAILABLE;

const directionIcon = (dir?: string) =>
  dir === 'BUY' ? TrendingUp : dir === 'SELL' ? TrendingDown : Activity;

const formatTime = (value?: string | number) => {
  if (value === undefined || value === null) return '—';
  const date =
    typeof value === 'number'
      ? new Date(value < 10_000_000_000 ? value * 1000 : value)
      : new Date(value);
  return Number.isNaN(date.getTime())
    ? 'recently'
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const Sparkline: React.FC<{ values: number[]; width?: number; height?: number }> = ({
  values,
  width = 120,
  height = 36,
}) => {
  if (!values || values.length < 2) {
    return (
      <div
        className="rounded-md border border-white/[0.06] bg-white/[0.02]"
        style={{ width, height }}
      />
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`)
    .join(' ');
  const last = values[values.length - 1];
  const first = values[0];
  const positive = last >= first;
  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={positive ? '#22d3ee' : '#fb7185'} stopOpacity="0.4" />
          <stop offset="100%" stopColor={positive ? '#22d3ee' : '#fb7185'} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${points} ${width},${height}`} fill="url(#sparkFill)" />
      <polyline
        points={points}
        fill="none"
        stroke={positive ? '#22d3ee' : '#fb7185'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

const SubscoreChip: React.FC<{ name: string; value: number }> = ({ name, value }) => {
  const cap = CATEGORY_CAPS[name] || 10;
  const pct = Math.min(100, (value / cap) * 100);
  const strong = pct >= 70;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${
        strong
          ? 'border-cyan-400/20 bg-cyan-400/10 text-cyan-200'
          : 'border-white/[0.07] bg-white/[0.04] text-slate-400'
      }`}
      title={`${name} ${value}/${cap}`}
    >
      <span className="text-slate-500">{name.replace(/_/g, ' ')}</span>
      <span className="font-black">{value}/{cap}</span>
    </span>
  );
};

const PlanBadge: React.FC<{ status?: string }> = ({ status }) => (
  <span
    className={`rounded-md border px-2 py-1 text-[9px] font-black ${PLAN_STYLE[status || ''] || PLAN_STYLE.WAIT}`}
  >
    {status || 'WAIT'}
  </span>
);

const CalendarBadge: React.FC<{ status?: string; title?: string }> = ({ status, title }) => (
  <span
    className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-black ${calendarColor(status)}`}
    title={title}
  >
    <CalendarClock className="h-3 w-3" />
    {status || 'UNAVAILABLE'}
  </span>
);

const DirectionBadge: React.FC<{ direction?: string; withIcon?: boolean }> = ({
  direction,
  withIcon = true,
}) => {
  const Icon = directionIcon(direction);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-black ${DIRECTION_BG[direction || ''] || DIRECTION_BG.NEUTRAL}`}
    >
      {withIcon && <Icon className="h-3 w-3" />}
      {direction || 'NEUTRAL'}
    </span>
  );
};

const ScoreRing: React.FC<{ score: number; size?: number }> = ({ score, size = 44 }) => {
  const pct = Math.max(0, Math.min(100, score));
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  const color = pct >= 70 ? '#22d3ee' : pct >= 40 ? '#a78bfa' : '#475569';
  return (
    <svg width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="#1e293b" strokeWidth="3" fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dy="0.35em"
        className="fill-slate-100"
        fontSize="11"
        fontWeight="900"
      >
        {pct}
      </text>
    </svg>
  );
};

/**
 * SetupCard — the shared visual primitive used by Dashboard, Live Scanner,
 * Signals, Calendar news, and (eventually) the chart's analysis panel.
 *
 *  Variant "row"      → compact list row for opportunity queues
 *  Variant "compact"  → small chip-row card for cross-surface highlights
 *  Variant "full"     → article card with chips + plan summary + sparkline
 *  Variant "highlight"→ dashboard hero "Top setup now" card
 */
export const SetupCard: React.FC<SetupCardProps> = ({
  pair,
  analysis,
  calendar,
  sparkline,
  variant = 'full',
  to,
  rightSlot,
  showSparkline = true,
  index,
  timestamp,
  reason,
  className = '',
}) => {
  const direction = analysis?.direction || 'NEUTRAL';
  const score = analysis?.total_score ?? 0;
  const planStatus = analysis?.trade_plan?.status || 'WAIT';
  const calendarStatus = calendar?.status || analysis?.economic_calendar?.status;
  const subscores = Object.entries(analysis?.category_breakdown || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, variant === 'full' ? 4 : 3);
  const DirIcon = directionIcon(direction);
  const plan = analysis?.trade_plan;
  const alignPct = analysis?.market_context?.alignment_score;

  // ---- ROW VARIANT (Dashboard opportunity queue list) ----
  if (variant === 'row') {
    return (
      <div
        className={`group grid items-center gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 transition hover:border-cyan-400/20 hover:bg-white/[0.045] sm:grid-cols-[36px_1fr_auto_auto] ${className}`}
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.05] text-xs font-black text-slate-500">
          {index !== undefined ? `0${index + 1}` : <Activity className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-black">{pair}</span>
            <PlanBadge status={planStatus} />
            <CalendarBadge status={calendarStatus} />
          </div>
          <div className="mt-1 truncate text-xs text-slate-500">
            {analysis?.scenarios?.primary || reason || 'Full-spectrum analysis loading'}
          </div>
        </div>
        <div className={`flex items-center gap-1.5 text-xs font-black ${DIRECTION_TEXT[direction]}`}>
          <DirIcon className="h-4 w-4" />
          {direction}
        </div>
        <div className="text-right">
          <div className="text-xl font-black text-white">
            {score}
            <span className="text-xs text-slate-600">/100</span>
          </div>
          <div className="text-[9px] text-slate-600">{formatTime(timestamp)}</div>
        </div>
      </div>
    );
  }

  // ---- HIGHLIGHT VARIANT (Dashboard "Top setup now" hero) ----
  if (variant === 'highlight') {
    return (
      <div
        className={`relative overflow-hidden rounded-[24px] border border-violet-400/15 bg-[#090d18] bg-gradient-to-br from-violet-500/10 to-cyan-500/[0.04] p-6 ${className}`}
      >
        <div className="text-[10px] font-black tracking-[0.2em] text-violet-300">TOP CONFLUENCE</div>
        <div className="mt-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-3xl font-black">{pair}</span>
              <DirectionBadge direction={direction} />
              <PlanBadge status={planStatus} />
            </div>
            <div className="mt-1 text-sm capitalize text-slate-400">
              {analysis?.scenarios?.primary || 'Scenario pending'}
            </div>
          </div>
          <ScoreRing score={score} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <CalendarBadge status={calendarStatus} />
          {alignPct !== undefined && (
            <span className="rounded-md border border-white/[0.07] bg-white/[0.04] px-2 py-1 text-[10px] font-black text-slate-300">
              Align {alignPct}%
            </span>
          )}
          {analysis?.trade_timing?.status && (
            <span
              className={`rounded-md border px-2 py-1 text-[10px] font-black ${
                analysis.trade_timing.status === 'READY'
                  ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                  : analysis.trade_timing.status === 'AVOID'
                  ? 'border-rose-400/20 bg-rose-400/10 text-rose-300'
                  : 'border-amber-400/20 bg-amber-400/10 text-amber-300'
              }`}
            >
              Timing {analysis.trade_timing.status}
            </span>
          )}
        </div>
        {plan?.entry !== null && plan?.entry !== undefined && plan?.stop !== null && plan?.stop !== undefined ? (
          <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs">
            <DataPoint label="ENTRY" value={plan.entry} />
            <DataPoint label="STOP" value={plan.stop} />
            <DataPoint label="TP1" value={plan.targets?.[0]?.price ?? 0} />
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.07] p-3 text-xs leading-relaxed text-amber-200">
            <strong>{planStatus}:</strong>{' '}
            {reason ||
              (plan?.reasons || []).map(planReasonText).find(Boolean) ||
              'V2 has not produced an eligible trade plan.'}
          </div>
        )}
        {rightSlot}
      </div>
    );
  }

  // ---- COMPACT VARIANT (chips only, used in sidebars / news / charts) ----
  if (variant === 'compact') {
    return (
      <div
        className={`flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2 ${className}`}
      >
        <DirectionBadge direction={direction} withIcon={false} />
        <span className="font-black">{pair}</span>
        <PlanBadge status={planStatus} />
        <span className="ml-auto text-xs font-black text-cyan-300">{score}/100</span>
      </div>
    );
  }

  // ---- FULL VARIANT (Live Scanner cards) ----
  return (
    <article
      className={`rounded-[20px] border border-white/[0.08] bg-[#090d18] p-5 transition hover:border-cyan-400/20 ${className}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black text-white">{pair}</h2>
            <PlanBadge status={planStatus} />
            <CalendarBadge status={calendarStatus} />
          </div>
          <div className="mt-1 text-xs capitalize text-slate-500">
            {analysis?.scenarios?.primary || 'Scenario pending'}
          </div>
        </div>
        {showSparkline && sparkline && sparkline.length > 1 ? (
          <Sparkline values={sparkline} />
        ) : (
          <ScoreRing score={score} />
        )}
      </div>
      {subscores.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {subscores.map(([name, value]) => (
            <SubscoreChip key={name} name={name} value={value as number} />
          ))}
        </div>
      )}
      {analysis?.market_context && (
        <div className="mt-3 flex items-center justify-between rounded-lg bg-black/20 px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-slate-500">
          <span>
            Month <b className="text-slate-200">{analysis.market_context.timeframes?.mn1?.trend || 'neutral'}</b>
          </span>
          <span>
            Week <b className="text-slate-200">{analysis.market_context.timeframes?.w1?.trend || 'neutral'}</b>
          </span>
          {alignPct !== undefined && (
            <span>
              Align <b className="text-slate-200">{alignPct}%</b>
            </span>
          )}
        </div>
      )}
      {plan?.eligible ? (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <DataPoint label="ENTRY" value={plan.entry} />
            <DataPoint label="STOP" value={plan.stop} />
            <DataPoint label="TP1" value={plan.targets?.[0]?.price} />
          </div>
          <div className="mt-3 flex justify-between text-[10px] text-slate-500">
            <span>Net movement {Number(plan.net_available_rr ?? plan.available_rr ?? 0).toFixed(2)}R</span>
            <span>Account risk {Number(plan.account_risk_percent ?? 0).toFixed(2)}%</span>
          </div>
        </>
      ) : (
        <div className="mt-4 rounded-xl border border-amber-400/15 bg-amber-400/[0.06] p-3 text-xs leading-relaxed text-amber-200">
          {reason ||
            analysis?.trade_timing?.wait_for?.[0]?.replace(/_/g, ' ') ||
            'Waiting for all required confirmations.'}
        </div>
      )}
      <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-3">
        <span className="text-[10px] text-slate-600">{formatTime(timestamp)}</span>
        {to ? (
          <Link
            to={to}
            className="flex items-center gap-1 text-xs font-black text-cyan-300 hover:text-cyan-200"
          >
            Validate chart <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <span className="flex items-center gap-1 text-xs font-black text-slate-600">
            <Crosshair className="h-3.5 w-3.5" /> No chart link
          </span>
        )}
      </div>
    </article>
  );
};

const DataPoint: React.FC<{ label: string; value: number | null | undefined }> = ({
  label,
  value,
}) => (
  <div className="rounded-lg bg-black/20 p-2">
    <div className="text-[8px] font-black tracking-widest text-slate-600">{label}</div>
    <div className="mt-1 font-mono text-xs text-slate-300">
      {value == null ? 'WAIT' : value.toLocaleString(undefined, { maximumFractionDigits: 5 })}
    </div>
  </div>
);

export default SetupCard;