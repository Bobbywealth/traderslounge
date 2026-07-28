"""Standalone, defensive OHLCV confluence analysis for crypto markets.

The engine is intentionally deterministic and stdlib-only.  It accepts the
scanner's :class:`MarketSnapshot` and optional benchmark candles, but only
requires candle-like objects with open/high/low/close/volume attributes.
"""
from __future__ import annotations

import math
from statistics import mean, pstdev

from .indicators import atr, detect_swings, ema, label_swings, rsi
from .modules.fibonacci import latest_leg, retracement_pct
from .modules.harmonic import detect as detect_harmonic

VERSION = "1.0.0"
CAPS = {
    "structure": 20, "liquidity": 15, "volume": 10, "momentum": 10,
    "moving_averages": 10, "fibonacci": 10, "patterns": 10,
    "volatility": 10, "relative_strength": 5,
}


def _clamp(value, low, high):
    return max(low, min(high, value))


def _num(value, default=0.0):
    try:
        value = float(value)
        return value if math.isfinite(value) else default
    except (TypeError, ValueError):
        return default


def _candles(values):
    """Discard malformed bars and return bars in supplied chronological order."""
    valid = []
    for c in values or []:
        o, h, l, close = (_num(getattr(c, k, None), float("nan"))
                           for k in ("open", "high", "low", "close"))
        if all(math.isfinite(x) for x in (o, h, l, close)) and h >= l and h > 0:
            valid.append(c)
    return valid


