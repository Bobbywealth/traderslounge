/**
 * Hook for managing crypto analysis state and API calls.
 * 
 * Handles:
 * - Fetching crypto analysis from API
 * - Managing analysis state
 * - Computing derived values (setup readiness, zones, etc.)
 */
import { useCallback, useMemo, useState } from 'react';
import { bwtsApi, type CryptoAnalysis } from '../../services/bwtsApi';
import type { CandlestickData } from '../../features/chart/chartData';

interface UseCryptoAnalysisOptions {
  symbol: string;
  timeframe: string;
  currentPrice: number;
  candles: CandlestickData[];
}

interface UseCryptoAnalysisReturn {
  analysis: CryptoAnalysis | null;
  isLoading: boolean;
  error: string | null;
  fetchAnalysis: () => Promise<void>;
  setupReady: boolean;
  setupHardBlocked: boolean;
  setupZones: any[];
  setupCalendarStatus: string;
  setupTimingStatus: string;
  assetClass: 'crypto' | 'forex' | 'commodity' | 'stock';
}

export function useCryptoAnalysis({
  symbol,
  timeframe,
  currentPrice,
  candles,
}: UseCryptoAnalysisOptions): UseCryptoAnalysisReturn {
  const [analysis, setAnalysis] = useState<CryptoAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Fetch analysis from API
  const fetchAnalysis = useCallback(async () => {
    if (!symbol || !timeframe) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const result = await bwtsApi.analyzeCrypto(symbol, timeframe, {
        currentPrice,
        candleCount: candles.length,
      });
      
      setAnalysis(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch analysis');
    } finally {
      setIsLoading(false);
    }
  }, [symbol, timeframe, currentPrice, candles.length]);
  
  // Compute setup readiness
  const setupCalendarStatus = useMemo(() => {
    return String(analysis?.trade_plan?.calendar_status || analysis?.economic_calendar?.status || '').toUpperCase();
  }, [analysis]);
  
  const setupTimingStatus = useMemo(() => {
    return String(analysis?.trade_plan?.timing_status || analysis?.trade_timing?.status || 'WAIT').toUpperCase();
  }, [analysis]);
  
  const setupHardBlocked = useMemo(() => {
    return ['BLOCKED', 'POST_NEWS', 'UNAVAILABLE'].includes(setupCalendarStatus);
  }, [setupCalendarStatus]);
  
  const setupReady = useMemo(() => {
    return Boolean(analysis?.trade_plan?.eligible) && 
           setupTimingStatus === 'READY' && 
           !setupHardBlocked;
  }, [analysis, setupTimingStatus, setupHardBlocked]);
  
  // Extract and deduplicate setup zones
  const setupZones = useMemo(() => {
    if (!analysis?.zones?.setup_zones) return [];
    
    return analysis.zones.setup_zones
      .filter((zone: any) => 
        ['BUY', 'SELL'].includes(zone.direction) && 
        Number.isFinite(Number(zone.low)) && 
        Number.isFinite(Number(zone.high))
      )
      .filter((zone: any, index: number, zones: any[]) => 
        zones.findIndex((item) => item.direction === zone.direction) === index
      )
      .slice(0, 2);
  }, [analysis]);
  
  // Determine asset class from symbol
  const assetClass = useMemo((): 'crypto' | 'forex' | 'commodity' | 'stock' => {
    const symbolUpper = symbol.toUpperCase();
    
    if (symbolUpper.includes('BTC') || symbolUpper.includes('ETH') || symbolUpper.includes('USD')) {
      if (symbolUpper.endsWith('USD') && !symbolUpper.startsWith('USD')) {
        return 'crypto';
      }
    }
    
    if (symbolUpper.includes('EUR') || symbolUpper.includes('GBP') || 
        symbolUpper.includes('JPY') || symbolUpper.includes('AUD') ||
        symbolUpper.includes('CAD') || symbolUpper.includes('CHF')) {
      return 'forex';
    }
    
    if (symbolUpper.includes('XAU') || symbolUpper.includes('XAG') || 
        symbolUpper.includes('GOLD') || symbolUpper.includes('SILVER')) {
      return 'commodity';
    }
    
    return 'stock';
  }, [symbol]);
  
  return {
    analysis,
    isLoading,
    error,
    fetchAnalysis,
    setupReady,
    setupHardBlocked,
    setupZones,
    setupCalendarStatus,
    setupTimingStatus,
    assetClass,
  };
}
