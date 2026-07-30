"""Institutional Intelligence V2 orchestration.

This layer combines explainable confidence, specialist consensus, debate,
historical similarity, and grading. It is report-only and preserves canonical
execution and risk controls.
"""
from __future__ import annotations

from typing import Any, Iterable, Mapping

from .historical_similarity import find_similar_setups
from .institutional_confidence import build_institutional_confidence
from .intelligence_consensus import build_agent_consensus, build_debate
from .trade_grading import build_trade_grade


def build_institutional_intelligence(
    analysis: Mapping[str, Any],
    calendar: Mapping[str, Any] | None = None,
    history: Iterable[Mapping[str, Any]] = (),
) -> dict[str, Any]:
    confidence = build_institutional_confidence(analysis, calendar)
    consensus = build_agent_consensus(analysis, calendar)
    similarity = find_similar_setups(analysis, history)
    debate = build_debate(consensus)
    grade = build_trade_grade(analysis, confidence, consensus, similarity)

    return {
        "version": "2.0.0",
        "institutional_confidence": confidence,
        "multi_agent_consensus": consensus,
        "ai_debate": debate,
        "historical_similarity": similarity,
        "trade_grade": grade,
        "execution_authority": "CANONICAL_TRADE_GATES_ONLY",
        "position_sizing_uses_consensus": False,
        "position_sizing_uses_similarity": False,
        "position_sizing_uses_grade": False,
        "disclaimer": "Intelligence V2 is decision support. It cannot override canonical eligibility, risk caps, kill switches, or calendar blocks.",
    }


def attach_institutional_intelligence(
    analysis: Mapping[str, Any],
    calendar: Mapping[str, Any] | None = None,
    history: Iterable[Mapping[str, Any]] = (),
) -> dict[str, Any]:
    result = dict(analysis or {})
    result["institutional_intelligence_v2"] = build_institutional_intelligence(result, calendar, history)
    return result
