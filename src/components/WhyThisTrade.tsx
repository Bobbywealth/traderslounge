/**
 * WhyThisTrade — Concise bullet-point breakdown of why this trade makes sense,
 * with supporting confluences, alerts, and historical memory insights.
 */
import React from 'react';
import { Check, AlertTriangle, Brain, Shield, TrendingUp, TrendingDown, Clock, BarChart3, Zap } from 'lucide-react';
import type { TradingInsight } from '../services/bwtsApi';

interface Confluence {
  label: string;
  available: boolean;
  vote: string;
  confidence: number;
  reason: string;
}

interface WhyThisTradeProps {
  direction: string;
  confluences: Confluence[];
  vetoReasons: string[];
  memories: TradingInsight[];
  newsVetoes: Array<{ title: string; impact: string; minutes_until: number }>;
}

const voteIcons: Record<string, React.ReactNode> = {
  BUY: <TrendingUp className="w-3.5 h-3.5" />,
  SELL: <TrendingDown className="w-3.5 h-3.5" />,
  NEUTRAL: <Shield className="w-3.5 h-3.5" />,
};

const strengthColors: Record<string, string> = {
  high: 'text-green-400',
  medium: 'text-yellow-400',
  low: 'text-gray-400',
};

const WhyThisTrade: React.FC<WhyThisTradeProps> = ({
  direction, confluences, vetoReasons, memories, newsVetoes,
}) => {
  const isBuy = direction === 'BUY';

  return (
    <div className="bg-gray-800/60 rounded-2xl border border-gray-700/50 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Brain className="w-5 h-5 text-cyan-400" />
        <h3 className="text-base font-bold text-white">Why This Trade</h3>
      </div>

      {/* Confluence bullets */}
      <div className="space-y-2 mb-4">
        {confluences.filter(c => c.available).map((c, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className={`mt-0.5 flex-shrink-0 ${
              c.vote === direction ? 'text-green-400' :
              c.vote === 'NEUTRAL' ? 'text-gray-500' : 'text-red-400'
            }`}>
              {c.vote === direction ? <Check className="w-4 h-4" /> : voteIcons[c.vote] || <Check className="w-4 h-4" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-white font-medium">{c.label}</div>
              <div className="text-xs text-gray-500 truncate">{c.reason}</div>
            </div>
            <div className="text-xs text-gray-600 flex-shrink-0">{Math.round(c.confidence)}%</div>
          </div>
        ))}
      </div>

      {/* Vetoes / warnings */}
      {vetoReasons.length > 0 && (
        <div className="border-t border-gray-700/50 pt-3 mb-3">
          {vetoReasons.map((v, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-yellow-400/90">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{v}</span>
            </div>
          ))}
        </div>
      )}

      {/* News vetoes */}
      {newsVetoes.length > 0 && (
        <div className="border-t border-gray-700/50 pt-3 mb-3">
          {newsVetoes.map((n, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <Clock className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
              <span className="text-amber-400 font-medium">
                {n.minutes_until > 60
                  ? `${Math.floor(n.minutes_until / 60)}h ${n.minutes_until % 60}m`
                  : `${n.minutes_until}m`}
              </span>
              <span className="text-gray-400 truncate">{n.title} ({n.impact})</span>
            </div>
          ))}
        </div>
      )}

      {/* Trading Memory insights */}
      {memories.length > 0 && (
        <div className="border-t border-gray-700/50 pt-3">
          <div className="flex items-center gap-1.5 mb-2">
            <BarChart3 className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-xs text-violet-400 font-semibold uppercase tracking-wider">Institutional Memory</span>
          </div>
          <div className="space-y-1.5">
            {memories.slice(0, 4).map((m, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <Zap className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${strengthColors[m.evidence_strength]}`} />
                <span className="text-gray-300">{m.observation}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default WhyThisTrade;
