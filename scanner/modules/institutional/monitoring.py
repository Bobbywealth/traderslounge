"""Section 20 (Monitoring Plan) — Phase 1.

Consolidates alert conditions for the user:

  - Invalidation level         — the canonical trade plan's stop loss.
  - HTF conflict alert         — when the MTF structure composite is
                                 'conflict' or any TF opposes the
                                 dominant direction.
  - Calendar alert             — surfaces BLOCKED / CAUTION state with a
                                 hard-risk note.
  - Volume confirmation        — required bar volume to confirm a break.
  - Volatility regime watch    — compressed→expansion transition flag.
  - Risk-rating watch          — when the 1–10 risk rating crosses an
                                 elevated threshold.
  - MACD / RSI divergence      — when an institutional module's
                                 divergence hint flips on.

Report-only — never feeds the BWTS score. Each alert includes the
``completed`` flag the renderer can use to flip state visually.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        f = float(value)
        return f if f == f else default
    except (TypeError, ValueError):
        return default


def _volume_threshold(snapshot: Any, primary_tf: str = "M15") -> float:
    candles = {
        "D1": snapshot.d1,
        "H4": snapshot.h4,
        "H1": snapshot.h1,
        "M15": snapshot.m15,
        "M5": snapshot.m5,
    }.get(primary_tf.upper()) or []
    if len(candles) < 20:
        return 0.0
    vols = [c.volume for c in candles[-20:] if c.volume > 0]
    if not vols:
        return 0.0
    avg = sum(vols) / len(vols)
    return avg * 1.5


def compute(
    analysis: Dict[str, Any],
    snapshot: Any,
    sections: Dict[str, Any],
    *,
    calendar_state: Optional[str] = None,
) -> Dict[str, Any]:
    alerts: List[Dict[str, Any]] = []

    # 1. Invalidation level.
    plan = analysis.get("trade_plan") or {}
    stop = _safe_float(plan.get("stop"), 0.0)
    entry = _safe_float(plan.get("entry"), 0.0)
    if stop > 0 and entry > 0:
        completed = (entry > stop and _safe_float(analysis.get("current_price"), entry) <= stop) or (
            entry < stop and _safe_float(analysis.get("current_price"), entry) >= stop
        )
        alerts.append({
            "name": "trade_invalidation",
            "category": "price",
            "level": stop,
            "completed": bool(completed),
            "human_readable": f"Trade invalidated if price {'falls below' if entry > stop else 'rises above'} {stop}",
        })

    # 2. HTF conflict alert.
    mtf = (sections.get("market_structure_mtf") or {})
    composite = (mtf.get("composite") or {}) if mtf.get("available") else {}
    conflicting = composite.get("conflicting_tfs") or []
    if conflicting:
        alerts.append({
            "name": "htf_conflict",
            "category": "structure",
            "conflicting_tfs": conflicting,
            "completed": False,
            "human_readable": f"Multi-timeframe conflict on {', '.join(conflicting)} — wait for confirmation",
        })

    # 3. Calendar alert.
    state = (calendar_state or "CLEAR").upper()
    if state in ("CAUTION", "BLOCKED"):
        alerts.append({
            "name": "calendar_state",
            "category": "macro",
            "state": state,
            "completed": state == "BLOCKED",
            "human_readable": (
                "Economic calendar BLOCKED — avoid new positions"
                if state == "BLOCKED"
                else "Economic calendar CAUTION — reduce size and widen stops"
            ),
        })

    # 4. Volume confirmation threshold.
    vol_threshold = _volume_threshold(snapshot)
    if vol_threshold > 0:
        alerts.append({
            "name": "volume_confirmation",
            "category": "volume",
            "threshold": round(vol_threshold, 2),
            "completed": False,
            "human_readable": (
                f"Confirm break only on bar volume > {vol_threshold:.0f} "
                "(1.5× trailing 20-bar average)"
            ),
        })

    # 5. Volatility regime watch.
    hv = sections.get("historical_volatility") or {}
    if hv.get("available"):
        alerts.append({
            "name": "vol_regime_watch",
            "category": "volatility",
            "regime": hv.get("regime"),
            "current_hv": hv.get("current_hv_annualized"),
            "completed": hv.get("regime") == "expanded",
            "human_readable": (
                f"Vol regime: {hv.get('regime')} "
                f"(annualized HV {hv.get('current_hv_annualized')})"
            ),
        })

    # 6. Risk-rating watch.
    rr = sections.get("risk_rating") or {}
    if rr.get("available") and rr.get("rating", 0) >= 8:
        alerts.append({
            "name": "risk_rating_elevated",
            "category": "risk",
            "rating": rr.get("rating"),
            "completed": True,
            "human_readable": (
                f"Risk rating {rr.get('rating')}/10 ({rr.get('label')}) — "
                "reduce size or stand down"
            ),
        })

    # 7. MACD / RSI divergence flips.
    macd = sections.get("macd_interpret") or {}
    if macd.get("available"):
        hint = macd.get("divergence_hint") or {}
        if hint.get("bull_div_hint") or hint.get("bear_div_hint"):
            alerts.append({
                "name": "macd_divergence_hint",
                "category": "momentum",
                "bull_div_hint": hint.get("bull_div_hint"),
                "bear_div_hint": hint.get("bear_div_hint"),
                "completed": bool(hint.get("bull_div_hint") or hint.get("bear_div_hint")),
                "human_readable": (
                    "MACD histogram divergence hint — confirm with structure"
                ),
            })

    hd = sections.get("hidden_divergence") or {}
    if hd.get("available") and hd.get("direction") != "neutral":
        alerts.append({
            "name": "hidden_divergence",
            "category": "momentum",
            "direction": hd.get("direction"),
            "completed": True,
            "human_readable": (
                f"RSI hidden divergence ({hd.get('direction')}) — "
                "supports trend continuation"
            ),
        })

    return {
        "available": True,
        "alerts": alerts,
        "count": len(alerts),
        "notes": (
            "Each alert carries a 'completed' flag the renderer can use "
            "to flip state visually. Alerts are consolidated from the "
            "institutional sections and never modify the canonical "
            "trade plan."
        ),
    }