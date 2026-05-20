import unittest

from scanner.data_types import Direction
from scanner.modules import rsi_filter
from tests.fixtures import trend_candles


class TestRsiFilter(unittest.TestCase):
    def test_buy_oversold_full_points(self):
        # Strong downtrend pushes RSI well below 30; we then check BUY
        # (the spec: RSI oversold confirms a counter-trend BUY reversal idea)
        candles = trend_candles(40, 200, -1.0)
        r = rsi_filter.evaluate(candles, Direction.BUY)
        self.assertEqual(r.points, rsi_filter.MAX_POINTS)

    def test_sell_overbought_full_points(self):
        candles = trend_candles(40, 100, +1.0)
        r = rsi_filter.evaluate(candles, Direction.SELL)
        self.assertEqual(r.points, rsi_filter.MAX_POINTS)

    def test_no_confirmation_zero(self):
        candles = trend_candles(40, 100, +0.05)  # gentle, RSI mid
        r = rsi_filter.evaluate(candles, Direction.BUY)
        self.assertEqual(r.points, 0)


if __name__ == "__main__":
    unittest.main()
