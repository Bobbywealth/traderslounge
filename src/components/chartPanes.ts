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

export type DivergenceType =
  | 'regular_bullish'   // price LL + RSI HL → potential reversal up
  | 'regular_bearish'   // price HH + RSI LH → potential reversal down
  | 'hidden_bullish'    // price HL + RSI LL → trend continuation up
  | 'hidden_bearish';   // price LH + RSI HH → trend continuation down

export interface SwingPoint {
  index: number;
  time: UTCTimestamp;
  value: number;
}

export interface Divergence {
  type: DivergenceType;
  // The two most recent matching swing points that triggered the call. The
  // caller draws a line between the price points and another line between
  // the RSI points to make the divergence visible.
  priceA: SwingPoint;
  priceB: SwingPoint;
  rsiA: SwingPoint;
  rsiB: SwingPoint;
  // Strength heuristic (0-100). Larger price gap with smaller RSI gap = a
  // stronger, cleaner divergence.
  strength: number;
  // The RSI was at/near overbought (>70) or oversold (<30) at the trigger.
  // That makes the signal more reliable. Used by the renderer to color and
  // by callers that want to filter low-quality divergences.
  rsiContext: 'overbought' | 'oversold' | 'mid';
}

interface DivergenceCandle {
  time: UTCTimestamp;
  open: number;
  close: number;
  high: number;
  low: number;
}

/**
 * Find the last N local extremes on a numeric series. The caller chooses
 * `lookback` (window size to qualify an extreme) and `count` (how many to
 * keep). Returns extremes in chronological order, with the most recent at
 * the end. Used twice per chart - once on price closes, once on RSI - so
 * the divergence engine can compare the last two of each.
 */
const findRecentExtremes = (
  values: Array<{ time: UTCTimestamp; value: number }>,
  lookback: number,
  count: number,
  kind: 'high' | 'low',
): SwingPoint[] => {
  const found: SwingPoint[] = [];
  for (let i = lookback; i < values.length - lookback; i++) {
    const v = values[i].value;
    if (!Number.isFinite(v)) continue;
    let isExtreme = true;
    for (let j = 1; j <= lookback; j++) {
      const left = values[i - j].value;
      const right = values[i + j].value;
      if (!Number.isFinite(left) || !Number.isFinite(right)) {
        isExtreme = false;
        break;
      }
      if (kind === 'high' && (left >= v || right >= v)) {
        isExtreme = false;
        break;
      }
      if (kind === 'low' && (left <= v || right <= v)) {
        isExtreme = false;
        break;
      }
    }
    if (isExtreme) {
      found.push({ index: i, time: values[i].time, value: v });
      if (found.length > count * 4) {
        // Prune to the most recent `count * 4` so we don't blow up memory on
        // long-running tickers. The final filter keeps the most recent N.
        found.splice(0, found.length - count * 4);
      }
    }
  }
  return found.slice(-count);
};

/**
 * Classify the RSI zone the trigger swing was in. Divergences that form
 * near overbought/oversold extremes carry more weight because the
 * oscillator has less room to keep moving in the original direction.
 */
const classifyRsiContext = (rsiValue: number): Divergence['rsiContext'] => {
  if (rsiValue >= 70) return 'overbought';
  if (rsiValue <= 30) return 'oversold';
  return 'mid';
};

/**
 * Compute a 0-100 strength score for a divergence. A larger price move
 * combined with a smaller RSI move (i.e. momentum is disagreeing with
 * price) is the cleanest setup. We normalize each side against recent
 * ATR to keep the score stable across timeframes.
 */
const scoreDivergenceStrength = (
  priceMoveA: number,
  priceMoveB: number,
  rsiMoveB: number,
  rsiContext: Divergence['rsiContext'],
): number => {
  // Normalize: ratio of RSI disagreement relative to price agreement.
  // priceDelta and rsiDelta are both signed. We compare magnitudes.
  const priceMag = Math.max(Math.abs(priceMoveA), 1e-9);
  // RSI ratio is in the [0, 100] range, so 1 RSI point = 1% of the
  // bounded range. Scale the price ratio similarly.
  const pricePct = Math.abs(priceMoveB / priceMag) * 100;
  const rsiPct = Math.abs(rsiMoveB);
  // Higher score when the two moves disagree.
  let base = Math.max(0, Math.min(100, 50 + (pricePct - rsiPct) * 1.2));
  if (rsiContext !== 'mid') base = Math.min(100, base + 12);
  return Math.round(base);
};

/**
 * Detect bullish or bearish RSI divergences on the most recent two
 * matching swing pairs. Returns the most recent qualifying divergence
 * (or null). The function is symmetric: it runs against highs and lows
 * separately, so a single call can surface up to one regular and one
 * hidden divergence.
 *
 * The lookback parameters trade off noise vs. signal: smaller lookback
 * finds more swings but more false positives; larger lookback finds fewer
 * but cleaner extremes. Defaults are tuned for the 1H timeframe.
 */
