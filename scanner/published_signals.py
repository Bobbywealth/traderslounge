"""Build durable, user-facing signal calls from guarded V2 trade plans."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Optional


ACTIONABLE_STATUSES = {"STRONG", "VALID"}


def build_published_signal(analysis: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Return a normalized signal call only when every V2 gate passed."""
    plan = analysis.get("trade_plan") or {}
    direction = str(analysis.get("direction") or "NEUTRAL").upper()
    status = str(plan.get("status") or "WAIT").upper()
    if not plan.get("eligible") or status not in ACTIONABLE_STATUSES:
        return None
    if direction not in {"BUY", "SELL"}:
        return None

    entry = _number(plan.get("entry"))
    stop = _number(plan.get("stop"))
    tp1 = _number(plan.get("tp1"))
    tp2 = _number(plan.get("tp2"))
    tp3 = _number(plan.get("tp3"))
    if None in (entry, stop, tp1):
        return None
    if direction == "BUY" and not (stop < entry < tp1):
        return None
    if direction == "SELL" and not (stop > entry > tp1):
        return None

    quality = analysis.get("data_quality") or {}
    timeframe = str(quality.get("primary_timeframe") or "1h")
    candle_time = quality.get("closed_bar_time")
    pair = str(analysis.get("pair") or "").upper()
    if not pair:
        return None

    categories = analysis.get("category_breakdown") or {}
    strongest = sorted(
        ((str(name).replace("_", " ").title(), _number(value) or 0.0) for name, value in categories.items()),
        key=lambda item: item[1],
        reverse=True,
    )[:3]
    rationale = [name for name, value in strongest if value > 0]
    scenario = str((analysis.get("scenarios") or {}).get("primary") or "Guarded V2 setup")
    fingerprint_raw = json.dumps(
        [pair, timeframe, candle_time, direction, round(entry, 8), round(stop, 8)],
        separators=(",", ":"),
    )
    fingerprint = hashlib.sha256(fingerprint_raw.encode()).hexdigest()

    return {
        "fingerprint": fingerprint,
        "pair": pair,
        "direction": direction,
        "timeframe": timeframe,
        "score": int(analysis.get("total_score") or 0),
        "setup_quality": status,
        "entry": entry,
        "stop_loss": stop,
        "tp1": tp1,
        "tp2": tp2,
        "tp3": tp3,
        "net_rr": _number(plan.get("net_available_rr") or plan.get("net_rr")),
        "risk_percent": _number(plan.get("account_risk_percent")),
        "calendar_status": str(plan.get("calendar_status") or (analysis.get("economic_calendar") or {}).get("status") or "UNAVAILABLE"),
        "scenario": scenario,
        "rationale": rationale,
        "source_candle_time": candle_time,
        "engine_version": str(analysis.get("version") or "V2"),
        "status": "ACTIVE",
        "published_at": datetime.now(timezone.utc),
    }


def _number(value: Any) -> Optional[float]:
    try:
        number = float(value)
        return number if number == number else None
    except (TypeError, ValueError):
        return None
