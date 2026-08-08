/**
 * EMA Analyzer Tests
 * Tests for EMA state analysis, slopes, and trend detection.
 */
import { describe, it, expect } from 'vitest';
import { 
  classifySlope, 
  calculateEmaDistance, 
  detectEmaStack, 
  calculateTrendScore,
  analyzeEmaState
} from '../emaAnalyzer';
import { calculateEma, calculateMultipleEmas } from '../emaCalculator';
import type { CandleData, EmaResult } from '../types';

// ============================================================================
// Test Data Generators
// ============================================================================

const createCandle = (
  time: number,
  open: number,
  high: number,
  low: number,
  close: number
): CandleData => ({
  time: time as any,
  open,
  high,
  low,
  close,
});

const generateCandles = (count: number, startPrice: number = 100): CandleData[] => {
  const candles: CandleData[] = [];
  let price = startPrice;
  
  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.5) * 2;
    price += change;
    const open = price;
    const high = price + Math.random();
    const low = price - Math.random();
    const close = price + (Math.random() - 0.5);
    
    candles.push(createCandle(i, open, high, low, close));
  }
  
  return candles;
};

// ============================================================================
// Slope Classification Tests
// ============================================================================

describe('classifySlope', () => {
  it('classifies flat slope', () => {
    const values = [100, 100, 100, 100, 100];
    const slope = classifySlope(values, 5);
    
    expect(slope.classification).toBe('FLAT');
    expect(slope.normalizedValue).toBeCloseTo(0, 1);
  });

  it('classifies strongly rising slope', () => {
    const values = [100, 102, 104, 106, 108];
    const slope = classifySlope(values, 5);
    
    expect(slope.classification).toBe('STRONGLY_RISING');
    expect(slope.normalizedValue).toBeGreaterThan(0);
  });

  it('classifies strongly falling slope', () => {
    const values = [108, 106, 104, 102, 100];
    const slope = classifySlope(values, 5);
    
    expect(slope.classification).toBe('STRONGLY_FALLING');
    expect(slope.normalizedValue).toBeLessThan(0);
  });

  it('classifies rising slope', () => {
    const values = [100, 100.1, 100.2, 100.3, 100.4];
    const slope = classifySlope(values, 5);
    
    expect(slope.classification).toBe('RISING');
  });

  it('classifies falling slope', () => {
    const values = [100.4, 100.3, 100.2, 100.1, 100];
    const slope = classifySlope(values, 5);
    
    expect(slope.classification).toBe('FALLING');
  });

  it('handles insufficient data', () => {
    const values = [100, 100];
    const slope = classifySlope(values, 5);
    
    expect(slope.classification).toBe('FLAT');
    expect(slope.normalizedValue).toBe(0);
  });
});

// ============================================================================
// EMA Distance Calculation Tests
// ============================================================================

describe('calculateEmaDistance', () => {
  it('calculates absolute distance', () => {
    const distance = calculateEmaDistance(100, 98, 100, 2);
    
    expect(distance.absolute).toBe(2);
    expect(distance.percentage).toBeCloseTo(2.04, 1);
    expect(distance.atrNormalized).toBe(1);
  });

  it('handles zero ATR', () => {
    const distance = calculateEmaDistance(100, 98, 100, 0);
    
    expect(distance.absolute).toBe(2);
    expect(distance.atrNormalized).toBe(0);
  });

  it('handles negative distance', () => {
    const distance = calculateEmaDistance(98, 100, 100, 2);
    
    expect(distance.absolute).toBe(-2);
    expect(distance.percentage).toBeCloseTo(-2, 1);
  });
});

// ============================================================================
// EMA Stack Detection Tests
// ============================================================================

