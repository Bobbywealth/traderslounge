/**
 * EMA Legend
 * Displays current EMA values near the chart legend.
 */
import React from 'react';
import type { EmaLegendItem, EmaTrendState } from '../indicators/ema/types';

interface EmaLegendProps {
  items: EmaLegendItem[];
  trendBadge?: {
    state: EmaTrendState;
    score: number;
    label: string;
  };
  hoveredValues?: Record<number, number> | null;
}

/**
 * EMA Legend Component
 * Shows current EMA values with color coding and trend badge.
 */
export const EmaLegend: React.FC<EmaLegendProps> = ({
  items,
  trendBadge,
  hoveredValues,
}) => {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* EMA Values */}
      {items.map((item) => {
        const displayValue = hoveredValues?.[item.period] ?? item.value;
        const isHovered = hoveredValues !== null && hoveredValues !== undefined;
        
        return (
          <div
            key={item.period}
            className="flex items-center gap-2"
          >
            <div
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
              EMA {item.period}
            </span>
            <span className="font-mono text-xs tabular-nums text-white">
              {formatPrice(displayValue)}
            </span>
            {!isHovered && item.change !== 0 && (
              <span
                className={`text-[10px] font-bold ${
                  item.change > 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {item.change > 0 ? '+' : ''}{item.changePercent.toFixed(2)}%
              </span>
            )}
          </div>
        );
      })}

      {/* Trend Badge */}
      {trendBadge && (
        <div className="ml-2 border-l border-white/10 pl-3">
          <TrendBadge
            state={trendBadge.state}
            score={trendBadge.score}
            label={trendBadge.label}
          />
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Trend Badge Component
// ============================================================================

interface TrendBadgeProps {
  state: EmaTrendState;
  score: number;
  label: string;
}

const TrendBadge: React.FC<TrendBadgeProps> = ({ state, score, label }) => {
  const getBadgeClasses = (): string => {
    switch (state) {
      case 'STRONG_BULLISH':
        return 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300';
      case 'BULLISH':
        return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-400';
      case 'NEUTRAL':
        return 'border-gray-400/30 bg-gray-500/10 text-gray-400';
      case 'BEARISH':
        return 'border-rose-400/30 bg-rose-500/10 text-rose-400';
      case 'STRONG_BEARISH':
        return 'border-rose-400/40 bg-rose-500/15 text-rose-300';
      case 'COMPRESSION':
        return 'border-amber-400/30 bg-amber-500/10 text-amber-400';
      default:
        return 'border-gray-400/30 bg-gray-500/10 text-gray-400';
    }
  };

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-lg border px-2 py-1 text-[10px] font-black uppercase tracking-wider ${getBadgeClasses()}`}
    >
      <span>EMA TREND:</span>
      <span>{label}</span>
      <span className="opacity-60">({score > 0 ? '+' : ''}{score})</span>
    </div>
  );
};

// ============================================================================
// Hover Values Display
// ============================================================================

interface EmaHoverValuesProps {
  values: Record<number, number> | null;
  periods: number[];
  colors: Record<number, string>;
}

/**
 * Display EMA values for hovered candle.
 */
export const EmaHoverValues: React.FC<EmaHoverValuesProps> = ({
  values,
  periods,
  colors,
}) => {
  if (!values) return null;

  return (
    <div className="rounded-lg border border-white/10 bg-[#0d1020]/95 p-2 shadow-xl">
      <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-gray-400">
        EMA Values at Cursor
      </div>
      <div className="space-y-1">
        {periods.map((period) => {
          const value = values[period];
          if (value === undefined || !Number.isFinite(value)) return null;
          
          return (
            <div key={period} className="flex items-center gap-2">
              <div
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: colors[period] || '#9CA3AF' }}
              />
              <span className="text-[10px] text-gray-400">EMA {period}</span>
              <span className="font-mono text-xs text-white">
                {formatPrice(value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// Helper Functions
// ============================================================================

const formatPrice = (price: number): string => {
  if (!Number.isFinite(price)) return '--';
  
  // Format based on price magnitude
  if (price >= 1000) {
    return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } else if (price >= 1) {
    return price.toFixed(4);
  } else {
    return price.toFixed(6);
  }
};

export default EmaLegend;
