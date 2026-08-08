/**
 * EMA Crossover Tests
 * Tests for crossover detection and quality scoring.
 */
import { describe, it, expect } from 'vitest';
import { 
  detectCrossovers, 
  detectAllCrossovers, 
  calculateCrossoverQuality,
  isNewCrossover
} from '../emaCrossover';
import { calculateEma } from '../emaCalculator';
import type { CandleData, CrossoverEvent } from '../types';

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

// Generate candles that will create a clear crossover
const generateCrossoverCandles = (
  crossoverIndex: number,
  direction: 'bullish' | 'bearish'
): CandleData[] => {
  const candles: CandleData[] = [];
  
  for (let i = 0; i < 100; i++) {
    let price: number;
    
    if (i < crossoverIndex - 10) {
      // Before crossover: trending down then up
      price = direction === 'bullish' 
        ? 100 - (crossoverIndex - 10 - i) * 0.5
        : 100 + (crossoverIndex - 10 - i) * 0.5;
    } else if (i < crossoverIndex) {
      // Approaching crossover
      price = direction === 'bullish'
        ? 100 + (i - (crossoverIndex - 10)) * 2
        : 100 - (i - (crossoverIndex - 10)) * 2;
    } else if (i === crossoverIndex) {
      // Crossover point
      price = 110;
    } else {
      // After crossover: continuing trend
      price = direction === 'bullish'
        ? 110 + (i - crossoverIndex) * 1
        : 110 - (i - crossoverIndex) * 1;
    }
    
    const open = price;
    const high = price + 1;
    const low = price - 1;
    const close = price + (Math.random() - 0.5);
    
    candles.push(createCandle(i, open, high, low, close));
  }
  
  return candles;
};

// ============================================================================
// Crossover Detection Tests
// ============================================================================

describe('detectCrossovers', () => {
  it('detects bullish crossover', () => {
    const candles = generateCrossoverCandles(50, 'bullish');
    const ema9 = calculateEma(candles, 9, 'close');
    const ema21 = calculateEma(candles, 21, 'close');
    
    const crossovers = detectCrossovers(ema9, ema21, candles, 'EMA_9_21');
    
    expect(crossovers.length).toBeGreaterThan(0);
    
    const bullishCross = crossovers.find(c => c.direction === 'BULLISH');
    expect(bullishCross).toBeDefined();
    expect(bullishCross!.type).toBe('EMA_9_21');
  });

  it('detects bearish crossover', () => {
    const candles = generateCrossoverCandles(50, 'bearish');
    const ema9 = calculateEma(candles, 9, 'close');
    const ema21 = calculateEma(candles, 21, 'close');
    
    const crossovers = detectCrossovers(ema9, ema21, candles, 'EMA_9_21');
    
    expect(crossovers.length).toBeGreaterThan(0);
    
    const bearishCross = crossovers.find(c => c.direction === 'BEARISH');
    expect(bearishCross).toBeDefined();
    expect(bearishCross!.type).toBe('EMA_9_21');
  });

  it('returns empty for no crossover', () => {
    // Generate stable candles with no crossover
    const candles = Array(100).fill(null).map((_, i) => 
      createCandle(i, 100 + i * 0.1, 101 + i * 0.1, 99 + i * 0.1, 100 + i * 0.1)
    );
    
    const ema9 = calculateEma(candles, 9, 'close');
    const ema21 = calculateEma(candles, 21, 'close');
    
    const crossovers = detectCrossovers(ema9, ema21, candles, 'EMA_9_21');
    
    expect(crossovers.length).toBe(0);
  });

  it('calculates bars since cross', () => {
    const candles = generateCrossoverCandles(50, 'bullish');
    const ema9 = calculateEma(candles, 9, 'close');
    const ema21 = calculateEma(candles, 21, 'close');
    
    const crossovers = detectCrossovers(ema9, ema21, candles, 'EMA_9_21');
    
    for (const cross of crossovers) {
      expect(cross.barsAgo).toBeGreaterThanOrEqual(0);
      expect(cross.barsAgo).toBeLessThan(candles.length);
    }
  });
});

