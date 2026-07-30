"""Deterministic multi-agent consensus and bull/bear debate outputs.

The agents are explainable rule-based evaluators. Their consensus is advisory and
cannot override canonical trade gates, direction, or risk limits.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Mapping


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _number(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if result == result else default


def _direction(value: Any) -> str:
    value = str(value or "NEUTRAL").upper()
    return value if value in {"BUY", "SELL", "NEUTRAL"} else "NEUTRAL"


@dataclass(frozen=True)
class AgentVote:
    agent: str
    label: str
    vote: str
    confidence: float
    reason: str
    evidence: tuple[str, ...] = ()
    available: bool = True

    def as_dict(self) -> dict[str, Any]:
        return {
            "agent": self.agent,
            "label": self.label,
            "vote": _direction(self.vote),
            "confidence": round(max(0.0, min(100.0, self.confidence)), 1),
            "reason": self.reason,
            "evidence": list(self.evidence),
            "available": self.available,
        }


def _structure(analysis: Mapping[str, Any]) -> AgentVote:
    direction = _direction(analysis.get("direction"))
    context = _mapping(analysis.get("market_context"))
    opposing = tuple(map(str, context.get("opposing_frames") or ()))
    confidence = 78.0 if direction != "NEUTRAL" and not opposing else 55.0 if direction != "NEUTRAL" else 20.0
    return AgentVote("structure", "Market Structure", direction, confidence, "Evaluates canonical trend and multi-timeframe alignment.", opposing or ("No opposing timeframe was reported.",), bool(context) or direction != "NEUTRAL")


def _momentum(analysis: Mapping[str, Any]) -> AgentVote:
    indicators = _mapping(analysis.get("indicators"))
    rsi = _number(indicators.get("rsi"), 50.0)
    macd = _number(indicators.get("macd_histogram", indicators.get("macd")), 0.0)
    vote = "BUY" if rsi >= 55 and macd >= 0 else "SELL" if rsi <= 45 and macd <= 0 else "NEUTRAL"
    confidence = min(85.0, 45.0 + abs(rsi - 50.0) + min(20.0, abs(macd) * 10.0)) if indicators else 0.0
    return AgentVote("momentum", "Momentum", vote, confidence, "Evaluates RSI and MACD agreement.", (f"RSI={rsi:.2f}", f"MACD={macd:.4f}"), bool(indicators))


def _liquidity(analysis: Mapping[str, Any]) -> AgentVote:
    liquidity = _mapping(analysis.get("liquidity"))
    direction = _direction(liquidity.get("direction") or liquidity.get("bias"))
    if direction == "NEUTRAL":
        direction = _direction(analysis.get("direction")) if liquidity else "NEUTRAL"
    provider = bool(liquidity.get("provider_backed"))
    confidence = 82.0 if provider and direction != "NEUTRAL" else 58.0 if liquidity and direction != "NEUTRAL" else 0.0
    return AgentVote("liquidity", "Liquidity", direction, confidence, "Evaluates liquidity pools, sweeps, and inferred delivery targets.", ("Provider-backed" if provider else "Rule-based liquidity map",), bool(liquidity))


def _macro(analysis: Mapping[str, Any], calendar: Mapping[str, Any]) -> AgentVote:
    status = str(calendar.get("status") or "UNAVAILABLE").upper()
    canonical = _direction(analysis.get("direction"))
    if status in {"BLOCKED", "POST_NEWS"}:
        return AgentVote("macro", "Macro", "NEUTRAL", 95.0, f"Execution is blocked by calendar status {status}.", (status,), True)
    confidence = 70.0 if status == "CLEAR" else 45.0 if status in {"CAUTION", "NEAR_EVENT"} else 0.0
    return AgentVote("macro", "Macro", canonical if status != "UNAVAILABLE" else "NEUTRAL", confidence, f"Evaluates economic-calendar compatibility: {status}.", (status,), bool(calendar))


def _risk(analysis: Mapping[str, Any]) -> AgentVote:
    plan = _mapping(analysis.get("trade_plan"))
    eligible = bool(plan.get("eligible"))
    rr = _number(plan.get("net_rr", plan.get("net_available_rr")), 0.0)
    vote = _direction(analysis.get("direction")) if eligible and rr >= 2.0 else "NEUTRAL"
    confidence = min(90.0, 50.0 + rr * 10.0) if eligible else 80.0 if plan else 0.0
    reason = "Risk gates and post-cost reward-to-risk are acceptable." if vote != "NEUTRAL" else "Risk agent withholds approval until eligibility and at least 2R post-cost reward-to-risk are present."
    return AgentVote("risk", "Risk", vote, confidence, reason, (f"eligible={eligible}", f"net_rr={rr:.2f}"), bool(plan))


def _timing(analysis: Mapping[str, Any]) -> AgentVote:
    timing = _mapping(analysis.get("trade_timing"))
    status = str(timing.get("status") or "WAIT").upper()
    vote = _direction(analysis.get("direction")) if status == "READY" else "NEUTRAL"
    confidence = 88.0 if status == "READY" else 75.0 if status in {"AVOID", "BLOCKED"} else 45.0
    return AgentVote("timing", "Execution Timing", vote, confidence, f"Execution status is {status}.", (status,), bool(timing))


def _pattern(analysis: Mapping[str, Any]) -> AgentVote:
    institutional = _mapping(analysis.get("institutional"))
    harmonics = _mapping(institutional.get("harmonics"))
    elliott = _mapping(institutional.get("elliott"))
    source = harmonics or elliott
    vote = _direction(source.get("direction") or source.get("bias"))
    confidence = _number(source.get("geometry_quality", source.get("confidence")), 45.0) if source else 0.0
    return AgentVote("pattern", "Pattern Geometry", vote, confidence, "Evaluates Elliott and harmonic candidates as unvalidated supporting evidence.", tuple(filter(None, (str(harmonics.get("name") or ""), str(elliott.get("wave") or "")))), bool(source))


def build_agent_consensus(analysis: Mapping[str, Any], calendar: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Return advisory votes, agreement, dissent, and veto reasons."""
    calendar = _mapping(calendar)
    agents: tuple[Callable[[], AgentVote], ...] = (
        lambda: _structure(analysis), lambda: _momentum(analysis), lambda: _liquidity(analysis),
        lambda: _macro(analysis, calendar), lambda: _risk(analysis), lambda: _timing(analysis), lambda: _pattern(analysis),
    )
    votes = [factory() for factory in agents]
    available = [vote for vote in votes if vote.available]
    weighted = {"BUY": 0.0, "SELL": 0.0, "NEUTRAL": 0.0}
    for vote in available:
        weighted[vote.vote] += vote.confidence
    directional_total = weighted["BUY"] + weighted["SELL"]
    winner = "NEUTRAL" if directional_total == 0 else ("BUY" if weighted["BUY"] >= weighted["SELL"] else "SELL")
    agreement = 0.0 if not available else sum(1 for vote in available if vote.vote == winner) / len(available) * 100.0
    vetoes = [vote.reason for vote in votes if vote.agent in {"macro", "risk", "timing"} and vote.vote == "NEUTRAL" and vote.confidence >= 70]
    canonical = _direction(analysis.get("direction"))
    status = "BLOCKED" if vetoes else "ALIGNED" if winner == canonical and agreement >= 60 else "CONTESTED" if winner != "NEUTRAL" else "INCONCLUSIVE"
    return {
        "consensus_direction": winner,
        "canonical_direction": canonical,
        "agreement_pct": round(agreement, 1),
        "status": status,
        "votes": [vote.as_dict() for vote in votes],
        "weighted_support": {key: round(value, 1) for key, value in weighted.items()},
        "dissenting_agents": [vote.agent for vote in available if vote.vote not in {winner, "NEUTRAL"}],
        "veto_reasons": vetoes,
        "advisory_only": True,
        "can_override_trade_gates": False,
    }


def build_debate(consensus: Mapping[str, Any]) -> dict[str, Any]:
    votes = consensus.get("votes") or []
    bull = [vote for vote in votes if vote.get("vote") == "BUY"]
    bear = [vote for vote in votes if vote.get("vote") == "SELL"]
    neutral = [vote for vote in votes if vote.get("vote") == "NEUTRAL"]
    return {
        "bull_case": [{"agent": vote["label"], "argument": vote["reason"], "confidence": vote["confidence"]} for vote in bull],
        "bear_case": [{"agent": vote["label"], "argument": vote["reason"], "confidence": vote["confidence"]} for vote in bear],
        "abstentions": [{"agent": vote["label"], "reason": vote["reason"]} for vote in neutral],
        "verdict": consensus.get("status"),
        "winning_direction": consensus.get("consensus_direction"),
        "note": "Debate output explains disagreement; it does not authorize execution.",
    }
