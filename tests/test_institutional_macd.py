"""Tests for the MACD interpretation module."""
import unittest

from scanner.data_types import Candle, MarketSnapshot
from scanner.modules.institutional import macd_interpret as macd_mod


def _make_uptrend(n: int, start: float, step: float = 0.7) -> list:
    out = []
    price = start
    for i in range(n):
        o, c = price, price + step
        out.append(Candle(
            1_700_000_000 + i * 900,
            o, max(o, c) + 0.3, min(o, c) - 0.3, c,
        ))
        price = c
    return out


def _make_downtrend(n: int, start: float, step: float = -0.7) -> list:
    return _make_uptrend(n, start, step=step)


class TestMACDInterpret(unittest.TestCase):
    def test_insufficient_data(self):
        snap = MarketSnapshot(pair="X", m15=[])
        result = macd_mod.compute(snap, "M15")
        self.assertFalse(result["available"])
        self.assertEqual(result["reason"], "insufficient_data")

    def test_uptrend_produces_above_zero_and_recent_bullish_cross(self):
        candles = _make_uptrend(120, 100.0, step=0.5)
        snap = MarketSnapshot(pair="X", m15=candles, h1=candles)
        result = macd_mod.compute(snap, "M15")
        self.assertTrue(result["available"])
        self.assertEqual(result["side_of_zero"], "above")
        self.assertIn(result["crossover_state"], ("above", "bullish_recent"))
        # Histogram momentum is one of the three valid values.
        self.assertIn(result["histogram_momentum"], ("rising", "falling", "flat"))

    def test_downtrend_produces_below_zero(self):
        candles = _make_downtrend(120, 200.0, step=-0.5)
        snap = MarketSnapshot(pair="X", m15=candles, h1=candles)
        result = macd_mod.compute(snap, "M15")
        self.assertTrue(result["available"])
        self.assertEqual(result["side_of_zero"], "below")
        self.assertIn(result["crossover_state"], ("below", "bearish_recent"))
        self.assertIn(result["histogram_momentum"], ("rising", "falling", "flat"))

    def test_required_fields_present(self):
        candles = _make_uptrend(60, 100.0)
        snap = MarketSnapshot(pair="X", m15=candles, h1=candles)
        result = macd_mod.compute(snap, "M15")
        for key in ("line", "signal", "histogram", "crossover_state",
                    "histogram_momentum", "divergence_hint", "side_of_zero"):
            self.assertIn(key, result)


if __name__ == "__main__":
    unittest.main()