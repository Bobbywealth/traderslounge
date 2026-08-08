/**
 * EMA State/Trend Analyzer
 * Analyzes EMA stacking, slopes, expansion/compression, and price distances.
 */
import type { CandleData, EmaResult, EmaStateAnalysis, EmaSlope, EmaSlopeClassification, EmaDistance, EmaTrendState } from './types';
import { calculateAtr } from './emaCalculator';

// ============================================================================
// Slope Classification
// ============================================================================

/**
 * Classify EMA slope based on lookback period.
 * Uses linear regression slope normalized to -1 to 1 range.
 */
export const classifySlope = (
  values: number[],
  lookback: number = 5
): EmaSlope => {
  if (values.length < lookback) {
    return {
      classification: 'FLAT',
      normalizedValue: 0,
      rawSlope: 0,
      lookbackUsed: values.length,
    };
  }

  // Use only the most recent 'lookback' values
  const recentValues = values.slice(-lookback);
  
  // Simple linear regression
  const n = recentValues.length;
  const xMean = (n - 1) / 2;
  const yMean = recentValues.reduce((a, b) => a + b, 0) / n;
  
  let numerator = 0;
  let denominator = 0;
  
  for (let i = 0; i < n; i++) {
    const x = i - xMean;
    const y = recentValues[i] - yMean;
    numerator += x * y;
    denominator += x * x;
  }
  
  const slope = denominator !== 0 ? numerator / denominator : 0;
  
  // Normalize slope relative to price level (percentage change per bar)
  const avgPrice = yMean;
  const normalizedSlope = avgPrice !== 0 ? (slope / avgPrice) * 100 : 0;
  
  // Classify based on normalized slope
  let classification: EmaSlopeClassification;
  if (normalizedSlope > 0.1) {
    classification = 'STRONGLY_RISING';
  } else if (normalizedSlope > 0.02) {
    classification = 'RISING';
  } else if (normalizedSlope > -0.02) {
    classification = 'FLAT';
  } else if (normalizedSlope > -0.1) {
    classification = 'FALLING';
  } else {
    classification = 'STRONGLY_FALLING';
  }
  
  return {
    classification,
    normalizedValue: Math.max(-1, Math.min(1, normalizedSlope * 10)),
    rawSlope: slope,
    lookbackUsed: lookback,
  };
};

// ============================================================================
// EMA Distance Calculation
// ============================================================================

/**
 * Calculate distance between two EMA values.
 */
export const calculateEmaDistance = (
  fasterEma: number,
  slowerEma: number,
  currentPrice: number,
  atr: number
): EmaDistance => {
  const absolute = fasterEma - slowerEma;
  const percentage = slowerEma !== 0 ? (absolute / slowerEma) * 100 : 0;
  const atrNormalized = atr !== 0 ? absolute / atr : 0;
  
  return {
    absolute,
    percentage,
    atrNormalized,
  };
};

// ============================================================================
// EMA Stacking Detection
// ============================================================================

/**
 * Detect EMA stacking pattern.
 */
export const detectEmaStack = (
  ema9: number,
  ema21: number,
  ema50: number,
  ema200: number,
  currentPrice: number
): EmaTrendState => {
  // Strong Bullish: 9 > 21 > 50 > 200
  if (ema9 > ema21 && ema21 > ema50 && ema50 > ema200) {
    return 'STRONG_BULLISH';
  }
  
  // Strong Bearish: 9 < 21 < 50 < 200
  if (ema9 < ema21 && ema21 < ema50 && ema50 < ema200) {
    return 'STRONG_BEARISH';
  }
  
  // Check for compression (EMAs clustered together)
  const range = Math.max(ema9, ema21, ema50, ema200) - Math.min(ema9, ema21, ema50, ema200);
  const avgEma = (ema9 + ema21 + ema50 + ema200) / 4;
  const compressionThreshold = avgEma * 0.01; // 1% of average
  
  if (range < compressionThreshold) {
    return 'COMPRESSION';
  }
  
  // Bullish: Price above EMA 50 and EMA 200 with generally bullish structure
  if (currentPrice > ema50 && currentPrice > ema200 && ema50 > ema200) {
    return 'BULLISH';
  }
  
  // Bearish: Price below EMA 50 and EMA 200 with generally bearish structure
  if (currentPrice < ema50 && currentPrice < ema200 && ema50 < ema200) {
    return 'BEARISH';
  }
  
  return 'NEUTRAL';
};

// ============================================================================
// Expansion/Compression Scoring
// ============================================================================

