// Signal strategy orchestrator: pulls multi-timeframe OHLC, computes
// every feature, applies the 100-pt rubric, and emits a trade setup.
import { getMultiTimeframeBars } from './marketData.js';
import {
  calculateAdr,
  detectSwings,
  analyzeStructure,
  timeframeBias,
  rsiAnalysis,
} from './indicators.js';
import {
  fibonacciFromSwings,
  findLiquidity,
  detectHarmonic,
  currentSession,
} from './patterns.js';
import { evaluateNewsBlackout } from './newsCalendar.js';

// Pip multiplier per symbol class (used for SL/TP distancing).
function pipMultiplier(symbol) {
  if (symbol.includes('JPY')) return 0.01;
  if (symbol === 'XAUUSD' || symbol === 'XAGUSD') return 0.1;
  if (symbol === 'NAS100' || symbol === 'US30' || symbol === 'SPX500') return 1;
  if (/BTC|ETH/i.test(symbol)) return 1;
  return 0.0001;
}

function pricePrecision(symbol) {
  if (symbol.includes('JPY')) return 3;
  if (symbol === 'XAUUSD') return 2;
  if (symbol === 'NAS100' || symbol === 'US30' || symbol === 'SPX500') return 2;
  if (/BTC|ETH/i.test(symbol)) return 2;
  return 5;
}

function round(value, precision) {
  if (!Number.isFinite(value)) return null;
  const f = Math.pow(10, precision);
  return Math.round(value * f) / f;
}

// Aggregate D1/H4/H1 biases into the HTF view the existing client expects.
function aggregateHtfBias(d1, h4, h1) {
  const weights = { D1: 0.5, H4: 0.3, H1: 0.2 };
  const bullish = (d1.trend === 'bullish' ? weights.D1 : 0) +
                  (h4.trend === 'bullish' ? weights.H4 : 0) +
                  (h1.trend === 'bullish' ? weights.H1 : 0);
  const bearish = (d1.trend === 'bearish' ? weights.D1 : 0) +
                  (h4.trend === 'bearish' ? weights.H4 : 0) +
                  (h1.trend === 'bearish' ? weights.H1 : 0);
  const hardInvalid = (d1.trend === 'bullish' && h4.trend === 'bearish') ||
                      (d1.trend === 'bearish' && h4.trend === 'bullish');
  let status = 'neutral';
  if (hardInvalid) status = 'mixed';
  else if (bullish > bearish && bullish > 0) status = 'bullish';
  else if (bearish > bullish && bearish > 0) status = 'bearish';
  else if (bullish > 0 || bearish > 0) status = 'mixed';
  const aligned = !hardInvalid && status !== 'mixed' && status !== 'neutral';
  const trend = status === 'bullish' || status === 'bearish' ? status : 'neutral';
  const strength = Math.round(Math.max(bullish, bearish) * 100);
  return { status, aligned, hardInvalid, trend, strength };
}

// Decide overall trade direction from HTF bias and supporting signals.
function chooseDirection(htf, harmonic, sweep, structure) {
  if (harmonic) return harmonic.direction === 'bullish' ? 'buy' : 'sell';
  if (htf.trend === 'bullish') return 'buy';
  if (htf.trend === 'bearish') return 'sell';
  if (sweep) return sweep.kind === 'bullish' ? 'buy' : 'sell';
  if (structure.trend === 'bullish') return 'buy';
  if (structure.trend === 'bearish') return 'sell';
  return null;
}

