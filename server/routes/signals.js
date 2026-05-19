import express from 'express';
import { neon } from '@neondatabase/serverless';

const router = express.Router();

// Database connection
function getDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL not configured');
  }
  return neon(connectionString);
}

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
    const sql = getDb();
    await sql(CREATE_SIGNALS_TABLE);
    console.log('Signal analyses table initialized');
  } catch (error) {
    console.error('Failed to initialize signals table:', error.message);
  }
}
initializeTable();

// Import perplexity service
import { analyzeWithPerplexity } from './perplexity.js';

// Finnhub API for market data
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

async function getMarketData(symbol) {
  if (!FINNHUB_API_KEY) {
    // Return mock data if no API key
    return {
      currentPrice: 1.0425,
      high24h: 1.0480,
      low24h: 1.0380,
      changePercent: 0.25
    };
  }

  try {
    // Get quote data
    const quoteResponse = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=OANDA:${symbol.substring(0, 3)}_${symbol.substring(3, 6)}&token=${FINNHUB_API_KEY}`
    );
    const quote = await quoteResponse.json();
    
    return {
      currentPrice: quote.c || 1.0425,
      high24h: quote.h || (quote.c * 1.008),
      low24h: quote.l || (quote.c * 0.992),
      changePercent: quote.dp || 0
    };
  } catch (error) {
    console.error(`Failed to get market data for ${symbol}:`, error);
    throw error;
  }
}

// Get all signals
router.get('/', async (req, res) => {
  try {
    const { symbol, limit = 50, includeExpired = 'false' } = req.query;
    const sql = getDb();
    
    let query = 'SELECT * FROM signal_analyses';
    const params = [];
    
    if (symbol) {
      query += ' WHERE symbol = $1';
      params.push(symbol);
    }
    
    if (includeExpired !== 'true') {
      query += symbol ? ' AND (expires_at IS NULL OR expires_at > NOW())' : ' WHERE expires_at IS NULL OR expires_at > NOW()';
    }
    
    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
    params.push(parseInt(limit));
    
    const results = await sql(query, params);
    res.json({ success: true, signals: results });
  } catch (error) {
    console.error('Get signals error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single signal
router.get('/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const sql = getDb();
    
    const results = await sql(
      'SELECT * FROM signal_analyses WHERE symbol = $1 ORDER BY created_at DESC LIMIT 1',
      [symbol]
    );
    
    if (results.length === 0) {
      return res.status(404).json({ success: false, error: 'Signal not found' });
    }
    
    res.json({ success: true, signal: results[0] });
  } catch (error) {
    console.error('Get signal error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Refresh/Generate new analysis for symbols
router.post('/refresh', async (req, res) => {
  try {
    const { symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'AUDUSD', 'USDCAD'] } = req.body;
    
    if (!process.env.PERPLEXITY_API_KEY) {
      return res.status(500).json({ 
        success: false, 
        error: 'PERPLEXITY_API_KEY not configured' 
      });
    }
    
    const results = [];
    
    // Process 4 symbols at a time
    const batchSize = 4;
    
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      console.log(`Analyzing batch: ${batch.join(', ')}`);
      
      const batchPromises = batch.map(async (symbol) => {
        try {
          const marketData = await getMarketData(symbol);
          const analysis = await analyzeWithPerplexity(symbol, marketData);
          
          // Store in database
          const sql = getDb();
          const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000); // 4 hours
          
          const result = await sql`
            INSERT INTO signal_analyses (
              symbol, analysis_type, direction, entry_price, stop_loss, take_profit,
              risk_reward_ratio, confidence, trend, trend_strength, sentiment,
              reasoning, market_summary, support_levels, resistance_levels,
              key_levels, timeframes, trade_setup, risk_factors, expires_at
            ) VALUES (
              ${symbol}, 'perplexity_analysis', ${analysis.direction},
              ${analysis.entry_price}, ${analysis.stop_loss}, ${analysis.take_profit},
              ${analysis.risk_reward_ratio}, ${analysis.confidence}, ${analysis.trend},
              ${analysis.trend_strength}, ${analysis.sentiment}, ${analysis.reasoning},
              ${analysis.market_summary}, ${JSON.stringify(analysis.support_levels)},
              ${JSON.stringify(analysis.resistance_levels)}, ${JSON.stringify({ key_level_1: analysis.key_level_1, key_level_2: analysis.key_level_2 })},
              ${JSON.stringify(analysis.timeframes)}, ${JSON.stringify(analysis.trade_setup)},
              ${JSON.stringify(analysis.risk_factors)}, ${expiresAt}
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
          `;
          
          return { symbol, success: true, signal: result[0] };
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
    
    res.json({ success: true, results });
  } catch (error) {
    console.error('Refresh signals error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete old signals
router.delete('/cleanup', async (req, res) => {
  try {
    const sql = getDb();
    const result = await sql('DELETE FROM signal_analyses WHERE expires_at < NOW() OR updated_at < NOW() - INTERVAL \'7 days\'');
    res.json({ success: true, deleted: result.length });
  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export { router as signalsRouter };
