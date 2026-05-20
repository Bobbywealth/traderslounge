import unittest

from scanner.indicators import ema, rsi, atr, detect_swings
from tests.fixtures import trend_candles, zigzag


class TestIndicators(unittest.TestCase):
    def test_ema_uptrend_rises(self):
        out = ema([1.0, 2.0, 3.0, 4.0, 5.0], 3)
        self.assertEqual(len(out), 5)
        for i in range(1, len(out)):
            self.assertGreater(out[i], out[i - 1])

    def test_rsi_strong_uptrend_overbought(self):
        closes = [100 + i for i in range(40)]
        series = rsi(closes, 14)
        self.assertGreaterEqual(series[-1], 70)

    def test_rsi_strong_downtrend_oversold(self):
        closes = [200 - i for i in range(40)]
        series = rsi(closes, 14)
        self.assertLessEqual(series[-1], 30)

    def test_atr_positive_for_ranging(self):
        candles = trend_candles(30, 100, 1.0)
        self.assertIsNotNone(atr(candles, 14))
        self.assertGreater(atr(candles, 14), 0)

    def test_detect_swings_finds_pivots_in_zigzag(self):
        candles = zigzag([(10, +1.0), (8, -1.0), (10, +1.0)], 100.0)
        swings = detect_swings(candles, left_right=2)
        types = [s.type for s in swings]
        # Should alternate at least once
        self.assertIn("high", types)
        self.assertIn("low", types)


if __name__ == "__main__":
    unittest.main()
