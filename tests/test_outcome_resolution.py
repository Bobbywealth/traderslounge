"""Unit tests for outcome resolution in SetupMonitor.

Bobby 2026-08-11: the system needs to actually resolve setups (TP1/TP2/TP3,
invalidation, expiry) into a closed journal entry with outcome + r_multiple
so Trading Memory and the Performance page have real data.
"""
import time
import unittest
from unittest.mock import MagicMock

from scanner.autonomy.journal.trading_journal import TradingJournal
from scanner.autonomy.monitoring.setup_monitor import SetupMonitor
from scanner.autonomy.setup.setup_lifecycle import (
    SetupLifecycle,
    SetupRecord,
    SetupState,
)


def _make_setup(symbol="XAUUSD", direction="BUY", entry_low=4400.0, entry_high=4410.0,
                stop_loss=4380.0, tp1=4430.0, tp2=4470.0, tp3=4500.0,
                invalidation_price=4375.0, expires_at=None):
    setup = SetupRecord(
        setup_id="CX-XAUUSD-H1-TEST",
        symbol=symbol,
        asset_class="metals",
        direction=direction,
        timeframe="H1",
        entry_low=entry_low,
        entry_high=entry_high,
        stop_loss=stop_loss,
        tp1=tp1,
        tp2=tp2,
        tp3=tp3,
        invalidation_price=invalidation_price,
        expires_at=expires_at,
    )
    setup.state = SetupState.WATCH
    return setup


class TestOutcomeResolution(unittest.TestCase):
    def setUp(self):
        self.lifecycle = SetupLifecycle()
        self.journal = TradingJournal()
        self.monitor = SetupMonitor(self.lifecycle)
        self.monitor.attach_journal(self.journal)

    def _register_setup(self, setup, state=None):
        self.lifecycle._setups[setup.setup_id] = setup
        if state is not None:
            setup.state = state
        self.journal.create_entry(
            setup_id=setup.setup_id, symbol=setup.symbol, asset_class=setup.asset_class,
            direction=setup.direction, timeframe=setup.timeframe,
            strategy_type="confluence", engine_version="2.0.0-alpha",
            score=70, score_components={}, entry_price=(setup.entry_low + setup.entry_high) / 2,
            stop_loss=setup.stop_loss, tp1=setup.tp1, tp2=setup.tp2, tp3=setup.tp3,
        )

    def test_tp1_hit_records_win_outcome(self):
        setup = _make_setup()
        self._register_setup(setup, state=SetupState.POSITION_OPEN)
        # Price 4435 >= tp1 4430, BUY, R-multiple positive
        self.monitor.check_setup(setup.setup_id, 4435.0)
        entry = self.journal.get_entry(setup.setup_id)
        self.assertEqual(entry.outcome, "win")
        self.assertEqual(entry.exit_reason, "tp1")
        self.assertGreater(entry.r_multiple, 0)
        self.assertEqual(setup.state, SetupState.TP1)

    def test_invalidation_records_loss(self):
        setup = _make_setup()
        self._register_setup(setup)
        # Price 4370 < invalidation 4375, BUY -> loss
        self.monitor.check_setup(setup.setup_id, 4370.0)
        entry = self.journal.get_entry(setup.setup_id)
        self.assertEqual(entry.outcome, "invalidated")
        self.assertEqual(setup.state, SetupState.INVALIDATED)

    def test_sell_direction_sign_aware(self):
        setup = _make_setup(symbol="USDJPY", direction="SELL",
                             entry_low=150.0, entry_high=151.0, stop_loss=152.0,
                             tp1=148.0, tp2=145.0, tp3=140.0,
                             invalidation_price=153.0)
        self._register_setup(setup, state=SetupState.POSITION_OPEN)
        # Price 144 <= tp2 145, SELL, positive R-multiple (price moved in favor).
        # Sequential TP detection fires TP1 first (POSITION_OPEN -> TP1),
        # the next cycle would advance to TP2.
        self.monitor.check_setup(setup.setup_id, 144.0)
        entry = self.journal.get_entry(setup.setup_id)
        self.assertEqual(entry.outcome, "win")
        self.assertEqual(entry.exit_reason, "tp1")
        self.assertGreater(entry.r_multiple, 0)

    def test_expiry_records_expired_outcome(self):
        # Setup already past the expiry timestamp. Price is between entry
        # and tp1 so the approaching-entry short-circuit doesn't fire and
        # the TP-detection loop also doesn't trigger — leaving expiry to
        # be the only terminal event.
        setup = _make_setup(expires_at=time.time() - 100)
        self._register_setup(setup, state=SetupState.DEVELOPING)
        # DEVELOPING doesn't trigger 'approaching_entry' (which only fires
        # for WATCH); price 4420 is between entry midpoint 4405 and tp1 4430
        # so no TP hit either.
        self.monitor.check_setup(setup.setup_id, 4420.0)
        entry = self.journal.get_entry(setup.setup_id)
        self.assertEqual(entry.outcome, "expired")
        self.assertEqual(setup.state, SetupState.EXPIRED)

    def test_idempotent_on_repeat_poll(self):
        setup = _make_setup()
        self._register_setup(setup, state=SetupState.POSITION_OPEN)
        self.monitor.check_setup(setup.setup_id, 4435.0)
        first_exit_reason = self.journal.get_entry(setup.setup_id).exit_reason
        first_r = self.journal.get_entry(setup.setup_id).r_multiple
        # Poll again at a different price; outcome must not be overwritten.
        self.monitor.check_setup(setup.setup_id, 4445.0)
        entry = self.journal.get_entry(setup.setup_id)
        self.assertEqual(entry.exit_reason, first_exit_reason)
        self.assertEqual(entry.r_multiple, first_r)

    def test_no_outcome_without_journal_attached(self):
        setup = _make_setup()
        self.lifecycle._setups[setup.setup_id] = setup
        # No journal attached — must not crash.
        naked = SetupMonitor(self.lifecycle)
        alert = naked.check_setup(setup.setup_id, 4370.0)
        self.assertIsNotNone(alert)
        self.assertEqual(setup.state, SetupState.INVALIDATED)


if __name__ == "__main__":
    unittest.main()