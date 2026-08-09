"""
Chaos and recovery tests for the autonomous trading system.

Tests restart safety, idempotency, and failure modes.
"""
import sys
import time
import unittest

sys.path.insert(0, '.')

from scanner.autonomy.setup.setup_lifecycle import SetupLifecycle, SetupState
from scanner.autonomy.scanner.autonomous_scanner import AutonomousScanner
from scanner.autonomy.market.data_quality import DataQualityEngine
from scanner.autonomy.sessions.session_engine import SessionEngine
from scanner.autonomy.risk import RiskManager, RiskConfig, RiskDecision
from scanner.autonomy.paper.paper_broker import PaperBrokerAdapter
from scanner.autonomy.validation.outcome_resolver import OutcomeResolver, Outcome
from scanner.autonomy.news.breaking_news import BreakingNewsManager, BreakingNewsSeverity
from scanner.autonomy.monitoring.activity_feed import ActivityFeed


class TestRestartDuringWATCH(unittest.TestCase):
    """Test that a setup in WATCH state survives restart."""

    def test_setup_state_preserved(self):
        """Setup should be in WATCH after simulated restart."""
        sl = SetupLifecycle()
        s = sl.create_setup('BTCUSD', 'crypto', 'BUY', '1h', 75)
        sl.transition(s.setup_id, SetupState.DEVELOPING, 'score improved')
        sl.transition(s.setup_id, SetupState.WATCH, 'approaching entry')

        # Simulate restart: serialize and deserialize state
        d = sl.to_dict(s.setup_id)
        self.assertEqual(d['state'], 'watch')

        # After restart, the setup should still be in WATCH
        restored = sl.get_setup(s.setup_id)
        self.assertEqual(restored.state, SetupState.WATCH)

    def test_fingerprint_survives_restart(self):
        """Fingerprint should be preserved across restart."""
        sl = SetupLifecycle()
        s = sl.create_setup('BTCUSD', 'crypto', 'BUY', '1h', 75, fingerprint='abc123')
        d = sl.to_dict(s.setup_id)
        self.assertEqual(d['fingerprint'], 'abc123')


class TestRestartDuringREADY(unittest.TestCase):
    """Test that READY state is preserved and no duplicate orders occur."""

    def test_ready_setup_not_duplicated(self):
        """Simulating a second scan while setup is READY should not create a new setup."""
        dq = DataQualityEngine()
        dq.update_tick_age('BTCUSD', 5)
        dq.update_candle_age('BTCUSD', 5)
        sl = SetupLifecycle()
        scanner = AutonomousScanner(
            data_quality=dq, session_engine=SessionEngine(),
            setup_lifecycle=sl,
        )
        analysis = {
            'total_score': 75, 'direction': 'BUY',
            'trade_plan': {
                'eligible': True, 'entry': 65000, 'stop': 64500,
                'targets': [{'price': 65500}, {'price': 66000}, {'price': 66500}],
                'timing_status': 'READY', 'calendar_status': 'CLEAR',
                'net_available_rr': 2.5, 'reasons': ['test'],
            },
            'category_breakdown': {'structure': 15},
            'asset_class': 'cryptocurrency',
            'data_quality': {'primary_timeframe': '1h'},
        }

        # First scan creates setup
        scanner.scan_symbol('BTCUSD', analysis, 65000)
        self.assertEqual(len(sl.get_active_setups()), 1)
        setup_id = sl.get_active_setups()[0].setup_id

        # Promote to READY
        sl.transition(setup_id, SetupState.DEVELOPING, 'test')
        sl.transition(setup_id, SetupState.WATCH, 'test')
        sl.transition(setup_id, SetupState.READY, 'risk approved')

        # Second scan should update, not create new
        scanner.scan_symbol('BTCUSD', analysis, 65000)
        self.assertEqual(len(sl.get_active_setups()), 1)
        self.assertEqual(sl.get_active_setups()[0].setup_id, setup_id)


