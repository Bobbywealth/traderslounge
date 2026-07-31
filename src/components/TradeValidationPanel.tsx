import React from 'react';
import { AlertCircle, CheckCircle2, AlertTriangle, TrendingUp } from 'lucide-react';
import type { CryptoAnalysis } from '../services/bwtsApi';

interface ValidationFactor {
  label: string;
  status: 'confirmed' | 'warning' | 'blocked';
  value: string | number;
  description?: string;
}

interface TradeValidationPanelProps {
  analysis: CryptoAnalysis | null;
  currentPrice: number;
}

export default function TradeValidationPanel({ analysis, currentPrice }: TradeValidationPanelProps) {
  if (!analysis) return null;

  const factors: ValidationFactor[] = [];

  // V2 Score
  const scoreStatus = analysis.total_score >= 70 ? 'confirmed' : analysis.total_score >= 50 ? 'warning' : 'blocked';
  factors.push({
    label: 'V2 Analysis Score',
    status: scoreStatus,
    value: `${analysis.total_score}/100`,
    description: scoreStatus === 'confirmed' ? 'Strong signal' : scoreStatus === 'warning' ? 'Moderate signal' : 'Weak signal',
  });

  // Direction Stability
  if (analysis.direction_stability) {
    const stabStatus =
      analysis.direction_stability.lifecycle === 'READY' || analysis.direction_stability.lifecycle === 'CONFIRMED'
        ? 'confirmed'
        : analysis.direction_stability.lifecycle === 'INVALIDATED'
          ? 'blocked'
          : 'warning';
    factors.push({
      label: 'Direction Stability',
      status: stabStatus,
      value: analysis.direction_stability.lifecycle,
      description: analysis.direction_stability.reason,
    });
  }

  // Trade Timing
  if (analysis.trade_timing) {
    const timingStatus = analysis.trade_timing.status === 'READY' ? 'confirmed' : analysis.trade_timing.status === 'AVOID' ? 'blocked' : 'warning';
    factors.push({
      label: 'Trade Timing',
      status: timingStatus,
      value: analysis.trade_timing.status,
      description:
        analysis.trade_timing.status === 'READY'
          ? 'Optimal entry time'
          : analysis.trade_timing.status === 'AVOID'
            ? analysis.trade_timing.avoid_reasons?.[0]?.replace(/_/g, ' ')
            : analysis.trade_timing.wait_for?.[0]?.replace(/_/g, ' '),
    });
  }

  // Decision Quality Factors
  if (analysis.decision_quality) {
    const biasStatus = analysis.decision_quality.market_bias_confidence >= 70 ? 'confirmed' : analysis.decision_quality.market_bias_confidence >= 50 ? 'warning' : 'blocked';
    factors.push({
      label: 'Market Bias Confidence',
      status: biasStatus,
      value: `${analysis.decision_quality.market_bias_confidence}%`,
    });

    const setupStatus = analysis.decision_quality.setup_quality >= 70 ? 'confirmed' : analysis.decision_quality.setup_quality >= 50 ? 'warning' : 'blocked';
    factors.push({
      label: 'Setup Quality',
      status: setupStatus,
      value: `${analysis.decision_quality.setup_quality}%`,
    });

    const executionStatus = analysis.decision_quality.execution_readiness >= 70 ? 'confirmed' : analysis.decision_quality.execution_readiness >= 50 ? 'warning' : 'blocked';
    factors.push({
      label: 'Execution Readiness',
      status: executionStatus,
      value: `${analysis.decision_quality.execution_readiness}%`,
    });
  }

  // Market Context Alignment
  if (analysis.market_context) {
    const alignmentStatus = analysis.market_context.alignment_score >= 70 ? 'confirmed' : analysis.market_context.alignment_score >= 50 ? 'warning' : 'blocked';
    factors.push({
      label: 'Timeframe Alignment',
      status: alignmentStatus,
      value: `${analysis.market_context.alignment_score}%`,
      description: 'Confluence across M1, W1, MN1 trends',
    });
  }

  // Category Breakdown
  if (analysis.category_breakdown) {
    const breakdown = analysis.category_breakdown;
    const totalScore = breakdown.structure + breakdown.volume + breakdown.momentum + breakdown.liquidity;
    const maxScore = 20 + 10 + 10 + 15; // Max values for each
    const breakdownPercent = Math.round((totalScore / maxScore) * 100);
    factors.push({
      label: 'Category Breakdown',
      status: breakdownPercent >= 70 ? 'confirmed' : breakdownPercent >= 50 ? 'warning' : 'blocked',
      value: `${breakdown.structure}/20 + ${breakdown.volume}/10 + ${breakdown.momentum}/10 + ${breakdown.liquidity}/15`,
      description: `Structure, Volume, Momentum, Liquidity`,
    });
  }

  const getIcon = (status: 'confirmed' | 'warning' | 'blocked') => {
    switch (status) {
      case 'confirmed':
        return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-amber-400" />;
      case 'blocked':
        return <AlertCircle className="w-4 h-4 text-rose-400" />;
    }
  };

  const confirmedCount = factors.filter((f) => f.status === 'confirmed').length;
  const warningCount = factors.filter((f) => f.status === 'warning').length;
  const blockedCount = factors.filter((f) => f.status === 'blocked').length;
  const accuracyPercent = Math.round((confirmedCount / factors.length) * 100);

  return (
    <div className="rounded-lg border border-white/[0.08] bg-gray-800/50 px-4 py-3 space-y-3">
      {/* Overall Accuracy */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-slate-400">VALIDATION ACCURACY</span>
        <div className="flex items-center gap-2">
          <div className="w-24 h-2 bg-white/[0.08] rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${
                accuracyPercent >= 70
                  ? 'bg-emerald-500'
                  : accuracyPercent >= 50
                    ? 'bg-amber-500'
                    : 'bg-rose-500'
              }`}
              style={{ width: `${Math.min(accuracyPercent, 100)}%` }}
            />
          </div>
          <span className="font-mono text-xs font-bold text-slate-300 w-8 text-right">{accuracyPercent}%</span>
        </div>
      </div>

      {/* Summary */}
      <div className="flex items-center gap-4 text-xs pt-2 border-t border-white/[0.08]">
        <div className="flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          <span className="text-slate-400">
            {confirmedCount} <span className="text-slate-500">confirmed</span>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <AlertTriangle className="w-3 h-3 text-amber-400" />
          <span className="text-slate-400">
            {warningCount} <span className="text-slate-500">warning</span>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <AlertCircle className="w-3 h-3 text-rose-400" />
          <span className="text-slate-400">
            {blockedCount} <span className="text-slate-500">blocked</span>
          </span>
        </div>
      </div>

      {/* Factors List */}
      <div className="space-y-2 text-xs pt-2 border-t border-white/[0.08]">
        {factors.map((factor, idx) => (
          <div key={idx} className="flex items-start gap-2">
            {getIcon(factor.status)}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="text-slate-400 text-[10px]">{factor.label}</span>
                <span className="font-mono text-slate-300 text-[11px] font-semibold">{factor.value}</span>
              </div>
              {factor.description && (
                <div className="text-slate-500 text-[9px] leading-tight">{factor.description}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Recommendation */}
      <div className={`mt-3 p-2 rounded border text-xs ${
        accuracyPercent >= 70
          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
          : accuracyPercent >= 50
            ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
            : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
      }`}>
        {accuracyPercent >= 70
          ? '✓ Setup validates well. Ready for entry consideration.'
          : accuracyPercent >= 50
            ? '⚠ Setup shows promise but has warning factors. Wait for confirmation.'
            : '✗ Setup has significant blockers. Avoid entry at this time.'}
      </div>
    </div>
  );
}
