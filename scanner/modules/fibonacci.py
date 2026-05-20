"""Module 3 — Fibonacci Engine (+15).

Finds the most recent major swing leg on the LTF and checks whether price
is currently inside the 0.50 – 0.786 retracement zone with a confirmation
candle (a candle closing back toward the trend direction).
"""
from __future__ import annotations

from typing import List, Optional, Tuple

from ..data_types import Candle, Direction, ModuleResult
from ..indicators import detect_swings

MAX_POINTS = 15
ZONE_LOW = 0.50
ZONE_HIGH = 0.786


def latest_leg(candles: List[Candle]) -> Optional[Tuple[float, float, str]]:
    """Return (swing_low, swing_high, leg_direction) for the most recent leg.

    leg_direction is "up" if the most recent swing is a high (impulse up),
    "down" if the most recent swing is a low.
    """
    swings = detect_swings(candles, left_right=3)
    if len(swings) < 2:
        return None
    last = swings[-1]
    prev = swings[-2]
    if last.type == prev.type:
        return None
    if last.type == "high":
        return prev.price, last.price, "up"
    return last.price, prev.price, "down"


def retracement_pct(price: float, low: float, high: float, leg: str) -> float:
    rng = high - low
    if rng <= 0:
        return 0.0
    if leg == "up":
        # retracement from high back toward low: 0 at high, 1 at low
        return (high - price) / rng
    # leg == "down": 0 at low, 1 at high
    return (price - low) / rng


def evaluate(ltf: List[Candle], proposed_direction: Direction) -> ModuleResult:
    leg = latest_leg(ltf)
    if leg is None or not ltf:
        return ModuleResult("fibonacci", 0, MAX_POINTS, Direction.NEUTRAL,
                            "No recent swing leg")
    low, high, dirn = leg
    last = ltf[-1]
    pct = retracement_pct(last.close, low, high, dirn)
    in_zone = ZONE_LOW <= pct <= ZONE_HIGH
    rng = high - low
    fib_levels = {
        "0.382": high - rng * 0.382 if dirn == "up" else low + rng * 0.382,
        "0.50": high - rng * 0.50 if dirn == "up" else low + rng * 0.50,
        "0.618": high - rng * 0.618 if dirn == "up" else low + rng * 0.618,
        "0.786": high - rng * 0.786 if dirn == "up" else low + rng * 0.786,
        "1.272": high + rng * 0.272 if dirn == "up" else low - rng * 0.272,
        "1.618": high + rng * 0.618 if dirn == "up" else low - rng * 0.618,
    }
    details = {"leg": dirn, "swing_low": low, "swing_high": high,
               "retracement": pct, "levels": fib_levels}

    if not in_zone:
        return ModuleResult("fibonacci", 0, MAX_POINTS, Direction.NEUTRAL,
                            f"Outside 0.50-0.786 zone ({pct:.2f})", details)

    # Confirmation candle: bullish close (close > open) for up leg / buy,
    # bearish close for down leg / sell.
    bullish_candle = last.close > last.open
    bearish_candle = last.close < last.open
    expected_buy = dirn == "up" and proposed_direction == Direction.BUY and bullish_candle
    expected_sell = dirn == "down" and proposed_direction == Direction.SELL and bearish_candle
    if expected_buy or expected_sell:
        return ModuleResult("fibonacci", MAX_POINTS, MAX_POINTS, proposed_direction,
                            f"Price in {pct:.2f} retracement with confirmation candle",
                            details)
    return ModuleResult("fibonacci", MAX_POINTS // 3, MAX_POINTS, Direction.NEUTRAL,
                        f"In fib zone {pct:.2f} but no confirmation candle", details)
