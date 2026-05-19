import axios from 'axios';

const PERPLEXITY_API_URL = 'https://api.perplexity.ai';

export async function analyzeWithPerplexity(symbol, marketData) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  
  if (!apiKey) {
    throw new Error('PERPLEXITY_API_KEY not configured');
  }

  const prompt = `You are an expert forex and commodities trading analyst. Analyze ${symbol} and provide a comprehensive trading analysis.

Current Market Data (LIVE — use these exact reference values; do NOT substitute prices from your training data):
- Current Price: ${marketData.currentPrice}
- 24h High: ${marketData.high24h}
- 24h Low: ${marketData.low24h}
- Daily Change: ${marketData.changePercent}%

All price fields you return (entry_price, stop_loss, take_profit, support_levels, resistance_levels, key_level_1.price, key_level_2.price) MUST be realistic levels near the Current Price above. Entry should be within ~0.5% of Current Price for FX pairs (or within ~1% for XAUUSD). Match the precision of the Current Price.

Provide your analysis in the following JSON format ONLY (no other text):
{
  "direction": "buy" or "sell",
  "confidence": 0-100,
  "entry_price": number,
  "stop_loss": number,
  "take_profit": number,
  "risk_reward_ratio": number,
  "trend": "bullish" or "bearish" or "neutral",
  "trend_strength": 0-100,
  "support_levels": [price1, price2],
  "resistance_levels": [price1, price2],
  "key_level_1": { "price": number, "significance": "strong" or "medium" or "weak" },
  "key_level_2": { "price": number, "significance": "strong" or "medium" or "weak" },
  "sentiment": "bullish" or "bearish" or "neutral",
  "timeframes": {
    "H1": { "trend": "bullish" or "bearish" or "neutral", "signal": "strong" or "moderate" or "weak" },
    "H4": { "trend": "bullish" or "bearish" or "neutral", "signal": "strong" or "moderate" or "weak" },
    "D1": { "trend": "bullish" or "bearish" or "neutral", "signal": "strong" or "moderate" or "weak" }
  },
  "reasoning": "detailed explanation of your analysis",
  "market_summary": "brief summary of current market conditions",
  "risk_factors": ["risk1", "risk2", "risk3"],
  "trade_setup": {
    "type": "scalping" or "intraday" or "swing",
    " timeframe": "M5" or "M15" or "H1" or "H4" or "D1",
    "best_entry": "now" or "on pullback" or "on breakout",
    "explanation": "why this setup is favorable"
  }
}

IMPORTANT: Return ONLY valid JSON, no markdown code blocks, no explanations.`;

  try {
    const response = await axios.post(
      `${PERPLEXITY_API_URL}/chat/completions`,
      {
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: 'You are a professional trading analyst. Always respond with valid JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 2000,
        temperature: 0.3
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    );

    const content = response.data.choices[0].message.content;
    
    // Clean and parse JSON
    let cleanedContent = content.trim();
    if (cleanedContent.startsWith('```json')) {
      cleanedContent = cleanedContent.slice(7);
    } else if (cleanedContent.startsWith('```')) {
      cleanedContent = cleanedContent.slice(3);
    }
    if (cleanedContent.endsWith('```')) {
      cleanedContent = cleanedContent.slice(0, -3);
    }

    return JSON.parse(cleanedContent.trim());
  } catch (error) {
    console.error('Perplexity API error:', error.message);
    throw new Error(`Perplexity analysis failed: ${error.message}`);
  }
}

export async function analyzeMultipleSymbols(symbols, getMarketData) {
  const results = [];
  
  // Process 4 symbols at a time
  const batchSize = 4;
  
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1}: ${batch.join(', ')}`);
    
    const batchPromises = batch.map(async (symbol) => {
      try {
        const marketData = await getMarketData(symbol);
        const analysis = await analyzeWithPerplexity(symbol, marketData);
        return {
          symbol,
          success: true,
          data: analysis
        };
      } catch (error) {
        console.error(`Failed to analyze ${symbol}:`, error.message);
        return {
          symbol,
          success: false,
          error: error.message
        };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    // Small delay between batches to avoid rate limiting
    if (i + batchSize < symbols.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return results;
}
