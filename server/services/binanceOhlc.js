// Binance public klines fetcher — keyless, full OHLCV, every timeframe
// we use. Drop-in fallback for symbols TradeLocker doesn't quote
// (typically alt-coins) and a Yahoo backstop for crypto in general.
import axios from 'axios';

const BINANCE_BASE = 'https://api.binance.com';

// Internal symbol -> Binance pair. Most crypto symbols are quoted in USDT
// on Binance rather than USD. Binance has delisted some pairs in certain
// regions (e.g. BAT in the US); requests for those will 400 and we'll
// silently fall through.
const SYMBOL_TO_BINANCE = {
  BTCUSD: 'BTCUSDT',
  ETHUSD: 'ETHUSDT',
  XRPUSD: 'XRPUSDT',
  LTCUSD: 'LTCUSDT',
  DOTUSD: 'DOTUSDT',
  XLMUSD: 'XLMUSDT',
  BATUSD: 'BATUSDT',
  NEOUSD: 'NEOUSDT',
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  XRP: 'XRPUSDT',
  LTC: 'LTCUSDT',
  DOT: 'DOTUSDT',
  XLM: 'XLMUSDT',
  BAT: 'BATUSDT',
  NEO: 'NEOUSDT',
};

const TF_TO_BINANCE = {
  M1: '1m',
  M5: '5m',
  M15: '15m',
  H1: '1h',
  H4: '4h',
  D1: '1d',
};

// Bars per request — Binance hard-caps at 1000.
const LIMIT_BY_TF = {
  M1: 1000,
  M5: 1000,
  M15: 1000,
  H1: 1000,  // ~41 days
  H4: 1000,  // ~166 days
  D1: 1000,  // ~2.7 years, plenty for EMA200
};

export async function fetchBinanceBars(symbol, timeframe) {
  const pair = SYMBOL_TO_BINANCE[symbol];
  const interval = TF_TO_BINANCE[timeframe];
  const limit = LIMIT_BY_TF[timeframe];
  if (!pair || !interval || !limit) return null;

  const url = `${BINANCE_BASE}/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`;
  try {
    const response = await axios.get(url, {
      timeout: 12000,
      // Binance is fine with a plain UA but mimicking a browser keeps things
      // boring on shared egress IPs.
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    const klines = response.data;
    if (!Array.isArray(klines) || klines.length === 0) return null;

    return klines.map((k) => ({
      time: Number(k[0]),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]) || 0,
    })).filter((b) => Number.isFinite(b.open) && Number.isFinite(b.close));
  } catch (err) {
    // 400/451 = symbol not listed in this region; 429 = rate limit; etc.
    // Returning null lets the caller continue down the fallback chain.
    console.warn(`Binance bars failed for ${symbol} ${timeframe}: ${err.response?.status} ${err.message}`);
    return null;
  }
}
