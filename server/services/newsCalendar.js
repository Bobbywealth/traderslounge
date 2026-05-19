// Finnhub economic-calendar integration + per-symbol news blackout gate.
// Falls back to a no-op gate when FINNHUB_API_KEY isn't configured so
// missing config never blocks signal generation.
import axios from 'axios';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

// Country (Finnhub uses ISO-3166 codes) -> currency for symbol matching.
const COUNTRY_TO_CURRENCY = {
  US: 'USD',
  EU: 'EUR',
  DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR',
  GB: 'GBP', UK: 'GBP',
  JP: 'JPY',
  AU: 'AUD',
  CA: 'CAD',
  CH: 'CHF',
  NZ: 'NZD',
};

// Symbol -> array of currencies affected by news. Crypto and indices use
// USD-only since FOMC/CPI is what actually moves them.
const SYMBOL_CURRENCIES = {
  EURUSD: ['EUR', 'USD'],
  GBPUSD: ['GBP', 'USD'],
  USDJPY: ['USD', 'JPY'],
  GBPJPY: ['GBP', 'JPY'],
  AUDUSD: ['AUD', 'USD'],
  USDCAD: ['USD', 'CAD'],
  NZDUSD: ['NZD', 'USD'],
  USDCHF: ['USD', 'CHF'],
  XAUUSD: ['USD'],
  XAGUSD: ['USD'],
  NAS100: ['USD'],
  US30: ['USD'],
  SPX500: ['USD'],
  BTCUSD: ['USD'],
  ETHUSD: ['USD'],
  XRPUSD: ['USD'],
  LTCUSD: ['USD'],
  DOTUSD: ['USD'],
  XLMUSD: ['USD'],
  BATUSD: ['USD'],
  NEOUSD: ['USD'],
};

const DEFAULT_CONFIG = {
  blackoutMinutesBefore: 30,
  blackoutMinutesAfter: 30,
  blockedImpacts: ['high'], // Finnhub uses low/medium/high; treat 'high' as red-folder
};

// In-memory cache of all events for a window; refreshed hourly.
let cache = { fetchedAt: 0, events: [] };
const CACHE_TTL_MS = 60 * 60 * 1000;

function symbolCurrencies(symbol) {
  return SYMBOL_CURRENCIES[symbol] || [];
}

// Finnhub's calendar returns `time` as "YYYY-MM-DD HH:mm:ss" in UTC.
function parseEventTime(time) {
  if (!time) return NaN;
  // Add explicit Z so Date treats it as UTC across browsers/Node.
  const iso = time.replace(' ', 'T') + 'Z';
  return new Date(iso).getTime();
}

async function fetchUpcomingEvents() {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return [];

  // Pull a 3-day window: yesterday through 2 days ahead so we see anything
  // currently active and near-term upcoming events.
  const now = new Date();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const url = `${FINNHUB_BASE}/calendar/economic?from=${from}&to=${to}&token=${apiKey}`;

  const response = await axios.get(url, { timeout: 12000 });
  const raw = response.data?.economicCalendar || [];
  return raw.map((e) => ({
    timeMs: parseEventTime(e.time),
    country: e.country,
    currency: COUNTRY_TO_CURRENCY[e.country] || e.country,
    event: e.event,
    impact: (e.impact || '').toLowerCase(),
  })).filter((e) => Number.isFinite(e.timeMs));
}

export async function getEconomicCalendar() {
  const now = Date.now();
  if (cache.fetchedAt + CACHE_TTL_MS > now && cache.events.length) {
    return cache.events;
  }
  try {
    const events = await fetchUpcomingEvents();
    cache = { fetchedAt: now, events };
    return events;
  } catch (error) {
    console.warn(`Finnhub calendar fetch failed: ${error.message}`);
    // Keep stale cache rather than wiping it.
    return cache.events;
  }
}

// Evaluate whether `now` falls inside a red-folder blackout window for `symbol`.
// Returns { blocked, event, nextEvent } — nextEvent is the soonest upcoming
// high-impact event for the symbol's currencies (for surfacing in the UI).
export async function evaluateNewsBlackout(symbol, now = new Date(), config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const currencies = symbolCurrencies(symbol);
  if (currencies.length === 0) {
    return { blocked: false, event: null, nextEvent: null, configured: !!process.env.FINNHUB_API_KEY };
  }

  const events = await getEconomicCalendar();
  if (!events.length) {
    return { blocked: false, event: null, nextEvent: null, configured: !!process.env.FINNHUB_API_KEY };
  }

  const nowMs = now.getTime();
  const beforeMs = cfg.blackoutMinutesBefore * 60_000;
  const afterMs = cfg.blackoutMinutesAfter * 60_000;

  const relevant = events.filter((e) =>
    currencies.includes(e.currency) &&
    cfg.blockedImpacts.includes(e.impact)
  );

  let blocking = null;
  let upcoming = null;
  for (const e of relevant) {
    if (nowMs >= e.timeMs - beforeMs && nowMs <= e.timeMs + afterMs) {
      blocking = e;
    } else if (e.timeMs > nowMs && (!upcoming || e.timeMs < upcoming.timeMs)) {
      upcoming = e;
    }
  }

  return {
    blocked: !!blocking,
    event: blocking ? {
      name: blocking.event,
      currency: blocking.currency,
      impact: blocking.impact,
      time: new Date(blocking.timeMs).toISOString(),
    } : null,
    nextEvent: upcoming ? {
      name: upcoming.event,
      currency: upcoming.currency,
      impact: upcoming.impact,
      time: new Date(upcoming.timeMs).toISOString(),
      minutesAway: Math.round((upcoming.timeMs - nowMs) / 60_000),
    } : null,
    configured: true,
  };
}