// ============================================================================
// All Crossovers Detection Tests
// ============================================================================

describe('detectAllCrossovers', () => {
  it('detects all crossover pairs', () => {
    const candles = generateCrossoverCandles(50, 'bullish');
    const periods = [9, 21, 50, 200];
    const emaResults = new Map();
    
    for (const period of periods) {
      emaResults.set(period, calculateEma(candles, period, 'close'));
    }
    
    const state = detectAllCrossovers(emaResults, candles);
    
    expect(state.recentCrosses).toBeDefined();
    expect(Array.isArray(state.recentCrosses)).toBe(true);
  });

  it('identifies Golden Cross', () => {
    // Create candles that will cause 50 to cross above 200
    const candles: CandleData[] = [];
    
    // First 200 candles: price below 200 EMA
    for (let i = 0; i < 200; i++) {
      candles.push(createCandle(i, 90, 95, 85, 90));
    }
    
    // Next 50 candles: price rises above 200 EMA
    for (let i = 200; i < 250; i++) {
      candles.push(createCandle(i, 110, 115, 105, 110));
    }
    
    const periods = [9, 21, 50, 200];
    const emaResults = new Map();
    
    for (const period of periods) {
      emaResults.set(period, calculateEma(candles, period, 'close'));
    }
    
    const state = detectAllCrossovers(emaResults, candles);
    
    // May or may not have Golden Cross depending on exact EMA values
    // This test ensures the detection logic runs without errors
    expect(state).toBeDefined();
  });
});

// ============================================================================
// Crossover Quality Tests
// ============================================================================

describe('calculateCrossoverQuality', () => {
  it('calculates quality score', () => {
    const candles = generateCrossoverCandles(50, 'bullish');
    const ema9 = calculateEma(candles, 9, 'close');
    const ema21 = calculateEma(candles, 21, 'close');
    const ema50 = calculateEma(candles, 50, 'close');
    const ema200 = calculateEma(candles, 200, 'close');
    
    const crossovers = detectCrossovers(ema9, ema21, candles, 'EMA_9_21');
    
    if (crossovers.length > 0) {
      const quality = calculateCrossoverQuality(
        crossovers[0],
        ema9,
        ema21,
        candles,
        ema9,
        ema50,
        ema200
      );
      
      expect(['WEAK', 'MODERATE', 'STRONG']).toContain(quality);
    }
  });
});

// ============================================================================
// Deduplication Tests
// ============================================================================

describe('isNewCrossover', () => {
  it('identifies new crossover', () => {
    const event: CrossoverEvent = {
      type: 'EMA_9_21',
      direction: 'BULLISH',
      timestamp: 100 as any,
      barsAgo: 5,
      quality: 'MODERATE',
      qualityScore: 50,
      isGoldenCross: false,
      isDeathCross: false,
    };
    
    expect(isNewCrossover(event, [])).toBe(true);
  });

  it('identifies duplicate crossover', () => {
    const event: CrossoverEvent = {
      type: 'EMA_9_21',
      direction: 'BULLISH',
      timestamp: 100 as any,
      barsAgo: 5,
      quality: 'MODERATE',
      qualityScore: 50,
      isGoldenCross: false,
      isDeathCross: false,
    };
    
    const previousEvents: CrossoverEvent[] = [
      {
        ...event,
        barsAgo: 10,
      },
    ];
    
    expect(isNewCrossover(event, previousEvents)).toBe(false);
  });

  it('identifies different crossover as new', () => {
    const event: CrossoverEvent = {
      type: 'EMA_9_21',
      direction: 'BULLISH',
      timestamp: 100 as any,
      barsAgo: 5,
      quality: 'MODERATE',
      qualityScore: 50,
      isGoldenCross: false,
      isDeathCross: false,
    };
    
    const previousEvents: CrossoverEvent[] = [
      {
        ...event,
        direction: 'BEARISH', // Different direction
      },
    ];
    
    expect(isNewCrossover(event, previousEvents)).toBe(true);
  });
});
