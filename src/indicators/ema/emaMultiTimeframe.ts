/**
 * EMA Multi-Timeframe Analyzer
 * Analyzes EMA conditions across multiple timeframes.
 * Higher timeframes carry more trend significance.
 */
import type { UTCTimestamp } from 'lightweight-charts';
import type { 
  CandleData, 
  EmaResult, 
  EmaTrendState, 
  MtfEmaState, 
  MtfAlignment, 
  Timeframe 
} from './types';
import { calculateEma } from './emaCalculator';
import { detectEmaStack, classifySlope } from './emaAnalyzer';

// ============================================================================
// Timeframe Weighting
// ============================================================================

/**
 * Timeframe weights for multi-timeframe analysis.
 * Higher timeframes carry more significance.
 */
const TIMEFRAME_WEIGHTS: Record<Timeframe, number> = {
  '5M': 0.05,
  '15M': 0.1,
  '30M': 0.15,
  '1H': 0.2,
  '4H': 0.25,
  '1D': 0.3,
  '1W': 0.4,
};

/**
 * Convert timeframe string to minutes for aggregation.
 */
export const timeframeToMinutes = (tf: Timeframe): number => {
  switch (tf) {
    case '5M': return 5;
    case '15M': return 15;
    case '30M': return 30;
    case '1H': return 60;
    case '4H': return 240;
    case '1D': return 1440;
    case '1W': return 10080;
    default: return 60;
  }
};

// ============================================================================
// Timeframe Aggregation
// ============================================================================

/**
 * Aggregate candles from a lower timeframe to a higher timeframe.
 * Ensures no lookahead bias by only using completed candles.
 */
export const aggregateCandles = (
  candles: CandleData[],
  sourceTimeframe: Timeframe,
  targetTimeframe: Timeframe
): CandleData[] => {
  const sourceMinutes = timeframeToMinutes(sourceTimeframe);
  const targetMinutes = timeframeToMinutes(targetTimeframe);
  
  if (targetMinutes <= sourceMinutes) {
    return candles; // No aggregation needed
  }
  
  const aggregated: CandleData[] = [];
  let currentGroup: CandleData[] = [];
  let groupStartTime: number | null = null;
  
  for (const candle of candles) {
    const candleTime = Number(candle.time) * 1000; // Convert to milliseconds
    const candleMinute = Math.floor(candleTime / (60 * 1000));
    
    // Determine which target candle this belongs to
    const targetCandleIndex = Math.floor(candleMinute / (targetMinutes / sourceMinutes));
    const targetStartTime = targetCandleIndex * targetMinutes * 60 * 1000;
    
    if (groupStartTime === null || targetStartTime !== groupStartTime) {
      // Start a new group
      if (currentGroup.length > 0) {
        // Aggregate the previous group
        const aggregatedCandle = aggregateGroup(currentGroup);
        if (aggregatedCandle) {
          aggregated.push(aggregatedCandle);
        }
      }
      currentGroup = [candle];
      groupStartTime = targetStartTime;
    } else {
      currentGroup.push(candle);
    }
  }
  
  // Don't forget the last group
  if (currentGroup.length > 0) {
    const aggregatedCandle = aggregateGroup(currentGroup);
    if (aggregatedCandle) {
      aggregated.push(aggregatedCandle);
    }
  }
  
  return aggregated;
};

/**
 * Aggregate a group of candles into a single candle.
 */
const aggregateGroup = (candles: CandleData[]): CandleData | null => {
  if (candles.length === 0) return null;
  
  return {
    time: candles[0].time,
    open: candles[0].open,
    high: Math.max(...candles.map(c => c.high)),
    low: Math.min(...candles.map(c => c.low)),
    close: candles[candles.length - 1].close,
    volume: candles.reduce((sum, c) => sum + (c.volume || 0), 0),
  };
};

// ============================================================================
// Single Timeframe EMA Analysis
// ============================================================================

/**
 * Analyze EMA state for a single timeframe.
 */
export const analyzeSingleTimeframe = (
  candles: CandleData[],
  timeframe: Timeframe
): MtfEmaState | null => {
  if (candles.length < 200) {
    // Need at least 200 candles for EMA 200
    return null;
  }
  
  // Calculate EMAs
  const ema9 = calculateEma(candles, 9, 'close');
  const ema21 = calculateEma(candles, 21, 'close');
  const ema50 = calculateEma(candles, 50, 'close');
  const ema200 = calculateEma(candles, 200, 'close');
  
  // Get latest values
  const getLatestValue = (result: EmaResult): number => {
    const validValues = result.values.filter(v => v.isValid);
    return validValues.length > 0 ? validValues[validValues.length - 1].value : NaN;
  };
  
  const ema9Value = getLatestValue(ema9);
  const ema21Value = getLatestValue(ema21);
  const ema50Value = getLatestValue(ema50);
  const ema200Value = getLatestValue(ema200);
  
  if (![ema9Value, ema21Value, ema50Value, ema200Value].every(Number.isFinite)) {
    return null;
  }
  
  const currentPrice = candles[candles.length - 1].close;
  
  // Detect stack
  const stack = detectEmaStack(ema9Value, ema21Value, ema50Value, ema200Value, currentPrice);
  
  // Calculate trend score (simplified for MTF)
  let trendScore = 0;
  if (stack === 'STRONG_BULLISH') trendScore = 80;
  else if (stack === 'BULLISH') trendScore = 40;
  else if (stack === 'NEUTRAL') trendScore = 0;
  else if (stack === 'BEARISH') trendScore = -40;
  else if (stack === 'STRONG_BEARISH') trendScore = -80;
  else if (stack === 'COMPRESSION') trendScore = 0;
  
  return {
    timeframe,
    stack,
    trendScore,
    timestamp: candles[candles.length - 1].time,
  };
};

