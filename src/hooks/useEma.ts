/**
 * useEma Hook
 * Manages EMA state and integrates with the chart.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { 
  CandleData, 
  EmaConfig, 
  EmaResult, 
  EmaStateAnalysis, 
  EmaLegendItem, 
  EmaTrendState,
  CrossoverState,
  MtfAlignment,
  EmaAiData,
  EmaAlert 
} from '../indicators/ema/types';
import { calculateMultipleEmas, DEFAULT_EMA_CONFIGS } from '../indicators/ema/emaCalculator';
import { analyzeEmaState, calculateTrendScore } from '../indicators/ema/emaAnalyzer';
import { detectAllCrossovers } from '../indicators/ema/emaCrossover';
import { analyzeMtfAlignment } from '../indicators/ema/emaMultiTimeframe';
import { detectConfluenceZones, calculateConfluenceScore, detectEmaInteractions } from '../indicators/ema/emaConfluence';
import { generateEmaAlerts } from '../indicators/ema/emaAlerts';
import { constructEmaAiData, getEmaLegendData } from '../indicators/ema/emaAiIntegration';

interface UseEmaOptions {
  candles: CandleData[];
  configs?: EmaConfig[];
  onAlert?: (alerts: EmaAlert[]) => void;
}

interface UseEmaResult {
  // EMA calculations
  emaResults: Map<number, EmaResult>;
  
  // State analysis
  emaState: EmaStateAnalysis | null;
  trendScore: { score: number; explanation: string };
  
  // Crossover state
  crossoverState: CrossoverState;
  
  // Multi-timeframe alignment
  mtfAlignment: MtfAlignment;
  
  // Legend data
  legendItems: EmaLegendItem[];
  
  // Trend badge
  trendBadge: {
    state: EmaTrendState;
    score: number;
    label: string;
  };
  
  // AI integration data
  aiData: EmaAiData | null;
  
  // Alerts
  alerts: EmaAlert[];
  
  // Configuration
  configs: EmaConfig[];
  setConfigs: (configs: EmaConfig[]) => void;
  resetConfigs: () => void;
  
  // Hover values
  getEmaValuesAtCandle: (candleIndex: number) => Record<number, number>;
}

/**
 * Hook for managing EMA state and calculations.
 */
export const useEma = ({
  candles,
  configs: initialConfigs = DEFAULT_EMA_CONFIGS,
  onAlert,
}: UseEmaOptions): UseEmaResult => {
  const [configs, setConfigs] = useState<EmaConfig[]>(initialConfigs);
  const previousAlertsRef = useRef<EmaAlert[]>([]);
  
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
  
  // Detect crossovers
  const crossoverState = useMemo(() => {
    if (candles.length === 0 || emaResults.size === 0) {
      return {
        recentCrosses: [],
        lastGoldenCross: null,
        lastDeathCross: null,
        activeCrosses: [],
      };
    }
    return detectAllCrossovers(emaResults, candles);
  }, [candles, emaResults]);
  
  // Multi-timeframe alignment (simplified for now - would need multiple timeframe data)
  const mtfAlignment = useMemo(() => {
    return {
      states: [],
      overallAlignment: emaState?.stack || 'NEUTRAL',
      alignmentScore: trendScore.score,
      higherTfDominant: false,
    };
  }, [emaState, trendScore]);
  
  // Legend data
  const legendItems = useMemo(() => {
    return getEmaLegendData(emaResults, candles[candles.length - 1]?.close || 0);
  }, [emaResults, candles]);
  
  // Trend badge
  const trendBadge = useMemo(() => {
    const getTrendLabel = (state: EmaTrendState): string => {
      switch (state) {
        case 'STRONG_BULLISH': return 'STRONG BULLISH';
        case 'BULLISH': return 'BULLISH';
        case 'NEUTRAL': return 'NEUTRAL';
        case 'BEARISH': return 'BEARISH';
        case 'STRONG_BEARISH': return 'STRONG BEARISH';
        case 'COMPRESSION': return 'COMPRESSION';
        default: return 'NEUTRAL';
      }
    };
    
    return {
      state: emaState?.stack || 'NEUTRAL',
      score: trendScore.score,
      label: getTrendLabel(emaState?.stack || 'NEUTRAL'),
    };
  }, [emaState, trendScore]);
  
  // AI data
  const aiData = useMemo(() => {
    if (!emaState) return null;
    
    const currentPrice = candles[candles.length - 1]?.close || 0;
    const confluenceZones = detectConfluenceZones(currentPrice, emaResults);
    const confluenceScore = calculateConfluenceScore(confluenceZones, currentPrice);
    const interactions = detectEmaInteractions(candles, emaResults);
    
    return constructEmaAiData(
      candles,
      emaResults,
      emaState,
      crossoverState,
      mtfAlignment,
      confluenceScore,
      interactions
    );
  }, [candles, emaResults, emaState, crossoverState, mtfAlignment]);
  
  // Generate alerts
  const alerts = useMemo(() => {
    if (candles.length === 0 || emaResults.size === 0) return [];
    
    const newAlerts = generateEmaAlerts(
      candles,
      emaResults,
      crossoverState,
      mtfAlignment,
      emaState,
      previousAlertsRef.current,
      true // Confirm on close
    );
    
    if (newAlerts.length > 0) {
      previousAlertsRef.current = [...previousAlertsRef.current, ...newAlerts];
      onAlert?.(newAlerts);
    }
    
    return previousAlertsRef.current;
  }, [candles, emaResults, crossoverState, mtfAlignment, emaState, onAlert]);
  
  // Get EMA values at specific candle
  const getEmaValuesAtCandle = useCallback((candleIndex: number): Record<number, number> => {
    const values: Record<number, number> = {};
    
    for (const [period, result] of emaResults) {
      if (candleIndex < result.values.length && result.values[candleIndex].isValid) {
        values[period] = result.values[candleIndex].value;
      }
    }
    
    return values;
  }, [emaResults]);
  
  // Reset configs to defaults
  const resetConfigs = useCallback(() => {
    setConfigs(DEFAULT_EMA_CONFIGS);
  }, []);
  
  return {
    emaResults,
    emaState,
    trendScore,
    crossoverState,
    mtfAlignment,
    legendItems,
    trendBadge,
    aiData,
    alerts,
    configs,
    setConfigs,
    resetConfigs,
    getEmaValuesAtCandle,
  };
};

export default useEma;
