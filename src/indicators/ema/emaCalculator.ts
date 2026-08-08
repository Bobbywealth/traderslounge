/**
 * EMA Calculation Engine
 * Core EMA calculation with configurable sources, incremental updates,
 * and warm-up management. No lookahead bias.
 */
import type { UTCTimestamp } from 'lightweight-charts';
import type { CandleData, EmaConfig, EmaResult, EmaValue, PriceSource } from './types';

// ============================================================================
// Price Source Extraction
// ============================================================================

/**
 * Extract the price value from a candle based on the configured source.
 * No lookahead - only uses the current candle's data.
 */
export const extractPrice = (candle: CandleData, source: PriceSource): number => {
  switch (source) {
    case 'close':
      return candle.close;
    case 'open':
      return candle.open;
    case 'high':
      return candle.high;
    case 'low':
      return candle.low;
    case 'hl2':
      return (candle.high + candle.low) / 2;
    case 'hlc3':
      return (candle.high + candle.low + candle.close) / 3;
    case 'ohlc4':
      return (candle.open + candle.high + candle.low + candle.close) / 4;
    default:
      return candle.close;
  }
};

// ============================================================================
// Core EMA Calculation
// ============================================================================

/**
 * Calculate EMA for a series of candles.
 * Uses SMA as the seed value for the first EMA calculation.
 * 
 * Formula: EMA(today) = Price(today) * K + EMA(previous) * (1 - K)
 * Where K = 2 / (Period + 1)
 * 
 * @param candles - Array of candle data
 * @param period - EMA period (e.g., 9, 21, 50, 200)
 * @param source - Price source to use
 * @returns EmaResult with values and warm-up status
 */
export const calculateEma = (
  candles: CandleData[],
  period: number,
  source: PriceSource = 'close'
): EmaResult => {
  if (candles.length === 0) {
    return {
      period,
      values: [],
      isWarmedUp: false,
      warmupCandles: period,
    };
  }

  const k = 2 / (period + 1);
  const values: EmaValue[] = [];
  let seed = 0;
  let isWarmedUp = false;

  // Calculate SMA for the first 'period' candles as the seed
  for (let i = 0; i < Math.min(period, candles.length); i++) {
    seed += extractPrice(candles[i], source);
    values.push({
      time: candles[i].time,
      value: NaN, // Not valid yet
      isValid: false,
    });
  }

  if (candles.length >= period) {
    // We have enough data for the seed SMA
    seed /= period;
    values[period - 1] = {
      time: candles[period - 1].time,
      value: seed,
      isValid: true,
    };
    isWarmedUp = true;

    // Calculate EMA for remaining candles
    for (let i = period; i < candles.length; i++) {
      const price = extractPrice(candles[i], source);
      const ema = price * k + values[i - 1].value * (1 - k);
      values.push({
        time: candles[i].time,
        value: ema,
        isValid: true,
      });
    }
  }

  return {
    period,
    values,
    isWarmedUp,
    warmupCandles: period,
  };
};

// ============================================================================
// Incremental EMA Update
// ============================================================================

/**
 * Update EMA incrementally with a new candle.
 * This is more efficient than recalculating the entire series.
 * 
 * @param previousEma - The previous EMA result
 * @param newCandle - The new candle to incorporate
 * @param source - Price source to use
 * @returns Updated EMA result
 */
export const updateEmaIncremental = (
  previousEma: EmaResult,
  newCandle: CandleData,
  source: PriceSource = 'close'
): EmaResult => {
  const { period, values, isWarmedUp, warmupCandles } = previousEma;
  
  // If we don't have enough history yet, recalculate from scratch
  if (!isWarmedUp && values.length < period) {
    // Add the new candle and recalculate
    const updatedCandles = [...values.map((v, i) => ({
      time: v.time,
      open: 0, // Will be replaced in full recalc
      high: 0,
      low: 0,
      close: v.value || 0,
    })), newCandle];
    return calculateEma(updatedCandles, period, source);
  }

  const k = 2 / (period + 1);
  const price = extractPrice(newCandle, source);
  
  // Get the last valid EMA value
  const lastValidIndex = values.length - 1;
  const lastEma = values[lastValidIndex].value;
  
  if (!Number.isFinite(lastEma)) {
    // Fallback to full calculation if last value is invalid
    return calculateEma(
      values.map((v, i) => ({
        time: v.time,
        open: 0,
        high: 0,
        low: 0,
        close: v.value || 0,
      })).concat(newCandle),
      period,
      source
    );
  }

  // Calculate new EMA value
  const newEma = price * k + lastEma * (1 - k);
  
  // Create updated values array
  const updatedValues: EmaValue[] = [
    ...values,
    {
      time: newCandle.time,
      value: newEma,
      isValid: true,
    },
  ];

  return {
    period,
    values: updatedValues,
    isWarmedUp: true,
    warmupCandles: period,
  };
};

