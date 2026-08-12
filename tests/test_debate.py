"""Tests for scanner.debate — the AI Trade Debate council.

These tests do not call MiniMax. They cover:
- shape coercion of agent / chief outputs
- V2-direction override rule on the Chief Trader verdict
- deterministic-fallback payload shape when MINIMAX_API_KEY is unset
- the calendar BLOCKED/POST_NEWS fast path
- local synthesis heuristic for the chief when MiniMax fails mid-council
- the public ``build_deterministic_debate_from_analysis`` skeleton
"""
from __future__ import annotations

import asyncio
import os
import unittest
from typing import Any
from unittest import mock

from scanner import debate
from scanner.debate import (
    agent_placeholder,
    build_deterministic_debate_from_analysis,
    _normalize_agent_output,
    _normalize_chief_output,
    run_council,
)


def _v2(direction: str = "BUY", score: int = 75, **overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "version": "v2",
        "direction": direction,
        "raw_direction": direction,
        "total_score": score,
        "category_breakdown": {"trend": 25, "momentum": 22, "volatility": 14, "structure": 14},
        "scenarios": {"bull": {"weight_pct": 55}, "bear": {"weight_pct": 45}},
        "data_quality": {"data_stale": False, "primary_timeframe": "1h"},
        "indicators": {"rsi": 58, "macd": 0.4, "atr": 120.0},
        "market_context": {"htf_bias": "BUY", "selected_timeframe_bias": "BUY", "opposing_frames": []},
        "trade_plan": {"entry": 65000, "stop": 64500, "tp1": 66000, "tp2": 66500, "tp3": 67000},
        "decision_quality": {"execution_readiness": 72, "market_bias_confidence": 80, "setup_quality": 70},
        "institutional": {
            "scenario_analysis": {"bull_case": {"weight_pct": 55}, "bear_case": {"weight_pct": 45}},
            "risk_assessment": {"overall_risk_1_to_10": 4, "calendar_status": "CLEAR"},
            "executive_summary": {"overall_bias": "BUY", "conviction_0_to_100": 75},
        },
        "direction_stability": {"lifecycle": "CONFIRMED"},
    }
    base.update(overrides)
    return base


class TestNormalizeAgentOutput(unittest.TestCase):
    def test_bull_verdict_valid(self):
        out = _normalize_agent_output({"verdict": "BUY", "confidence": 0.8, "summary": "x"}, "bull")
        self.assertEqual(out["verdict"], "BUY")
        self.assertAlmostEqual(out["confidence"], 0.8)
        self.assertEqual(out["agent"], "bull")

    def test_bull_invalid_verdict_falls_back_to_wait(self):
        out = _normalize_agent_output({"verdict": "SELL", "confidence": 0.9}, "bull")
        self.assertEqual(out["verdict"], "WAIT")  # SELL not in {BUY, WAIT}

    def test_bear_invalid_verdict_falls_back_to_wait(self):
        out = _normalize_agent_output({"verdict": "BUY", "confidence": 0.9}, "bear")
        self.assertEqual(out["verdict"], "WAIT")  # BUY not in {SELL, WAIT}

    def test_risk_macro_valid_verdicts(self):
        for v in ("PROCEED", "REDUCE_SIZE", "WAIT"):
            out = _normalize_agent_output({"verdict": v, "confidence": 0.5}, "risk_macro")
            self.assertEqual(out["verdict"], v)

    def test_confidence_clamped(self):
        out = _normalize_agent_output({"verdict": "BUY", "confidence": 5.0}, "bull")
        self.assertEqual(out["confidence"], 1.0)
        out = _normalize_agent_output({"verdict": "BUY", "confidence": -2.0}, "bull")
        self.assertEqual(out["confidence"], 0.0)

    def test_missing_fields_default_safely(self):
        out = _normalize_agent_output({}, "bull")
        self.assertEqual(out["verdict"], "WAIT")
        self.assertEqual(out["confidence"], 0.0)
        self.assertEqual(out["arguments"], [])

    def test_arguments_truncated_to_six(self):
        out = _normalize_agent_output({"verdict": "BUY", "arguments": [f"arg{i}" for i in range(20)]}, "bull")
        self.assertEqual(len(out["arguments"]), 6)

    def test_non_dict_input_returns_fallback(self):
        out = _normalize_agent_output("not a dict", "bull")
        self.assertEqual(out["verdict"], "WAIT")
        self.assertEqual(out["confidence"], 0.0)


