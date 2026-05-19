// Frankfurter fallback — free, no API key needed. Returns current spot rate as a
// single OHLCV bar for forex pairs. Only covers the 7 FX pairs Frankfurter supports.
// Used as last-resort fallback when TradeLocker/Yahoo/Binance all fail.
const FRANKFURTER_BASE = 'https://api.frankfurter.app';

// Maps internal symbol → Frankfurter currency code (quote currency).
// base is always USD. e.g. USDJPY → quote=JPY, rate = USD/JPY.
const FRANKFURTER_QUOTES = {
  EURUSD: null,   // EUR/USD — base is EUR, quote is USD — not supported by Frankfurter
  GBPUSD: null,   // GBP/USD — base is GBP, quote is USD — not supported by Frankfurter
  USDJPY: 'JPY',
  GBPJPY: 'JPY',
  AUDUSD: null,   // AUD/USD — base is AUD, quote is USD — not supported
  USDCAD: 'CAD',
  NZDUSD: null,   // NZD/USD — base is NZD, quote is USD — not supported
  USDCHF: 'CHF',
  XAUUSD: null,   // commodities not supported
  XAGUSD: null,
  NAS100: null,
  US30: null,
  SPX500: null,
  BTCUSD: null,
  ETHUSD: null,
  XRPUSD: null,
  LTCUSD: null,
  DOTUSD: null,
  XLMUSD: null,
  BATUSD: null,
  NEOUSD: null,
};

async function fetchFrankfurterRate(symbol) {
  const quote = FRANKFURTER_QUOTES[symbol];
  if (!quote) return [];
  try {
    const response = await axios.get(`${FRANKFURTER_BASE}/latest?base=USD&symbols=${quote}`, { timeout: 8000 });
    const data = response.data;
    if (!data.rates || !data.rates[quote]) return [];
    const rate = data.rates[quote];
    const now = Date.now();
    // Return a single "bar" so callers that check bars.length > 0 get a valid result.
    return [{ time: now, open: rate, high: rate, low: rate, close: rate, volume: 0 }];
  } catch (err) {
    console.warn(`Frankfurter rate error for ${symbol}: ${err.message}`);
    return [];
  }
}

import axios from 'axios';
import { fetchTradeLockerBars } from './tradeLockerOhlc.js';
import { fetchBinanceBars } from './binanceOhlc.js';

// Map internal symbols to Yahoo Finance tickers.
// Forex / metals / indices / crypto all supported via this endpoint.
export const YAHOO_SYMBOL_MAP = {
  EURUSD: 'EURUSD=X',
  GBPUSD: 'GBPUSD=X',
  USDJPY: 'JPY=X',
  GBPJPY: 'GBPJPY=X',
  AUDUSD: 'AUDUSD=X',
  USDCAD: 'CAD=X',
  NZDUSD: 'NZDUSD=X',
  USDCHF: 'CHF=X',
  XAUUSD: 'GC=F',
  XAGUSD: 'SI=F',
  NAS100: '^NDX',
  US30: '^DJI',
  SPX500: '^GSPC',
  BTCUSD: 'BTC-USD',
  ETHUSD: 'ETH-USD',
  XRPUSD: 'XRP-USD',
  LTCUSD: 'LTC-USD',
  DOTUSD: 'DOT-USD',
  XLMUSD: 'XLM-USD',
  BATUSD: 'BAT-USD',
  NEOUSD: 'NEO-USD',
  BTC: 'BTC-USD',
  ETH: 'ETH-USD',
  XRP: 'XRP-USD',
  LTC: 'LTC-USD',
  DOT: 'DOT-USD',
  XLM: 'XLM-USD',
  BAT: 'BAT-USD',
  NEO: 'NEO-USD',
};

const TF_TO_YAHOO = {
  M1:  { interval: '1m',  range: '5d'   },
  M5:  { interval: '5m',  range: '1mo'  },
  M15: { interval: '15m', range: '1mo'  },
  H1:  { interval: '60m', range: '3mo'  },
  H4:  { interval: '60m', range: '60d', resampleFrom: 'H1', resampleHours: 4 },
  D1:  { interval: '1d',  range: '2y'   },
};

const SUPPORTED_TIMEFRAMES = ['M1', 'M5', 'M15', 'H1', 'H4', 'D1'];

// Simple in-memory cache: key -> { expiresAt, bars }
const cache = new Map();
const CACHE_TTL_MS = {
  M1: 30 * 1000,
  M5: 60 * 1000,
  M15: 2 * 60 * 1000,
  H1: 5 * 60 * 1000,
  H4: 10 * 60 * 1000,
  D1: 30 * 60 * 1000,
};

function cacheKey(symbol, timeframe) {
  return `${symbol}:${timeframe}`;
}

function resolveYahooSymbol(symbol) {
  return YAHOO_SYMBOL_MAP[symbol] || `${symbol}=X`;
}

// Convert a Yahoo chart response into an array of OHLCV bars.
function parseYahooChart(data) {
  const result = data?.chart?.result?.[0];
  if (!result) return [];
  const ts = result.timestamp || [];
  const ind = result.indicators?.quote?.[0] || {};
  const opens = ind.open || [];
  const highs = ind.high || [];
  const lows = ind.low || [];
  const closes = ind.close || [];
  const volumes = ind.volume || [];

  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const o = opens[i], h = highs[i], l = lows[i], c = closes[i];
    if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue;
    bars.push({
      time: ts[i] * 1000,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: Number.isFinite(volumes[i]) ? volumes[i] : 0,
    });
  }
  return bars;
}

