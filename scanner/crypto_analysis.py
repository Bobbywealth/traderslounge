"""Standalone, defensive OHLCV confluence analysis for crypto markets.

The engine is intentionally deterministic and stdlib-only.  It accepts the
scanner's :class:`MarketSnapshot` and optional benchmark candles, but only
requires candle-like objects with open/high/low/close/volume attributes.
"""
from __future__ import annotations

import math
import time
from datetime import datetime, timezone
from statistics import mean, pstdev

from .indicators import atr, detect_swings, ema, label_swings, rsi
from .modules.fibonacci import latest_leg, retracement_pct
from .modules.harmonic import detect as detect_harmonic
from .reason_codes import ReasonCode, build_blocking_reason

VERSION = "1.0.0"
CAPS = {
    "structure": 20, "liquidity": 15, "volume": 10, "momentum": 10,
    "moving_averages": 10, "fibonacci": 10, "patterns": 10,
    "volatility": 10, "relative_strength": 5,
}


def _generate_triggers(analysis_result) -> list:
    triggers = []
    score = analysis_result.get('total_score', 0)
    coverage = analysis_result.get('data_quality', {}).get('coverage', 1.0)
    pair = analysis_result.get('pair', '')
    adr_percent = analysis_result.get('adr_percent_used', 0)
    entry_zone = analysis_result.get('entry_zone')
    current_price = analysis_result.get('current_price')

    if score < 70:
        triggers.append({
            'type': 'score_crosses_above',
            'symbol': pair,
            'threshold': 70,
            'current_value': score,
            'completed': score >= 70,
            'human_readable': f"Score rises above 70 (currently {score})"
        })

    if coverage < 0.75:
        triggers.append({
            'type': 'coverage_crosses_above',
            'symbol': pair,
            'threshold': 0.75,
            'current_value': coverage,
            'completed': coverage >= 0.75,
            'human_readable': f"Coverage improves above 75% (currently {coverage*100:.0f}%)"
        })

    if adr_percent > 80:
        triggers.append({
            'type': 'adr_resets',
            'symbol': pair,
            'current_value': adr_percent,
            'completed': adr_percent < 50,
            'human_readable': "ADR utilization falls below 50%"
        })

    if entry_zone:
        triggers.append({
            'type': 'price_enters_zone',
            'symbol': pair,
            'price_low': entry_zone['low'],
            'price_high': entry_zone['high'],
            'current_price': current_price,
            'completed': _is_price_in_zone(entry_zone, current_price),
            'human_readable': f"Price enters {entry_zone['low']}-{entry_zone['high']}"
        })

    return triggers


def _is_price_in_zone(zone, current_price):
    if not current_price or not zone:
        return False
    return zone['low'] <= current_price <= zone['high']


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


def _cluster_support_resistance(candles, price, atr_value):
    """Cluster repeated swing reactions into ATR-aware support/resistance zones."""
    if len(candles) < 12 or not price:
        return []
    candidates = []
    for width in (2, 4, 7):
        for swing in detect_swings(candles, width):
            candidates.append((float(swing.price), getattr(swing, "time", None)))
    tolerance = max((atr_value or 0) * .20, price * .0008)
    clusters = []
    for level, swing_time in sorted(candidates):
        cluster = next((item for item in clusters if abs(item["center"] - level) <= tolerance), None)
        if cluster:
            cluster["values"].append(level)
            cluster["center"] = mean(cluster["values"])
            cluster["last_swing_time"] = swing_time or cluster["last_swing_time"]
        else:
            clusters.append({"center": level, "values": [level], "last_swing_time": swing_time})
    recent = candles[-120:]
    output = []
    for cluster in clusters:
        center = cluster["center"]
        zone_type = "support" if center < price else "resistance"
        reactions, last_reaction = [], None
        for index, candle in enumerate(recent[:-1]):
            contacted = candle.low <= center+tolerance*.5 and candle.high >= center-tolerance*.5
            if not contacted or (reactions and index-reactions[-1] < 3):
                continue
            following = recent[index+1]
            rejected = (candle.close > center and following.close >= candle.close) if zone_type == "support" else (candle.close < center and following.close <= candle.close)
            if rejected:
                reactions.append(index); last_reaction = index
        touches = len(reactions)
        recency = 2 if last_reaction is not None and len(recent)-last_reaction <= 15 else 1 if last_reaction is not None and len(recent)-last_reaction <= 40 else 0
        strength_score = _clamp(min(len(cluster["values"]), 3) + min(touches*2, 5) + recency, 1, 10)
        output.append({
            "type": zone_type,
            "level": center, "low": center-tolerance, "high": center+tolerance,
            "touches": touches, "rejections": touches, "recency_score": recency,
            "strength_score": strength_score,
            "strength": "strong" if strength_score >= 7 else "moderate" if strength_score >= 4 else "weak",
            "distance_atr": abs(price-center)/(atr_value or tolerance),
            "last_swing_time": cluster["last_swing_time"],
        })
    return sorted(output, key=lambda zone: (zone["distance_atr"], -zone["strength_score"]))[:10]


