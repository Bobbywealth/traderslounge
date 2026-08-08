/**
 * Hook for managing chart initialization and lifecycle.
 * 
 * Handles:
 * - Chart creation with lightweight-charts
 * - Theme management (dark/light)
 * - Chart type switching (candlestick/line/area)
 * - Cleanup on unmount
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  IChartApi,
  ISeriesApi,
  LineStyle,
  UTCTimestamp,
  CandlestickSeries,
  LineSeries,
} from 'lightweight-charts';

type ChartType = 'candlestick' | 'line' | 'area';

interface UseChartLifecycleOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  theme?: 'dark' | 'light';
  chartType?: ChartType;
}

interface UseChartLifecycleReturn {
  chart: IChartApi | null;
  mainSeries: ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | ISeriesApi<'Area'> | null;
  isInitialized: boolean;
  resize: () => void;
}

export function useChartLifecycle({
  containerRef,
  theme = 'dark',
  chartType = 'candlestick',
}: UseChartLifecycleOptions): UseChartLifecycleReturn {
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | ISeriesApi<'Area'> | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Initialize chart
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    // Clean up existing chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRef.current = null;
    }
    
    // Create new chart
    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: theme === 'dark' ? '#0f1117' : '#ffffff' },
        textColor: theme === 'dark' ? '#d1d4dc' : '#333333',
      },
      grid: {
        vertLines: { color: theme === 'dark' ? 'rgba(42, 46, 57, 0.4)' : 'rgba(0, 0, 0, 0.1)' },
        horzLines: { color: theme === 'dark' ? 'rgba(42, 46, 57, 0.4)' : 'rgba(0, 0, 0, 0.1)' },
      },
      crosshair: {
        vertLine: { color: theme === 'dark' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)' },
        horzLine: { color: theme === 'dark' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
    });
    
    chartRef.current = chart;
    
    // Create main series based on chart type
    let series: ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | ISeriesApi<'Area'>;
    
    switch (chartType) {
      case 'line':
        series = chart.addSeries(LineSeries, {
          color: '#2962FF',
          lineWidth: 2,
        });
        break;
      case 'area':
        series = chart.addSeries(LineSeries, {
          color: '#2962FF',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        break;
      case 'candlestick':
      default:
        series = chart.addSeries(CandlestickSeries, {
          upColor: '#26a69a',
          downColor: '#ef5350',
          borderUpColor: '#26a69a',
          borderDownColor: '#ef5350',
          wickUpColor: '#26a69a',
          wickDownColor: '#ef5350',
        });
        break;
    }
    
    seriesRef.current = series;
    setIsInitialized(true);
    
    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (chartRef.current) {
        chartRef.current.applyOptions({
          width: container.clientWidth,
          height: container.clientHeight,
        });
      }
    });
    
    resizeObserver.observe(container);
    
    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      setIsInitialized(false);
    };
  }, [containerRef, theme, chartType]);
  
  // Handle theme changes
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({
        layout: {
          background: { type: ColorType.Solid, color: theme === 'dark' ? '#0f1117' : '#ffffff' },
          textColor: theme === 'dark' ? '#d1d4dc' : '#333333',
        },
        grid: {
          vertLines: { color: theme === 'dark' ? 'rgba(42, 46, 57, 0.4)' : 'rgba(0, 0, 0, 0.1)' },
          horzLines: { color: theme === 'dark' ? 'rgba(42, 46, 57, 0.4)' : 'rgba(0, 0, 0, 0.1)' },
        },
      });
    }
  }, [theme]);
  
  // Manual resize function
  const resize = useCallback(() => {
    if (chartRef.current && containerRef.current) {
      chartRef.current.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
    }
  }, [containerRef]);
  
  return {
    chart: chartRef.current,
    mainSeries: seriesRef.current,
    isInitialized,
    resize,
  };
}
