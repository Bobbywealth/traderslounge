/* In-place chart indicators used by TradingView.tsx. lightweight-charts has
 * no built-in indicator registry, so the study math is done here and the
 * resulting line series is fed back to the chart manually.
 */
import type { UTCTimestamp } from 'lightweight-charts';

export interface IndicatorCandle {
  time: UTCTimestamp;
  close: number;
}

const emaAt = (values: number[], period: number): number[] => {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out: number[] = new Array(values.length).fill(NaN);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  out[period - 1] = seed / period;
  for (let i = period; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
};

export const computeEma = (values: number[], period: number): number[] => {
  return emaAt(values, period);
};

export const computeBollinger = (values: number[], period: number, stdMultiplier: number) => {
  const upper: number[] = new Array(values.length).fill(NaN);
  const lower: number[] = new Array(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    const mean = sum / period;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (values[j] - mean) ** 2;
    variance /= period;
    const std = Math.sqrt(variance);
    upper[i] = mean + stdMultiplier * std;
    lower[i] = mean - stdMultiplier * std;
  }
  return { upper, lower };
};

export const mergeLineWithTime = (candles: IndicatorCandle[], values: number[]) => {
  const out: { time: UTCTimestamp; value: number }[] = [];
  for (let i = 0; i < candles.length; i++) {
    const value = values[i];
    if (Number.isFinite(value)) {
      out.push({ time: candles[i].time, value });
    }
  }
  return out;
};
