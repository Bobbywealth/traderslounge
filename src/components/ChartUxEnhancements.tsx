import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Clock, Calendar } from 'lucide-react';

type V2Lifecycle = 'READY' | 'CONFIRMED' | 'FORMING' | 'INVALIDATED' | 'WAIT' | string;

type MtfTrend = 'bullish' | 'bearish' | 'neutral' | string | undefined;

interface V2ScoreBadgeProps {
  score: number;
  direction?: 'BUY' | 'SELL' | 'NEUTRAL' | string;
  lifecycle?: V2Lifecycle;
  timingStatus?: 'READY' | 'WAIT' | 'AVOID' | string;
  calendarStatus?: string;
  size?: 'sm' | 'md' | 'lg';
}

const isCalendarBlocking = (status?: string): boolean => {
  const v = String(status || '').toUpperCase();
  return ['BLOCKED', 'POST_NEWS', 'UNAVAILABLE'].includes(v);
};

/**
 * V2ScoreBadge
 * A prominent, color-coded badge that surfaces the V2 conviction score at a glance.
 * Visual states: RED (< 40), YELLOW (40–59), GREEN (60+) with optional overload
 * indicators when calendar or timing gates block the trade.
 */
export const V2ScoreBadge: React.FC<V2ScoreBadgeProps> = ({
  score,
  direction = 'NEUTRAL',
  lifecycle,
  timingStatus,
  calendarStatus,
  size = 'md',
}) => {
  const numericScore = Number(score || 0);
  const directionUpper = String(direction || 'NEUTRAL').toUpperCase();
  const timingUpper = String(timingStatus || '').toUpperCase();
  const calendarBlocking = isCalendarBlocking(calendarStatus);

  // Color tier based on conviction
  let tierClasses: string;
  let tierLabel: string;
  if (numericScore < 40) {
    tierClasses = 'border-rose-400/40 bg-rose-500/15 text-rose-300 shadow-[0_0_18px_-6px_rgba(244,63,94,0.45)]';
    tierLabel = 'NO TRADE';
  } else if (numericScore < 60) {
    tierClasses = 'border-amber-400/40 bg-amber-500/15 text-amber-300 shadow-[0_0_18px_-6px_rgba(251,191,36,0.45)]';
    tierLabel = 'WATCH';
  } else {
    tierClasses = 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300 shadow-[0_0_18px_-6px_rgba(16,185,129,0.45)]';
    tierLabel = 'TRADE READY';
  }

  // Down-rank if calendar or timing blocks it: TRADE READY -> WATCH, WATCH -> NO TRADE
  let effectiveLabel = tierLabel;
  let effectiveClasses = tierClasses;
  if (calendarBlocking || timingUpper === 'AVOID') {
    effectiveLabel = 'BLOCKED';
    effectiveClasses = 'border-rose-400/40 bg-rose-500/15 text-rose-300 shadow-[0_0_18px_-6px_rgba(244,63,94,0.45)]';
  } else if (timingUpper === 'WAIT' && tierLabel === 'TRADE READY') {
    effectiveLabel = 'WATCH';
    effectiveClasses = 'border-amber-400/40 bg-amber-500/15 text-amber-300 shadow-[0_0_18px_-6px_rgba(251,191,36,0.45)]';
  }

  // Size-based typography
  const sizeClasses =
    size === 'lg'
      ? 'px-3 py-2 text-sm'
      : size === 'sm'
      ? 'px-2 py-1 text-[10px]'
      : 'px-2.5 py-1.5 text-xs';

  const Icon =
    effectiveLabel === 'TRADE READY'
      ? CheckCircle2
      : effectiveLabel === 'BLOCKED'
      ? XCircle
      : effectiveLabel === 'WATCH'
      ? Clock
      : AlertTriangle;

  return (
    <div className={`inline-flex items-center gap-2 rounded-lg border font-black uppercase tracking-wider ${sizeClasses} ${effectiveClasses}`}>
      <Icon className={size === 'lg' ? 'h-4 w-4' : 'h-3 w-3'} />
      <span className="font-mono normal-case">{numericScore}</span>
      <span className="opacity-60">/100</span>
      <span className="mx-1 opacity-30">|</span>
      <span>{effectiveLabel}</span>
      {directionUpper !== 'NEUTRAL' && (
        <span className={`ml-1 rounded px-1.5 py-0.5 text-[9px] font-black ${
          directionUpper === 'BUY' ? 'bg-emerald-400/20 text-emerald-200' : 'bg-rose-400/20 text-rose-200'
        }`}>
          {directionUpper}
        </span>
      )}
      {lifecycle && lifecycle !== 'READY' && lifecycle !== 'CONFIRMED' && (
        <span className="opacity-60 normal-case tracking-normal">{lifecycle}</span>
      )}
    </div>
  );
};

