"""Synthetic candle builders for module + scoring tests.

Pure deterministic generators — no randomness — so the tests assert
specific score contributions reliably.
"""
from __future__ import annotations

from typing import List

from scanner.data_types import Candle


def trend_candles(
    n: int,
    start: float,
    step: float,
    body: float = 0.5,
    wick: float = 0.3,
    start_time: int = 1_700_000_000,
    step_seconds: int = 3600,
) -> List[Candle]:
    """Linear trend. step > 0 = uptrend, step < 0 = downtrend."""
    out: List[Candle] = []
    price = start
    for i in range(n):
        o = price
        c = price + step
        hi = max(o, c) + wick
        lo = min(o, c) - wick
        # ensure body
        if abs(c - o) < body:
            c = o + (body if step >= 0 else -body)
            hi = max(hi, max(o, c) + wick)
            lo = min(lo, min(o, c) - wick)
        out.append(Candle(start_time + i * step_seconds, o, hi, lo, c))
        price = c
    return out


def zigzag(
    legs: List[tuple[int, float]],
    start: float,
    start_time: int = 1_700_000_000,
    step_seconds: int = 3600,
    wick: float = 0.3,
) -> List[Candle]:
    """Build alternating legs: each (length, per-bar-step) tuple.

    Example: zigzag([(10, +1.0), (5, -0.6), (10, +1.0)], 100.0)
    """
    out: List[Candle] = []
    price = start
    t = start_time
    last_leg_idx = len(legs) - 1
    for leg_i, (length, step) in enumerate(legs):
        for j in range(length):
            o = price
            c = price + step
            hi = max(o, c) + wick
            lo = min(o, c) - wick
            # On the last bar of every non-final leg, punch the pivot
            # extreme so detect_swings finds it unambiguously.
            if j == length - 1 and leg_i < last_leg_idx:
                if step > 0:
                    hi += abs(step) * 2  # extra-tall wick above
                else:
                    lo -= abs(step) * 2  # extra-deep wick below
            out.append(Candle(t, o, hi, lo, c))
            price = c
            t += step_seconds
    return out