/**
 * Calculate expansion/compression scores based on EMA distances.
 */
export const calculateExpansionCompressionScores = (
  distance9_21: number,
  distance21_50: number,
  distance50_200: number,
  historicalDistances: {
    distance9_21: number[];
    distance21_50: number[];
    distance50_200: number[];
  }
): { expansionScore: number; compressionScore: number } => {
  // Calculate current average distance
  const currentAvg = (Math.abs(distance9_21) + Math.abs(distance21_50) + Math.abs(distance50_200)) / 3;
  
  // Calculate historical average
  const historicalAvg9_21 = historicalDistances.distance9_21.length > 0
    ? historicalDistances.distance9_21.reduce((a, b) => a + Math.abs(b), 0) / historicalDistances.distance9_21.length
    : currentAvg;
  const historicalAvg21_50 = historicalDistances.distance21_50.length > 0
    ? historicalDistances.distance21_50.reduce((a, b) => a + Math.abs(b), 0) / historicalDistances.distance21_50.length
    : currentAvg;
  const historicalAvg50_200 = historicalDistances.distance50_200.length > 0
    ? historicalDistances.distance50_200.reduce((a, b) => a + Math.abs(b), 0) / historicalDistances.distance50_200.length
    : currentAvg;
    
  const historicalAvg = (historicalAvg9_21 + historicalAvg21_50 + historicalAvg50_200) / 3;
  
  // Calculate ratio
  const ratio = historicalAvg !== 0 ? currentAvg / historicalAvg : 1;
  
  // Expansion score: higher when distances are increasing
  const expansionScore = Math.min(100, Math.max(0, (ratio - 1) * 100 + 50));
  
  // Compression score: higher when distances are decreasing
  const compressionScore = Math.min(100, Math.max(0, (1 - ratio) * 100 + 50));
  
  return { expansionScore, compressionScore };
};

// ============================================================================
// Price Distance from EMA
// ============================================================================

/**
 * Calculate how far price is from each EMA.
 */
export const calculatePriceDistances = (
  currentPrice: number,
  ema9: number,
  ema21: number,
  ema50: number,
  ema200: number,
  atr: number
): {
  priceVsEma9: EmaDistance;
  priceVsEma21: EmaDistance;
  priceVsEma50: EmaDistance;
  priceVsEma200: EmaDistance;
} => {
  return {
    priceVsEma9: calculateEmaDistance(currentPrice, ema9, currentPrice, atr),
    priceVsEma21: calculateEmaDistance(currentPrice, ema21, currentPrice, atr),
    priceVsEma50: calculateEmaDistance(currentPrice, ema50, currentPrice, atr),
    priceVsEma200: calculateEmaDistance(currentPrice, ema200, currentPrice, atr),
  };
};

// ============================================================================
// Main State Analysis
// ============================================================================

/**
 * Perform comprehensive EMA state analysis.
 */
export const analyzeEmaState = (
  candles: CandleData[],
  emaResults: Map<number, EmaResult>,
  slopeLookback: number = 5
): EmaStateAnalysis | null => {
  // Get current values
  const ema9Result = emaResults.get(9);
  const ema21Result = emaResults.get(21);
  const ema50Result = emaResults.get(50);
  const ema200Result = emaResults.get(200);
  
  if (!ema9Result || !ema21Result || !ema50Result || !ema200Result) {
    return null;
  }
  
  // Get latest valid values
  const getLatestValue = (result: EmaResult): number => {
    const validValues = result.values.filter(v => v.isValid);
    return validValues.length > 0 ? validValues[validValues.length - 1].value : NaN;
  };
  
  const ema9 = getLatestValue(ema9Result);
  const ema21 = getLatestValue(ema21Result);
  const ema50 = getLatestValue(ema50Result);
  const ema200 = getLatestValue(ema200Result);
  
  if (![ema9, ema21, ema50, ema200].every(Number.isFinite)) {
    return null;
  }
  
  const currentPrice = candles[candles.length - 1].close;
  
  // Calculate ATR for normalization
  const atrValues = calculateAtr(candles, 14);
  const currentAtr = atrValues.length > 0 ? atrValues[atrValues.length - 1] : 0;
  
  // Detect stack
  const stack = detectEmaStack(ema9, ema21, ema50, ema200, currentPrice);
  
  // Calculate slopes
  const getSlopeValues = (result: EmaResult): number[] => {
    return result.values.filter(v => v.isValid).map(v => v.value);
  };
  
  const slopes = {
    ema9: classifySlope(getSlopeValues(ema9Result), slopeLookback),
    ema21: classifySlope(getSlopeValues(ema21Result), slopeLookback),
    ema50: classifySlope(getSlopeValues(ema50Result), slopeLookback),
    ema200: classifySlope(getSlopeValues(ema200Result), slopeLookback),
  };
  
  // Calculate distances
  const distances = {
    distance9_21: calculateEmaDistance(ema9, ema21, currentPrice, currentAtr),
    distance21_50: calculateEmaDistance(ema21, ema50, currentPrice, currentAtr),
    distance50_200: calculateEmaDistance(ema50, ema200, currentPrice, currentAtr),
  };
  
  // Calculate expansion/compression scores
  const { expansionScore, compressionScore } = calculateExpansionCompressionScores(
    distances.distance9_21.absolute,
    distances.distance21_50.absolute,
    distances.distance50_200.absolute,
    {
      distance9_21: [], // Would need historical data in production
      distance21_50: [],
      distance50_200: [],
    }
  );
  
  // Calculate price distances
  const priceDistances = calculatePriceDistances(
    currentPrice,
    ema9,
    ema21,
    ema50,
    ema200,
    currentAtr
  );
  
  return {
    stack,
    slopes,
    distances,
    expansionScore,
    compressionScore,
    priceDistances,
  };
};