interface MtfBarProps {
  timeframes: {
    month?: MtfTrend;
    week?: MtfTrend;
    day?: MtfTrend;
    selected?: MtfTrend;
  };
  alignmentScore?: number;
  selectedLabel?: string;
  onTimeframeChange?: (tf: string) => void;
}

const TREND_COLOR: Record<string, string> = {
  bullish: 'bg-emerald-400 shadow-[0_0_10px_-2px_rgba(16,185,129,0.7)]',
  bearish: 'bg-rose-400 shadow-[0_0_10px_-2px_rgba(244,63,94,0.7)]',
  neutral: 'bg-slate-500',
};

const TREND_TEXT: Record<string, string> = {
  bullish: 'text-emerald-300',
  bearish: 'text-rose-300',
  neutral: 'cx-text-muted',
};

const TrendDot: React.FC<{ trend?: MtfTrend; label: string; onClick?: () => void }> = ({ trend, label, onClick }) => {
  const t = String(trend || 'neutral').toLowerCase();
  const dot = TREND_COLOR[t] || TREND_COLOR.neutral;
  return (
    <div 
      className={`flex flex-col items-center gap-1 ${onClick ? 'cursor-pointer hover:scale-110 transition-transform' : ''}`}
      title={`${label}: ${t}${onClick ? ' (Click to switch timeframe)' : ''}`}
      onClick={onClick}
    >
      <div className={`h-2.5 w-2.5 rounded-full ${dot}`} />
      <span className={`text-[9px] font-black uppercase tracking-wider ${TREND_TEXT[t] || TREND_TEXT.neutral}`}>
        {label}
      </span>
    </div>
  );
};

/**
 * MtfBar
 * A persistent multi-timeframe trend summary that surfaces Month/Week/Day/Selected
 * alignment at a glance. The user no longer has to open the Details panel to see
 * whether the higher timeframes support the current setup.
 */
export const MtfBar: React.FC<MtfBarProps> = ({ timeframes, alignmentScore, selectedLabel, onTimeframeChange }) => {
  const alignment = Number(alignmentScore || 0);
  const alignmentColor =
    alignment >= 75 ? 'text-emerald-300' : alignment >= 40 ? 'text-amber-300' : 'text-rose-300';

  return (
    <div className="flex items-center gap-4 rounded-lg border cx-border cx-bg-card px-3 py-2">
      <span className="text-[9px] font-black uppercase tracking-widest text-cyan-300">MTF</span>
      <div className="flex items-center gap-3">
        <TrendDot trend={timeframes.month} label="MN" onClick={onTimeframeChange ? () => onTimeframeChange('1M') : undefined} />
        <TrendDot trend={timeframes.week} label="W1" onClick={onTimeframeChange ? () => onTimeframeChange('1W') : undefined} />
        <TrendDot trend={timeframes.day} label="D1" onClick={onTimeframeChange ? () => onTimeframeChange('1D') : undefined} />
        <TrendDot trend={timeframes.selected} label={selectedLabel || 'TF'} />
      </div>
      {alignmentScore != null && (
        <div className="ml-2 flex items-center gap-1.5 border-l cx-border pl-3">
          <span className="text-[9px] font-black uppercase tracking-wider cx-text-faint">ALIGN</span>
          <span className={`font-mono text-xs font-black ${alignmentColor}`}>{alignment}%</span>
        </div>
      )}
    </div>
  );
};

interface QuickSymbolPillsProps {
  symbols: { symbol: string; type?: string }[];
  activeSymbol: string;
  onSelect: (symbol: string) => void;
}

/**
 * QuickSymbolPills
 * Lets users cycle through the most popular crypto pairs with a single click.
 * Anchored below the search bar so passive scrolling doesn't bury it.
 */
