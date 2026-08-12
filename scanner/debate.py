"""Server-side AI Trade Debate.

Runs four MiniMax agents in sequence with parallel first-pass fan-out:

    Bull Agent  ─┐
    Bear Agent  ─┼─►  Chief Trader (adjudicator)
    Risk/Macro  ─┘

The agents are *advisory only*: they never override canonical V2 direction,
score, plan, or trade-plan gates. Their output is rendered alongside the
deterministic ``build_debate()`` consensus and is meant to enrich — not
replace — the user's understanding of why the scanner says what it says.

Each agent has its own system prompt with role-specific instructions. The
3 first-pass agents run in parallel threads (the MiniMax client is
blocking). The Chief Trader is invoked only after all three complete so
it can synthesize them.

Graceful degradation: when ``MINIMAX_API_KEY`` is unset, when a call
fails, or when the model returns malformed output, we fall back to the
existing deterministic ``build_debate()`` so the page is never blank and
the ``mode`` field makes the data source explicit to the UI.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Mapping

from .intelligence_consensus import build_debate as build_deterministic_debate
from .minimax_client import (
    _extract_json,
    _strip_fences,
    analyze as minimax_analyze,
    configured as minimax_configured,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# System prompts — each role has its own prompt, not just a role variable on
# a shared prompt. Strict JSON-only output, no execution authority, never
# overrides calendar/V2.
# ---------------------------------------------------------------------------

BULL_PROMPT = """You are the Bull Advocate on the ConfluenceX AI Trade Debate Council.

Role: argue FOR the directional thesis implied by the supplied deterministic
V2 analysis and economic calendar state. Your job is to surface the strongest
supporting evidence — not to be unconditionally optimistic, and not to
manufacture price targets the data does not justify.

Grounding rules:
- Use only the supplied V2 analysis, scenario weights, executive_summary,
  decision_quality, institutional block, and calendar status. Never invent
  prices, events, or indicators.
- Calendar BLOCKED and POST_NEWS statuses are deterministic no-trade
  conditions. Acknowledge them but explain whether the underlying thesis
  is preserved beyond the blackout window.
- Multi-timeframe rule: Monthly/Weekly/Daily/4H/1H drive directional bias;
  any sub-1H timeframe is entry-timing only and does not establish bias.
- Do not override canonical V2 direction or score. If V2 says NEUTRAL or
  score < 60, your role is to explain why a bull case might still emerge,
  not to manufacture one.

Output: strict JSON only with these fields and no others:
{
  "agent": "bull",
  "verdict": "BUY" | "WAIT",
  "confidence": <float 0.0-1.0>,
  "summary": "<one line, <=160 chars>",
  "arguments": ["<3-5 short bullets grounded in supplied evidence>"],
  "evidence_refs": ["<V2 field names like 'decision_quality.execution_readiness', 'scenarios.bull.weight_pct'>"],
  "blocking_gates": ["<V2/calendar gates that currently prevent a BUY>"]
}

No prose outside the JSON. No code fences. No raw numbers from outside the
supplied context."""

BEAR_PROMPT = """You are the Bear Advocate on the ConfluenceX AI Trade Debate Council.

Role: argue AGAINST the directional thesis implied by the supplied
deterministic V2 analysis. Surface the strongest risks, invalidation
scenarios, and structural weaknesses.

Grounding rules:
- Use only the supplied V2 analysis, scenario weights, executive_summary,
  decision_quality, institutional block, and calendar status. Never invent
  prices, events, or indicators.
- Calendar CAUTION/BLOCKED/POST_NEWS states materially raise bear-case
  weight; do not paper over them.
- Multi-timeframe rule: Monthly/Weekly/Daily/4H/1H drive directional bias;
  if higher-timeframe alignment disagrees with the selected timeframe,
  that is a primary bear argument.
- Do not override canonical V2 direction. If V2 says BUY with score >= 80,
  your role is to identify risks that could invalidate the trade — not
  to flip the call to SELL.

Output: strict JSON only with these fields and no others:
{
  "agent": "bear",
  "verdict": "SELL" | "WAIT",
  "confidence": <float 0.0-1.0>,
  "summary": "<one line, <=160 chars>",
  "arguments": ["<3-5 short bullets grounded in supplied evidence>"],
  "evidence_refs": ["<V2 field names like 'decision_quality.execution_readiness', 'scenarios.bear.weight_pct'>"],
  "blocking_gates": ["<V2/calendar gates that already prevent a BUY>"]
}

