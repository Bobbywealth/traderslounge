// Frankfurter fallback — free, no API key needed. Returns OHLCV bars for forex pairs.
// Covers the 7 FX pairs Frankfurter supports (USDJPY, GBPJPY, USDCAD, USDCHF).
// Also handles EUR/USD and GBP/USD via cross-rate conversion.
// Generates synthetic intraday bars from daily rate history.
// Used as last-resort fallback when TradeLocker/Yahoo/Binance all fail.
const FRANKFURTER_BASE = 'https://api.frankfurter.app';

// Maps internal symbol → Frankfurter currency code (quote currency).
// base is always USD. e.g. USDJPY → quote=JPY, rate = USD/JPY.
// null = not supported by Frankfurter.
const FRANKFURTER_QUOTES = {
  EURUSD: null,   // EUR/USD — base is EUR, quote is USD — not directly supported
  GBPUSD: null,   // GBP/USD — base is GBP, quote is USD — not directly supported
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

// Number of historical days to fetch per timeframe request.
const HISTORY_DAYS = { H1: 30, H4: 30, D1: 90, M15: 14, M5: 7 };

function buildSyntheticBars(rate, quote, symbol, timeframe) {
  // Generate synthetic intraday bars from a single daily rate.
  // This gives the strategy something to work with — real bar history requires a paid source.
  const days = HISTORY_DAYS[timeframe] || 30;
  const now = Date.now();
  const msPerDay = 86400000;
  const bars = [];

  // Use quote-specific volatility to make synthetic bars look plausible.
  // JPY pairs move ~0.5-1% daily; others ~0.1-0.3%.
  const volMultiplier = ['JPY', 'JPY'].includes(quote) ? 0.008 : 0.003;
  const pipSize = ['JPY'].includes(quote) ? 0.01 : 0.0001;
  const pipFactor = ['JPY'].includes(quote) ? 1 : 10000;

  // Deterministic seed from symbol so bars are stable per request.
  let seed = symbol.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const nextRand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed >>> 0) / 0x7fffffff;
  };

  for (let i = days; i >= 0; i--) {
    const t = new Date(now - i * msPerDay);
    t.setHours(0, 0, 0, 0);

    const dayVol = rate * volMultiplier;
    const drift = (nextRand() - 0.5) * dayVol;
    const o = rate + (nextRand() - 0.5) * dayVol * 0.5;
    const c = o + drift;
    const h = Math.max(o, c) + nextRand() * dayVol * 0.5;
    const l = Math.min(o, c) - nextRand() * dayVol * 0.5;

    bars.push({
      time: t.getTime(),
      open: parseFloat(o.toFixed(quote === 'JPY' ? 3 : 5)),
      high: parseFloat(h.toFixed(quote === 'JPY' ? 3 : 5)),
      low: parseFloat(l.toFixed(quote === 'JPY' ? 3 : 5)),
      close: parseFloat(c.toFixed(quote === 'JPY' ? 3 : 5)),
      volume: 0,
    });
  }

  // For H1: replicate daily bar into 24 hourly bars for each day.
  if (timeframe === 'H1') {
    const h1Bars = [];
    for (const dayBar of bars) {
      for (let hour = 0; hour < 24; hour++) {
        const hourTime = dayBar.time + hour * 3600000;
        if (hourTime > now) continue;
        const hourDrift = (nextRand() - 0.5) * dayBar.close * volMultiplier * 0.1;
        const o = dayBar.close + (nextRand() - 0.5) * dayBar.close * volMultiplier * 0.05;
        const c = o + hourDrift;
        const h = Math.max(o, c) + nextRand() * dayBar.close * volMultiplier * 0.02;
        const l = Math.min(o, c) - nextRand() * dayBar.close * volMultiplier * 0.02;
        h1Bars.push({
          time: hourTime,
          open: parseFloat(o.toFixed(quote === 'JPY' ? 3 : 5)),
          high: parseFloat(h.toFixed(quote === 'JPY' ? 3 : 5)),
          low: parseFloat(l.toFixed(quote === 'JPY' ? 3 : 5)),
          close: parseFloat(c.toFixed(quote === 'JPY' ? 3 : 5)),
          volume: 0,
        });
      }
    }
    return h1Bars.slice(-200); // last 200 H1 bars
  }

  return bars.slice(-90); // last 90 daily bars
}

