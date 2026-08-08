/**
 * EMA Crossover Detection
 * Detects crossovers between EMA pairs with quality scoring.
 * Includes Golden Cross and Death Cross detection.
 */
import type { UTCTimestamp } from 'lightweight-charts';
import type { 
  CandleData, 
  EmaResult, 
  CrossoverEvent, 
  CrossoverState, 
  CrossoverType, 
  CrossDirection, 
  CrossoverQuality 
} from './types';

// ============================================================================
// Crossover Detection
// ============================================================================

/**
 * Detect crossovers between two EMA series.
 * Only fires on the candle where the cross occurs, not repeatedly.
 */
export const detectCrossovers = (
  fasterEma: EmaResult,
  slowerEma: EmaResult,
  candles: CandleData[],
  crossoverType: CrossoverType,
  lookback: number = 50
): CrossoverEvent[] => {
  const events: CrossoverEvent[] = [];
  
  // Get valid values
  const fasterValues = fasterEma.values.filter(v => v.isValid);
  const slowerValues = slowerEma.values.filter(v => v.isValid);
  
  if (fasterValues.length < 2 || slowerValues.length < 2) {
    return events;
  }
  
  // Align the two series by time
  const alignedData: Array<{
    time: UTCTimestamp;
    faster: number;
    slower: number;
    candleIndex: number;
  }> = [];
  
  let fasterIdx = 0;
  let slowerIdx = 0;
  
  while (fasterIdx < fasterValues.length && slowerIdx < slowerValues.length) {
    const fasterTime = Number(fasterValues[fasterIdx].time);
    const slowerTime = Number(slowerValues[slowerIdx].time);
    
    if (fasterTime === slowerTime) {
      // Find corresponding candle index
      const candleIndex = candles.findIndex(c => Number(c.time) === fasterTime);
      if (candleIndex >= 0) {
        alignedData.push({
          time: fasterValues[fasterIdx].time,
          faster: fasterValues[fasterIdx].value,
          slower: slowerValues[slowerIdx].value,
          candleIndex,
        });
      }
      fasterIdx++;
      slowerIdx++;
    } else if (fasterTime < slowerTime) {
      fasterIdx++;
    } else {
      slowerIdx++;
    }
  }
  
  // Detect crossovers
  for (let i = 1; i < alignedData.length; i++) {
    const prev = alignedData[i - 1];
    const curr = alignedData[i];
    
    const prevDiff = prev.faster - prev.slower;
    const currDiff = curr.faster - curr.slower;
    
    // Check for crossover (sign change)
    if ((prevDiff <= 0 && currDiff > 0) || (prevDiff >= 0 && currDiff < 0)) {
      const direction: CrossDirection = currDiff > 0 ? 'BULLISH' : 'BEARISH';
      
      // Calculate bars since cross
      const barsSinceCross = candles.length - 1 - curr.candleIndex;
      
      // Determine if this is Golden Cross or Death Cross
      const isGoldenCross = crossoverType === 'EMA_50_200' && direction === 'BULLISH';
      const isDeathCross = crossoverType === 'EMA_50_200' && direction === 'BEARISH';
      
      events.push({
        type: crossoverType,
        direction,
        timestamp: curr.time,
        barsAgo: barsSinceCross,
        quality: 'MODERATE', // Will be calculated separately
        qualityScore: 50,
        isGoldenCross,
        isDeathCross,
      });
    }
  }
  
  return events;
};

// ============================================================================
// Crossover Quality Scoring
// ============================================================================

/**
 * Calculate crossover quality based on multiple factors.
 */
