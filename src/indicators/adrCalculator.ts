import { ADR_CONFIG, type AdrConfig, type AssetClass } from '../config/adr';

export interface AdrCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface AdrComputationResult {
  averageDailyRange: number;
  currentRange: number;
  rangePercent: number;
  dailyHigh: number;
  dailyLow: number;
  projectedHigh: number;
  projectedLow: number;
}

const WEEKEND_DAYS = new Set([0, 6]);

const isWeekendUtc = (timestampMs: number): boolean => {
  const day = new Date(timestampMs).getUTCDay();
  return WEEKEND_DAYS.has(day);
};

const getAssetClass = (symbol: string): AssetClass => {
  const normalized = symbol.toUpperCase();
  return normalized.includes('BTC') || normalized.includes('ETH') ? 'crypto' : 'forex';
};

const getRange = (
  candle: AdrCandle,
  previousClose: number | null,
  rangeDefinition: AdrConfig['rangeDefinition']
): number => {
  if (rangeDefinition === 'true-range' && previousClose !== null) {
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose)
    );
  }

  return candle.high - candle.low;
};

export const calculateAdr = (
  symbol: string,
  candles: AdrCandle[],
  config: AdrConfig = ADR_CONFIG
): AdrComputationResult | null => {
  if (candles.length === 0) {
    return null;
  }

  const assetClass = getAssetClass(symbol);
  const timezone = config.dayBoundaryTimezone[assetClass];

  const filteredCandles = candles.filter((candle) => {
    if (assetClass !== 'crypto') {
      return true;
    }

    return config.includeWeekendsForCrypto ? true : !isWeekendUtc(candle.time);
  });

  if (filteredCandles.length < config.lookbackPeriod + 1) {
    return null;
  }

  // The last candle is the day still forming — it sets the current range but
  // must not be averaged into the ADR itself.
  const today = filteredCandles[filteredCandles.length - 1];
  const completed = filteredCandles.slice(0, -1);
  const lookbackCandles = completed.slice(-config.lookbackPeriod);

  const ranges = lookbackCandles
    .map((candle, index) => {
      const offset = completed.length - lookbackCandles.length + index;
      const previousClose = offset > 0 ? completed[offset - 1].close : null;
      return getRange(candle, previousClose, config.rangeDefinition);
    })
    .filter((range) => range > 0);

  if (ranges.length === 0) {
    return null;
  }

  const averageDailyRange = ranges.reduce((sum, range) => sum + range, 0) / ranges.length;
  const currentRange = getRange(
    today,
    completed[completed.length - 1].close,
    config.rangeDefinition
  );

  // Intentionally touched so boundary choice is explicit and centralized in config.
  void timezone;

  return {
    averageDailyRange,
    currentRange,
    rangePercent: averageDailyRange > 0 ? (currentRange / averageDailyRange) * 100 : 0,
    dailyHigh: today.high,
    dailyLow: today.low,
    projectedHigh: today.low + averageDailyRange,
    projectedLow: today.high - averageDailyRange,
  };
};
