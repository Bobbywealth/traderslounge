import React from 'react';
import { ChevronDown, TrendingUp, TrendingDown, Target, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { CryptoAnalysis } from '../services/bwtsApi';

interface TradeSetupPanelProps {
  analysis: CryptoAnalysis | null;
  currentPrice: number;
  symbol: string;
  timeframe: string;
  isExpanded: boolean;
  onToggle: () => void;
}

export default function TradeSetupPanel({
  analysis,
  currentPrice,
  symbol,
  timeframe,
  isExpanded,
  onToggle,
}: TradeSetupPanelProps) {
  if (!analysis?.trade_plan) return null;

  const plan = analysis.trade_plan;
  const score = analysis.total_score;
  const direction = plan.direction;

  const formatPrice = (price: number | null | undefined) => {
    if (price == null || !Number.isFinite(price)) return '—';
    return Number(price).toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  const calculateRR = (entry: number, stop: number, target: number) => {
    if (!entry || !stop || !target) return 0;
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    return risk > 0 ? reward / risk : 0;
  };

  const rr = plan.entry && (plan.stop || plan.invalidation) && plan.targets?.[0]?.price
    ? calculateRR(plan.entry, plan.stop || plan.invalidation || 0, plan.targets[0].price)
    : 0;

  const distanceToEntry = plan.entry ? Math.abs(currentPrice - plan.entry) : 0;
  const entryPercent = plan.entry ? ((distanceToEntry / plan.entry) * 100).toFixed(2) : '0';

  return (
    <div className="flex flex-col flex-1 bg-[#0a0e1a] text-white overflow-hidden">
      {/* Header */}
      <div
        onClick={onToggle}
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-white/[0.04] transition-colors border-b border-white/[0.08]"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Target className="w-4 h-4 shrink-0 text-emerald-400" />
          <span className="text-sm font-bold tracking-wide text-slate-300">SETUP</span>
        </div>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-slate-500 transition-transform ${
            isExpanded ? 'rotate-180' : ''
          }`}
        />
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-sm">
          {/* Direction & Score */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Direction</span>
              <span
                className={`font-bold ${
                  direction === 'BUY'
                    ? 'text-emerald-300'
                    : direction === 'SELL'
                      ? 'text-rose-300'
                      : 'text-slate-400'
                }`}
              >
                {direction}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">V2 Score</span>
              <div className="flex items-center gap-2">
                <div className="w-16 h-1.5 bg-white/[0.08] rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      score >= 70
                        ? 'bg-emerald-500'
                        : score >= 50
                          ? 'bg-amber-500'
                          : 'bg-rose-500'
                    }`}
                    style={{ width: `${Math.min(score, 100)}%` }}
                  />
                </div>
                <span className="font-mono text-xs font-bold text-slate-300">{score}/100</span>
              </div>
            </div>
          </div>

          {/* Entry Levels */}
          <div className="border-t border-white/[0.08] pt-3 space-y-2">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Entry Levels</div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Entry Price</span>
                <span className={plan.entry ? 'font-mono text-slate-100' : 'text-slate-600'}>
                  {formatPrice(plan.entry)}
                </span>
              </div>
              {plan.entry && currentPrice > 0 && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Distance</span>
                  <span className="font-mono text-slate-300">
                    {formatPrice(distanceToEntry)} ({entryPercent}%)
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Risk Management */}
          <div className="border-t border-white/[0.08] pt-3 space-y-2">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Risk Management</div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Stop Loss</span>
                <span className="font-mono text-rose-300">{formatPrice(plan.stop || plan.invalidation)}</span>
              </div>
              {plan.entry && (plan.stop || plan.invalidation) && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Risk Distance</span>
                  <span className="font-mono text-slate-300">
                    {formatPrice(Math.abs(plan.entry - (plan.stop || plan.invalidation || 0)))}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Targets & R/R */}
          <div className="border-t border-white/[0.08] pt-3 space-y-2">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Targets</div>
            <div className="space-y-1.5">
              {plan.targets?.slice(0, 3).map((target, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">
                    {target.label || `T${idx + 1}`} {target.r_multiple && `(${target.r_multiple.toFixed(1)}R)`}
                  </span>
                  <span className="font-mono text-cyan-300">{formatPrice(target.price)}</span>
                </div>
              ))}
            </div>
            {rr > 0 && (
              <div className="mt-2 rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-1.5">
                <div className="text-xs font-bold text-emerald-300">
                  Risk/Reward: {rr.toFixed(2)}:1
                </div>
              </div>
            )}
          </div>

          {/* Status & Eligibility */}
          <div className="border-t border-white/[0.08] pt-3 space-y-2">
            <div className="flex items-center gap-2">
              {plan.eligible ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 text-amber-400" />
              )}
              <span className="text-xs font-bold text-slate-300">
                {plan.eligible ? 'READY FOR ENTRY' : 'AWAITING CONFIRMATION'}
              </span>
            </div>
          </div>

          {/* Analysis Breakdown */}
          {analysis.decision_quality && (
            <div className="border-t border-white/[0.08] pt-3 space-y-2">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Quality Metrics</div>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Bias Confidence</span>
                  <span className="font-mono">{analysis.decision_quality.market_bias_confidence}%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Setup Quality</span>
                  <span className="font-mono">{analysis.decision_quality.setup_quality}%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Execution Ready</span>
                  <span className="font-mono">{analysis.decision_quality.execution_readiness}%</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