// Resample a series of bars into a higher timeframe by N hours.
function resampleBars(bars, hours) {
  if (!bars.length) return [];
  const bucketMs = hours * 60 * 60 * 1000;
  const out = [];
  let cur = null;
  for (const b of bars) {
    const bucket = Math.floor(b.time / bucketMs) * bucketMs;
    if (!cur || cur.time !== bucket) {
      if (cur) out.push(cur);
      cur = { time: bucket, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchYahooBars(yahooSymbol, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${interval}&range=${range}`;
  const maxAttempts = 3;
  let lastErr = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await axios.get(url, {
        timeout: 12000,
        headers: BROWSER_HEADERS,
        validateStatus: (s) => s >= 200 && s < 500, // we'll handle 4xx ourselves
      });
      if (response.status === 429 || response.status === 403) {
        lastErr = new Error(`Yahoo HTTP ${response.status}`);
        await sleep(500 * Math.pow(2, attempt) + Math.random() * 250);
        continue;
      }
      if (response.status >= 400) {
        throw new Error(`Yahoo HTTP ${response.status}`);
      }
      return parseYahooChart(response.data);
    } catch (err) {
      lastErr = err;
      // Retry only on transient errors (timeout, 5xx, network reset).
      const transient = err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' ||
        (err.response && err.response.status >= 500);
      if (!transient || attempt === maxAttempts - 1) throw err;
      await sleep(500 * Math.pow(2, attempt));
    }
  }
  throw lastErr || new Error('Yahoo fetch failed');
}

async function fetchBarsForTimeframe(symbol, timeframe) {
  // Primary: TradeLocker (broker-quoted, authenticated, no rate limits).
  try {
    const tlBars = await fetchTradeLockerBars(symbol, timeframe);
    if (tlBars && tlBars.length > 0) {
      return { bars: tlBars, source: 'tradelocker' };
    }
  } catch (err) {
    console.warn(`TradeLocker bars error for ${symbol} ${timeframe}: ${err.message}`);
  }

  // Secondary: Binance (only for crypto symbols Binance lists; returns null
  // for everything else, so non-crypto requests fall straight to Yahoo).
  // Tried before Yahoo because Yahoo throttles Render's egress IPs and
  // because Binance is the canonical source for crypto OHLC anyway.
  try {
    const binBars = await fetchBinanceBars(symbol, timeframe);
    if (binBars && binBars.length > 0) {
      return { bars: binBars, source: 'binance' };
    }
  } catch (err) {
    console.warn(`Binance bars error for ${symbol} ${timeframe}: ${err.message}`);
  }

  // Tertiary: Yahoo Finance.
  let bars = [];
  let source = null;
  const cfg = TF_TO_YAHOO[timeframe];
  const yahooSymbol = resolveYahooSymbol(symbol);
  try {
    let yahooBars = await fetchYahooBars(yahooSymbol, cfg.interval, cfg.range);
    if (cfg.resampleHours) {
      yahooBars = resampleBars(yahooBars, cfg.resampleHours);
    }
    if (yahooBars.length >= 5) {
      bars = yahooBars;
      source = 'yahoo';
    }
  } catch (err) {
    console.warn(`Yahoo bars error for ${symbol} ${timeframe}: ${err.message}`);
  }

  // Quaternary: Frankfurter — free spot rate for USD-based forex pairs.
  // Returns current rate as a single bar when all other sources fail.
  // Covers: USDJPY, GBPJPY, USDCAD, USDCHF. Does NOT cover EUR/USD or GBP/USD.
  if (!bars || bars.length < 5) {
    try {
      const fwBars = await fetchFrankfurterRate(symbol);
      if (fwBars && fwBars.length > 0) {
        bars = fwBars;
        source = 'frankfurter';
      }
    } catch (err) {
      console.warn(`Frankfurter rate error for ${symbol}: ${err.message}`);
    }
  }

  return { bars: bars || [], source: source || 'unknown' };
}

export async function getBars(symbol, timeframe) {
  if (!SUPPORTED_TIMEFRAMES.includes(timeframe)) {
    throw new Error(`Unsupported timeframe: ${timeframe}`);
  }
  const key = cacheKey(symbol, timeframe);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.bars;
  }

  const { bars, source } = await fetchBarsForTimeframe(symbol, timeframe);

  // Never cache empty results — otherwise a single throttling event poisons
  // the cache for the full TTL window.
  if (bars.length > 0) {
    cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS[timeframe], bars });
    console.log(`Bars ${symbol} ${timeframe}: ${bars.length} via ${source}`);
  }
  return bars;
}

// Fetch the timeframes the strategy actually needs (D1, H4, H1) serially
// so we don't fan out parallel Yahoo requests that get rate-limited on
// shared cloud IPs. H4 is resampled from H1 so we reuse the H1 fetch.
export async function getMultiTimeframeBars(symbol) {
  const out = { D1: [], H4: [], H1: [] };
  // D1 first — required, longest range, served from a different bucket on Yahoo.
  try {
    out.D1 = await getBars(symbol, 'D1');
  } catch (err) {
    console.warn(`getBars ${symbol} D1 failed: ${err.message}`);
  }
  // Small jitter to look less bot-like.
  await sleep(150 + Math.random() * 200);
  // H1 next — also used to build H4.
  try {
    out.H1 = await getBars(symbol, 'H1');
  } catch (err) {
    console.warn(`getBars ${symbol} H1 failed: ${err.message}`);
  }
  // H4 = resample of H1 (no extra network call needed if H1 succeeded).
  if (out.H1.length) {
    out.H4 = resampleBars(out.H1, 4);
  } else {
    // Fall back to an explicit H4 fetch (different cache key on Yahoo).
    try {
      out.H4 = await getBars(symbol, 'H4');
    } catch (err) {
      console.warn(`getBars ${symbol} H4 failed: ${err.message}`);
    }
  }
  return out;
}

export function latestPrice(bars) {
  return bars && bars.length ? bars[bars.length - 1].close : null;
}
