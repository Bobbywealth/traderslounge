/**
 * EMA Chart Overlay
 * Renders EMA lines on the candlestick chart with legend and trend badge.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import type { 
  EmaConfig, 
  EmaResult, 
  EmaTrendState, 
  EmaLegendItem 
} from '../indicators/ema/types';
import { calculateMultipleEmas, DEFAULT_EMA_CONFIGS } from '../indicators/ema/emaCalculator';
import { analyzeEmaState, calculateTrendScore } from '../indicators/ema/emaAnalyzer';
import type { CandleData } from '../indicators/ema/types';

interface EmaChartOverlayProps {
  chart: IChartApi | null;
  candles: CandleData[];
  configs?: EmaConfig[];
  onStateChange?: (state: {
    legendItems: EmaLegendItem[];
    trendBadge: { state: EmaTrendState; score: number; label: string };
  }) => void;
}

/**
 * EMA Chart Overlay Component
 * Manages EMA line series on the chart and provides state updates.
 */
export const EmaChartOverlay: React.FC<EmaChartOverlayProps> = ({
  chart,
  candles,
  configs = DEFAULT_EMA_CONFIGS,
  onStateChange,
}) => {
  const seriesRefs = useRef<Map<number, ISeriesApi<'Line'>>>(new Map());
  const previousDataLength = useRef(0);

  // Calculate EMAs
  const emaResults = useMemo(() => {
    if (candles.length === 0) return new Map<number, EmaResult>();
    
    const periods = configs.filter(c => c.visible).map(c => c.period);
    return calculateMultipleEmas(candles, periods, 'close');
  }, [candles, configs]);

  // Analyze EMA state
  const emaState = useMemo(() => {
    if (candles.length === 0 || emaResults.size === 0) return null;
    return analyzeEmaState(candles, emaResults);
  }, [candles, emaResults]);

  // Calculate trend score
  const trendScore = useMemo(() => {
    if (!emaState) return { score: 0, explanation: '' };
    const currentPrice = candles[candles.length - 1]?.close || 0;
    return calculateTrendScore(emaState, currentPrice);
  }, [emaState, candles]);

  // Create/update EMA series on chart
  useEffect(() => {
    if (!chart) return;

    // Remove old series
    for (const [period, series] of seriesRefs.current) {
      try {
        chart.removeSeries(series);
      } catch (e) {
        // Series might already be removed
      }
    }
    seriesRefs.current.clear();

    // Create new series for visible EMAs
    for (const config of configs) {
      if (!config.visible) continue;
      
      const result = emaResults.get(config.period);
      if (!result) continue;

      const series = chart.addSeries('Line' as any, {
        color: config.color,
        lineWidth: config.width as 1 | 2 | 3 | 4,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });

      // Set data
      const lineData = result.values
        .filter(v => v.isValid)
        .map(v => ({
          time: v.time as UTCTimestamp,
          value: v.value,
        }));

      if (lineData.length > 0) {
        series.setData(lineData);
      }

      seriesRefs.current.set(config.period, series);
    }
  }, [chart, emaResults, configs]);

  // Update series incrementally when new candles arrive
  useEffect(() => {
    if (!chart || candles.length === 0) return;

    // Only update if we have new data
    if (candles.length === previousDataLength.current) return;
    previousDataLength.current = candles.length;

    // Update each series with the latest point
    for (const [period, series] of seriesRefs.current) {
      const result = emaResults.get(period);
      if (!result) continue;

      const validValues = result.values.filter(v => v.isValid);
      if (validValues.length === 0) continue;

      const lastValue = validValues[validValues.length - 1];
      series.update({
        time: lastValue.time as UTCTimestamp,
        value: lastValue.value,
      });
    }
  }, [chart, candles, emaResults]);

  // Notify parent of state changes
  useEffect(() => {
    if (!onStateChange) return;

    const legendItems: EmaLegendItem[] = [];
    const currentPrice = candles[candles.length - 1]?.close || 0;

    for (const config of configs) {
      if (!config.visible) continue;
      
      const result = emaResults.get(config.period);
      if (!result) continue;

      const validValues = result.values.filter(v => v.isValid);
      if (validValues.length >= 2) {
        const currentValue = validValues[validValues.length - 1].value;
        const previousValue = validValues[validValues.length - 2].value;
        const change = currentValue - previousValue;
        const changePercent = previousValue !== 0 ? (change / previousValue) * 100 : 0;

        legendItems.push({
          period: config.period,
          value: currentValue,
          color: config.color,
          change,
          changePercent,
        });
      }
    }

    const trendLabel = getTrendLabel(emaState?.stack || 'NEUTRAL');

    onStateChange({
      legendItems,
      trendBadge: {
        state: emaState?.stack || 'NEUTRAL',
        score: trendScore.score,
        label: trendLabel,
      },
    });
  }, [emaResults, configs, candles, emaState, trendScore, onStateChange]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const [period, series] of seriesRefs.current) {
        try {
          // Series will be removed when chart is destroyed
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      seriesRefs.current.clear();
    };
  }, []);

  // This component doesn't render anything visible
  return null;
};

// ============================================================================
// Helper Functions
// ============================================================================

const getTrendLabel = (state: EmaTrendState): string => {
  switch (state) {
    case 'STRONG_BULLISH':
      return 'STRONG BULLISH';
    case 'BULLISH':
      return 'BULLISH';
    case 'NEUTRAL':
      return 'NEUTRAL';
    case 'BEARISH':
      return 'BEARISH';
    case 'STRONG_BEARISH':
      return 'STRONG BEARISH';
    case 'COMPRESSION':
      return 'COMPRESSION';
    default:
      return 'NEUTRAL';
  }
};

export default EmaChartOverlay;
