"""Swing-based classical chart pattern recognition.

Companion to modules/harmonic.py. Where that module matches XABCD Fibonacci
ratio templates, this one recognises the classical formations traders read off
structure: double and triple tops/bottoms, head and shoulders, triangles and
flags.

Like the harmonic module, every result is an explicitly unvalidated candidate
carrying its own management levels. Nothing here feeds the BWTS score or any
trade gate — these enrich the explanation only.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from ..data_types import Candle, Swing
from ..indicators import detect_swings

# Two pivots count as "equal" when they sit within this fraction of the
# pattern's own height. Loose enough for live noise, tight enough that a
# clearly ascending pair is not called a double top.
_LEVEL_TOLERANCE = 0.06
_MIN_PIVOT_SPACING = 2


def _pivot(swing: Swing) -> Dict[str, Any]:
    return {"index": swing.index, "time": swing.time, "price": swing.price,
            "type": swing.type, "label": swing.label}


def _similar(a: float, b: float, scale: float) -> bool:
    if scale <= 0:
        return False
    return abs(a - b) / scale <= _LEVEL_TOLERANCE


def _levels(entry: float, stop: float, target: float, direction: str) -> Dict[str, Any]:
    risk = abs(entry - stop)
    reward = abs(target - entry)
    sign = 1.0 if direction == "bullish" else -1.0
    # A measured-move target is the full height; the first target takes the
    # conventional half of it.
    target_1 = entry + sign * reward * 0.5
    return {
        "entry": entry,
        "stop_loss": stop,
        "target_1": target_1,
        "target_2": target,
        "risk_per_unit": risk if risk > 0 else None,
        "reward_risk": round(reward / risk, 2) if risk > 0 else None,
        "target_1_r": round((reward * 0.5) / risk, 2) if risk > 0 else None,
        "target_2_r": round(reward / risk, 2) if risk > 0 else None,
        "basis": "entry=neckline/breakout, stop=beyond pattern extreme, target=measured move",
        "calibrated": False,
    }


def _result(name: str, direction: str, points: List[Swing], neckline: float,
            entry: float, stop: float, target: float, note: str) -> Dict[str, Any]:
    spacings = [points[i].index - points[i - 1].index for i in range(1, len(points))]
    min_spacing = min(spacings) if spacings else 0
    return {
        "name": name,
        "family": "classical",
        "direction": direction,
        "status": "candidate",
        "candidate_status": "candidate_unvalidated",
        "validated": False,
        "neckline": neckline,
        "points": {chr(65 + i): _pivot(p) for i, p in enumerate(points)},
        "pivot_coordinates": {chr(65 + i): _pivot(p) for i, p in enumerate(points)},
        "trade_levels": _levels(entry, stop, target, direction),
        "invalidation": {
            "price": stop,
            "condition": f"close {'below' if direction == 'bullish' else 'above'} the pattern extreme",
            "reason": note,
        },
        "geometry_quality": {
            "pivot_spacing": {"values": spacings, "minimum_observed": min_spacing,
                              "minimum_required": _MIN_PIVOT_SPACING,
                              "meets_minimum": min_spacing >= _MIN_PIVOT_SPACING},
            "sample_quality": {"pivot_count": len(points), "sufficient": True},
        },
        "forward_validation": {"available": False, "status": "unavailable", "validated": False,
                               "reason": "forward outcome statistics are unavailable"},
    }


def _double(swings: List[Swing]) -> Optional[Dict[str, Any]]:
    """Double top (H-L-H at one level) or double bottom (L-H-L)."""
    if len(swings) < 3:
        return None
    p1, mid, p2 = swings[-3:]
    if p1.type != p2.type or mid.type == p1.type:
        return None
    height = abs(p1.price - mid.price)
    if height <= 0 or not _similar(p1.price, p2.price, height):
        return None
    neckline = mid.price
    if p1.type == "high":
        # Two highs, a trough between: bearish on a break of the trough.
        stop = max(p1.price, p2.price)
        return _result("Double Top", "bearish", [p1, mid, p2], neckline,
                       entry=neckline, stop=stop, target=neckline - height,
                       note="a close back above the twin highs negates the top")
    stop = min(p1.price, p2.price)
    return _result("Double Bottom", "bullish", [p1, mid, p2], neckline,
                   entry=neckline, stop=stop, target=neckline + height,
                   note="a close back below the twin lows negates the bottom")


def _triple(swings: List[Swing]) -> Optional[Dict[str, Any]]:
    """Triple top (H-L-H-L-H) or triple bottom, all three at one level."""
    if len(swings) < 5:
        return None
    p1, t1, p2, t2, p3 = swings[-5:]
    if not (p1.type == p2.type == p3.type) or t1.type == p1.type or t2.type == p1.type:
        return None
    height = abs(p1.price - t1.price)
    if height <= 0:
        return None
    if not (_similar(p1.price, p2.price, height) and _similar(p2.price, p3.price, height)):
        return None
    neckline = (t1.price + t2.price) / 2.0
    points = [p1, t1, p2, t2, p3]
    if p1.type == "high":
        return _result("Triple Top", "bearish", points, neckline,
                       entry=neckline, stop=max(p1.price, p2.price, p3.price),
                       target=neckline - height,
                       note="a close back above the three highs negates the top")
    return _result("Triple Bottom", "bullish", points, neckline,
                   entry=neckline, stop=min(p1.price, p2.price, p3.price),
                   target=neckline + height,
                   note="a close back below the three lows negates the bottom")


def _head_and_shoulders(swings: List[Swing]) -> Optional[Dict[str, Any]]:
    """Head and shoulders, or the inverse, from five alternating pivots."""
    if len(swings) < 5:
        return None
    ls, t1, head, t2, rs = swings[-5:]
    if not (ls.type == head.type == rs.type) or t1.type == ls.type or t2.type == ls.type:
        return None
    shoulder_scale = abs(head.price - (t1.price + t2.price) / 2.0)
    if shoulder_scale <= 0:
        return None
    # Shoulders should be comparable to each other and both lower than the head
    # (higher, for the inverse).
    if not _similar(ls.price, rs.price, shoulder_scale):
        return None
    neckline = (t1.price + t2.price) / 2.0
    points = [ls, t1, head, t2, rs]
    # The head must clear both shoulders by a real margin. Without this a flat
    # triple top — where one peak is marginally the highest — reads as a head
    # and shoulders.
    shoulder = max(ls.price, rs.price) if ls.type == "high" else min(ls.price, rs.price)
    if abs(head.price - shoulder) < shoulder_scale * 0.15:
        return None

    # Stop goes beyond the right shoulder, not the head: a head-width stop
    # against a measured-move target pins reward:risk at ~1.0 on every pattern.
    if ls.type == "high":
        if not (head.price > ls.price and head.price > rs.price):
            return None
        height = head.price - neckline
        return _result("Head and Shoulders", "bearish", points, neckline,
                       entry=neckline, stop=rs.price, target=neckline - height,
                       note="a close back above the right shoulder negates the topping pattern")
    if not (head.price < ls.price and head.price < rs.price):
        return None
    height = neckline - head.price
    return _result("Inverse Head and Shoulders", "bullish", points, neckline,
                   entry=neckline, stop=rs.price, target=neckline + height,
                   note="a close back below the right shoulder negates the basing pattern")


def _triangle(swings: List[Swing]) -> Optional[Dict[str, Any]]:
    """Ascending, descending or symmetrical triangle from four pivots."""
    if len(swings) < 4:
        return None
    window = swings[-4:]
    highs = [p for p in window if p.type == "high"]
    lows = [p for p in window if p.type == "low"]
    if len(highs) < 2 or len(lows) < 2:
        return None
    h1, h2 = highs[-2], highs[-1]
    l1, l2 = lows[-2], lows[-1]
    height = abs(max(h1.price, h2.price) - min(l1.price, l2.price))
    if height <= 0:
        return None

    flat_top = _similar(h1.price, h2.price, height)
    flat_base = _similar(l1.price, l2.price, height)
    rising_lows = l2.price > l1.price and not flat_base
    falling_highs = h2.price < h1.price and not flat_top

    if flat_top and rising_lows:
        level = (h1.price + h2.price) / 2.0
        return _result("Ascending Triangle", "bullish", window, level,
                       entry=level, stop=l2.price, target=level + height,
                       note="a close back below the rising base negates the triangle")
    if flat_base and falling_highs:
        level = (l1.price + l2.price) / 2.0
        return _result("Descending Triangle", "bearish", window, level,
                       entry=level, stop=h2.price, target=level - height,
                       note="a close back above the falling top negates the triangle")
    if rising_lows and falling_highs:
        # Symmetrical: break direction unknown, so quote the prevailing leg.
        direction = "bullish" if l2.price - l1.price > h1.price - h2.price else "bearish"
        level = (h2.price + l2.price) / 2.0
        stop = l2.price if direction == "bullish" else h2.price
        target = level + height if direction == "bullish" else level - height
        return _result("Symmetrical Triangle", direction, window, level,
                       entry=level, stop=stop, target=target,
                       note="a close beyond the opposite boundary negates the apex")
    return None


def _wedge(swings: List[Swing]) -> Optional[Dict[str, Any]]:
    """Rising wedge (bearish) or falling wedge (bullish): both trendlines
    slope in the same direction but converge."""
    if len(swings) < 4:
        return None
    window = swings[-4:]
    highs = [p for p in window if p.type == "high"]
    lows = [p for p in window if p.type == "low"]
    if len(highs) < 2 or len(lows) < 2:
        return None
    h1, h2 = highs[-2], highs[-1]
    l1, l2 = lows[-2], lows[-1]
    height = abs(max(h1.price, h2.price) - min(l1.price, l2.price))
    if height <= 0:
        return None

    # Rising wedge: both slopes positive, upper < lower (converging upward)
    # Falling wedge: both slopes negative, upper < lower (converging downward)
    h_rising = h2.price > h1.price
    l_rising = l2.price > l1.price
    h_falling = h2.price < h1.price
    l_falling = l2.price < l1.price

    if h_rising and l_rising and (l2.price - l1.price) > (h2.price - h1.price):
        # Rising wedge: support rises faster than resistance — bearish
        level = max(h1.price, h2.price)
        return _result("Rising Wedge", "bearish", window, level,
                       entry=min(l1.price, l2.price),
                       stop=level + height * 0.1,
                       target=level - height,
                       note="a close above the upper trendline negates the wedge")
    if h_falling and l_falling and (h1.price - h2.price) > (l1.price - l2.price):
        # Falling wedge: resistance falls faster than support — bullish
        level = min(l1.price, l2.price)
        return _result("Falling Wedge", "bullish", window, level,
                       entry=max(h1.price, h2.price),
                       stop=level - height * 0.1,
                       target=level + height,
                       note="a close below the lower trendline negates the wedge")
    return None


def _range(swings: List[Swing]) -> Optional[Dict[str, Any]]:
    """Horizontal consolidation: flat support and resistance with multiple touches."""
    if len(swings) < 4:
        return None
    # Use the most recent 6+ swings if available
    window = swings[-6:] if len(swings) >= 6 else swings[-4:]
    highs = [p for p in window if p.type == "high"]
    lows = [p for p in window if p.type == "low"]
    if len(highs) < 2 or len(lows) < 2:
        return None

    resistance = (highs[-1].price + highs[-2].price) / 2.0
    support = (lows[-1].price + lows[-2].price) / 2.0
    height = resistance - support
    if height <= 0:
        return None

    # All highs near resistance, all lows near support
    for h in highs:
        if not _similar(h.price, resistance, height):
            return None
    for l in lows:
        if not _similar(l.price, support, height):
            return None

    touches = len(highs) + len(lows)
    midpoint = (resistance + support) / 2.0
    # Range is neutral until breakout; quote levels as breakout-aware placeholders
    return _result("Range", "bullish", window, midpoint,
                   entry=resistance,  # Upside breakout level
                   stop=support,
                   target=resistance + height,
                   note=f"range with {touches} boundary touches; direction determined by breakout")


def _cup_and_handle(swings: List[Swing], candles: List[Candle]) -> Optional[Dict[str, Any]]:
    """Cup and Handle: U-shaped recovery followed by a smaller pullback."""
    if len(swings) < 5 or len(candles) < 20:
        return None
    highs = [p for p in swings if p.type == "high"]
    lows = [p for p in swings if p.type == "low"]
    if len(highs) < 2 or len(lows) < 3:
        return None

    # Search for cup formation: left rim -> bottom -> right rim
    for i in range(len(lows) - 1, 0, -1):
        cup_bottom = lows[i]
        left_rims = [h for h in highs if h.index < cup_bottom.index]
        right_rims = [h for h in highs if h.index > cup_bottom.index]
        if not left_rims or not right_rims:
            continue
        left_rim = left_rims[-1]
        right_rim = right_rims[0]

        rim_level = min(left_rim.price, right_rim.price)
        depth = rim_level - cup_bottom.price
        if depth <= 0:
            continue

        # Rims at similar level
        if not _similar(left_rim.price, right_rim.price, depth):
            continue

        # Cup must span enough bars
        cup_bars = right_rim.index - left_rim.index
        if cup_bars < 8:
            continue

        # Handle: small pullback after right rim
        handle_candidates = [l for l in lows if l.index > right_rim.index]
        if not handle_candidates:
            # Cup only, no handle yet — lower confidence
            return _result("Cup (no handle)", "bullish",
                           [left_rim, cup_bottom, right_rim],
                           rim_level,
                           entry=rim_level, stop=cup_bottom.price,
                           target=rim_level + depth,
                           note="awaiting handle formation for confirmation")

        handle = handle_candidates[0]
        handle_depth = rim_level - handle.price
        if handle_depth > depth * 0.5:
            continue  # Handle too deep

        return _result("Cup and Handle", "bullish",
                       [left_rim, cup_bottom, right_rim, handle],
                       rim_level,
                       entry=rim_level, stop=handle.price,
                       target=rim_level + depth,
                       note="a close below the handle low negates the pattern")
    return None


def _flag(swings: List[Swing], candles: List[Candle]) -> Optional[Dict[str, Any]]:
    """Flag: a strong impulse leg followed by a shallow counter-trend drift."""
    if len(swings) < 4 or len(candles) < 15:
        return None
    pole_start, pole_end, pull_a, pull_b = swings[-4:]
    pole = abs(pole_end.price - pole_start.price)
    if pole <= 0:
        return None
    retrace = abs(pull_b.price - pole_end.price)
    # A flag consolidates; a retrace beyond half the pole is a reversal, not a flag.
    if retrace > pole * 0.5 or retrace <= 0:
        return None
    # The pole must actually be an impulse relative to the drift that follows.
    if (pull_b.index - pole_end.index) >= (pole_end.index - pole_start.index) * 2:
        return None
    window = [pole_start, pole_end, pull_a, pull_b]
    if pole_end.price > pole_start.price:
        level = max(pull_a.price, pull_b.price)
        return _result("Bull Flag", "bullish", window, level,
                       entry=level, stop=min(pull_a.price, pull_b.price),
                       target=level + pole,
                       note="a close below the flag negates the continuation")
    level = min(pull_a.price, pull_b.price)
    return _result("Bear Flag", "bearish", window, level,
                   entry=level, stop=max(pull_a.price, pull_b.price),
                   target=level - pole,
                   note="a close above the flag negates the continuation")


def _pivot_indexes(match: Dict[str, Any]) -> set:
    return {int(p["index"]) for p in match["points"].values()}


def _scan_windows(swings: List[Swing], detector, window_size: int,
                  max_lookback: int) -> Optional[Dict[str, Any]]:
    """Slide a fixed-size window across the most recent pivots, most-recent first.

    The classical detectors historically took only the last N pivots. That is
    correct when the active pattern happens to be the most recent formation,
    but it silently misses any 3- or 4-pivot template (double, triangle) that
    ended a few pivots ago and was followed by noise. This helper re-runs the
    detector on every sliding window of `window_size` pivots inside the last
    `max_lookback` pivots, returning the first match. The outer dispatch in
    `detect_all_from_swings` already de-duplicates overlapping pivots, so two
    different windows returning the same pattern is harmless.
    """
    if len(swings) < window_size:
        return None
    n = min(len(swings), max_lookback)
    start_min = len(swings) - n
    for end in range(len(swings), start_min, -1):
        start = end - window_size
        if start < start_min:
            break
        window = swings[start:end]
        try:
            match = detector(window)
        except Exception:  # pragma: no cover — a detector must never break analysis
            continue
        if match:
            return match
    return None


# How far back each short-pivot detector is allowed to look. Triangle needs 4
# pivots in its template and is the noisiest formation, so it gets the widest
# lookback; double needs only 3 pivots and short lookback is enough.
_TRIANGLE_LOOKBACK = 20
_DOUBLE_LOOKBACK = 12


def _triangle_scanner(swings: List[Swing]) -> Optional[Dict[str, Any]]:
    return _scan_windows(swings, _triangle, window_size=4,
                         max_lookback=_TRIANGLE_LOOKBACK)


def _double_scanner(swings: List[Swing]) -> Optional[Dict[str, Any]]:
    return _scan_windows(swings, _double, window_size=3,
                         max_lookback=_DOUBLE_LOOKBACK)


def detect_all_from_swings(swings: List[Swing], candles: List[Candle]) -> List[Dict[str, Any]]:
    """Classical formations the recent pivots support, most specific first.

    Detectors are tried in descending specificity. The same pivots frequently
    satisfy several templates — a head and shoulders is also, loosely, a triple
    top and a double top — so once a pattern claims a set of pivots, weaker
    templates sharing three or more of them are suppressed. Without this the
    chart reports three contradictory patterns drawn over one formation.

    Triangle and double are wrapped in window scanners so a pattern that
    completed a few pivots ago is still surfaced; the strict "last N pivots
    only" behaviour was silently dropping every template that wasn't currently
    the most recent formation.
    """
    found: List[Dict[str, Any]] = []
    claimed: List[set] = []

    def consider(match: Optional[Dict[str, Any]]) -> None:
        if not match:
            return
        pivots = _pivot_indexes(match)
        if any(len(pivots & taken) >= 3 for taken in claimed):
            return
        found.append(match)
        claimed.append(pivots)

    # Order is by specificity, not convenience. A flag must be tested before a
    # triangle (its converging pivots also fit a symmetrical triangle, but the
    # impulse pole makes it the better read), and a triangle before a double
    # (a descending triangle's flat base is also a double bottom).
    detectors = (
        _head_and_shoulders,
        _triple,
        lambda s: _cup_and_handle(s, candles),
        lambda s: _flag(s, candles),
        _triangle_scanner,
        _wedge,
        _range,
        _double_scanner,
    )
    for detector in detectors:
        try:
            consider(detector(swings))
        except Exception:  # pragma: no cover — a detector must never break analysis
            continue
    return found


def detect_all(candles: List[Candle], left_right: int = 2) -> List[Dict[str, Any]]:
    """Detect classical chart patterns from candle swing pivots."""
    if len(candles) < 15:
        return []
    return detect_all_from_swings(detect_swings(candles, left_right=left_right), candles)
