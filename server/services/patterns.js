// Fibonacci levels, liquidity sweep detection, and XABCD harmonic pattern matching.
import { detectSwings } from './indicators.js';

const FIB_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.705, 0.786, 0.886];
const FIB_EXTENSIONS = [1.272, 1.618, 2.0, 2.618];

// Fibonacci retracement on the latest qualifying swing (most recent
// pair of opposite-type pivots).
export function fibonacciFromSwings(swings, currentPrice) {
  if (!swings || swings.length < 2) return null;
  const last = swings[swings.length - 1];
  const prev = swings[swings.length - 2];
  if (last.type === prev.type) return null;

  const direction = last.type === 'high' ? 'down' : 'up'; // expected retracement direction
  const swingHigh = last.type === 'high' ? last.price : prev.price;
  const swingLow = last.type === 'low' ? last.price : prev.price;
  const range = swingHigh - swingLow;
  if (range <= 0) return null;

  const retracements = {};
  for (const r of FIB_LEVELS) {
    retracements[r] = direction === 'down' ? swingHigh - range * r : swingLow + range * r;
  }
  const extensions = {};
  for (const e of FIB_EXTENSIONS) {
    extensions[e] = direction === 'down' ? swingLow - range * (e - 1) : swingHigh + range * (e - 1);
  }

  // Determine if current price sits in the "golden zone" (0.5 - 0.786).
  let zone = null;
  const goldenLow = direction === 'down'
    ? Math.min(retracements[0.786], retracements[0.5])
    : Math.min(retracements[0.5], retracements[0.786]);
  const goldenHigh = direction === 'down'
    ? Math.max(retracements[0.786], retracements[0.5])
    : Math.max(retracements[0.5], retracements[0.786]);
  if (currentPrice >= goldenLow && currentPrice <= goldenHigh) {
    zone = 'golden';
  } else if (
    currentPrice >= Math.min(retracements[0.236], retracements[0.382]) &&
    currentPrice <= Math.max(retracements[0.236], retracements[0.382])
  ) {
    zone = 'shallow';
  }

  return {
    direction,
    swingHigh,
    swingLow,
    range,
    retracements,
    extensions,
    inGoldenZone: zone === 'golden',
    zone,
  };
}

// Identify recent liquidity levels (equal highs/lows + previous-day H/L)
// and flag sweeps (wick beyond level then close back inside).
export function findLiquidity(bars, dailyBars) {
  if (!bars || bars.length < 20) return null;
  const last = bars[bars.length - 1];
  const recent = bars.slice(-100);
  const swings = detectSwings(recent, 2);

  // Equal-highs / equal-lows: cluster pivots within tolerance.
  const tolerance = Math.max(last.close * 0.0008, (recent[recent.length - 1].high - recent[recent.length - 1].low) * 0.2);
  const equalHighs = [];
  const equalLows = [];
  const highs = swings.filter((s) => s.type === 'high');
  const lows = swings.filter((s) => s.type === 'low');
  for (let i = 0; i < highs.length; i++) {
    for (let j = i + 1; j < highs.length; j++) {
      if (Math.abs(highs[i].price - highs[j].price) <= tolerance) {
        equalHighs.push((highs[i].price + highs[j].price) / 2);
      }
    }
  }
  for (let i = 0; i < lows.length; i++) {
    for (let j = i + 1; j < lows.length; j++) {
      if (Math.abs(lows[i].price - lows[j].price) <= tolerance) {
        equalLows.push((lows[i].price + lows[j].price) / 2);
      }
    }
  }

  let prevDayHigh = null, prevDayLow = null;
  if (dailyBars && dailyBars.length >= 2) {
    const prev = dailyBars[dailyBars.length - 2];
    prevDayHigh = prev.high;
    prevDayLow = prev.low;
  }

  // Detect a sweep on the most recent bar: wick took out a level, body closed back.
  let sweep = null;
  const liqHighs = [...equalHighs, prevDayHigh].filter((v) => Number.isFinite(v));
  const liqLows = [...equalLows, prevDayLow].filter((v) => Number.isFinite(v));
  for (const lvl of liqHighs) {
    if (last.high > lvl && last.close < lvl) {
      sweep = { side: 'high', level: lvl, kind: 'bearish' };
      break;
    }
  }
  if (!sweep) {
    for (const lvl of liqLows) {
      if (last.low < lvl && last.close > lvl) {
        sweep = { side: 'low', level: lvl, kind: 'bullish' };
        break;
      }
    }
  }

  return {
    equalHighs: [...new Set(equalHighs.map((v) => +v.toFixed(6)))],
    equalLows: [...new Set(equalLows.map((v) => +v.toFixed(6)))],
    previousDayHigh: prevDayHigh,
    previousDayLow: prevDayLow,
    sweep,
  };
}

