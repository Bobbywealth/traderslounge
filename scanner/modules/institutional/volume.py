"""Section 2 (Volume Analysis) — Phase 2.

Surfaces the existing RVol / VWAP / OBV values that the canonical
analyzer already computes in :mod:`scanner.crypto_analysis` and adds
a regime classification (high / normal / low) plus a consensus
signal (volume confirms or rejects the current move).

Report-only — never feeds the BWTS score or Signals gate.
"""
from __future__ import annotations

from typing import Any, Dict, Optional


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        f = float(value)
        return f if f == f else default
    except (TypeError, ValueError):
        return default


def _regime(relative_volume: Optional[float]) -> str:
    if relative_volume is None or relative_volume <= 0:
        return "unavailable"
    if relative_volume >= 1.5:
        return "high"
    if relative_volume >= 0.8:
        return "normal"
    return "low"


def _consensus(relative_volume: Optional[float], direction: str,
               adr_percent: Optional[float]) -> str:
    """Rule-of-thumb volume consensus.

    Returns one of: confirms, rejects, inconclusive, unavailable.
    """
    if relative_volume is None or relative_volume <= 0:
        return "unavailable"
    if relative_volume < 0.8:
        return "inconclusive"  # volume too low to support any claim
    high = relative_volume >= 1.5
    if direction == "BUY":
        return "confirms" if high else "weak_confirms"
    if direction == "SELL":
        return "confirms" if high else "weak_confirms"
    return "inconclusive"


def compute(analysis: Dict[str, Any], primary_timeframe: Optional[str] = None
            ) -> Dict[str, Any]:
    indicators = analysis.get("indicators") or {}
    direction = str(analysis.get("direction") or "NEUTRAL").upper()
    rvol = indicators.get("relative_volume")
    vwap = indicators.get("vwap")
    obv = indicators.get("obv")
    adr = (analysis.get("market_context") or {}).get("adr")

    # Some analyzers expose adr_percent_used at the top level too.
    adr_percent = analysis.get("adr_percent_used")
    if adr_percent is None and isinstance(adr, (int, float)):
        adr_percent = float(adr)
    adr_percent_f = _safe_float(adr_percent)

    return {
        "available": True,
        "kind": "measured",
        "timeframe": (primary_timeframe or "1h").upper(),
        "relative_volume": _safe_float(rvol),
        "vwap": _safe_float(vwap),
        "obv": _safe_float(obv),
        "regime": _regime(_safe_float(rvol) if rvol is not None else None),
        "consensus": _consensus(_safe_float(rvol) if rvol is not None else None,
                                direction, adr_percent_f),
        "current_price_above_vwap": (
            _safe_float(vwap) > 0
            and _safe_float(analysis.get("current_price"), 0.0) > _safe_float(vwap)
        ),
        "notes": (
            "Relative volume compares the latest bar to its trailing 20-bar "
            "average. Values >=1.5 are typically labeled 'high' and tend to "
            "confirm breakouts; values <0.8 are unreliable."
        ),
    }