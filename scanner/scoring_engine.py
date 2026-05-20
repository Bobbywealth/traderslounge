"""Scoring engine — runs the 6 modules and builds a Signal."""
from __future__ import annotations

from typing import List, Optional

from .data_types import Direction, MarketSnapshot, ModuleResult
from .modules import (
    adr_calculator,
    fibonacci,
    htf_bias,
    liquidity,
    market_structure,
    rsi_filter,
)
from .signal import Signal, session_for, tier_for

MAX_TOTAL = (
    htf_bias.MAX_POINTS
    + adr_calculator.MAX_POINTS
    + fibonacci.MAX_POINTS
    + market_structure.MAX_POINTS
    + liquidity.MAX_POINTS
    + rsi_filter.MAX_POINTS
)  # 20 + 15 + 15 + 15 + 10 + 5 = 80


def _risk_level(score: int) -> str:
    if score >= 65:
        return "Low"
    if score >= 50:
        return "Medium"
    return "High"


def _build_trade_levels(
    snap: MarketSnapshot, direction: Direction, fib_result: ModuleResult, adr_result: ModuleResult,
    liquidity_result: ModuleResult,
) -> tuple[float, float, float, float, float]:
    """Return (entry, sl, tp1, tp2, tp3)."""
    ltf = snap.ltf()
    entry = ltf[-1].close if ltf else 0.0

    fib = fib_result.details or {}
    levels = fib.get("levels", {})
    swing_low = fib.get("swing_low", entry)
    swing_high = fib.get("swing_high", entry)

    liq = liquidity_result.details or {}
    adr = adr_result.details or {}

    if direction == Direction.BUY:
        sl = liq.get("swept_low", swing_low) * 0.999
        tp1 = levels.get("1.272", swing_high)
        ext = levels.get("1.618", swing_high * 1.01)
        adr_high = adr.get("adr_high", ext)
        tp2 = max(tp1 * 1.002, min(ext, adr_high) if adr_high > tp1 else ext)
        tp3 = max(tp2 * 1.002, ext, adr_high)
    else:
        sl = liq.get("swept_high", swing_high) * 1.001
        tp1 = levels.get("1.272", swing_low)
        ext = levels.get("1.618", swing_low * 0.99)
        adr_low = adr.get("adr_low", ext)
        tp2 = min(tp1 * 0.998, max(ext, adr_low) if adr_low < tp1 else ext)
        tp3 = min(tp2 * 0.998, ext, adr_low)

    return entry, sl, tp1, tp2, tp3


def score(snap: MarketSnapshot) -> Signal:
    """Run all six modules, return the final Signal."""
    # Step 1: derive HTF bias to propose a direction.
    bias = htf_bias.evaluate(snap.d1, snap.h4, snap.h1)
    proposed = bias.direction
    ltf = snap.ltf()

    # If HTF gives no direction, the trade is already a no-go but we still
    # evaluate the modules with NEUTRAL so reasons are populated.
    adr = adr_calculator.evaluate(snap.d1, proposed)
    fib = fibonacci.evaluate(ltf, proposed)
    struct = market_structure.evaluate(ltf, proposed)
    liq = liquidity.evaluate(ltf, snap.d1, proposed)
    rsi_r = rsi_filter.evaluate(ltf, proposed)

    modules = [bias, adr, fib, struct, liq, rsi_r]
    total = sum(m.points for m in modules)
    tier = tier_for(total)

    entry, sl, tp1, tp2, tp3 = _build_trade_levels(snap, proposed, fib, adr, liq)

    reasons = [m.reason for m in modules if m.points > 0]
    last_time = ltf[-1].time if ltf else 0
    adr_details = adr.details or {}
    adr_status = (
        f"{adr_details.get('percent_used', 0):.0f}% used"
        if adr_details else "n/a"
    )
    pattern_bits: List[str] = []
    if struct.details and struct.details.get("last_choch"):
        pattern_bits.append(f"CHOCH-{struct.details['last_choch']}")
    if struct.details and struct.details.get("last_bos"):
        pattern_bits.append(f"BOS-{struct.details['last_bos']}")
    if fib.points > 0:
        pattern_bits.append("Fib retest")

    return Signal(
        pair=snap.pair,
        direction=proposed if total >= 35 else Direction.NEUTRAL,
        entry=entry,
        stop_loss=sl,
        tp1=tp1,
        tp2=tp2,
        tp3=tp3,
        confidence_score=total,
        tier=tier,
        reasons=reasons,
        risk_level=_risk_level(total),
        session=session_for(last_time),
        adr_status=adr_status,
        htf_bias=proposed.value if proposed != Direction.NEUTRAL else "Neutral",
        pattern=", ".join(pattern_bits) or "n/a",
    )
