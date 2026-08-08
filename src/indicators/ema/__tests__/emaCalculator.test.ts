/**
 * EMA Calculator Tests
 * Comprehensive tests for EMA calculation engine.
 */
import { describe, it, expect } from 'vitest';
import { 
  calculateEma, 
  updateEmaIncremental, 
  extractPrice, 
  calculateMultipleEmas,
  validateEmaCalculation,
  DEFAULT_EMA_CONFIGS
} from '../emaCalculator';
import type { CandleData, PriceSource } from '../types';

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
// Price Source Extraction Tests
// ============================================================================

describe('extractPrice', () => {
  const candle: CandleData = {
    time: 0 as any,
    open: 100,
    high: 105,
    low: 95,
    close: 102,
  };

  it('extracts close price', () => {
    expect(extractPrice(candle, 'close')).toBe(102);
  });

  it('extracts open price', () => {
    expect(extractPrice(candle, 'open')).toBe(100);
  });

  it('extracts high price', () => {
    expect(extractPrice(candle, 'high')).toBe(105);
  });

  it('extracts low price', () => {
    expect(extractPrice(candle, 'low')).toBe(95);
  });

  it('extracts HL2 (high+low/2)', () => {
    expect(extractPrice(candle, 'hl2')).toBe(100); // (105+95)/2
  });

  it('extracts HLC3 (high+low+close/3)', () => {
    expect(extractPrice(candle, 'hlc3')).toBeCloseTo(100.667, 2); // (105+95+102)/3
  });

  it('extracts OHLC4 (open+high+low+close/4)', () => {
    expect(extractPrice(candle, 'ohlc4')).toBe(100.5); // (100+105+95+102)/4
  });
});

// ============================================================================
// EMA Calculation Tests
// ============================================================================

describe('calculateEma', () => {
  it('returns empty array for empty candles', () => {
    const result = calculateEma([], 9, 'close');
    expect(result.values).toHaveLength(0);
    expect(result.isWarmedUp).toBe(false);
  });

  it('returns insufficient data for fewer candles than period', () => {
    const candles = generateCandles(5);
    const result = calculateEma(candles, 9, 'close');
    expect(result.isWarmedUp).toBe(false);
    expect(result.values.every(v => !v.isValid)).toBe(true);
  });

  it('calculates EMA correctly for sufficient data', () => {
    // Simple test case with known values
    const candles = [
      createCandle(0, 100, 105, 95, 100),
      createCandle(1, 100, 105, 95, 102),
      createCandle(2, 102, 107, 97, 104),
      createCandle(3, 104, 109, 99, 106),
      createCandle(4, 106, 111, 101, 108),
      createCandle(5, 108, 113, 103, 110),
      createCandle(6, 110, 115, 105, 112),
      createCandle(7, 112, 117, 107, 114),
      createCandle(8, 114, 119, 109, 116),
      createCandle(9, 116, 121, 111, 118),
    ];
    
    const result = calculateEma(candles, 5, 'close');
    
    expect(result.period).toBe(5);
    expect(result.isWarmedUp).toBe(true);
    expect(result.warmupCandles).toBe(5);
    
    // First 4 values should be invalid (warmup period)
    for (let i = 0; i < 4; i++) {
      expect(result.values[i].isValid).toBe(false);
    }
    
    // 5th value should be valid (SMA of first 5 closes)
    expect(result.values[4].isValid).toBe(true);
    expect(result.values[4].value).toBe(104); // (100+102+104+106+108)/5
    
    // Remaining values should be valid
    for (let i = 5; i < 10; i++) {
      expect(result.values[i].isValid).toBe(true);
    }
  });

  it('handles different price sources', () => {
    const candles = [
      createCandle(0, 100, 110, 90, 100),
      createCandle(1, 100, 110, 90, 100),
      createCandle(2, 100, 110, 90, 100),
      createCandle(3, 100, 110, 90, 100),
      createCandle(4, 100, 110, 90, 100),
    ];
    
    const closeResult = calculateEma(candles, 5, 'close');
    const highResult = calculateEma(candles, 5, 'high');
    const lowResult = calculateEma(candles, 5, 'low');
    
    expect(closeResult.values[4].value).toBe(100);
    expect(highResult.values[4].value).toBe(110);
    expect(lowResult.values[4].value).toBe(90);
  });

  it('calculates EMA 200 correctly', () => {
    const candles = generateCandles(250);
    const result = calculateEma(candles, 200, 'close');
    
    expect(result.period).toBe(200);
    expect(result.isWarmedUp).toBe(true);
    expect(result.values.length).toBe(250);
    
    // First 199 values should be invalid
    for (let i = 0; i < 199; i++) {
      expect(result.values[i].isValid).toBe(false);
    }
    
    // 200th value should be valid
    expect(result.values[199].isValid).toBe(true);
  });
});

