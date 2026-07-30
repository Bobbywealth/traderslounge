import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ISeriesApi } from 'lightweight-charts';
import { mergeLiveCandle, type CandlestickData } from './chartData';
import { createChartApiClient, type ChartApiClient } from './chartApiClient';
import { ChartRequestController, isAbortError } from './chartRequestController';

export interface UseCandlesOptions {
  symbol: string;
  timeframe: string;
  seriesRef: React.RefObject<ISeriesApi<'Candlestick'> | null>;
  enabled?: boolean;
  maxCandles?: number;
  apiClient?: ChartApiClient;
  onLoaded?: (candles: CandlestickData[]) => void;
  onPrice?: (price: number) => void;
}

export interface UseCandlesResult {
  candles: CandlestickData[];
  loading: boolean;
  connected: boolean;
  error: Error | null;
  refresh: (incremental?: boolean) => Promise<void>;
  mergeLive: (candle: CandlestickData) => void;
  getCachedCandles: (symbol?: string, timeframe?: string) => CandlestickData[];
}

const candleKey = (symbol: string, timeframe: string) => `${symbol}:${timeframe}`;

export function useCandles({
  symbol,
  timeframe,
  seriesRef,
  enabled = true,
  maxCandles = 2_000,
  apiClient,
  onLoaded,
  onPrice,
}: UseCandlesOptions): UseCandlesResult {
  const client = useMemo(() => apiClient ?? createChartApiClient(), [apiClient]);
  const controllerRef = useRef(new ChartRequestController());
  const cacheRef = useRef<Record<string, CandlestickData[]>>({});
  const loadedKeyRef = useRef('');
  const [candles, setCandles] = useState<CandlestickData[]>([]);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const getCachedCandles = useCallback((nextSymbol = symbol, nextTimeframe = timeframe) => (
    cacheRef.current[candleKey(nextSymbol, nextTimeframe)] ?? []
  ), [symbol, timeframe]);

  const refresh = useCallback(async (incremental = false) => {
    const series = seriesRef.current;
    if (!enabled || !series) return;

    const key = candleKey(symbol, timeframe);
    const request = controllerRef.current.begin(key);
    const useTinyUpdate = incremental && loadedKeyRef.current === key;
    setLoading(!useTinyUpdate);
    setError(null);

    try {
      const incoming = await client.fetchCandles(symbol, timeframe, {
        limit: useTinyUpdate ? 2 : undefined,
        signal: request.signal,
      });
      if (!controllerRef.current.isCurrent(request) || incoming.length === 0) return;

      const previous = cacheRef.current[key] ?? [];
      let next: CandlestickData[];

      if (loadedKeyRef.current !== key || previous.length === 0 || !useTinyUpdate) {
        next = incoming.slice(-maxCandles);
        series.setData(next);
        loadedKeyRef.current = key;
      } else {
        next = incoming.reduce(
          (current, candle) => mergeLiveCandle(current, candle, maxCandles),
          previous,
        );
        const last = next[next.length - 1];
        const oldLast = previous[previous.length - 1];
        if (!oldLast || Number(last.time) !== Number(oldLast.time) ||
            last.open !== oldLast.open || last.high !== oldLast.high ||
            last.low !== oldLast.low || last.close !== oldLast.close) {
          series.update(last);
        }
      }

      cacheRef.current[key] = next;
      setCandles(next);
      setConnected(true);
      onPrice?.(next[next.length - 1].close);
      onLoaded?.(next);
    } catch (caught) {
      if (!controllerRef.current.isCurrent(request) || isAbortError(caught)) return;
      const nextError = caught instanceof Error ? caught : new Error('Failed to load candles');
      setError(nextError);
      setConnected(false);
      if (loadedKeyRef.current !== key) series.setData([]);
    } finally {
      if (controllerRef.current.isCurrent(request)) setLoading(false);
    }
  }, [client, enabled, maxCandles, onLoaded, onPrice, seriesRef, symbol, timeframe]);

  const mergeLive = useCallback((candle: CandlestickData) => {
    const series = seriesRef.current;
    const key = candleKey(symbol, timeframe);
    if (!series || loadedKeyRef.current !== key) return;

    const next = mergeLiveCandle(cacheRef.current[key] ?? [], candle, maxCandles);
    if (next === cacheRef.current[key]) return;
    cacheRef.current[key] = next;
    series.update(next[next.length - 1]);
    setCandles(next);
    setConnected(true);
    onPrice?.(next[next.length - 1].close);
  }, [maxCandles, onPrice, seriesRef, symbol, timeframe]);

  useEffect(() => {
    if (!enabled) return;
    void refresh(false);
    return () => controllerRef.current.cancel();
  }, [enabled, refresh]);

  useEffect(() => () => controllerRef.current.cancel(), []);

  return { candles, loading, connected, error, refresh, mergeLive, getCachedCandles };
}
