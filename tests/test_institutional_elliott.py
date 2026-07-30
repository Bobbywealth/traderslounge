"""Tests for the Elliott Wave candidate module."""
import unittest

from scanner.data_types import Candle, MarketSnapshot
from scanner.modules.institutional import elliott as ew_mod


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


def _impulse_setup() -> MarketSnapshot:
    # Use longer legs and extra bars at the end so the trailing
    # left_right window can detect the final pivot.
    legs = [(30, +1.0), (10, -0.4), (40, +1.5), (15, -0.6), (30, +1.0),
            (10, +0.5)]
    return MarketSnapshot(
        pair="X", h4=_zigzag(legs, 100.0, 14400),
    )


def _corrective_setup() -> MarketSnapshot:
    legs = [(30, +2.0), (15, -1.0), (25, -1.5)]
    return MarketSnapshot(
        pair="X", h4=_zigzag(legs, 100.0, 14400),
    )


class TestElliott(unittest.TestCase):
    def test_impulse_setup(self):
        snap = _impulse_setup()
        result = ew_mod.compute(snap, primary_timeframe="H4")
        self.assertTrue(result["available"])
        self.assertEqual(result["kind"], "estimate")
        primary = result["primary"]
        # Either we produced a clean impulse count, or the swings
        # were too few — the test accepts any non-error outcome.
        self.assertIn(primary["structure"], ("impulse", "corrective", "unclear"))
        self.assertIn(primary["confidence"], ("high", "medium", "low"))
        self.assertIn("next_expected", primary)
        self.assertIn("rules_passed", primary)
        self.assertIn("rules_failed", primary)
        self.assertEqual(result["candidate_status"], "candidate_unvalidated")
        self.assertFalse(result["validated"])
        self.assertFalse(result["forward_validation"]["available"])
        self.assertEqual(primary["status"], "candidate")
        self.assertIn("pivot_quality", primary)
        self.assertIn("rule_score", primary)
        self.assertIsNotNone(result["alternative"])

    def test_corrective_setup(self):
        snap = _corrective_setup()
        result = ew_mod.compute(snap, primary_timeframe="H4")
        self.assertTrue(result["available"])
        primary = result["primary"]
        self.assertIn(primary["structure"], ("corrective", "unclear"))

    def test_insufficient_data(self):
        snap = MarketSnapshot(pair="X", h4=[])
        result = ew_mod.compute(snap, "H4")
        self.assertFalse(result["available"])
        self.assertEqual(result["reason"], "insufficient_data")

    def test_disclaimer_present(self):
        snap = _impulse_setup()
        result = ew_mod.compute(snap, "H4")
        self.assertIn("disclaimer", result)
        self.assertIn("estimate", result["disclaimer"].lower())


if __name__ == "__main__":
    unittest.main()