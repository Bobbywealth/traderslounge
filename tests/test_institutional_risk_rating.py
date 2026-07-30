"""Tests for the 1-10 risk rating module."""
import time
import unittest

from scanner.modules.institutional import risk_rating as rr_mod


def _analysis(score: float = 70.0, age_seconds: int = 0) -> dict:
    closed = int(time.time()) - age_seconds
    return {
        "total_score": score,
        "data_quality": {"closed_bar_time": closed},
    }


def _sections(trend: str = "bullish", vol_regime: str = "normal",
              conflicting: list = None) -> dict:
    return {
        "market_structure_mtf": {
            "available": True,
            "composite": {"trend": trend, "conflicting_tfs": conflicting or []},
        },
        "historical_volatility": {
            "available": True,
            "regime": vol_regime,
        },
    }


class TestRiskRating(unittest.TestCase):
    def test_low_risk_components(self):
        result = rr_mod.compute(
            _analysis(score=80, age_seconds=10),
            snapshot=None,
            sections=_sections(trend="bullish", vol_regime="compressed"),
            calendar_state="CLEAR",
        )
        self.assertTrue(result["available"])
        self.assertIn("rating", result)
        self.assertIn("label", result)
        self.assertGreaterEqual(result["rating"], 1)
        self.assertLessEqual(result["rating"], 10)
        # Compressed vol + high score + no conflict + clear calendar
        # should produce a low rating.
        self.assertLessEqual(result["rating"], 4)
        self.assertEqual(result["label"], "low")

    def test_high_risk_components(self):
        # 3 conflicting TFs + expanded vol + blocked calendar +
        # low score + stale data → all five components at max.
        result = rr_mod.compute(
            _analysis(score=40, age_seconds=600),
            snapshot=None,
            sections=_sections(trend="conflict", vol_regime="expanded",
                                conflicting=["D1", "H4", "H1"]),
            calendar_state="BLOCKED",
        )
        self.assertEqual(result["rating"], 10)
        self.assertEqual(result["label"], "high")

    def test_components_sum_matches_raw(self):
        result = rr_mod.compute(
            _analysis(score=70, age_seconds=10),
            snapshot=None,
            sections=_sections(trend="bullish", vol_regime="normal"),
            calendar_state="CLEAR",
        )
        self.assertEqual(
            sum(result["components"].values()),
            result["raw_score"],
        )


if __name__ == "__main__":
    unittest.main()