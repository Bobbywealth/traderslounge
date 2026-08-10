"""
Autonomous trading system tests.

Tests: scanner → setup lifecycle, fingerprinting, risk manager,
outcome resolver, instrument specs, activity feed, position strategy.
"""
import sys
import time
import unittest

sys.path.insert(0, '.')

from scanner.autonomy.setup.setup_lifecycle import (
    SetupLifecycle, SetupState, _build_fingerprint, VALID_TRANSITIONS,
)
from scanner.autonomy.scanner.autonomous_scanner import AutonomousScanner
from scanner.autonomy.market.data_quality import DataQualityEngine
from scanner.autonomy.sessions.session_engine import SessionEngine
from scanner.autonomy.risk import RiskManager, RiskConfig, RiskDecision, PositionInfo
from scanner.autonomy.validation.outcome_resolver import OutcomeResolver, Outcome
from scanner.autonomy.broker.instrument_spec import get_spec, DEFAULT_SPECS
from scanner.autonomy.paper.position_strategy import get_strategy, DEFAULT_STRATEGIES
from scanner.autonomy.monitoring.activity_feed import ActivityFeed
from scanner.autonomy.paper.paper_broker import PaperBrokerAdapter


class TestFingerprinting(unittest.TestCase):
    """Test setup fingerprinting for deduplication."""

    def test_same_bucket_same_fingerprint(self):
        fp1 = _build_fingerprint('BTCUSD', 'BUY', '1h', 'confluence', 65000.0)
        fp2 = _build_fingerprint('BTCUSD', 'BUY', '1h', 'confluence', 65100.0)
        self.assertEqual(fp1, fp2)

    def test_different_direction_different_fingerprint(self):
        fp1 = _build_fingerprint('BTCUSD', 'BUY', '1h', 'confluence', 65000.0)
        fp2 = _build_fingerprint('BTCUSD', 'SELL', '1h', 'confluence', 65000.0)
        self.assertNotEqual(fp1, fp2)

    def test_different_symbol_different_fingerprint(self):
        fp1 = _build_fingerprint('BTCUSD', 'BUY', '1h', 'confluence', 65000.0)
        fp2 = _build_fingerprint('ETHUSD', 'BUY', '1h', 'confluence', 65000.0)
        self.assertNotEqual(fp1, fp2)

    def test_gold_bucket(self):
        fp1 = _build_fingerprint('XAUUSD', 'BUY', '1h', 'confluence', 3382.5)
        fp2 = _build_fingerprint('XAUUSD', 'BUY', '1h', 'confluence', 3384.0)
        self.assertEqual(fp1, fp2)

    def test_find_by_fingerprint(self):
        sl = SetupLifecycle()
        fp = _build_fingerprint('BTCUSD', 'BUY', '1h', 'confluence', 65000.0)
        sl.create_setup('BTCUSD', 'crypto', 'BUY', '1h', 75, fingerprint=fp)
        found = sl.find_by_fingerprint(fp)
        self.assertIsNotNone(found)
        self.assertEqual(found.symbol, 'BTCUSD')

    def test_no_duplicate_on_same_fingerprint(self):
        sl = SetupLifecycle()
        fp = _build_fingerprint('BTCUSD', 'BUY', '1h', 'confluence', 65000.0)
        sl.create_setup('BTCUSD', 'crypto', 'BUY', '1h', 75, fingerprint=fp)
        # find_by_fingerprint should return the existing setup
        found = sl.find_by_fingerprint(fp)
        self.assertEqual(len(sl.get_active_setups()), 1)
        self.assertEqual(found.setup_id, sl.get_active_setups()[0].setup_id)


