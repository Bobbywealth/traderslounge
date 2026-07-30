"""Tests for the day/swing/position trade plans module."""
import unittest

from scanner.data_types import Candle, MarketSnapshot
from scanner.modules.institutional import trade_plans as tp_mod


def _make_candles(n: int, start: float, step: float, step_seconds: int) -> list:
    out = []
    price = start
    for i in range(n):
        o, c = price, price + step
        out.append(Candle(
            1_700_000_000 + i * step_seconds,
            o, max(o, c) + 0.3, min(o, c) - 0.3, c,
        ))
        price = c
    return out


def _bullish_snap() -> MarketSnapshot:
    return MarketSnapshot(
        pair="BTCUSDT",
        d1=_make_candles(60, 100.0, 1.0, 86400),
        h4=_make_candles(120, 100.0, 0.5, 14400),
        h1=_make_candles(120, 100.0, 0.3, 3600),
        m15=_make_candles(200, 100.0, 0.1, 900),
    )


def _buy_analysis() -> dict:
    return {
        "direction": "BUY",
        "current_price": 100.0,
        "trade_plan": {"entry": 100.0, "stop": 95.0, "tp1": 110.0, "tp2": 115.0},
        "indicators": {
            "fibonacci": {"levels": {"1.272": 110.0, "1.618": 115.0, "2.618": 125.0}},
        },
    }


class TestTradePlans(unittest.TestCase):
    def test_three_variants_emitted(self):
        result = tp_mod.compute(_buy_analysis(), _bullish_snap())
        self.assertTrue(result["available"])
        self.assertIn("plans", result)
        self.assertEqual(set(result["plans"].keys()), {"day", "swing", "position"})
        self.assertEqual(result["canonical_horizon"], "swing")

    def test_eligible_when_canonical_entry_present(self):
        result = tp_mod.compute(_buy_analysis(), _bullish_snap())
        self.assertTrue(result["eligible_for_publication"])

    def test_fallback_entry_marks_reference_only(self):
        a = _buy_analysis()
        a["trade_plan"] = None
        a["current_price"] = 0
        result = tp_mod.compute(a, _bullish_snap())
        self.assertTrue(result["available"])
        self.assertEqual(result["entry_source"], "snapshot_last_close")
        self.assertFalse(result["eligible_for_publication"])

    def test_buy_plan_levels(self):
        result = tp_mod.compute(_buy_analysis(), _bullish_snap())
        day = result["plans"]["day"]
        self.assertGreater(day["entry"], 0)
        self.assertLess(day["stop"], day["entry"])
        self.assertGreater(day["tp1"], day["entry"])

    def test_missing_atr_marks_plan_ineligible(self):
        snap = MarketSnapshot(pair="X")  # all empty
        result = tp_mod.compute(_buy_analysis(), snap)
        # Without candle data the day plan should be ineligible.
        if "day" in result["plans"]:
            self.assertFalse(result["plans"]["day"]["eligible"])


if __name__ == "__main__":
    unittest.main()