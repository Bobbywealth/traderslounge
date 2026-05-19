// TradeLocker OHLC fetcher.
// Resolves our internal symbol to a broker-specific instrument + INFO route,
// then pulls candles via /trade/history. Returns null on any failure so the
// caller can fall back to Yahoo.
import { getValidTokens, tlRequest } from '../routes/tradelocker.js';

// Cache the broker instruments list per accountId (1h TTL).
const INSTRUMENTS_TTL_MS = 60 * 60 * 1000;
const instrumentsCache = new Map(); // accountId -> { fetchedAt, instruments }

// Map our internal symbol to common aliases the broker may use.
// First match in the broker's instruments list wins.
const SYMBOL_ALIASES = {
  EURUSD: ['EURUSD', 'EUR/USD', 'EUR_USD'],
  GBPUSD: ['GBPUSD', 'GBP/USD', 'GBP_USD'],
  USDJPY: ['USDJPY', 'USD/JPY', 'USD_JPY'],
  GBPJPY: ['GBPJPY', 'GBP/JPY', 'GBP_JPY'],
  AUDUSD: ['AUDUSD', 'AUD/USD'],
  USDCAD: ['USDCAD', 'USD/CAD'],
  NZDUSD: ['NZDUSD', 'NZD/USD'],
  USDCHF: ['USDCHF', 'USD/CHF'],
  XAUUSD: ['XAUUSD', 'XAU/USD', 'GOLD', 'Gold'],
  XAGUSD: ['XAGUSD', 'XAG/USD', 'SILVER'],
  NAS100: ['NAS100', 'NDX100', 'USTECH100', 'US100', 'NDX', 'NQ100'],
  US30:   ['US30', 'DJ30', 'USA30', 'WS30', 'DJI'],
  SPX500: ['SPX500', 'US500', 'SPX', 'SP500'],
  BTCUSD: ['BTCUSD', 'BTC/USD', 'BTC-USD'],
  ETHUSD: ['ETHUSD', 'ETH/USD', 'ETH-USD'],
  XRPUSD: ['XRPUSD', 'XRP/USD'],
  LTCUSD: ['LTCUSD', 'LTC/USD'],
  DOTUSD: ['DOTUSD', 'DOT/USD'],
  XLMUSD: ['XLMUSD', 'XLM/USD'],
  BATUSD: ['BATUSD', 'BAT/USD'],
  NEOUSD: ['NEOUSD', 'NEO/USD'],
};

// TradeLocker resolution codes.
const RESOLUTION_BY_TF = {
  M1: '1',
  M5: '5',
  M15: '15',
  H1: '60',
  H4: '240',
  D1: '1D',
};

// How far back to request, in ms, for each timeframe. Keep generous so we
// have enough bars for EMA200 / ADR(20).
const LOOKBACK_MS_BY_TF = {
  M1:  3 * 24 * 60 * 60 * 1000,
  M5:  7 * 24 * 60 * 60 * 1000,
  M15: 14 * 24 * 60 * 60 * 1000,
  H1:  90 * 24 * 60 * 60 * 1000,
  H4:  180 * 24 * 60 * 60 * 1000,
  D1:  365 * 2 * 24 * 60 * 60 * 1000,
};

async function loadInstruments(tokens) {
  const accountId = tokens.accountId;
  if (!accountId) return [];
  const cached = instrumentsCache.get(accountId);
  if (cached && cached.fetchedAt + INSTRUMENTS_TTL_MS > Date.now()) {
    return cached.instruments;
  }
  try {
    const response = await tlRequest('GET', `/trade/accounts/${accountId}/instruments`, tokens);
    // Response shape varies: { d: { instruments: [...] } } or { instruments: [...] } or { d: [...] }
    const data = response.data;
    let instruments = data?.d?.instruments || data?.instruments || data?.d || [];
    if (!Array.isArray(instruments)) instruments = [];
    instrumentsCache.set(accountId, { fetchedAt: Date.now(), instruments });
    console.log(`TradeLocker instruments loaded: ${instruments.length} for account ${accountId}`);
    return instruments;
  } catch (err) {
    console.warn(`TradeLocker instruments fetch failed: ${err.response?.status} ${err.message}`);
    return [];
  }
}

// Find an instrument whose name matches one of the aliases for `symbol`.
function findInstrument(instruments, symbol) {
  const aliases = SYMBOL_ALIASES[symbol] || [symbol];
  const aliasSet = new Set(aliases.map((a) => a.toUpperCase()));
  for (const inst of instruments) {
    const name = (inst.name || inst.symbol || inst.tradableInstrumentName || '').toUpperCase();
    if (aliasSet.has(name)) return inst;
  }
  // Looser match: name contains an alias as a prefix.
  for (const inst of instruments) {
    const name = (inst.name || inst.symbol || inst.tradableInstrumentName || '').toUpperCase();
    for (const a of aliases) {
      if (name.startsWith(a.toUpperCase())) return inst;
    }
  }
  return null;
}

