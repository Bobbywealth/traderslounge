"""Section 3 (Order Flow & Liquidity) — Phase 2.

Surfaces the Fair Value Gaps, Order Blocks, equal-highs / equal-lows,
and Volume Profile that the canonical analyzer already computes
under ``analysis.zones`` and ``analysis.indicators`` and re-classifies
each gap/block by completion proximity (fresh / tested / exhausted).

Report-only — never feeds the BWTS score or Signals gate.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        f = float(value)
        return f if f == f else default
    except (TypeError, ValueError):
        return default


def _classify_fvg(gap: Dict[str, Any], current_price: float) -> str:
    low = _safe_float(gap.get("low"))
    high = _safe_float(gap.get("high"))
    if low <= 0 or high <= 0:
        return "unknown"
    if current_price > 0 and current_price > high:
        return "exhausted"
    if current_price > 0 and low <= current_price <= high:
        return "inside"
    return "fresh"


def _classify_order_block(block: Dict[str, Any], current_price: float) -> str:
    low = _safe_float(block.get("low"))
    high = _safe_float(block.get("high"))
    if low <= 0 or high <= 0:
        return "unknown"
    if current_price > 0 and current_price < low:
        return "below_price"
    if current_price > 0 and current_price > high:
        return "above_price"
    return "at_block"


def compute(analysis: Dict[str, Any], primary_timeframe: Optional[str] = None
            ) -> Dict[str, Any]:
    zones = analysis.get("zones") or {}
    fvgs_raw = zones.get("fair_value_gaps") or []
    obs_raw = zones.get("order_blocks") or []
    pools = zones.get("liquidity_pools") or {}
    profile = zones.get("volume_profile") or []
    current_price = _safe_float(analysis.get("current_price"))

    fvgs: List[Dict[str, Any]] = []
    for gap in fvgs_raw[:10]:
        fvgs.append({
            "type": gap.get("type"),
            "low": _safe_float(gap.get("low")),
            "high": _safe_float(gap.get("high")),
            "time": gap.get("time"),
            "state": _classify_fvg(gap, current_price),
        })

    order_blocks: List[Dict[str, Any]] = []
    for block in obs_raw[:10]:
        order_blocks.append({
            "type": block.get("type"),
            "low": _safe_float(block.get("low")),
            "high": _safe_float(block.get("high")),
            "time": block.get("time"),
            "state": _classify_order_block(block, current_price),
        })

    equal_highs = pools.get("equal_highs") or []
    equal_lows = pools.get("equal_lows") or []

    return {
        "available": True,
        "kind": "measured",
        "timeframe": (primary_timeframe or "1h").upper(),
        "fair_value_gaps": fvgs,
        "order_blocks": order_blocks,
        "equal_highs": equal_highs[:5],
        "equal_lows": equal_lows[:5],
        "volume_profile_nodes": profile[:5],
        "notes": (
            "FVGs and order blocks are classified as fresh / inside / "
            "exhausted based on whether the current price has crossed "
            "the zone. Equal-highs / equal-lows are stop-loss clusters "
            "from the canonical analyzer."
        ),
    }