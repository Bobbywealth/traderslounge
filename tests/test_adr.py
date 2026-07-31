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

    def test_adr_is_mean_range_of_completed_days(self):
        # Today prints a huge range; it must not inflate the average itself.
        d1 = self._build(100, 110.0, 90.0, 105.0)
        snap = adr_calculator.snapshot(d1)
        self.assertAlmostEqual(snap.adr, 2.0, places=6)
        self.assertAlmostEqual(snap.current_range, 20.0, places=6)

    def test_projections_measure_from_todays_extremes(self):
        d1 = self._build(100, 100.3, 99.8, 100.1)
        snap = adr_calculator.snapshot(d1)
        self.assertAlmostEqual(snap.adr_high, 101.8, places=6)  # low + ADR
        self.assertAlmostEqual(snap.adr_low, 98.3, places=6)  # high - ADR

    def test_flat_days_are_ignored_in_the_average(self):
        d1 = self._build(100, 100.3, 99.8, 100.1)
        d1[5] = Candle(d1[5].time, 100.0, 100.0, 100.0, 100.0)  # holiday bar
        snap = adr_calculator.snapshot(d1)
        self.assertAlmostEqual(snap.adr, 2.0, places=6)

    def test_full_points_when_room_to_run(self):
        d1 = self._build(100, 100.3, 99.8, 100.1)  # tiny daily range so far
        r = adr_calculator.evaluate(d1, Direction.BUY)
        self.assertEqual(r.points, adr_calculator.MAX_POINTS)

    def test_zero_for_buy_near_adr_high(self):
        # ADR 2.0, day low 99.9 → adr_high 101.9, tolerance 0.3.
        d1 = self._build(100, 101.9, 99.9, 101.85)
        r = adr_calculator.evaluate(d1, Direction.BUY)
        self.assertEqual(r.points, 0)

    def test_zero_for_sell_near_adr_low(self):
        # ADR 2.0, day high 100.4 → adr_low 98.4, tolerance 0.3.
        d1 = self._build(100, 100.4, 98.4, 98.45)
        r = adr_calculator.evaluate(d1, Direction.SELL)
        self.assertEqual(r.points, 0)

    def test_exhausted_gets_half_points(self):
        # current_range > 80% of ADR but not extreme position
        d1 = self._build(100, 101.0, 99.2, 100.0)  # range 1.8 of ~2.0
        r = adr_calculator.evaluate(d1, Direction.BUY)
        self.assertEqual(r.points, adr_calculator.MAX_POINTS // 2)


if __name__ == "__main__":
    unittest.main()
