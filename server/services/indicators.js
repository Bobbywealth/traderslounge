// Core technical indicators + market-structure analysis.
// All inputs are OHLCV bar arrays (oldest first).

// Single source of truth for the ADR lookback. Kept in sync with
// src/config/adr.ts on the frontend so the chart and the strategy engine
// never disagree on what "Average Daily Range" means.
export const DEFAULT_ADR_LOOKBACK = 14;

export function ema(values, period) {
  if (!values.length || period <= 0) return [];
  const k = 2 / (period + 1);
  const out = new Array(values.length);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function sma(values, period) {
  if (values.length < period) return [];
  const out = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out.push(sum / period);
    else out.push(NaN);
  }
  return out;
}

// Standard Wilder RSI(14).
export function rsi(closes, period = 14) {
  if (closes.length <= period) return [];
  const out = new Array(closes.length).fill(NaN);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch > 0) avgGain += ch; else avgLoss -= ch;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const gain = ch > 0 ? ch : 0;
    const loss = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

// Average Daily Range over the last `lookback` complete daily bars.
// Returns { adr, dayOpen, dayHigh, dayLow, currentRange, percentUsed,
//           adrHigh, adrLow, nearAdrHigh, nearAdrLow }.
export function calculateAdr(dailyBars, lookback = DEFAULT_ADR_LOOKBACK) {
  if (!dailyBars || dailyBars.length < lookback + 1) return null;
  const completed = dailyBars.slice(-lookback - 1, -1); // last N completed days
  const ranges = completed.map((b) => b.high - b.low);
  const adr = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  const today = dailyBars[dailyBars.length - 1];
  const currentRange = today.high - today.low;
  const percentUsed = adr > 0 ? (currentRange / adr) * 100 : 0;
  const adrHigh = today.open + adr / 2;
  const adrLow = today.open - adr / 2;
  const distToHigh = Math.abs(today.close - today.high);
  const distToLow = Math.abs(today.close - today.low);
  const tolerance = adr * 0.15;
  return {
    adr,
    dayOpen: today.open,
    dayHigh: today.high,
    dayLow: today.low,
    currentRange,
    percentUsed,
    adrHigh,
    adrLow,
    nearAdrHigh: today.close >= today.high - tolerance || today.close >= adrHigh,
    nearAdrLow: today.close <= today.low + tolerance || today.close <= adrLow,
    exhausted: percentUsed >= 80,
  };
}

// Fractal swing detection: a swing high/low requires `leftRight` bars
// on each side that don't break the level. Returns an array of pivots
// sorted by time: { index, time, price, type: 'high'|'low' }.
export function detectSwings(bars, leftRight = 2) {
  const swings = [];
  for (let i = leftRight; i < bars.length - leftRight; i++) {
    const cur = bars[i];
    let isHigh = true, isLow = true;
    for (let j = i - leftRight; j <= i + leftRight; j++) {
      if (j === i) continue;
      if (bars[j].high >= cur.high) isHigh = false;
      if (bars[j].low <= cur.low) isLow = false;
    }
    if (isHigh) swings.push({ index: i, time: cur.time, price: cur.high, type: 'high' });
    if (isLow) swings.push({ index: i, time: cur.time, price: cur.low, type: 'low' });
  }
  // Collapse consecutive same-type pivots, keeping the more extreme one.
  const cleaned = [];
  for (const s of swings) {
    const last = cleaned[cleaned.length - 1];
    if (last && last.type === s.type) {
      if ((s.type === 'high' && s.price > last.price) || (s.type === 'low' && s.price < last.price)) {
        cleaned[cleaned.length - 1] = s;
      }
    } else {
      cleaned.push(s);
    }
  }
  return cleaned;
}

