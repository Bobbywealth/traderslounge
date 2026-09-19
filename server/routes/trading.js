import express from 'express';

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

export default router;
export { router as tradingRouter };