// Score breakdown matching the user's 100-pt rubric.
function scoreSignal({ direction, htf, adr, fib, harmonic, structure, liquidity, rsi }) {
  const breakdown = {
    htf_bias_aligned: 0,
    adr_level_respected: 0,
    fibonacci_zone: 0,
    harmonic_pattern: 0,
    market_structure: 0,
    liquidity_sweep: 0,
    rsi_confirmation: 0,
  };
  const reasons = [];

  // HTF bias aligned (+20)
  if (htf.aligned && ((direction === 'buy' && htf.trend === 'bullish') || (direction === 'sell' && htf.trend === 'bearish'))) {
    breakdown.htf_bias_aligned = 20;
    reasons.push(`HTF aligned ${htf.trend} (D1+H4+H1)`);
  }
  // ADR respected (+15) — buy near ADR low / sell near ADR high, don't chase extremes
  if (adr) {
    const nearExtreme = direction === 'buy' ? adr.nearAdrLow : adr.nearAdrHigh;
    if (nearExtreme && !adr.exhausted) {
      breakdown.adr_level_respected = 15;
      reasons.push(direction === 'buy' ? 'Buy near ADR low' : 'Sell near ADR high');
    } else if (nearExtreme && adr.exhausted) {
      // Don't penalize but don't reward — extreme is fine for entries
      breakdown.adr_level_respected = 5;
      reasons.push(`ADR ${adr.percentUsed.toFixed(0)}% — entry at extreme`);
    } else if (!adr.exhausted) {
      // Mid-range — not optimal but valid
      breakdown.adr_level_respected = 8;
      reasons.push(`ADR ${adr.percentUsed.toFixed(0)}% used`);
    } else {
      // ADR exhausted and not near extreme — bad setup
      breakdown.adr_level_respected = 0;
      reasons.push(`ADR ${adr.percentUsed.toFixed(0)}% — range exhausted`);
    }
  }
  // Fibonacci golden zone (+15)
  if (fib?.inGoldenZone) {
    breakdown.fibonacci_zone = 15;
    reasons.push('Price in 0.5–0.786 fib zone');
  } else if (fib?.zone === 'shallow') {
    breakdown.fibonacci_zone = 6;
  }
  // Harmonic completed (+20)
  if (harmonic && ((direction === 'buy' && harmonic.direction === 'bullish') || (direction === 'sell' && harmonic.direction === 'bearish'))) {
    breakdown.harmonic_pattern = 20;
    reasons.push(`${harmonic.name} harmonic at PRZ`);
  }
  // Market structure confirmed (+15)
  if ((direction === 'buy' && structure.trend === 'bullish') || (direction === 'sell' && structure.trend === 'bearish')) {
    breakdown.market_structure = 15;
    reasons.push(`Structure: ${structure.trend} (HH/HL or LL/LH)`);
  } else if (structure.lastChoch && ((direction === 'buy' && structure.lastChoch.kind === 'bullish') || (direction === 'sell' && structure.lastChoch.kind === 'bearish'))) {
    breakdown.market_structure = 10;
    reasons.push(`Recent ${structure.lastChoch.kind} CHOCH`);
  }
  // Liquidity sweep (+10)
  if (liquidity?.sweep && ((direction === 'buy' && liquidity.sweep.kind === 'bullish') || (direction === 'sell' && liquidity.sweep.kind === 'bearish'))) {
    breakdown.liquidity_sweep = 10;
    reasons.push(`${liquidity.sweep.kind} sweep of ${liquidity.sweep.side === 'high' ? 'highs' : 'lows'} at ${liquidity.sweep.level}`);
  }
  // RSI confirmation (+5)
  if (rsi) {
    if (direction === 'buy' && (rsi.oversold || rsi.bullishDivergence)) {
      breakdown.rsi_confirmation = 5;
      reasons.push(rsi.bullishDivergence ? 'Bullish RSI divergence' : `RSI oversold (${rsi.value.toFixed(0)})`);
    } else if (direction === 'sell' && (rsi.overbought || rsi.bearishDivergence)) {
      breakdown.rsi_confirmation = 5;
      reasons.push(rsi.bearishDivergence ? 'Bearish RSI divergence' : `RSI overbought (${rsi.value.toFixed(0)})`);
    }
  }

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  let alertLevel = 'no_trade';
  if (total >= 80) alertLevel = 'strong';
  else if (total >= 65) alertLevel = 'good';
  else if (total >= 50) alertLevel = 'watchlist';
  else if (total >= 30) alertLevel = 'low_confidence';
  return { breakdown, total, alertLevel, reasons };
}

