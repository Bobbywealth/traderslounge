import unittest

from scanner.broker import NullBroker, PaperBroker
from scanner.data_types import Direction
from scanner.risk_manager import TradePlan


def _plan(pair="XAUUSD", direction=Direction.BUY, entry=1900.0, sl=1880.0,
          tp1=1920.0, tp2=1960.0, tp3=2000.0, lot_size=0.10):
    return TradePlan(
        pair=pair, direction=direction, entry=entry, stop_loss=sl,
        tp1=tp1, tp2=tp2, tp3=tp3, lot_size=lot_size,
        risk_usd=50.0, sl_pips=200.0, rr_to_tp1=1.0, rr_to_tp2=3.0,
    )


class TestPaperBroker(unittest.TestCase):
    def test_place_order_creates_position(self):
        b = PaperBroker(starting_balance_usd=10_000)
        pos = b.place_market_order(_plan())
        self.assertEqual(pos.pair, "XAUUSD")
        self.assertEqual(pos.direction, Direction.BUY)
        self.assertEqual(pos.lot_size, 0.10)
        self.assertEqual(len(b.list_positions()), 1)

    def test_modify_stop_loss(self):
        b = PaperBroker()
        pos = b.place_market_order(_plan())
        b.modify_stop_loss(pos.id, 1895.0)
        self.assertEqual(b.list_positions()[0].stop_loss, 1895.0)

    def test_close_full(self):
        b = PaperBroker()
        pos = b.place_market_order(_plan())
        b.close_position(pos.id, 1.0)
        self.assertEqual(b.list_positions(), [])

    def test_close_partial(self):
        b = PaperBroker()
        pos = b.place_market_order(_plan(lot_size=1.0))
        b.close_position(pos.id, 0.5)
        positions = b.list_positions()
        self.assertEqual(len(positions), 1)
        self.assertAlmostEqual(positions[0].lot_size, 0.5)
        self.assertEqual(positions[0].status, "partially_closed")

    def test_close_invalid_fraction(self):
        b = PaperBroker()
        pos = b.place_market_order(_plan())
        with self.assertRaises(ValueError):
            b.close_position(pos.id, 0)
        with self.assertRaises(ValueError):
            b.close_position(pos.id, 1.5)

    def test_modify_unknown_id(self):
        b = PaperBroker()
        with self.assertRaises(KeyError):
            b.modify_stop_loss("nope", 1.0)

    def test_balance(self):
        b = PaperBroker(starting_balance_usd=5_000)
        self.assertEqual(b.get_balance(), 5_000)


class TestNullBroker(unittest.TestCase):
    def test_place_order_raises(self):
        with self.assertRaises(RuntimeError):
            NullBroker().place_market_order(_plan())

    def test_list_positions_empty(self):
        self.assertEqual(NullBroker().list_positions(), [])


if __name__ == "__main__":
    unittest.main()