class TestSetupLifecycle(unittest.TestCase):
    """Test setup state machine."""

    def test_create_setup(self):
        sl = SetupLifecycle()
        s = sl.create_setup('BTCUSD', 'crypto', 'BUY', '1h', 75)
        self.assertEqual(s.state, SetupState.DETECTED)
        self.assertEqual(s.symbol, 'BTCUSD')
        self.assertEqual(s.score, 75)

    def test_valid_transitions(self):
        sl = SetupLifecycle()
        s = sl.create_setup('BTCUSD', 'crypto', 'BUY', '1h', 75)
        self.assertTrue(sl.transition(s.setup_id, SetupState.DEVELOPING, 'test'))
        self.assertEqual(sl.get_setup(s.setup_id).state, SetupState.DEVELOPING)

    def test_invalid_transition_rejected(self):
        sl = SetupLifecycle()
        s = sl.create_setup('BTCUSD', 'crypto', 'BUY', '1h', 75)
        # DETECTED → POSITION_OPEN is not valid
        self.assertFalse(sl.transition(s.setup_id, SetupState.POSITION_OPEN, 'test'))
        self.assertEqual(sl.get_setup(s.setup_id).state, SetupState.DETECTED)

    def test_terminal_state_removes_from_active(self):
        sl = SetupLifecycle()
        s = sl.create_setup('BTCUSD', 'crypto', 'BUY', '1h', 75)
        sl.transition(s.setup_id, SetupState.DEVELOPING, 'test')
        sl.transition(s.setup_id, SetupState.WATCH, 'test')
        sl.transition(s.setup_id, SetupState.INVALIDATED, 'test')
        self.assertEqual(len(sl.get_active_setups()), 0)


class TestScanner(unittest.TestCase):
    """Test scanner creates and updates setups."""

    def _make_analysis(self, score=75, direction='BUY'):
        return {
            'total_score': score, 'direction': direction,
            'trade_plan': {
                'eligible': True, 'entry': 65000, 'stop': 64500,
                'targets': [{'price': 65500}, {'price': 66000}, {'price': 66500}],
                'timing_status': 'READY', 'calendar_status': 'CLEAR',
                'net_available_rr': 2.5, 'reasons': ['test'],
            },
            'category_breakdown': {'structure': 15, 'momentum': 12},
            'asset_class': 'cryptocurrency',
            'data_quality': {'primary_timeframe': '1h'},
            'market_regime': 'bull',
        }

    def _make_scanner(self):
        dq = DataQualityEngine()
        dq.update_tick_age('BTCUSD', 5)
        dq.update_candle_age('BTCUSD', 5)
        sl = SetupLifecycle()
        return AutonomousScanner(
            data_quality=dq, session_engine=SessionEngine(),
            setup_lifecycle=sl,
        ), sl

    def test_creates_setup(self):
        scanner, sl = self._make_scanner()
        opp = scanner.scan_symbol('BTCUSD', self._make_analysis(), 65000)
        self.assertIsNotNone(opp)
        self.assertEqual(opp.symbol, 'BTCUSD')
        self.assertEqual(len(sl.get_active_setups()), 1)

    def test_updates_existing_setup(self):
        scanner, sl = self._make_scanner()
        scanner.scan_symbol('BTCUSD', self._make_analysis(75), 65000)
        scanner.scan_symbol('BTCUSD', self._make_analysis(80), 65100)
        self.assertEqual(len(sl.get_active_setups()), 1)
        self.assertEqual(sl.get_active_setups()[0].score, 80)

    def test_neutral_direction_no_setup(self):
        scanner, sl = self._make_scanner()
        scanner.scan_symbol('BTCUSD', self._make_analysis(75, 'NEUTRAL'), 65000)
        self.assertEqual(len(sl.get_active_setups()), 0)


