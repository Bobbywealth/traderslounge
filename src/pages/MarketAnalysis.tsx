import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bell,
  BellOff,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Crosshair,
  DollarSign,
  Eye,
  EyeOff,
  Gauge,
  HelpCircle,
  Layers,
  Minus,
  Pause,
  Play,
  RefreshCw,
  Shield,
  TrendingDown,
  TrendingUp,
  Volume2,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  bwtsApi,
  planReasonText,
  type CalendarGateStatus,
  type CryptoAnalysis,
  type Trigger,
} from '../services/bwtsApi';

interface MarketStateInfo {
  state: 'trending' | 'ranging' | 'breaking_out' | 'reversing' | 'unknown';
  label: string;
  description: string;
}

interface ReadinessCheck {
  id: string;
  label: string;
  passed: boolean;
  detail?: string;
}

interface LevelInfo {
  type: string;
  price: number;
  label: string;
  strength: 'strong' | 'moderate' | 'weak';
}

const detectMarketState = (analysis?: CryptoAnalysis | null): MarketStateInfo => {
  if (!analysis) return { state: 'unknown', label: 'Unknown', description: 'Insufficient data' };

  const structure = analysis.institutional_analysis?.market_structure;
  const momentum = analysis.institutional_analysis?.momentum_detail;
  const volatility = analysis.institutional_analysis?.volatility_detail;

  if (structure?.overall) {
    const s = structure.overall.toLowerCase();
    if (s.includes('trending') || s.includes('trend')) {
      return { state: 'trending', label: 'Trending', description: 'Clear directional movement with structure confirmation' };
    }
    if (s.includes('range') || s.includes('consolidat')) {
      return { state: 'ranging', label: 'Ranging', description: 'Price oscillating within defined boundaries' };
    }
    if (s.includes('break')) {
      return { state: 'breaking_out', label: 'Breaking Out', description: 'Price escaping recent range with momentum' };
    }
    if (s.includes('revers')) {
      return { state: 'reversing', label: 'Reversing', description: 'Structure shift suggesting direction change' };
    }
  }

  if (volatility?.compression) {
    return { state: 'ranging', label: 'Compressed', description: 'Low volatility - expansion likely soon' };
  }

  return { state: 'trending', label: 'Trending', description: 'Directional bias established' };
};

const timeframeLabels: Record<string, string> = {
  mn1: 'Monthly',
  w1: 'Weekly',
  d1: 'Daily',
  h4: '4H',
  h1: '1H',
};

const timeframeOrder = ['mn1', 'w1', 'd1', 'h4', 'h1'];

const formatPrice = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value >= 100 ? value.toFixed(2) : value.toFixed(5);
};

const clamp = (value: number | null | undefined, min = 0, max = 100) => {
  const v = Number(value);
  return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : 0;
};

const percent = (value: number | null | undefined) => `${Math.round(clamp(value))}%`;

const MetricBar: React.FC<{
  label: string;
  value: number;
  description?: string;
  accent?: 'cyan' | 'violet' | 'amber' | 'emerald' | 'rose';
  size?: 'sm' | 'md';
}> = ({ label, value, description, accent = 'cyan', size = 'md' }) => {
  const colors: Record<string, string> = {
    cyan: 'from-cyan-400 to-cyan-500',
    violet: 'from-violet-400 to-violet-500',
    amber: 'from-amber-400 to-amber-500',
    emerald: 'from-emerald-400 to-emerald-500',
    rose: 'from-rose-400 to-rose-500',
  };

  const textColors: Record<string, string> = {
    cyan: 'text-cyan-300',
    violet: 'text-violet-300',
    amber: 'text-amber-300',
    emerald: 'text-emerald-300',
    rose: 'text-rose-300',
  };

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</span>
        <span className={`text-sm font-black ${textColors[accent]}`}>{percent(value)}</span>
      </div>
      <div className={`mt-2 overflow-hidden rounded-full bg-white/[0.06] ${size === 'sm' ? 'h-1' : 'h-1.5'}`}>
        <div
          className={`h-full rounded-full bg-gradient-to-r ${colors[accent]}`}
          style={{ width: `${clamp(value)}%` }}
        />
      </div>
      {description && <p className="mt-2 text-[10px] leading-4 text-slate-500">{description}</p>}
    </div>
  );
};

