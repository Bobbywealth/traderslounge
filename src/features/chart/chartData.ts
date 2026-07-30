import type { UTCTimestamp } from 'lightweight-charts';

export interface CandlestickData {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface HistoryCandleRecord {
  t?: number | string;
  time?: number | string;
  timestamp?: number | string;
  o?: number | string;
  h?: number | string;
  l?: number | string;
  c?: number | string;
  open?: number | string;
  high?: number | string;
  low?: number | string;
  close?: number | string;
  [key: string]: unknown;
}

export type HistoryCandle = HistoryCandleRecord | Array<number | string>;

export function normalizeHistoryCandle(candle: HistoryCandle): CandlestickData | null {
  const tuple = Array.isArray(candle) ? candle : null;
  const record = candle as HistoryCandleRecord;

  const timeRaw = tuple?.[0] ?? record.t ?? record.time ?? record.timestamp;
  const openRaw = tuple?.[1] ?? record.o ?? record.open;
  const highRaw = tuple?.[2] ?? record.h ?? record.high;
  const lowRaw = tuple?.[3] ?? record.l ?? record.low;
  const closeRaw = tuple?.[4] ?? record.c ?? record.close;

  if (timeRaw == null || openRaw == null || highRaw == null || lowRaw == null || closeRaw == null) {
    return null;
  }

  const rawTime = Number(timeRaw);
  const normalizedTime = rawTime > 1_000_000_000_000
    ? Math.floor(rawTime / 1000)
    : Math.floor(rawTime);
  const open = Number(openRaw);
  const high = Number(highRaw);
  const low = Number(lowRaw);
  const close = Number(closeRaw);

  if (![normalizedTime, open, high, low, close].every(Number.isFinite)) {
    return null;
  }

  if (high < low || high < Math.max(open, close) || low > Math.min(open, close)) {
    return null;
  }

  return {
    time: normalizedTime as UTCTimestamp,
    open,
    high,
    low,
    close,
  };
}

export function normalizeCandleSeries(candles: HistoryCandle[]): CandlestickData[] {
  const byTimestamp = new Map<number, CandlestickData>();

  for (const rawCandle of candles) {
    const candle = normalizeHistoryCandle(rawCandle);
    if (candle) byTimestamp.set(Number(candle.time), candle);
  }

  return [...byTimestamp.values()].sort((a, b) => Number(a.time) - Number(b.time));
}

export function mergeLiveCandle(
  candles: CandlestickData[],
  incoming: CandlestickData,
  maxCandles = 2_000,
): CandlestickData[] {
  if (candles.length === 0) return [incoming];

  const last = candles[candles.length - 1];
  const incomingTime = Number(incoming.time);
  const lastTime = Number(last.time);

  if (incomingTime < lastTime) return candles;

  const next = incomingTime === lastTime
    ? [...candles.slice(0, -1), incoming]
    : [...candles, incoming];

  return next.length > maxCandles ? next.slice(next.length - maxCandles) : next;
}
