import express from 'express';
import pg from 'pg';

const { Pool } = pg;
const router = express.Router();

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
  chart_urls JSONB,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(symbol, analysis_type)
);

CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signal_analyses(symbol);
CREATE INDEX IF NOT EXISTS idx_signals_created ON signal_analyses(created_at);
`;

// Generate TradingView chart URLs for each timeframe
function getChartUrls(symbol) {
  // Convert symbol to TradingView format (e.g., EURUSD -> OANDA:EURUSD)
  const tvSymbol = `OANDA:${symbol}`;

  // Timeframe intervals: M15=15, H1=60, H4=240, D1=1D, W1=1W, MN=1M
  const timeframes = {
    'M15': 15,
    'H1': 60,
    'H4': 240,
    'D1': '1D',
    'W1': '1W',
    'MN': '1M'
  };

  const charts = {};
  for (const [name, interval] of Object.entries(timeframes)) {
    const params = new URLSearchParams({
      symbol: tvSymbol,
      interval: String(interval),
      theme: 'dark',
      style: '1',
      locale: 'en',
      toolbarbg: 'f1f3f6',
      hideideasbutton: '1',
      hidelegend: '0',
      saveimage: '1',
      calendar: '0',
      studies: '[]',
      hidevolume: '0'
    });

    charts[name] = `https://www.tradingview.com/widget/?${params.toString()}`;
  }

  return charts;
}

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

// Import perplexity service
import { analyzeWithPerplexity } from './perplexity.js';

// Yahoo Finance API for market data (free, no API key needed)
async function getMarketData(symbol) {
  try {
    // Map symbol to Yahoo Finance format (e.g., EURUSD -> EURUSD=X)
    const yahooSymbol = `${symbol}=X`;
    
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=1d`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      }
    );
    
    if (!response.ok) {
      throw new Error(`Yahoo Finance API error: ${response.status}`);
    }
    
    const data = await response.json();
    const result = data?.chart?.result?.[0];
    
    if (!result || !result.meta) {
      throw new Error('Invalid response from Yahoo Finance');
    }
    
    const meta = result.meta;
    
    return {
      currentPrice: meta.regularMarketPrice || meta.previousClose,
      high24h: meta.regularMarketDayHigh || meta.previousClose,
      low24h: meta.regularMarketDayLow || meta.previousClose,
      changePercent: meta.regularMarketChangePercent || 0
    };
  } catch (error) {
    console.error(`Failed to get market data for ${symbol}:`, error);
    // Return null for prices to signal that analysis should be skipped
    return {
      currentPrice: null,
      high24h: null,
      low24h: null,
      changePercent: 0
    };
  }
}

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
          const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000); // 4 hours
          
          const chartUrls = getChartUrls(symbol);
          
          const result = await pool.query(`
            INSERT INTO signal_analyses (
              symbol, analysis_type, direction, entry_price, stop_loss, take_profit,
              risk_reward_ratio, confidence, trend, trend_strength, sentiment,
              reasoning, market_summary, support_levels, resistance_levels,
              key_levels, timeframes, trade_setup, risk_factors, chart_urls, expires_at
            ) VALUES (
              $1, 'perplexity_analysis', $2, $3, $4, $5,
              $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
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
              chart_urls = EXCLUDED.chart_urls,
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
            JSON.stringify(analysis.support_levels),
            JSON.stringify(analysis.resistance_levels),
            JSON.stringify({ key_level_1: analysis.key_level_1, key_level_2: analysis.key_level_2 }),
            JSON.stringify(analysis.timeframes),
            JSON.stringify(analysis.trade_setup),
            JSON.stringify(analysis.risk_factors),
            JSON.stringify(chartUrls),
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
    
    res.json({ success: true, results });
  } catch (error) {
    console.error('Refresh signals error:', error);
    res.status(500).json({ success: false, error: error.message });
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
