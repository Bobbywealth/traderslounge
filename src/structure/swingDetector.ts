export interface SwingBar {
  time: number | Date;
  high: number;
  low: number;
  close?: number;
}

export type SwingType = 'high' | 'low';

export interface SwingPoint {
  index: number;
  time: number | Date;
  price: number;
  type: SwingType;
}

export interface SwingInvalidationRules {
  replaceWithMoreExtreme: boolean;
  requireAlternation: boolean;
}

export interface SwingDetectorParams {
  leftBars: number;
  rightBars: number;
  minSwingDistance: {
    mode: 'atr' | 'percent';
    value: number;
    atrPeriod?: number;
  };
  invalidation: SwingInvalidationRules;
}

const defaultInvalidation: SwingInvalidationRules = {
  replaceWithMoreExtreme: true,
  requireAlternation: true,
};

export function detectSwings(
  bars: SwingBar[],
  params: SwingDetectorParams,
): SwingPoint[] {
  if (bars.length === 0) return [];

  const left = Math.max(1, params.leftBars);
  const right = Math.max(1, params.rightBars);
  const invalidation = { ...defaultInvalidation, ...params.invalidation };
  const threshold = getMinSwingThresholds(bars, params);

  const swings: SwingPoint[] = [];

  for (let i = left; i < bars.length - right; i++) {
    const current = bars[i];
    let isPivotHigh = true;
    let isPivotLow = true;

    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (bars[j].high >= current.high) isPivotHigh = false;
      if (bars[j].low <= current.low) isPivotLow = false;
      if (!isPivotHigh && !isPivotLow) break;
    }

    if (!isPivotHigh && !isPivotLow) continue;

    const candidate: SwingPoint = isPivotHigh
      ? { index: i, time: current.time, price: current.high, type: 'high' }
      : { index: i, time: current.time, price: current.low, type: 'low' };

    if (swings.length === 0) {
      swings.push(candidate);
      continue;
    }

    const last = swings[swings.length - 1];

    if (last.type === candidate.type && invalidation.replaceWithMoreExtreme) {
      const moreExtreme =
        candidate.type === 'high' ? candidate.price > last.price : candidate.price < last.price;
      if (moreExtreme) {
        swings[swings.length - 1] = candidate;
      }
      continue;
    }

    if (invalidation.requireAlternation && last.type === candidate.type) {
      continue;
    }

    const distance = Math.abs(candidate.price - last.price);
    if (distance >= threshold[i]) {
      swings.push(candidate);
    }
  }

  return swings;
}

function getMinSwingThresholds(bars: SwingBar[], params: SwingDetectorParams): number[] {
  if (params.minSwingDistance.mode === 'percent') {
    return bars.map((bar) => ((bar.close ?? (bar.high + bar.low) / 2) * params.minSwingDistance.value) / 100);
  }

  const atrPeriod = Math.max(2, params.minSwingDistance.atrPeriod ?? 5);
  const atr = calculateAtr(bars, atrPeriod);
  return atr.map((value) => value * params.minSwingDistance.value);
}

function calculateAtr(bars: SwingBar[], period: number): number[] {
  const tr: number[] = bars.map((bar, i) => {
    if (i === 0) return bar.high - bar.low;
    const prevClose = bars[i - 1].close ?? (bars[i - 1].high + bars[i - 1].low) / 2;
    return Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - prevClose),
      Math.abs(bar.low - prevClose),
    );
  });

  const atr: number[] = Array(bars.length).fill(tr[0] ?? 0);
  for (let i = 1; i < bars.length; i++) {
    const from = Math.max(0, i - period + 1);
    const window = tr.slice(from, i + 1);
    atr[i] = window.reduce((sum, v) => sum + v, 0) / window.length;
  }

  return atr;
}
