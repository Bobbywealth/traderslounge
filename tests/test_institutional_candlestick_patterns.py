"""Tests for §9 Candlestick-patterns institutional module."""
import unittest

from scanner.modules.institutional import candlestick_patterns


def _analysis(direction: str = "BUY", macro_bias: str = "bullish",
              pattern_names=None) -> dict:
    patterns = [{"name": n} for n in (pattern_names or [])]
    return {
        "direction": direction,
        "indicators": {"patterns": patterns},
        "market_context": {"macro_bias": macro_bias},
    }


class TestCandlestickPatterns(unittest.TestCase):
    def test_empty_patterns(self):
        out = candlestick_patterns.compute(_analysis())
        self.assertTrue(out["available"])
        self.assertEqual(out["count"], 0)
        self.assertEqual(out["patterns"], [])

    def test_bullish_pattern_in_bullish_trend_high_confidence(self):
        out = candlestick_patterns.compute(_analysis(
            direction="BUY", macro_bias="bullish",
            pattern_names=["morning_star"],
        ))
        self.assertEqual(out["patterns"][0]["implication"], "bullish")
        self.assertEqual(out["patterns"][0]["confidence"], "high")

    def test_bearish_pattern_in_bullish_trend_low_confidence(self):
        out = candlestick_patterns.compute(_analysis(
            direction="BUY", macro_bias="bullish",
            pattern_names=["evening_star"],
        ))
        self.assertEqual(out["patterns"][0]["implication"], "bearish")
        self.assertEqual(out["patterns"][0]["confidence"], "low")

    def test_counts(self):
        out = candlestick_patterns.compute(_analysis(
            direction="BUY", macro_bias="bullish",
            pattern_names=["morning_star", "bullish_engulfing",
                           "hammer", "evening_star"],
        ))
        self.assertEqual(out["count"], 4)
        self.assertEqual(out["bullish_count"], 3)
        self.assertEqual(out["bearish_count"], 1)


if __name__ == "__main__":
    unittest.main()