export const QuickSymbolPills: React.FC<QuickSymbolPillsProps> = ({ symbols, activeSymbol, onSelect }) => {
  const visible = symbols.slice(0, 6);
  return (
    <div className="flex items-center gap-0.5">
      {visible.map((s) => {
        const isActive = s.symbol === activeSymbol;
        return (
          <button
            key={s.symbol}
            onClick={() => onSelect(s.symbol)}
            className={`rounded px-1.5 py-0.5 text-[9px] font-black tracking-wide transition ${
              isActive
                ? 'bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/30'
                : 'cx-bg-card cx-text-muted hover:bg-white/[0.08] hover:cx-text'
            }`}
          >
            {(() => {
              const sym = s.symbol;
              if (sym.startsWith("USD") && sym.length > 3) return `USD/${sym.slice(3)}`;
              if (sym.endsWith("USD")) return `${sym.slice(0, -3)}/USD`;
              return sym;
            })()}
          </button>
        );
      })}
    </div>
  );
};

interface TradeLevelsProps {
  direction: 'BUY' | 'SELL' | 'NEUTRAL';
  entry: number | null | undefined;
  stop: number | null | undefined;
  targets: Array<{ label: string; price: number }>;
  currentPrice?: number;
  formatPrice: (value: number) => string;
}

/**
 * TradeLevels
 * Concrete entry / stop / targets with R:R ratio when the deterministic setup
 * is actionable. This is what converts the V2 score from "interesting" to
 * "tradeable" — the user sees the exact price levels they would engage.
 */
