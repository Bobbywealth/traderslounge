"""TradeManager → repository hook tests.

Existing tests in test_trade_manager.py cover the no-repo case. These
verify that positions and closed trades are written to repos on every
state transition.
"""
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
from scanner.trade_repo import NullClosedTradeRepository, NullPositionRepository


def _sig(pair="XAUUSD", direction=Direction.BUY, score=72, tier=Tier.STRONG,
         entry=1900.0, sl=1880.0, tp1=1920.0, tp2=1960.0, tp3=2000.0):
    return Signal(
        pair=pair, direction=direction, entry=entry, stop_loss=sl,
        tp1=tp1, tp2=tp2, tp3=tp3,
        confidence_score=score, tier=tier,
        reasons=[], risk_level="Low", session="London",
        adr_status="", htf_bias=direction.value, pattern="",
    )


def _make(price=None):
    broker = PaperBroker(starting_balance_usd=10_000)
    risk = RiskManager(risk_per_trade_pct=0.5)
    tmp = tempfile.mkdtemp()
    kill = KillSwitch(Path(tmp) / "kill")
    pos_repo = NullPositionRepository()
    closed_repo = NullClosedTradeRepository()
    oracle = lambda pair: price.get(pair) if isinstance(price, dict) else price
    tm = TradeManager(
        broker=broker, risk=risk, kill_switch=kill, price_oracle=oracle,
        position_repo=pos_repo, closed_trade_repo=closed_repo,
    )
    return tm, broker, pos_repo, closed_repo


class TestPersistenceOnEntry(unittest.TestCase):
    def test_position_upserted_on_open(self):
        tm, _, pos_repo, _ = _make()
        tm.on_signal(_sig())
        self.assertEqual(len(pos_repo.upserts), 1)
        self.assertEqual(pos_repo.upserts[0].pair, "XAUUSD")
        self.assertEqual(pos_repo.upserts[0].direction, Direction.BUY)

    def test_no_persist_when_rejected(self):
        tm, _, pos_repo, closed_repo = _make()
        tm.on_signal(_sig(tier=Tier.GOOD, score=55))
        self.assertEqual(pos_repo.upserts, [])
        self.assertEqual(closed_repo.saved, [])


class TestPersistenceOnTp1(unittest.TestCase):
    def test_tp1_hit_writes_second_upsert_no_closed_trade(self):
        tm, _, pos_repo, closed_repo = _make(price={"XAUUSD": 1925.0})
        tm.on_signal(_sig(entry=1900, sl=1880, tp1=1920, tp2=1960))
        tm.manage_open_positions()
        # Two upserts: open + TP1 update
        self.assertGreaterEqual(len(pos_repo.upserts), 2)
        # SL on the second upsert should be at entry (BE)
        self.assertAlmostEqual(pos_repo.upserts[-1].stop_loss, 1900.0)
        # Position is still open after TP1 — no closed_trade yet
        self.assertEqual(closed_repo.saved, [])


class TestPersistenceOnTp2(unittest.TestCase):
    def test_tp2_after_tp1_writes_closed_trade(self):
        # Step 1: TP1 hits at 1925. Step 2: TP2 hits at 1965.
        prices = {"XAUUSD": 1925.0}
        tm, broker, pos_repo, closed_repo = _make(price=prices)
        tm.on_signal(_sig(entry=1900, sl=1880, tp1=1920, tp2=1960))
        tm.manage_open_positions()
        # Now bump price up to TP2 and re-manage
        prices["XAUUSD"] = 1965.0
        tm.manage_open_positions()
        self.assertEqual(len(closed_repo.saved), 1)
        trade = closed_repo.saved[0]
        self.assertEqual(trade["outcome"], "tp2")
        self.assertGreater(trade["pnl_usd"], 0)
        self.assertGreater(trade["r_multiple"], 0)
        # Position closed
        self.assertEqual(broker.list_positions(), [])
        # Position repo got close() called
        self.assertEqual(len(pos_repo.closes), 1)


class TestPersistenceOnSl(unittest.TestCase):
    def test_sl_hit_writes_loss_closed_trade(self):
        # SL is at 1880, price drops to 1870
        tm, _, _, closed_repo = _make(price={"XAUUSD": 1870.0})
        tm.on_signal(_sig(entry=1900, sl=1880, tp1=1920, tp2=1960))
        tm.manage_open_positions()
        self.assertEqual(len(closed_repo.saved), 1)
        trade = closed_repo.saved[0]
        self.assertEqual(trade["outcome"], "sl")
        self.assertLess(trade["pnl_usd"], 0)
        # r is between -1.0 and 0; exact value depends on lot rounding.
        self.assertLess(trade["r_multiple"], 0)
        self.assertGreater(trade["r_multiple"], -1.1)

    def test_sl_after_tp1_writes_breakeven_closed_trade(self):
        # TP1 hits, SL trails to entry, then price drops back below entry
        prices = {"XAUUSD": 1925.0}
        tm, _, _, closed_repo = _make(price=prices)
        tm.on_signal(_sig(entry=1900, sl=1880, tp1=1920, tp2=1960))
        tm.manage_open_positions()
        prices["XAUUSD"] = 1899.0  # SL at entry = 1900 → hit
        tm.manage_open_positions()
        self.assertEqual(len(closed_repo.saved), 1)
        trade = closed_repo.saved[0]
        self.assertEqual(trade["outcome"], "tp1_then_be")
        # Net P&L should be positive (kept the TP1 half-profit)
        self.assertGreater(trade["pnl_usd"], 0)


if __name__ == "__main__":
    unittest.main()
