import unittest

from scanner.data_types import Direction
from scanner.modules import market_structure
from tests.fixtures import zigzag


class TestMarketStructure(unittest.TestCase):
    def test_bullish_trend_supports_buy(self):
        # Series of HHs and HLs
        candles = zigzag([(8, +1.0), (4, -0.5), (10, +1.0), (4, -0.5), (10, +1.0)], 100.0)
        r = market_structure.evaluate(candles, Direction.BUY)
        self.assertGreater(r.points, 0)
        self.assertEqual(r.direction, Direction.BUY)

    def test_bearish_trend_blocks_buy(self):
        candles = zigzag([(8, -1.0), (4, +0.5), (10, -1.0), (4, +0.5), (10, -1.0)], 200.0)
        r = market_structure.evaluate(candles, Direction.BUY)
        self.assertEqual(r.points, 0)


if __name__ == "__main__":
    unittest.main()
