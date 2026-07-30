"""Tests for the historical volatility module."""
import unittest

from scanner.data_types import Candle, MarketSnapshot
from scanner.modules.institutional import historical_volatility as hv_mod


def _make_candles(n: int, start: float, step: float) -> list:
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


class TestHistoricalVolatility(unittest.TestCase):
    def test_insufficient_data(self):
        snap = MarketSnapshot(pair="X", m15=[])
        result = hv_mod.compute(snap, "M15")
        self.assertFalse(result["available"])
        self.assertEqual(result["reason"], "insufficient_data")

    def test_module_shape(self):
        candles = _make_candles(120, 100.0, 0.7)
        snap = MarketSnapshot(pair="X", m15=candles, h1=candles)
        result = hv_mod.compute(snap, "M15")
        self.assertTrue(result["available"])
        self.assertEqual(result["kind"], "measured")
        for key in ("current_hv_annualized", "p20_annualized",
                    "p80_annualized", "regime", "window_bars", "lookback_bars"):
            self.assertIn(key, result)
        self.assertIn(result["regime"], ("compressed", "normal", "expanded"))

    def test_vol_regime_consistent(self):
        # Constant uptrend produces low variance → compressed.
        candles = _make_candles(120, 100.0, 0.5)
        snap = MarketSnapshot(pair="X", m15=candles, h1=candles)
        result = hv_mod.compute(snap, "M15")
        self.assertEqual(result["regime"], "compressed")


if __name__ == "__main__":
    unittest.main()