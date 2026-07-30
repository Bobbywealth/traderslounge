import { describe, expect, it } from 'vitest';
import {
  mergeLiveCandle,
  normalizeCandleSeries,
  normalizeHistoryCandle,
} from './chartData';

describe('chart data normalization', () => {
  it('normalizes tuple and object candles', () => {
    expect(normalizeHistoryCandle([1_720_000_000_000, '10', '12', '9', '11'])).toEqual({
      time: 1_720_000_000,
      open: 10,
      high: 12,
      low: 9,
      close: 11,
    });

    expect(normalizeHistoryCandle({ timestamp: 1_720_000_060, open: 11, high: 13, low: 10, close: 12 })).toEqual({
      time: 1_720_000_060,
      open: 11,
      high: 13,
      low: 10,
      close: 12,
    });
  });

  it('rejects malformed OHLC data', () => {
    expect(normalizeHistoryCandle({ time: 10, open: 10, high: 8, low: 9, close: 10 })).toBeNull();
    expect(normalizeHistoryCandle({ time: 'bad', open: 10, high: 11, low: 9, close: 10 })).toBeNull();
  });

  it('sorts and deduplicates historical candles by timestamp', () => {
    const result = normalizeCandleSeries([
      [20, 2, 3, 1, 2.5],
      [10, 1, 2, 0.5, 1.5],
      [20, 2.5, 4, 2, 3.5],
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].time).toBe(10);
    expect(result[1].close).toBe(3.5);
  });

  it('updates the current live candle without duplicating it', () => {
    const candles = normalizeCandleSeries([
      [10, 1, 2, 0.5, 1.5],
      [20, 2, 3, 1, 2.5],
    ]);

    const result = mergeLiveCandle(candles, {
      time: 20,
      open: 2,
      high: 4,
      low: 1,
      close: 3.5,
    });

    expect(result).toHaveLength(2);
    expect(result[1].close).toBe(3.5);
  });

  it('ignores out-of-order live candles and bounds cache growth', () => {
    const candles = normalizeCandleSeries([
      [10, 1, 2, 0.5, 1.5],
      [20, 2, 3, 1, 2.5],
    ]);

    expect(mergeLiveCandle(candles, { time: 15, open: 1, high: 2, low: 1, close: 2 })).toBe(candles);

    const bounded = mergeLiveCandle(candles, { time: 30, open: 3, high: 4, low: 2, close: 3.5 }, 2);
    expect(bounded.map((candle) => candle.time)).toEqual([20, 30]);
  });
});
