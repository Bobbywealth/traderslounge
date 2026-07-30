import unittest

from scanner.data_types import Swing
from scanner.modules.harmonic import detect_from_swings


def swings(prices, first_type="low"):
    out = []
    kind = first_type
    for i, price in enumerate(prices):
        out.append(Swing(index=i, time=1_700_000_000 + i * 60,
                         price=price, type=kind))
        kind = "high" if kind == "low" else "low"
    return out


class TestHarmonicDetector(unittest.TestCase):
    def test_bullish_gartley(self):
        # XA=100, AB/XA=.618, BC/AB=.5, CD/BC~1.54, AD/XA=.786
        result = detect_from_swings(swings([0.0, 100.0, 38.2, 69.1, 21.4]))
        self.assertIsNotNone(result)
        self.assertEqual(result["name"], "Gartley")
        self.assertEqual(result["direction"], "bullish")
        self.assertAlmostEqual(result["prz"], 21.4)
        self.assertEqual(result["status"], "candidate")
        self.assertFalse(result["validated"])
        self.assertFalse(result["forward_validation"]["available"])
        self.assertEqual(result["pivot_coordinates"]["D"]["price"], 21.4)
        self.assertIn("target", result["ratio_validation"]["ab_xa"])
        self.assertIn("tolerance", result["ratio_validation"]["ab_xa"])
        self.assertIn("error", result["ratio_validation"]["ab_xa"])
        self.assertIn("lower", result["prz_zone"])
        self.assertEqual(result["invalidation"]["price"], 0.0)
        self.assertIn("deductions", result["geometry_quality"])
        self.assertIn("alternative", result)

    def test_bearish_gartley(self):
        result = detect_from_swings(
            swings([100.0, 0.0, 61.8, 30.9, 78.6], first_type="high")
        )
        self.assertIsNotNone(result)
        self.assertEqual(result["name"], "Gartley")
        self.assertEqual(result["direction"], "bearish")

    def test_insufficient_swings(self):
        self.assertIsNone(detect_from_swings(swings([0, 100, 50, 75])))

    def test_non_matching_ratios(self):
        self.assertIsNone(detect_from_swings(swings([0, 100, 95, 10, 90])))


if __name__ == "__main__":
    unittest.main()