// ============================================================================
// Incremental EMA Update Tests
// ============================================================================

describe('updateEmaIncremental', () => {
  it('updates EMA incrementally with new candle', () => {
    const initialCandles = generateCandles(50);
    const initialResult = calculateEma(initialCandles, 9, 'close');
    
    const newCandle = createCandle(
      50,
      100,
      105,
      95,
      102
    );
    
    const updatedResult = updateEmaIncremental(initialResult, newCandle, 'close');
    
    expect(updatedResult.values.length).toBe(initialResult.values.length + 1);
    expect(updatedResult.isWarmedUp).toBe(true);
    
    // Last value should be valid
    const lastValue = updatedResult.values[updatedResult.values.length - 1];
    expect(lastValue.isValid).toBe(true);
    expect(lastValue.value).toBeGreaterThan(0);
  });

  it('maintains EMA consistency with full calculation', () => {
    const candles = generateCandles(100);
    const fullResult = calculateEma(candles, 9, 'close');
    
    // Simulate incremental updates
    let incrementalResult = calculateEma(candles.slice(0, 50), 9, 'close');
    
    for (let i = 50; i < candles.length; i++) {
      incrementalResult = updateEmaIncremental(incrementalResult, candles[i], 'close');
    }
    
    // Compare last values (should be very close due to floating point)
    const fullLastValue = fullResult.values[fullResult.values.length - 1].value;
    const incrementalLastValue = incrementalResult.values[incrementalResult.values.length - 1].value;
    
    expect(Math.abs(fullLastValue - incrementalLastValue)).toBeLessThan(0.0001);
  });
});

// ============================================================================
// Multiple EMA Calculation Tests
// ============================================================================

describe('calculateMultipleEmas', () => {
  it('calculates multiple EMAs simultaneously', () => {
    const candles = generateCandles(250);
    const periods = [9, 21, 50, 200];
    
    const results = calculateMultipleEmas(candles, periods, 'close');
    
    expect(results.size).toBe(4);
    
    for (const period of periods) {
      expect(results.has(period)).toBe(true);
      const result = results.get(period)!;
      expect(result.period).toBe(period);
      expect(result.values.length).toBe(250);
    }
  });

  it('warms up correctly for each period', () => {
    const candles = generateCandles(250);
    const periods = [9, 21, 50, 200];
    
    const results = calculateMultipleEmas(candles, periods, 'close');
    
    for (const period of periods) {
      const result = results.get(period)!;
      
      // Check warmup
      for (let i = 0; i < period - 1; i++) {
        expect(result.values[i].isValid).toBe(false);
      }
      expect(result.values[period - 1].isValid).toBe(true);
    }
  });
});

// ============================================================================
// Validation Tests
// ============================================================================