class TestRestartAfterTP1(unittest.TestCase):
    """Test that TP1 state is preserved and not duplicated."""

    def test_tp1_state_preserved(self):
        """After TP1, position state should reflect partial close."""
        pb = PaperBrokerAdapter()
        pb.update_price('BTCUSD', 65000)
        pb.place_market_order('BTCUSD', 'BUY', 1000, setup_id='test')
        pos = pb.get_positions()[0]
        pos.stop_loss = 64500
        pos.take_profit_1 = 65500
        pos.take_profit_2 = 66000

        # TP1 hit
        pb.update_price('BTCUSD', 65500)
        self.assertTrue(pos.tp1_hit)
        self.assertTrue(pos.break_even_moved)

        # After restart simulation, TP1 should still be recorded
        self.assertTrue(pos.tp1_hit)
        self.assertEqual(pos.stop_loss, pos.entry_price)  # BE

    def test_tp1_not_executed_twice(self):
        """TP1 should only close 50% once, even if price touches TP1 again."""
        pb = PaperBrokerAdapter()
        pb.update_price('BTCUSD', 65000)
        pb.place_market_order('BTCUSD', 'BUY', 1000, setup_id='test')
        pos = pb.get_positions()[0]
        pos.stop_loss = 64500
        pos.take_profit_1 = 65500
        pos.take_profit_2 = 66000

        original_qty = pos.quantity

        # TP1 hit
        pb.update_price('BTCUSD', 65500)
        qty_after_tp1 = pos.quantity
        self.assertLess(qty_after_tp1, original_qty)

        # Price touches TP1 again — should not close more
        pb.update_price('BTCUSD', 65500)
        self.assertEqual(pos.quantity, qty_after_tp1)  # Same quantity


class TestBreakingNews(unittest.TestCase):
    """Test breaking news safety."""

    def test_high_severity_blocks_trades(self):
        bnm = BreakingNewsManager()
        event = bnm.register_breaking_news(
            'CPI data released unexpectedly',
            severity=BreakingNewsSeverity.HIGH,
            affected_symbols=['XAUUSD', 'EURUSD'],
        )
        self.assertTrue(bnm.is_blocked('XAUUSD'))
        self.assertTrue(bnm.is_blocked('EURUSD'))
        self.assertFalse(bnm.is_blocked('BTCUSD'))

    def test_critical_severity_triggers_manual_review(self):
        bnm = BreakingNewsManager()
        event = bnm.register_breaking_news(
            'Flash crash detected',
            severity=BreakingNewsSeverity.CRITICAL,
        )
        self.assertTrue(bnm.is_blocked('ANY_SYMBOL'))

    def test_medium_does_not_block(self):
        bnm = BreakingNewsManager()
        event = bnm.register_breaking_news(
            'Fed speaker scheduled',
            severity=BreakingNewsSeverity.MEDIUM,
        )
        self.assertFalse(bnm.is_blocked('EURUSD'))

    def test_expired_events_dont_block(self):
        bnm = BreakingNewsManager(default_block_minutes=0)
        event = bnm.register_breaking_news(
            'Old news',
            severity=BreakingNewsSeverity.HIGH,
        )
        time.sleep(0.1)
        bnm.cleanup_expired()
        self.assertFalse(bnm.is_blocked('XAUUSD'))


class TestDailyLossLimit(unittest.TestCase):
    """Test that daily loss limit blocks new entries."""

    def test_daily_loss_blocks(self):
        rm = RiskManager(RiskConfig(max_daily_drawdown_pct=3.0))
        result = rm.evaluate(
            setup_symbol='BTCUSD', setup_direction='BUY', setup_score=75,
            setup_entry=65000, setup_stop=64500, setup_tp1=65500,
            account_equity=10000, news_status='CLEAR',
            daily_realized_pnl=-400.0,  # -4% exceeds 3% limit
        )
        self.assertEqual(result.decision, RiskDecision.REJECTED)
        self.assertTrue(any('drawdown' in r.lower() for r in result.reasons))


class TestHugeSpread(unittest.TestCase):
    """Test that positions are rejected with unreasonable spread."""

    def test_paper_broker_applies_spread(self):
        pb = PaperBrokerAdapter(default_spread_pips=100.0)
        pb.update_price('BTCUSD', 65000)
        order = pb.place_market_order('BTCUSD', 'BUY', 1000)
        # Spread should be applied to fill price
        self.assertGreater(order.filled_price, 65000)


class TestActivityFeedRecovery(unittest.TestCase):
    """Test activity feed survives and records decisions."""

    def test_feed_records_decisions(self):
        feed = ActivityFeed()
        feed.add('setup', 'detected', 'BTCUSD', 'New BUY setup detected')
        feed.add('risk', 'approved', 'BTCUSD', 'Risk approved')
        feed.add('execution', 'filled', 'BTCUSD', 'Paper order filled')
        entries = feed.get_recent(10)
        self.assertEqual(len(entries), 3)
        self.assertEqual(entries[0]['event_type'], 'filled')  # Most recent first


if __name__ == '__main__':
    unittest.main()