def _aggregate_days(candles, size):
    """Aggregate daily candles into deterministic weekly/monthly bars."""
    out = []
    for start in range(0, len(candles), size):
        chunk = candles[start:start + size]
        if len(chunk) < max(2, size // 3):
            continue
        first, last = chunk[0], chunk[-1]
        out.append(type(first)(
            time=last.time, open=first.open, high=max(c.high for c in chunk),
            low=min(c.low for c in chunk), close=last.close,
            volume=sum(_num(getattr(c, "volume", 0)) for c in chunk),
        ))
    return out


def _sma(values, period):
    if len(values) < period or period <= 0:
        return None
    return sum(values[-period:]) / float(period)


def _pct(a, b):
    return 0.0 if not b else (a - b) / abs(b)


def _trend(candles):
    if len(candles) < 8:
        return "neutral", 0.0, []
    swings = label_swings(detect_swings(candles, 2))
    labels = [s.label for s in swings if s.label]
    recent = labels[-4:]
    bull = sum(x in ("HH", "HL") for x in recent)
    bear = sum(x in ("LH", "LL") for x in recent)
    closes = [_num(c.close) for c in candles]
    slope = _pct(closes[-1], closes[max(0, len(closes) - 8)])
    if bull >= 2 and bull > bear or slope > 0.012:
        return "bullish", 1.0, recent
    if bear >= 2 and bear > bull or slope < -0.012:
        return "bearish", -1.0, recent
    return "neutral", 0.0, recent


def _adx(candles, period=14):
    if len(candles) < period * 2 + 1:
        return None
    plus, minus, tr = [], [], []
    for prev, cur in zip(candles[:-1], candles[1:]):
        up, down = cur.high - prev.high, prev.low - cur.low
        plus.append(max(up, 0.0) if up > down else 0.0)
        minus.append(max(down, 0.0) if down > up else 0.0)
        tr.append(max(cur.high-cur.low, abs(cur.high-prev.close), abs(cur.low-prev.close)))
    dx = []
    for i in range(period, len(tr) + 1):
        t = sum(tr[i-period:i])
        if not t:
            continue
        p, m = 100 * sum(plus[i-period:i]) / t, 100 * sum(minus[i-period:i]) / t
        dx.append(0.0 if p + m == 0 else 100 * abs(p-m) / (p+m))
    return sum(dx[-period:]) / len(dx[-period:]) if dx else None


def _stoch_rsi(rsi_values, period=14):
    clean = [x for x in rsi_values if math.isfinite(x)]
    if len(clean) < period:
        return None
    lo, hi = min(clean[-period:]), max(clean[-period:])
    return 50.0 if hi == lo else 100 * (clean[-1] - lo) / (hi - lo)


def _cci(candles, period=20):
    if len(candles) < period:
        return None
    typical = [(c.high+c.low+c.close)/3.0 for c in candles[-period:]]
    avg = mean(typical)
    deviation = mean([abs(x-avg) for x in typical])
    return 0.0 if not deviation else (typical[-1]-avg) / (.015*deviation)


def _correlation(a, b):
    n = min(len(a), len(b))
    if n < 5:
        return None
    a, b = a[-n:], b[-n:]
    ma, mb = mean(a), mean(b)
    numerator = sum((x-ma)*(y-mb) for x, y in zip(a, b))
    denom = math.sqrt(sum((x-ma)**2 for x in a) * sum((y-mb)**2 for y in b))
    return None if not denom else numerator / denom


def _fvg(candles):
    found = []
    recent = candles[-30:]
    for index in range(2, len(recent)):
        a, c = recent[index - 2], recent[index]
        if c.low > a.high:
            found.append({"type": "bullish", "low": a.high, "high": c.low, "time": c.time})
        elif c.high < a.low:
            found.append({"type": "bearish", "low": c.high, "high": a.low, "time": c.time})
    return found[-3:]


def _candle_patterns(candles):
    if len(candles) < 2:
        return []
    p, c = candles[-2], candles[-1]
    body = abs(c.close-c.open)
    prior_body = abs(p.close-p.open)
    span = max(c.high-c.low, 1e-12)
    patterns = []
    if c.close > c.open and p.close < p.open and c.open <= p.close and c.close >= p.open:
        patterns.append("bullish_engulfing")
    if c.close < c.open and p.close > p.open and c.open >= p.close and c.close <= p.open:
        patterns.append("bearish_engulfing")
    if max(c.open, c.close) <= max(p.open, p.close) and min(c.open, c.close) >= min(p.open, p.close):
        patterns.append("bullish_harami" if c.close > c.open else "bearish_harami")
    if body / span < .1:
        patterns.append("doji")
    if body / span > .8:
        patterns.append("bullish_marubozu" if c.close > c.open else "bearish_marubozu")
    if c.close > c.open and (min(c.open, c.close)-c.low) > body*2:
        patterns.append("hammer")
    if c.close < c.open and (c.high-max(c.open, c.close)) > body*2:
        patterns.append("shooting_star")
    if len(candles) >= 3:
        a, b = candles[-3], candles[-2]
        small_middle = abs(b.close-b.open) < max(abs(a.close-a.open), 1e-12)*.45
        if a.close < a.open and small_middle and c.close > c.open and c.close > (a.open+a.close)/2:
            patterns.append("morning_star")
        if a.close > a.open and small_middle and c.close < c.open and c.close < (a.open+a.close)/2:
            patterns.append("evening_star")
    return patterns


def analyze_crypto(snapshot, benchmark_candles=None):
    """Return a capped 100-point crypto analysis dictionary.

    Insufficient or malformed data produces a neutral, explicitly degraded
    response rather than raising.  Benchmark candles may be a candle list or
    a MarketSnapshot (its closest matching populated timeframe is selected).
    """
    frames = {name: _candles(getattr(snapshot, name, []))
              for name in ("d1", "h4", "h1", "m15", "m5", "m1")}
    frames["w1"] = _aggregate_days(frames["d1"], 7)
    frames["mn1"] = _aggregate_days(frames["d1"], 30)
    primary_name = next((x for x in ("m15", "m5", "h1", "m1", "h4", "d1") if frames[x]), "m15")
    bars = frames[primary_name]
    closes = [_num(c.close) for c in bars]
    price = closes[-1] if closes else None
    issues = []
    if not bars:
        issues.append("no usable OHLC candles")
    elif len(bars) < 30:
        issues.append("fewer than 30 primary timeframe candles")
    if not any(_num(getattr(c, "volume", 0)) > 0 for c in bars):
        issues.append("volume unavailable or zero")

    # Direction is determined from independent broad signals before scoring.
    trends, votes = {}, []
    for name in ("mn1", "w1", "d1", "h4", "h1", primary_name):
        if frames[name]:
            trend, sign, labels = _trend(frames[name])
            trends[name] = {"trend": trend, "labels": labels}
            votes.append(sign)
    fast, slow = (ema(closes, 20), ema(closes, 50)) if closes else ([], [])
    if fast and slow:
        votes.append(1.0 if fast[-1] > slow[-1] else -1.0)
    raw_bias = sum(votes) / len(votes) if votes else 0.0
    direction = "BUY" if raw_bias > .15 else "SELL" if raw_bias < -.15 else "NEUTRAL"
    sign = 1 if direction == "BUY" else -1 if direction == "SELL" else 0

    scores = dict((key, 0) for key in CAPS)
    indicators, zones = {}, {"fair_value_gaps": [], "order_blocks": [], "volume_profile": []}
    if bars:
        # Structure: MTF agreement and latest price position.
        aligned = sum(1 for info in trends.values() if info["trend"] == ("bullish" if sign > 0 else "bearish"))
        scores["structure"] = _clamp(4 + aligned * 4 if sign else 0, 0, CAPS["structure"])
        swings = detect_swings(bars, 2)
        recent_highs = [s.price for s in swings if s.type == "high"][-3:]
        recent_lows = [s.price for s in swings if s.type == "low"][-3:]
        zones["support"] = recent_lows
        zones["resistance"] = recent_highs
        tolerance = price * .0015 if price else 0
        zones["liquidity_pools"] = {
            "equal_highs": [level for i, level in enumerate(recent_highs) if any(abs(level-other) <= tolerance for other in recent_highs[i+1:])],
            "equal_lows": [level for i, level in enumerate(recent_lows) if any(abs(level-other) <= tolerance for other in recent_lows[i+1:])],
        }

        # Liquidity: sweeps plus simple last-opposite-candle order block.
        look = bars[-10:]
        ref_low = max(recent_lows) if recent_lows else min(c.low for c in look)
        ref_high = min(recent_highs) if recent_highs else max(c.high for c in look)
        bull_sweep = any(c.low < ref_low and c.close > ref_low for c in look)
        bear_sweep = any(c.high > ref_high and c.close < ref_high for c in look)
        scores["liquidity"] = 12 if (sign > 0 and bull_sweep) or (sign < 0 and bear_sweep) else 4 if sign else 0
        opposite = next((c for c in reversed(bars[-12:-1]) if (c.close-c.open)*sign < 0), None)
        if opposite and sign:
            zones["order_blocks"].append({"type": "bullish" if sign > 0 else "bearish", "low": opposite.low, "high": opposite.high})

        volumes = [_num(getattr(c, "volume", 0)) for c in bars]
        avg_vol = _sma(volumes, 20)
        rel_vol = volumes[-1] / avg_vol if avg_vol else None
        typical = [(c.high+c.low+c.close)/3.0 for c in bars]
        total_vol = sum(volumes)
        vwap = sum(p*v for p, v in zip(typical, volumes))/total_vol if total_vol else None
        obv = 0.0
        for prev, cur, vol in zip(closes[:-1], closes[1:], volumes[1:]):
            obv += vol if cur > prev else -vol if cur < prev else 0
        indicators.update({"relative_volume": rel_vol, "vwap": vwap, "obv": obv})
        vol_ok = rel_vol is not None and rel_vol >= 1.1
        vwap_ok = vwap is not None and (price-vwap)*sign > 0
        scores["volume"] = _clamp((4 if vol_ok else 1) + (4 if vwap_ok else 0) + (2 if obv*sign > 0 else 0), 0, 10) if sign else 0
        # Approximate volume profile by five equal price bins.
        lo, hi = min(c.low for c in bars[-50:]), max(c.high for c in bars[-50:])
        if hi > lo and total_vol:
            step, bins = (hi-lo)/5.0, [0.0]*5
            for c, v in zip(bars[-50:], volumes[-50:]): bins[_clamp(int(((c.high+c.low+c.close)/3.0-lo)/step), 0, 4)] += v
            profile = [{"low": lo+i*step, "high": lo+(i+1)*step, "volume": bins[i]} for i in range(5)]
            zones["volume_profile"] = profile
            poc_index = bins.index(max(bins))
            lvn_index = bins.index(min(bins))
            zones["volume_profile_summary"] = {
                "poc": (profile[poc_index]["low"] + profile[poc_index]["high"]) / 2,
                "high_volume_node": profile[poc_index],
                "low_volume_node": profile[lvn_index],
                "approximate": True,
            }

        rsis = rsi(closes)
        macd_line = [a-b for a, b in zip(ema(closes, 12), ema(closes, 26))]
        macd_signal = ema(macd_line, 9)
        adx, stoch, cci = _adx(bars), _stoch_rsi(rsis), _cci(bars)
        rsi_value = rsis[-1] if rsis and math.isfinite(rsis[-1]) else None
        macd_ok = bool(macd_line and macd_signal and (macd_line[-1]-macd_signal[-1])*sign > 0)
        rsi_ok = rsi_value is not None and ((rsi_value > 50) if sign > 0 else (rsi_value < 50))
        osc_ok = (stoch is not None and (stoch-50)*sign > 0) or (cci is not None and cci*sign > 0)
        tenkan = (max(c.high for c in bars[-9:]) + min(c.low for c in bars[-9:])) / 2 if len(bars) >= 9 else None
        kijun = (max(c.high for c in bars[-26:]) + min(c.low for c in bars[-26:])) / 2 if len(bars) >= 26 else None
        span_a = (tenkan + kijun) / 2 if tenkan is not None and kijun is not None else None
        span_b = (max(c.high for c in bars[-52:]) + min(c.low for c in bars[-52:])) / 2 if len(bars) >= 52 else None
        cloud_aligned = span_a is not None and span_b is not None and (price-max(span_a, span_b) if sign > 0 else min(span_a, span_b)-price) > 0
        trend_atr = atr(bars)
        supertrend_mid = ((bars[-1].high + bars[-1].low) / 2 - 3*trend_atr) if sign > 0 and trend_atr else ((bars[-1].high + bars[-1].low) / 2 + 3*trend_atr) if trend_atr else None
        supertrend_aligned = supertrend_mid is not None and (price-supertrend_mid)*sign > 0
        indicators.update({"rsi": rsi_value, "macd": macd_line[-1] if macd_line else None, "macd_signal": macd_signal[-1] if macd_signal else None, "adx": adx, "stoch_rsi": stoch, "cci": cci, "ichimoku": {"tenkan": tenkan, "kijun": kijun, "span_a": span_a, "span_b": span_b, "aligned": cloud_aligned}, "supertrend": {"level": supertrend_mid, "aligned": supertrend_aligned}})
        scores["momentum"] = _clamp(2*sum((macd_ok, rsi_ok, osc_ok, cloud_aligned)) + (1 if adx and adx >= 20 else 0) + (1 if supertrend_aligned else 0), 0, 10) if sign else 0

        ema_periods = (9, 20, 50, 100, 200)
        sma_periods = (50, 100, 200)
        ema_values = {period: (ema(closes, period)[-1] if len(closes) >= period else None) for period in ema_periods}
        sma_values = {period: _sma(closes, period) for period in sma_periods}
        available_emas = [ema_values[p] for p in ema_periods if ema_values[p] is not None]
        available_smas = [sma_values[p] for p in sma_periods if sma_values[p] is not None]
        ema_stack = len(available_emas) >= 3 and all((a-b)*sign > 0 for a, b in zip(available_emas, available_emas[1:]))
        sma_stack = len(available_smas) >= 2 and all((a-b)*sign > 0 for a, b in zip(available_smas, available_smas[1:]))
        dynamic_support = ema_values[20] is not None and (price-ema_values[20])*sign > 0
        golden_cross = sma_values[50] is not None and sma_values[200] is not None and sma_values[50] > sma_values[200]
        death_cross = sma_values[50] is not None and sma_values[200] is not None and sma_values[50] < sma_values[200]
        indicators.update({**{f"ema_{p}": ema_values[p] for p in ema_periods}, **{f"sma_{p}": sma_values[p] for p in sma_periods}, "ema_stack_aligned": ema_stack, "sma_stack_aligned": sma_stack, "golden_cross": golden_cross, "death_cross": death_cross})
        scores["moving_averages"] = _clamp((4 if ema_stack else 1) + (3 if sma_stack else 0) + (2 if dynamic_support else 0) + (1 if (golden_cross and sign > 0) or (death_cross and sign < 0) else 0), 0, 10) if sign else 0

        leg = latest_leg(bars)
        if leg:
            low, high, leg_dir = leg
            retrace = retracement_pct(price, low, high, leg_dir)
            fibs = {"0.382": high-(high-low)*.382 if leg_dir == "up" else low+(high-low)*.382,
                    "0.618": high-(high-low)*.618 if leg_dir == "up" else low+(high-low)*.618,
                    "0.786": high-(high-low)*.786 if leg_dir == "up" else low+(high-low)*.786}
            zones["fibonacci"] = {"leg": leg_dir, "retracement": retrace, "levels": fibs}
            fib_ok = .382 <= retrace <= .786 and ((leg_dir == "up") == (sign > 0))
            scores["fibonacci"] = 10 if fib_ok else 3 if sign and ((leg_dir == "up") == (sign > 0)) else 0

        gaps = _fvg(bars)
        zones["fair_value_gaps"] = gaps
        aligned_gap = any(gap["type"] == ("bullish" if sign > 0 else "bearish") for gap in gaps) if sign else False
        if aligned_gap:
            scores["liquidity"] = _clamp(scores["liquidity"] + 3, 0, CAPS["liquidity"])
        candle_patterns = _candle_patterns(bars)
        harmonic = detect_harmonic(bars)
        pattern_ok = any(("bullish" in p or p == "hammer") if sign > 0 else ("bearish" in p or p == "shooting_star") for p in candle_patterns)
        harmonic_ok = harmonic and harmonic["direction"] == ("bullish" if sign > 0 else "bearish")
        scores["patterns"] = _clamp((5 if pattern_ok else 0)+(5 if harmonic_ok else 0), 0, 10) if sign else 0
        indicators["patterns"] = candle_patterns
        indicators["harmonic"] = harmonic["name"] if harmonic else None

        atr_value = atr(bars)
        bb = _sma(closes, 20)
        std = pstdev(closes[-20:]) if len(closes) >= 20 else None
        bb_width = (4*std/bb) if std is not None and bb else None
        ema20 = fast[-1] if fast else None
        ranges = [c.high-c.low for c in bars[-20:]]
        k_width = (4*atr_value/ema20) if atr_value and ema20 else None
        compressed = bb_width is not None and k_width is not None and bb_width < k_width
        indicators.update({"atr": atr_value, "bollinger_width": bb_width, "keltner_width": k_width, "compression": compressed})
        scores["volatility"] = (7 if compressed else 3) + (3 if atr_value and atr_value/price < .08 else 0) if sign else 0

    # Benchmark is evaluated separately to avoid contamination of price signals.
    benchmark = []
    if benchmark_candles is not None and hasattr(benchmark_candles, "d1"):
        for name in (primary_name, "h1", "h4", "d1", "m15"):
            candidate = _candles(getattr(benchmark_candles, name, []))
            if candidate:
                benchmark = candidate
                break
    elif benchmark_candles is not None:
        benchmark = _candles(benchmark_candles)
    if bars and benchmark:
        a = [_pct(b.close, a.close) for a, b in zip(bars[-31:-1], bars[-30:]) if a.close]
        b = [_pct(b.close, a.close) for a, b in zip(benchmark[-31:-1], benchmark[-30:]) if a.close]
        corr = _correlation(a, b)
        asset_return = _pct(price, bars[-min(21, len(bars))].close)
        benchmark_return = _pct(benchmark[-1].close, benchmark[-min(21, len(benchmark))].close)
        relative_return = asset_return-benchmark_return
        indicators.update({"benchmark_correlation": corr, "relative_return": relative_return})
        scores["relative_strength"] = 5 if relative_return*sign > 0 else 1 if sign else 0
    else:
        indicators.update({"benchmark_correlation": None, "relative_return": None})

    scores = {key: int(_clamp(_num(value), 0, CAPS[key])) for key, value in scores.items()}
    total = sum(scores.values())
    quality = {"primary_timeframe": primary_name, "bars": len(bars), "timeframes_available": [x for x, v in frames.items() if v], "issues": issues, "status": "good" if not issues else "limited" if bars else "insufficient"}
    scenario = "bullish continuation" if direction == "BUY" else "bearish continuation" if direction == "SELL" else "wait for directional confirmation"
    stop = None
    if bars and price:
        a = indicators.get("atr") or (price*.02)
        stop = price-sign*2*a if sign else None
    return {"version": VERSION, "asset_class": "crypto", "pair": getattr(snapshot, "pair", None), "direction": direction,
            "total_score": int(_clamp(total, 0, 100)), "category_breakdown": scores, "data_quality": quality,
            "indicators": indicators, "zones": zones,
            "scenarios": {"primary": scenario, "invalidation": "close beyond ATR stop or opposing structure break", "confidence": "high" if total >= 70 else "moderate" if total >= 45 else "low"},
            "risk": {"atr_stop": stop, "atr_multiple": 2, "warning": "Crypto can gap and liquidity can thin; use position sizing and hard stops."},
            "monitoring": ["primary timeframe close", "volume relative to 20-bar average", "VWAP reclaim/loss", "structure break", "ATR volatility regime"]}


# Short conventional alias for integrations that expect an analysis callable.
analyze = analyze_crypto