export const calculateCrossoverQuality = (
  event: CrossoverEvent,
  fasterEma: EmaResult,
  slowerEma: EmaResult,
  candles: CandleData[],
  ema9: EmaResult,
  ema50: EmaResult,
  ema200: EmaResult
): CrossoverQuality => {
  let score = 50; // Base score
  
  // Factor 1: EMA slope at crossover (25% weight)
  const fasterValues = fasterEma.values.filter(v => v.isValid).map(v => v.value);
  const slowerValues = slowerEma.values.filter(v => v.isValid).map(v => v.value);
  
  if (fasterValues.length >= 5 && slowerValues.length >= 5) {
    const fasterSlope = (fasterValues[fasterValues.length - 1] - fasterValues[fasterValues.length - 5]) / 5;
    const slowerSlope = (slowerValues[slowerValues.length - 1] - slowerValues[slowerValues.length - 5]) / 5;
    
    // Favor crossovers where both EMAs are moving in the direction of the cross
    if (event.direction === 'BULLISH' && fasterSlope > 0 && slowerSlope > 0) {
      score += 12;
    } else if (event.direction === 'BEARISH' && fasterSlope < 0 && slowerSlope < 0) {
      score += 12;
    }
  }
  
  // Factor 2: EMA separation after crossing (25% weight)
  const recentFaster = fasterValues.slice(-5);
  const recentSlower = slowerValues.slice(-5);
  
  if (recentFaster.length === 5 && recentSlower.length === 5) {
    const avgDiff = recentFaster.reduce((sum, v, i) => sum + (v - recentSlower[i]), 0) / 5;
    const separation = Math.abs(avgDiff);
    const avgPrice = recentFaster.reduce((a, b) => a + b, 0) / 5;
    const separationPct = avgPrice !== 0 ? (separation / avgPrice) * 100 : 0;
    
    if (separationPct > 0.5) {
      score += 15;
    } else if (separationPct > 0.2) {
      score += 8;
    }
  }
  
  // Factor 3: Price position (25% weight)
  const currentPrice = candles[candles.length - 1].close;
  const ema50Values = ema50.values.filter(v => v.isValid);
  const ema200Values = ema200.values.filter(v => v.isValid);
  
  if (ema50Values.length > 0 && ema200Values.length > 0) {
    const ema50Value = ema50Values[ema50Values.length - 1].value;
    const ema200Value = ema200Values[ema200Values.length - 1].value;
    
    if (event.direction === 'BULLISH' && currentPrice > ema50Value && currentPrice > ema200Value) {
      score += 12;
    } else if (event.direction === 'BEARISH' && currentPrice < ema50Value && currentPrice < ema200Value) {
      score += 12;
    }
  }
  
  // Factor 4: Crossover persistence (25% weight)
  if (event.barsAgo > 10) {
    score += 10;
  } else if (event.barsAgo > 5) {
    score += 5;
  }
  
  // Clamp score
  score = Math.max(0, Math.min(100, score));
  
  // Classify quality
  let quality: CrossoverQuality;
  if (score >= 70) {
    quality = 'STRONG';
  } else if (score >= 40) {
    quality = 'MODERATE';
  } else {
    quality = 'WEAK';
  }
  
  return quality;
};

// ============================================================================
// All Crossover Detection
// ============================================================================

/**
 * Detect all EMA crossovers and return consolidated state.
 */
export const detectAllCrossovers = (
  emaResults: Map<number, EmaResult>,
  candles: CandleData[]
): CrossoverState => {
  const ema9 = emaResults.get(9);
  const ema21 = emaResults.get(21);
  const ema50 = emaResults.get(50);
  const ema200 = emaResults.get(200);
  
  if (!ema9 || !ema21 || !ema50 || !ema200) {
    return {
      recentCrosses: [],
      lastGoldenCross: null,
      lastDeathCross: null,
      activeCrosses: [],
    };
  }
  
  // Detect all crossover pairs
  const allCrosses: CrossoverEvent[] = [];
  
  // 9/21 crossovers
  const crosses9_21 = detectCrossovers(ema9, ema21, candles, 'EMA_9_21');
  allCrosses.push(...crosses9_21);
  
  // 9/50 crossovers
  const crosses9_50 = detectCrossovers(ema9, ema50, candles, 'EMA_9_50');
  allCrosses.push(...crosses9_50);
  
  // 21/50 crossovers
  const crosses21_50 = detectCrossovers(ema21, ema50, candles, 'EMA_21_50');
  allCrosses.push(...crosses21_50);
  
  // 50/200 crossovers (Golden/Death Cross)
  const crosses50_200 = detectCrossovers(ema50, ema200, candles, 'EMA_50_200');
  allCrosses.push(...crosses50_200);
  
  // Calculate quality for each crossover
  const qualityCrosses = allCrosses.map(cross => {
    const quality = calculateCrossoverQuality(
      cross,
      emaResults.get(parseInt(cross.type.split('_')[1]))!,
      emaResults.get(parseInt(cross.type.split('_')[2]))!,
      candles,
      ema9,
      ema50,
      ema200
    );
    return { ...cross, quality };
  });
  
  // Sort by timestamp (most recent first)
  qualityCrosses.sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
  
  // Find Golden Cross and Death Cross
  const lastGoldenCross = qualityCrosses.find(c => c.isGoldenCross) || null;
  const lastDeathCross = qualityCrosses.find(c => c.isDeathCross) || null;
  
  // Active crosses are recent ones (within last 10 bars)
  const activeCrosses = qualityCrosses.filter(c => c.barsAgo <= 10);
  
  return {
    recentCrosses: qualityCrosses.slice(0, 10), // Keep last 10
    lastGoldenCross,
    lastDeathCross,
    activeCrosses,
  };
};

// ============================================================================
// Crossover Event Deduplication
// ============================================================================

/**
 * Ensure we don't fire the same crossover event repeatedly.
 * Only fires on the candle where the cross actually occurs.
 */
export const isNewCrossover = (
  event: CrossoverEvent,
  previousEvents: CrossoverEvent[]
): boolean => {
  // Check if we already have this exact crossover
  const duplicate = previousEvents.find(
    e => e.type === event.type && 
         e.direction === event.direction && 
         Number(e.timestamp) === Number(event.timestamp)
  );
  
  return !duplicate;
};