export const TradeLevels: React.FC<TradeLevelsProps> = ({ direction, entry, stop, targets, currentPrice, formatPrice }) => {
  if (direction === 'NEUTRAL' || entry == null || stop == null) {
    return null;
  }

  const risk = Math.abs(Number(entry) - Number(stop));
  const rrRatios = targets.map((target) => {
    const reward = Math.abs(Number(target.price) - Number(entry));
    return risk > 0 ? reward / risk : 0;
  });

  const isLong = direction === 'BUY';
  const dirColor = isLong ? 'text-emerald-300' : 'text-rose-300';
  const dirBg = isLong ? 'bg-emerald-400/10' : 'bg-rose-400/10';
  const dirBorder = isLong ? 'border-emerald-400/30' : 'border-rose-400/30';

  return (
    <div className={`rounded-lg border ${dirBorder} ${dirBg} px-3 py-2`}>
      <div className="mb-2 flex items-center justify-between">
        <span className={`text-[10px] font-black uppercase tracking-widest ${dirColor}`}>
          {direction} SETUP
        </span>
        <span className="text-[9px] font-black uppercase tracking-wider cx-text-faint">R:R</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-[9px] font-black uppercase tracking-wider cx-text-faint">Entry</div>
          <div className={`font-mono font-bold ${dirColor}`}>{formatPrice(Number(entry))}</div>
        </div>
        <div>
          <div className="text-[9px] font-black uppercase tracking-wider text-rose-400">Stop</div>
          <div className="font-mono font-bold text-rose-300">{formatPrice(Number(stop))}</div>
        </div>
        <div>
          <div className="text-[9px] font-black uppercase tracking-wider text-cyan-400">Risk</div>
          <div className="font-mono font-bold cx-text-muted">{formatPrice(risk)}</div>
        </div>
      </div>
      {targets.length > 0 && (
        <div className="mt-2 space-y-1 border-t cx-border pt-2">
          {targets.map((target, i) => (
            <div key={target.label} className="flex items-center justify-between text-xs">
              <span className="cx-text-muted">{target.label}</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-cyan-300">{formatPrice(Number(target.price))}</span>
                <span className={`rounded px-1 py-0.5 text-[9px] font-black ${
                  rrRatios[i] >= 2 ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-400/15 text-amber-300'
                }`}>
                  {rrRatios[i].toFixed(2)}R
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      {currentPrice != null && (
        <div className="mt-2 border-t cx-border pt-1.5 text-[10px] cx-text-faint">
          Current: <span className="font-mono cx-text-muted">{formatPrice(currentPrice)}</span>
          <span className="ml-2">
            ({((Number(currentPrice) - Number(entry)) / Number(entry) * 100).toFixed(2)}% from entry)
          </span>
        </div>
      )}
    </div>
  );
};

interface TechnicalAnalysisTableProps {
  patterns: Array<{ type: string; direction: 'bullish' | 'bearish' | string; confidence: number; prz: { min: number; max: number } }>;
  fibLevels: Array<{ level: number; price: number; type: 'retracement' | 'extension' | string; strength: 'weak' | 'medium' | 'strong' | string }>;
  trendLines: Array<{ type: 'support' | 'resistance'; strength: number; touches: number; distance: number; currentPrice: number }>;
  currentPrice: number;
  formatPrice: (value: number) => string;
}

const distanceToneClass = (distance: number, currentPrice: number): string => {
  // Tighter distance = warmer color (closer to actionable).
  const relativeDistance = currentPrice > 0 ? Math.abs(distance) / currentPrice : 0;
  if (relativeDistance < 0.005) return 'text-emerald-300 bg-emerald-400/10';
  if (relativeDistance < 0.02) return 'text-amber-300 bg-amber-400/10';
  return 'cx-text-muted cx-bg-card';
};

const strengthToneClass = (strength: 'weak' | 'medium' | 'strong' | string): string => {
  if (strength === 'strong') return 'text-emerald-300 bg-emerald-400/10';
  if (strength === 'medium') return 'text-amber-300 bg-amber-400/10';
  return 'cx-text-muted cx-bg-card';
};

const strengthNumericTone = (s: number): string => {
  if (s >= 70) return 'text-emerald-300 bg-emerald-400/10';
  if (s >= 40) return 'text-amber-300 bg-amber-400/10';
  return 'cx-text-muted cx-bg-card';
};

/**
 * TechnicalAnalysisTable
 * Replaces the dense text dump with a properly tabular layout and color-coded
 * proximity. The eye can now scan by type, strength, and proximity in one pass.
 */
export const TechnicalAnalysisTable: React.FC<TechnicalAnalysisTableProps> = ({
  patterns,
  fibLevels,
  trendLines,
  currentPrice,
  formatPrice,
}) => {
  if (patterns.length === 0 && fibLevels.length === 0 && trendLines.length === 0) {
    return (
      <div className="rounded-md border cx-border cx-bg-elev px-3 py-2 text-xs cx-text-faint">
        No active patterns or levels on this timeframe.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {patterns.length > 0 && (
        <div>
          <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-emerald-300">Harmonic Patterns</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider cx-text-faint">
                <th className="py-1 text-left">Pattern</th>
                <th className="py-1 text-right">Confidence</th>
                <th className="py-1 text-right">PRZ</th>
              </tr>
            </thead>
            <tbody>
              {patterns.map((p, i) => (
                <tr key={i} className="border-t border-white/[0.04]">
                  <td className="py-1.5">
                    <span className={`font-bold ${p.direction === 'bullish' ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {p.type}
                    </span>
                  </td>
                  <td className="py-1.5 text-right font-mono cx-text-muted">{p.confidence.toFixed(0)}%</td>
                  <td className="py-1.5 text-right font-mono cx-text">
                    {formatPrice(p.prz.min)} – {formatPrice(p.prz.max)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {fibLevels.length > 0 && (
        <div>
          <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-purple-300">Fibonacci Levels</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider cx-text-faint">
                <th className="py-1 text-left">Level</th>
                <th className="py-1 text-left">Type</th>
                <th className="py-1 text-right">Price</th>
                <th className="py-1 text-right">Strength</th>
              </tr>
            </thead>
            <tbody>
              {fibLevels.map((f, i) => (
                <tr key={i} className="border-t border-white/[0.04]">
                  <td className="py-1.5 font-mono text-purple-300">{(Number(f.level) * 100).toFixed(1)}%</td>
                  <td className="py-1.5">
                    <span className={String(f.type) === 'extension' ? 'text-cyan-300' : 'text-violet-300'}>
                      {String(f.type) === 'extension' ? 'EXT' : 'RET'}
                    </span>
                  </td>
                  <td className="py-1.5 text-right font-mono cx-text">{formatPrice(f.price)}</td>
                  <td className="py-1.5 text-right">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-black ${strengthToneClass(f.strength)}`}>
                      {String(f.strength).toUpperCase()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {trendLines.length > 0 && (
        <div>
          <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-blue-300">Trend Lines</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider cx-text-faint">
                <th className="py-1 text-left">Type</th>
                <th className="py-1 text-right">Strength</th>
                <th className="py-1 text-right">Touches</th>
                <th className="py-1 text-right">Distance</th>
              </tr>
            </thead>
            <tbody>
              {trendLines.map((t, i) => (
                <tr key={i} className="border-t border-white/[0.04]">
                  <td className="py-1.5">
                    <span className={t.type === 'support' ? 'text-blue-300' : 'text-orange-300'}>
                      {t.type === 'support' ? 'Support' : 'Resistance'}
                    </span>
                  </td>
                  <td className="py-1.5 text-right">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-black ${strengthNumericTone(t.strength)}`}>
                      {t.strength.toFixed(0)}%
                    </span>
                  </td>
                  <td className="py-1.5 text-right font-mono cx-text-muted">{t.touches}</td>
                  <td className="py-1.5 text-right">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-black ${distanceToneClass(t.distance, currentPrice)}`}>
                      {formatPrice(Math.abs(t.distance))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

interface SetupGuideHeroProps {
  setupReady: boolean;
  setupHardBlocked: boolean;
  setupTimingStatus: string;
  v2Score: number;
  direction: 'BUY' | 'SELL' | 'NEUTRAL' | string;
  calendarStatus?: string;
  onClose: () => void;
  children?: React.ReactNode;
}

/**
 * SetupGuideHero
 * The "WAIT" / "NO TRADE" / "TRADE READY" card that replaces the old text-heavy
 * setup guide. Adds a clear traffic-light signal plus the most important
 * detail: the *reason* for the state and the next thing to wait for.
 */
export const SetupGuideHero: React.FC<SetupGuideHeroProps> = ({
  setupReady,
  setupHardBlocked,
  setupTimingStatus,
  v2Score,
  direction,
  calendarStatus,
  onClose,
  children,
}) => {
  const directionUpper = String(direction || 'NEUTRAL').toUpperCase();
  const calendarBlocking = isCalendarBlocking(calendarStatus);
  const timingWait = setupTimingStatus.toUpperCase() !== 'READY';

  let headline: string;
  let headlineColor: string;
  let Icon: React.ComponentType<{ className?: string }>;
  let bodyText: string;

  if (setupReady) {
    headline = 'TRADE READY';
    headlineColor = 'text-emerald-300';
    Icon = CheckCircle2;
    bodyText = 'Deterministic gates are clear. Confirm the trigger before acting.';
  } else if (setupHardBlocked || calendarBlocking) {
    headline = 'BLOCKED';
    headlineColor = 'text-rose-300';
    Icon = XCircle;
    bodyText = 'Economic calendar gate is blocking this setup. No new entries until the gate clears.';
  } else if (v2Score < 60) {
    headline = 'NO TRADE';
    headlineColor = 'text-rose-300';
    Icon = AlertTriangle;
    bodyText = `V2 score is ${v2Score}/100 — below the 60 threshold. Zones are not actionable until score clears.`;
  } else if (timingWait) {
    headline = 'WAIT';
    headlineColor = 'text-amber-300';
    Icon = Clock;
    bodyText = 'Timing is WAIT — waiting on a confirming candle, volume, ADR, and V2 direction.';
  } else {
    headline = 'NO ACTIVE SETUP';
    headlineColor = 'cx-text-muted';
    Icon = AlertTriangle;
    bodyText = 'No qualifying zones on this timeframe yet.';
  }

  const badgeColor =
    headline === 'TRADE READY'
      ? 'border-emerald-400/40 bg-emerald-500/15'
      : headline === 'BLOCKED'
      ? 'border-rose-400/40 bg-rose-500/15'
      : headline === 'WAIT' || headline === 'NO TRADE'
      ? 'border-amber-400/40 bg-amber-500/15'
      : 'border-slate-400/40 bg-slate-500/15';

  return (
    <div className="rounded-xl border cx-border-strong cx-bg-elev/95 p-3 text-xs cx-text-muted shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${headlineColor}`} />
          <span className="font-black tracking-widest text-cyan-300">SETUP GUIDE</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded border px-2 py-1 text-[9px] font-black ${badgeColor} ${headlineColor}`}>
            {headline}
          </span>
          {directionUpper !== 'NEUTRAL' && (
            <span className={`rounded px-2 py-1 text-[9px] font-black ${
              directionUpper === 'BUY' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-rose-400/10 text-rose-300'
            }`}>
              {directionUpper}
            </span>
          )}
          <button
            onClick={onClose}
            className="rounded px-1.5 py-0.5 cx-text-faint hover:bg-white/[0.08] hover:cx-text"
            aria-label="Hide setup guide"
          >
            ×
          </button>
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed cx-text-muted">{bodyText}</p>
      {children}
      {(calendarBlocking || setupHardBlocked) && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-rose-300">
          <Calendar className="h-3 w-3" />
          <span>Calendar status: {calendarStatus || 'BLOCKED'}</span>
        </div>
      )}
    </div>
  );
};

interface CandlePatternLabel {
  type: 'doji' | 'hammer' | 'engulfing' | 'shooting_star' | 'spinning_top';
  direction: 'bullish' | 'bearish' | 'neutral';
  index: number; // last candle index
}

interface CandlePatternMarkersProps {
  candlePatterns: CandlePatternLabel[];
  // optional click handler reserved for future use
  onClick?: (pattern: CandlePatternLabel) => void;
}

/**
 * Pure candle-pattern detection helpers and a minimal marker component.
 * The component is intentionally lightweight — it renders a small chip near
 * the chart corner so traders can see the most recent pattern read.
 */
export const CandlePatternMarkers: React.FC<CandlePatternMarkersProps> = ({ candlePatterns, onClick }) => {
  if (candlePatterns.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {candlePatterns.slice(0, 3).map((p, i) => {
        const tone =
          p.direction === 'bullish'
            ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'
            : p.direction === 'bearish'
            ? 'border-rose-400/30 bg-rose-500/10 text-rose-300'
            : 'border-slate-400/30 bg-slate-500/10 cx-text-muted';
        return (
          <button
            key={`${p.type}-${p.index}-${i}`}
            onClick={() => onClick?.(p)}
            className={`rounded border px-2 py-1 text-[10px] font-black uppercase tracking-wider ${tone}`}
          >
            {p.type.replace('_', ' ')}
          </button>
        );
      })}
    </div>
  );
};

/**
 * detectCandlePatterns
 * Pure-function scanner that reads the most recent few candles and classifies
 * the most prominent ones. No allocations beyond what the caller passes in,
 * so the chart re-renders stay cheap.
 */
export const detectCandlePatterns = (
  candles: Array<{ open: number; high: number; low: number; close: number }>,
): CandlePatternLabel[] => {
  if (candles.length < 2) return [];
  const results: CandlePatternLabel[] = [];
  const last = candles.length - 1;
  const c = candles[last];
  const cPrev = candles[last - 1];
  const body = Math.abs(c.close - c.open);
  const range = Math.max(c.high - c.low, 1e-9);
  const upperWick = c.high - Math.max(c.close, c.open);
  const lowerWick = Math.min(c.close, c.open) - c.low;

  // Doji: body < 10% of total range
  if (body / range < 0.1) {
    results.push({ type: 'doji', direction: 'neutral', index: last });
  }

  // Spinning top: body < 30% of range, both wicks > body
  if (body / range < 0.3 && upperWick > body && lowerWick > body) {
    results.push({ type: 'spinning_top', direction: 'neutral', index: last });
  }

  // Hammer: small body at top, long lower wick (>2x body), short upper wick
  if (lowerWick > body * 2 && upperWick < body * 0.5) {
    results.push({ type: 'hammer', direction: 'bullish', index: last });
  }

  // Shooting star: small body at bottom, long upper wick (>2x body), short lower wick
  if (upperWick > body * 2 && lowerWick < body * 0.5) {
    results.push({ type: 'shooting_star', direction: 'bearish', index: last });
  }

  // Engulfing: previous candle's body fully inside the current candle's body in opposite direction
  const prevBody = Math.abs(cPrev.close - cPrev.open);
  const currBody = Math.abs(c.close - c.open);
  if (currBody > prevBody) {
    const prevDirection = cPrev.close > cPrev.open ? 'bullish' : 'bearish';
    const currDirection = c.close > c.open ? 'bullish' : 'bearish';
    if (prevDirection !== currDirection) {
      const prevHigh = Math.max(cPrev.close, cPrev.open);
      const prevLow = Math.min(cPrev.close, cPrev.open);
      const currHigh = Math.max(c.close, c.open);
      const currLow = Math.min(c.close, c.open);
      if (currHigh > prevHigh && currLow < prevLow) {
        results.push({
          type: 'engulfing',
          direction: currDirection as 'bullish' | 'bearish',
          index: last,
        });
      }
    }
  }

  return results;
};
