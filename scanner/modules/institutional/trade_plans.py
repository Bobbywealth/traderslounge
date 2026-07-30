"""Section 18 (Day / Swing / Position plans) — Phase 1.

Produces three trade-plan variants from the same analysis dict:

  - Day:     tight ATR-based stop, ADR-based targets, intended for
             intraday execution.
  - Swing:   wider ATR-based stop, Fibonacci-extension targets, the
             same horizon the canonical Signals feed already publishes.
  - Position: widest ATR-based stop, deep Fibonacci-extension targets,
              intended for multi-week holding.

Each plan reuses the entry from the canonical analysis. None of these
plans contribute to the BWTS score, replace the canonical trade_plan,
or change Signals publication gating. The canonical plan remains the
only one eligible for publication; the day/position variants are
report-only.

The implementation does not call any private helpers from
crypto_analysis — it computes its own ATR per timeframe to keep the
plan generators self-contained and easy to test.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from scanner.data_types import Candle, MarketSnapshot
from scanner.indicators import atr


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        f = float(value)
        return f if f == f else default
    except (TypeError, ValueError):
        return default


def _direction(analysis: Dict[str, Any]) -> str:
    d = str(analysis.get("direction") or "NEUTRAL").upper()
    return d if d in ("BUY", "SELL") else "NEUTRAL"


def _entry(analysis: Dict[str, Any], snapshot: Any = None) -> float:
    plan = analysis.get("trade_plan") or {}
    e = _safe_float(plan.get("entry"), 0.0)
    if e <= 0:
        e = _safe_float(analysis.get("current_price"), 0.0)
    if e <= 0 and snapshot is not None:
        ltf = getattr(snapshot, "ltf", lambda: [])()
        if ltf:
            e = _safe_float(getattr(ltf[-1], "close", 0.0), 0.0)
    return e


def _entry_source(analysis: Dict[str, Any], snapshot: Any = None) -> str:
    plan = analysis.get("trade_plan") or {}
    if _safe_float(plan.get("entry"), 0.0) > 0:
        return "canonical_plan"
    if _safe_float(analysis.get("current_price"), 0.0) > 0:
        return "current_price"
    if snapshot is not None:
        ltf = getattr(snapshot, "ltf", lambda: [])()
        if ltf and _safe_float(getattr(ltf[-1], "close", 0.0), 0.0) > 0:
            return "snapshot_last_close"
    return "unavailable"


def _tf_candles(snapshot: MarketSnapshot, tf: str) -> List[Candle]:
    return {
        "D1": snapshot.d1,
        "H4": snapshot.h4,
        "H1": snapshot.h1,
        "M15": snapshot.m15,
        "M5": snapshot.m5,
    }.get(tf, []) or []


def _fib_level(analysis: Dict[str, Any], key: str, fallback_mult: float) -> float:
    fib = (analysis.get("indicators") or {}).get("fibonacci") or {}
    levels = fib.get("levels") if isinstance(fib, dict) else None
    v = _safe_float((levels or {}).get(key), 0.0)
    if v > 0:
        return v
    entry = _entry(analysis)
    direction = _direction(analysis)
    if entry <= 0:
        return 0.0
    sign = 1.0 if direction == "BUY" else -1.0
    return entry * (1.0 + sign * fallback_mult)


def _build_variant(
    name: str,
    direction: str,
    entry: float,
    stop: float,
    tp1: float,
    tp2: float,
    *,
    eligible: bool,
    reason: str,
    horizon_label: str,
) -> Dict[str, Any]:
    if direction == "NEUTRAL" or entry <= 0 or stop <= 0 or tp1 <= 0:
        return {
            "available": True,
            "name": name,
            "horizon": horizon_label,
            "direction": direction or "NEUTRAL",
            "eligible": False,
            "reason": reason or "no_direction",
        }
    # Order-invariant safety: stop on correct side of entry, tps beyond.
    if direction == "BUY":
        if not (stop < entry < tp1):
            return {
                "available": True,
                "name": name,
                "horizon": horizon_label,
                "direction": direction,
                "eligible": False,
                "reason": "invalid_order",
            }
        rr1 = (tp1 - entry) / max(entry - stop, 1e-9)
        rr2 = (tp2 - entry) / max(entry - stop, 1e-9) if tp2 > tp1 else None
    else:
        if not (stop > entry > tp1):
            return {
                "available": True,
                "name": name,
                "horizon": horizon_label,
                "direction": direction,
                "eligible": False,
                "reason": "invalid_order",
            }
        rr1 = (entry - tp1) / max(stop - entry, 1e-9)
        rr2 = (entry - tp2) / max(stop - entry, 1e-9) if tp2 < tp1 else None

    return {
        "available": True,
        "name": name,
        "horizon": horizon_label,
        "direction": direction,
        "eligible": eligible,
        "reason": reason,
        "entry": round(entry, 6),
        "stop": round(stop, 6),
        "tp1": round(tp1, 6),
        "tp2": round(tp2, 6) if tp2 > 0 else None,
        "rr_tp1": round(rr1, 2),
        "rr_tp2": round(rr2, 2) if rr2 is not None else None,
    }


def compute(
    analysis: Dict[str, Any],
    snapshot: MarketSnapshot,
) -> Dict[str, Any]:
    direction = _direction(analysis)
    entry = _entry(analysis, snapshot)
    entry_source = _entry_source(analysis, snapshot)
    if entry <= 0:
        return {
            "available": False,
            "reason": "missing_entry",
            "plans": {},
        }

    # Per-TF ATR — small, stdlib-only computation.
    atr_m15 = atr(_tf_candles(snapshot, "M15"), 14) or 0.0
    atr_h4 = atr(_tf_candles(snapshot, "H4"), 14) or 0.0
    atr_d1 = atr(_tf_candles(snapshot, "D1"), 14) or 0.0

    fib_1272 = _fib_level(analysis, "1.272", 0.02)
    fib_1618 = _fib_level(analysis, "1.618", 0.04)
    fib_2618 = _fib_level(analysis, "2.618", 0.06)

    plans: Dict[str, Any] = {}

    # Day — M15 ATR, ADR-based targets.
    if atr_m15 > 0:
        sign = 1.0 if direction == "BUY" else -1.0
        day_stop = entry - sign * atr_m15 * 1.0
        day_tp1 = entry + sign * atr_m15 * 2.0  # 2R from entry
        day_tp2 = entry + sign * atr_m15 * 3.0
        plans["day"] = _build_variant(
            "day", direction, entry, day_stop, day_tp1, day_tp2,
            eligible=direction != "NEUTRAL",
            reason="m15_atr_based",
            horizon_label="intraday",
        )
    else:
        plans["day"] = _build_variant(
            "day", direction, entry, 0.0, 0.0, 0.0,
            eligible=False,
            reason="missing_m15_atr",
            horizon_label="intraday",
        )

    # Swing — H4 ATR + fib extensions.
    if atr_h4 > 0 and fib_1272 > 0:
        sign = 1.0 if direction == "BUY" else -1.0
        swing_stop = entry - sign * atr_h4 * 1.5
        plans["swing"] = _build_variant(
            "swing", direction, entry, swing_stop, fib_1272, fib_1618,
            eligible=direction != "NEUTRAL",
            reason="h4_atr_plus_fib",
            horizon_label="days_to_weeks",
        )
    else:
        plans["swing"] = _build_variant(
            "swing", direction, entry, 0.0, 0.0, 0.0,
            eligible=False,
            reason="missing_h4_atr_or_fib",
            horizon_label="days_to_weeks",
        )

    # Position — D1 ATR + deep fib.
    if atr_d1 > 0 and fib_1618 > 0:
        sign = 1.0 if direction == "BUY" else -1.0
        pos_stop = entry - sign * atr_d1 * 2.0
        plans["position"] = _build_variant(
            "position", direction, entry, pos_stop, fib_1618, fib_2618,
            eligible=direction != "NEUTRAL" and fib_2618 > 0,
            reason="d1_atr_plus_fib",
            horizon_label="weeks_to_months",
        )
    else:
        plans["position"] = _build_variant(
            "position", direction, entry, 0.0, 0.0, 0.0,
            eligible=False,
            reason="missing_d1_atr_or_fib",
            horizon_label="weeks_to_months",
        )

    return {
        "available": True,
        "entry_source": entry_source,
        "eligible_for_publication": entry_source == "canonical_plan",
        "plans": plans,
        "canonical_horizon": "swing",
        "notes": (
            "Only the canonical swing plan participates in Signals "
            "publication. Day and position variants are report-only. "
            "When entry_source != 'canonical_plan', the plan is a "
            "reference sketch at current price — not eligible."
        ),
    }