// ============================================================================
// Trend Score Calculation
// ============================================================================

/**
 * Calculate overall EMA trend score.
 * Range: -100 (Extremely Bearish) to +100 (Extremely Bullish)
 */
export const calculateTrendScore = (
  state: EmaStateAnalysis,
  currentPrice: number
): { score: number; explanation: string } => {
  let score = 0;
  const factors: string[] = [];
  
  // Price relative to EMAs (40% weight)
  const priceAboveEma9 = currentPrice > state.priceDistances.priceVsEma9.absolute;
  const priceAboveEma21 = currentPrice > state.priceDistances.priceVsEma21.absolute;
  const priceAboveEma50 = currentPrice > state.priceDistances.priceVsEma50.absolute;
  const priceAboveEma200 = currentPrice > state.priceDistances.priceVsEma200.absolute;
  
  if (priceAboveEma9) score += 5;
  if (priceAboveEma21) score += 10;
  if (priceAboveEma50) score += 10;
  if (priceAboveEma200) score += 15;
  
  if (priceAboveEma9 && priceAboveEma21 && priceAboveEma50 && priceAboveEma200) {
    factors.push('Price above all major EMAs');
  }
  
  // EMA ordering (30% weight)
  const stackScore: Record<string, number> = {
    'STRONG_BULLISH': 30,
    'BULLISH': 15,
    'NEUTRAL': 0,
    'BEARISH': -15,
    'STRONG_BEARISH': -30,
    'COMPRESSION': 0,
  };
  score += stackScore[state.stack] || 0;
  
  if (state.stack === 'STRONG_BULLISH') {
    factors.push('Strong bullish EMA stack');
  } else if (state.stack === 'STRONG_BEARISH') {
    factors.push('Strong bearish EMA stack');
  }
  
  // EMA slopes (20% weight)
  const slopeScore: Record<string, number> = {
    'STRONGLY_RISING': 5,
    'RISING': 2.5,
    'FLAT': 0,
    'FALLING': -2.5,
    'STRONGLY_FALLING': -5,
  };
  
  score += slopeScore[state.slopes.ema9.classification] || 0;
  score += slopeScore[state.slopes.ema21.classification] || 0;
  score += slopeScore[state.slopes.ema50.classification] || 0;
  score += slopeScore[state.slopes.ema200.classification] || 0;
  
  if (state.slopes.ema9.classification === 'STRONGLY_RISING' && 
      state.slopes.ema21.classification === 'STRONGLY_RISING') {
    factors.push('9/21/50 slopes rising');
  }
  
  // Expansion/compression (10% weight)
  if (state.expansionScore > 60) {
    score += 5;
    factors.push('EMA separation increasing');
  } else if (state.compressionScore > 60) {
    score -= 5;
    factors.push('EMA compression detected');
  }
  
  // Clamp score to -100 to +100
  const clampedScore = Math.max(-100, Math.min(100, score));
  
  // Build explanation
  const explanation = factors.length > 0 
    ? factors.join('. ') + '.'
    : 'Mixed signals across EMA indicators.';
  
  return { score: clampedScore, explanation };
};
