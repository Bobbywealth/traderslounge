import unittest

from scanner.historical_similarity import find_similar_setups
from scanner.institutional_intelligence import build_institutional_intelligence
from scanner.intelligence_consensus import build_agent_consensus
from scanner.trade_grading import build_trade_grade


class InstitutionalIntelligenceV2Test(unittest.TestCase):
    def setUp(self):
        self.analysis = {
            "pair": "BTCUSD",
            "timeframe": "H1",
            "direction": "BUY",
            "total_score": 84,
            "current_price": 100.0,
            "category_breakdown": {"structure": 21, "momentum": 16},
            "market_context": {"opposing_frames": []},
            "indicators": {"rsi": 61, "macd": 0.8, "atr": 2.0, "adx": 32},
            "liquidity": {"bias": "BUY", "score": 75, "provider_backed": True},
            "trade_timing": {"status": "READY", "session_score": 80, "regime": {"score": 70}},
            "trade_plan": {"eligible": True, "entry": 100, "stop": 96, "net_rr": 2.6},
            "data_quality": {"status": "GOOD"},
            "decision_quality": {"setup_quality": 82},
            "institutional": {"harmonics": {"name": "Gartley", "direction": "BUY", "geometry_quality": 72}},
        }
        self.calendar = {"status": "CLEAR"}

    def test_consensus_is_advisory_and_aligned(self):
        result = build_agent_consensus(self.analysis, self.calendar)
        self.assertEqual(result["consensus_direction"], "BUY")
        self.assertEqual(result["status"], "ALIGNED")
        self.assertFalse(result["can_override_trade_gates"])
        self.assertEqual(len(result["votes"]), 7)

    def test_macro_block_creates_veto(self):
        result = build_agent_consensus(self.analysis, {"status": "BLOCKED"})
        self.assertEqual(result["status"], "BLOCKED")
        self.assertTrue(result["veto_reasons"])

    def test_trade_grade_does_not_authorize_execution(self):
        intelligence = build_institutional_intelligence(self.analysis, self.calendar)
        grade = intelligence["trade_grade"]
        self.assertIn(grade["grade"], {"A+", "A", "A-", "B+", "B", "B-", "C", "D", "F"})
        self.assertFalse(grade["grade_is_execution_authority"])
        self.assertEqual(intelligence["execution_authority"], "CANONICAL_TRADE_GATES_ONLY")

    def test_ineligible_plan_is_downgraded(self):
        blocked = dict(self.analysis)
        blocked["trade_plan"] = {"eligible": False, "net_rr": 1.2}
        confidence = {"score": 90, "data_provenance": {"coverage_pct": 90}}
        consensus = {"agreement_pct": 90, "status": "ALIGNED"}
        grade = build_trade_grade(blocked, confidence, consensus)
        self.assertFalse(grade["executable"])
        self.assertGreaterEqual(len(grade["deductions"]), 2)

    def test_similarity_requires_resolved_sample(self):
        history = [
            {
                "id": "one", "pair": "BTCUSD", "timeframe": "H1", "direction": "BUY",
                "outcome": "WIN", "realized_r": 2.0,
                "vector": {
                    "score": 0.84, "rsi": 0.61, "atr_pct": 0.02, "trend_strength": 0.32,
                    "liquidity_score": 0.75, "volatility_score": 0.70,
                    "session_score": 0.80, "setup_quality_score": 0.82,
                },
            }
        ]
        result = find_similar_setups(self.analysis, history)
        self.assertEqual(result["sample_size"], 1)
        self.assertEqual(result["historical_win_rate_pct"], 100.0)
        self.assertEqual(result["status"], "LIMITED_SAMPLE")
        self.assertFalse(result["is_forecast_probability"])


if __name__ == "__main__":
    unittest.main()