def _build_setup_zones(*, price, atr_value, zones, indicators, direction, market_context, trade_timing):
    """Build deterministic, explainable setup areas from all technical zones."""
    if not price:
        return []
    atr_value = float(atr_value or price * 0.01)
    width = max(atr_value * 0.18, price * 0.0004)
    candidates = []

    def add(candidate_direction, low, high, source, detail=None, strength=0):
        try:
            low, high = sorted((float(low), float(high)))
        except (TypeError, ValueError):
            return
        if not math.isfinite(low) or not math.isfinite(high):
            return
        candidates.append({"direction": candidate_direction, "low": low, "high": high, "sources": {source}, "details": [detail] if detail else [], "sr_strength": int(strength or 0)})

    # Detect an active harmonic completion first so we can (a) suppress the
    # misleading "bullish FVG" / "bearish FVG" continuation rationale inside an
    # opposing PRZ and (b) flag those zones as reversal-only reference areas.
    harmonic_meta = zones.get("harmonic") or {}
    harmonic_direction = harmonic_meta.get("direction") if harmonic_meta.get("prz") is not None else None
    harmonic_name = harmonic_meta.get("name") if harmonic_meta.get("prz") is not None else None
    harmonic_prz = harmonic_meta.get("prz")

    def _detail_sign(detail):
        if not isinstance(detail, str):
            return None
        if detail.startswith("bullish ") or detail.startswith("bullish FVG") or detail.startswith("bullish order block"):
            return "bullish"
        if detail.startswith("bearish ") or detail.startswith("bearish FVG") or detail.startswith("bearish order block"):
            return "bearish"
        return None

    for zone in zones.get("support_resistance") or []:
        zone_type = str(zone.get("type") or "")
        if zone_type in ("support", "resistance"):
            add("BUY" if zone_type == "support" else "SELL", zone.get("low"), zone.get("high"), "support_resistance", f"{zone.get('strength', 'zone')} S/R", zone.get("strength_score", 0))
    for gap in zones.get("fair_value_gaps") or []:
        gap_type = gap.get("type")
        gap_detail = "bullish FVG" if gap_type == "bullish" else "bearish FVG"
        gap_dir = "BUY" if gap_type == "bullish" else "SELL"
        # If this FVG sits inside an opposing harmonic PRZ, downgrade it to a
        # reversal-only reference. Don't emit a directional continuation detail
        # that conflicts with the harmonic structure.
        if harmonic_direction and harmonic_prz is not None and gap_type and gap_type != harmonic_direction:
            prz_lo = float(harmonic_prz) - width
            prz_hi = float(harmonic_prz) + width
            if float(gap.get("low")) <= prz_hi and float(gap.get("high")) >= prz_lo:
                add(gap_dir, gap.get("low"), gap.get("high"), "fair_value_gap_reversal",
                    f"reversal-zone at bearish {harmonic_name} PRZ" if harmonic_direction == "bearish" else f"reversal-zone at bullish {harmonic_name} PRZ")
                continue
        add(gap_dir, gap.get("low"), gap.get("high"), "fair_value_gap", gap_detail)
    for block in zones.get("order_blocks") or []:
        block_type = block.get("type")
        block_detail = "bullish order block" if block_type == "bullish" else "bearish order block"
        block_dir = "BUY" if block_type == "bullish" else "SELL"
        if harmonic_direction and harmonic_prz is not None and block_type and block_type != harmonic_direction:
            prz_lo = float(harmonic_prz) - width
            prz_hi = float(harmonic_prz) + width
            if float(block.get("low")) <= prz_hi and float(block.get("high")) >= prz_lo:
                add(block_dir, block.get("low"), block.get("high"), "order_block_reversal",
                    f"reversal-zone at bearish {harmonic_name} PRZ" if harmonic_direction == "bearish" else f"reversal-zone at bullish {harmonic_name} PRZ")
                continue
        add(block_dir, block.get("low"), block.get("high"), "order_block", block_detail)

    fib_data = zones.get("fibonacci") or {}
    fib_direction = direction if direction in ("BUY", "SELL") else None
    for ratio, level in (fib_data.get("levels") or {}).items():
        candidate_direction = fib_direction or ("BUY" if float(level) < price else "SELL")
        add(candidate_direction, float(level) - width, float(level) + width, "fibonacci", f"Fib {ratio}")

    profile = zones.get("volume_profile_summary") or {}
    hvn = profile.get("high_volume_node") or {}
    if hvn.get("low") is not None and hvn.get("high") is not None:
        candidate_direction = fib_direction or ("BUY" if float(hvn.get("high")) < price else "SELL")
        add(candidate_direction, hvn.get("low"), hvn.get("high"), "volume_profile", "high-volume node")
    poc = profile.get("poc")
    if poc is not None:
        candidate_direction = fib_direction or ("BUY" if float(poc) < price else "SELL")
        add(candidate_direction, float(poc) - width, float(poc) + width, "volume_profile", "point of control")

    if harmonic_meta.get("prz") is not None:
        candidate_direction = "BUY" if harmonic_direction == "bullish" else "SELL"
        add(candidate_direction, float(harmonic_meta.get("prz")) - width, float(harmonic_meta.get("prz")) + width, "harmonic", f"{harmonic_name or 'harmonic'} PRZ")

    merged = []
    merge_distance = max(atr_value * 0.35, price * 0.001)
    for candidate in sorted(candidates, key=lambda item: (item["direction"], abs(((item["low"] + item["high"]) / 2) - price))):
        center = (candidate["low"] + candidate["high"]) / 2
        existing = next((item for item in merged if item["direction"] == candidate["direction"] and abs(item["center"] - center) <= merge_distance), None)
        if existing:
            existing["low"] = min(existing["low"], candidate["low"])
            existing["high"] = max(existing["high"], candidate["high"])
            existing["center"] = (existing["low"] + existing["high"]) / 2
            existing["sources"].update(candidate["sources"])
            existing["details"].extend(candidate["details"])
            existing["sr_strength"] = max(existing["sr_strength"], candidate["sr_strength"])
        else:
            merged.append({**candidate, "center": center})

    expected = direction if direction in ("BUY", "SELL") else None
    macro = market_context.get("macro_bias")
    timing_status = str(trade_timing.get("status") or "WAIT").upper()
    technical_checks = trade_timing.get("checks") or {}
    score_60 = bool(technical_checks.get("score_60"))
    setup_zones = []
    for item in merged:
        sources = item["sources"]
        components = {
            "support_resistance": min(20, item["sr_strength"] * 2) if "support_resistance" in sources else 0,
            "fibonacci": 20 if "fibonacci" in sources else 0,
            "harmonic": 15 if "harmonic" in sources else 0,
            "fair_value_gap": 15 if "fair_value_gap" in sources else 0,
            "fair_value_gap_reversal": 0,  # reversal-tagged FVGs do not contribute to score
            "order_block": 10 if "order_block" in sources else 0,
            "order_block_reversal": 0,
            "volume_profile": 10 if "volume_profile" in sources else 0,
            "direction_alignment": 10 if expected == item["direction"] else 5 if expected is None else 0,
            "macro_alignment": 5 if ((item["direction"] == "BUY" and macro == "bullish") or (item["direction"] == "SELL" and macro == "bearish")) else 0,
        }
        score = min(100, sum(components.values()))

        # Filter detail strings whose embedded direction opposes the zone
        # direction. Keeps the displayed rationale directionally coherent.
        raw_details = list(dict.fromkeys(item["details"]))
        zone_dir = item["direction"]
        filtered_details = []
        for detail in raw_details:
            sign = _detail_sign(detail)
            if sign == "bullish" and zone_dir == "SELL":
                continue
            if sign == "bearish" and zone_dir == "BUY":
                continue
            filtered_details.append(detail)
        reasons = filtered_details

        # Flag if this zone's direction opposes the active harmonic PRZ.
        conflicting_with_harmonic = bool(
            harmonic_direction
            and harmonic_prz is not None
            and (
                (zone_dir == "BUY" and harmonic_direction == "bearish")
                or (zone_dir == "SELL" and harmonic_direction == "bullish")
            )
            and abs(item["center"] - float(harmonic_prz)) <= width * 2
        )

        if conflicting_with_harmonic:
            reasons = [f"inside {harmonic_direction} {harmonic_name} PRZ \u2014 reversal context only"]
            if "fair_value_gap_reversal" in sources or "order_block_reversal" in sources:
                pass

        if expected == item["direction"]:
            reasons.append("matches V2 direction")
        elif expected is None:
            reasons.append("V2 direction is neutral; conditional only")
        elif expected != item["direction"]:
            reasons.append("opposes current V2 direction")
        if timing_status != "READY":
            reasons.append(f"timing is {timing_status}")

        # Actionable only when the global plan gates pass AND the local zone
        # is not a reversal-context conflict with the harmonic structure.
        actionable = bool(
            timing_status == "READY"
            and score_60
            and expected == item["direction"]
            and not conflicting_with_harmonic
        )

        setup_zones.append({
            "direction": item["direction"], "low": round(item["low"], 8), "high": round(item["high"], 8), "center": round(item["center"], 8),
            "score": score if actionable else None,
            "tier": "A" if score >= 80 else "B" if score >= 65 else "C" if score >= 50 else "WATCH",
            "actionable": actionable,
            "conflicting_with_harmonic": conflicting_with_harmonic,
            "sources": sorted(sources), "components": components, "reasons": reasons[:6],
            "distance_atr": round(abs(item["center"] - price) / atr_value, 4),
        })
    return sorted(setup_zones, key=lambda item: (-(item["score"] or 0), item["distance_atr"]))[:8]


