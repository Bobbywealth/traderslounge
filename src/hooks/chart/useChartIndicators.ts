/**
 * Hook for managing chart indicators (Volume, RSI, EMA, Bollinger Bands).
 * 
 * Handles:
 * - Indicator state management
 * - Series creation and updates
 * - Divergence detection
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { computeVolume, computeRsi, detectDivergence, type Divergence } from '../../components/chartPanes';
import { computeEma, computeBollinger } from '../../components/chartIndicators';

interface CandlestickData {
  time: any;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface UseChartIndicatorsOptions {
  chart: IChartApi | null;
  volumeContainerRef: React.RefObject<HTMLDivElement | null>;
  rsiContainerRef: React.RefObject<HTMLDivElement | null>;
  candles: CandlestickData[];
  enabled?: boolean;
}

interface UseChartIndicatorsReturn {
  showVolume: boolean;
  showRsi: boolean;
  showEma: boolean;
  showBands: boolean;
  divergences: Divergence[];
  divergenceRevision: number;
  setShowVolume: (show: boolean) => void;
  setShowRsi: (show: boolean) => void;
  setShowEma: (show: boolean) => void;
  setShowBands: (show: boolean) => void;
  updateIndicators: () => void;
}

export function useChartIndicators({
  chart,
  volumeContainerRef,
  rsiContainerRef,
  candles,
  enabled = true,
}: UseChartIndicatorsOptions): UseChartIndicatorsReturn {
  const [showVolume, setShowVolume] = useState(false);
  const [showRsi, setShowRsi] = useState(false);
  const [showEma, setShowEma] = useState(false);
  const [showBands, setShowBands] = useState(false);
  const [divergences, setDivergences] = useState<Divergence[]>([]);
  const [divergenceRevision, setDivergenceRevision] = useState(0);
  
  const volumeChartRef = useRef<IChartApi | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const emaFastRef = useRef<ISeriesApi<'Line'> | null>(null);
  const emaSlowRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bollingerUpperRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bollingerLowerRef = useRef<ISeriesApi<'Line'> | null>(null);
  
  // Update indicators when candles change
  const updateIndicators = useCallback(() => {
    if (!chart || !enabled || candles.length === 0) return;
    
    // Update volume
    if (showVolume && volumeSeriesRef.current) {
      const volumeData = computeVolume(candles);
      volumeSeriesRef.current.setData(volumeData);
    }
    
    // Update RSI
    if (showRsi && rsiSeriesRef.current) {
      const rsiData = computeRsi(candles, 14);
      rsiSeriesRef.current.setData(rsiData);
    }
    
    // Update divergences
    if (showRsi) {
      const newDivergences = detectDivergence(candles, 14);
      setDivergences(newDivergences);
      setDivergenceRevision(prev => prev + 1);
    }
    
    // Update EMA
    if (showEma && emaFastRef.current && emaSlowRef.current) {
      const emaFast = computeEma(candles, 9);
      const emaSlow = computeEma(candles, 21);
      emaFastRef.current.setData(emaFast);
      emaSlowRef.current.setData(emaSlow);
    }
    
    // Update Bollinger Bands
    if (showBands && bollingerUpperRef.current && bollingerLowerRef.current) {
      const { upper, lower } = computeBollinger(candles, 20, 2);
      bollingerUpperRef.current.setData(upper);
      bollingerLowerRef.current.setData(lower);
    }
  }, [chart, enabled, candles, showVolume, showRsi, showEma, showBands]);
  
  // Create/update volume chart
  useEffect(() => {
    if (!chart || !volumeContainerRef.current) return;
    
    if (showVolume && !volumeChartRef.current) {
      const { createVolumeChart } = require('../../components/chartPanes');
      const { volumeChart, volumeSeries } = createVolumeChart(volumeContainerRef.current);
      volumeChartRef.current = volumeChart;
      volumeSeriesRef.current = volumeSeries;
    } else if (!showVolume && volumeChartRef.current) {
      volumeChartRef.current.remove();
      volumeChartRef.current = null;
      volumeSeriesRef.current = null;
    }
  }, [showVolume, chart, volumeContainerRef]);
  
  // Create/update RSI chart
  useEffect(() => {
    if (!chart || !rsiContainerRef.current) return;
    
    if (showRsi && !rsiChartRef.current) {
      const { createRsiChart } = require('../../components/chartPanes');
      const { rsiChart, rsiSeries } = createRsiChart(rsiContainerRef.current);
      rsiChartRef.current = rsiChart;
      rsiSeriesRef.current = rsiSeries;
    } else if (!showRsi && rsiChartRef.current) {
      rsiChartRef.current.remove();
      rsiChartRef.current = null;
      rsiSeriesRef.current = null;
    }
  }, [showRsi, chart, rsiContainerRef]);
  
  // Update indicators when data changes
  useEffect(() => {
    updateIndicators();
  }, [updateIndicators]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (volumeChartRef.current) {
        volumeChartRef.current.remove();
        volumeChartRef.current = null;
      }
      if (rsiChartRef.current) {
        rsiChartRef.current.remove();
        rsiChartRef.current = null;
      }
    };
  }, []);
  
  return {
    showVolume,
    showRsi,
    showEma,
    showBands,
    divergences,
    divergenceRevision,
    setShowVolume,
    setShowRsi,
    setShowEma,
    setShowBands,
    updateIndicators,
  };
}
