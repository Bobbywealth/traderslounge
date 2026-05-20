"""Module 4 — Market Structure Tracker (+15).

Labels swings HH/HL/LH/LL and detects BOS / CHOCH. Full points when a
CHOCH or fresh BOS on the LTF aligns with the proposed trade direction.
"""
from __future__ import annotations

from typing import List, Optional

from ..data_types import Candle, Direction, ModuleResult, Swing
from ..indicators import detect_swings, label_swings

MAX_POINTS = 15


def analyze(candles: List[Candle]) -> dict:
    swings = label_swings(detect_swings(candles, left_right=2))
    last_bos: Optional[Swing] = None
    last_choch: Optional[Swing] = None
    bos_kind: Optional[str] = None
    choch_kind: Optional[str] = None
    trend = "neutral"
    for s in swings:
        if s.label == "HH" and trend != "bearish":
            last_bos, bos_kind = s, "bullish"
            trend = "bullish"
        elif s.label == "LL" and trend != "bullish":
            last_bos, bos_kind = s, "bearish"
            trend = "bearish"
        elif s.label == "LH" and trend == "bullish":
            last_choch, choch_kind = s, "bearish"
            trend = "bearish"
        elif s.label == "HL" and trend == "bearish":
            last_choch, choch_kind = s, "bullish"
            trend = "bullish"
    # Final trend from last 4 labelled
    last4 = [s for s in swings[-4:] if s.label]
    bulls = sum(1 for s in last4 if s.label in ("HH", "HL"))
    bears = sum(1 for s in last4 if s.label in ("LL", "LH"))
    if bulls >= 3:
        trend = "bullish"
    elif bears >= 3:
        trend = "bearish"
    return {
        "trend": trend,
        "labels": [s.label for s in swings if s.label],
        "last_bos": bos_kind,
        "last_choch": choch_kind,
    }


def evaluate(ltf: List[Candle], proposed_direction: Direction) -> ModuleResult:
    if len(ltf) < 10:
        return ModuleResult("market_structure", 0, MAX_POINTS, Direction.NEUTRAL,
                            "Insufficient LTF data")
    info = analyze(ltf)
    want = "bullish" if proposed_direction == Direction.BUY else "bearish"
    if info["last_choch"] == want:
        return ModuleResult("market_structure", MAX_POINTS, MAX_POINTS, proposed_direction,
                            f"{want.capitalize()} CHOCH on LTF", info)
    if info["last_bos"] == want and info["trend"] == want:
        return ModuleResult("market_structure", MAX_POINTS, MAX_POINTS, proposed_direction,
                            f"{want.capitalize()} BOS confirmed", info)
    if info["trend"] == want:
        return ModuleResult("market_structure", MAX_POINTS // 2, MAX_POINTS, proposed_direction,
                            f"LTF trend {want} but no fresh BOS/CHOCH", info)
    return ModuleResult("market_structure", 0, MAX_POINTS, Direction.NEUTRAL,
                        f"LTF structure {info['trend']} — does not support {want}", info)
