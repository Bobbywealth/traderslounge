/**
 * Hook for managing chart candle data with proper race condition handling.
 * 
 * This hook wraps the existing useCandles hook and adds:
 * - Integration with the centralized API client
 * - Proper cleanup on symbol/timeframe changes
 * - WebSocket live update merging
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ISeriesApi } from 'lightweight-charts';
import { useCandles, type UseCandlesResult } from '../../features/chart/useCandles';
import { createChartApiClient } from '../../features/chart/chartApiClient';
import { mergeLiveCandle, type CandlestickData } from '../../features/chart/chartData';

interface UseChartCandlesOptions {
  symbol: string;
  timeframe: string;
  seriesRef: React.RefObject<ISeriesApi<'Candlestick'> | null>;
  enabled?: boolean;
  maxCandles?: number;
  onPrice?: (price: number) => void;
}

interface UseChartCandlesReturn extends UseCandlesResult {
  // Additional utilities
  reload: () => Promise<void>;
  loadSymbol: (newSymbol: string, newTimeframe: string) => Promise<void>;
}

export function useChartCandles({
  symbol,
  timeframe,
  seriesRef,
  enabled = true,
  maxCandles = 2000,
  onPrice,
}: UseChartCandlesOptions): UseChartCandlesReturn {
  const [currentSymbol, setCurrentSymbol] = useState(symbol);
  const [currentTimeframe, setCurrentTimeframe] = useState(timeframe);
  const isLoadingRef = useRef(false);
  
  // Create API client
  const apiClient = createChartApiClient();
  
  // Use the underlying useCandles hook
  const {
    candles,
    loading,
    connected,
    error,
    refresh,
    mergeLive,
    getCachedCandles,
  } = useCandles({
    symbol: currentSymbol,
    timeframe: currentTimeframe,
    seriesRef,
    enabled,
    maxCandles,
    apiClient,
    onPrice,
  });
  
  // Reload current symbol/timeframe
  const reload = useCallback(async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    try {
      await refresh(false);
    } finally {
      isLoadingRef.current = false;
    }
  }, [refresh]);
  
  // Load a new symbol/timeframe with proper cleanup
  const loadSymbol = useCallback(async (newSymbol: string, newTimeframe: string) => {
    // Skip if already on this symbol/timeframe
    if (newSymbol === currentSymbol && newTimeframe === currentTimeframe) {
      return;
    }
    
    // Update state - this will trigger re-render and useCandles will reload
    setCurrentSymbol(newSymbol);
    setCurrentTimeframe(newTimeframe);
  }, [currentSymbol, currentTimeframe]);
  
  // Sync external prop changes
  useEffect(() => {
    if (symbol !== currentSymbol) {
      setCurrentSymbol(symbol);
    }
  }, [symbol, currentSymbol]);
  
  useEffect(() => {
    if (timeframe !== currentTimeframe) {
      setCurrentTimeframe(timeframe);
    }
  }, [timeframe, currentTimeframe]);
  
  return {
    candles,
    loading,
    connected,
    error,
    refresh,
    mergeLive,
    getCachedCandles,
    reload,
    loadSymbol,
  };
}

/**
 * Helper to create a mock WebSocket for testing
 */
export function createMockWebSocket(
  onMessage: (candle: CandlestickData) => void,
  intervalMs = 1000
): WebSocket {
  const ws = {
    readyState: WebSocket.OPEN,
    send: () => {},
    close: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as WebSocket;
  
  // Simulate candle updates
  const interval = setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    const candle: CandlestickData = {
      time: now as any,
      open: 100 + Math.random() * 10,
      high: 110 + Math.random() * 5,
      low: 95 + Math.random() * 5,
      close: 100 + Math.random() * 10,
    };
    onMessage(candle);
  }, intervalMs);
  
  // Store interval for cleanup
  (ws as any)._interval = interval;
  
  return ws;
}