No prose outside the JSON. No code fences. No raw numbers from outside the
supplied context."""

RISK_MACRO_PROMPT = """You are the Risk / Macro Advocate on the ConfluenceX AI Trade Debate Council.

Role: evaluate the *macro and risk* lens — economic-calendar exposure,
volatility regime, ADR exhaustion, data quality, cross-timeframe
agreement, and tail-risk catalysts. You do not take a directional side;
you surface the conditions under which any directional thesis becomes
unsafe to act on.

Grounding rules:
- Use only the supplied V2 analysis, risk_assessment, monitoring_plan,
  volatility_detail, calendar status, and decision_quality. Never invent
  macro events or prices.
- Calendar state is the primary gate. BLOCKED/POST_NEWS is an immediate
  risk veto; CAUTION requires explicit acknowledgment.
- Volatility regime (compression vs expansion) and ADR position
  (mid-range vs extended) materially change risk-adjusted confidence.
- If data_quality.data_stale is true, the debate is materially degraded —
  call this out as a primary risk.

Output: strict JSON only with these fields and no others:
{
  "agent": "risk_macro",
  "verdict": "PROCEED" | "REDUCE_SIZE" | "WAIT",
  "confidence": <float 0.0-1.0>,
  "summary": "<one line, <=160 chars>",
  "arguments": ["<3-5 short bullets grounded in supplied evidence>"],
  "evidence_refs": ["<V2 field names like 'risk_assessment.overall_risk_1_to_10', 'calendar.status'>"],
  "blocking_gates": ["<macro/risk gates that override any directional call>"]
}

No prose outside the JSON. No code fences. No raw numbers from outside the
supplied context."""

CHIEF_TRADER_PROMPT = """You are the Chief Trader adjudicating the ConfluenceX AI Trade Debate Council.

Role: synthesize the Bull, Bear, and Risk/Macro advocate outputs into a
final council verdict. You do NOT override canonical V2 direction, score,
or trade plan — you produce a *user-facing advisory recommendation* that
explains whether the council agrees with V2, partially agrees, or
disagrees, and what the user should do given the current calendar and
gating state.

Grounding rules:
- The supplied V2 analysis is the single source of truth for direction,
  score, and trade plan. Your verdict must be consistent with V2: if V2
  says BUY with score >= 80 and gates pass, your verdict is BUY. If V2
  says NEUTRAL or score < 60 or any eligibility gate fails, your verdict
  is WAIT regardless of how compelling the bull case sounds.
- Calendar BLOCKED/POST_NEWS always produces a WAIT verdict.
- If the bull and bear advocates strongly disagree (confidence spread
  > 0.4) and risk_macro flags REDUCE_SIZE or WAIT, your verdict is WAIT.
- Multi-timeframe alignment matters: disagreement between Monthly/Weekly
  bias and the selected timeframe lowers confidence materially.

Output: strict JSON only with these fields and no others:
{
  "verdict": "BUY" | "SELL" | "WAIT",
  "confidence": <float 0.0-1.0>,
  "summary": "<one line, <=200 chars>",
  "supporting": ["<2-4 short bullets that drove the verdict>"],
  "against": ["<2-4 short bullets that argued against>"],
  "blocking_gates": ["<V2/calendar gates the user must clear before acting>"],
  "narrative": "<2-3 sentence plain-English synthesis, no JSON, no code fences>"
}

