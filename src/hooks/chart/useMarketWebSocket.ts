/**
 * Hook for managing market data WebSocket connection.
 * 
 * Handles:
 * - Binance WebSocket for live price updates
 * - Automatic reconnection with exponential backoff
 * - Symbol/timeframe subscription management
 * - Cleanup on unmount
 */
import { useCallback, useEffect, useRef, useState } from 'react';

interface UseMarketWebSocketOptions {
  symbol: string;
  timeframe: string;
  enabled?: boolean;
  onPriceUpdate?: (price: number) => void;
  onCandleUpdate?: (candle: any) => void;
}

interface UseMarketWebSocketReturn {
  isConnected: boolean;
  isStreaming: boolean;
  lastPrice: number | null;
  error: string | null;
  reconnect: () => void;
}

export function useMarketWebSocket({
  symbol,
  timeframe,
  enabled = true,
  onPriceUpdate,
  onCandleUpdate,
}: UseMarketWebSocketOptions): UseMarketWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const reconnectAttemptsRef = useRef(0);
  const disposedRef = useRef(false);
  const lastSymbolRef = useRef(symbol);
  const lastTimeframeRef = useRef(timeframe);
  
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Map timeframe to Binance interval
  const getInterval = useCallback((tf: string): string => {
    const mapping: Record<string, string> = {
      '1m': '1m',
      '5m': '5m',
      '15m': '15m',
      '1h': '1h',
      '4h': '4h',
      '1d': '1d',
      '1w': '1w',
    };
    return mapping[tf] || '1h';
  }, []);
  
  // Get Binance symbol format
  const getBinanceSymbol = useCallback((sym: string): string => {
    // Convert from our format (BTCUSD) to Binance format (BTCUSDT)
    if (sym.endsWith('USD') && !sym.endsWith('USDT')) {
      return `${sym.slice(0, -3)}USDT`;
    }
    return sym;
  }, []);
  
  // Connect to WebSocket
  const connect = useCallback(() => {
    if (disposedRef.current || !enabled) return;
    
    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    const binanceSymbol = getBinanceSymbol(symbol).toLowerCase();
    const interval = getInterval(timeframe);
    const streamName = `${binanceSymbol}@kline_${interval}`;
    const url = `wss://stream.binance.com:9443/ws/${streamName}`;
    
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      
      ws.onopen = () => {
        if (disposedRef.current) return;
        console.log('[MarketWS] Connected:', url);
        setIsConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
        
        // Subscribe to the stream
        ws.send(JSON.stringify({
          method: 'SUBSCRIBE',
          params: [streamName],
          id: Date.now(),
        }));
      };
      
      ws.onmessage = (event) => {
        if (disposedRef.current) return;
        
        try {
          const data = JSON.parse(event.data);
          
          // Handle kline data
          if (data.e === 'kline') {
            const kline = data.k;
            const price = parseFloat(kline.c); // Current price
            
            setLastPrice(price);
            setIsStreaming(true);
            
            // Notify callbacks
            onPriceUpdate?.(price);
            onCandleUpdate?.({
              time: Math.floor(kline.t / 1000),
              open: parseFloat(kline.o),
              high: parseFloat(kline.h),
              low: parseFloat(kline.l),
              close: parseFloat(kline.c),
              volume: parseFloat(kline.v),
            });
          }
        } catch (e) {
          console.error('[MarketWS] Parse error:', e);
        }
      };
      
      ws.onerror = (event) => {
        if (disposedRef.current) return;
        console.error('[MarketWS] Error:', event);
        setError('WebSocket error');
      };
      
      ws.onclose = (event) => {
        if (disposedRef.current) return;
        console.log('[MarketWS] Closed:', event.code, event.reason);
        setIsConnected(false);
        setIsStreaming(false);
        
        // Attempt reconnect with exponential backoff
        if (!disposedRef.current && enabled) {
          const attempts = reconnectAttemptsRef.current;
          const delay = Math.min(1000 * Math.pow(2, attempts), 30000);
          
          console.log(`[MarketWS] Reconnecting in ${delay}ms (attempt ${attempts + 1})`);
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connect();
          }, delay);
        }
      };
    } catch (e) {
      console.error('[MarketWS] Connection error:', e);
      setError('Failed to connect');
    }
  }, [symbol, timeframe, enabled, getInterval, getBinanceSymbol, onPriceUpdate, onCandleUpdate]);
  
  // Reconnect when symbol or timeframe changes
  useEffect(() => {
    if (lastSymbolRef.current !== symbol || lastTimeframeRef.current !== timeframe) {
      lastSymbolRef.current = symbol;
      lastTimeframeRef.current = timeframe;
      reconnectAttemptsRef.current = 0;
      connect();
    }
  }, [symbol, timeframe, connect]);
  
  // Initial connection
  useEffect(() => {
    if (enabled) {
      connect();
    }
    
    return () => {
      disposedRef.current = true;
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      
      setIsConnected(false);
      setIsStreaming(false);
    };
  }, [enabled, connect]);
  
  // Manual reconnect
  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    connect();
  }, [connect]);
  
  return {
    isConnected,
    isStreaming,
    lastPrice,
    error,
    reconnect,
  };
}
