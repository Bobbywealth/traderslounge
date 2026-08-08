/**
 * EMA Confluence Analyzer
 * Detects confluence between EMA levels and other technical analysis features.
 */
import type { 
  CandleData, 
  EmaResult, 
  ConfluenceZone, 
  ConfluenceScore 
} from './types';

// ============================================================================
// Confluence Zone Detection
// ============================================================================

/**
 * Detect confluence zones where EMA interacts with other technical levels.
 */
export const detectConfluenceZones = (
  currentPrice: number,
  emaResults: Map<number, EmaResult>,
  supportResistanceLevels: number[] = [],
  fibonacciLevels: number[] = [],
  vwapLevels: number[] = [],
  orderBlocks: Array<{ high: number; low: number }> = [],
  liquidityZones: number[] = [],
  previousDayHigh?: number,
  previousDayLow?: number,
  previousWeekHigh?: number,
  previousWeekLow?: number,
  swingHighs: number[] = [],
  swingLows: number[] = []
): ConfluenceZone[] => {
  const zones: ConfluenceZone[] = [];
  
  // Get EMA values
  const ema21 = getEmaValue(emaResults, 21);
  const ema50 = getEmaValue(emaResults, 50);
  const ema200 = getEmaValue(emaResults, 200);
  
  // Tolerance for level matching (0.1% of price)
  const tolerance = currentPrice * 0.001;
  
  // Check EMA 21 confluence
  if (ema21 !== null) {
    const confluence = findConfluenceAtLevel(
      ema21,
      currentPrice,
      tolerance,
      supportResistanceLevels,
      fibonacciLevels,
      vwapLevels,
      orderBlocks,
      liquidityZones,
      previousDayHigh,
      previousDayLow,
      previousWeekHigh,
      previousWeekLow,
      swingHighs,
      swingLows
    );
    
    if (confluence.count > 1) {
      zones.push({
        price: ema21,
        type: 'EMA',
        label: `EMA 21 + ${confluence.labels.join(' + ')}`,
        strength: Math.min(100, confluence.count * 25),
        distanceFromPrice: Math.abs(currentPrice - ema21),
      });
    }
  }
  
  // Check EMA 50 confluence
  if (ema50 !== null) {
    const confluence = findConfluenceAtLevel(
      ema50,
      currentPrice,
      tolerance,
      supportResistanceLevels,
      fibonacciLevels,
      vwapLevels,
      orderBlocks,
      liquidityZones,
      previousDayHigh,
      previousDayLow,
      previousWeekHigh,
      previousWeekLow,
      swingHighs,
      swingLows
    );
    
    if (confluence.count > 1) {
      zones.push({
        price: ema50,
        type: 'EMA',
        label: `EMA 50 + ${confluence.labels.join(' + ')}`,
        strength: Math.min(100, confluence.count * 25),
        distanceFromPrice: Math.abs(currentPrice - ema50),
      });
    }
  }
  
  // Check EMA 200 confluence
  if (ema200 !== null) {
    const confluence = findConfluenceAtLevel(
      ema200,
      currentPrice,
      tolerance,
      supportResistanceLevels,
      fibonacciLevels,
      vwapLevels,
      orderBlocks,
      liquidityZones,
      previousDayHigh,
      previousDayLow,
      previousWeekHigh,
      previousWeekLow,
      swingHighs,
      swingLows
    );
    
    if (confluence.count > 1) {
      zones.push({
        price: ema200,
        type: 'EMA',
        label: `EMA 200 + ${confluence.labels.join(' + ')}`,
        strength: Math.min(100, confluence.count * 25),
        distanceFromPrice: Math.abs(currentPrice - ema200),
      });
    }
  }
  
  // Sort by distance from price
  zones.sort((a, b) => a.distanceFromPrice - b.distanceFromPrice);
  
  return zones;
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get EMA value from results map.
 */
const getEmaValue = (emaResults: Map<number, EmaResult>, period: number): number | null => {
  const result = emaResults.get(period);
  if (!result) return null;
  
  const validValues = result.values.filter(v => v.isValid);
  if (validValues.length === 0) return null;
  
  return validValues[validValues.length - 1].value;
};

/**
 * Find confluence at a specific price level.
 */
const findConfluenceAtLevel = (
  level: number,
  currentPrice: number,
  tolerance: number,
  supportResistanceLevels: number[],
  fibonacciLevels: number[],
  vwapLevels: number[],
  orderBlocks: Array<{ high: number; low: number }>,
  liquidityZones: number[],
  previousDayHigh?: number,
  previousDayLow?: number,
  previousWeekHigh?: number,
  previousWeekLow?: number,
  swingHighs: number[],
  swingLows: number[]
): { count: number; labels: string[] } => {
  let count = 1; // The EMA itself
  const labels: string[] = [];
  
  // Check support/resistance
  if (supportResistanceLevels.some(sr => Math.abs(sr - level) <= tolerance)) {
    count++;
    labels.push('S/R');
  }
  
  // Check Fibonacci
  if (fibonacciLevels.some(fib => Math.abs(fib - level) <= tolerance)) {
    count++;
    labels.push('Fib');
  }
  
  // Check VWAP
  if (vwapLevels.some(vwap => Math.abs(vwap - level) <= tolerance)) {
    count++;
    labels.push('VWAP');
  }
  
  // Check order blocks
  if (orderBlocks.some(ob => level >= ob.low - tolerance && level <= ob.high + tolerance)) {
    count++;
    labels.push('Order Block');
  }
  
  // Check liquidity zones
  if (liquidityZones.some(lz => Math.abs(lz - level) <= tolerance)) {
    count++;
    labels.push('Liquidity');
  }
  
  // Check previous day high/low
  if (previousDayHigh !== undefined && Math.abs(previousDayHigh - level) <= tolerance) {
    count++;
    labels.push('PDH');
  }
  if (previousDayLow !== undefined && Math.abs(previousDayLow - level) <= tolerance) {
    count++;
    labels.push('PDL');
  }
  
  // Check previous week high/low
  if (previousWeekHigh !== undefined && Math.abs(previousWeekHigh - level) <= tolerance) {
    count++;
    labels.push('PWH');
  }
  if (previousWeekLow !== undefined && Math.abs(previousWeekLow - level) <= tolerance) {
    count++;
    labels.push('PWL');
  }
  
  // Check swing highs/lows
  if (swingHighs.some(sh => Math.abs(sh - level) <= tolerance)) {
    count++;
    labels.push('Swing High');
  }
  if (swingLows.some(sl => Math.abs(sl - level) <= tolerance)) {
    count++;
    labels.push('Swing Low');
  }
  
  return { count, labels };
};

// ============================================================================
// Confluence Score Calculation
// ============================================================================

/**
 * Calculate overall confluence score.
 */
export const calculateConfluenceScore = (
  zones: ConfluenceZone[],
  currentPrice: number
): ConfluenceScore => {
  if (zones.length === 0) {
    return {
      score: 0,
      zones: [],
      nearestZone: null,
      explanation: 'No confluence zones detected.',
    };
  }
  
  // Find nearest zone
  const nearestZone = zones.reduce((nearest, zone) => 
    zone.distanceFromPrice < nearest.distanceFromPrice ? zone : nearest
  );
  
  // Calculate score based on zone strength and proximity
  let score = 0;
  
  for (const zone of zones) {
    // Weight by strength
    const strengthWeight = zone.strength / 100;
    
    // Weight by proximity (closer = more significant)
    const proximityWeight = 1 - (zone.distanceFromPrice / currentPrice);
    
    score += strengthWeight * proximityWeight * 25;
  }
  
  // Cap at 100
  score = Math.min(100, Math.round(score));
  
  // Build explanation
  const explanation = zones.length > 0
    ? `Found ${zones.length} confluence zone(s). Nearest at ${nearestZone.price.toFixed(2)} (${nearestZone.distanceFromPrice.toFixed(2)} away).`
    : 'No confluence zones detected.';
  
  return {
    score,
    zones,
    nearestZone,
    explanation,
  };
};

// ============================================================================
// Dynamic Support/Resistance Detection
// ============================================================================

/**
 * Detect interactions between price and key EMAs.
 */
export const detectEmaInteractions = (
  candles: CandleData[],
  emaResults: Map<number, EmaResult>,
  lookback: number = 20
): Array<{
  emaPeriod: 21 | 50 | 200;
  type: 'TOUCH' | 'REJECTION' | 'BREAK' | 'RECLAIM' | 'RETEST';
  timestamp: number;
  priceAtInteraction: number;
  emaValueAtInteraction: number;
  direction: 'BULLISH' | 'BEARISH';
  strength: number;
}> => {
  const interactions: Array<{
    emaPeriod: 21 | 50 | 200;
    type: 'TOUCH' | 'REJECTION' | 'BREAK' | 'RECLAIM' | 'RETEST';
    timestamp: number;
    priceAtInteraction: number;
    emaValueAtInteraction: number;
    direction: 'BULLISH' | 'BEARISH';
    strength: number;
  }> = [];
  
  const emaPeriods: Array<21 | 50 | 200> = [21, 50, 200];
  
  for (const period of emaPeriods) {
    const emaResult = emaResults.get(period);
    if (!emaResult) continue;
    
    const emaValues = emaResult.values.filter(v => v.isValid);
    if (emaValues.length < lookback) continue;
    
    // Check recent candles for interactions
    const recentCandles = candles.slice(-lookback);
    const recentEma = emaValues.slice(-lookback);
    
    for (let i = 1; i < recentCandles.length; i++) {
      const candle = recentCandles[i];
      const prevCandle = recentCandles[i - 1];
      const ema = recentEma[i];
      const prevEma = recentEma[i - 1];
      
      if (!ema || !prevEma) continue;
      
      const tolerance = candle.close * 0.001; // 0.1% tolerance
      
      // Check for touch (price came within tolerance of EMA)
      const touchedEma = (
        Math.abs(candle.low - ema.value) <= tolerance ||
        Math.abs(candle.high - ema.value) <= tolerance
      );
      
      if (touchedEma) {
        // Determine if it's a rejection or just a touch
        const isBullishRejection = candle.close > ema.value && candle.low < ema.value;
        const isBearishRejection = candle.close < ema.value && candle.high > ema.value;
        
        if (isBullishRejection) {
          interactions.push({
            emaPeriod: period,
            type: 'REJECTION',
            timestamp: Number(candle.time),
            priceAtInteraction: candle.close,
            emaValueAtInteraction: ema.value,
            direction: 'BULLISH',
            strength: 70,
          });
        } else if (isBearishRejection) {
          interactions.push({
            emaPeriod: period,
            type: 'REJECTION',
            timestamp: Number(candle.time),
            priceAtInteraction: candle.close,
            emaValueAtInteraction: ema.value,
            direction: 'BEARISH',
            strength: 70,
          });
        }
      }
      
      // Check for break (price crossed EMA)
      const prevAboveEma = prevCandle.close > prevEma.value;
      const currAboveEma = candle.close > ema.value;
      
      if (prevAboveEma && !currAboveEma) {
        // Bearish break
        interactions.push({
          emaPeriod: period,
          type: 'BREAK',
          timestamp: Number(candle.time),
          priceAtInteraction: candle.close,
          emaValueAtInteraction: ema.value,
          direction: 'BEARISH',
          strength: 60,
        });
      } else if (!prevAboveEma && currAboveEma) {
        // Bullish break/reclaim
        interactions.push({
          emaPeriod: period,
          type: 'RECLAIM',
          timestamp: Number(candle.time),
          priceAtInteraction: candle.close,
          emaValueAtInteraction: ema.value,
          direction: 'BULLISH',
          strength: 60,
        });
      }
    }
  }
  
  // Sort by timestamp (most recent first)
  interactions.sort((a, b) => b.timestamp - a.timestamp);
  
  return interactions.slice(0, 10); // Return last 10 interactions
};