describe('detectEmaStack', () => {
  it('detects strong bullish alignment', () => {
    const stack = detectEmaStack(110, 105, 100, 95, 115);
    
    expect(stack).toBe('STRONG_BULLISH');
  });

  it('detects strong bearish alignment', () => {
    const stack = detectEmaStack(90, 95, 100, 105, 85);
    
    expect(stack).toBe('STRONG_BEARISH');
  });

  it('detects bullish structure', () => {
    const stack = detectEmaStack(102, 101, 100, 99, 105);
    
    expect(stack).toBe('BULLISH');
  });

  it('detects bearish structure', () => {
    const stack = detectEmaStack(98, 99, 100, 101, 95);
    
    expect(stack).toBe('BEARISH');
  });

  it('detects compression', () => {
    const stack = detectEmaStack(100.1, 100.05, 100, 99.95, 100.2);
    
    expect(stack).toBe('COMPRESSION');
  });

  it('detects neutral', () => {
    const stack = detectEmaStack(100, 102, 98, 101, 99);
    
    expect(stack).toBe('NEUTRAL');
  });
});

// ============================================================================
// Trend Score Calculation Tests
// ============================================================================

describe('calculateTrendScore', () => {
  it('calculates high score for strong bullish state', () => {
    const state = {
      stack: 'STRONG_BULLISH' as const,
      slopes: {
        ema9: { classification: 'STRONGLY_RISING' as const, normalizedValue: 0.8, rawSlope: 0.5, lookbackUsed: 5 },
        ema21: { classification: 'RISING' as const, normalizedValue: 0.5, rawSlope: 0.3, lookbackUsed: 5 },
        ema50: { classification: 'RISING' as const, normalizedValue: 0.3, rawSlope: 0.2, lookbackUsed: 5 },
        ema200: { classification: 'FLAT' as const, normalizedValue: 0, rawSlope: 0, lookbackUsed: 5 },
      },
      distances: {
        distance9_21: { absolute: 2, percentage: 2, atrNormalized: 1 },
        distance21_50: { absolute: 3, percentage: 3, atrNormalized: 1.5 },
        distance50_200: { absolute: 5, percentage: 5, atrNormalized: 2.5 },
      },
      expansionScore: 70,
      compressionScore: 30,
      priceDistances: {
        priceVsEma9: { absolute: 1, percentage: 1, atrNormalized: 0.5 },
        priceVsEma21: { absolute: 3, percentage: 3, atrNormalized: 1.5 },
        priceVsEma50: { absolute: 6, percentage: 6, atrNormalized: 3 },
        priceVsEma200: { absolute: 11, percentage: 11, atrNormalized: 5.5 },
      },
    };
    
    const { score, explanation } = calculateTrendScore(state, 110);
    
    expect(score).toBeGreaterThan(50);
    expect(explanation).toContain('Strong bullish EMA stack');
  });

  it('calculates low score for strong bearish state', () => {
    const state = {
      stack: 'STRONG_BEARISH' as const,
      slopes: {
        ema9: { classification: 'STRONGLY_FALLING' as const, normalizedValue: -0.8, rawSlope: -0.5, lookbackUsed: 5 },
        ema21: { classification: 'FALLING' as const, normalizedValue: -0.5, rawSlope: -0.3, lookbackUsed: 5 },
        ema50: { classification: 'FALLING' as const, normalizedValue: -0.3, rawSlope: -0.2, lookbackUsed: 5 },
        ema200: { classification: 'FLAT' as const, normalizedValue: 0, rawSlope: 0, lookbackUsed: 5 },
      },
      distances: {
        distance9_21: { absolute: -2, percentage: -2, atrNormalized: -1 },
        distance21_50: { absolute: -3, percentage: -3, atrNormalized: -1.5 },
        distance50_200: { absolute: -5, percentage: -5, atrNormalized: -2.5 },
      },
      expansionScore: 30,
      compressionScore: 70,
      priceDistances: {
        priceVsEma9: { absolute: -1, percentage: -1, atrNormalized: -0.5 },
        priceVsEma21: { absolute: -3, percentage: -3, atrNormalized: -1.5 },
        priceVsEma50: { absolute: -6, percentage: -6, atrNormalized: -3 },
        priceVsEma200: { absolute: -11, percentage: -11, atrNormalized: -5.5 },
      },
    };
    
    const { score, explanation } = calculateTrendScore(state, 85);
    
    expect(score).toBeLessThan(-50);
    expect(explanation).toContain('Strong bearish EMA stack');
  });

  it('clamps score to -100 to 100', () => {
    const extremeState = {
      stack: 'STRONG_BULLISH' as const,
      slopes: {
        ema9: { classification: 'STRONGLY_RISING' as const, normalizedValue: 1, rawSlope: 10, lookbackUsed: 5 },
        ema21: { classification: 'STRONGLY_RISING' as const, normalizedValue: 1, rawSlope: 10, lookbackUsed: 5 },
        ema50: { classification: 'STRONGLY_RISING' as const, normalizedValue: 1, rawSlope: 10, lookbackUsed: 5 },
        ema200: { classification: 'STRONGLY_RISING' as const, normalizedValue: 1, rawSlope: 10, lookbackUsed: 5 },
      },
      distances: {
        distance9_21: { absolute: 100, percentage: 100, atrNormalized: 50 },
        distance21_50: { absolute: 100, percentage: 100, atrNormalized: 50 },
        distance50_200: { absolute: 100, percentage: 100, atrNormalized: 50 },
      },
      expansionScore: 100,
      compressionScore: 0,
      priceDistances: {
        priceVsEma9: { absolute: 100, percentage: 100, atrNormalized: 50 },
        priceVsEma21: { absolute: 100, percentage: 100, atrNormalized: 50 },
        priceVsEma50: { absolute: 100, percentage: 100, atrNormalized: 50 },
        priceVsEma200: { absolute: 100, percentage: 100, atrNormalized: 50 },
      },
    };
    
    const { score } = calculateTrendScore(extremeState, 200);
    
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThanOrEqual(-100);
  });
});

