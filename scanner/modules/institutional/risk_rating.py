"""Section 19 (1–10 Risk Rating) — Phase 1.

A composite risk score derived from:

  - HTF disagreement          (0..3) — conflicting timeframes raise risk
  - Volatility regime         (0..2) — compressed=+0, normal=+0.5, expanded=+2
  - Calendar state           (0..3) — CLEAR=+0, CAUTION=+1, BLOCKED=+3
  - BWTS score band          (0..3) — <50=+3, 50–65=+2, 65–75=+1, 75+=+0
  - Data freshness           (0..1) — stale (>5 min) closed candle=+1

Raw sum range: [0, 12]. Mapped to a 1–10 scale where 1 = lowest risk and
10 = highest. The mapping is linear: rating = clamp(1 + raw * 9 / 12, 1, 10).

Report-only — never feeds the BWTS score or Signals gate. Display
should always show the contributing components so users can see *why*
the rating is where it is, not just the number.
"""
from __future__ import annotations

import time
from typing import Any, Dict, Optional


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        f = float(value)
        return f if f == f else default
    except (TypeError, ValueError):
        return default


def _htf_component(sections: Dict[str, Any]) -> float:
    mtf = (sections or {}).get("market_structure_mtf") or {}
    composite = (mtf.get("composite") or {}) if mtf.get("available") else {}
    conflicting = composite.get("conflicting_tfs") or []
    return min(3.0, float(len(conflicting)))


def _vol_component(sections: Dict[str, Any]) -> float:
    hv = (sections or {}).get("historical_volatility") or {}
    if not hv.get("available"):
        return 0.0
    regime = hv.get("regime")
    return {"compressed": 0.0, "normal": 0.5, "expanded": 2.0}.get(regime, 0.5)


def _calendar_component(calendar_state: Optional[str]) -> float:
    state = (calendar_state or "CLEAR").upper()
    return {"CLEAR": 0.0, "CAUTION": 1.0, "BLOCKED": 3.0}.get(state, 0.0)


def _score_component(score: float) -> float:
    if score < 50:
        return 3.0
    if score < 65:
        return 2.0
    if score < 75:
        return 1.0
    return 0.0


def _freshness_component(analysis: Dict[str, Any]) -> float:
    dq = (analysis.get("data_quality") or {})
    closed_at = dq.get("closed_bar_time")
    if not isinstance(closed_at, (int, float)):
        return 0.0
    age = max(0.0, float(time.time()) - float(closed_at))
    return 1.0 if age > 300 else 0.0  # 5 min


def compute(
    analysis: Dict[str, Any],
    snapshot: Any,
    sections: Dict[str, Any],
    *,
    calendar_state: Optional[str] = None,
) -> Dict[str, Any]:
    score = _safe_float(analysis.get("total_score"), 50.0)

    components = {
        "htf_disagreement": _htf_component(sections),
        "vol_regime": _vol_component(sections),
        "calendar": _calendar_component(calendar_state),
        "bwts_score_band": _score_component(score),
        "freshness": _freshness_component(analysis),
    }
    raw = sum(components.values())
    # Map raw in [0, 12] to rating in [1, 10].
    rating = max(1, min(10, round(1.0 + (raw * 9.0) / 12.0)))

    # Human label.
    if rating <= 3:
        label = "low"
    elif rating <= 6:
        label = "moderate"
    elif rating <= 8:
        label = "elevated"
    else:
        label = "high"

    return {
        "available": True,
        "rating": rating,
        "label": label,
        "raw_score": round(raw, 2),
        "components": {k: round(v, 2) for k, v in components.items()},
        "scale": "1 = lowest risk, 10 = highest risk",
        "notes": (
            "Components sum to a raw score in [0, 12] mapped linearly to "
            "a 1–10 rating. Higher component values mean higher risk; "
            "the calendar component is a hard risk control rather than a "
            "score input."
        ),
    }