import unittest

from scanner.data_types import Candle, Direction
from scanner.modules import adr_calculator
from tests.fixtures import trend_candles


class TestAdr(unittest.TestCase):
    def _build(self, today_open, today_high, today_low, today_close):
        # 20 completed days with stable ~2.0 range
        completed = []
        t = 1_700_000_000
        for i in range(20):
            base = 100 + i * 0.1
            completed.append(Candle(t + i * 86400, base, base + 1.0, base - 1.0, base + 0.2))
        today = Candle(t + 20 * 86400, today_open, today_high, today_low, today_close)
        return completed + [today]

    def test_full_points_when_room_to_run(self):
        d1 = self._build(100, 100.3, 99.8, 100.1)  # tiny daily range so far
        r = adr_calculator.evaluate(d1, Direction.BUY)
        self.assertEqual(r.points, adr_calculator.MAX_POINTS)

    def test_zero_for_buy_near_adr_high(self):
        # ADR ~ 2.0, day open 100 → adr_high ~ 101. Close at 101.5
        d1 = self._build(100, 101.6, 99.9, 101.5)
        r = adr_calculator.evaluate(d1, Direction.BUY)
        self.assertEqual(r.points, 0)

    def test_zero_for_sell_near_adr_low(self):
        d1 = self._build(100, 100.1, 98.4, 98.5)
        r = adr_calculator.evaluate(d1, Direction.SELL)
        self.assertEqual(r.points, 0)

    def test_exhausted_gets_half_points(self):
        # current_range > 80% of ADR but not extreme position
        d1 = self._build(100, 101.0, 99.2, 100.0)  # range 1.8 of ~2.0
        r = adr_calculator.evaluate(d1, Direction.BUY)
        self.assertEqual(r.points, adr_calculator.MAX_POINTS // 2)


if __name__ == "__main__":
    unittest.main()