// Harmonic pattern ratio tables. Each entry defines tolerance ranges
// for AB/XA, BC/AB, CD/BC, and AD/XA (D = potential reversal point).
const HARMONICS = [
  {
    name: 'Gartley',
    ab_xa: [0.55, 0.68],
    bc_ab: [0.382, 0.886],
    cd_bc: [1.13, 1.618],
    ad_xa: [0.74, 0.83],
  },
  {
    name: 'Bat',
    ab_xa: [0.38, 0.52],
    bc_ab: [0.382, 0.886],
    cd_bc: [1.618, 2.618],
    ad_xa: [0.85, 0.92],
  },
  {
    name: 'Butterfly',
    ab_xa: [0.74, 0.83],
    bc_ab: [0.382, 0.886],
    cd_bc: [1.618, 2.618],
    ad_xa: [1.20, 1.65],
  },
  {
    name: 'Crab',
    ab_xa: [0.38, 0.65],
    bc_ab: [0.382, 0.886],
    cd_bc: [2.24, 3.618],
    ad_xa: [1.55, 1.68],
  },
  {
    name: 'Shark',
    ab_xa: [0.5, 0.886],
    bc_ab: [1.13, 1.618],
    cd_bc: [1.27, 2.24],
    ad_xa: [0.88, 1.13],
  },
  {
    name: 'Cypher',
    ab_xa: [0.38, 0.618],
    bc_ab: [1.13, 1.414],
    cd_bc: [1.27, 2.0],
    ad_xa: [0.74, 0.82],
  },
];

// AB=CD: simpler, no X point.
function matchAbcd(b, c, d) {
  const ab = Math.abs(b.price - c.price);
  const bc = Math.abs(c.price - d.price);
  // We need 4 swings A,B,C,D — caller handles structure. Placeholder.
  return null;
}

function within(value, range) {
  return value >= range[0] && value <= range[1];
}

// Scan the most recent 5 swings (X, A, B, C, D) and try every harmonic table.
// `direction` of pattern is determined by X type: X=low → bullish pattern (D is low),
// X=high → bearish (D is high).
export function detectHarmonic(swings) {
  if (!swings || swings.length < 5) return null;
  const last5 = swings.slice(-5);
  const types = last5.map((s) => s.type).join('');
  // Must alternate
  if (types !== 'lowhighlowhighlow' && types !== 'highlowhighlowhigh') return null;
  const [X, A, B, C, D] = last5;
  const xa = Math.abs(A.price - X.price);
  const ab = Math.abs(B.price - A.price);
  const bc = Math.abs(C.price - B.price);
  const cd = Math.abs(D.price - C.price);
  const ad = Math.abs(D.price - A.price);
  if (xa === 0 || ab === 0 || bc === 0) return null;

  const ratios = {
    ab_xa: ab / xa,
    bc_ab: bc / ab,
    cd_bc: cd / bc,
    ad_xa: ad / xa,
  };

  for (const pat of HARMONICS) {
    if (
      within(ratios.ab_xa, pat.ab_xa) &&
      within(ratios.bc_ab, pat.bc_ab) &&
      within(ratios.cd_bc, pat.cd_bc) &&
      within(ratios.ad_xa, pat.ad_xa)
    ) {
      const direction = X.type === 'low' ? 'bullish' : 'bearish';
      return {
        name: pat.name,
        direction,
        prz: D.price, // potential reversal zone price
        points: { X, A, B, C, D },
        ratios,
      };
    }
  }
  return null;
}

// Trading session classification (UTC).
export function currentSession(now = new Date()) {
  const utcHour = now.getUTCHours();
  if (utcHour >= 0 && utcHour < 7) return 'asian';
  if (utcHour >= 7 && utcHour < 13) return 'london';
  if (utcHour >= 13 && utcHour < 22) return 'newyork';
  return 'after-hours';
}
