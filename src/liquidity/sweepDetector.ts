export type SweepEventType = 'sweep_reject' | 'break_hold' | 'none';

export interface LiquidityLevel {
  level: number;
  type: 'high' | 'low';
}

export interface SweepThresholds {
  /** Equal highs/lows threshold expressed in pips (absolute price units). */
  equalLevelPips?: number;
  /** Equal highs/lows threshold expressed in ticks (multiplied by tickSize). */
  equalLevelTicks?: number;
  /** Equal highs/lows threshold expressed as a fraction of price (e.g. 0.001 = 0.1%). */
  equalLevelPercent?: number;
}

export interface SweepQualification {
  /** Minimum excursion required beyond the liquidity level to qualify as a sweep. */
  minSweepExcursion: number;
  /** Number of bars allowed for reclaim/reversal qualification after excursion. */
  reclaimBars: number;
  /** Optional time window in milliseconds for reclaim qualification. */
  reclaimMs?: number;
  /** Number of consecutive closes beyond the level needed to confirm continuation hold. */
  holdCloses: number;
  /** Whether a valid retest is required after hold closes. */
  requireRetest: boolean;
  /** Retest tolerance around level in price units. */
  retestTolerance: number;
}

export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface SweepDetectorConfig {
  tickSize?: number;
  thresholds: SweepThresholds;
  qualification: SweepQualification;
}

const toAbsoluteThreshold = (price: number, config: SweepDetectorConfig): number => {
  const { tickSize = 0, thresholds } = config;

  const candidates = [
    thresholds.equalLevelPips,
    thresholds.equalLevelTicks !== undefined && tickSize > 0
      ? thresholds.equalLevelTicks * tickSize
      : undefined,
    thresholds.equalLevelPercent !== undefined
      ? Math.abs(price * thresholds.equalLevelPercent)
      : undefined,
  ].filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0);

  return candidates.length ? Math.max(...candidates) : 0;
};

export const isNearLiquidityLevel = (
  price: number,
  liquidityLevel: number,
  config: SweepDetectorConfig,
): boolean => {
  const threshold = toAbsoluteThreshold(liquidityLevel, config);
  return Math.abs(price - liquidityLevel) <= threshold;
};

export const detectSweepEvent = (
  bars: Bar[],
  liquidity: LiquidityLevel,
  config: SweepDetectorConfig,
): SweepEventType => {
  if (!bars.length) return 'none';

  const { minSweepExcursion, reclaimBars, reclaimMs, holdCloses, requireRetest, retestTolerance } =
    config.qualification;
  const level = liquidity.level;

  let sweepIndex = -1;

  for (let i = 0; i < bars.length; i += 1) {
    const b = bars[i];

    if (liquidity.type === 'high' && b.high >= level + minSweepExcursion) {
      sweepIndex = i;
      break;
    }

    if (liquidity.type === 'low' && b.low <= level - minSweepExcursion) {
      sweepIndex = i;
      break;
    }
  }

  if (sweepIndex < 0) return 'none';

  const sweepBar = bars[sweepIndex];
  const reclaimStart = sweepIndex + 1;
  const reclaimEnd = Math.min(bars.length - 1, sweepIndex + reclaimBars);

  for (let i = reclaimStart; i <= reclaimEnd; i += 1) {
    const bar = bars[i];

    if (reclaimMs !== undefined && bar.time - sweepBar.time > reclaimMs) break;

    const reclaimed =
      liquidity.type === 'high' ? bar.close < level : bar.close > level;

    if (reclaimed) return 'sweep_reject';
  }

  const closes = bars.slice(sweepIndex + 1).filter((bar) =>
    liquidity.type === 'high' ? bar.close > level : bar.close < level,
  );

  if (closes.length < holdCloses) return 'none';

  if (!requireRetest) return 'break_hold';

  const postHoldBars = bars.slice(sweepIndex + 1 + holdCloses);
  const retested = postHoldBars.some((bar) => {
    if (liquidity.type === 'high') {
      return bar.low <= level + retestTolerance && bar.close > level;
    }

    return bar.high >= level - retestTolerance && bar.close < level;
  });

  return retested ? 'break_hold' : 'none';
};
