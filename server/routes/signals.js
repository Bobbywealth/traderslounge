import express from 'express';
import pg from 'pg';

const { Pool } = pg;
const router = express.Router();


const REFRESH_COOLDOWN_MS = 60 * 1000;

const refreshState = {
  inProgress: false,
  startedAt: null,
  finishedAt: null,
};

function buildRefreshMetadata() {
  const startedAt = refreshState.startedAt ? refreshState.startedAt.toISOString() : null;
  const finishedAt = refreshState.finishedAt ? refreshState.finishedAt.toISOString() : null;
  const nextAllowedRefreshAt = refreshState.finishedAt
    ? new Date(refreshState.finishedAt.getTime() + REFRESH_COOLDOWN_MS).toISOString()
    : null;

  return {
    inProgress: refreshState.inProgress,
    startedAt,
    finishedAt,
    nextAllowedRefreshAt,
  };
}

// Database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Signal schema SQL
const CREATE_SIGNALS_TABLE = `
CREATE TABLE IF NOT EXISTS signal_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(20) NOT NULL,
  analysis_type VARCHAR(50) NOT NULL,
  direction VARCHAR(10),
  entry_price DECIMAL(15, 5),
  stop_loss DECIMAL(15, 5),
  take_profit DECIMAL(15, 5),
  risk_reward_ratio DECIMAL(5, 2),
  confidence DECIMAL(5, 2),
  trend VARCHAR(20),
  trend_strength DECIMAL(5, 2),
  sentiment VARCHAR(20),
  reasoning TEXT,
  market_summary TEXT,
  support_levels JSONB,
  resistance_levels JSONB,
  key_levels JSONB,
  timeframes JSONB,
  trade_setup JSONB,
  risk_factors JSONB,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(symbol, analysis_type)
);

CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signal_analyses(symbol);
CREATE INDEX IF NOT EXISTS idx_signals_created ON signal_analyses(created_at);
`;

// Initialize table on startup
async function initializeTable() {
  try {
    await pool.query(CREATE_SIGNALS_TABLE);
    console.log('Signal analyses table initialized');
  } catch (error) {
    console.error('Failed to initialize signals table:', error.message);
  }
}
initializeTable();

import { runStrategy } from '../services/strategy.js';