// ============================================================================
// Analyze EMA State Tests
// ============================================================================

describe('analyzeEmaState', () => {
  it('returns null for insufficient data', () => {
    const candles = generateCandles(50);
    const emaResults = calculateMultipleEmas(candles, [9, 21, 50, 200], 'close');
    
    const state = analyzeEmaState(candles, emaResults);
    
    expect(state).toBeNull();
  });

  it('analyzes state correctly for sufficient data', () => {
    const candles = generateCandles(250);
    const emaResults = calculateMultipleEmas(candles, [9, 21, 50, 200], 'close');
    
    const state = analyzeEmaState(candles, emaResults);
    
    expect(state).not.toBeNull();
    expect(state!.stack).toBeDefined();
    expect(state!.slopes).toBeDefined();
    expect(state!.distances).toBeDefined();
    expect(state!.priceDistances).toBeDefined();
  });

  it('provides slope classifications', () => {
    const candles = generateCandles(250);
    const emaResults = calculateMultipleEmas(candles, [9, 21, 50, 200], 'close');
    
    const state = analyzeEmaState(candles, emaResults);
    
    expect(state!.slopes.ema9.classification).toBeDefined();
    expect(state!.slopes.ema21.classification).toBeDefined();
    expect(state!.slopes.ema50.classification).toBeDefined();
    expect(state!.slopes.ema200.classification).toBeDefined();
  });

  it('provides valid distance values', () => {
    const candles = generateCandles(250);
    const emaResults = calculateMultipleEmas(candles, [9, 21, 50, 200], 'close');
    
    const state = analyzeEmaState(candles, emaResults);
    
    expect(Number.isFinite(state!.distances.distance9_21.absolute)).toBe(true);
    expect(Number.isFinite(state!.distances.distance21_50.absolute)).toBe(true);
    expect(Number.isFinite(state!.distances.distance50_200.absolute)).toBe(true);
  });
});