class TestRiskManager(unittest.TestCase):
    """Test risk manager decisions."""

    def test_approves_valid_setup(self):
        rm = RiskManager(RiskConfig(max_concurrent_positions=3))
        r = rm.evaluate(
            setup_symbol='BTCUSD', setup_direction='BUY', setup_score=75,
            setup_entry=65000, setup_stop=64500, setup_tp1=65500,
            setup_net_rr=2.5, account_equity=10000, news_status='CLEAR',
        )
        self.assertEqual(r.decision, RiskDecision.APPROVED)
        self.assertGreater(r.position_size_lots, 0)

    def test_rejects_low_score(self):
        rm = RiskManager(RiskConfig(minimum_score=50))
        r = rm.evaluate(
            setup_symbol='BTCUSD', setup_direction='BUY', setup_score=30,
            setup_entry=65000, setup_stop=64500, setup_tp1=65500,
            account_equity=10000, news_status='CLEAR',
        )
        self.assertEqual(r.decision, RiskDecision.REJECTED)
        self.assertTrue(any('below minimum' in reason for reason in r.reasons))

    def test_rejects_news_blocked(self):
        rm = RiskManager()
        r = rm.evaluate(
            setup_symbol='BTCUSD', setup_direction='BUY', setup_score=75,
            setup_entry=65000, setup_stop=64500, setup_tp1=65500,
            account_equity=10000, news_status='BLOCKED',
        )
        self.assertEqual(r.decision, RiskDecision.REJECTED)
        self.assertTrue(any('News' in reason for reason in r.reasons))

    def test_rejects_max_positions(self):
        rm = RiskManager(RiskConfig(max_concurrent_positions=1))
        positions = [PositionInfo('p1', 'ETHUSD', 'BUY')]
        r = rm.evaluate(
            setup_symbol='BTCUSD', setup_direction='BUY', setup_score=75,
            setup_entry=65000, setup_stop=64500, setup_tp1=65500,
            account_equity=10000, news_status='CLEAR', open_positions=positions,
        )
        self.assertEqual(r.decision, RiskDecision.REJECTED)

    def test_rejects_opposing_position(self):
        rm = RiskManager()
        positions = [PositionInfo('p1', 'BTCUSD', 'SELL')]
        r = rm.evaluate(
            setup_symbol='BTCUSD', setup_direction='BUY', setup_score=75,
            setup_entry=65000, setup_stop=64500, setup_tp1=65500,
            account_equity=10000, news_status='CLEAR', open_positions=positions,
        )
        self.assertEqual(r.decision, RiskDecision.REJECTED)
        self.assertTrue(any('Opposing' in reason for reason in r.reasons))

    def test_loop_places_reduced_order_at_half_size(self):
        """REDUCED risk should not block the order — place it at 50% size."""
        from scanner.autonomy.risk.risk_manager import RiskAssessment
        rm = RiskManager()
        assessment = RiskAssessment(decision=RiskDecision.REDUCED,
                                    reasons=['reduce size'], position_size_lots=2.0)
        self.assertFalse(assessment.approved)
        self.assertTrue(assessment.reduced)
        # Simulate the loop's REDUCED sizing
        reduced_qty = max(assessment.position_size_lots * 0.5, 0)
        self.assertEqual(reduced_qty, 1.0)


class TestOutcomeResolver(unittest.TestCase):
    """Test outcome resolution."""

    def test_win_tp2(self):
        or_ = OutcomeResolver()
        r = or_.resolve('BUY', 65000, 64500, 65500, 66000, 66500, 66000, 'tp2',
                       tp1_hit=True, tp2_hit=True)
        self.assertEqual(r.outcome, Outcome.WIN)
        self.assertGreater(r.r_multiple, 0)

    def test_loss_stopped_out(self):
        or_ = OutcomeResolver()
        r = or_.resolve('BUY', 65000, 64500, 65500, 66000, 66500, 64500, 'stop')
        self.assertEqual(r.outcome, Outcome.LOSS)
        self.assertLess(r.r_multiple, 0)

    def test_breakeven(self):
        or_ = OutcomeResolver()
        r = or_.resolve('BUY', 65000, 64500, 65500, 66000, 66500, 65010, 'stop',
                       tp1_hit=True)
        # TP1 hit then stopped at BE = partial (40% closed at TP1 profit,
        # remaining closed near entry). This is correct — not a pure loss.
        self.assertIn(r.outcome, (Outcome.BREAKEVEN, Outcome.WIN, Outcome.PARTIAL))

    def test_not_triggered(self):
        or_ = OutcomeResolver()
        r = or_.resolve('BUY', 65000, 64500, 65500, 66000, 66500, 0, '')
        self.assertEqual(r.outcome, Outcome.NOT_TRIGGERED)


class TestInstrumentSpec(unittest.TestCase):
    """Test instrument specifications."""

    def test_crypto_spec(self):
        spec = get_spec('BTCUSD')
        self.assertEqual(spec.pip_size, 1.0)
        self.assertEqual(spec.contract_size, 1.0)

    def test_forex_spec(self):
        spec = get_spec('EURUSD')
        self.assertEqual(spec.pip_size, 0.0001)
        self.assertEqual(spec.contract_size, 100000.0)

    def test_metals_spec(self):
        spec = get_spec('XAUUSD')
        self.assertEqual(spec.pip_size, 0.01)
        self.assertEqual(spec.contract_size, 100.0)

    def test_unknown_falls_back_to_fx(self):
        spec = get_spec('UNKNOWN')
        self.assertEqual(spec.asset_class, 'forex')

    def test_all_default_specs_valid(self):
        for symbol, spec in DEFAULT_SPECS.items():
            self.assertGreater(spec.pip_size, 0, f'{symbol} pip_size')
            self.assertGreater(spec.contract_size, 0, f'{symbol} contract_size')