describe('validateEmaCalculation', () => {
  it('validates correct EMA calculation', () => {
    const candles = generateCandles(50);
    const result = calculateEma(candles, 9, 'close');
    
    const expectedValues = result.values.map(v => v.value);
    const validation = validateEmaCalculation(candles, 9, expectedValues);
    
    expect(validation.passed).toBe(true);
    expect(validation.maxError).toBeLessThan(1e-6);
    expect(validation.firstErrorIndex).toBe(-1);
  });

  it('detects incorrect EMA calculation', () => {
    const candles = generateCandles(50);
    const result = calculateEma(candles, 9, 'close');
    
    // Create incorrect expected values
    const expectedValues = result.values.map(v => v.value + 1); // Add 1 to all
    const validation = validateEmaCalculation(candles, 9, expectedValues);
    
    expect(validation.passed).toBe(false);
    expect(validation.firstErrorIndex).toBeGreaterThanOrEqual(8); // First valid EMA
  });
});

// ============================================================================
// Default Configurations Tests
// ============================================================================

describe('DEFAULT_EMA_CONFIGS', () => {
  it('has 4 default EMAs', () => {
    expect(DEFAULT_EMA_CONFIGS.length).toBe(4);
  });

  it('has correct periods', () => {
    const periods = DEFAULT_EMA_CONFIGS.map(c => c.period);
    expect(periods).toEqual([9, 21, 50, 200]);
  });

  it('has all visible by default', () => {
    expect(DEFAULT_EMA_CONFIGS.every(c => c.visible)).toBe(true);
  });

  it('uses close source by default', () => {
    expect(DEFAULT_EMA_CONFIGS.every(c => c.source === 'close')).toBe(true);
  });

  it('has distinct colors', () => {
    const colors = DEFAULT_EMA_CONFIGS.map(c => c.color);
    const uniqueColors = new Set(colors);
    expect(uniqueColors.size).toBe(4);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('handles single candle', () => {
    const candles = [createCandle(0, 100, 105, 95, 100)];
    const result = calculateEma(candles, 9, 'close');
    
    expect(result.values.length).toBe(1);
    expect(result.isWarmedUp).toBe(false);
  });

  it('handles identical prices', () => {
    const candles = Array(20).fill(null).map((_, i) => 
      createCandle(i, 100, 100, 100, 100)
    );
    
    const result = calculateEma(candles, 9, 'close');
    
    expect(result.isWarmedUp).toBe(true);
    
    // All valid values should be 100
    const validValues = result.values.filter(v => v.isValid);
    expect(validValues.every(v => v.value === 100)).toBe(true);
  });

  it('handles extreme price changes', () => {
    const candles = [
      createCandle(0, 100, 105, 95, 100),
      createCandle(1, 100, 200, 50, 150), // Big jump
      createCandle(2, 150, 155, 145, 150),
      createCandle(3, 150, 155, 145, 150),
      createCandle(4, 150, 155, 145, 150),
      createCandle(5, 150, 155, 145, 150),
      createCandle(6, 150, 155, 145, 150),
      createCandle(7, 150, 155, 145, 150),
      createCandle(8, 150, 155, 145, 150),
      createCandle(9, 150, 155, 145, 150),
    ];
    
    const result = calculateEma(candles, 9, 'close');
    
    expect(result.isWarmedUp).toBe(true);
    
    // EMA should be between 100 and 150
    const lastValue = result.values[result.values.length - 1].value;
    expect(lastValue).toBeGreaterThan(100);
    expect(lastValue).toBeLessThan(150);
  });

  it('handles weekend gaps (time jumps)', () => {
    const candles = [
      createCandle(0, 100, 105, 95, 100),
      createCandle(1, 100, 105, 95, 100),
      createCandle(2, 100, 105, 95, 100),
      createCandle(3, 100, 105, 95, 100),
      createCandle(4, 100, 105, 95, 100),
      // Skip 5, 6 (weekend)
      createCandle(7, 100, 105, 95, 100),
      createCandle(8, 100, 105, 95, 100),
      createCandle(9, 100, 105, 95, 100),
    ];
    
    const result = calculateEma(candles, 9, 'close');
    
    // Should still calculate correctly
    expect(result.values.length).toBe(8);
    expect(result.isWarmedUp).toBe(false); // Not enough candles
  });
});
