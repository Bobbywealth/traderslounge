import unittest

from scanner.data_types import Candle, Direction
from scanner.modules import liquidity
from tests.fixtures import zigzag


class TestLiquidity(unittest.TestCase):
    def _two_days(self, prev_low, prev_high):
        return [
            Candle(1_700_000_000, prev_low + 0.5, prev_high, prev_low, prev_low + 1.0),
            Candle(1_700_086_400, prev_low + 1.0, prev_high, prev_low - 0.1, prev_low + 0.5),
        ]

    def test_buy_sweep_detected(self):
        ltf = zigzag([(10, +0.5), (4, -0.5)], 100.0)
        # Inject a sweep candle: wicks below prev day low (97), closes above it
        sweep = Candle(ltf[-1].time + 3600, 100.0, 100.5, 96.5, 100.2)
        ltf.append(sweep)
        d1 = self._two_days(prev_low=97.0, prev_high=105.0)
        r = liquidity.evaluate(ltf, d1, Direction.BUY)
        self.assertEqual(r.points, liquidity.MAX_POINTS)
        self.assertEqual(r.direction, Direction.BUY)

    def test_no_sweep_zero(self):
        ltf = zigzag([(10, +0.5), (4, +0.1)], 100.0)
        d1 = self._two_days(prev_low=90.0, prev_high=200.0)
        r = liquidity.evaluate(ltf, d1, Direction.BUY)
        self.assertEqual(r.points, 0)


if __name__ == "__main__":
    unittest.main()
