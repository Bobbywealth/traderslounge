"""Institutional trade grading based on explicit quality and execution gates."""
from __future__ import annotations

from typing import Any, Mapping


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _number(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if result == result else default


def _grade(score: float) -> str:
    if score >= 93:
        return "A+"
    if score >= 87:
        return "A"
    if score >= 80:
        return "A-"
    if score >= 74:
        return "B+"
    if score >= 68:
        return "B"
    if score >= 62:
        return "B-"
    if score >= 55:
        return "C"
    if score >= 45:
        return "D"
    return "F"


def build_trade_grade(
    analysis: Mapping[str, Any],
    confidence: Mapping[str, Any],
    consensus: Mapping[str, Any],
    similarity: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Return an advisory grade without changing execution eligibility."""
    similarity = _mapping(similarity)
    plan = _mapping(analysis.get("trade_plan"))
    timing = _mapping(analysis.get("trade_timing"))
    provenance = _mapping(confidence.get("data_provenance"))

    evidence_score = _number(confidence.get("score"))
    agreement = _number(consensus.get("agreement_pct"))
    rr = _number(plan.get("net_rr", plan.get("net_available_rr")))
    rr_score = min(100.0, rr / 3.0 * 100.0) if rr > 0 else 0.0
    data_score = _number(provenance.get("coverage_pct"))
    similarity_score = _number(similarity.get("reliability_score"), 50.0) if similarity else 50.0

    weighted = (
        evidence_score * 0.30
        + agreement * 0.25
        + rr_score * 0.20
        + data_score * 0.15
        + similarity_score * 0.10
    )

    deductions: list[dict[str, Any]] = []
    if not plan.get("eligible"):
        deductions.append({"points": 25.0, "reason": "Canonical trade plan is not eligible."})
    timing_status = str(timing.get("status") or "WAIT").upper()
    if timing_status != "READY":
        deductions.append({"points": 10.0, "reason": f"Execution timing is {timing_status}."})
    if consensus.get("status") == "BLOCKED":
        deductions.append({"points": 20.0, "reason": "A veto agent blocked the setup."})
    if rr < 2.0:
        deductions.append({"points": 15.0, "reason": "Post-cost reward-to-risk is below 2R."})
    if data_score < 60.0:
        deductions.append({"points": 10.0, "reason": "Data coverage is below 60%."})

    final_score = max(0.0, min(100.0, weighted - sum(item["points"] for item in deductions)))
    grade = _grade(final_score)
    executable = bool(plan.get("eligible")) and timing_status == "READY" and consensus.get("status") != "BLOCKED"

    return {
        "grade": grade,
        "score": round(final_score, 1),
        "executable": executable,
        "grade_is_execution_authority": False,
        "inputs": {
            "institutional_confidence": round(evidence_score, 1),
            "agent_agreement": round(agreement, 1),
            "post_cost_rr_score": round(rr_score, 1),
            "data_coverage": round(data_score, 1),
            "historical_similarity_reliability": round(similarity_score, 1),
        },
        "deductions": deductions,
        "interpretation": "A+ is exceptional evidence alignment; B is tradable only when canonical gates pass; C or lower requires additional confirmation.",
    }