// Label HH/HL/LH/LL based on the last few swings and detect BOS / CHOCH.
export function analyzeStructure(swings) {
  if (!swings || swings.length < 4) {
    return { labels: [], lastBos: null, lastChoch: null, trend: 'neutral' };
  }
  const labels = [];
  // Compare each swing to the prior same-type swing.
  for (let i = 0; i < swings.length; i++) {
    const s = swings[i];
    const prevSame = [...swings.slice(0, i)].reverse().find((p) => p.type === s.type);
    if (!prevSame) {
      labels.push({ ...s, label: null });
      continue;
    }
    let label;
    if (s.type === 'high') label = s.price > prevSame.price ? 'HH' : 'LH';
    else label = s.price > prevSame.price ? 'HL' : 'LL';
    labels.push({ ...s, label });
  }

  // BOS = new HH in uptrend (break of prior high) or new LL in downtrend.
  // CHOCH = first LH after HHs (bullish-to-bearish) or first HL after LLs.
  let lastBos = null;
  let lastChoch = null;
  let trendCtx = 'neutral';
  for (let i = 1; i < labels.length; i++) {
    const cur = labels[i];
    const prev = labels[i - 1];
    if (cur.label === 'HH' && trendCtx !== 'bearish') {
      lastBos = { ...cur, kind: 'bullish' };
      trendCtx = 'bullish';
    } else if (cur.label === 'LL' && trendCtx !== 'bullish') {
      lastBos = { ...cur, kind: 'bearish' };
      trendCtx = 'bearish';
    } else if (cur.label === 'LH' && trendCtx === 'bullish') {
      lastChoch = { ...cur, kind: 'bearish' };
      trendCtx = 'bearish';
    } else if (cur.label === 'HL' && trendCtx === 'bearish') {
      lastChoch = { ...cur, kind: 'bullish' };
      trendCtx = 'bullish';
    }
  }

  // Determine current trend from the last 4 labelled pivots.
  const last4 = labels.slice(-4).filter((l) => l.label);
  const bull = last4.filter((l) => l.label === 'HH' || l.label === 'HL').length;
  const bear = last4.filter((l) => l.label === 'LL' || l.label === 'LH').length;
  let trend = 'neutral';
  if (bull >= 3) trend = 'bullish';
  else if (bear >= 3) trend = 'bearish';

  return { labels, lastBos, lastChoch, trend };
}

// Per-timeframe bias from EMA alignment + last-swings structure.
// Score is between -1 (very bearish) and +1 (very bullish).
export function timeframeBias(bars) {
  if (!bars || bars.length < 60) {
    return { trend: 'neutral', score: 0, strength: 0 };
  }
  const closes = bars.map((b) => b.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = closes.length >= 200 ? ema(closes, 200) : null;
  const i = closes.length - 1;
  const price = closes[i];

  let score = 0;
  if (ema20[i] > ema50[i]) score += 1; else if (ema20[i] < ema50[i]) score -= 1;
  if (ema200) {
    if (price > ema200[i]) score += 1; else if (price < ema200[i]) score -= 1;
  }

  const swings = detectSwings(bars, 2);
  const structure = analyzeStructure(swings);
  if (structure.trend === 'bullish') score += 1;
  else if (structure.trend === 'bearish') score -= 1;

  const max = ema200 ? 3 : 2;
  const normalized = score / max;
  let trend = 'neutral';
  if (normalized >= 0.5) trend = 'bullish';
  else if (normalized <= -0.5) trend = 'bearish';
  let strength = Math.min(100, Math.abs(normalized) * 100);
  // Signal strength bucket: strong / moderate / weak
  let signal = 'weak';
  if (strength >= 66) signal = 'strong';
  else if (strength >= 33) signal = 'moderate';

  return { trend, strength, signal, score: normalized, ema20: ema20[i], ema50: ema50[i] };
}

// RSI snapshot + simple divergence detection between price and RSI swings.
export function rsiAnalysis(bars, period = 14) {
  if (!bars || bars.length < period + 5) return null;
  const closes = bars.map((b) => b.close);
  const series = rsi(closes, period);
  const last = series[series.length - 1];
  const oversold = last <= 30;
  const overbought = last >= 70;

  // Look at the last two swing highs/lows in price and compare RSI at those bars.
  const swings = detectSwings(bars, 2).slice(-10);
  const highs = swings.filter((s) => s.type === 'high').slice(-2);
  const lows = swings.filter((s) => s.type === 'low').slice(-2);
  let bullishDivergence = false;
  let bearishDivergence = false;
  if (lows.length === 2) {
    const [a, b] = lows;
    if (b.price < a.price && series[b.index] > series[a.index]) bullishDivergence = true;
  }
  if (highs.length === 2) {
    const [a, b] = highs;
    if (b.price > a.price && series[b.index] < series[a.index]) bearishDivergence = true;
  }
  return { value: last, oversold, overbought, bullishDivergence, bearishDivergence };
}
