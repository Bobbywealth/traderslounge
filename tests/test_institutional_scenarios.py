"""Tests for the rule-based scenario module."""
import unittest

from scanner.data_types import MarketSnapshot
from scanner.modules.institutional import scenarios as sc_mod


def _analysis(direction: str = "BUY", score: float = 60.0) -> dict:
    return {
        "direction": direction,
        "total_score": score,
        "current_price": 100.0,
        "trade_plan": {"entry": 100.0, "stop": 95.0, "tp1": 110.0, "tp2": 115.0},
        "indicators": {
            "fibonacci": {
                "levels": {"1.272": 110.0, "1.618": 115.0, "-1.0": 90.0},
            },
        },
        "setup_zones": {"support_resistance": {"support": 95.0, "resistance": 120.0}},
    }


def _empty_snap() -> MarketSnapshot:
    return MarketSnapshot(pair="BTCUSDT")


class TestScenarios(unittest.TestCase):
    def test_buy_scenarios_split(self):
        result = sc_mod.compute(_analysis("BUY", 60.0), _empty_snap(),
                                calendar_state="CLEAR")
        self.assertTrue(result["available"])
        self.assertEqual(result["kind"], "estimate")
        s = result["scenarios"]
        self.assertIn("bull", s)
        self.assertIn("base", s)
        self.assertIn("bear", s)
        total = sum(s[k]["probability_pct"] for k in s)
        # Allow rounding tolerance.
        self.assertAlmostEqual(total, 100.0, delta=1.0)
        # Bull prob must be ≥ base prob because direction is BUY.
        self.assertGreaterEqual(s["bull"]["probability_pct"], s["base"]["probability_pct"])

    def test_sell_scenarios_split(self):
        result = sc_mod.compute(_analysis("SELL", 60.0), _empty_snap(),
                                calendar_state="CLEAR")
        self.assertIn("bear", result["scenarios"])
        s = result["scenarios"]
        total = sum(s[k]["probability_pct"] for k in s)
        self.assertAlmostEqual(total, 100.0, delta=1.0)

    def test_neutral_returns_no_scenarios(self):
        result = sc_mod.compute(_analysis("NEUTRAL"), _empty_snap(),
                                calendar_state="CLEAR")
        self.assertTrue(result["available"])
        self.assertEqual(result["scenarios"], {})
        self.assertIn("disclaimer", result)

    def test_calendar_blocked_reduces_aligned_pct(self):
        clear = sc_mod.compute(_analysis("BUY", 70.0), _empty_snap(),
                               calendar_state="CLEAR")
        blocked = sc_mod.compute(_analysis("BUY", 70.0), _empty_snap(),
                                 calendar_state="BLOCKED")
        self.assertGreater(
            clear["scenarios"]["bull"]["probability_pct"],
            blocked["scenarios"]["bull"]["probability_pct"],
        )

    def test_missing_entry(self):
        a = _analysis("BUY")
        a["current_price"] = 0.0
        a["trade_plan"] = None
        result = sc_mod.compute(a, MarketSnapshot(pair="X"),
                                calendar_state="CLEAR")
        # snapshot has no candles → entry still 0 → unavailable
        self.assertFalse(result["available"])
        self.assertEqual(result["reason"], "missing_entry")

    def test_disclaimer_present(self):
        result = sc_mod.compute(_analysis("BUY", 60.0), _empty_snap())
        self.assertIn("disclaimer", result)
        self.assertIn("estimate", result["disclaimer"].lower())


if __name__ == "__main__":
    unittest.main()