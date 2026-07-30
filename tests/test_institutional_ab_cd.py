"""Tests for the AB=CD harmonic pattern module."""
import unittest

from scanner.data_types import Candle, MarketSnapshot
from scanner.modules.institutional import ab_cd as abc_mod


def _zigzag(legs, start: float, step_seconds: int) -> list:
    out = []
    price = start
    t = 1_700_000_000
    last = len(legs) - 1
    for li, (length, step) in enumerate(legs):
        for j in range(length):
            o, c = price, price + step
            hi = max(o, c) + 0.3
            lo = min(o, c) - 0.3
            if j == length - 1 and li < last:
                if step > 0:
                    hi += abs(step) * 2
                else:
                    lo -= abs(step) * 2
            out.append(Candle(t, o, hi, lo, c))
            price = c
            t += step_seconds
    return out


class TestABCD(unittest.TestCase):
    def test_module_shape(self):
        legs = [(15, +1.0), (5, -0.5), (15, +1.0), (5, -0.5), (15, +1.0)]
        snap = MarketSnapshot(
            pair="X", h1=_zigzag(legs, 100.0, 3600),
        )
        result = abc_mod.compute(snap, primary_timeframe="H1")
        self.assertTrue(result["available"])
        self.assertEqual(result["kind"], "estimate")
        self.assertIn("candidates", result)
        self.assertIn("disclaimer", result)
        self.assertIn("estimate", result["disclaimer"].lower())

    def test_insufficient_data(self):
        snap = MarketSnapshot(pair="X", h1=[])
        result = abc_mod.compute(snap, "H1")
        self.assertFalse(result["available"])
        self.assertEqual(result["reason"], "insufficient_data")

    def test_candidate_has_required_fields_when_present(self):
        # Build a precise bullish AB=CD pattern.
        legs = [(8, +2.0), (4, -1.0), (8, -2.0), (4, -1.0), (8, +2.0),
                (4, -1.0), (8, +2.0)]  # last 4 swings form a candidate
        snap = MarketSnapshot(
            pair="X", h1=_zigzag(legs, 100.0, 3600),
        )
        result = abc_mod.compute(snap, "H1")
        self.assertTrue(result["available"])
        for cand in result["candidates"]:
            for key in ("pattern", "direction", "ratio", "actual_ratio",
                        "bc_retrace_pct", "completion_pct", "pivots",
                        "projected_d"):
                self.assertIn(key, cand)
            self.assertEqual(cand["pattern"], "AB=CD")
            self.assertIn(cand["direction"], ("bullish", "bearish"))


if __name__ == "__main__":
    unittest.main()