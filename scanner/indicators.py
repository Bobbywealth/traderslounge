"""Shared indicator math (EMA, RSI, swings, structure). Stdlib only.

Mirrors the algorithms in server/services/indicators.js so the Python
scanner produces identical numbers to the legacy Node code during the
crossover period.
"""
from __future__ import annotations

from typing import List, Optional

from .data_types import Candle, Swing


def ema(values: List[float], period: int) -> List[float]:
    if not values or period <= 0:
        return []
    k = 2 / (period + 1)
    out: List[float] = [values[0]]
    for i in range(1, len(values)):
        out.append(values[i] * k + out[-1] * (1 - k))
    return out


def rsi(closes: List[float], period: int = 14) -> List[float]:
    """Wilder RSI(14)."""
    n = len(closes)
    if n <= period:
        return []
    out: List[float] = [float("nan")] * n
    avg_gain = 0.0
    avg_loss = 0.0
    for i in range(1, period + 1):
        ch = closes[i] - closes[i - 1]
        if ch > 0:
            avg_gain += ch
        else:
            avg_loss -= ch
    avg_gain /= period
    avg_loss /= period
    out[period] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    for i in range(period + 1, n):
        ch = closes[i] - closes[i - 1]
        gain = ch if ch > 0 else 0
        loss = -ch if ch < 0 else 0
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        out[i] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    return out


def atr(candles: List[Candle], period: int = 14) -> Optional[float]:
    if len(candles) < period + 1:
        return None
    trs: List[float] = []
    for i in range(1, len(candles)):
        c = candles[i]
        p = candles[i - 1]
        tr = max(c.high - c.low, abs(c.high - p.close), abs(c.low - p.close))
        trs.append(tr)
    # Wilder smoothing
    smoothed = sum(trs[:period]) / period
    for tr in trs[period:]:
        smoothed = (smoothed * (period - 1) + tr) / period
    return smoothed


def detect_swings(candles: List[Candle], left_right: int = 2) -> List[Swing]:
    """Fractal swing detection. Collapses consecutive same-type pivots."""
    raw: List[Swing] = []
    for i in range(left_right, len(candles) - left_right):
        cur = candles[i]
        is_high = True
        is_low = True
        for j in range(i - left_right, i + left_right + 1):
            if j == i:
                continue
            if candles[j].high >= cur.high:
                is_high = False
            if candles[j].low <= cur.low:
                is_low = False
        if is_high:
            raw.append(Swing(i, cur.time, cur.high, "high"))
        if is_low:
            raw.append(Swing(i, cur.time, cur.low, "low"))
    cleaned: List[Swing] = []
    for s in raw:
        if cleaned and cleaned[-1].type == s.type:
            last = cleaned[-1]
            more_extreme = (s.type == "high" and s.price > last.price) or (
                s.type == "low" and s.price < last.price
            )
            if more_extreme:
                cleaned[-1] = s
        else:
            cleaned.append(s)
    return cleaned


def label_swings(swings: List[Swing]) -> List[Swing]:
    """Annotate each swing with HH/HL/LH/LL relative to prior same-type."""
    for i, s in enumerate(swings):
        prev_same = None
        for p in reversed(swings[:i]):
            if p.type == s.type:
                prev_same = p
                break
        if prev_same is None:
            s.label = None
            continue
        if s.type == "high":
            s.label = "HH" if s.price > prev_same.price else "LH"
        else:
            s.label = "HL" if s.price > prev_same.price else "LL"
    return swings