// Build entry, SL, TP1/2/3 using ATR-like distance (ADR fraction).
function buildTradeLevels({ symbol, direction, currentPrice, fib, harmonic, liquidity, adr, structure, swings }) {
  const precision = pricePrecision(symbol);

  // Entry: prefer fib golden zone, then harmonic PRZ, then current price
  let entry = currentPrice;
  if (fib?.inGoldenZone) {
    entry = fib.retracements[0.618];
  } else if (fib?.zone === 'shallow') {
    entry = fib.retracements[0.786];
  } else if (harmonic) {
    entry = harmonic.prz;
  }

  // Stop loss: beyond 0.886 fib, swing low/high, or sweep level
  const recentSwings = swings.slice(-6);
  const oppHighs = recentSwings.filter((s) => s.type === 'high').map((s) => s.price);
  const oppLows = recentSwings.filter((s) => s.type === 'low').map((s) => s.price);
  const adrFraction = adr ? adr.adr * 0.25 : Math.abs(currentPrice) * 0.003;

  let stop;
  if (direction === 'buy') {
    const fib886 = fib?.retracements?.[0.886];
    const swingLow = oppLows.length ? Math.min(...oppLows) : entry - adrFraction;
    stop = fib886 && fib886 < entry ? fib886 : Math.min(swingLow, entry - adrFraction * 0.5);
    if (liquidity?.sweep?.kind === 'bullish' && liquidity.sweep.side === 'low') {
      stop = Math.min(stop, liquidity.sweep.level - adrFraction * 0.25);
    }
  } else {
    const fib886 = fib?.retracements?.[0.886];
    const swingHigh = oppHighs.length ? Math.max(...oppHighs) : entry + adrFraction;
    stop = fib886 && fib886 > entry ? fib886 : Math.max(swingHigh, entry + adrFraction * 0.5);
    if (liquidity?.sweep?.kind === 'bearish' && liquidity.sweep.side === 'high') {
      stop = Math.max(stop, liquidity.sweep.level + adrFraction * 0.25);
    }
  }

  const risk = Math.abs(entry - stop);
  if (risk <= 0) return null;

  // Targets: TP1 = structure first reaction, TP2 = 1.618 extension or 2R, TP3 = 2.618 extension or 3R
  let tp1, tp2, tp3;
  if (direction === 'buy') {
    // TP1: first resistance above entry (prev swing high or adr high)
    const firstResist = oppHighs.length ? Math.min(...oppHighs.filter(h => h > entry)) : null;
    tp1 = firstResist && firstResist < entry + risk * 1.5 ? firstResist : entry + risk;
    // TP2: fib 1.618 extension if available, else 2R
    tp2 = fib?.extensions?.[1.618] && fib.extensions[1.618] > entry ? fib.extensions[1.618] : entry + risk * 2;
    // TP3: fib 2.618 extension if available, else 3R
    tp3 = fib?.extensions?.[2.618] && fib.extensions[2.618] > tp2 ? fib.extensions[2.618] : entry + risk * 3;
  } else {
    // TP1: first support below entry (prev swing low or adr low)
    const firstSupport = oppLows.length ? Math.max(...oppLows.filter(l => l < entry)) : null;
    tp1 = firstSupport && firstSupport > entry - risk * 1.5 ? firstSupport : entry - risk;
    // TP2: fib 1.618 extension if available, else 2R
    tp2 = fib?.extensions?.[1.618] && fib.extensions[1.618] < entry ? fib.extensions[1.618] : entry - risk * 2;
    // TP3: fib 2.618 extension if available, else 3R
    tp3 = fib?.extensions?.[2.618] && fib.extensions[2.618] < tp2 ? fib.extensions[2.618] : entry - risk * 3;
  }

  return {
    entry: round(entry, precision),
    stop: round(stop, precision),
    tp1: round(tp1, precision),
    tp2: round(tp2, precision),
    tp3: round(tp3, precision),
    risk_reward_ratio: round(Math.abs(tp2 - entry) / Math.abs(entry - stop), 2),
  };
}

// Generate a setup type label from features.
function setupType(htf, h1Trend) {
  if (htf.aligned && htf.strength >= 70) return 'swing';
  if (h1Trend === 'bullish' || h1Trend === 'bearish') return 'intraday';
  return 'scalping';
}

