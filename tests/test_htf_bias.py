import unittest

from scanner.data_types import Direction
from scanner.modules import htf_bias
from tests.fixtures import trend_candles


class TestHtfBias(unittest.TestCase):
    def test_all_bullish_gives_full_points(self):
        d1 = trend_candles(220, 100, 0.5)
        h4 = trend_candles(220, 100, 0.5)
        h1 = trend_candles(220, 100, 0.5)
        r = htf_bias.evaluate(d1, h4, h1)
        self.assertEqual(r.points, 20)
        self.assertEqual(r.direction, Direction.BUY)

    def test_all_bearish_gives_full_points_sell(self):
        d1 = trend_candles(220, 200, -0.5)
        h4 = trend_candles(220, 200, -0.5)
        h1 = trend_candles(220, 200, -0.5)
        r = htf_bias.evaluate(d1, h4, h1)
        self.assertEqual(r.points, 20)
        self.assertEqual(r.direction, Direction.SELL)

    def test_mixed_gives_zero(self):
        d1 = trend_candles(220, 100, 0.5)
        h4 = trend_candles(220, 200, -0.5)
        h1 = trend_candles(220, 100, 0.5)
        r = htf_bias.evaluate(d1, h4, h1)
        self.assertEqual(r.points, 0)
        self.assertEqual(r.direction, Direction.NEUTRAL)


if __name__ == "__main__":
    unittest.main()
