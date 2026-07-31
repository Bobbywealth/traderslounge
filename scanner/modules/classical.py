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


def detect_all_from_swings(swings: List[Swing], candles: List[Candle]) -> List[Dict[str, Any]]:
    """Classical formations the most recent pivots support, most specific first.

    Detectors are tried in descending specificity. The same pivots frequently
    satisfy several templates — a head and shoulders is also, loosely, a triple
    top and a double top — so once a pattern claims a set of pivots, weaker
    templates sharing three or more of them are suppressed. Without this the
    chart reports three contradictory patterns drawn over one formation.
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
        lambda s: _flag(s, candles),
        _triangle,
        _double,
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