class TestNormalizeChiefOutput(unittest.TestCase):
    def test_v2_neutral_forces_wait(self):
        out = _normalize_chief_output({"verdict": "BUY", "confidence": 0.9, "narrative": "y"}, v2_direction="NEUTRAL")
        self.assertEqual(out["verdict"], "WAIT")

    def test_buy_v2_blocks_sell_chief(self):
        out = _normalize_chief_output({"verdict": "SELL", "confidence": 0.9, "narrative": "y"}, v2_direction="BUY")
        self.assertEqual(out["verdict"], "WAIT")

    def test_sell_v2_blocks_buy_chief(self):
        out = _normalize_chief_output({"verdict": "BUY", "confidence": 0.9, "narrative": "y"}, v2_direction="SELL")
        self.assertEqual(out["verdict"], "WAIT")

    def test_consistent_verdict_passes(self):
        out = _normalize_chief_output({"verdict": "BUY", "confidence": 0.7, "narrative": "ok"}, v2_direction="BUY")
        self.assertEqual(out["verdict"], "BUY")
        self.assertAlmostEqual(out["confidence"], 0.7)

    def test_invalid_verdict_becomes_wait(self):
        out = _normalize_chief_output({"verdict": "HODL", "narrative": "x"}, v2_direction="BUY")
        self.assertEqual(out["verdict"], "WAIT")

    def test_missing_narrative_uses_fallback(self):
        out = _normalize_chief_output({"verdict": "BUY"}, v2_direction="BUY")
        self.assertTrue(out["narrative"])
        self.assertIn("source of truth", out["narrative"].lower())


class TestAgentPlaceholder(unittest.TestCase):
    def test_shape(self):
        p = agent_placeholder("bull", "down")
        self.assertEqual(p["agent"], "bull")
        self.assertEqual(p["verdict"], "WAIT")
        self.assertEqual(p["confidence"], 0.0)
        self.assertEqual(p["summary"], "down")
        self.assertEqual(p["arguments"], [])


class TestDeterministicFallback(unittest.TestCase):
    def test_uses_v2_direction_and_score(self):
        out = build_deterministic_debate_from_analysis(_v2(direction="SELL", score=40))
        self.assertIn("bull_case", out)
        self.assertIn("bear_case", out)
        self.assertIn("note", out)