def _significant_leg(candles, atr_value):
    """Choose the latest swing leg large enough to matter on this timeframe."""
    if len(candles) < 12:
        return latest_leg(candles)
    swings = detect_swings(candles, max(2, min(7, len(candles)//60)))
    minimum = (atr_value or 0) * 2.0
    intervals = [candles[i].time-candles[i-1].time for i in range(1, min(len(candles), 40)) if candles[i].time > candles[i-1].time]
    minimum_duration = (sorted(intervals)[len(intervals)//2] if intervals else 0)*8
    for end_index in range(len(swings)-1, 0, -1):
        end = swings[end_index]
        for start in reversed(swings[:end_index]):
            duration = abs((getattr(end, "time", 0) or 0)-(getattr(start, "time", 0) or 0))
            if start.type != end.type and abs(end.price-start.price) >= minimum and duration >= minimum_duration:
                low, high = sorted((float(start.price), float(end.price)))
                return low, high, "up" if end.price > start.price else "down"
    return latest_leg(candles)


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


def analyze_crypto(snapshot, benchmark_candles=None, primary_candles=None, primary_timeframe=None):
    """Return a capped 100-point crypto analysis dictionary.

    Insufficient or malformed data produces a neutral, explicitly degraded
    response rather than raising.  Benchmark candles may be a candle list or
    a MarketSnapshot (its closest matching populated timeframe is selected).
    """
    frames = {}
    for name in ("d1", "h4", "h1", "m15", "m5", "m1"):
        source = _candles(getattr(snapshot, name, []))
        frames[name] = source[:-1] if len(source) > 8 else source
    frames["w1"] = _aggregate_days(frames["d1"], 7)
    frames["mn1"] = _aggregate_days(frames["d1"], 30)
    selected_source = _candles(primary_candles or [])
    selected = selected_source[:-1] if len(selected_source) > 8 else selected_source
    if selected:
        frames["selected"] = selected
        primary_name = str(primary_timeframe or "selected").lower()
        bars = selected
    else:
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
    for name in ("mn1", "w1", "d1", "h4", "h1", "selected" if selected else primary_name):
        if frames.get(name):
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
    indicators, zones = {"raw_bias": raw_bias, "directional_strength": abs(raw_bias)*100}, {"fair_value_gaps": [], "order_blocks": [], "volume_profile": []}
    if bars:
        # Structure: MTF agreement and latest price position.
        aligned = sum(1 for info in trends.values() if info["trend"] == ("bullish" if sign > 0 else "bearish"))
        scores["structure"] = _clamp(4 + aligned * 4 if sign else 0, 0, CAPS["structure"])
        swings = detect_swings(bars, 2)
        recent_highs = [s.price for s in swings if s.type == "high"][-3:]
        recent_lows = [s.price for s in swings if s.type == "low"][-3:]
        level_atr = atr(bars)
        sr_zones = _cluster_support_resistance(bars, price, level_atr)
        zones["support_resistance"] = sr_zones
        zones["support"] = sorted([z["level"] for z in sr_zones if z["type"] == "support"], reverse=True)[:4]
        zones["resistance"] = sorted([z["level"] for z in sr_zones if z["type"] == "resistance"])[:4]
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

        leg = _significant_leg(bars, level_atr)
        if leg:
            low, high, leg_dir = leg
            retrace = retracement_pct(price, low, high, leg_dir)
            span = high - low
            # Standard Fibonacci retracement ladder. 0.65 was a non-standard
            # pseudo-golden level that conflicted with the canonical Fib 0.618
            # and misled users (e.g. labeling a 0.65 band as a "golden pocket").
            retracement_ratios = (.236, .382, .5, .618, .786)
            extension_ratios = (1.272, 1.618, 2.0, 2.618)
            fibs = {
                f"{ratio:g}": high - span*ratio if leg_dir == "up" else low + span*ratio
                for ratio in retracement_ratios
            }
            fibs.update({
                f"{ratio:g}": low + span*ratio if leg_dir == "up" else high - span*ratio
                for ratio in extension_ratios
            })
            fib_tolerance = max((level_atr or 0)*.25, price*.001)
            confluence = []
            for ratio, fib_level in fibs.items():
                matched = [zone for zone in sr_zones if abs(zone["level"]-fib_level) <= fib_tolerance]
                if matched:
                    confluence.append({"ratio": ratio, "level": fib_level, "sr_level": matched[0]["level"], "sr_strength": matched[0]["strength"], "distance": abs(matched[0]["level"]-fib_level)})
            # Golden pocket is the canonical 0.618–0.786 band.
            golden_low, golden_high = sorted((fibs["0.618"], fibs["0.786"]))
            in_golden_pocket = golden_low <= price <= golden_high
            nearest_ratio, nearest_level = min(fibs.items(), key=lambda item: abs(item[1]-price))
            zones["fibonacci"] = {
                "leg": leg_dir, "swing_low": low, "swing_high": high, "leg_size_atr": span/(level_atr or span),
                "retracement": retrace, "levels": fibs, "golden_pocket": {"low": golden_low, "high": golden_high, "contains_price": in_golden_pocket},
                "nearest": {"ratio": nearest_ratio, "level": nearest_level, "distance_atr": abs(price-nearest_level)/(level_atr or span)},
                "sr_confluence": confluence,
            }
            aligned_leg = sign and ((leg_dir == "up") == (sign > 0))
            scores["fibonacci"] = _clamp((4 if aligned_leg else 0) + (3 if .382 <= retrace <= .786 else 0) + (2 if confluence else 0) + (1 if in_golden_pocket else 0), 0, 10)

        gaps = _fvg(bars)
        zones["fair_value_gaps"] = gaps
        aligned_gap = any(gap["type"] == ("bullish" if sign > 0 else "bearish") for gap in gaps) if sign else False
        if aligned_gap:
            scores["liquidity"] = _clamp(scores["liquidity"] + 3, 0, CAPS["liquidity"])
        confirmed_bars = bars
        candle_patterns = _candle_patterns(confirmed_bars)
        harmonic = detect_harmonic(confirmed_bars)
        if harmonic:
            zones["harmonic"] = {"name": harmonic.get("name"), "direction": harmonic.get("direction"), "prz": harmonic.get("prz")}
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
    quality = {"primary_timeframe": primary_name, "bars": len(bars), "closed_bar_time": getattr(bars[-1], "time", None) if bars else None, "timeframes_available": [x for x, v in frames.items() if v], "issues": issues, "status": "good" if not issues else "limited" if bars else "insufficient"}

    available_categories = []
    missing_categories = []
    stale_categories = []
    now_ts = time.time() if bars else 0
    bars_ts = bars[-1].time if bars else 0
    freshness_threshold = 3600
    if bars:
        for cat in CAPS:
            if scores.get(cat, 0) > 0:
                available_categories.append(cat)
            else:
                if cat == "structure" and not trends:
                    missing_categories.append(cat)
                elif cat == "liquidity" and not sr_zones:
                    missing_categories.append(cat)
                elif cat == "volume" and not any(_num(getattr(c, "volume", 0)) > 0 for c in bars):
                    missing_categories.append(cat)
                elif cat == "momentum" and not rsis:
                    missing_categories.append(cat)
                elif cat == "moving_averages" and not (ema_values.get(20) or sma_values.get(50)):
                    missing_categories.append(cat)
                elif cat == "fibonacci" and not zones.get("fibonacci"):
                    missing_categories.append(cat)
                elif cat == "patterns" and not candle_patterns and not harmonic:
                    missing_categories.append(cat)
                elif cat == "volatility" and not atr_value:
                    missing_categories.append(cat)
                elif cat == "relative_strength" and not benchmark:
                    missing_categories.append(cat)
                else:
                    missing_categories.append(cat)
            if bars_ts and now_ts and (now_ts - bars_ts) > freshness_threshold:
                if cat in available_categories:
                    stale_categories.append(cat)
    else:
        for cat in CAPS:
            missing_categories.append(cat)

    coverage = len(available_categories) / 9
    confidence_tier = "high" if coverage >= 0.9 else "qualified" if coverage >= 0.75 else "developing" if coverage >= 0.5 else "watch"
    data_freshness_seconds = int(now_ts - bars_ts) if bars_ts and bars_ts > 0 else 0
    bias = {name: trends.get(name, {"trend": "neutral", "labels": []}) for name in ("mn1", "w1", "d1", "h4", "h1")}
    bias["selected"] = trends.get("selected" if selected else primary_name, {"trend": "neutral", "labels": []})
    weights = {"mn1": 3, "w1": 2, "d1": 1, "h4": 1}
    macro_value = sum((1 if bias[name]["trend"] == "bullish" else -1 if bias[name]["trend"] == "bearish" else 0)*weight for name, weight in weights.items())
    macro_bias = "bullish" if macro_value > 1 else "bearish" if macro_value < -1 else "neutral"
    expected_trend = "bullish" if sign > 0 else "bearish" if sign < 0 else "neutral"
    opposing_frames = [name for name in ("mn1", "w1", "d1", "h4") if bias[name]["trend"] not in ("neutral", expected_trend)]
    aligned_frames = [name for name in ("mn1", "w1", "d1", "h4") if bias[name]["trend"] == expected_trend]
    market_context = {"macro_bias": macro_bias, "timeframes": bias, "aligned_frames": aligned_frames, "opposing_frames": opposing_frames, "alignment_score": round(len(aligned_frames)/4*100)}

    atr_now = indicators.get("atr") or (price*.01 if price else 1)
    sr_for_direction = next((zone for zone in zones.get("support_resistance", []) if zone["type"] == ("support" if sign > 0 else "resistance") and zone["distance_atr"] <= .6 and zone["strength_score"] >= 4), None) if sign else None
    fib_data = zones.get("fibonacci") or {}
    fib_near = bool((fib_data.get("nearest") or {}).get("distance_atr", 99) <= .35 or (fib_data.get("golden_pocket") or {}).get("contains_price"))
    fib_confluence = bool(fib_data.get("sr_confluence"))
    zone_tolerance = atr_now*.35
    block_near = any(block.get("low", 0)-zone_tolerance <= price <= block.get("high", 0)+zone_tolerance for block in zones.get("order_blocks", [])) if price else False
    gap_near = any(gap.get("low", 0)-zone_tolerance <= price <= gap.get("high", 0)+zone_tolerance for gap in zones.get("fair_value_gaps", [])) if price else False
    location_signals = [name for name, passed in {"strong_sr": bool(sr_for_direction), "fibonacci": fib_near, "fib_sr_confluence": fib_confluence, "order_block": block_near, "fair_value_gap": gap_near}.items() if passed]

    completed = bars[-1] if bars else None
    prior = bars[-2] if len(bars) >= 2 else None
    completed_patterns = indicators.get("patterns") or []
    pattern_confirmation = any((name in ("bullish_engulfing", "morning_star", "hammer", "bullish_marubozu")) if sign > 0 else (name in ("bearish_engulfing", "evening_star", "shooting_star", "bearish_marubozu")) for name in completed_patterns)
    rejection_confirmation = False
    if completed and sr_for_direction:
        body_top, body_bottom = max(completed.open, completed.close), min(completed.open, completed.close)
        rejection_confirmation = (completed.low <= sr_for_direction["high"] and completed.close > body_bottom and completed.close > sr_for_direction["level"]) if sign > 0 else (completed.high >= sr_for_direction["low"] and completed.close < body_top and completed.close < sr_for_direction["level"])
    reclaim_confirmation = bool(prior and completed and indicators.get("vwap") and ((prior.close <= indicators["vwap"] < completed.close) if sign > 0 else (prior.close >= indicators["vwap"] > completed.close)))
    break_retest = bool(completed and sr_for_direction and ((completed.low <= sr_for_direction["high"] and completed.close > sr_for_direction["high"]) if sign > 0 else (completed.high >= sr_for_direction["low"] and completed.close < sr_for_direction["low"])))
    confirmation_signals = [name for name, passed in {"closed_candle_pattern": pattern_confirmation, "level_rejection": rejection_confirmation, "vwap_reclaim": reclaim_confirmation, "break_retest": break_retest, "liquidity_sweep": scores.get("liquidity", 0) >= 10}.items() if passed]

    monthly_trend, weekly_trend = bias["mn1"]["trend"], bias["w1"]["trend"]
    macro_aligned = weekly_trend == expected_trend or (weekly_trend == "neutral" and monthly_trend == expected_trend)
    macro_conflict = monthly_trend not in ("neutral", expected_trend) and weekly_trend == expected_trend
    selected_aligned = bias["selected"]["trend"] == expected_trend
    relative_volume = indicators.get("relative_volume")
    low_volume = relative_volume is not None and relative_volume < .7
    last_range = (completed.high-completed.low) if completed else 0
    unstable_volatility = bool(atr_now and last_range > atr_now*2.5)
    ema20_distance = abs(price-(indicators.get("ema_20") or price))/(atr_now or 1) if price else 99
    chasing = ema20_distance > 1.25
    daily = frames.get("d1") or []
    adr_exhausted = False
    if len(daily) >= 15:
        average_daily_range = mean(c.high-c.low for c in daily[-15:-1])
        adr_exhausted = bool(average_daily_range and (daily[-1].high-daily[-1].low)/average_daily_range >= .9)
    timestamp = int(getattr(completed, "time", 0) or 0) if completed else 0
    moment = datetime.fromtimestamp(timestamp, timezone.utc) if timestamp else None
    preferred_session = bool(moment and moment.weekday() < 5 and 7 <= moment.hour < 17)

    technical_checks = {
        "score_60": total >= 60, "weekly_or_monthly_alignment": macro_aligned, "selected_timeframe_confirmation": selected_aligned,
        "quality_location": bool(location_signals), "completed_candle_confirmation": bool(confirmation_signals),
        "sufficient_volume": not low_volume, "stable_volatility": not unstable_volatility,
        "adr_available": not adr_exhausted, "not_chasing": not chasing, "data_quality": quality["status"] == "good",
    }
    technical_ready = all(technical_checks.values())

    _LABEL_TO_REASON = {
        "higher_timeframe_conflict": ReasonCode.DIRECTION_CONFLICT,
        "unstable_volatility": ReasonCode.VOLATILITY_TOO_HIGH,
        "adr_exhausted": ReasonCode.ADR_EXHAUSTED,
        "score_60": ReasonCode.SCORE_BELOW_THRESHOLD,
        "weekly_or_monthly_alignment": ReasonCode.DIRECTION_CONFLICT,
        "selected_timeframe_confirmation": ReasonCode.STRUCTURE_NOT_CONFIRMED,
        "quality_location": ReasonCode.LIQUIDITY_NOT_CONFIRMED,
        "completed_candle_confirmation": ReasonCode.STRUCTURE_NOT_CONFIRMED,
        "sufficient_volume": ReasonCode.INSUFFICIENT_VOLUME_DATA,
        "stable_volatility": ReasonCode.VOLATILITY_TOO_HIGH,
        "adr_available": ReasonCode.ADR_EXHAUSTED,
        "not_chasing": ReasonCode.ENTRY_TOO_EXTENDED,
        "data_quality": ReasonCode.DATA_QUALITY_POOR,
    }

    avoid_reasons = [label for label, triggered in {"higher_timeframe_conflict": bool(sign and not macro_aligned), "unstable_volatility": unstable_volatility, "adr_exhausted": adr_exhausted}.items() if triggered]
    avoid = bool(avoid_reasons)

    blocking_reasons = []
    for label in avoid_reasons:
        reason_code = _LABEL_TO_REASON.get(label, ReasonCode.TRADE_TIMING_AVOID)
        blocking_reasons.append(build_blocking_reason(reason_code, data={"source": label}))

    wait_for_labels = [label for label, passed in technical_checks.items() if not passed]
    for label in wait_for_labels:
        reason_code = _LABEL_TO_REASON.get(label, ReasonCode.GATHERING_EVIDENCE)
        blocking_reasons.append(build_blocking_reason(reason_code, data={"source": label, "waiting": True}))

    trade_timing = {
        "status": "AVOID" if avoid else "READY" if technical_ready else "WAIT", "checks": technical_checks,
        "location_ready": bool(location_signals), "location_signals": location_signals, "confirmation_signals": confirmation_signals,
        "nearest_sr": sr_for_direction, "nearest_fibonacci": fib_data.get("nearest"),
        "session": {"name": "London/New York liquidity" if preferred_session else "off-peak or weekend", "preferred": preferred_session, "utc_hour": moment.hour if moment else None},
        "regime": {"low_volume": low_volume, "unstable_volatility": unstable_volatility, "adr_exhausted": adr_exhausted, "ema20_distance_atr": ema20_distance, "chasing": chasing, "monthly_weekly_conflict": macro_conflict},
        "avoid_reasons": avoid_reasons,
        "wait_for": wait_for_labels,
        "blocking_reasons": blocking_reasons,
    }
    scenario = "bullish continuation" if direction == "BUY" else "bearish continuation" if direction == "SELL" else "wait for directional confirmation"
    stop = None
    if bars and price:
        a = indicators.get("atr") or (price*.02)
        stop = price-sign*2*a if sign else None
    zones["setup_zones"] = _build_setup_zones(price=price, atr_value=indicators.get("atr"), zones=zones, indicators=indicators, direction=direction, market_context=market_context, trade_timing=trade_timing)
    analysis_result = {"version": VERSION, "asset_class": "crypto", "pair": getattr(snapshot, "pair", None), "direction": direction,
            "total_score": int(_clamp(total, 0, 100)), "category_breakdown": scores, "data_quality": quality,
            "indicators": indicators, "zones": zones, "market_context": market_context, "trade_timing": trade_timing,
            "scenarios": {"primary": scenario, "invalidation": "close beyond ATR stop or opposing structure break", "confidence": "high" if total >= 70 else "moderate" if total >= 45 else "low"},
            "risk": {"atr_stop": stop, "atr_multiple": 2, "warning": "Crypto can gap and liquidity can thin; use position sizing and hard stops."},
            "monitoring": ["primary timeframe close", "volume relative to 20-bar average", "VWAP reclaim/loss", "structure break", "ATR volatility regime"],
            "confluence_score": int(_clamp(total, 0, 100)),
            "coverage": coverage,
            "confidence_tier": confidence_tier,
            "categories_available": len(available_categories),
            "categories_total": 9,
            "missing_categories": missing_categories,
            "stale_categories": stale_categories,
            "data_freshness_seconds": data_freshness_seconds}
    analysis_result["triggers"] = _generate_triggers(analysis_result)
    return analysis_result


# Short conventional alias for integrations that expect an analysis callable.
analyze = analyze_crypto
