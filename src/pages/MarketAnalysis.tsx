import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  AlertCircle, AlertTriangle, ArrowDown, ArrowUp, Bell, Calendar, CheckCircle2,
  ChevronRight, Clock, Crosshair, Eye, Gauge, HelpCircle, Layers, Minus, Pause, Play,
  RefreshCw, TrendingDown, TrendingUp, Volume2, XCircle, Zap,
} from 'lucide-react';
import { bwtsApi, type CalendarGateStatus, type CryptoAnalysis } from '../services/bwtsApi';

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

  return { state: 'unknown', label: 'Unknown', description: 'Insufficient data to determine market state' };
};

const timeframeLabels: Record<string, string> = {
  mn1: 'Monthly', w1: 'Weekly', d1: 'Daily', h4: '4H', h1: '1H',
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

const cxAccentGradient: Record<string, string> = {
  cyan: 'linear-gradient(90deg, #22d3ee, #06b6d4)',
  violet: 'linear-gradient(90deg, #a78bfa, #8b5cf6)',
  amber: 'linear-gradient(90deg, #fbbf24, #f59e0b)',
  emerald: 'linear-gradient(90deg, #34d399, #10b981)',
  rose: 'linear-gradient(90deg, #fb7185, #ef4444)',
};

const cxAccentText: Record<string, string> = {
  cyan: 'var(--cx-status-info-fg)',
  violet: 'var(--cx-brand-violet-soft)',
  amber: 'var(--cx-status-warning-fg)',
  emerald: 'var(--cx-status-success-fg)',
  rose: 'var(--cx-status-danger-fg)',
};

const MetricBar: React.FC<{
  label: string;
  value: number;
  description?: string;
  accent?: 'cyan' | 'violet' | 'amber' | 'emerald' | 'rose';
}> = ({ label, value, description, accent = 'cyan' }) => (
  <div className="cx-card cx-card-hoverable">
    <div className="flex items-center justify-between gap-2">
      <span className="cx-eyebrow">{label}</span>
      <span className="text-base font-black" style={{ color: cxAccentText[accent] }}>{percent(value)}</span>
    </div>
    <div className="cx-progress mt-3">
      <div className="cx-progress-bar" style={{ width: `${clamp(value)}%`, background: cxAccentGradient[accent] }} />
    </div>
    {description && <p className="cx-meta mt-3 leading-relaxed">{description}</p>}
  </div>
);

const StatusBadge: React.FC<{ status: 'READY' | 'WAIT' | 'AVOID' | 'BLOCKED' | 'WATCHLIST' | string }> = ({ status }) => {
  const variant: Record<string, string> = {
    READY: 'cx-pill cx-pill-success',
    WAIT: 'cx-pill cx-pill-warning',
    AVOID: 'cx-pill cx-pill-danger',
    BLOCKED: 'cx-pill cx-pill-danger',
    WATCHLIST: 'cx-pill cx-pill-info',
    STRONG: 'cx-pill cx-pill-success',
    VALID: 'cx-pill cx-pill-info',
  };
  return <span className={variant[status] || 'cx-pill cx-pill-neutral'}>{status}</span>;
};

const DirectionBadge: React.FC<{ direction: 'BUY' | 'SELL' | 'NEUTRAL' }> = ({ direction }) => {
  const variant: Record<string, string> = {
    BUY: 'cx-pill cx-pill-success',
    SELL: 'cx-pill cx-pill-danger',
    NEUTRAL: 'cx-pill cx-pill-neutral',
  };
  const icon = direction === 'BUY' ? <TrendingUp className="h-3 w-3" /> : direction === 'SELL' ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />;
  return <span className={`${variant[direction]} gap-1`}>{icon} {direction}</span>;
};

const MarketStateIndicator: React.FC<{ state: MarketStateInfo }> = ({ state }) => {
  const icons: Record<string, React.ReactNode> = {
    trending: <TrendingUp className="h-4 w-4" />,
    ranging: <Layers className="h-4 w-4" />,
    breaking_out: <Zap className="h-4 w-4" />,
    reversing: <RefreshCw className="h-4 w-4" />,
    unknown: <HelpCircle className="h-4 w-4" />,
  };
  const variant: Record<string, string> = {
    trending: 'cx-panel cx-panel-success',
    ranging: 'cx-panel cx-panel-warning',
    breaking_out: 'cx-panel cx-panel-info',
    reversing: 'cx-panel cx-panel-danger',
    unknown: 'cx-panel',
  };
  return (
    <div className={`${variant[state.state]} flex items-center gap-3`}>
      {icons[state.state]}
      <div>
        <div className="cx-h2">{state.label}</div>
        <div className="cx-meta">{state.description}</div>
      </div>
    </div>
  );
};

const HigherTimeframeBias: React.FC<{ analysis?: CryptoAnalysis | null }> = ({ analysis }) => {
  const timeframes = analysis?.market_context?.timeframes;
  if (!timeframes) return null;

  const trendPill: Record<string, string> = {
    bullish: 'cx-pill cx-pill-success',
    bearish: 'cx-pill cx-pill-danger',
    neutral: 'cx-pill cx-pill-neutral',
  };
  const trendArrow: Record<string, string> = {
    bullish: '▲',
    bearish: '▼',
    neutral: '—',
  };

  return (
    <div className="cx-card">
      <div className="cx-eyebrow mb-3">Higher Timeframe Bias</div>
      <div className="flex gap-2">
        {timeframeOrder.map((tf) => {
          const data = timeframes[tf];
          if (!data) return null;
          const trend = data.trend || 'neutral';
          return (
            <div key={tf} className={`${trendPill[trend]} flex flex-col items-center gap-0.5`}>
              <span className="text-[9px] font-black opacity-90">{timeframeLabels[tf] || tf}</span>
              <span className="text-[12px] font-black">{trendArrow[trend]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const ImportantLevels: React.FC<{ analysis?: CryptoAnalysis | null; direction?: 'BUY' | 'SELL' | 'NEUTRAL' }> = ({ analysis, direction = 'NEUTRAL' }) => {
  const zones = analysis?.zones || {};
  const supportLevels: LevelInfo[] = [];
  const resistanceLevels: LevelInfo[] = [];

  Object.entries(zones).forEach(([key, value]: [string, any]) => {
    if (!value || typeof value !== 'object') return;
    const price = value.price || value.level || value;
    if (typeof price !== 'number') return;
    if (key.includes('support') || key.includes('demand') || key.includes('ob')) {
      supportLevels.push({ type: key, price, label: value.label || key.replace(/_/g, ' '), strength: value.strength || 'moderate' });
    } else if (key.includes('resistance') || key.includes('supply') || key.includes('sell')) {
      resistanceLevels.push({ type: key, price, label: value.label || key.replace(/_/g, ' '), strength: value.strength || 'moderate' });
    }
  });

  const levels = direction === 'BUY' ? [...supportLevels, ...resistanceLevels] :
                direction === 'SELL' ? [...resistanceLevels, ...supportLevels] :
                [...resistanceLevels, ...supportLevels];

  const strengthPill: Record<string, string> = {
    strong: 'cx-pill cx-pill-success',
    moderate: 'cx-pill cx-pill-warning',
    weak: 'cx-pill cx-pill-neutral',
  };

  return (
    <div className="cx-card">
      <div className="cx-eyebrow mb-3">Key Levels</div>
      {levels.length === 0 ? <p className="cx-meta">No structured levels detected</p> : (
        <div className="space-y-2">
          {levels.slice(0, 6).map((level, i) => (
            <div key={`${level.type}-${i}`} className="flex items-center justify-between cx-bg-card-hover cx-border cx-rounded-lg px-3 py-2" style={{ borderRadius: 'var(--cx-radius-md)' }}>
              <span className="cx-meta">{level.label}</span>
              <span className={`cx-mono ${strengthPill[level.strength]}`}>{formatPrice(level.price)}</span>
            </div>
          ))}
          {levels.length > 6 && <div className="cx-meta-faint">+{levels.length - 6} more levels</div>}
        </div>
      )}
    </div>
  );
};

const MomentumVolatility: React.FC<{ analysis?: CryptoAnalysis | null }> = ({ analysis }) => {
  const momentum = analysis?.institutional_analysis?.momentum_detail;
  const volatility = analysis?.institutional_analysis?.volatility_detail;

  if (!momentum && !volatility) {
    return (
      <div className="cx-card">
        <div className="cx-eyebrow mb-3">Momentum & Volatility</div>
        <p className="cx-meta">Data unavailable</p>
      </div>
    );
  }

  const rsiValue = momentum?.rsi;
  const rsiState = momentum?.rsi_state || 'unknown';
  const atrValue = volatility?.atr;
  const regime = volatility?.regime || 'unknown';

  const rsiText: Record<string, string> = {
    oversold: 'var(--cx-status-success-fg)',
    overbought: 'var(--cx-status-danger-fg)',
    neutral: 'var(--cx-text)',
    unknown: 'var(--cx-text-faint)',
  };
  const regimePill: Record<string, string> = {
    low: 'cx-pill cx-pill-warning',
    normal: 'cx-pill cx-pill-success',
    high: 'cx-pill cx-pill-danger',
    unknown: 'cx-pill cx-pill-neutral',
  };

  return (
    <div className="cx-card">
      <div className="cx-eyebrow mb-3">Momentum & Volatility</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="cx-meta-faint">RSI (14)</div>
          <div className="text-xl font-black cx-mono" style={{ color: rsiText[rsiState] }}>
            {rsiValue != null ? rsiValue.toFixed(1) : '—'}
          </div>
          <div className="cx-meta-faint capitalize">{rsiState}</div>
        </div>
        <div>
          <div className="cx-meta-faint">ATR</div>
          <div className="text-xl font-black cx-mono">{atrValue != null ? atrValue.toFixed(5) : '—'}</div>
          <span className={`${regimePill[regime]} mt-1 capitalize`}>{regime} vol</span>
        </div>
      </div>
      {momentum?.macd != null && (
        <div className="mt-3 cx-border-t pt-3">
          <div className="flex justify-between cx-meta">
            <span>MACD</span>
            <span className="cx-mono cx-text">{(momentum.macd || 0).toFixed(4)}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const EconomicRisk: React.FC<{ calendar?: CalendarGateStatus | null }> = ({ calendar }) => {
  if (!calendar) {
    return (
      <div className="cx-card">
        <div className="cx-eyebrow mb-3">Economic Risk</div>
        <p className="cx-meta">Calendar data unavailable</p>
      </div>
    );
  }

  const variant: Record<string, string> = {
    CLEAR: 'cx-pill cx-pill-success',
    CAUTION: 'cx-pill cx-pill-warning',
    BLOCKED: 'cx-pill cx-pill-danger',
    POST_NEWS: 'cx-pill cx-pill-info',
    UNAVAILABLE: 'cx-pill cx-pill-neutral',
  };
  const icons: Record<string, React.ReactNode> = {
    CLEAR: <CheckCircle2 className="h-4 w-4" />,
    CAUTION: <AlertTriangle className="h-4 w-4" />,
    BLOCKED: <XCircle className="h-4 w-4" />,
    POST_NEWS: <Clock className="h-4 w-4" />,
    UNAVAILABLE: <AlertCircle className="h-4 w-4" />,
  };

  return (
    <div className="cx-card">
      <div className="cx-eyebrow mb-3">Economic Risk</div>
      <span className={`${variant[calendar.status] || variant.UNAVAILABLE} gap-2 px-3 py-2`}>
        {icons[calendar.status] || icons.UNAVAILABLE}
        <span>{calendar.status}</span>
      </span>
      {calendar.next_event && (
        <div className="cx-meta mt-3">
          <span className="font-bold">{calendar.next_event.title}</span>
          {calendar.minutes_to_event != null && <span className="ml-2 cx-text-faint">in {calendar.minutes_to_event}m</span>}
        </div>
      )}
      {calendar.event && <div className="cx-meta-faint mt-1">Current: {calendar.event.title}</div>}
    </div>
  );
};

const ScenarioBlock: React.FC<{ type: 'bullish' | 'bearish'; conditions: string[]; }> = ({ type, conditions }) => {
  const variant = type === 'bullish' ? 'cx-panel cx-panel-success' : 'cx-panel cx-panel-danger';
  const icon = type === 'bullish' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />;
  return (
    <div className={variant}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="cx-eyebrow">{type === 'bullish' ? 'Bullish Scenario' : 'Bearish Scenario'}</span>
      </div>
      <p className="cx-meta mb-2">
        {type === 'bullish' ? 'What must happen before considering a buy:' : 'What must happen before considering a sell:'}
      </p>
      <ul className="space-y-1">
        {conditions.map((condition, i) => (
          <li key={i} className="flex items-start gap-2 cx-meta">
            <ChevronRight className="h-3 w-3 mt-0.5 flex-shrink-0 cx-text-faint" />
            {condition}
          </li>
        ))}
        {conditions.length === 0 && <li className="cx-meta-faint italic">No specific conditions defined</li>}
      </ul>
    </div>
  );
};

const PrimarySetup: React.FC<{ analysis?: CryptoAnalysis | null }> = ({ analysis }) => {
  const plan = analysis?.trade_plan;
  if (!plan) {
    return (
      <div className="cx-card">
        <div className="cx-eyebrow mb-3">Primary Setup</div>
        <p className="cx-meta">No trade plan available</p>
      </div>
    );
  }

  const riskDistance = plan.risk_percent_of_price != null
    ? `${plan.risk_percent_of_price.toFixed(2)}%`
    : plan.risk_distance != null
      ? `${plan.risk_distance.toFixed(4)}%`
      : '—';
  const rr = plan.net_available_rr ?? plan.available_rr ?? 0;
  const rrClass = rr >= 2 ? 'cx-pill cx-pill-success' : rr >= 1 ? 'cx-pill cx-pill-warning' : 'cx-pill cx-pill-danger';

  return (
    <div className="cx-card-strong">
      <div className="cx-eyebrow mb-4">Primary Setup</div>
      <div className="grid grid-cols-2 gap-3">
        <div><div className="cx-meta-faint">Entry Zone</div><div className="cx-mono text-base font-bold">{formatPrice(plan.entry)}</div></div>
        <div><div className="cx-meta-faint">Invalidation</div><div className="cx-mono text-base font-bold" style={{ color: 'var(--cx-status-danger-fg)' }}>{formatPrice(plan.invalidation)}</div></div>
        <div><div className="cx-meta-faint">Stop Loss</div><div className="cx-mono text-base font-bold" style={{ color: 'var(--cx-status-danger-fg)' }}>{formatPrice(plan.stop)}</div></div>
        <div><div className="cx-meta-faint">Risk Distance</div><div className="cx-mono text-base font-bold">{riskDistance}</div></div>
      </div>
      <div className="mt-4 cx-border-t pt-4">
        <div className="cx-eyebrow mb-2">Targets</div>
        <div className="space-y-2">
          {plan.targets?.slice(0, 3).map((target, i) => (
            <div key={i} className="flex items-center justify-between cx-bg-elev px-3 py-2" style={{ borderRadius: 'var(--cx-radius-md)' }}>
              <span className="cx-pill cx-pill-info">{target.label}</span>
              <span className="cx-mono cx-mono">{formatPrice(target.price)}</span>
              <span className="cx-meta-faint">{target.r_multiple?.toFixed(1)}R</span>
            </div>
          ))}
          {(!plan.targets || plan.targets.length === 0) && <div className="cx-meta-faint">No targets defined</div>}
        </div>
      </div>
      <div className="mt-4 cx-border-t pt-4 flex items-center justify-between gap-4">
        <div><div className="cx-meta-faint">Risk:Reward</div><div className={rrClass}>{rr > 0 ? `${rr.toFixed(2)}R` : '—'}</div></div>
        <div><div className="cx-meta-faint">Account Risk</div><div className="font-black cx-text">{Number(plan.account_risk_percent || 0).toFixed(2)}%</div></div>
        {plan.atr != null && <div><div className="cx-meta-faint">ATR</div><div className="cx-mono text-base font-bold">{plan.atr.toFixed(5)}</div></div>}
      </div>
    </div>
  );
};

const ReadinessChecklist: React.FC<{ analysis?: CryptoAnalysis | null; direction?: 'BUY' | 'SELL' | 'NEUTRAL' }> = ({ analysis, direction }) => {
  const timing = analysis?.trade_timing;
  const plan = analysis?.trade_plan;
  const calendar = analysis?.economic_calendar;
  const readiness = analysis?.decision_quality?.execution_readiness;

  const checks: ReadinessCheck[] = [
    { id: 'timing', label: 'Timing confirmed', passed: timing?.status === 'READY', detail: timing?.status === 'READY' ? 'Entry timing is favorable' : timing?.wait_for?.[0]?.replace(/_/g, ' ') || timing?.avoid_reasons?.[0] },
    { id: 'direction', label: `${direction} direction aligned`, passed: analysis?.direction === direction && direction !== 'NEUTRAL', detail: `Market bias: ${analysis?.direction || 'unknown'}` },
    { id: 'calendar', label: 'Calendar clear', passed: calendar?.status === 'CLEAR', detail: calendar?.next_event?.title || `Status: ${calendar?.status || 'unavailable'}` },
    { id: 'level', label: 'At key level', passed: timing?.location_ready === true, detail: timing?.nearest_sr ? `Near ${formatPrice(timing.nearest_sr.price)}` : 'Not at significant level' },
    { id: 'score', label: 'Confluence sufficient', passed: (analysis?.total_score || 0) >= 60, detail: `Score: ${analysis?.total_score || 0}/100` },
    { id: 'plan', label: 'Trade plan valid', passed: plan?.status === 'STRONG' || plan?.status === 'VALID', detail: plan?.status || 'No plan' },
  ];

  return (
    <div className="cx-card">
      <div className="flex items-center justify-between mb-3">
        <div className="cx-eyebrow">Readiness Checklist</div>
        <div className="text-base font-black" style={{ color: 'var(--cx-status-success-fg)' }}>{readiness ?? 0}% ready</div>
      </div>
      <div className="cx-progress mb-4">
        <div className="cx-progress-bar" style={{ width: `${readiness ?? 0}%` }} />
      </div>
      <div className="space-y-2">
        {checks.map((check) => (
          <div key={check.id} className="flex items-start gap-2">
            {check.passed
              ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--cx-status-success-fg)' }} />
              : <XCircle className="h-4 w-4 flex-shrink-0 cx-text-faint" />}
            <div className="min-w-0 flex-1">
              <div className={`text-sm font-medium ${check.passed ? 'cx-text' : 'cx-text-muted'}`}>{check.label}</div>
              {check.detail && <div className="cx-meta-faint truncate">{check.detail}</div>}
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

  const missing: { condition: string; detail: string }[] = [];
  if (timing?.wait_for?.length) timing.wait_for.forEach((w) => missing.push({ condition: w.replace(/_/g, ' '), detail: 'Required before entry' }));
  if (plan?.blocking_reasons?.length) plan.blocking_reasons.forEach((b) => missing.push({ condition: b.message || b.code, detail: `Severity: ${b.severity}` }));
  if (timing?.status === 'AVOID' && timing.avoid_reasons?.length) timing.avoid_reasons.forEach((r) => missing.push({ condition: 'Avoid reason', detail: r }));

  if (missing.length === 0) {
    return (
      <div className="cx-panel cx-panel-success flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4" />
        <div>
          <div className="font-black">All conditions met</div>
          <div className="cx-meta-faint">Ready to execute when entry triggers</div>
        </div>
      </div>
    );
  }

  return (
    <div className="cx-panel cx-panel-warning">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        <span className="font-black">Missing conditions ({missing.length})</span>
      </div>
      <div className="mt-2 space-y-2">
        {missing.slice(0, 5).map((m, i) => (
          <div key={i} className="flex items-start gap-2 cx-meta">
            <ChevronRight className="h-3 w-3 mt-0.5 flex-shrink-0" />
            <div>
              <div className="cx-text">{m.condition}</div>
              <div className="cx-meta-faint">{m.detail}</div>
            </div>
          </div>
        ))}
        {missing.length > 5 && <div className="cx-meta-faint">+{missing.length - 5} more</div>}
      </div>
    </div>
  );
};

const PlainLanguageConclusion: React.FC<{ analysis?: CryptoAnalysis | null; readinessPct: number }> = ({ analysis, readinessPct }) => {
  const direction = analysis?.direction || 'NEUTRAL';
  const timing = analysis?.trade_timing;
  const plan = analysis?.trade_plan;
  const scenario = analysis?.scenarios?.primary;

  if (!analysis) {
    return (
      <div className="cx-card"><p className="cx-meta">Analysis data unavailable</p></div>
    );
  }

  let conclusion = '';
  let subtext = '';
  let variant: string;
  let icon: React.ReactNode;

  if (timing?.status === 'AVOID') {
    const avoidReason = timing.avoid_reasons?.[0] || 'unstable volatility or market conditions';
    conclusion = `Do not enter. ${avoidReason}.`;
    subtext = 'Wait for conditions to stabilize before considering this setup.';
    variant = 'cx-panel cx-panel-danger';
    icon = <Pause className="h-5 w-5" />;
  } else if (timing?.status === 'WAIT') {
    const waitReason = timing.wait_for?.[0]?.replace(/_/g, ' ') || 'required confirmations';
    conclusion = `${direction === 'BUY' ? 'Bullish' : direction === 'SELL' ? 'Bearish' : 'Market'} structure exists, but do not enter. ${waitReason}.`;
    subtext = readinessPct >= 70 ? 'Setup is close to qualifying. Alert me when readiness reaches 100%.' : 'Multiple conditions still missing. Monitor for progress.';
    variant = 'cx-panel cx-panel-warning';
    icon = <Eye className="h-5 w-5" />;
  } else if (timing?.status === 'READY' && plan?.eligible) {
    conclusion = `${direction === 'BUY' ? 'Bullish' : direction === 'SELL' ? 'Bearish' : 'Market'} setup is live. Entry at ${formatPrice(plan.entry)}.`;
    subtext = plan.invalidation ? `Invalidate if price closes ${direction === 'BUY' ? 'below' : 'above'} ${formatPrice(plan.invalidation)}.` : 'Plan is active and eligible for execution.';
    variant = 'cx-panel cx-panel-success';
    icon = <Play className="h-5 w-5" />;
  } else {
    conclusion = scenario || 'No active signal. Monitor for setups forming.';
    subtext = 'The scanner will alert you when conditions become favorable.';
    variant = 'cx-panel';
    icon = <Eye className="h-5 w-5" />;
  }

  return (
    <div className={variant}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 cx-pill cx-pill-info p-2">{icon}</div>
        <div className="flex-1">
          <p className="text-base font-bold cx-text-strong">{conclusion}</p>
          <p className="mt-1 cx-meta">{subtext}</p>
        </div>
      </div>
    </div>
  );
};

const AlertButton: React.FC<{ symbol: string }> = ({ symbol }) => (
  <div className="cx-panel cx-panel-info flex items-center gap-2 text-sm font-bold">
    <Bell className="h-4 w-4" />
    Alert for {symbol} — coming soon
  </div>
);

const MarketAnalysis: React.FC = () => {
  const { pair: routePair } = useParams<{ pair: string }>();
  const navigate = useNavigate();
  const symbol = routePair?.toUpperCase() || 'BTCUSD';

  const [analysis, setAnalysis] = useState<CryptoAnalysis | null>(null);
  const [calendar, setCalendar] = useState<CalendarGateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [candleTime, setCandleTime] = useState<Date | null>(null);
  const [pairs, setPairs] = useState<string[]>([]);
  const loadIdRef = useRef(0);

  useEffect(() => {
    bwtsApi.pairs().then(({ pairs: p }) => setPairs(p)).catch(() => setPairs([]));
  }, []);

  const handleSymbolChange = (e: React.ChangeEvent<HTMLSelectElement>) => navigate(`/analysis/${e.target.value}`);

  const load = useCallback(async () => {
    const currentLoadId = ++loadIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const [analysisData, calendarData] = await Promise.all([
        bwtsApi.cryptoAnalysis(symbol),
        bwtsApi.calendarStatus(symbol).catch(() => null),
      ]);
      if (currentLoadId !== loadIdRef.current) return;
      setAnalysis(analysisData);
      setCalendar(calendarData);
      setLastUpdated(new Date());
      setRefreshFailed(false);
      if (analysisData.data_quality?.closed_bar_time) setCandleTime(new Date(analysisData.data_quality.closed_bar_time * 1000));
    } catch (e: any) {
      if (currentLoadId === loadIdRef.current) {
        setError(e?.message || 'Failed to load analysis');
        setRefreshFailed(true);
      }
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

  const readinessPct = analysis?.decision_quality?.execution_readiness ?? 0;

  const bullishConditions = analysis?.scenarios?.primary
    ? [`Price confirms ${analysis.scenarios.primary}`, '1H candle closes in direction', 'Entry zone reaches price']
    : [];
  const bearishConditions = analysis?.scenarios?.primary
    ? [`Bearish scenario: ${analysis.scenarios.primary}`, 'Structure confirmation on lower timeframes', 'Invalidation holds']
    : [];

  if (loading && !analysis) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 cx-text-muted">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span>Loading market analysis...</span>
        </div>
      </div>
    );
  }

  if (error && !analysis) {
    return (
      <div className="cx-panel cx-panel-danger">
        <div className="flex items-center gap-3" style={{ color: 'var(--cx-status-danger-fg)' }}>
          <AlertCircle className="h-5 w-5" />
          <span className="font-bold">{error}</span>
        </div>
        <button onClick={load} className="cx-btn cx-btn-secondary mt-4">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-8">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <select value={symbol} onChange={handleSymbolChange} className="cx-input px-3 py-2 text-xl font-black">
              {pairs.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <DirectionBadge direction={direction} />
            <StatusBadge status={analysis?.trade_plan?.status || analysis?.trade_timing?.status || 'WAIT'} />
          </div>
          <p className="cx-meta mt-1">
            Market analysis{refreshFailed ? ' · Refresh failed' : candleTime ? ` · Data from ${candleTime.toLocaleTimeString()}` : lastUpdated ? ` · Updated ${lastUpdated.toLocaleTimeString()}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/tradingview?symbol=${symbol}`} className="cx-btn cx-btn-secondary">
            <Crosshair className="h-4 w-4" /> View chart
          </Link>
          <button onClick={load} disabled={loading} className="cx-btn cx-btn-secondary disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <MetricBar label="Market Bias" value={analysis?.decision_quality?.market_bias_confidence ?? analysis?.market_context?.alignment_score ?? 0} description={`Direction: ${direction}`} accent={direction === 'BUY' ? 'emerald' : direction === 'SELL' ? 'rose' : 'violet'} />
        <MetricBar label="Setup Quality" value={analysis?.decision_quality?.setup_quality ?? analysis?.confluence_score ?? analysis?.total_score ?? 0} description={`${analysis?.confidence_tier || 'developing'} evidence`} accent="cyan" />
        <MetricBar label="Execution Readiness" value={readinessPct} description={timing?.status === 'READY' ? 'Ready to enter' : timing?.status === 'AVOID' ? 'Avoid entry' : 'Waiting for conditions'} accent={timing?.status === 'READY' ? 'emerald' : timing?.status === 'AVOID' ? 'rose' : 'amber'} />
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
        <ScenarioBlock type="bullish" conditions={bullishConditions} />
        <ScenarioBlock type="bearish" conditions={bearishConditions} />
      </section>

      <PrimarySetup analysis={analysis} />

      <section className="flex flex-wrap items-center gap-3">
        <AlertButton symbol={symbol} />
        {analysis?.trade_plan?.triggers?.slice(0, 2).map((trigger, i) => (
          <div key={i} className="cx-panel cx-panel-info flex items-center gap-2 text-xs">
            <Volume2 className="h-3.5 w-3.5" />
            <span>{trigger.humanReadable || trigger.type}</span>
          </div>
        ))}
      </section>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1 cx-meta-faint">
        <span>Decision support only — not financial advice.</span>
        {analysis?.version && <span>Engine V{analysis.version}</span>}
        {lastUpdated && <span>Analysis {lastUpdated.toLocaleString()}</span>}
      </div>
    </div>
  );
};

export default MarketAnalysis;
