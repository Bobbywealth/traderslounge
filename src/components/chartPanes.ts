import { createChart, ColorType, IChartApi, ISeriesApi, HistogramSeries, LineSeries, LineStyle, UTCTimestamp } from 'lightweight-charts';

export interface VolumePoint {
  time: UTCTimestamp;
  value: number;
  color: string;
}

export interface RsiPoint {
  time: UTCTimestamp;
  value: number;
}

/**
 * Build a lightweight-charts instance for a volume histogram pane that runs
 * BELOW the main price chart. The pane shares its time axis with the main
 * chart via LogicalTime -> coordinate sync performed by the caller.
 */
export const createVolumePane = (
  container: HTMLDivElement,
  height = 110,
): { chart: IChartApi; series: ISeriesApi<'Histogram'> } => {
  const chart = createChart(container, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: '#070a12' },
      textColor: '#9aa7c3',
    },
    grid: {
      vertLines: { color: '#17203a' },
      horzLines: { color: '#17203a' },
    },
    rightPriceScale: {
      borderColor: '#273452',
      scaleMargins: { top: 0.1, bottom: 0.1 },
    },
    timeScale: {
      borderColor: '#273452',
      visible: false,
    },
    crosshair: { mode: 1 },
    handleScroll: true,
    handleScale: true,
  });

  const series = chart.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
    color: '#26a69a',
  });
  chart.priceScale('volume').applyOptions({
    scaleMargins: { top: 0.1, bottom: 0.1 },
  });

  // Cap the requested pixel height so the pane doesn't dominate the layout.
  chart.applyOptions({ height });

  return { chart, series };
};

/**
 * Build a lightweight-charts pane for an RSI oscillator (or any bounded
 * 0-100 indicator). The pane includes the 30/70 reference lines so traders
 * can read overbought/oversold at a glance.
 */
export const createRsiPane = (
  container: HTMLDivElement,
  height = 110,
): { chart: IChartApi; series: ISeriesApi<'Line'> } => {
  const chart = createChart(container, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: '#070a12' },
      textColor: '#9aa7c3',
    },
    grid: {
      vertLines: { color: '#17203a' },
      horzLines: { color: '#17203a' },
    },
    rightPriceScale: {
      borderColor: '#273452',
    },
    timeScale: {
      borderColor: '#273452',
      visible: false,
    },
    crosshair: { mode: 1 },
    handleScroll: true,
    handleScale: true,
  });

  const series = chart.addSeries(LineSeries, {
    color: '#a855f7',
    lineWidth: 2,
    priceLineVisible: false,
  });

  // 30 / 70 reference lines so the trader can read overbought/oversold
  // without reading the axis ticks.
  series.createPriceLine({
    price: 70,
    color: '#ef4444',
    lineWidth: 1,
    lineStyle: LineStyle.Dashed,
    axisLabelVisible: true,
    title: '70',
  });
  series.createPriceLine({
    price: 30,
    color: '#10b981',
    lineWidth: 1,
    lineStyle: LineStyle.Dashed,
    axisLabelVisible: true,
    title: '30',
  });
  series.createPriceLine({
    price: 50,
    color: '#475569',
    lineWidth: 1,
    lineStyle: LineStyle.Dotted,
    axisLabelVisible: false,
  });

  chart.applyOptions({ height });

  return { chart, series };
};

interface RsiCandle {
  time: UTCTimestamp;
  close: number;
}

/**
 * Wilder's RSI calculation. Period 14 by default. Returns one value per
 * input candle, with the first `period` values padded to NaN (lightweight-charts
 * tolerates NaN as a gap).
 */
export const computeRsi = (candles: RsiCandle[], period = 14): RsiPoint[] => {
  if (candles.length === 0) return [];
  const out: RsiPoint[] = new Array(candles.length);
  if (candles.length <= period) {
    return candles.map((c) => ({ time: c.time, value: NaN }));
  }

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) gainSum += change;
    else lossSum += -change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  const firstRs = avgLoss > 0 ? avgGain / avgLoss : 100;
  out[period] = { time: candles[period].time, value: 100 - 100 / (1 + firstRs) };

  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss > 0 ? avgGain / avgLoss : 100;
    out[i] = { time: candles[i].time, value: 100 - 100 / (1 + rs) };
  }

  // Pad the head with NaN points so the line is correctly aligned.
  for (let i = 0; i < period; i++) {
    out[i] = { time: candles[i].time, value: NaN };
  }
  return out;
};

/**
 * Compute volume histogram data from candles. Each bar is colored by whether
 * the candle was bullish or bearish so the trader can read conviction at a
 * glance.
 */
export const computeVolume = (candles: Array<{ time: UTCTimestamp; open: number; close: number; high: number; low: number }>): VolumePoint[] => {
  return candles.map((c) => {
    const isUp = c.close >= c.open;
    // Estimate volume from the candle range if the upstream feed doesn't
    // supply quote volume. This is intentionally a heuristic: it gives a
    // readable histogram even when the backend hasn't sent tick volume.
    const range = Math.max(c.high - c.low, 1e-9);
    const estimated = Math.round(range * 1000);
    return {
      time: c.time,
      value: estimated,
      color: isUp ? 'rgba(16, 185, 129, 0.55)' : 'rgba(244, 63, 94, 0.55)',
    };
  });
};
