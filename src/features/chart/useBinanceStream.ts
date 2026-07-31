import { useEffect, useRef, useState } from 'react';
import type { UTCTimestamp } from 'lightweight-charts';
import type { CandlestickData } from './chartData';
import { BINANCE_TRADE_STREAMS, TIMEFRAME_SECONDS } from './constants';

const FLUSH_INTERVAL_MS = 250;

export interface UseBinanceStreamOptions {
  symbol: string;
  timeframe: string;
  enabled?: boolean;
  /** Latest cached candle for the active symbol/timeframe, if any. */
  getLastCandle: () => CandlestickData | undefined;
  /** Receives the bucketed candle built from each trade. */
  onCandle: (candle: CandlestickData) => void;
  onOpen?: () => void;
}

export interface UseBinanceStreamResult {
  streaming: boolean;
  /** True when the symbol/timeframe pair has a public trade stream at all. */
  supported: boolean;
}

/**
 * Streams live trades from the public Binance market-data feed and folds them
 * into timeframe buckets. Reconnects automatically until unmounted or the
 * symbol changes.
 */
export function useBinanceStream({
  symbol,
  timeframe,
  enabled = true,
  getLastCandle,
  onCandle,
  onOpen,
}: UseBinanceStreamOptions): UseBinanceStreamResult {
  const [streaming, setStreaming] = useState(false);
  const callbacksRef = useRef({ getLastCandle, onCandle, onOpen });
  callbacksRef.current = { getLastCandle, onCandle, onOpen };

  const streamSymbol = BINANCE_TRADE_STREAMS[symbol];
  const bucketSeconds = TIMEFRAME_SECONDS[timeframe];
  const supported = Boolean(streamSymbol && bucketSeconds);

  useEffect(() => {
    if (!enabled || !streamSymbol || !bucketSeconds) {
      setStreaming(false);
      return;
    }

    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;

    // Busy markets can push tens of trades per second; folding them into a
    // pending candle and flushing on an interval keeps every tick's
    // high/low/close while capping downstream React updates.
    let pendingCandle: CandlestickData | null = null;
    let flushTimer: number | undefined;
    let lastFlush = 0;
    const flushPending = () => {
      if (!pendingCandle) return;
      const candle = pendingCandle;
      pendingCandle = null;
      callbacksRef.current.onCandle(candle);
    };
    const scheduleFlush = () => {
      const now = performance.now();
      if (now - lastFlush >= FLUSH_INTERVAL_MS) {
        lastFlush = now;
        if (flushTimer) {
          window.clearTimeout(flushTimer);
          flushTimer = undefined;
        }
        flushPending();
        return;
      }
      if (flushTimer == null) {
        flushTimer = window.setTimeout(() => {
          flushTimer = undefined;
          lastFlush = performance.now();
          flushPending();
        }, FLUSH_INTERVAL_MS - (now - lastFlush));
      }
    };

    const connect = () => {
      if (disposed) return;
      const ws = new WebSocket(`wss://data-stream.binance.vision/ws/${streamSymbol}@trade`);
      socket = ws;
      ws.onopen = () => {
        if (disposed) return;
        setStreaming(true);
        callbacksRef.current.onOpen?.();
      };
      ws.onmessage = (event) => {
        if (disposed) return;
        try {
          const message = JSON.parse(event.data);
          const price = Number(message?.p);
          const tradeTime = Math.floor(Number(message?.T) / 1000);
          if (!Number.isFinite(price) || !Number.isFinite(tradeTime)) return;
          const bucketTime = Math.floor(tradeTime / bucketSeconds) * bucketSeconds;
          const base = pendingCandle && Number(pendingCandle.time) === bucketTime
            ? pendingCandle
            : callbacksRef.current.getLastCandle();
          pendingCandle = base && Number(base.time) === bucketTime
            ? {
                ...base,
                high: Math.max(base.high, price),
                low: Math.min(base.low, price),
                close: price,
              }
            : {
                time: bucketTime as UTCTimestamp,
                open: price,
                high: price,
                low: price,
                close: price,
              };
          scheduleFlush();
        } catch (error) {
          console.warn('Invalid Binance market-data event:', error);
        }
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (socket === ws) socket = null;
        if (!disposed) {
          setStreaming(false);
          reconnectTimer = window.setTimeout(connect, 2000);
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (flushTimer) window.clearTimeout(flushTimer);
      pendingCandle = null;
      if (socket) {
        socket.onclose = null;
        socket.close();
        socket = null;
      }
      setStreaming(false);
    };
  }, [enabled, streamSymbol, bucketSeconds]);

  return { streaming, supported };
}
