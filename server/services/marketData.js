import axios from 'axios';

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
  H1:  { interval: '60m', range: '6mo'  },
  H4:  { interval: '60m', range: '2y',  resampleFrom: 'H1', resampleHours: 4 },
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

async function fetchYahooBars(yahooSymbol, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${interval}&range=${range}`;
  const response = await axios.get(url, {
    timeout: 12000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TradersLoungeBot/1.0)' },
  });
  return parseYahooChart(response.data);
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

  const cfg = TF_TO_YAHOO[timeframe];
  const yahooSymbol = resolveYahooSymbol(symbol);
  let bars = await fetchYahooBars(yahooSymbol, cfg.interval, cfg.range);
  if (cfg.resampleHours) {
    bars = resampleBars(bars, cfg.resampleHours);
  }

  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS[timeframe], bars });
  return bars;
}

// Convenience: fetch all timeframes used by the strategy in parallel.
export async function getMultiTimeframeBars(symbol) {
  const tfs = ['D1', 'H4', 'H1', 'M15', 'M5'];
  const results = await Promise.allSettled(tfs.map((tf) => getBars(symbol, tf)));
  const out = {};
  tfs.forEach((tf, i) => {
    const r = results[i];
    out[tf] = r.status === 'fulfilled' ? r.value : [];
    if (r.status === 'rejected') {
      console.warn(`getBars ${symbol} ${tf} failed: ${r.reason?.message || r.reason}`);
    }
  });
  return out;
}

export function latestPrice(bars) {
  return bars && bars.length ? bars[bars.length - 1].close : null;
}
