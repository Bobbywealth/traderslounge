import unittest

from scanner.data_types import Candle, Direction
from scanner.modules import fibonacci
from tests.fixtures import zigzag


class TestFibonacci(unittest.TestCase):
    def test_buy_in_zone_with_confirmation_gets_full_points(self):
        # Initial dip (establishes a swing low), then up leg, then pullback
        # into 0.50-0.786 with bullish confirmation candle.
        # Up leg = 15 * 2.0 = 30; pullback = 11 * 2.0 = 22 → ~73% retrace.
        candles = zigzag([(5, -1.0), (15, +2.0), (11, -2.0)], 100.0)
        last = candles[-1]
        candles[-1] = Candle(last.time, last.open, last.high + 0.5, last.low, last.open + 0.5)
        r = fibonacci.evaluate(candles, Direction.BUY)
        self.assertEqual(r.points, fibonacci.MAX_POINTS,
                         f"got {r.points} reason={r.reason} details={r.details}")
        self.assertEqual(r.direction, Direction.BUY)

    def test_outside_zone_zero(self):
        candles = zigzag([(5, -1.0), (15, +2.0), (2, -2.0)], 100.0)  # ~13% retrace
        r = fibonacci.evaluate(candles, Direction.BUY)
        self.assertEqual(r.points, 0)

    def test_sell_in_zone_with_confirmation(self):
        candles = zigzag([(5, +1.0), (15, -2.0), (11, +2.0)], 200.0)
        last = candles[-1]
        candles[-1] = Candle(last.time, last.open, last.high, last.low - 0.5, last.open - 0.5)
        r = fibonacci.evaluate(candles, Direction.SELL)
        self.assertEqual(r.points, fibonacci.MAX_POINTS,
                         f"got {r.points} reason={r.reason} details={r.details}")


if __name__ == "__main__":
    unittest.main()