class TestRunCouncil(unittest.TestCase):
    def test_minimax_unconfigured_returns_deterministic_fallback(self):
        with mock.patch.object(debate, "minimax_configured", return_value=False):
            result = asyncio.run(run_council(
                pair="BTCUSD", timeframe="1h",
                analysis=_v2(direction="BUY", score=80),
                calendar={"status": "CLEAR"},
            ))
        self.assertEqual(result["mode"], "deterministic_fallback")
        self.assertEqual(result["pair"], "BTCUSD")
        self.assertIn("note", result)
        # Each agent slot must still be present so the UI never renders blank.
        for key in ("bull", "bear", "risk_macro", "chief_trader", "deterministic"):
            self.assertIn(key, result)

    def test_calendar_blocked_short_circuits_chief_to_wait(self):
        with mock.patch.object(debate, "minimax_configured", return_value=True), \
             mock.patch.object(debate, "_call_agent_sync") as mock_call:
            result = asyncio.run(run_council(
                pair="BTCUSD", timeframe="1h",
                analysis=_v2(direction="BUY", score=80),
                calendar={"status": "BLOCKED", "reason_code": "FOMC"},
            ))
        self.assertEqual(result["chief_trader"]["verdict"], "WAIT")
        self.assertEqual(result["chief_trader"]["confidence"], 0.95)
        # Chief short-circuited — only the 3 first-pass agents should have been called.
        self.assertEqual(mock_call.call_count, 3)

    def test_calendar_post_news_short_circuits(self):
        with mock.patch.object(debate, "minimax_configured", return_value=True), \
             mock.patch.object(debate, "_call_agent_sync") as mock_call:
            result = asyncio.run(run_council(
                pair="ETHUSD", timeframe="1h",
                analysis=_v2(direction="BUY", score=80),
                calendar={"status": "POST_NEWS", "reason_code": "CPI"},
            ))
        self.assertEqual(result["chief_trader"]["verdict"], "WAIT")
        self.assertEqual(mock_call.call_count, 3)

    def test_buy_v2_with_clear_calendar_produces_buy_chief(self):
        def fake_call(prompt, context):
            role = context.get("advocate_role")
            if role == "bull":
                return {"analysis": {"verdict": "BUY", "confidence": 0.8, "summary": "b"}}
            if role == "bear":
                return {"analysis": {"verdict": "WAIT", "confidence": 0.4, "summary": "br"}}
            if role == "risk_macro":
                return {"analysis": {"verdict": "PROCEED", "confidence": 0.3, "summary": "rm"}}
            # chief
            return {"analysis": {"verdict": "BUY", "confidence": 0.75,
                                 "summary": "Aligned with V2",
                                 "supporting": ["V2 confirmed BUY"], "against": [],
                                 "blocking_gates": [],
                                 "narrative": "Bull case strongest, risk acceptable."}}
        with mock.patch.object(debate, "minimax_configured", return_value=True), \
             mock.patch.object(debate, "_call_agent_sync", side_effect=fake_call):
            result = asyncio.run(run_council(
                pair="BTCUSD", timeframe="1h",
                analysis=_v2(direction="BUY", score=80),
                calendar={"status": "CLEAR"},
            ))
        self.assertEqual(result["mode"], "ai")
        self.assertEqual(result["chief_trader"]["verdict"], "BUY")
        self.assertGreater(result["chief_trader"]["confidence"], 0.5)
        self.assertEqual(result["bull"]["verdict"], "BUY")
        self.assertEqual(result["bear"]["verdict"], "WAIT")
        self.assertEqual(result["risk_macro"]["verdict"], "PROCEED")

    def test_risk_blocks_via_chief_local_synthesis(self):
        """When the chief call fails, the local heuristic must still honor V2 direction."""
        def fake_call(prompt, context):
            role = context.get("advocate_role")
            if role == "bull":
                return {"analysis": {"verdict": "BUY", "confidence": 0.5, "summary": "b"}}
            if role == "bear":
                return {"analysis": {"verdict": "WAIT", "confidence": 0.4, "summary": "br"}}
            if role == "risk_macro":
                return {"analysis": {"verdict": "WAIT", "confidence": 0.9, "summary": "r",
                                     "blocking_gates": ["vol expansion"]}}
            raise RuntimeError("chief failed")

        with mock.patch.object(debate, "minimax_configured", return_value=True), \
             mock.patch.object(debate, "_call_agent_sync", side_effect=fake_call):
            result = asyncio.run(run_council(
                pair="BTCUSD", timeframe="1h",
                analysis=_v2(direction="BUY", score=80),
                calendar={"status": "CLEAR"},
            ))
        # Mode is "partial" because the chief failed.
        self.assertEqual(result["mode"], "partial")
        # Local synthesis respects V2=BUY but risk blocked it \u2192 WAIT.
        self.assertEqual(result["chief_trader"]["verdict"], "WAIT")
        # V2 NEUTRAL is always WAIT regardless of advocate output.
        self.assertIn("chief_trader", result["errors"])
        self.assertIn("chief", result["errors"]["chief_trader"].lower())

    def test_v2_neutral_with_clear_calendar_yields_wait(self):
        def fake_call(prompt, context):
            role = context.get("advocate_role")
            if role == "bull":
                return {"analysis": {"verdict": "BUY", "confidence": 0.9, "summary": "b"}}
            if role == "bear":
                return {"analysis": {"verdict": "SELL", "confidence": 0.9, "summary": "br"}}
            if role == "risk_macro":
                return {"analysis": {"verdict": "PROCEED", "confidence": 0.5, "summary": "rm"}}
            return {"analysis": {"verdict": "BUY", "confidence": 0.9, "summary": "x",
                                 "narrative": "would buy"}}

        with mock.patch.object(debate, "minimax_configured", return_value=True), \
             mock.patch.object(debate, "_call_agent_sync", side_effect=fake_call):
            result = asyncio.run(run_council(
                pair="BTCUSD", timeframe="1h",
                analysis=_v2(direction="NEUTRAL", score=40),
                calendar={"status": "CLEAR"},
            ))
        self.assertEqual(result["chief_trader"]["verdict"], "WAIT")


if __name__ == "__main__":
    unittest.main()
