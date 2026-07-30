"""Tests for the multi-timeframe market structure module."""
import unittest

from scanner.data_types import Candle, MarketSnapshot
from scanner.modules.institutional import market_structure_mtf as mtf_mod


def _make_tf(legs, start: float, step_seconds: int) -> list:
    """Build candles with explicit pivot punches at leg boundaries."""
    out = []
    price = start
    t = 1_700_000_000
    last_leg_idx = len(legs) - 1
    for li, (length, step) in enumerate(legs):
        for j in range(length):
            o = price
            c = price + step
            hi = max(o, c) + 0.3
            lo = min(o, c) - 0.3
            if j == length - 1 and li < last_leg_idx:
                if step > 0:
                    hi += abs(step) * 2
                else:
                    lo -= abs(step) * 2
            out.append(Candle(t, o, hi, lo, c))
            price = c
            t += step_seconds
    return out


def _bullish_snapshot() -> MarketSnapshot:
    legs = [(20, +1.0), (8, -0.5), (25, +1.0), (8, -0.5), (25, +1.0),
            (8, -0.5), (20, +1.0)]
    return MarketSnapshot(
        pair="BTCUSDT",
        d1=_make_tf(legs, 100.0, 86400),
        h4=_make_tf(legs, 100.0, 14400),
        h1=_make_tf(legs, 100.0, 3600),
    )


def _bearish_snapshot() -> MarketSnapshot:
    legs = [(20, -1.0), (8, +0.5), (25, -1.0), (8, +0.5), (25, -1.0),
            (8, +0.5), (20, -1.0)]
    return MarketSnapshot(
        pair="BTCUSDT",
        d1=_make_tf(legs, 200.0, 86400),
        h4=_make_tf(legs, 200.0, 14400),
        h1=_make_tf(legs, 200.0, 3600),
    )


def _empty_snapshot() -> MarketSnapshot:
    return MarketSnapshot(
        pair="BTCUSDT",
        d1=[], h4=[], h1=[], m15=[],
    )


class TestMTFStructure(unittest.TestCase):
    def test_bullish_mtf_alignment(self):
        result = mtf_mod.compute(_bullish_snapshot())
        self.assertTrue(result["available"])
        self.assertEqual(result["kind"], "measured")
        comp = result["composite"]
        self.assertEqual(comp["trend"], "bullish")
        self.assertEqual(comp["agreement_pct"], 1.0)
        self.assertEqual(comp["conflicting_tfs"], [])

    def test_bearish_mtf_alignment(self):
        result = mtf_mod.compute(_bearish_snapshot())
        self.assertTrue(result["available"])
        self.assertEqual(result["composite"]["trend"], "bearish")
        self.assertEqual(result["composite"]["agreement_pct"], 1.0)

    def test_insufficient_data_returns_unavailable(self):
        result = mtf_mod.compute(_empty_snapshot())
        self.assertFalse(result["available"])
        self.assertEqual(result["reason"], "insufficient_data")

    def test_per_timeframe_includes_last_bos(self):
        result = mtf_mod.compute(_bullish_snapshot())
        for tf_data in result["per_timeframe"].values():
            self.assertIn("last_bos", tf_data)
            self.assertIn("last_choch", tf_data)
            self.assertIn("last_swing_label", tf_data)


if __name__ == "__main__":
    unittest.main()