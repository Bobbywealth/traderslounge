import os
import tempfile
import unittest
from pathlib import Path

from scanner.broker import PaperBroker
from scanner.data_types import Direction, Tier
from scanner.kill_switch import KillSwitch
from scanner.risk_manager import RiskManager
from scanner.signal import Signal
from scanner.trade_manager import TradeManager


def _sig(pair="XAUUSD", direction=Direction.BUY, score=72, tier=Tier.STRONG,
         entry=1900.0, sl=1880.0, tp1=1920.0, tp2=1960.0, tp3=2000.0):
    return Signal(
        pair=pair, direction=direction, entry=entry, stop_loss=sl,
        tp1=tp1, tp2=tp2, tp3=tp3,
        confidence_score=score, tier=tier,
        reasons=[], risk_level="Low", session="London",
        adr_status="", htf_bias=direction.value, pattern="",
    )


def _make_manager(price=None, kill_path=None):
    broker = PaperBroker(starting_balance_usd=10_000)
    risk = RiskManager(risk_per_trade_pct=0.5)
    if kill_path is None:
        tmp = tempfile.mkdtemp()
        kill_path = Path(tmp) / "kill"
    kill = KillSwitch(kill_path)
    oracle = lambda pair: price.get(pair) if isinstance(price, dict) else price
    tm = TradeManager(broker=broker, risk=risk, kill_switch=kill, price_oracle=oracle)
    return tm, broker, kill


class TestTradeManagerEntry(unittest.TestCase):
    def test_accepts_strong_signal(self):
        tm, broker, _ = _make_manager()
        d = tm.on_signal(_sig())
        self.assertTrue(d.accepted, d.reason)
        self.assertEqual(len(broker.list_positions()), 1)

    def test_rejects_below_min_tier(self):
        tm, broker, _ = _make_manager()
        d = tm.on_signal(_sig(tier=Tier.GOOD, score=55))
        self.assertFalse(d.accepted)
        self.assertEqual(len(broker.list_positions()), 0)

    def test_kill_switch_blocks_orders(self):
        tm, broker, kill = _make_manager()
        kill.engage("paused for news")
        d = tm.on_signal(_sig())
        self.assertFalse(d.accepted)
        self.assertIn("Kill switch", d.reason)
        self.assertEqual(broker.list_positions(), [])

    def test_risk_rejection_propagates(self):
        # Tiny SL → below min_sl_pips
        tm, broker, _ = _make_manager()
        d = tm.on_signal(_sig(entry=1900.0, sl=1899.99))
        self.assertFalse(d.accepted)
        self.assertEqual(broker.list_positions(), [])


class TestTradeManagerExits(unittest.TestCase):
    def test_tp1_hit_triggers_partial_close_and_sl_to_be(self):
        tm, broker, _ = _make_manager(price={"XAUUSD": 1925.0})
        tm.on_signal(_sig(entry=1900, sl=1880, tp1=1920, tp2=1960, tp3=2000))
        pos_before = broker.list_positions()[0]
        original_lots = pos_before.lot_size
        actions = tm.manage_open_positions()
        self.assertEqual(len(actions), 1)
        pos_after = broker.list_positions()[0]
        # Partial close: half the lots gone
        self.assertAlmostEqual(pos_after.lot_size, original_lots * 0.5)
        # SL moved to entry (break-even)
        self.assertEqual(pos_after.stop_loss, 1900.0)
        self.assertEqual(pos_after.status, "partially_closed")

    def test_tp1_only_actioned_once(self):
        tm, broker, _ = _make_manager(price={"XAUUSD": 1925.0})
        tm.on_signal(_sig())
        tm.manage_open_positions()
        actions2 = tm.manage_open_positions()
        self.assertEqual(actions2, [])

    def test_below_tp1_no_action(self):
        tm, broker, _ = _make_manager(price={"XAUUSD": 1905.0})
        tm.on_signal(_sig(entry=1900, sl=1880, tp1=1920))
        actions = tm.manage_open_positions()
        self.assertEqual(actions, [])

    def test_sell_tp1_hit_when_price_falls(self):
        tm, broker, _ = _make_manager(price={"XAUUSD": 1880.0})
        tm.on_signal(_sig(direction=Direction.SELL,
                          entry=1900, sl=1920, tp1=1885, tp2=1840, tp3=1800))
        actions = tm.manage_open_positions()
        self.assertEqual(len(actions), 1)


if __name__ == "__main__":
    unittest.main()