// ============================================================================
// Multi-Timeframe Alignment Analysis
// ============================================================================

/**
 * Analyze EMA alignment across multiple timeframes.
 */
export const analyzeMtfAlignment = (
  timeframeData: Map<Timeframe, CandleData[]>
): MtfAlignment => {
  const states: MtfEmaState[] = [];
  
  // Analyze each timeframe
  for (const [timeframe, candles] of timeframeData) {
    const state = analyzeSingleTimeframe(candles, timeframe);
    if (state) {
      states.push(state);
    }
  }
  
  if (states.length === 0) {
    return {
      states: [],
      overallAlignment: 'NEUTRAL',
      alignmentScore: 0,
      higherTfDominant: false,
    };
  }
  
  // Calculate weighted alignment score
  let weightedScore = 0;
  let totalWeight = 0;
  
  for (const state of states) {
    const weight = TIMEFRAME_WEIGHTS[state.timeframe] || 0.1;
    weightedScore += state.trendScore * weight;
    totalWeight += weight;
  }
  
  const alignmentScore = totalWeight > 0 
    ? Math.round(weightedScore / totalWeight)
    : 0;
  
  // Determine overall alignment
  let overallAlignment: EmaTrendState;
  if (alignmentScore >= 60) {
    overallAlignment = 'BULLISH';
  } else if (alignmentScore >= 80) {
    overallAlignment = 'STRONG_BULLISH';
  } else if (alignmentScore <= -60) {
    overallAlignment = 'BEARISH';
  } else if (alignmentScore <= -80) {
    overallAlignment = 'STRONG_BEARISH';
  } else if (Math.abs(alignmentScore) < 20) {
    // Check if there's compression
    const hasCompression = states.some(s => s.stack === 'COMPRESSION');
    overallAlignment = hasCompression ? 'COMPRESSION' : 'NEUTRAL';
  } else {
    overallAlignment = 'NEUTRAL';
  }
  
  // Check if higher timeframes are dominant
  const higherTfStates = states.filter(s => 
    ['4H', '1D', '1W'].includes(s.timeframe)
  );
  const higherTfDominant = higherTfStates.length > 0 && 
    higherTfStates.every(s => s.trendScore > 0 || s.trendScore < 0);
  
  return {
    states,
    overallAlignment,
    alignmentScore,
    higherTfDominant,
  };
};

// ============================================================================
// Higher-Timeframe EMA Overlay
// ============================================================================

/**
 * Calculate higher-timeframe EMA values for display on lower-timeframe chart.
 * Prevents lookahead bias by only using completed candles.
 */
export const calculateHigherTimeframeEma = (
  lowerTimeframeCandles: CandleData[],
  sourceTimeframe: Timeframe,
  targetTimeframe: Timeframe,
  emaPeriod: number
): Array<{ time: UTCTimestamp; value: number }> => {
  // Aggregate to higher timeframe
  const aggregated = aggregateCandles(lowerTimeframeCandles, sourceTimeframe, targetTimeframe);
  
  if (aggregated.length < emaPeriod) {
    return [];
  }
  
  // Calculate EMA on higher timeframe
  const emaResult = calculateEma(aggregated, emaPeriod, 'close');
  
  // Map back to lower timeframe timestamps
  const result: Array<{ time: UTCTimestamp; value: number }> = [];
  
  let higherIdx = 0;
  for (const lowerCandle of lowerTimeframeCandles) {
    const lowerTime = Number(lowerCandle.time);
    
    // Find the corresponding higher timeframe candle
    while (higherIdx < aggregated.length - 1 && 
           Number(aggregated[higherIdx + 1].time) <= lowerTime) {
      higherIdx++;
    }
    
    if (higherIdx < emaResult.values.length && emaResult.values[higherIdx].isValid) {
      result.push({
        time: lowerCandle.time,
        value: emaResult.values[higherIdx].value,
      });
    }
  }
  
  return result;
};

// ============================================================================
// MTF Trend Classification
// ============================================================================

/**
 * Get trend classification for a single timeframe.
 */
export const getMtfTrend = (state: MtfEmaState): 'bullish' | 'bearish' | 'neutral' => {
  if (state.trendScore > 20) return 'bullish';
  if (state.trendScore < -20) return 'bearish';
  return 'neutral';
};

/**
 * Convert MTF alignment to a simple trend string for display.
 */
export const alignmentToTrendString = (alignment: MtfAlignment): string => {
  switch (alignment.overallAlignment) {
    case 'STRONG_BULLISH':
      return 'MULTI_TIMEFRAME_BULLISH';
    case 'BULLISH':
      return 'MULTI_TIMEFRAME_BULLISH';
    case 'STRONG_BEARISH':
      return 'MULTI_TIMEFRAME_BEARISH';
    case 'BEARISH':
      return 'MULTI_TIMEFRAME_BEARISH';
    case 'COMPRESSION':
      return 'MULTI_TIMEFRAME_COMPRESSION';
    default:
      return 'MULTI_TIMEFRAME_NEUTRAL';
  }
};
