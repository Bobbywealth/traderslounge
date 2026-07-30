"""Tests for the executive summary module."""
import unittest

from scanner.data_types import MarketSnapshot
from scanner.modules.institutional import executive_summary as es_mod


def _analysis(direction: str = "BUY", score: float = 70.0,
              current_price: float = 100.0) -> dict:
    return {
        "pair": "BTCUSDT",
        "direction": direction,
        "total_score": score,
        "current_price": current_price,
        "trade_plan": {"entry": 100.0, "stop": 95.0, "tp1": 110.0, "tp2": 115.0},
        "data_quality": {"primary_timeframe": "1h"},
        "indicators": {
            "fibonacci": {"levels": {"0.618": 97.0, "1.0": 100.0,
                                      "1.272": 110.0, "1.618": 115.0}},
        },
        "setup_zones": {"support_resistance": {"support": 95.0, "resistance": 120.0}},
    }


def _sections(htf_trend: str = "bullish", vol_regime: str = "normal") -> dict:
    return {
        "market_structure_mtf": {
            "available": True,
            "composite": {"trend": htf_trend, "summary": "test summary"},
        },
        "historical_volatility": {"available": True, "regime": vol_regime},
        "trade_plans": {
            "available": True,
            "plans": {
                "swing": {"eligible": True, "rr_tp1": 2.0, "rr_tp2": 3.0},
                "position": {"eligible": True, "rr_tp1": 4.0, "rr_tp2": 6.0},
            },
        },
    }


class TestExecutiveSummary(unittest.TestCase):
    def test_required_fields(self):
        result = es_mod.compute(
            _analysis(), MarketSnapshot(pair="BTCUSDT"), _sections()
        )
        self.assertTrue(result["available"])
        for key in ("bias", "conviction_pct", "best_rr", "horizon",
                    "key_levels", "invalidation", "thesis_text",
                    "schema_disclaimer"):
            self.assertIn(key, result)

    def test_bias_matches_direction(self):
        result = es_mod.compute(
            _analysis(direction="SELL"),
            MarketSnapshot(pair="BTCUSDT"),
            _sections(htf_trend="bearish"),
        )
        self.assertEqual(result["bias"], "sell")

    def test_neutral_bias(self):
        result = es_mod.compute(
            _analysis(direction="NEUTRAL"),
            MarketSnapshot(pair="BTCUSDT"),
            _sections(),
        )
        self.assertEqual(result["bias"], "neutral")

    def test_conviction_bounds(self):
        for score in (40, 60, 80):
            result = es_mod.compute(
                _analysis(score=score),
                MarketSnapshot(pair="BTCUSDT"),
                _sections(),
            )
            self.assertGreaterEqual(result["conviction_pct"], 10)
            self.assertLessEqual(result["conviction_pct"], 95)

    def test_calendar_blocked_lowers_conviction(self):
        clear = es_mod.compute(
            _analysis(score=70),
            MarketSnapshot(pair="BTCUSDT"),
            _sections(),
            calendar_state="CLEAR",
        )
        blocked = es_mod.compute(
            _analysis(score=70),
            MarketSnapshot(pair="BTCUSDT"),
            _sections(),
            calendar_state="BLOCKED",
        )
        self.assertGreater(clear["conviction_pct"], blocked["conviction_pct"])

    def test_thesis_text_present_and_non_empty(self):
        result = es_mod.compute(
            _analysis(), MarketSnapshot(pair="BTCUSDT"), _sections()
        )
        self.assertTrue(result["thesis_text"])
        self.assertIn("BTCUSDT", result["thesis_text"])

    def test_schema_disclaimer_present(self):
        result = es_mod.compute(
            _analysis(), MarketSnapshot(pair="BTCUSDT"), _sections()
        )
        self.assertIn("schema_disclaimer", result)
        self.assertIn("deterministic", result["schema_disclaimer"].lower())


if __name__ == "__main__":
    unittest.main()