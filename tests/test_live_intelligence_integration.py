import unittest
from unittest.mock import patch

from scanner.decision_quality import attach_decision_quality


class LiveIntelligenceIntegrationTest(unittest.TestCase):
    def setUp(self):
        self.analysis = {
            "pair": "BTCUSD",
            "timeframe": "1h",
            "direction": "BUY",
            "total_score": 82,
            "current_price": 100.0,
            "category_breakdown": {"structure": 20, "momentum": 16},
            "market_context": {"opposing_frames": []},
            "indicators": {"rsi": 61, "macd": 0.7, "atr": 2.0, "adx": 31},
            "liquidity": {"bias": "BUY", "score": 72, "provider_backed": True},
            "trade_timing": {"status": "READY", "session_score": 80, "regime": {"score": 70}},
            "trade_plan": {
                "eligible": True,
                "status": "VALID",
                "entry": 100.0,
                "stop": 96.0,
                "net_rr": 2.5,
                "account_risk_percent": 0.5,
                "triggers": [],
                "blocking_reasons": [],
            },
            "data_quality": {"status": "GOOD"},
            "institutional": {"harmonics": {"name": "Gartley", "direction": "BUY", "geometry_quality": 70}},
        }
        self.calendar = {"status": "CLEAR"}

    def test_canonical_response_gets_intelligence_v2(self):
        result = attach_decision_quality(self.analysis, calendar=self.calendar)
        intelligence = result["institutional_intelligence_v2"]

        self.assertEqual(intelligence["version"], "2.0.0")
        self.assertEqual(intelligence["execution_authority"], "CANONICAL_TRADE_GATES_ONLY")
        self.assertFalse(intelligence["position_sizing_uses_consensus"])
        self.assertFalse(intelligence["position_sizing_uses_similarity"])
        self.assertFalse(intelligence["position_sizing_uses_grade"])
        self.assertEqual(intelligence["historical_similarity"]["status"], "NO_HISTORY")

    def test_integration_preserves_canonical_direction_score_and_eligibility(self):
        result = attach_decision_quality(self.analysis, calendar=self.calendar)

        self.assertEqual(result["direction"], self.analysis["direction"])
        self.assertEqual(result["total_score"], self.analysis["total_score"])
        self.assertEqual(result["trade_plan"]["eligible"], self.analysis["trade_plan"]["eligible"])
        self.assertLessEqual(
            result["trade_plan"]["account_risk_percent"],
            self.analysis["trade_plan"]["account_risk_percent"],
        )

    def test_blocked_calendar_is_visible_to_consensus(self):
        result = attach_decision_quality(self.analysis, calendar={"status": "BLOCKED"})
        intelligence = result["institutional_intelligence_v2"]

        self.assertEqual(intelligence["multi_agent_consensus"]["status"], "BLOCKED")
        self.assertTrue(intelligence["multi_agent_consensus"]["veto_reasons"])
        self.assertFalse(intelligence["trade_grade"]["executable"])

    def test_intelligence_failure_never_breaks_canonical_response(self):
        with patch(
            "scanner.decision_quality.attach_institutional_intelligence",
            side_effect=RuntimeError("simulated provider failure"),
        ):
            result = attach_decision_quality(self.analysis, calendar=self.calendar)

        fallback = result["institutional_intelligence_v2"]
        self.assertFalse(fallback["available"])
        self.assertEqual(fallback["status"], "UNAVAILABLE")
        self.assertEqual(fallback["execution_authority"], "CANONICAL_TRADE_GATES_ONLY")
        self.assertEqual(result["direction"], "BUY")
        self.assertTrue(result["trade_plan"]["eligible"])


if __name__ == "__main__":
    unittest.main()
