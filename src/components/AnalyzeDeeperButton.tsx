/**
 * AnalyzeDeeperButton — triggers the full multi-agent analysis for a symbol,
 * displaying the debate results in an expandable panel.
 */
import React, { useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { bwtsApi, type DebateResult } from '../services/bwtsApi';

interface AnalyzeDeeperButtonProps {
  symbol: string;
  direction: string;
}

const AnalyzeDeeperButton: React.FC<AnalyzeDeeperButtonProps> = ({ symbol, direction }) => {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [debate, setDebate] = useState<DebateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await bwtsApi.getDebate(symbol);
      setDebate(result);
      setExpanded(true);
    } catch {
      setError('Failed to load analysis');
    } finally {
      setLoading(false);
    }
  };

  const isBuy = direction === 'BUY';

  return (
    <div>
      <button
        onClick={handleAnalyze}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 text-white font-bold text-sm transition-all disabled:opacity-50"
      >
        <Sparkles className="w-4 h-4" />
        {loading ? 'Analyzing...' : expanded ? 'Collapse Analysis' : 'Analyze Deeper'}
        {!loading && (expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />)}
      </button>

      {error && (
        <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}

      {expanded && debate && (
        <div className="mt-4 bg-gray-800/80 rounded-2xl border border-gray-700/50 p-5 space-y-4">
          {/* Mode indicator */}
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className={`px-2 py-0.5 rounded ${
              debate.mode === 'ai' ? 'bg-violet-400/15 text-violet-400' :
              debate.mode === 'partial' ? 'bg-yellow-400/15 text-yellow-400' :
              'bg-gray-700/50 text-gray-400'
            }`}>
              {debate.mode === 'ai' ? 'AI-Powered' : debate.mode === 'partial' ? 'Partial AI' : 'Deterministic'}
            </span>
            {debate.elapsed_ms && <span>{(debate.elapsed_ms / 1000).toFixed(1)}s</span>}
          </div>

          {/* Bull case */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ArrowUpRight className="w-4 h-4 text-green-400" />
              <span className="text-sm font-bold text-green-400">Bull Case</span>
            </div>
            <div className="space-y-1.5 ml-6">
              {debate.bull_case.map((b, i) => (
                <div key={i} className="text-sm text-gray-300">
                  <span className="text-gray-500 font-medium">{b.agent}:</span> {b.argument}
                </div>
              ))}
              {debate.bull_case.length === 0 && (
                <div className="text-sm text-gray-500 italic">No bull arguments</div>
              )}
            </div>
          </div>

          {/* Bear case */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ArrowDownRight className="w-4 h-4 text-red-400" />
              <span className="text-sm font-bold text-red-400">Bear Case</span>
            </div>
            <div className="space-y-1.5 ml-6">
              {debate.bear_case.map((b, i) => (
                <div key={i} className="text-sm text-gray-300">
                  <span className="text-gray-500 font-medium">{b.agent}:</span> {b.argument}
                </div>
              ))}
              {debate.bear_case.length === 0 && (
                <div className="text-sm text-gray-500 italic">No bear arguments</div>
              )}
            </div>
          </div>

          {/* Chief Trader verdict */}
          {debate.chief_trader && (
            <div className="border-t border-gray-700/50 pt-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-bold text-white">Chief Trader Verdict</span>
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                  debate.chief_trader.verdict === 'BUY' ? 'bg-green-400/15 text-green-400' :
                  debate.chief_trader.verdict === 'SELL' ? 'bg-red-400/15 text-red-400' :
                  'bg-gray-700/50 text-gray-400'
                }`}>
                  {debate.chief_trader.verdict}
                </span>
              </div>
              <div className="text-sm text-gray-300">{debate.chief_trader.summary}</div>
              {debate.chief_trader.narrative && (
                <div className="mt-2 text-xs text-gray-500 italic">{debate.chief_trader.narrative}</div>
              )}
            </div>
          )}

          {/* Deterministic consensus */}
          {debate.deterministic && (
            <div className="border-t border-gray-700/50 pt-3">
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Deterministic Agent Consensus</div>
              <div className="flex flex-wrap gap-2">
                {debate.deterministic.agents?.map((a, i) => (
                  <div key={i} className={`px-2 py-1 rounded text-xs ${
                    a.vote === 'BUY' ? 'bg-green-400/10 text-green-400' :
                    a.vote === 'SELL' ? 'bg-red-400/10 text-red-400' :
                    'bg-gray-700/50 text-gray-400'
                  }`}>
                    {a.label}: {a.vote} ({Math.round(a.confidence)}%)
                  </div>
                ))}
              </div>
              {debate.note && <div className="mt-2 text-xs text-gray-500">{debate.note}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AnalyzeDeeperButton;
