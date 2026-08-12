/**
 * MemoryFeed — Trading Memory panel showing institutional-style insights
 * relevant to the current market context.
 */
import React from 'react';
import { Database, Zap, Clock, AlertTriangle, TrendingUp } from 'lucide-react';
import type { TradingInsight } from '../services/bwtsApi';

interface MemoryFeedProps {
  memories: TradingInsight[];
  symbol?: string;
}

const categoryIcons: Record<string, React.ReactNode> = {
  zone_rejection: <AlertTriangle className="w-4 h-4" />,
  news_impact: <Clock className="w-4 h-4" />,
  session_pattern: <TrendingUp className="w-4 h-4" />,
  setup_performance: <Zap className="w-4 h-4" />,
  annotation: <Database className="w-4 h-4" />,
  structural_observation: <Database className="w-4 h-4" />,
  macro_regime: <Database className="w-4 h-4" />,
};

const categoryColors: Record<string, string> = {
  zone_rejection: 'text-amber-400 bg-amber-400/10',
  news_impact: 'text-blue-400 bg-blue-400/10',
  session_pattern: 'text-violet-400 bg-violet-400/10',
  setup_performance: 'text-cyan-400 bg-cyan-400/10',
  annotation: 'text-gray-400 bg-gray-400/10',
  structural_observation: 'text-gray-400 bg-gray-400/10',
  macro_regime: 'text-gray-400 bg-gray-400/10',
};

const strengthDots: Record<string, string> = {
  high: 'bg-green-400',
  medium: 'bg-yellow-400',
  low: 'bg-gray-500',
};

const MemoryFeed: React.FC<MemoryFeedProps> = ({ memories, symbol }) => {
  const filtered = symbol
    ? memories.filter(m => m.symbol === symbol || m.symbol === null)
    : memories;

  return (
    <div className="bg-gray-800/60 rounded-2xl border border-gray-700/50 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Database className="w-5 h-5 text-violet-400" />
        <h3 className="text-base font-bold text-white">Trading Memory</h3>
        {filtered.length > 0 && (
          <span className="ml-auto text-xs text-gray-500">{filtered.length} insights</span>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          No memories yet. System learns as setups develop.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((m, i) => (
            <div key={m.id || i} className="flex items-start gap-3 p-3 bg-gray-700/30 rounded-xl">
              <div className={`flex-shrink-0 p-1.5 rounded-lg ${categoryColors[m.category] || 'text-gray-400 bg-gray-400/10'}`}>
                {categoryIcons[m.category] || <Database className="w-4 h-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-200 font-medium">{m.observation}</div>
                <div className="flex items-center gap-2 mt-1">
                  {m.symbol && <span className="text-xs text-gray-500">{m.symbol}</span>}
                  <span className={`w-1.5 h-1.5 rounded-full ${strengthDots[m.evidence_strength] || 'bg-gray-500'}`} />
                  <span className="text-xs text-gray-500">{m.evidence_count} observations</span>
                  <span className="text-xs text-gray-600">{m.confidence}% confidence</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MemoryFeed;
