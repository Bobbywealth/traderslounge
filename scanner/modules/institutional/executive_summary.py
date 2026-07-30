"""Section 21 (Executive Summary) — Phase 1.

Produces a deterministic, plain-English summary from the canonical
analysis dict + the institutional sections. Never calls a language
model; the renderer can later hand the structured fields to MiniMax
for cosmetic rephrasing if desired, but the underlying numbers come
from this module only.

Output fields:
  - bias               — bullish / bearish / neutral
  - conviction_pct     — 10..95 (rule-based, not statistically calibrated)
  - best_rr            — best risk-to-reward across the three plans
  - horizon            — day / swing / position (selected by RR + structure)
  - key_levels         — 3–5 nearest S/R, fib, ADR boundaries
  - invalidation       — the canonical trade plan's stop loss
  - thesis_text        — templated plain-English paragraph
  - schema_disclaimer  — explicit note that MiniMax did not generate this

Report-only — never feeds the BWTS score.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        f = float(value)
        return f if f == f else default
    except (TypeError, ValueError):
        return default


def _bias(analysis: Dict[str, Any]) -> str:
    d = str(analysis.get("direction") or "NEUTRAL").upper()
    return d if d in ("BUY", "SELL", "NEUTRAL") else "NEUTRAL"


def _conviction(analysis: Dict[str, Any], sections: Dict[str, Any],
                calendar_state: Optional[str]) -> int:
    score = _safe_float(analysis.get("total_score"), 50.0)
    # Score contributes up to +30 (mapped from 50..80 to 0..30).
    score_part = max(0.0, min(30.0, (score - 50.0) * 1.0))
    base = 35.0

    mtf = sections.get("market_structure_mtf") or {}
    composite = ((mtf.get("composite") or {}) if mtf.get("available") else {})
    trend = composite.get("trend")
    bias = _bias(analysis)
    aligned = (trend in ("bullish", "lean_bullish") and bias == "BUY") or (
        trend in ("bearish", "lean_bearish") and bias == "SELL"
    )
    if aligned:
        base += 10.0
    elif trend == "conflict":
        base -= 10.0

    hv = sections.get("historical_volatility") or {}
    if hv.get("regime") == "expanded":
        base -= 5.0
    elif hv.get("regime") == "compressed":
        base += 3.0

    cal = (calendar_state or "CLEAR").upper()
    if cal == "BLOCKED":
        base -= 15.0
    elif cal == "CAUTION":
        base -= 5.0

    total = base + score_part
    return int(max(10, min(95, round(total))))


def _best_rr(sections: Dict[str, Any]) -> float:
    plans = ((sections.get("trade_plans") or {}).get("plans") or {})
    best = 0.0
    for name, plan in plans.items():
        if not plan.get("eligible"):
            continue
        for key in ("rr_tp1", "rr_tp2"):
            r = plan.get(key)
            if isinstance(r, (int, float)) and r > best:
                best = float(r)
    return round(best, 2)


def _horizon(sections: Dict[str, Any], conviction: int) -> str:
    plans = ((sections.get("trade_plans") or {}).get("plans") or {})
    # Prefer the variant whose best RR is highest.
    best_name = None
    best_rr = 0.0
    for name, plan in plans.items():
        if not plan.get("eligible"):
            continue
        r = max(filter(lambda x: isinstance(x, (int, float)),
                       [plan.get("rr_tp1") or 0, plan.get("rr_tp2") or 0]),
               default=0)
        if r > best_rr:
            best_rr = r
            best_name = name
    if best_name == "day" and conviction < 60:
        return "day"
    if best_name == "position" and conviction >= 75:
        return "position"
    return "swing"


def _key_levels(analysis: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []

    sr = (analysis.get("setup_zones") or {}).get("support_resistance") or {}
    for name, key in (("support", "support"), ("resistance", "resistance")):
        v = _safe_float(sr.get(key), 0.0)
        if v > 0:
            out.append({"label": name, "price": round(v, 6), "source": "support_resistance"})

    fib = (analysis.get("indicators") or {}).get("fibonacci") or {}
    levels = fib.get("levels") if isinstance(fib, dict) else None
    for k in ("0.618", "1.0", "1.272", "1.618"):
        v = _safe_float((levels or {}).get(k), 0.0)
        if v > 0:
            out.append({"label": f"fib_{k}", "price": round(v, 6), "source": "fibonacci"})

    # Deduplicate by price proximity (within 0.1%).
    deduped: List[Dict[str, Any]] = []
    for lvl in out:
        if any(abs(lvl["price"] - d["price"]) / max(abs(d["price"]), 1e-9) < 0.001 for d in deduped):
            continue
        deduped.append(lvl)
    # Keep 3–5 nearest to current price.
    current = _safe_float(analysis.get("current_price"), 0.0)
    if current > 0:
        deduped.sort(key=lambda x: abs(x["price"] - current))
    return deduped[:5]


def _invalidation(analysis: Dict[str, Any]) -> float:
    plan = analysis.get("trade_plan") or {}
    s = _safe_float(plan.get("stop"), 0.0)
    return s


def _thesis(analysis: Dict[str, Any], sections: Dict[str, Any],
            conviction: int, horizon: str, best_rr: float,
            invalidation: float) -> str:
    bias = _bias(analysis)
    direction_word = {
        "BUY": "bullish",
        "SELL": "bearish",
        "NEUTRAL": "range-bound",
    }.get(bias, "range-bound")

    score = _safe_float(analysis.get("total_score"), 0.0)
    pair = str(analysis.get("pair") or "this asset")
    tf = ((analysis.get("data_quality") or {}).get("primary_timeframe") or "1h")
    plan = analysis.get("trade_plan") or {}
    entry = _safe_float(plan.get("entry"), 0.0)
    tp1 = _safe_float(plan.get("tp1"), 0.0)

    mtf = sections.get("market_structure_mtf") or {}
    composite = ((mtf.get("composite") or {}) if mtf.get("available") else {})
    structure_word = composite.get("trend", "neutral").replace("_", " ")

    sent = [
        f"{pair} on {tf} is currently {direction_word} with a BWTS score of {score:.0f}/100 "
        f"and {conviction}% rule-based conviction.",
    ]
    if composite.get("available"):
        sent.append(
            f"Multi-timeframe structure is {structure_word} "
            f"({composite.get('summary', '')})."
        )
    if entry > 0 and tp1 > 0 and invalidation > 0:
        sent.append(
            f"A {horizon} setup is offered at {entry:.2f} with first target {tp1:.2f} "
            f"(best R:R {best_rr:.2f}) and invalidation {invalidation:.2f}."
        )
    if not sent:
        sent.append("Insufficient data to build a directional thesis right now.")
    return " ".join(sent)


def compute(
    analysis: Dict[str, Any],
    snapshot: Any,
    sections: Dict[str, Any],
    *,
    calendar_state: Optional[str] = None,
) -> Dict[str, Any]:
    bias = _bias(analysis)
    conviction = _conviction(analysis, sections, calendar_state)
    best_rr = _best_rr(sections)
    horizon = _horizon(sections, conviction)
    key_levels = _key_levels(analysis)
    invalidation = _invalidation(analysis)
    thesis = _thesis(analysis, sections, conviction, horizon, best_rr, invalidation)

    return {
        "available": True,
        "bias": bias.lower(),
        "conviction_pct": conviction,
        "best_rr": best_rr,
        "horizon": horizon,
        "key_levels": key_levels,
        "invalidation": round(invalidation, 6) if invalidation > 0 else None,
        "thesis_text": thesis,
        "schema_disclaimer": (
            "Generated deterministically from the canonical analysis "
            "and institutional sections. No language model was used to "
            "produce these numbers."
        ),
        "notes": (
            "Renderer may pass the structured fields to a model for "
            "cosmetic rephrasing, but the values themselves must come "
            "from this module only."
        ),
    }