export const detectDivergence = (
  candles: DivergenceCandle[],
  rsi: RsiPoint[],
  options: {
    priceLookback?: number;
    rsiLookback?: number;
    maxSwings?: number;
  } = {},
): Divergence[] => {
  const priceLookback = options.priceLookback ?? 5;
  const rsiLookback = options.rsiLookback ?? 5;
  const maxSwings = options.maxSwings ?? 4;

  if (candles.length === 0 || rsi.length === 0) return [];
  if (rsi.length !== candles.length) {
    // The two series must be aligned. If not, the caller wired something
    // wrong. Bail out instead of producing garbage.
    return [];
  }

  // Build the price series we want to scan. We use close for the
  // comparison, but lows/highs feed the swing point metadata so the
  // renderer can pin the marker to the actual extreme.
  const priceSeries: Array<{ time: UTCTimestamp; value: number }> = candles.map((c) => ({
    time: c.time,
    value: c.close,
  }));
  const rsiSeries: Array<{ time: UTCTimestamp; value: number }> = rsi.map((p) => ({
    time: p.time,
    value: p.value,
  }));

  const priceHighs = findRecentExtremes(priceSeries, priceLookback, maxSwings, 'high');
  const priceLows = findRecentExtremes(priceSeries, priceLookback, maxSwings, 'low');
  const rsiHighs = findRecentExtremes(rsiSeries, rsiLookback, maxSwings, 'high');
  const rsiLows = findRecentExtremes(rsiSeries, rsiLookback, maxSwings, 'low');

  const out: Divergence[] = [];

  // Bearish family: compare the most recent two price highs to the most
  // recent two RSI highs.
  if (priceHighs.length >= 2 && rsiHighs.length >= 2) {
    const ph1 = priceHighs[priceHighs.length - 2];
    const ph2 = priceHighs[priceHighs.length - 1];
    // Pick the RSI highs that are nearest in time to each price high so
    // the comparison is apples-to-apples.
    const rh1 = pickNearestRsiSwing(rsiHighs, ph1);
    const rh2 = pickNearestRsiSwing(rsiHighs, ph2);
    if (rh1 && rh2) {
      const priceHigher = ph2.value > ph1.value;
      const rsiLower = rh2.value < rh1.value;
      if (priceHigher && rsiLower) {
        out.push(buildDivergence('regular_bearish', ph1, ph2, rh1, rh2));
      } else if (!priceHigher && !rsiLower && (ph1.value !== ph2.value) && (rh1.value !== rh2.value)) {
        // Hidden bearish: price LH + RSI HH. We require the moves to
        // actually disagree (not be flat).
        out.push(buildDivergence('hidden_bearish', ph1, ph2, rh1, rh2));
      }
    }
  }

  // Bullish family: compare the most recent two price lows to the most
  // recent two RSI lows.
  if (priceLows.length >= 2 && rsiLows.length >= 2) {
    const pl1 = priceLows[priceLows.length - 2];
    const pl2 = priceLows[priceLows.length - 1];
    const rl1 = pickNearestRsiSwing(rsiLows, pl1);
    const rl2 = pickNearestRsiSwing(rsiLows, pl2);
    if (rl1 && rl2) {
      const priceLower = pl2.value < pl1.value;
      const rsiHigher = rl2.value > rl1.value;
      if (priceLower && rsiHigher) {
        out.push(buildDivergence('regular_bullish', pl1, pl2, rl1, rl2));
      } else if (!priceLower && !rsiHigher && (pl1.value !== pl2.value) && (rl1.value !== rl2.value)) {
        out.push(buildDivergence('hidden_bullish', pl1, pl2, rl1, rl2));
      }
    }
  }

  return out;
};

const pickNearestRsiSwing = (rsiSwings: SwingPoint[], target: SwingPoint): SwingPoint | null => {
  let best: SwingPoint | null = null;
  let bestDist = Infinity;
  for (const swing of rsiSwings) {
    const dist = Math.abs(swing.index - target.index);
    if (dist < bestDist) {
      bestDist = dist;
      best = swing;
    }
  }
  return best;
};

const buildDivergence = (
  type: DivergenceType,
  priceA: SwingPoint,
  priceB: SwingPoint,
  rsiA: SwingPoint,
  rsiB: SwingPoint,
): Divergence => {
  const priceMoveA = priceB.value - priceA.value;
  const rsiMoveA = rsiB.value - rsiA.value;
  // For the strength score we use the magnitude of the latest move on
  // each side. The sign is what classifies the divergence, the magnitude
  // is what scores it.
  const rsiContext = classifyRsiContext(rsiB.value);
  const strength = scoreDivergenceStrength(priceMoveA, priceMoveA, rsiMoveA, rsiContext);
  return {
    type,
    priceA,
    priceB,
    rsiA,
    rsiB,
    strength,
    rsiContext,
  };
};

/**
 * Visual style for a single divergence. The renderer can use this to pick
 * a color, dash pattern, and icon so all four divergence types are
 * distinguishable on the chart.
 */
export const divergenceStyle = (type: DivergenceType): { color: string; label: string; icon: string } => {
  switch (type) {
    case 'regular_bullish':
      return { color: '#22d3ee', label: 'REG BULL', icon: '↗' };
    case 'regular_bearish':
      return { color: '#f472b6', label: 'REG BEAR', icon: '↘' };
    case 'hidden_bullish':
      return { color: '#10b981', label: 'HID BULL', icon: '⇗' };
    case 'hidden_bearish':
      return { color: '#f59e0b', label: 'HID BEAR', icon: '⇘' };
  }
};