// Extract the INFO route id from an instrument; falls back to any route.
function infoRouteId(instrument) {
  const routes = instrument.routes || instrument.routeIds || [];
  if (!Array.isArray(routes)) return null;
  const info = routes.find((r) => (r.type || '').toUpperCase() === 'INFO');
  if (info) return info.id ?? info.routeId ?? info;
  // Some payloads list ids directly (numbers or strings).
  const first = routes[0];
  if (first && typeof first === 'object') return first.id ?? first.routeId ?? null;
  return first || null;
}

function parseBars(payload) {
  // TradeLocker history responses we've seen in the wild come in a few shapes:
  //   { d: { barDetails: [{t,o,h,l,c,v}, ...] } }
  //   { barDetails: [...] }
  //   { d: [[t,o,h,l,c,v], ...] }
  //   { s: 'ok', t: [...], o: [...], h: [...], l: [...], c: [...], v: [...] } (UDF)
  const data = payload || {};

  // Shape 1+2: object array under barDetails
  const bd = data.barDetails || data.d?.barDetails;
  if (Array.isArray(bd)) {
    return bd
      .map((b) => ({
        time: Number(b.t) * (Number(b.t) < 1e12 ? 1000 : 1),
        open: Number(b.o), high: Number(b.h), low: Number(b.l), close: Number(b.c),
        volume: Number(b.v) || 0,
      }))
      .filter((b) => Number.isFinite(b.open) && Number.isFinite(b.close));
  }

  // Shape 3: array-of-arrays
  if (Array.isArray(data.d) && data.d.length && Array.isArray(data.d[0])) {
    return data.d
      .map(([t, o, h, l, c, v]) => ({
        time: Number(t) * (Number(t) < 1e12 ? 1000 : 1),
        open: Number(o), high: Number(h), low: Number(l), close: Number(c),
        volume: Number(v) || 0,
      }))
      .filter((b) => Number.isFinite(b.open) && Number.isFinite(b.close));
  }

  // Shape 4: parallel arrays (UDF)
  if (Array.isArray(data.t) && Array.isArray(data.c)) {
    const out = [];
    for (let i = 0; i < data.t.length; i++) {
      const t = Number(data.t[i]);
      const open = Number(data.o?.[i]);
      const close = Number(data.c?.[i]);
      if (!Number.isFinite(open) || !Number.isFinite(close)) continue;
      out.push({
        time: t * (t < 1e12 ? 1000 : 1),
        open,
        high: Number(data.h?.[i]),
        low: Number(data.l?.[i]),
        close,
        volume: Number(data.v?.[i]) || 0,
      });
    }
    return out;
  }

  return [];
}

export async function fetchTradeLockerBars(symbol, timeframe) {
  const tokens = await getValidTokens(null);
  if (!tokens) return null; // not authenticated → caller falls back to Yahoo

  const resolution = RESOLUTION_BY_TF[timeframe];
  const lookback = LOOKBACK_MS_BY_TF[timeframe];
  if (!resolution || !lookback) return null;

  const instruments = await loadInstruments(tokens);
  if (!instruments.length) return null;

  const instrument = findInstrument(instruments, symbol);
  if (!instrument) {
    // Don't spam logs for every missing symbol; one-time at debug-ish level.
    console.warn(`TradeLocker: no instrument match for ${symbol}`);
    return null;
  }

  const tradableInstrumentId = instrument.tradableInstrumentId ?? instrument.id;
  const routeId = infoRouteId(instrument);
  if (!tradableInstrumentId || !routeId) {
    console.warn(`TradeLocker: missing routeId/instrumentId for ${symbol}`);
    return null;
  }

  // TradeLocker's /trade/history expects Unix seconds, not milliseconds.
  // Passing ms makes the server interpret from/to as year ~56000 and return
  // an empty bar set silently — visible in production as
  // "TradeLocker: empty bars for X H1/H4" despite a 200 OK response.
  const to = Math.floor(Date.now() / 1000);
  const from = Math.floor((Date.now() - lookback) / 1000);
  const params = {
    routeId,
    tradableInstrumentId,
    from,
    to,
    resolution,
  };

  try {
    const response = await tlRequest('GET', '/trade/history', tokens, null, params);
    const bars = parseBars(response.data);
    if (bars.length === 0) {
      console.warn(`TradeLocker: empty bars for ${symbol} ${timeframe}`);
      return null;
    }
    return bars;
  } catch (err) {
    console.warn(`TradeLocker history fetch failed for ${symbol} ${timeframe}: ${err.response?.status} ${err.message}`);
    return null;
  }
}
