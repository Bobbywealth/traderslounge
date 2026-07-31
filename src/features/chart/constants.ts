/**
 * Shared chart constants. Every timeframe map and chart color used to be
 * duplicated inline across TradingView.tsx; this is the single source now.
 */

export interface TimeframeOption {
  value: string;
  label: string;
}

export const CHART_TIMEFRAMES: TimeframeOption[] = [
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '30m', label: '30m' },
  { value: '1h', label: '1h' },
  { value: '4h', label: '4h' },
  { value: '1d', label: '1D' },
  { value: '1w', label: '1W' },
  { value: '1M', label: '1M' },
];

export const TIMEFRAME_SECONDS: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
  '1w': 604800,
  '1M': 2592000,
};

export const timeframeSeconds = (timeframe: string): number =>
  TIMEFRAME_SECONDS[timeframe] ?? 3600;

/** Binance public market-data stream symbols keyed by app symbol. */
export const BINANCE_TRADE_STREAMS: Record<string, string> = {
  BTCUSD: 'btcusdt',
  ETHUSD: 'ethusdt',
};

export const CHART_COLORS = {
  background: '#070a12',
  grid: '#17203a',
  axisBorder: '#273452',
  text: '#9aa7c3',
  labelStroke: '#111827',
  overlayLabelStroke: '#080d18',

  bullish: '#22c55e',
  bearish: '#ef4444',
  candleUp: '#10b981',
  candleDown: '#ef4444',
  neutral: '#94a3b8',
  warning: '#f59e0b',

  adrHigh: '#f97316',
  adrLow: '#06b6d4',
  dayOpen: '#94a3b8',

  trendSupport: '#3b82f6',
  trendResistance: '#f59e0b',
  support: '#22c55e',
  resistance: '#f43f5e',

  fibGolden: '#c084fc',
  fibConfluence: '#22d3ee',
  fib: '#6366f1',

  invalidation: '#fb7185',
  target: '#67e8f9',

  drawingDefault: '#22d3ee',
  drawingSelected: '#facc15',
} as const;
