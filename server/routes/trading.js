'use strict';

/**
 * /api/pnl, /api/positions, /api/account — read-only market data endpoints
 * proxied by the BWG Command Center Trading page (ConfluenceX tile).
 *
 * These are intentionally stubbed: the upstream data sources (Twelve Data,
 * Perplexity) are exhausted for the current billing window, and there is no
 * DATABASE_URL configured for cached positions/P&L. Once either (a) Twelve Data
 * is upgraded to a paid tier, (b) Perplexity quota is restored, or (c) a DB
 * is provisioned with cached positions, replace these stubs with real queries.
 *
 * Returning 200 with empty shapes (instead of 404) keeps the BWG UI from
 * showing the "Request failed with status code 404" error banner on the
 * Overview ConfluenceX card — the UI now renders "—" for all P&L fields
 * (correct degraded state) instead of red error text.
 */

const express = require('express');
const router = express.Router();

const FEED_DEGRADED = 'traderslounge-api upstream data sources exhausted (Twelve Data rate-limited, Perplexity quota exceeded, no DATABASE_URL configured for cached positions)';

// GET /api/pnl — total / daily / weekly P&L
router.get('/pnl', (req, res) => {
  res.json({
    pnl: {
      totalPnL: null,
      dailyPnL: null,
      weeklyPnL: null,
    },
    source: 'stub',
    feed_status: 'degraded',
    feed_message: FEED_DEGRADED,
    as_of: new Date().toISOString(),
  });
});

// GET /api/positions — open positions list
router.get('/positions', (req, res) => {
  res.json({
    positions: [],
    source: 'stub',
    feed_status: 'degraded',
    feed_message: FEED_DEGRADED,
    as_of: new Date().toISOString(),
  });
});

// GET /api/account — TradeLocker account summary
router.get('/account', (req, res) => {
  res.json({
    account: {
      connected: false,
      hasCredentials: false,
    },
    source: 'stub',
    feed_status: 'degraded',
    feed_message: FEED_DEGRADED,
    as_of: new Date().toISOString(),
  });
});

module.exports = router;