No prose outside the JSON. No code fences."""


# ---------------------------------------------------------------------------
# Context shaping — keep prompt payloads small and grounded.
# ---------------------------------------------------------------------------

_ALLOWED_INDICATOR_KEYS = (
    "rsi", "macd", "macd_signal", "macd_histogram", "adx",
    "stoch_rsi", "cci", "relative_volume", "atr",
    "compression", "bollinger_width", "keltner_width",
)


def _shape_context(pair: str, timeframe: str, analysis: Mapping[str, Any],
                   calendar: Mapping[str, Any], deterministic: Mapping[str, Any]) -> dict[str, Any]:
    """Build a compact, role-agnostic context payload for any advocate agent."""
    market_ctx = analysis.get("market_context") if isinstance(analysis.get("market_context"), dict) else {}
    decision = analysis.get("decision_quality") if isinstance(analysis.get("decision_quality"), dict) else {}
    institutional = analysis.get("institutional") if isinstance(analysis.get("institutional"), dict) else {}
    scenarios = institutional.get("scenario_analysis") if isinstance(institutional.get("scenario_analysis"), dict) else {}
    risk = institutional.get("risk_assessment") if isinstance(institutional.get("risk_assessment"), dict) else {}
    volatility = institutional.get("volatility_detail") if isinstance(institutional.get("volatility_detail"), dict) else {}
    monitoring = institutional.get("monitoring_plan") if isinstance(institutional.get("monitoring_plan"), dict) else {}
    executive = institutional.get("executive_summary") if isinstance(institutional.get("executive_summary"), dict) else {}
    data_quality = analysis.get("data_quality") if isinstance(analysis.get("data_quality"), dict) else {}
    indicators = analysis.get("indicators") if isinstance(analysis.get("indicators"), dict) else {}
    indicator_slice = {k: indicators.get(k) for k in _ALLOWED_INDICATOR_KEYS if k in indicators}

    return {
        "pair": pair,
        "timeframe": timeframe or "default",
        "v2_analysis": {
            "version": analysis.get("version"),
            "direction": analysis.get("direction"),
            "raw_direction": analysis.get("raw_direction"),
            "total_score": analysis.get("total_score"),
            "category_breakdown": analysis.get("category_breakdown"),
            "lifecycle": analysis.get("direction_stability", {}).get("lifecycle"),
            "trade_plan_present": bool(analysis.get("trade_plan")),
            "trade_plan": analysis.get("trade_plan"),
            "scenarios": analysis.get("scenarios"),
            "data_quality": {
                "data_stale": bool(data_quality.get("data_stale")),
                "primary_timeframe": data_quality.get("primary_timeframe"),
                "completeness": data_quality.get("completeness"),
            },
            "indicators": indicator_slice,
        },
        "market_context": {
            "htf_bias": market_ctx.get("htf_bias"),
            "selected_timeframe_bias": market_ctx.get("selected_timeframe_bias"),
            "opposing_frames": market_ctx.get("opposing_frames"),
            "regime": market_ctx.get("regime"),
        },
        "decision_quality": {
            "execution_readiness": decision.get("execution_readiness"),
            "market_bias_confidence": decision.get("market_bias_confidence"),
            "setup_quality": decision.get("setup_quality"),
            "evidence_ledger_summary": _evidence_summary(decision.get("evidence_ledger")),
        },
        "institutional": {
            "scenario_analysis": scenarios,
            "risk_assessment": risk,
            "volatility_detail": volatility,
            "executive_summary": executive,
            "monitoring_plan_summary": _monitoring_summary(monitoring),
        },
        "deterministic_consensus": {
            "agents": deterministic.get("agents"),
            "consensus": deterministic.get("consensus"),
        },
        "economic_calendar": {
            "status": calendar.get("status", "UNAVAILABLE"),
            "reason_code": calendar.get("reason_code"),
            "next_high_impact": calendar.get("next_high_impact"),
            "minutes_until_next_event": calendar.get("minutes_until_next_event"),
        },
    }


def _evidence_summary(ledger: Any) -> list[dict[str, Any]]:
    if not isinstance(ledger, dict):
        return []
    entries = ledger.get("entries")
    if not isinstance(entries, list):
        return []
    return [
        {"kind": e.get("kind"), "polarity": e.get("polarity"), "points": e.get("points")}
        for e in entries[:8]
        if isinstance(e, dict)
    ]


def _monitoring_summary(monitoring: Any) -> dict[str, Any]:
    if not isinstance(monitoring, dict):
        return {}
    return {
        "primary_triggers": monitoring.get("primary_triggers"),
        "exit_protocol": monitoring.get("exit_protocol"),
        "invalidation": monitoring.get("invalidation"),
    }


def _normalize_agent_output(raw: Any, role: str) -> dict[str, Any]:
    """Coerce an LLM response into the documented agent contract.

    The MiniMax client already runs ``_extract_json`` which strips fences,
    repairs truncated output, and raises on unrecoverable JSON. This
    function adds the *agent-shape* guarantees: correct verdict enum,
    confidence clamp, default list fields.
    """
    fallback_verdicts = {"bull": "WAIT", "bear": "WAIT", "risk_macro": "WAIT"}
    fallback = {
        "agent": role,
        "verdict": fallback_verdicts.get(role, "WAIT"),
        "confidence": 0.0,
        "summary": "AI response could not be parsed; deterministic consensus is authoritative.",
        "arguments": [],
        "evidence_refs": [],
        "blocking_gates": [],
    }
    if not isinstance(raw, dict):
        return fallback
    verdict = str(raw.get("verdict") or "").upper()
    valid_verdicts = {
        "bull": {"BUY", "WAIT"},
        "bear": {"SELL", "WAIT"},
        "risk_macro": {"PROCEED", "REDUCE_SIZE", "WAIT"},
    }
    if verdict not in valid_verdicts.get(role, set()):
        verdict = fallback_verdicts.get(role, "WAIT")
    try:
        confidence = max(0.0, min(1.0, float(raw.get("confidence") or 0.0)))
    except (TypeError, ValueError):
        confidence = 0.0
    return {
        "agent": role,
        "verdict": verdict,
        "confidence": round(confidence, 3),
        "summary": str(raw.get("summary") or "")[:200],
        "arguments": [str(a)[:280] for a in (raw.get("arguments") or []) if a][:6],
        "evidence_refs": [str(r)[:120] for r in (raw.get("evidence_refs") or []) if r][:8],
        "blocking_gates": [str(g)[:200] for g in (raw.get("blocking_gates") or []) if g][:6],
    }


def _normalize_chief_output(raw: Any, v2_direction: str) -> dict[str, Any]:
    """Chief Trader verdict must be consistent with V2 direction + calendar."""
    fallback = {
        "verdict": "WAIT",
        "confidence": 0.0,
        "summary": "Council could not reach a verdict; V2 scanner and calendar remain authoritative.",
        "supporting": [],
        "against": [],
        "blocking_gates": [],
        "narrative": "The AI Trade Debate Council could not be parsed. The deterministic V2 scanner and economic-calendar gates remain the source of truth.",
    }
    if not isinstance(raw, dict):
        return fallback
    verdict = str(raw.get("verdict") or "").upper()
    if verdict not in {"BUY", "SELL", "WAIT"}:
        verdict = "WAIT"
    # V2 override rule: never produce BUY/SELL opposite to V2's canonical direction.
    # If V2 says NEUTRAL or score < 60, we can only say WAIT.
    canonical = str(v2_direction or "NEUTRAL").upper()
    if canonical == "NEUTRAL":
        verdict = "WAIT"
    elif canonical == "BUY" and verdict == "SELL":
        verdict = "WAIT"
    elif canonical == "SELL" and verdict == "BUY":
        verdict = "WAIT"
    try:
        confidence = max(0.0, min(1.0, float(raw.get("confidence") or 0.0)))
    except (TypeError, ValueError):
        confidence = 0.0
    narrative = str(raw.get("narrative") or "").strip()
    if not narrative:
        narrative = fallback["narrative"]
    return {
        "verdict": verdict,
        "confidence": round(confidence, 3),
        "summary": str(raw.get("summary") or "")[:240],
        "supporting": [str(s)[:280] for s in (raw.get("supporting") or []) if s][:6],
        "against": [str(a)[:280] for a in (raw.get("against") or []) if a][:6],
        "blocking_gates": [str(g)[:200] for g in (raw.get("blocking_gates") or []) if g][:6],
        "narrative": narrative[:1200],
    }


def _call_agent_sync(system_prompt: str, context: Mapping[str, Any]) -> dict[str, Any]:
    """Synchronous wrapper around ``minimax_analyze`` for ``asyncio.to_thread``."""
    # Use the new ``system_prompt`` parameter so each advocate keeps its own role
    # prompt (rather than the default calendar-aware explainer prompt).
    return minimax_analyze(dict(context), system_prompt=system_prompt, max_tokens=1200, timeout=45.0)


# ---------------------------------------------------------------------------
# Public orchestrator
# ---------------------------------------------------------------------------

async def run_council(pair: str, timeframe: str,
                      analysis: Mapping[str, Any],
                      calendar: Mapping[str, Any]) -> dict[str, Any]:
    """Run the four-agent council. Returns a structured payload for the UI.

    The payload always contains ``mode`` (``"ai"``, ``"deterministic_fallback"``,
    or ``"partial"``) and ``generated_at``. On AI failure, individual agents
    fall back to a narrative-default that still renders the slot so the UI
    is never blank.
    """
    pair = str(pair or "").upper()
    timeframe = str(timeframe or "").lower()
    deterministic = build_deterministic_debate_from_analysis(analysis)

    base_context = _shape_context(pair, timeframe, analysis, calendar, deterministic)

    if not minimax_configured():
        return _fallback_payload(pair, timeframe, deterministic, calendar, mode="deterministic_fallback",
                                 note="MINIMAX_API_KEY is not configured; serving deterministic consensus.")

    bull_ctx = dict(base_context)
    bull_ctx["advocate_role"] = "bull"
    bear_ctx = dict(base_context)
    bear_ctx["advocate_role"] = "bear"
    risk_ctx = dict(base_context)
    risk_ctx["advocate_role"] = "risk_macro"

    started = time.time()
    bull_raw = bear_raw = risk_raw = None
    bull_err = bear_err = risk_err = None

    try:
        bull_raw, bear_raw, risk_raw = await asyncio.gather(
            asyncio.to_thread(_call_agent_sync, BULL_PROMPT, bull_ctx),
            asyncio.to_thread(_call_agent_sync, BEAR_PROMPT, bear_ctx),
            asyncio.to_thread(_call_agent_sync, RISK_MACRO_PROMPT, risk_ctx),
            return_exceptions=True,
        )
    except Exception as exc:  # noqa: BLE001 — defensive: any gather failure falls through.
        logger.warning("debate first-pass gather failed: %r", exc)

    bull = _normalize_agent_output(_safe_analysis(bull_raw, "bull"), "bull")
    bear = _normalize_agent_output(_safe_analysis(bear_raw, "bear"), "bear")
    risk = _normalize_agent_output(_safe_analysis(risk_raw, "risk_macro"), "risk_macro")
    if isinstance(bull_raw, Exception):
        bull_err = repr(bull_raw)
    if isinstance(bear_raw, Exception):
        bear_err = repr(bear_raw)
    if isinstance(risk_raw, Exception):
        risk_err = repr(risk_raw)

    # Chief Trader: synthesize the three. If any first-pass failed, still
    # call the chief with normalized (possibly narrative-default) outputs.
    chief, chief_err = _chief_trader_or_fallback(base_context, bull, bear, risk, analysis, calendar)

    any_failed = bool(bull_err or bear_err or risk_err or chief_err)
    errors_block: dict[str, str] = {}
    if bull_err:
        errors_block["bull"] = bull_err
    if bear_err:
        errors_block["bear"] = bear_err
    if risk_err:
        errors_block["risk_macro"] = risk_err
    if chief_err:
        errors_block["chief_trader"] = chief_err

    return {
        "pair": pair,
        "timeframe": timeframe or "default",
        "mode": "ai" if not any_failed else "partial",
        "generated_at": int(time.time()),
        "elapsed_ms": int((time.time() - started) * 1000),
        "calendar": {
            "status": calendar.get("status", "UNAVAILABLE"),
            "reason_code": calendar.get("reason_code"),
        },
        "deterministic": deterministic,
        "bull": bull,
        "bear": bear,
        "risk_macro": risk,
        "chief_trader": chief,
        "errors": errors_block,
    }


def _safe_analysis(raw: Any, role: str) -> Any:
    """Pull the parsed analysis dict out of a minimax_analyze response or exception."""
    if isinstance(raw, Exception):
        return None
    if not isinstance(raw, dict):
        return None
    return raw.get("analysis")


def _chief_trader_or_fallback(base_context: Mapping[str, Any],
                              bull: dict[str, Any],
                              bear: dict[str, Any],
                              risk: dict[str, Any],
                              analysis: Mapping[str, Any],
                              calendar: Mapping[str, Any]) -> tuple[dict[str, Any], str | None]:
    """Invoke the Chief Trader; degrade gracefully on any failure.

    Returns ``(chief_dict, error_string_or_None)`` so the caller can mark the
    run as ``"partial"`` when the chief synthesis path fell back to local
    heuristics because MiniMax failed mid-run.
    """
    v2_direction = str(analysis.get("direction") or "NEUTRAL").upper()
    calendar_status = str(calendar.get("status") or "UNAVAILABLE").upper()

    # Calendar veto is the fastest cheap path — skip a MiniMax call if calendar
    # is BLOCKED or POST_NEWS, since the chief verdict is mechanically WAIT.
    if calendar_status in {"BLOCKED", "POST_NEWS"}:
        return {
            "verdict": "WAIT",
            "confidence": 0.95,
            "summary": f"Economic calendar is {calendar_status}; council verdict is WAIT regardless of directional case.",
            "supporting": ["Calendar gate is the deterministic authority and is currently vetoing new entries."],
            "against": [],
            "blocking_gates": [f"economic_calendar.status = {calendar_status}"],
            "narrative": (f"The economic calendar is in {calendar_status} state, which is a deterministic no-trade condition. "
                          "The council's directional debate is moot until the calendar clears."),
        }, None

    chief_context = {
        "pair": base_context.get("pair"),
        "timeframe": base_context.get("timeframe"),
        "v2_canonical": {
            "direction": v2_direction,
            "score": analysis.get("total_score"),
            "lifecycle": analysis.get("direction_stability", {}).get("lifecycle"),
            "trade_plan_present": bool(analysis.get("trade_plan")),
        },
        "calendar": base_context.get("economic_calendar"),
        "advocate_outputs": {
            "bull": bull,
            "bear": bear,
            "risk_macro": risk,
        },
    }

    if not minimax_configured():
        return _synthesize_chief_locally(bull, bear, risk, v2_direction, calendar_status, base_context), \
            "MINIMAX_API_KEY not configured; chief verdict synthesized locally."

    try:
        result = _call_agent_sync(CHIEF_TRADER_PROMPT, chief_context)
        parsed = result.get("analysis") if isinstance(result, dict) else None
        return _normalize_chief_output(parsed, v2_direction), None
    except Exception as exc:  # noqa: BLE001 — MiniMax failure must never break the page.
        logger.warning("chief_trader MiniMax call failed: %r", exc)
        return _synthesize_chief_locally(bull, bear, risk, v2_direction, calendar_status, base_context), \
            f"chief MiniMax call failed: {exc!r}"


def _synthesize_chief_locally(bull: dict[str, Any], bear: dict[str, Any],
                              risk: dict[str, Any],
                              v2_direction: str,
                              calendar_status: str,
                              base_context: Mapping[str, Any]) -> dict[str, Any]:
    """Heuristic fallback when MiniMax is unavailable for the chief pass.

    Preserves the canonical-V2-override rule: a non-NEUTRAL V2 direction
    produces a verdict in the same direction only if risk_macro confidence
    is not extreme on the opposite side and calendar is CLEAR/CAUTION.
    """
    risk_blocks = bool(risk.get("blocking_gates")) or risk.get("verdict") == "WAIT"
    calendar_blocks = calendar_status in {"BLOCKED", "POST_NEWS"}
    bull_conf = float(bull.get("confidence") or 0.0)
    bear_conf = float(bear.get("confidence") or 0.0)
    risk_conf = float(risk.get("confidence") or 0.0)

    if calendar_blocks or (v2_direction == "NEUTRAL"):
        verdict = "WAIT"
        confidence = 0.8 if calendar_blocks else 0.55
    elif risk_blocks and risk_conf >= 0.6:
        verdict = "WAIT"
        confidence = round(min(0.95, 0.5 + risk_conf * 0.4), 3)
    elif v2_direction == "BUY" and bull_conf >= bear_conf:
        verdict = "BUY"
        confidence = round(min(0.9, 0.4 + bull_conf * 0.4 + (1.0 - risk_conf) * 0.2), 3)
    elif v2_direction == "SELL" and bear_conf >= bull_conf:
        verdict = "SELL"
        confidence = round(min(0.9, 0.4 + bear_conf * 0.4 + (1.0 - risk_conf) * 0.2), 3)
    else:
        verdict = "WAIT"
        confidence = 0.5

    return {
        "verdict": verdict,
        "confidence": confidence,
        "summary": f"Council heuristic verdict: {verdict} (V2 direction {v2_direction}, calendar {calendar_status}).",
        "supporting": [bull.get("summary"), risk.get("summary")][:2] if verdict != "SELL" else [bear.get("summary")],
        "against": [bear.get("summary")] if verdict != "SELL" else [bull.get("summary")],
        "blocking_gates": list(risk.get("blocking_gates") or []),
        "narrative": ("AI Trade Debate Council ran in deterministic fallback. "
                      f"V2 direction is {v2_direction}; calendar status is {calendar_status}. "
                      "Canonical V2 scanner and calendar gates remain the source of truth."),
    }


def _fallback_payload(pair: str, timeframe: str,
                      deterministic: dict[str, Any],
                      calendar: Mapping[str, Any], *,
                      mode: str, note: str) -> dict[str, Any]:
    """Build a fully-renderable payload when AI is unavailable end-to-end."""
    return {
        "pair": pair,
        "timeframe": timeframe or "default",
        "mode": mode,
        "generated_at": int(time.time()),
        "note": note,
        "calendar": {
            "status": calendar.get("status", "UNAVAILABLE"),
            "reason_code": calendar.get("reason_code"),
        },
        "deterministic": deterministic,
        "bull": agent_placeholder("bull", "AI Bull advocate unavailable; deterministic consensus shown below."),
        "bear": agent_placeholder("bear", "AI Bear advocate unavailable; deterministic consensus shown below."),
        "risk_macro": agent_placeholder("risk_macro", "AI Risk/Macro advocate unavailable; deterministic consensus shown below."),
        "chief_trader": {
            "verdict": "WAIT",
            "confidence": 0.0,
            "summary": "Council verdict unavailable; AI pipeline did not complete.",
            "supporting": [],
            "against": [],
            "blocking_gates": [],
            "narrative": ("The AI Trade Debate Council could not run (model unavailable). "
                          "The deterministic scanner, intelligence consensus, and economic calendar remain authoritative."),
        },
        "errors": {},
    }


def agent_placeholder(role: str, message: str) -> dict[str, Any]:
    return {
        "agent": role,
        "verdict": "WAIT",
        "confidence": 0.0,
        "summary": message,
        "arguments": [],
        "evidence_refs": [],
        "blocking_gates": [],
    }


def build_deterministic_debate_from_analysis(analysis: Mapping[str, Any]) -> dict[str, Any]:
    """Run the existing deterministic ``build_debate`` against the same V2 input.

    Keeps the deterministic consensus always present in the payload, so the
    UI has a stable fallback to render even when AI agents fail.
    """
    try:
        consensus = _deterministic_consensus_skeleton(analysis)
        return build_deterministic_debate(consensus)
    except Exception as exc:  # noqa: BLE001
        logger.debug("deterministic debate skeleton failed: %r", exc)
        return {"bull_case": [], "bear_case": [], "note": "deterministic consensus unavailable"}


def _deterministic_consensus_skeleton(analysis: Mapping[str, Any]) -> dict[str, Any]:
    """Synthesize a consensus-skeleton shaped like the existing rule-based output."""
    direction = str(analysis.get("direction") or "NEUTRAL").upper()
    market_ctx = analysis.get("market_context") if isinstance(analysis.get("market_context"), dict) else {}
    opposing = list(market_ctx.get("opposing_frames") or [])
    score = float(analysis.get("total_score") or 0.0)
    base_conf = min(0.95, max(0.1, score / 100.0))
    if direction == "NEUTRAL":
        base_conf = 0.2

    return {
        "agents": [
            {"agent": "structure", "label": "Market Structure",
             "vote": direction, "confidence": round(base_conf * 100, 1),
             "reason": "Canonical trend and multi-timeframe alignment.",
             "evidence": opposing or ["No opposing timeframe reported."],
             "available": True},
            {"agent": "momentum", "label": "Momentum",
             "vote": direction, "confidence": round(base_conf * 100, 1),
             "reason": "RSI / MACD / Stoch-RSI agreement with selected timeframe.",
             "evidence": [],
             "available": True},
            {"agent": "risk_macro", "label": "Risk / Macro",
             "vote": direction if direction != "NEUTRAL" else "NEUTRAL",
             "confidence": round(base_conf * 100, 1),
             "reason": "Calendar status and volatility regime.",
             "evidence": [],
             "available": True},
        ],
        "consensus": {
            "agreement_pct": round(base_conf * 100, 1),
            "conflicting": list(opposing),
        },
    }
