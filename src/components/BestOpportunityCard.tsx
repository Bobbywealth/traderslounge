/**
 * BestOpportunityCard — Hero card showing the best current trade opportunity
 * with confidence, status, risk, and R:R prominently displayed.
 */
import React from 'react';
import { ArrowUpRight, ArrowDownRight, Target, Shield, TrendingUp } from 'lucide-react';

interface BestOpportunityCardProps {
  symbol: string;
  direction: string;
  score: number;
  state: string;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  entryLow: number;
  entryHigh: number;
  expectedRr: number;
  marketRegime: string;
  newsState: string;
  dataQuality: string;
}

const getScoreColor = (score: number) => {
  if (score >= 80) return 'text-green-400';
  if (score >= 65) return 'text-cyan-400';
  if (score >= 50) return 'text-yellow-400';
  return 'text-gray-400';
};

const getStateBadge = (state: string) => {
  const s = state.toUpperCase();
  if (s === 'READY' || s === 'VALID' || s === 'STRONG') return 'bg-green-400/15 text-green-400 border-green-400/30';
  if (s === 'DEVELOPING') return 'bg-yellow-400/15 text-yellow-400 border-yellow-400/30';
  if (s === 'WAIT') return 'bg-gray-400/15 text-gray-400 border-gray-400/30';
  return 'bg-blue-400/15 text-blue-400 border-blue-400/30';
};

const BestOpportunityCard: React.FC<BestOpportunityCardProps> = ({
  symbol, direction, score, state, stopLoss, tp1, tp2, tp3,
  entryLow, entryHigh, expectedRr, marketRegime, newsState, dataQuality,
}) => {
  const isBuy = direction === 'BUY';
  const dirColor = isBuy ? 'text-green-400' : 'text-red-400';
  const dirBg = isBuy ? 'bg-green-400/10' : 'bg-red-400/10';
  const dirLabel = isBuy ? 'BUY' : 'SELL';

  return (
    <div className="bg-gray-800/80 rounded-2xl border border-gray-700/50 p-6 relative overflow-hidden">
      {/* Subtle gradient accent */}
      <div className={`absolute inset-0 opacity-5 ${isBuy ? 'bg-gradient-to-br from-green-400' : 'bg-gradient-to-br from-red-400'}`} />

      <div className="relative z-10">
        {/* Header row */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Best Opportunity</div>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold text-white">{symbol}</span>
              <span className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-sm font-bold ${dirBg} ${dirColor}`}>
                {isBuy ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                {dirLabel}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className={`text-4xl font-black ${getScoreColor(score)}`}>{score}</div>
            <div className="text-xs text-gray-500">/100</div>
          </div>
        </div>

        {/* Status row */}
        <div className="flex items-center gap-3 mb-5">
          <span className={`px-3 py-1 rounded-full text-xs font-bold border ${getStateBadge(state)}`}>
            {state.toUpperCase()}
          </span>
          <span className="text-sm text-gray-400">Risk: <span className="text-white font-semibold">{stopLoss > 0 ? `${((entryHigh - stopLoss) / entryHigh * 100).toFixed(1)}%` : 'N/A'}</span></span>
          <span className="text-sm text-gray-400">R:R: <span className="text-cyan-400 font-semibold">{expectedRr > 0 ? `1:${expectedRr.toFixed(1)}` : 'N/A'}</span></span>
        </div>

        {/* Price levels */}
        <div className="grid grid-cols-5 gap-2 mb-4">
          <div className="bg-gray-700/50 rounded-lg p-2 text-center">
            <div className="text-[10px] text-gray-500 uppercase">Stop</div>
            <div className="text-sm font-bold text-red-400">{stopLoss.toFixed(2)}</div>
          </div>
          <div className="bg-gray-700/50 rounded-lg p-2 text-center">
            <div className="text-[10px] text-gray-500 uppercase">Entry</div>
            <div className="text-sm font-bold text-white">{entryLow.toFixed(2)}-{entryHigh.toFixed(2)}</div>
          </div>
          <div className="bg-gray-700/50 rounded-lg p-2 text-center">
            <div className="text-[10px] text-gray-500 uppercase">TP1</div>
            <div className="text-sm font-bold text-green-400">{tp1.toFixed(2)}</div>
          </div>
          <div className="bg-gray-700/50 rounded-lg p-2 text-center">
            <div className="text-[10px] text-gray-500 uppercase">TP2</div>
            <div className="text-sm font-bold text-green-400">{tp2.toFixed(2)}</div>
          </div>
          <div className="bg-gray-700/50 rounded-lg p-2 text-center">
            <div className="text-[10px] text-gray-500 uppercase">TP3</div>
            <div className="text-sm font-bold text-green-400">{tp3.toFixed(2)}</div>
          </div>
        </div>

        {/* Meta tags */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-2 py-0.5 rounded bg-gray-700/50 text-xs text-gray-400">{marketRegime}</span>
          <span className="px-2 py-0.5 rounded bg-gray-700/50 text-xs text-gray-400">{dataQuality}</span>
          {newsState && newsState !== 'CLEAR' && (
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
              newsState === 'BLOCKED' ? 'bg-red-400/15 text-red-400' :
              newsState === 'CAUTION' ? 'bg-yellow-400/15 text-yellow-400' :
              'bg-gray-700/50 text-gray-400'
            }`}>
              {newsState}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default BestOpportunityCard;