const StatusBadge: React.FC<{
  status: 'READY' | 'WAIT' | 'AVOID' | 'BLOCKED' | 'WATCHLIST' | string;
}> = ({ status }) => {
  const styles: Record<string, string> = {
    READY: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
    WAIT: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
    AVOID: 'border-rose-400/30 bg-rose-400/10 text-rose-300',
    BLOCKED: 'border-rose-400/30 bg-rose-400/10 text-rose-300',
    WATCHLIST: 'border-violet-400/30 bg-violet-400/10 text-violet-300',
    STRONG: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
    VALID: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-300',
  };

  return (
    <span className={`rounded-md border px-2 py-1 text-[9px] font-black ${styles[status] || styles.WAIT}`}>
      {status}
    </span>
  );
};

const DirectionBadge: React.FC<{ direction: 'BUY' | 'SELL' | 'NEUTRAL' }> = ({ direction }) => {
  const styles: Record<string, string> = {
    BUY: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20',
    SELL: 'bg-rose-400/10 text-rose-300 border-rose-400/20',
    NEUTRAL: 'bg-slate-400/10 text-slate-400 border-slate-400/20',
  };

  const icons: Record<string, React.ReactNode> = {
    BUY: <TrendingUp className="h-3 w-3" />,
    SELL: <TrendingDown className="h-3 w-3" />,
    NEUTRAL: <Minus className="h-3 w-3" />,
  };

  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-black ${styles[direction]}`}>
      {icons[direction]} {direction}
    </span>
  );
};

const MarketStateIndicator: React.FC<{ state: MarketStateInfo }> = ({ state }) => {
  const icons: Record<string, React.ReactNode> = {
    trending: <TrendingUp className="h-4 w-4" />,
    ranging: <Layers className="h-4 w-4" />,
    breaking_out: <Zap className="h-4 w-4" />,
    reversing: <RefreshCw className="h-4 w-4" />,
    unknown: <HelpCircle className="h-4 w-4" />,
  };

  const colors: Record<string, string> = {
    trending: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20',
    ranging: 'bg-amber-400/10 text-amber-300 border-amber-400/20',
    breaking_out: 'bg-violet-400/10 text-violet-300 border-violet-400/20',
    reversing: 'bg-rose-400/10 text-rose-300 border-rose-400/20',
    unknown: 'bg-slate-400/10 text-slate-400 border-slate-400/20',
  };

  return (
    <div className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 ${colors[state.state]}`}>
      {icons[state.state]}
      <div>
        <div className="text-xs font-black">{state.label}</div>
        <div className="text-[10px] opacity-75">{state.description}</div>
      </div>
    </div>
  );
};