export async function runStrategy(symbol) {
  const tfBars = await getMultiTimeframeBars(symbol);
  const { D1: d1Bars, H4: h4Bars, H1: h1Bars } = tfBars;

  // D1 + H1 are required. H4 is helpful but the strategy can still run
  // with a neutral H4 bias if just that timeframe was rate-limited.
  if (!d1Bars.length || !h1Bars.length) {
    throw new Error(`No market data for ${symbol}`);
  }

  const currentPrice = h1Bars[h1Bars.length - 1].close;

  const d1Bias = timeframeBias(d1Bars);
  const h4Bias = timeframeBias(h4Bars);
  const h1Bias = timeframeBias(h1Bars);
  const htf = aggregateHtfBias(d1Bias, h4Bias, h1Bias);

  const adr = calculateAdr(d1Bars, 20);
  const news = await evaluateNewsBlackout();

  // Build structure / swings on H1 (the operational timeframe for setups).
  const h1Swings = detectSwings(h1Bars, 2);
  const structure = analyzeStructure(h1Swings);
  const fib = fibonacciFromSwings(h1Swings, currentPrice);
  const liquidity = findLiquidity(h1Bars, d1Bars);
  const harmonic = detectHarmonic(h1Swings);
  const rsi = rsiAnalysis(h1Bars, 14);

  const direction = chooseDirection(htf, harmonic, liquidity?.sweep, structure);
  if (!direction) {
    return {
      symbol,
      no_trade: true,
      reason: 'No clear directional bias',
      confidence: 0,
      currentPrice,
      htf,
      adr,
    };
  }

  const score = scoreSignal({ direction, htf, adr, fib, harmonic, structure, liquidity, rsi });
  const levels = buildTradeLevels({ symbol, direction, currentPrice, fib, harmonic, liquidity, adr, structure, swings: h1Swings });

  if (!levels) {
    return {
      symbol,
      no_trade: true,
      reason: 'Could not build valid risk levels',
      confidence: score.total,
      currentPrice,
      htf,
      adr,
    };
  }

  const session = currentSession();
  const sentiment = htf.trend === 'bullish' ? 'bullish' : htf.trend === 'bearish' ? 'bearish' : 'neutral';
  const riskLevel = score.total >= 80 ? 'low' : score.total >= 65 ? 'medium' : 'high';

  return {
    symbol,
    direction,
    no_trade: score.alertLevel === 'no_trade',
    entry_price: levels.entry,
    stop_loss: levels.stop,
    take_profit: levels.tp2, // primary TP (TP2) for the existing single-tp column
    tp1: levels.tp1,
    tp2: levels.tp2,
    tp3: levels.tp3,
    risk_reward_ratio: levels.risk_reward_ratio,
    confidence: score.total,
    score_breakdown: score.breakdown,
    alert_level: score.alertLevel,
    trend: htf.trend,
    trend_strength: htf.strength,
    sentiment,
    risk_level: riskLevel,
    session,
    reasoning: score.reasons.join('. ') || `${direction.toUpperCase()} ${symbol} at ${levels.entry}.`,
    market_summary: `HTF ${htf.trend} (${htf.strength}%). ADR ${adr ? `${adr.percentUsed.toFixed(0)}% used` : 'n/a'}. ${structure.trend} structure on H1.`,
    support_levels: liquidity?.equalLows?.slice(0, 3) || [],
    resistance_levels: liquidity?.equalHighs?.slice(0, 3) || [],
    key_levels: {
      key_level_1: { price: adr?.adrHigh ?? null, significance: 'strong' },
      key_level_2: { price: adr?.adrLow ?? null, significance: 'strong' },
    },
    timeframes: {
      D1: { trend: d1Bias.trend, signal: d1Bias.signal },
      H4: { trend: h4Bias.trend, signal: h4Bias.signal },
      H1: { trend: h1Bias.trend, signal: h1Bias.signal },
    },
    trade_setup: {
      type: setupType(htf, h1Bias.trend),
      timeframe: 'H1',
      best_entry: fib?.inGoldenZone ? 'on pullback' : harmonic ? 'at PRZ' : 'now',
      explanation: score.reasons.join('. '),
      pattern: harmonic?.name || null,
      tp1: levels.tp1,
      tp2: levels.tp2,
      tp3: levels.tp3,
    },
    risk_factors: [
      adr?.exhausted ? 'ADR > 80% used' : null,
      htf.status === 'mixed' ? 'HTF bias is mixed' : null,
      !rsi || (!rsi.oversold && !rsi.overbought) ? 'No RSI extreme' : null,
      news?.nextEvent && news.nextEvent.minutesAway <= 120
        ? `${news.nextEvent.name} (${news.nextEvent.currency}) in ${news.nextEvent.minutesAway}m`
        : null,
    ].filter(Boolean),
    adr,
    news_status: news ?? null,
  };
}
