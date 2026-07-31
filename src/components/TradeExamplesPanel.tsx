import React, { useState } from 'react';
import { ChevronDown, BookOpen, TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';

interface TradeExample {
  id: string;
  title: string;
  description: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  stopLoss: number;
  target1: number;
  target2?: number;
  rr: number;
  winRate: number;
  accuracy: string;
  setup: string[];
}

const EXAMPLE_SETUPS: TradeExample[] = [
  {
    id: 'harmonic-butterfly',
    title: 'Harmonic Butterfly Pattern',
    description: 'Classic harmonic pattern with PRZ completion for high-probability entries',
    direction: 'BUY',
    entry: 1.0950,
    stopLoss: 1.0920,
    target1: 1.1010,
    target2: 1.1045,
    rr: 2.5,
    winRate: 68,
    accuracy: 'HIGH',
    setup: ['Completed D point', 'Price retesting entry zone', 'Volume confirmation', 'Harmonic PRZ validated'],
  },
  {
    id: 'trend-continuation',
    title: 'Trend Continuation on Resistance',
    description: 'Strong uptrend with pullback to support, entry after breakout confirmation',
    direction: 'BUY',
    entry: 45320,
    stopLoss: 45100,
    target1: 45600,
    target2: 45850,
    rr: 1.8,
    winRate: 72,
    accuracy: 'VERY_HIGH',
    setup: ['Higher lows confirmed', 'Pullback to moving average', 'Volume increase on bounce', 'ADR less than 50%'],
  },
  {
    id: 'breakout-reversal',
    title: 'Breakout from Consolidation',
    description: 'Price breaks out of tight consolidation zone with volume surge',
    direction: 'SELL',
    entry: 2.1450,
    stopLoss: 2.1520,
    target1: 2.1350,
    target2: 2.1200,
    rr: 2.2,
    winRate: 64,
    accuracy: 'MEDIUM_HIGH',
    setup: ['Consolidation zone identified', 'Lower highs and lower lows', 'Volume increased', 'Breakout confirmed'],
  },
  {
    id: 'fibonacci-pullback',
    title: 'Fibonacci Retracement Entry',
    description: 'Entry at 0.618 or 0.786 Fibonacci level with strong support',
    direction: 'BUY',
    entry: 89.40,
    stopLoss: 88.80,
    target1: 90.50,
    target2: 91.80,
    rr: 1.6,
    winRate: 71,
    accuracy: 'HIGH',
    setup: ['Fib levels plotted correctly', 'Price holding at key level', 'Momentum divergence', 'Confluence with support'],
  },
];

interface TradeExamplesPanelProps {
  isExpanded: boolean;
  onToggle: () => void;
}

export default function TradeExamplesPanel({ isExpanded, onToggle }: TradeExamplesPanelProps) {
  const [selectedExample, setSelectedExample] = useState<TradeExample | null>(EXAMPLE_SETUPS[0]);

  const getAccuracyColor = (accuracy: string) => {
    switch (accuracy) {
      case 'VERY_HIGH':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
      case 'HIGH':
        return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20';
      case 'MEDIUM_HIGH':
        return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/20';
      default:
        return 'bg-gray-500/10 text-gray-300 border-gray-500/20';
    }
  };

  return (
    <div className="flex flex-col flex-1 bg-[#0a0e1a] text-white overflow-hidden">
      {/* Header */}
      <div
        onClick={onToggle}
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-white/[0.04] transition-colors border-b border-white/[0.08]"
      >
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="w-4 h-4 shrink-0 text-cyan-400" />
          <span className="text-sm font-bold tracking-wide text-slate-300">EXAMPLES</span>
        </div>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
        />
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="flex-1 overflow-hidden flex">
          {/* Examples List */}
          <div className="w-40 border-r border-white/[0.08] overflow-y-auto">
            {EXAMPLE_SETUPS.map((example) => (
              <button
                key={example.id}
                onClick={() => setSelectedExample(example)}
                className={`w-full text-left px-3 py-2 text-xs border-b border-white/[0.04] transition-colors ${
                  selectedExample?.id === example.id
                    ? 'bg-white/[0.08] text-white'
                    : 'text-slate-400 hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-center gap-1">
                  {example.direction === 'BUY' ? (
                    <TrendingUp className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <TrendingDown className="w-3 h-3 text-rose-400" />
                  )}
                  <span className="truncate">{example.title}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Example Details */}
          {selectedExample && (
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-xs">
              <div>
                <div className="text-slate-500 mb-1">Setup Type</div>
                <div className="text-sm font-semibold text-white">{selectedExample.title}</div>
              </div>

              <div>
                <div className="text-slate-500 mb-1">Description</div>
                <div className="text-xs text-slate-300">{selectedExample.description}</div>
              </div>

              {/* Direction Badge */}
              <div>
                <div className={`inline-flex items-center gap-1 px-2 py-1 rounded border ${
                  selectedExample.direction === 'BUY'
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                }`}>
                  {selectedExample.direction === 'BUY' ? (
                    <TrendingUp className="w-3 h-3" />
                  ) : (
                    <TrendingDown className="w-3 h-3" />
                  )}
                  <span className="font-bold">{selectedExample.direction}</span>
                </div>
              </div>

              {/* Metrics */}
              <div className="border-t border-white/[0.08] pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Entry</span>
                  <span className="font-mono font-semibold">{selectedExample.entry.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Stop Loss</span>
                  <span className="font-mono text-rose-300">{selectedExample.stopLoss.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Target 1</span>
                  <span className="font-mono text-cyan-300">{selectedExample.target1.toLocaleString()}</span>
                </div>
                {selectedExample.target2 && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Target 2</span>
                    <span className="font-mono text-cyan-300">{selectedExample.target2.toLocaleString()}</span>
                  </div>
                )}
              </div>

              {/* R/R and Win Rate */}
              <div className="border-t border-white/[0.08] pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Risk/Reward</span>
                  <span className="font-mono font-bold text-emerald-300">{selectedExample.rr}:1</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Historical Win Rate</span>
                  <span className="font-mono font-bold">{selectedExample.winRate}%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Setup Accuracy</span>
                  <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${getAccuracyColor(selectedExample.accuracy)}`}>
                    {selectedExample.accuracy.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>

              {/* Setup Conditions */}
              <div className="border-t border-white/[0.08] pt-3">
                <div className="text-slate-500 mb-2">Setup Conditions</div>
                <ul className="space-y-1">
                  {selectedExample.setup.map((condition, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-slate-300">
                      <span className="text-emerald-400 mt-0.5">✓</span>
                      <span>{condition}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
