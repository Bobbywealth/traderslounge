"""Swing-based XABCD harmonic pattern recognition.

Pattern metadata only: harmonic matches enrich a signal's explanation but do
not change the established 80-point BWTS score or risk thresholds.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from ..data_types import Candle, Swing
from ..indicators import detect_swings

# Ratio windows mirror the existing JS detector, with Deep Crab added from
# the TypeScript specification. Values are deliberately ranges rather than
# exact anchors to tolerate live-market noise.
PATTERNS: Dict[str, Dict[str, tuple[float, float]]] = {
    "Gartley": {
        "ab_xa": (0.55, 0.68), "bc_ab": (0.382, 0.886),
        "cd_bc": (1.13, 1.618), "ad_xa": (0.74, 0.83),
    },
    "Bat": {
        "ab_xa": (0.38, 0.52), "bc_ab": (0.382, 0.886),
        "cd_bc": (1.618, 2.618), "ad_xa": (0.85, 0.92),
    },
    "Butterfly": {
        "ab_xa": (0.74, 0.83), "bc_ab": (0.382, 0.886),
        "cd_bc": (1.618, 2.618), "ad_xa": (1.20, 1.65),
    },
    "Crab": {
        "ab_xa": (0.38, 0.65), "bc_ab": (0.382, 0.886),
        "cd_bc": (2.24, 3.618), "ad_xa": (1.55, 1.68),
    },
    "Deep Crab": {
        "ab_xa": (0.85, 0.92), "bc_ab": (0.382, 0.886),
        "cd_bc": (2.0, 3.618), "ad_xa": (1.55, 1.68),
    },
    "Shark": {
        "ab_xa": (0.50, 0.886), "bc_ab": (1.13, 1.618),
        "cd_bc": (1.27, 2.24), "ad_xa": (0.88, 1.13),
    },
    "Cypher": {
        "ab_xa": (0.38, 0.618), "bc_ab": (1.13, 1.414),
        "cd_bc": (1.27, 2.0), "ad_xa": (0.74, 0.82),
    },
}

_MIN_PIVOT_SPACING = 2


def _within(value: float, bounds: tuple[float, float]) -> bool:
    return bounds[0] <= value <= bounds[1]


def _pivot_coordinates(swings: List[Swing]) -> Dict[str, Dict[str, Any]]:
    """Return JSON-serializable coordinates without replacing legacy points."""
    return {
        name: {"index": pivot.index, "time": pivot.time, "price": pivot.price,
               "type": pivot.type, "label": pivot.label}
        for name, pivot in zip(("X", "A", "B", "C", "D"), swings)
    }


def _ratio_validation(ratios: Dict[str, float], spec: Dict[str, tuple[float, float]]) -> Dict[str, Dict[str, float | bool]]:
    """Expose the target, tolerated range, and observed error for every ratio."""
    result: Dict[str, Dict[str, float | bool]] = {}
    for key, (lower, upper) in spec.items():
        target = (lower + upper) / 2
        tolerance = (upper - lower) / 2
        value = ratios[key]
        result[key] = {
            "observed": value,
            "target": target,
            "tolerance": tolerance,
            "error": abs(value - target),
            "min": lower,
            "max": upper,
            "within_tolerance": _within(value, (lower, upper)),
        }
    return result


def _prz_zone(x: Swing, a: Swing, b: Swing, c: Swing, spec: Dict[str, tuple[float, float]]) -> Dict[str, Any]:
    """Give the two ratio-derived D projections and their conservative zone."""
    xa = abs(a.price - x.price)
    bc = abs(c.price - b.price)
    ad_min, ad_max = spec["ad_xa"]
    cd_min, cd_max = spec["cd_bc"]
    # D moves from A toward X and from C toward B for both orientations.
    ad_sign = 1 if x.price > a.price else -1
    cd_sign = 1 if b.price > c.price else -1
    ad_values = [a.price + ad_sign * xa * ratio for ratio in (ad_min, ad_max)]
    cd_values = [c.price + cd_sign * bc * ratio for ratio in (cd_min, cd_max)]
    lower = max(min(ad_values), min(cd_values))
    upper = min(max(ad_values), max(cd_values))
    overlap = lower <= upper
    if not overlap:
        # Keep a useful envelope even where the two tolerated projections do
        # not overlap exactly; this does not reject an existing candidate.
        lower, upper = min(ad_values + cd_values), max(ad_values + cd_values)
    return {
        "lower": lower,
        "upper": upper,
        "overlap": overlap,
        "ad_projection": {"lower": min(ad_values), "upper": max(ad_values)},
        "cd_projection": {"lower": min(cd_values), "upper": max(cd_values)},
    }


def _geometry_quality(swings: List[Swing], validation: Dict[str, Dict[str, float | bool]]) -> Dict[str, Any]:
    spacings = [swings[i].index - swings[i - 1].index for i in range(1, len(swings))]
    min_spacing = min(spacings) if spacings else 0
    ratio_errors = [float(item["error"]) / max(float(item["tolerance"]), 1e-9)
                    for item in validation.values()]
    mean_error = sum(ratio_errors) / len(ratio_errors) if ratio_errors else 1.0
    deductions: List[Dict[str, Any]] = []
    if min_spacing < _MIN_PIVOT_SPACING:
        deductions.append({"reason": "tight_pivot_spacing", "points": 20,
                           "minimum_observed": min_spacing,
                           "minimum_required": _MIN_PIVOT_SPACING})
    if mean_error > 0.75:
        deductions.append({"reason": "ratios_near_tolerance_edge", "points": 15,
                           "normalized_mean_error": mean_error})
    score = max(0.0, 100.0 - sum(float(d["points"]) for d in deductions) - min(25.0, mean_error * 10.0))
    return {
        "score": round(score, 2),
        "grade": "strong" if score >= 80 else "acceptable" if score >= 60 else "weak",
        "alternating_pivots": all(swings[i].type != swings[i - 1].type for i in range(1, len(swings))),
        "pivot_spacing": {"values": spacings, "minimum_observed": min_spacing,
                          "minimum_required": _MIN_PIVOT_SPACING,
                          "meets_minimum": min_spacing >= _MIN_PIVOT_SPACING},
        "sample_quality": {"pivot_count": len(swings), "minimum_required": 5,
                           "sufficient": len(swings) >= 5},
        "deductions": deductions,
    }


def _alternative(matches: List[str], name: str, direction: str) -> Dict[str, Any]:
    others = [candidate for candidate in matches if candidate != name]
    if others:
        return {"status": "candidate", "name": others[0], "direction": direction,
                "reason": "same pivots fit more than one ratio template"}
    return {"status": "unavailable", "name": None,
            "reason": "no second pattern template fits these five pivots"}


def detect_from_swings(swings: List[Swing]) -> Optional[dict]:
    """Return the most recent matching XABCD harmonic, if any.

    The result is explicitly an unvalidated candidate. Validation metadata is
    explanatory only and does not feed scoring or trade gates.
    """
    if len(swings) < 5:
        return None
    # Search newest windows first so the scanner reports the most actionable
    # completion zone rather than an older historical match.
    for start in range(len(swings) - 5, -1, -1):
        x, a, b, c, d = swings[start:start + 5]
        window = [x, a, b, c, d]
        types = [p.type for p in window]
        if types not in (
            ["low", "high", "low", "high", "low"],
            ["high", "low", "high", "low", "high"],
        ):
            continue
        xa = abs(a.price - x.price)
        ab = abs(b.price - a.price)
        bc = abs(c.price - b.price)
        cd = abs(d.price - c.price)
        ad = abs(d.price - a.price)
        if xa == 0 or ab == 0 or bc == 0:
            continue
        ratios = {"ab_xa": ab / xa, "bc_ab": bc / ab, "cd_bc": cd / bc, "ad_xa": ad / xa}
        matches = [name for name, spec in PATTERNS.items()
                   if all(_within(ratios[key], spec[key]) for key in spec)]
        if not matches:
            continue
        name = matches[0]
        spec = PATTERNS[name]
        validation = _ratio_validation(ratios, spec)
        direction = "bullish" if x.type == "low" else "bearish"
        return {
            # Existing fields remain unchanged for downstream consumers.
            "name": name,
            "direction": direction,
            "prz": d.price,
            "points": {"X": x, "A": a, "B": b, "C": c, "D": d},
            "ratios": ratios,
            # Additive candidate-validation context.
            "status": "candidate",
            "candidate_status": "candidate_unvalidated",
            "validated": False,
            "forward_validation": {"available": False, "status": "unavailable", "validated": False,
                                   "reason": "forward outcome statistics are unavailable"},
            "pivot_coordinates": _pivot_coordinates(window),
            "pivots": _pivot_coordinates(window),
            "ratio_validation": validation,
            "prz_zone": _prz_zone(x, a, b, c, spec),
            "invalidation": {
                "price": x.price,
                "condition": "close below X pivot" if direction == "bullish" else "close above X pivot",
                "reason": "X-pivot breach invalidates the XABCD geometry",
            },
            "alternative": _alternative(matches, name, direction),
            "alternative_interpretation": _alternative(matches, name, direction),
            "geometry_quality": _geometry_quality(window, validation),
        }
    return None


def detect(candles: List[Candle], left_right: int = 2) -> Optional[dict]:
    """Detect the most recent harmonic pattern from candle swing pivots."""
    if len(candles) < 15:
        return None
    return detect_from_swings(detect_swings(candles, left_right=left_right))
