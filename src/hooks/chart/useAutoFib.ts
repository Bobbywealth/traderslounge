/**
 * Hook for automatic Fibonacci level calculations.
 * 
 * Handles:
 * - Auto-detecting swing highs/lows
 * - Calculating Fibonacci retracement levels
 * - Integration with engine swing data
 */
import { useCallback } from 'react';
import type { CryptoAnalysis } from '../../services/bwtsApi';
import type { CandlestickData } from '../../features/chart/chartData';

interface DrawingPoint {
  time: number;
  price: number;
}

interface FibonacciLevel {
  price: number;
  ratio: number;
  label: string;
}

interface UseAutoFibOptions {
  candles: CandlestickData[];
  analysis: CryptoAnalysis | null;
  timeframe: string;
}

interface UseAutoFibReturn {
  calculateAutoFib: () => { point1: DrawingPoint; point2: DrawingPoint; levels: FibonacciLevel[] } | null;
  getSwingPoints: () => { low: DrawingPoint; high: DrawingPoint } | null;
}

// Standard Fibonacci ratios
const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export function useAutoFib({
  candles,
  analysis,
  timeframe,
}: UseAutoFibOptions): UseAutoFibReturn {
  // Get time multiplier for timeframe
  const getTimeMultiplier = useCallback(() => {
    const multipliers: Record<string, number> = {
      '1m': 60,
      '5m': 300,
      '15m': 900,
      '1h': 3600,
      '4h': 14400,
      '1d': 86400,
      '1w': 604800,
    };
    return multipliers[timeframe] || 3600;
  }, [timeframe]);
  
  // Get swing points from analysis or candles
  const getSwingPoints = useCallback((): { low: DrawingPoint; high: DrawingPoint } | null => {
    if (!candles || candles.length < 5) return null;
    
    // Try to get from analysis first
    const fibZones = analysis?.zones?.fibonacci;
    const swingLow = Number(fibZones?.swing_low ?? fibZones?.leg?.swing_low);
    const swingHigh = Number(fibZones?.swing_high ?? fibZones?.leg?.swing_high);
    const swingStartTime = Number(fibZones?.swing_start_time);
    const swingStartPrice = Number(fibZones?.swing_start_price);
    const swingEndTime = Number(fibZones?.swing_end_time);
    const swingEndPrice = Number(fibZones?.swing_end_price);
    
    // Use engine swing if available
    if (Number.isFinite(swingStartPrice) && Number.isFinite(swingEndPrice) && 
        Number.isFinite(swingStartTime) && Number.isFinite(swingEndTime)) {
      return {
        low: { time: swingStartTime, price: swingStartPrice },
        high: { time: swingEndTime, price: swingEndPrice },
      };
    }
    
    // Use swing low/high from analysis
    if (Number.isFinite(swingLow) && Number.isFinite(swingHigh)) {
      // Find candle indexes closest to swing points
      let loIdx = 0;
      let hiIdx = 0;
      let loDelta = Infinity;
      let hiDelta = Infinity;
      
      for (let i = 0; i < candles.length; i++) {
        const c = candles[i] as any;
        const t = Number(c.time ?? c.t ?? 0);
        const lo = Math.abs(Number(c.low ?? c.l ?? 0) - swingLow);
        const hi = Math.abs(Number(c.high ?? c.h ?? 0) - swingHigh);
        if (lo < loDelta) { loDelta = lo; loIdx = i; }
        if (hi < hiDelta) { hiDelta = hi; hiIdx = i; }
      }
      
      const loCandle = candles[loIdx] as any;
      const hiCandle = candles[hiIdx] as any;
      
      return {
        low: { time: Number(loCandle.time ?? loCandle.t ?? 0), price: swingLow },
        high: { time: Number(hiCandle.time ?? hiCandle.t ?? 0), price: swingHigh },
      };
    }
    
    // Fallback: find most extreme high/low in last 80 candles
    const window = candles.slice(-80);
    let hiIdx = 0;
    let loIdx = 0;
    let hiPrice = -Infinity;
    let loPrice = Infinity;
    
    for (let i = 0; i < window.length; i++) {
      const c = window[i] as any;
      const high = Number(c.high ?? c.h ?? 0);
      const low = Number(c.low ?? c.l ?? Infinity);
      if (high > hiPrice) { hiPrice = high; hiIdx = i; }
      if (low < loPrice) { loPrice = low; loIdx = i; }
    }
    
    const highCandle = window[hiIdx] as any;
    const lowCandle = window[loIdx] as any;
    const highTime = Number(highCandle.time ?? highCandle.t ?? 0);
    const lowTime = Number(lowCandle.time ?? lowCandle.t ?? 0);
    
    if (!highTime || !lowTime || !hiPrice || !loPrice) return null;
    
    return loIdx <= hiIdx 
      ? { low: { time: lowTime, price: loPrice }, high: { time: highTime, price: hiPrice } }
      : { low: { time: highTime, price: hiPrice }, high: { time: lowTime, price: loPrice } };
  }, [candles, analysis]);
  
  // Calculate auto Fibonacci levels
  const calculateAutoFib = useCallback(() => {
    const swingPoints = getSwingPoints();
    if (!swingPoints) return null;
    
    const { low, high } = swingPoints;
    const range = high.price - low.price;
    
    // Calculate Fibonacci levels
    const levels: FibonacciLevel[] = FIB_RATIOS.map(ratio => ({
      price: low.price + (range * ratio),
      ratio,
      label: ratio === 0 ? '0%' : 
             ratio === 0.236 ? '23.6%' : 
             ratio === 0.382 ? '38.2%' : 
             ratio === 0.5 ? '50%' : 
             ratio === 0.618 ? '61.8%' : 
             ratio === 0.786 ? '78.6%' : 
             ratio === 1 ? '100%' : `${(ratio * 100).toFixed(1)}%`,
    }));
    
    return {
      point1: low,
      point2: high,
      levels,
    };
  }, [getSwingPoints]);
  
  return {
    calculateAutoFib,
    getSwingPoints,
  };
}