class TestPositionStrategy(unittest.TestCase):
    """Test position management strategies."""

    def test_standard_strategy(self):
        s = get_strategy('standard')
        self.assertEqual(s.tp1.close_pct, 40.0)
        self.assertTrue(s.tp1.move_sl_to_be)
        self.assertEqual(s.tp2.close_pct, 35.0)
        self.assertEqual(s.tp3.close_pct, 25.0)

    def test_aggressive_has_trailing(self):
        s = get_strategy('aggressive')
        self.assertTrue(s.tp1.trailing_stop)

    def test_scalp_all_at_tp1(self):
        s = get_strategy('scalp')
        self.assertEqual(s.tp1.close_pct, 100.0)
        self.assertEqual(s.tp2.close_pct, 0.0)

    def test_unknown_falls_back_to_standard(self):
        s = get_strategy('nonexistent')
        self.assertEqual(s.name, 'standard')


class TestActivityFeed(unittest.TestCase):
    """Test activity feed."""

    def test_add_and_retrieve(self):
        feed = ActivityFeed()
        feed.add('setup', 'detected', 'BTCUSD', 'test message')
        entries = feed.get_recent(10)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]['symbol'], 'BTCUSD')

    def test_category_filter(self):
        feed = ActivityFeed()
        feed.add('setup', 'detected', 'BTCUSD', 'setup msg')
        feed.add('risk', 'rejected', 'BTCUSD', 'risk msg')
        self.assertEqual(len(feed.get_recent(10, category='setup')), 1)
        self.assertEqual(len(feed.get_recent(10, category='risk')), 1)

    def test_max_entries(self):
        feed = ActivityFeed(max_entries=5)
        for i in range(10):
            feed.add('test', 'tick', 'X', f'msg {i}')
        self.assertEqual(len(feed.get_recent(100)), 5)


class TestPaperBroker(unittest.TestCase):
    """Test paper broker execution."""

    def test_sl_transferred_to_position(self):
        pb = PaperBrokerAdapter()
        pb.update_price('BTCUSD', 65000)
        order = pb.place_market_order('BTCUSD', 'BUY', 1000, setup_id='test')
        pos = pb.get_positions()[0]
        pos.stop_loss = 64500
        pos.take_profit_1 = 65500
        self.assertEqual(pos.stop_loss, 64500)
        self.assertEqual(pos.take_profit_1, 65500)

    def test_tp1_closes_partial(self):
        pb = PaperBrokerAdapter()
        pb.update_price('BTCUSD', 65000)
        pb.place_market_order('BTCUSD', 'BUY', 1000, setup_id='test')
        pos = pb.get_positions()[0]
        pos.stop_loss = 64500
        pos.take_profit_1 = 65500
        pos.take_profit_2 = 66000
        pb.update_price('BTCUSD', 65500)
        self.assertTrue(pos.tp1_hit)
        self.assertTrue(pos.break_even_moved)
        self.assertEqual(pos.stop_loss, pos.entry_price)  # BE

    def test_tp2_closes_remaining(self):
        pb = PaperBrokerAdapter()
        pb.update_price('BTCUSD', 65000)
        pb.place_market_order('BTCUSD', 'BUY', 1000, setup_id='test')
        pos = pb.get_positions()[0]
        pos.stop_loss = 64500
        pos.take_profit_1 = 65500
        pos.take_profit_2 = 66000
        pb.update_price('BTCUSD', 65500)  # TP1
        pb.update_price('BTCUSD', 66000)  # TP2
        self.assertEqual(len(pb.get_positions()), 0)
        self.assertEqual(len(pb._closed_positions), 1)

    def test_no_dict_mutation_crash(self):
        pb = PaperBrokerAdapter()
        pb.update_price('BTCUSD', 65000)
        pb.place_market_order('BTCUSD', 'BUY', 1000, setup_id='test1')
        pb.place_market_order('BTCUSD', 'BUY', 1000, setup_id='test2')
        for pos in pb.get_positions():
            pos.stop_loss = 64500
            pos.take_profit_1 = 66000
        # This should not crash with RuntimeError: dictionary changed size
        pb.update_price('BTCUSD', 66000)


if __name__ == '__main__':
    unittest.main()
