"""Swing-based XABCD harmonic pattern recognition.

Pattern metadata only: harmonic matches enrich a signal's explanation but do
not change the established 80-point BWTS score or risk thresholds.
"""
from __future__ import annotations

from typing import Dict, List, Optional

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


def _within(value: float, bounds: tuple[float, float]) -> bool:
    return bounds[0] <= value <= bounds[1]


def detect_from_swings(swings: List[Swing]) -> Optional[dict]:
    """Return the most recent matching XABCD harmonic, if any."""
    if len(swings) < 5:
        return None
    # Search newest windows first so the scanner reports the most actionable
    # completion zone rather than an older historical match.
    for start in range(len(swings) - 5, -1, -1):
        x, a, b, c, d = swings[start:start + 5]
        types = [p.type for p in (x, a, b, c, d)]
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
        ratios = {
            "ab_xa": ab / xa,
            "bc_ab": bc / ab,
            "cd_bc": cd / bc,
            "ad_xa": ad / xa,
        }
        for name, spec in PATTERNS.items():
            if all(_within(ratios[key], spec[key]) for key in spec):
                return {
                    "name": name,
                    "direction": "bullish" if x.type == "low" else "bearish",
                    "prz": d.price,
                    "points": {"X": x, "A": a, "B": b, "C": c, "D": d},
                    "ratios": ratios,
                }
    return None


def detect(candles: List[Candle], left_right: int = 2) -> Optional[dict]:
    """Detect the most recent harmonic pattern from candle swing pivots."""
    if len(candles) < 15:
        return None
    return detect_from_swings(detect_swings(candles, left_right=left_right))
