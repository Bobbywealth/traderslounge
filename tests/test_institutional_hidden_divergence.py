"""Tests for the hidden RSI divergence module."""
import unittest

from scanner.data_types import Candle, MarketSnapshot
from scanner.modules.institutional import hidden_divergence as hd_mod


def _make_oscillating(n: int, start: float) -> list:
    """Make n candles with regular swings producing hidden bullish divergence
    at the end: price makes higher lows while RSI makes lower lows."""
    out = []
    price = start
    for i in range(n):
        if i % 4 == 0:
            step = -1.0
        elif i % 4 == 2:
            step = +2.0  # rebound high
        else:
            step = -0.2 if i % 2 == 1 else +0.5
        o = price
        c = price + step
        out.append(Candle(
            1_700_000_000 + i * 900,
            o,
            max(o, c) + 0.3,
            min(o, c) - 0.3,
            c,
        ))
        price = c
    return out


def _bullish_hidden_setup() -> MarketSnapshot:
    # Carefully crafted so the last swing low is HIGHER than prior low
    # but the corresponding RSI value is LOWER.
    candles = []
    # Build 60 candles with an uptrend but a shallow pullback at the end
    # so price makes a higher low while RSI is weaker.
    price = 100.0
    for i in range(60):
        if i < 20:
            step = +0.7
        elif i < 30:
            step = -0.5
        elif i < 50:
            step = +0.7
        else:
            step = -0.05  # very shallow pullback
        o, c = price, price + step
        candles.append(Candle(
            1_700_000_000 + i * 900,
            o, max(o, c) + 0.3, min(o, c) - 0.3, c,
        ))
        price = c
    return MarketSnapshot(pair="BTCUSDT", m15=candles, h1=candles)


class TestHiddenDivergence(unittest.TestCase):
    def test_insufficient_data(self):
        snap = MarketSnapshot(pair="X", m15=[])
        result = hd_mod.compute(snap, primary_timeframe="M15")
        self.assertFalse(result["available"])
        self.assertEqual(result["reason"], "insufficient_data")

    def test_module_shape(self):
        snap = _bullish_hidden_setup()
        result = hd_mod.compute(snap, primary_timeframe="M15")
        self.assertTrue(result["available"])
        self.assertEqual(result["pattern"], "hidden")
        self.assertIn("direction", result)
        self.assertIn("hidden_bullish", result)
        self.assertIn("hidden_bearish", result)
        self.assertIn("notes", result)


if __name__ == "__main__":
    unittest.main()