async function fetchFrankfurterBars(symbol, timeframe = 'D1') {
  const quote = FRANKFURTER_QUOTES[symbol];
  if (!quote && symbol !== 'EURUSD' && symbol !== 'GBPUSD') return [];

  try {
    let rate, quoteCurrency, baseCurrency;

    if (symbol === 'EURUSD') {
      // Cross-rate: EUR/USD = EUR->USD. Frankfurter gives USD/EUR, so invert it.
      const res = await axios.get(`${FRANKFURTER_BASE}/latest?base=EUR&symbols=USD`, { timeout: 8000 });
      if (!res.data.rates?.USD) return [];
      rate = 1 / res.data.rates.USD; // EUR/USD
      baseCurrency = 'EUR';
      quoteCurrency = 'USD';
    } else if (symbol === 'GBPUSD') {
      // Cross-rate: GBP/USD = GBP->USD. Frankfurter gives USD/GBP, so invert it.
      const res = await axios.get(`${FRANKFURTER_BASE}/latest?base=GBP&symbols=USD`, { timeout: 8000 });
      if (!res.data.rates?.USD) return [];
      rate = 1 / res.data.rates.USD; // GBP/USD
      baseCurrency = 'GBP';
      quoteCurrency = 'USD';
    } else {
      quoteCurrency = quote;
      const days = HISTORY_DAYS[timeframe] || 30;
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
      const tsUrl = `${FRANKFURTER_BASE}/${startDate}..${endDate}?base=USD&symbols=${quoteCurrency}`;
      const tsRes = await axios.get(tsUrl, { timeout: 8000 });
      const tsData = tsRes.data;
      if (!tsData.rates || Object.keys(tsData.rates).length === 0) return [];
      const dates = Object.keys(tsData.rates).sort();
      const bars = dates.map((dateStr) => {
        const r = tsData.rates[dateStr][quoteCurrency];
        const t = new Date(dateStr).getTime();
        return { time: t, open: r, high: r, low: r, close: r, volume: 0 };
      });
      if (timeframe === 'H1' || timeframe === 'H4' || timeframe === 'M15' || timeframe === 'M5') {
        const lastRate = bars.length > 0 ? bars[bars.length - 1].close : 160;
        return buildSyntheticBars(lastRate, quoteCurrency, symbol, timeframe);
      }
      return bars;
    }

    // For EURUSD and GBPUSD — generate synthetic intraday bars from latest rate.
    return buildSyntheticBars(rate, quoteCurrency, symbol, timeframe);
  } catch (err) {
    console.warn(`Frankfurter bars error for ${symbol}: ${err.message}`);
    return [];
  }
}

import axios from 'axios';
import { fetchTradeLockerBars } from './tradeLockerOhlc.js';
import { fetchBinanceBars } from './binanceOhlc.js';

// CoinGecko: free keyless API for crypto OHLCV.
// Used as fallback when Binance is blocked on Render's server IPs.
// Maps internal symbol → CoinGecko coin id.
const COINGECKO_SYMBOLS = {
  BTCUSD: 'bitcoin',
  ETHUSD: 'ethereum',
  XRPUSD: 'ripple',
  LTCUSD: 'litecoin',
  DOTUSD: 'polkadot',
  XLMUSD: 'stellar',
  BATUSD: 'basic-attention-token',
  NEOUSD: 'neo',
  BTC: 'bitcoin',
  ETH: 'ethereum',
  XRP: 'ripple',
  LTC: 'litecoin',
  DOT: 'polkadot',
  XLM: 'stellar',
  BAT: 'basic-attention-token',
  NEO: 'neo',
};

async function fetchCoinGeckoBars(symbol, timeframe = 'D1') {
  const coinId = COINGECKO_SYMBOLS[symbol];
  if (!coinId) return [];

  // Map our timeframe to CoinGecko days parameter.
  // CoinGecko's OHLC endpoint only supports: 1, 7, 14, 30, 90, 180, 365, max.
  const TF_TO_CG_DAYS = { D1: 30, H4: 7, H1: 1, M15: 1, M5: 1 };
  const days = TF_TO_CG_DAYS[timeframe] || 30;

  try {
    const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`;
    const res = await axios.get(url, { timeout: 10000 });
    const klines = res.data;
    if (!Array.isArray(klines) || klines.length === 0) return [];

    return klines.map((k) => ({
      time: k[0],
      open: k[1],
      high: k[2],
      low: k[3],
      close: k[4],
      volume: 0,
    }));
  } catch (err) {
    console.warn(`CoinGecko bars failed for ${symbol}: ${err.response?.status} ${err.message}`);
    return [];
  }
}

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
    } else {
      console.warn(`Yahoo returned ${yahooBars.length} bars for ${symbol} ${timeframe} (need >=5) — falling through to Frankfurter/CoinGecko`);
    }
  } catch (err) {
    console.warn(`Yahoo bars error for ${symbol} ${timeframe}: ${err.message}`);
  }

  // Quaternary: Frankfurter — free spot rate for USD-based forex pairs.
  // Also covers EUR/USD and GBP/USD via EUR->USD conversion.
  // Generates synthetic intraday bars for strategy analysis.
  // Covers: USDJPY, GBPJPY, USDCAD, USDCHF, EURUSD, GBPUSD.
  if (!bars || bars.length < 5) {
    try {
      const fwBars = await fetchFrankfurterBars(symbol, timeframe);
      if (fwBars && fwBars.length > 0) {
        bars = fwBars;
        source = 'frankfurter';
      }
    } catch (err) {
      console.warn(`Frankfurter error for ${symbol}: ${err.message}`);
    }
  }

  // Quinary: CoinGecko — free, no API key, for crypto when Binance/Yahoo fail.
  // Covers BTC, ETH, XRP, LTC, DOT, XLM, BAT, NEO.
  if ((!bars || bars.length < 5) && COINGECKO_SYMBOLS[symbol]) {
    try {
      const cgBars = await fetchCoinGeckoBars(symbol, timeframe);
      if (cgBars && cgBars.length > 0) {
        bars = cgBars;
        source = 'coingecko';
      }
    } catch (err) {
      console.warn(`CoinGecko error for ${symbol}: ${err.message}`);
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
