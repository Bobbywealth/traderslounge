export type AssetClass = 'forex' | 'stock' | 'crypto' | 'commodity';

export interface CandlestickInput {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type IndicatorConfig = {
  ema20: boolean;
  ema50: boolean;
  ema200: boolean;
  sma50: boolean;
  sma200: boolean;
  vwap: boolean;
  bollinger: boolean;
};

export const DEFAULT_INDICATORS: IndicatorConfig = {
  ema20: false,
  ema50: true,
  ema200: false,
  sma50: false,
  sma200: false,
  vwap: false,
  bollinger: false,
};

export function sma(closes: number[], period: number): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) {
      out[i] = sum / period;
    }
  }
  return out;
}

export function ema(closes: number[], period: number): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  if (period <= 0 || closes.length === 0) return out;
  const alpha = 2 / (period + 1);
  let seedSum = 0;
  for (let i = 0; i < period && i < closes.length; i++) {
    seedSum += closes[i];
  }
  if (closes.length < period) return out;
  out[period - 1] = seedSum / period;
  let prev = out[period - 1] as number;
  for (let i = period; i < closes.length; i++) {
    const v = alpha * closes[i] + (1 - alpha) * prev;
    out[i] = v;
    prev = v;
  }
  return out;
}

export function sessionStart(timeSec: number, assetType: AssetClass): number {
  const d = new Date(timeSec * 1000);
  if (assetType === 'crypto') {
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
  }
  const utcMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const nyMidnight = new Date(utcMs);
  const nyOffsetMs = -5 * 3600 * 1000;
  const nyLocalMs = utcMs + nyOffsetMs;
  const nyLocal = new Date(nyLocalMs);
  const nyDayStartUtc = Date.UTC(
    nyLocal.getUTCFullYear(),
    nyLocal.getUTCMonth(),
    nyLocal.getUTCDate(),
  );
  const dayStartSec = Math.floor(nyDayStartUtc / 1000) - nyOffsetMs / 1000;
  if (timeSec < dayStartSec) {
    return dayStartSec - 86400;
  }
  return dayStartSec;
}

export function vwapSeries(
  candles: CandlestickInput[],
  assetType: AssetClass,
): Array<number | null> {
  const out: Array<number | null> = new Array(candles.length).fill(null);
  let cumPV = 0;
  let cumV = 0;
  let currentSession = sessionStart(candles[0]?.time ?? 0, assetType);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const t = c.time;
    const sess = sessionStart(t, assetType);
    if (sess !== currentSession) {
      cumPV = 0;
      cumV = 0;
      currentSession = sess;
    }
    const typical = (c.high + c.low + c.close) / 3;
    const vol = c.volume ?? 0;
    if (vol <= 0) {
      out[i] = cumV > 0 ? cumPV / cumV : null;
      continue;
    }
    cumPV += typical * vol;
    cumV += vol;
    out[i] = cumPV / cumV;
  }
  return out;
}

export function bollinger(
  closes: number[],
  period: number = 20,
  mult: number = 2,
): { upper: Array<number | null>; middle: Array<number | null>; lower: Array<number | null> } {
  const middle = sma(closes, period);
  const upper: Array<number | null> = new Array(closes.length).fill(null);
  const lower: Array<number | null> = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let sumSq = 0;
    for (let k = i - period + 1; k <= i; k++) {
      const d = closes[k] - (middle[i] as number);
      sumSq += d * d;
    }
    const sd = Math.sqrt(sumSq / period);
    upper[i] = (middle[i] as number) + mult * sd;
    lower[i] = (middle[i] as number) - mult * sd;
  }
  return { upper, middle, lower };
}