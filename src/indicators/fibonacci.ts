import { detectSwings, type SwingBar, type SwingDetectorParams, type SwingPoint } from '../structure/swingDetector';

export interface FibonacciLevel {
  level: number;
  price: number;
  type: 'retracement' | 'extension';
  strength: 'weak' | 'medium' | 'strong';
}

const DEFAULT_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618, 2.618];

export interface FibonacciFromSwingsParams {
  swingDetector: SwingDetectorParams;
  levels?: number[];
}

export function calculateFibonacciFromSwings(
  bars: SwingBar[],
  params: FibonacciFromSwingsParams,
): { anchors: { from: SwingPoint; to: SwingPoint } | null; levels: FibonacciLevel[] } {
  const swings = detectSwings(bars, params.swingDetector);
  if (swings.length < 2) return { anchors: null, levels: [] };

  const to = swings[swings.length - 1];
  const from = swings[swings.length - 2];
  const range = to.price - from.price;
  const direction = range >= 0 ? 1 : -1;
  const absRange = Math.abs(range);

  const levels = (params.levels ?? DEFAULT_LEVELS).map((level) => ({
    level,
    price: from.price + direction * absRange * level,
    type: level <= 1 ? 'retracement' as const : 'extension' as const,
    strength: getFibStrength(level),
  }));

  return { anchors: { from, to }, levels };
}

function getFibStrength(level: number): 'weak' | 'medium' | 'strong' {
  if ([0.382, 0.618, 0.786].includes(level)) return 'strong';
  if ([0.236, 0.5, 1.272, 1.618].includes(level)) return 'medium';
  return 'weak';
}