// Get all signals
router.get('/', async (req, res) => {
  try {
    const { symbol, limit = 50, includeExpired = 'false' } = req.query;
    
    const limitVal = parseInt(limit);
    
    let query;
    let params;
    
    if (symbol && includeExpired === 'true') {
      query = 'SELECT * FROM signal_analyses WHERE symbol = $1 ORDER BY created_at DESC LIMIT $2';
      params = [symbol, limitVal];
    } else if (symbol) {
      query = 'SELECT * FROM signal_analyses WHERE symbol = $1 AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY created_at DESC LIMIT $2';
      params = [symbol, limitVal];
    } else if (includeExpired === 'true') {
      query = 'SELECT * FROM signal_analyses ORDER BY created_at DESC LIMIT $1';
      params = [limitVal];
    } else {
      query = 'SELECT * FROM signal_analyses WHERE expires_at IS NULL OR expires_at > NOW() ORDER BY created_at DESC LIMIT $1';
      params = [limitVal];
    }
    
    const result = await pool.query(query, params);
    res.json({ success: true, signals: result.rows });
  } catch (error) {
    console.error('Get signals error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single signal
router.get('/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    
    const result = await pool.query(
      'SELECT * FROM signal_analyses WHERE symbol = $1 ORDER BY created_at DESC LIMIT 1',
      [symbol]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Signal not found' });
    }
    
    res.json({ success: true, signal: result.rows[0] });
  } catch (error) {
    console.error('Get signal error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Refresh/Generate new analysis for symbols
router.post('/refresh', async (req, res) => {
  const forceRefresh = req.query.force === 'true';
  const metadata = buildRefreshMetadata();

  if (refreshState.inProgress) {
    return res.status(202).json({
      success: false,
      error: 'refresh already in progress.',
      ...metadata,
    });
  }

  if (!forceRefresh && metadata.nextAllowedRefreshAt && new Date(metadata.nextAllowedRefreshAt) > new Date()) {
    return res.status(429).json({
      success: false,
      error: 'refresh already in progress.',
      ...metadata,
    });
  }

  refreshState.inProgress = true;
  refreshState.startedAt = new Date();

  try {
    const DEFAULT_SYMBOLS = [
      'XAUUSD', 'GBPUSD', 'EURUSD', 'USDJPY', 'GBPJPY',
      'NAS100', 'US30',
      'BTCUSD', 'ETHUSD', 'XRPUSD', 'LTCUSD',
      'DOTUSD', 'XLMUSD', 'BATUSD', 'NEOUSD',
    ];
    const { symbols = DEFAULT_SYMBOLS } = req.body;

    const results = [];
    
    // Process 4 symbols at a time
    const batchSize = 4;
    
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      console.log(`Analyzing batch: ${batch.join(', ')}`);
      
      const batchPromises = batch.map(async (symbol) => {
        try {
          const analysis = await runStrategy(symbol);

          if (analysis.no_trade) {
            return { symbol, success: true, no_trade: true, reason: analysis.reason || 'No qualifying setup' };
          }

          const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000); // 4 hours
          const tradeSetup = {
            ...analysis.trade_setup,
            score_breakdown: analysis.score_breakdown,
            alert_level: analysis.alert_level,
            risk_level: analysis.risk_level,
            session: analysis.session,
            pattern: analysis.trade_setup?.pattern || null,
            tp1: analysis.tp1,
            tp2: analysis.tp2,
            tp3: analysis.tp3,
            adr: analysis.adr,
          };

          const result = await pool.query(`
            INSERT INTO signal_analyses (
              symbol, analysis_type, direction, entry_price, stop_loss, take_profit,
              risk_reward_ratio, confidence, trend, trend_strength, sentiment,
              reasoning, market_summary, support_levels, resistance_levels,
              key_levels, timeframes, trade_setup, risk_factors, expires_at
            ) VALUES (
              $1, 'strategy_v1', $2, $3, $4, $5,
              $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
            )
            ON CONFLICT (symbol, analysis_type) DO UPDATE SET
              direction = EXCLUDED.direction,
              entry_price = EXCLUDED.entry_price,
              stop_loss = EXCLUDED.stop_loss,
              take_profit = EXCLUDED.take_profit,
              risk_reward_ratio = EXCLUDED.risk_reward_ratio,
              confidence = EXCLUDED.confidence,
              trend = EXCLUDED.trend,
              trend_strength = EXCLUDED.trend_strength,
              sentiment = EXCLUDED.sentiment,
              reasoning = EXCLUDED.reasoning,
              market_summary = EXCLUDED.market_summary,
              support_levels = EXCLUDED.support_levels,
              resistance_levels = EXCLUDED.resistance_levels,
              key_levels = EXCLUDED.key_levels,
              timeframes = EXCLUDED.timeframes,
              trade_setup = EXCLUDED.trade_setup,
              risk_factors = EXCLUDED.risk_factors,
              expires_at = EXCLUDED.expires_at,
              updated_at = NOW()
            RETURNING *
          `, [
            symbol,
            analysis.direction,
            analysis.entry_price,
            analysis.stop_loss,
            analysis.take_profit,
            analysis.risk_reward_ratio,
            analysis.confidence,
            analysis.trend,
            analysis.trend_strength,
            analysis.sentiment,
            analysis.reasoning,
            analysis.market_summary,
            JSON.stringify(analysis.support_levels || []),
            JSON.stringify(analysis.resistance_levels || []),
            JSON.stringify(analysis.key_levels || {}),
            JSON.stringify(analysis.timeframes || {}),
            JSON.stringify(tradeSetup),
            JSON.stringify(analysis.risk_factors || []),
            expiresAt
          ]);

          return { symbol, success: true, signal: result.rows[0] };
        } catch (error) {
          console.error(`Failed to analyze ${symbol}:`, error);
          return { symbol, success: false, error: error.message };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Small delay between batches
      if (i + batchSize < symbols.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    const total = results.length;
    const failed = results.filter((result) => !result.success).length;
    const succeeded = total - failed;
    const summary = { total, succeeded, failed };

    if (failed === 0) {
      return res.status(200).json({ success: true, summary, results });
    }

    if (succeeded > 0) {
      return res.status(207).json({
        success: false,
        partial: true,
        summary,
        results
      });
    }

    return res.status(503).json({
      success: false,
      summary,
      results,
      error: 'Failed to refresh signals for all symbols'
    });
  } catch (error) {
    console.error('Refresh signals error:', error);
    refreshState.finishedAt = new Date();
    res.status(500).json({ success: false, error: error.message, ...buildRefreshMetadata() });
  } finally {
    refreshState.inProgress = false;
    refreshState.finishedAt = new Date();
  }
});

// Delete old signals
router.delete('/cleanup', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM signal_analyses WHERE expires_at < NOW() OR updated_at < NOW() - INTERVAL \'7 days\'');
    res.json({ success: true, deleted: result.rowCount });
  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export { router as signalsRouter };