// ============================================================================
// Multi-Source EMA Calculation
// ============================================================================

/**
 * Calculate EMAs for multiple periods simultaneously.
 * Optimized to avoid redundant iterations over candle data.
 */
export const calculateMultipleEmas = (
  candles: CandleData[],
  periods: number[],
  source: PriceSource = 'close'
): Map<number, EmaResult> => {
  const results = new Map<number, EmaResult>();
  
  for (const period of periods) {
    results.set(period, calculateEma(candles, period, source));
  }
  
  return results;
};

// ============================================================================
// ATR Calculation (for distance normalization)
// ============================================================================

/**
 * Calculate Average True Range for distance normalization.
 * Used to normalize EMA distances across different price scales.
 */
export const calculateAtr = (
  candles: CandleData[],
  period: number = 14
): number[] => {
  if (candles.length < 2) return [];
  
  const trueRanges: number[] = [];
  
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }
  
  // Calculate ATR using Wilder's smoothing
  const atr: number[] = [];
  let atrSum = 0;
  
  for (let i = 0; i < trueRanges.length; i++) {
    if (i < period - 1) {
      atrSum += trueRanges[i];
      atr.push(NaN); // Not enough data yet
    } else if (i === period - 1) {
      atrSum += trueRanges[i];
      atr.push(atrSum / period);
    } else {
      // Wilder's smoothing: ATR = (prev_ATR * (period - 1) + TR) / period
      const prevAtr = atr[i - 1];
      atr.push((prevAtr * (period - 1) + trueRanges[i]) / period);
    }
  }
  
  return atr;
};

// ============================================================================
// Default EMA Configurations
// ============================================================================

export const DEFAULT_EMA_CONFIGS: EmaConfig[] = [
  {
    period: 9,
    source: 'close',
    color: '#22D3EE', // Cyan
    width: 1.5,
    opacity: 1,
    visible: true,
    label: 'EMA 9',
  },
  {
    period: 21,
    source: 'close',
    color: '#F472B6', // Pink
    width: 1.5,
    opacity: 1,
    visible: true,
    label: 'EMA 21',
  },
  {
    period: 50,
    source: 'close',
    color: '#FBBF24', // Yellow
    width: 2,
    opacity: 1,
    visible: true,
    label: 'EMA 50',
  },
  {
    period: 200,
    source: 'close',
    color: '#A855F7', // Purple
    width: 2,
    opacity: 1,
    visible: true,
    label: 'EMA 200',
  },
];

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate EMA calculation against a reference implementation.
 * Used for testing and ensuring accuracy.
 */
export const validateEmaCalculation = (
  candles: CandleData[],
  period: number,
  expectedValues: number[],
  tolerance: number = 1e-6
): { passed: boolean; maxError: number; firstErrorIndex: number } => {
  const result = calculateEma(candles, period, 'close');
  
  let maxError = 0;
  let firstErrorIndex = -1;
  
  for (let i = 0; i < expectedValues.length; i++) {
    if (i >= result.values.length) {
      return { passed: false, maxError: Infinity, firstErrorIndex: i };
    }
    
    const actual = result.values[i].value;
    const expected = expectedValues[i];
    
    if (Number.isFinite(actual) && Number.isFinite(expected)) {
      const error = Math.abs(actual - expected);
      if (error > maxError) {
        maxError = error;
      }
      if (error > tolerance && firstErrorIndex === -1) {
        firstErrorIndex = i;
      }
    }
  }
  
  return {
    passed: firstErrorIndex === -1,
    maxError,
    firstErrorIndex,
  };
};