const HigherTimeframeBias: React.FC<{ analysis?: CryptoAnalysis | null }> = ({ analysis }) => {
  const timeframes = analysis?.market_context?.timeframes;
  if (!timeframes) return null;

  const trendColors: Record<string, string> = {
    bullish: 'text-emerald-300',
    bearish: 'text-rose-300',
    neutral: 'text-slate-400',
  };

  const trendBg: Record<string, string> = {
    bullish: 'bg-emerald-400/10',
    bearish: 'bg-rose-400/10',
    neutral: 'bg-slate-400/10',
  };

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
      <div className="mb-2 text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">Higher Timeframe Bias</div>
      <div className="flex gap-2">
        {timeframeOrder.map((tf) => {
          const data = timeframes[tf];
          if (!data) return null;
          const trend = data.trend || 'neutral';
          return (
            <div
              key={tf}
              className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-1.5 ${trendBg[trend]} border-white/[0.06]`}
            >
              <span className="text-[9px] font-bold text-slate-500">{timeframeLabels[tf] || tf}</span>
              <span className={`text-[10px] font-black ${trendColors[trend]}`}>
                {trend === 'bullish' ? '▲' : trend === 'bearish' ? '▼' : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const ImportantLevels: React.FC<{ analysis?: CryptoAnalysis | null; direction?: 'BUY' | 'SELL' | 'NEUTRAL' }> = ({
  analysis,
  direction = 'NEUTRAL',
}) => {
  const zones = analysis?.zones || {};
  const supportLevels: LevelInfo[] = [];
  const resistanceLevels: LevelInfo[] = [];

  Object.entries(zones).forEach(([key, value]: [string, any]) => {
    if (!value || typeof value !== 'object') return;
    const price = value.price || value.level || value;
    if (typeof price !== 'number') return;

    if (key.includes('support') || key.includes('demand') || key.includes('ob')) {
      supportLevels.push({
        type: key,
        price,
        label: value.label || key.replace(/_/g, ' '),
        strength: value.strength || 'moderate',
      });
    } else if (key.includes('resistance') || key.includes('supply') || key.includes('sell')) {
      resistanceLevels.push({
        type: key,
        price,
        label: value.label || key.replace(/_/g, ' '),
        strength: value.strength || 'moderate',
      });
    }
  });

  const levels = direction === 'BUY' ? [...supportLevels, ...resistanceLevels] :
                direction === 'SELL' ? [...resistanceLevels, ...supportLevels] :
                [...resistanceLevels, ...supportLevels];

  if (levels.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
        <div className="mb-2 text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">Key Levels</div>
        <p className="text-xs text-slate-500">No structured levels detected</p>
      </div>
    );
  }

  const strengthColors: Record<string, string> = {
    strong: 'border-emerald-400/30 bg-emerald-400/5',
    moderate: 'border-amber-400/30 bg-amber-400/5',
    weak: 'border-slate-400/30 bg-slate-400/5',
  };

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
      <div className="mb-2 text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">Key Levels</div>
      <div className="space-y-1.5">
        {levels.slice(0, 6).map((level, i) => (
          <div key={`${level.type}-${i}`} className={`flex items-center justify-between rounded-lg border px-2 py-1.5 ${strengthColors[level.strength]}`}>
            <span className="text-[10px] text-slate-400">{level.label}</span>
            <span className="font-mono text-[10px] font-bold text-slate-200">{formatPrice(level.price)}</span>
          </div>
        ))}
      </div>
      {levels.length > 6 && (
        <div className="mt-2 text-[10px] text-slate-500">+{levels.length - 6} more levels</div>
      )}
    </div>
  );
};

const MomentumVolatility: React.FC<{ analysis?: CryptoAnalysis | null }> = ({ analysis }) => {
  const momentum = analysis?.institutional_analysis?.momentum_detail;
  const volatility = analysis?.institutional_analysis?.volatility_detail;

  if (!momentum && !volatility) {
    return (
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
        <div className="mb-2 text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">Momentum & Volatility</div>
        <p className="text-xs text-slate-500">Data unavailable</p>
      </div>
    );
  }

  const rsiValue = momentum?.rsi;
  const rsiState = momentum?.rsi_state || 'unknown';
  const atrValue = volatility?.atr;
  const regime = volatility?.regime || 'unknown';

  const rsiColors: Record<string, string> = {
    oversold: 'text-emerald-300',
    overbought: 'text-rose-300',
    neutral: 'text-slate-300',
    unknown: 'text-slate-500',
  };

  const regimeColors: Record<string, string> = {
    low: 'bg-amber-400/10 text-amber-300 border-amber-400/20',
    normal: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20',
    high: 'bg-rose-400/10 text-rose-300 border-rose-400/20',
    unknown: 'bg-slate-400/10 text-slate-400 border-slate-400/20',
  };

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
      <div className="mb-2 text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">Momentum & Volatility</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[9px] text-slate-600">RSI (14)</div>
          <div className={`text-lg font-black ${rsiColors[rsiState]}`}>
            {rsiValue != null ? rsiValue.toFixed(1) : '—'}
          </div>
          <div className="text-[10px] text-slate-500 capitalize">{rsiState}</div>
        </div>
        <div>
          <div className="text-[9px] text-slate-600">ATR</div>
          <div className="text-lg font-black text-slate-200">
            {atrValue != null ? atrValue.toFixed(5) : '—'}
          </div>
          <div className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-black capitalize ${regimeColors[regime]}`}>
            {regime} vol
          </div>
        </div>
      </div>
      {momentum?.macd != null && (
        <div className="mt-2 border-t border-white/[0.06] pt-2">
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-500">MACD</span>
            <span className="text-slate-300">{(momentum.macd || 0).toFixed(4)}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const EconomicRisk: React.FC<{ calendar?: CalendarGateStatus | null }> = ({ calendar }) => {
  if (!calendar) {
    return (
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
        <div className="mb-2 text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">Economic Risk</div>
        <p className="text-xs text-slate-500">Calendar data unavailable</p>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    CLEAR: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20',
    CAUTION: 'bg-amber-400/10 text-amber-300 border-amber-400/20',
    BLOCKED: 'bg-rose-400/10 text-rose-300 border-rose-400/20',
    POST_NEWS: 'bg-violet-400/10 text-violet-300 border-violet-400/20',
    UNAVAILABLE: 'bg-slate-400/10 text-slate-400 border-slate-400/20',
  };

  const icons: Record<string, React.ReactNode> = {
    CLEAR: <CheckCircle2 className="h-4 w-4" />,
    CAUTION: <AlertTriangle className="h-4 w-4" />,
    BLOCKED: <XCircle className="h-4 w-4" />,
    POST_NEWS: <Clock className="h-4 w-4" />,
    UNAVAILABLE: <AlertCircle className="h-4 w-4" />,
  };

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
      <div className="mb-2 text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">Economic Risk</div>
      <div className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 ${statusColors[calendar.status] || statusColors.UNAVAILABLE}`}>
        {icons[calendar.status] || icons.UNAVAILABLE}
        <span className="text-xs font-black">{calendar.status}</span>
      </div>
      {calendar.next_event && (
        <div className="mt-2 text-[10px] text-slate-400">
          <span className="font-bold">{calendar.next_event.title}</span>
          {calendar.minutes_to_event != null && (
            <span className="ml-2 text-slate-500">in {calendar.minutes_to_event}m</span>
          )}
        </div>
      )}
      {calendar.event && (
        <div className="mt-1 text-[10px] text-slate-500">
          Current: {calendar.event.title}
        </div>
      )}
    </div>
  );
};

const ScenarioBlock: React.FC<{
  type: 'bullish' | 'bearish';
  conditions: string[];
  analysis?: CryptoAnalysis | null;
}> = ({ type, conditions, analysis }) => {
  const colors = type === 'bullish'
    ? { border: 'border-emerald-400/20', bg: 'bg-emerald-400/5', text: 'text-emerald-300', icon: <ArrowUp className="h-4 w-4" /> }
    : { border: 'border-rose-400/20', bg: 'bg-rose-400/5', text: 'text-rose-300', icon: <ArrowDown className="h-4 w-4" /> };

  return (
    <div className={`rounded-xl border ${colors.border} ${colors.bg} p-3`}>
      <div className={`flex items-center gap-2 ${colors.text} mb-2`}>
        {colors.icon}
        <span className="text-[10px] font-black uppercase tracking-[0.14em]">
          {type === 'bullish' ? 'Bullish Scenario' : 'Bearish Scenario'}
        </span>
      </div>
      <p className="text-xs text-slate-300 mb-2">
        {type === 'bullish'
          ? 'What must happen before considering a buy:'
          : 'What must happen before considering a sell:'}
      </p>
      <ul className="space-y-1">
        {conditions.map((condition, i) => (
          <li key={i} className="flex items-start gap-2 text-[10px] text-slate-400">
            <ChevronRight className="h-3 w-3 mt-0.5 flex-shrink-0 text-slate-500" />
            {condition}
          </li>
        ))}
        {conditions.length === 0 && (
          <li className="text-[10px] text-slate-500 italic">No specific conditions defined</li>
        )}
      </ul>
    </div>
  );
};

const PrimarySetup: React.FC<{ analysis?: CryptoAnalysis | null }> = ({ analysis }) => {
  const plan = analysis?.trade_plan;

  if (!plan) {
    return (
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
        <div className="mb-2 text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">Primary Setup</div>
        <p className="text-xs text-slate-500">No trade plan available</p>
      </div>
    );
  }

  const riskDistance = plan.risk_percent_of_price != null
    ? `${plan.risk_percent_of_price.toFixed(2)}%`
    : plan.risk_distance != null
      ? `${plan.risk_distance.toFixed(4)}%`
      : '—';

  const rr = plan.net_available_rr ?? plan.available_rr ?? 0;

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
      <div className="mb-3 text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">Primary Setup</div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[9px] text-slate-600 uppercase tracking-wider">Entry Zone</div>
          <div className="font-mono text-sm font-bold text-slate-200">{formatPrice(plan.entry)}</div>
        </div>
        <div>
          <div className="text-[9px] text-slate-600 uppercase tracking-wider">Invalidation</div>
          <div className="font-mono text-sm font-bold text-rose-300">{formatPrice(plan.invalidation)}</div>
        </div>
        <div>
          <div className="text-[9px] text-slate-600 uppercase tracking-wider">Stop Loss</div>
          <div className="font-mono text-sm font-bold text-rose-300">{formatPrice(plan.stop)}</div>
        </div>
        <div>
          <div className="text-[9px] text-slate-600 uppercase tracking-wider">Risk Distance</div>
          <div className="font-mono text-sm font-bold text-slate-300">{riskDistance}</div>
        </div>
      </div>

      <div className="mt-3 border-t border-white/[0.06] pt-3">
        <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-2">Targets</div>
        <div className="space-y-1.5">
          {plan.targets?.slice(0, 3).map((target, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg bg-black/20 px-2 py-1">
              <span className="text-[10px] font-bold text-cyan-300">{target.label}</span>
              <span className="font-mono text-[10px] text-slate-300">{formatPrice(target.price)}</span>
              <span className="text-[9px] text-slate-500">{target.r_multiple?.toFixed(1)}R</span>
            </div>
          ))}
          {(!plan.targets || plan.targets.length === 0) && (
            <div className="text-[10px] text-slate-500">No targets defined</div>
          )}
        </div>
      </div>

      <div className="mt-3 border-t border-white/[0.06] pt-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[9px] text-slate-600 uppercase tracking-wider">Risk:Reward</div>
            <div className={`font-black ${rr >= 2 ? 'text-emerald-300' : rr >= 1 ? 'text-amber-300' : 'text-rose-300'}`}>
              {rr.toFixed(2)}R
            </div>
          </div>
          <div>
            <div className="text-[9px] text-slate-600 uppercase tracking-wider">Account Risk</div>
            <div className="font-black text-slate-300">{Number(plan.account_risk_percent || 0).toFixed(2)}%</div>
          </div>
          {plan.atr != null && (
            <div>
              <div className="text-[9px] text-slate-600 uppercase tracking-wider">ATR</div>
              <div className="font-mono text-sm font-bold text-slate-300">{plan.atr.toFixed(5)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const ReadinessChecklist: React.FC<{
  analysis?: CryptoAnalysis | null;
  direction?: 'BUY' | 'SELL' | 'NEUTRAL';
}> = ({ analysis, direction }) => {
  const timing = analysis?.trade_timing;
  const plan = analysis?.trade_plan;
  const calendar = analysis?.economic_calendar;

  const checks: ReadinessCheck[] = [];

  checks.push({
    id: 'timing',
    label: 'Timing confirmed',
    passed: timing?.status === 'READY',
    detail: timing?.status === 'READY' ? 'Entry timing is favorable' : timing?.wait_for?.[0]?.replace(/_/g, ' ') || timing?.avoid_reasons?.[0],
  });

  checks.push({
    id: 'direction',
    label: `${direction} direction aligned`,
    passed: analysis?.direction === direction && direction !== 'NEUTRAL',
    detail: `Market bias: ${analysis?.direction || 'unknown'}`,
  });

  checks.push({
    id: 'calendar',
    label: 'Calendar clear',
    passed: calendar?.status === 'CLEAR' || calendar?.status === 'POST_NEWS',
    detail: calendar?.next_event?.title || `Status: ${calendar?.status || 'unavailable'}`,
  });

  checks.push({
    id: 'level',
    label: 'At key level',
    passed: timing?.location_ready === true,
    detail: timing?.nearest_sr ? `Near ${formatPrice(timing.nearest_sr.price)}` : 'Not at significant level',
  });

  checks.push({
    id: 'score',
    label: 'Confluence sufficient',
    passed: (analysis?.total_score || 0) >= 50,
    detail: `Score: ${analysis?.total_score || 0}/100`,
  });

  checks.push({
    id: 'plan',
    label: 'Trade plan valid',
    passed: plan?.status === 'STRONG' || plan?.status === 'VALID',
    detail: plan?.status || 'No plan',
  });

  const passedCount = checks.filter((c) => c.passed).length;
  const totalCount = checks.length;
  const readinessPct = Math.round((passedCount / totalCount) * 100);

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">Readiness Checklist</div>
        <div className="text-xs font-black text-cyan-300">{passedCount}/{totalCount} passed</div>
      </div>

      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400"
          style={{ width: `${readinessPct}%` }}
        />
      </div>

      <div className="space-y-2">
        {checks.map((check) => (
          <div key={check.id} className="flex items-start gap-2">
            {check.passed ? (
              <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-400" />
            ) : (
              <XCircle className="h-4 w-4 flex-shrink-0 text-slate-500" />
            )}
            <div className="min-w-0 flex-1">
              <div className={`text-xs font-medium ${check.passed ? 'text-slate-200' : 'text-slate-500'}`}>
                {check.label}
              </div>
              {check.detail && (
                <div className="text-[10px] text-slate-500 truncate">{check.detail}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const MissingConditions: React.FC<{ analysis?: CryptoAnalysis | null }> = ({ analysis }) => {
  const timing = analysis?.trade_timing;
  const plan = analysis?.trade_plan;

  const missing: { condition: string; detail: string; trigger?: Trigger }[] = [];

  if (timing?.wait_for?.length) {
    timing.wait_for.forEach((w) => {
      missing.push({ condition: w.replace(/_/g, ' '), detail: 'Required before entry' });
    });
  }

  if (plan?.blocking_reasons?.length) {
    plan.blocking_reasons.forEach((b) => {
      missing.push({ condition: b.message || b.code, detail: `Severity: ${b.severity}` });
    });
  }

  if (timing?.status === 'AVOID' && timing.avoid_reasons?.length) {
    timing.avoid_reasons.forEach((r) => {
      missing.push({ condition: 'Avoid reason', detail: r });
    });
  }

  if (missing.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3">
        <div className="flex items-center gap-2 text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
          <span className="text-xs font-black">All conditions met</span>
        </div>
        <p className="mt-1 text-[10px] text-slate-500">Ready to execute when entry triggers</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3">
      <div className="flex items-center gap-2 text-amber-300">
        <AlertTriangle className="h-4 w-4" />
        <span className="text-xs font-black">Missing conditions ({missing.length})</span>
      </div>
      <div className="mt-2 space-y-2">
        {missing.slice(0, 5).map((m, i) => (
          <div key={i} className="flex items-start gap-2 text-[10px]">
            <ChevronRight className="h-3 w-3 mt-0.5 flex-shrink-0 text-amber-400" />
            <div>
              <div className="text-slate-300">{m.condition}</div>
              <div className="text-slate-500">{m.detail}</div>
            </div>
          </div>
        ))}
        {missing.length > 5 && (
          <div className="text-[10px] text-slate-500">+{missing.length - 5} more</div>
        )}
      </div>
    </div>
  );
};

const PlainLanguageConclusion: React.FC<{
  analysis?: CryptoAnalysis | null;
  readinessPct: number;
}> = ({ analysis, readinessPct }) => {
  const direction = analysis?.direction || 'NEUTRAL';
  const timing = analysis?.trade_timing;
  const plan = analysis?.trade_plan;
  const scenario = analysis?.scenarios?.primary;

  if (!analysis) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-[#090d18] p-4">
        <p className="text-sm text-slate-400">Analysis data unavailable</p>
      </div>
    );
  }

  let conclusion = '';
  let subtext = '';

  if (timing?.status === 'AVOID') {
    const avoidReason = timing.avoid_reasons?.[0] || 'unstable volatility or market conditions';
    conclusion = `Do not enter. ${avoidReason}.`;
    subtext = 'Wait for conditions to stabilize before considering this setup.';
  } else if (timing?.status === 'WAIT') {
    const waitReason = timing.wait_for?.[0]?.replace(/_/g, ' ') || 'required confirmations';
    conclusion = `${direction === 'BUY' ? 'Bullish' : direction === 'SELL' ? 'Bearish' : 'Market'} structure exists, but do not enter. ${waitReason}.`;
    subtext = readinessPct >= 70
      ? 'Setup is close to qualifying. Alert me when readiness reaches 100%.'
      : 'Multiple conditions still missing. Monitor for progress.';
  } else if (timing?.status === 'READY' && plan?.eligible) {
    conclusion = `${direction === 'BUY' ? 'Bullish' : direction === 'SELL' ? 'Bearish' : 'Market'} setup is live. Entry at ${formatPrice(plan.entry)}.`;
    subtext = plan.invalidation
      ? `Invalidate if price closes ${direction === 'BUY' ? 'below' : 'above'} ${formatPrice(plan.invalidation)}.`
      : 'Plan is active and eligible for execution.';
  } else {
    conclusion = scenario || 'No active signal. Monitor for setups forming.';
    subtext = 'The scanner will alert you when conditions become favorable.';
  }

  return (
    <div className={`rounded-xl border p-4 ${
      timing?.status === 'READY' && plan?.eligible
        ? 'border-emerald-400/30 bg-emerald-400/5'
        : timing?.status === 'AVOID'
          ? 'border-rose-400/30 bg-rose-400/5'
          : 'border-amber-400/30 bg-amber-400/5'
    }`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 rounded-lg p-2 ${
          timing?.status === 'READY' && plan?.eligible
            ? 'bg-emerald-400/10 text-emerald-300'
            : timing?.status === 'AVOID'
              ? 'bg-rose-400/10 text-rose-300'
              : 'bg-amber-400/10 text-amber-300'
        }`}>
          {timing?.status === 'READY' && plan?.eligible ? (
            <Play className="h-5 w-5" />
          ) : timing?.status === 'AVOID' ? (
            <Pause className="h-5 w-5" />
          ) : (
            <Eye className="h-5 w-5" />
          )}
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-200">{conclusion}</p>
          <p className="mt-1 text-xs text-slate-400">{subtext}</p>
        </div>
      </div>
    </div>
  );
};

const AlertButton: React.FC<{
  analysis?: CryptoAnalysis | null;
  symbol: string;
}> = ({ analysis, symbol }) => {
  const [alertSet, setAlertSet] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSetAlert = async () => {
    setLoading(true);
    try {
      await bwtsApi.createAlert({
        symbol,
        condition: 'readiness_above',
        threshold: 70,
        message: `${symbol} setup readiness above 70%`,
      });
      setAlertSet(true);
    } catch (e) {
      console.error('Failed to set alert:', e);
    } finally {
      setLoading(false);
    }
  };

  if (alertSet) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-cyan-400/10 px-4 py-3 text-xs font-bold text-cyan-300">
        <Bell className="h-4 w-4" />
        Alert set for {symbol}
      </div>
    );
  }

  return (
    <button
      onClick={handleSetAlert}
      disabled={loading}
      className="flex items-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-xs font-bold text-cyan-300 transition hover:bg-cyan-400/20 disabled:opacity-50"
    >
      {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
      Set alert for {symbol}
    </button>
  );
};

const MarketAnalysis: React.FC = () => {
  const [searchParams] = useSearchParams();
  const symbol = searchParams.get('symbol') || 'BTCUSD';

  const [analysis, setAnalysis] = useState<CryptoAnalysis | null>(null);
  const [calendar, setCalendar] = useState<CalendarGateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [analysisData, calendarData] = await Promise.all([
        bwtsApi.cryptoAnalysis(symbol),
        bwtsApi.calendarStatus(symbol).catch(() => null),
      ]);
      setAnalysis(analysisData);
      setCalendar(calendarData);
      setLastUpdated(new Date());
    } catch (e: any) {
      setError(e?.message || 'Failed to load analysis');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  const direction = analysis?.direction || 'NEUTRAL';
  const marketState = detectMarketState(analysis);
  const timing = analysis?.trade_timing;

  const readinessChecks: ReadinessCheck[] = [
    {
      id: 'timing',
      label: 'Timing confirmed',
      passed: timing?.status === 'READY',
      detail: timing?.status === 'READY' ? 'Entry timing is favorable' : timing?.wait_for?.[0]?.replace(/_/g, ' ') || timing?.avoid_reasons?.[0],
    },
    {
      id: 'direction',
      label: `${direction} direction aligned`,
      passed: analysis?.direction === direction && direction !== 'NEUTRAL',
      detail: `Market bias: ${analysis?.direction || 'unknown'}`,
    },
    {
      id: 'calendar',
      label: 'Calendar clear',
      passed: calendar?.status === 'CLEAR' || calendar?.status === 'POST_NEWS',
      detail: calendar?.next_event?.title || `Status: ${calendar?.status || 'unavailable'}`,
    },
    {
      id: 'level',
      label: 'At key level',
      passed: timing?.location_ready === true,
      detail: timing?.nearest_sr ? `Near ${formatPrice(timing.nearest_sr.price)}` : 'Not at significant level',
    },
    {
      id: 'score',
      label: 'Confluence sufficient',
      passed: (analysis?.total_score || 0) >= 50,
      detail: `Score: ${analysis?.total_score || 0}/100`,
    },
    {
      id: 'plan',
      label: 'Trade plan valid',
      passed: analysis?.trade_plan?.status === 'STRONG' || analysis?.trade_plan?.status === 'VALID',
      detail: analysis?.trade_plan?.status || 'No plan',
    },
  ];

  const passedCount = readinessChecks.filter((c) => c.passed).length;
  const readinessPct = Math.round((passedCount / readinessChecks.length) * 100);

  const bullishConditions = analysis?.scenarios?.primary
    ? [`Price confirms ${analysis.scenarios.primary}`, '1H candle closes in direction', 'Entry zone reaches price']
    : [];

  const bearishConditions = analysis?.scenarios?.primary
    ? [`Bearish scenario: ${analysis.scenarios.primary}`, 'Structure confirmation on lower timeframes', 'Invalidation holds']
    : [];

  if (loading && !analysis) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-slate-400">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span>Loading market analysis...</span>
        </div>
      </div>
    );
  }

  if (error && !analysis) {
    return (
      <div className="rounded-2xl border border-rose-400/30 bg-rose-400/10 p-6">
        <div className="flex items-center gap-3 text-rose-300">
          <AlertCircle className="h-5 w-5" />
          <span className="font-bold">{error}</span>
        </div>
        <button onClick={load} className="mt-4 rounded-lg bg-rose-400/20 px-4 py-2 text-sm font-bold text-rose-300">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-8">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{symbol}</h1>
            <DirectionBadge direction={direction} />
            <StatusBadge status={analysis?.trade_plan?.status || analysis?.trade_timing?.status || 'WAIT'} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Market analysis · {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Loading...'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/tradingview?symbol=${symbol}`}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-white/[0.08]"
          >
            <Crosshair className="h-4 w-4" />
            View chart
          </Link>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-white/[0.08] disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <MetricBar
          label="Market Bias"
          value={analysis?.decision_quality?.market_bias_confidence ?? analysis?.market_context?.alignment_score ?? 0}
          description={`Direction: ${direction}`}
          accent={direction === 'BUY' ? 'emerald' : direction === 'SELL' ? 'rose' : 'violet'}
        />
        <MetricBar
          label="Setup Quality"
          value={analysis?.decision_quality?.setup_quality ?? analysis?.confluence_score ?? analysis?.total_score ?? 0}
          description={`${analysis?.confidence_tier || 'developing'} evidence`}
          accent="cyan"
        />
        <MetricBar
          label="Execution Readiness"
          value={readinessPct}
          description={timing?.status === 'READY' ? 'Ready to enter' : timing?.status === 'AVOID' ? 'Avoid entry' : 'Waiting for conditions'}
          accent={timing?.status === 'READY' ? 'emerald' : timing?.status === 'AVOID' ? 'rose' : 'amber'}
        />
      </section>

      <PlainLanguageConclusion analysis={analysis} readinessPct={readinessPct} />

      <section className="grid gap-4 lg:grid-cols-2">
        <MarketStateIndicator state={marketState} />
        <HigherTimeframeBias analysis={analysis} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <ImportantLevels analysis={analysis} direction={direction} />
        <MomentumVolatility analysis={analysis} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <EconomicRisk calendar={calendar} />
        <ReadinessChecklist analysis={analysis} direction={direction} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <ScenarioBlock type="bullish" conditions={bullishConditions} analysis={analysis} />
        <ScenarioBlock type="bearish" conditions={bearishConditions} analysis={analysis} />
      </section>

      <PrimarySetup analysis={analysis} />

      <MissingConditions analysis={analysis} />

      <section className="flex flex-wrap items-center gap-3">
        <AlertButton analysis={analysis} symbol={symbol} />
        {analysis?.trade_plan?.triggers?.slice(0, 2).map((trigger, i) => (
          <div key={i} className="flex items-center gap-2 rounded-lg border border-violet-400/20 bg-violet-400/5 px-3 py-2 text-xs">
            <Volume2 className="h-3.5 w-3.5 text-violet-300" />
            <span className="text-slate-300">{trigger.humanReadable || trigger.type}</span>
          </div>
        ))}
      </section>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1 text-[11px] text-slate-600">
        <span>Decision support only — not financial advice.</span>
        {analysis?.version && <span>Engine V{analysis.version}</span>}
        {lastUpdated && <span>Analysis {lastUpdated.toLocaleString()}</span>}
      </div>
    </div>
  );
};

export default MarketAnalysis;
