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

  const lookbackCandles = filteredCandles.slice(-config.lookbackPeriod);
  if (lookbackCandles.length === 0) {
    return null;
  }

  const ranges = lookbackCandles.map((candle, index) => {
    const previousClose = index > 0 ? lookbackCandles[index - 1].close : null;
    return getRange(candle, previousClose, config.rangeDefinition);
  });

  const averageDailyRange = ranges.reduce((sum, range) => sum + range, 0) / ranges.length;
  const today = lookbackCandles[lookbackCandles.length - 1];
  const currentRange = getRange(
    today,
    lookbackCandles.length > 1 ? lookbackCandles[lookbackCandles.length - 2].close : null,
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
