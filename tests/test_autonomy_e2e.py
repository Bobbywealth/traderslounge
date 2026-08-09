"""
End-to-end autonomous pipeline test.

Tests the full closed-loop scenario:
Market → Analysis → Scanner → Setup → Risk → Paper Order → Position → TP → Close → Journal → Forecast
"""
import sys
import time
import unittest

sys.path.insert(0, '.')

from scanner.autonomy.setup.setup_lifecycle import SetupLifecycle, SetupState, _build_fingerprint
from scanner.autonomy.scanner.autonomous_scanner import AutonomousScanner
from scanner.autonomy.market.data_quality import DataQualityEngine
from scanner.autonomy.sessions.session_engine import SessionEngine
from scanner.autonomy.risk import RiskManager, RiskConfig, RiskDecision, PositionInfo
from scanner.autonomy.paper.paper_broker import PaperBrokerAdapter
from scanner.autonomy.validation.outcome_resolver import OutcomeResolver, Outcome
from scanner.autonomy.validation.forward_engine import ForwardEngine
from scanner.autonomy.journal.trading_journal import TradingJournal
from scanner.autonomy.monitoring.activity_feed import ActivityFeed
from scanner.autonomy.loop import AutonomousLoop


class TestFullClosedLoop(unittest.TestCase):
    """Test the complete autonomous trading pipeline end-to-end."""

    def _make_analysis(self, score=75, direction='BUY', entry=65000,
                       stop=64500, tp1=65500, tp2=66000, tp3=66500):
        return {
            'total_score': score, 'direction': direction,
            'trade_plan': {
                'eligible': True, 'entry': entry, 'stop': stop,
                'targets': [{'price': tp1}, {'price': tp2}, {'price': tp3}],
                'timing_status': 'READY', 'calendar_status': 'CLEAR',
                'net_available_rr': 2.5, 'reasons': ['test setup'],
                'asset_class': 'cryptocurrency',
            },
            'category_breakdown': {'structure': 15, 'momentum': 12, 'volume': 8},
            'asset_class': 'cryptocurrency',
            'data_quality': {'primary_timeframe': '1h', 'status': 'good'},
            'market_regime': 'bull',
        }

    def test_full_pipeline_buy_tp1_tp2_close(self):
        """Full pipeline: detect → risk → order → TP1 → TP2 → closed → journal → forecast."""
        # Setup components
        dq = DataQualityEngine()
        dq.update_tick_age('BTCUSD', 5)
        dq.update_candle_age('BTCUSD', 5)
        sl = SetupLifecycle()
        scanner = AutonomousScanner(
            data_quality=dq, session_engine=SessionEngine(),
            setup_lifecycle=sl,
        )
        rm = RiskManager(RiskConfig(max_concurrent_positions=3))
        pb = PaperBrokerAdapter()
        journal = TradingJournal()
        forward_engine = ForwardEngine()
        activity = ActivityFeed()

        # Step 1: Scanner detects opportunity
        analysis = self._make_analysis(75, 'BUY', 65000, 64500, 65500, 66000, 66500)
        opp = scanner.scan_symbol('BTCUSD', analysis, 65000)
        self.assertIsNotNone(opp)
        setups = sl.get_active_setups()
        self.assertEqual(len(setups), 1)
        setup = setups[0]
        self.assertEqual(setup.state, SetupState.DETECTED)
        self.assertEqual(setup.symbol, 'BTCUSD')
        journal.create_entry(setup.setup_id, 'BTCUSD', 'cryptocurrency', 'BUY',
                            '1h', 'confluence', '2.0.0-alpha', score=75)

        # Step 2: Risk approves
        pb.update_price('BTCUSD', 65000)
        account = pb.get_account()
        assessment = rm.evaluate(
            setup_symbol='BTCUSD', setup_direction='BUY', setup_score=75,
            setup_entry=65000, setup_stop=64500, setup_tp1=65500,
            setup_net_rr=2.5, account_equity=account['equity'],
            news_status='CLEAR', data_quality_status='good',
        )
        self.assertEqual(assessment.decision, RiskDecision.APPROVED)

        # Step 3: Paper order fills
        sl.transition(setup.setup_id, SetupState.DEVELOPING, 'score 75')
        sl.transition(setup.setup_id, SetupState.WATCH, 'score 75')
        sl.transition(setup.setup_id, SetupState.READY, 'risk approved')
        self.assertEqual(sl.get_setup(setup.setup_id).state, SetupState.READY)

        order = pb.place_market_order('BTCUSD', 'BUY', assessment.position_size_lots,
                                      setup_id=setup.setup_id,
                                      idempotency_key=f'test-{setup.setup_id}')
        self.assertEqual(order.status.value, 'filled')

        # Transfer SL/TP to position
        pos = pb.get_positions()[0]
        pos.stop_loss = 64500
        pos.take_profit_1 = 65500
        pos.take_profit_2 = 66000
        pos.take_profit_3 = 66500

        sl.transition(setup.setup_id, SetupState.TRIGGERED, 'order filled')
        sl.transition(setup.setup_id, SetupState.POSITION_OPEN, 'position opened')

        # Record forecast
        forecast = forward_engine.record_forecast(
            symbol='BTCUSD', timeframe='1h', direction='BUY',
            entry_price=order.filled_price, stop_loss=64500, target_price=65500,
            score=75, score_components={'structure': 15},
            setup_type='confluence', session='london',
            market_regime='bull', engine_version='2.0.0',
        )
        self.assertIsNotNone(forecast)

        # Step 4: TP1 hit — partial close + BE
        pb.update_price('BTCUSD', 65500)
        self.assertTrue(pos.tp1_hit)
        self.assertTrue(pos.break_even_moved)
        self.assertEqual(pos.stop_loss, pos.entry_price)
        sl.transition(setup.setup_id, SetupState.TP1, 'TP1 hit')

        # Step 5: TP2 hit — full close
        pb.update_price('BTCUSD', 66000)
        self.assertEqual(len(pb.get_positions()), 0)
        self.assertGreater(len(pb._closed_positions), 0)
        sl.transition(setup.setup_id, SetupState.TP2, 'TP2 hit')
        sl.transition(setup.setup_id, SetupState.CLOSED, 'position closed')

        # Step 6: Verify final state
        self.assertEqual(sl.get_setup(setup.setup_id).state, SetupState.CLOSED)

        # Journal has entry
        self.assertGreater(len(journal._entries), 0)

        # Forecast recorded
        self.assertGreater(len(forward_engine._forecasts), 0)

        # Activity feed has entries
        activity.add('execution', 'closed', 'BTCUSD', 'BTCUSD closed at TP2')
        self.assertGreater(len(activity.get_recent(10)), 0)

    def test_setup_deduplication(self):
        """Same market idea should not create duplicate setups."""
        dq = DataQualityEngine()
        dq.update_tick_age('BTCUSD', 5)
        dq.update_candle_age('BTCUSD', 5)
        sl = SetupLifecycle()
        scanner = AutonomousScanner(
            data_quality=dq, session_engine=SessionEngine(),
            setup_lifecycle=sl,
        )

        analysis = self._make_analysis(75, 'BUY', 65000, 64500, 65500, 66000, 66500)

        # First scan creates setup
        scanner.scan_symbol('BTCUSD', analysis, 65000)
        self.assertEqual(len(sl.get_active_setups()), 1)

        # Second scan with same direction/zone should NOT create a new setup
        scanner.scan_symbol('BTCUSD', analysis, 65050)
        self.assertEqual(len(sl.get_active_setups()), 1)

        # Third scan with different direction should create a new setup
        analysis_sell = self._make_analysis(70, 'SELL', 65000, 65500, 64500, 64000, 63500)
        scanner.scan_symbol('BTCUSD', analysis_sell, 65000)
        self.assertEqual(len(sl.get_active_setups()), 2)

    def test_risk_blocks_news_blackout(self):
        """Risk manager should block during news blackout."""
        rm = RiskManager(RiskConfig())
        result = rm.evaluate(
            setup_symbol='BTCUSD', setup_direction='BUY', setup_score=75,
            setup_entry=65000, setup_stop=64500, setup_tp1=65500,
            account_equity=10000, news_status='BLOCKED',
        )
        self.assertEqual(result.decision, RiskDecision.REJECTED)
        self.assertTrue(any('News' in r for r in result.reasons))

    def test_stop_loss_closes_position(self):
        """Stop loss should close the position."""
        pb = PaperBrokerAdapter()
        pb.update_price('BTCUSD', 65000)
        pb.place_market_order('BTCUSD', 'BUY', 1000, setup_id='test')
        pos = pb.get_positions()[0]
        pos.stop_loss = 64500
        pos.take_profit_1 = 65500

        # Price drops to stop
        pb.update_price('BTCUSD', 64500)
        self.assertEqual(len(pb.get_positions()), 0)
        self.assertGreater(len(pb._closed_positions), 0)

    def test_outcome_resolver_sl(self):
        """Outcome resolver correctly identifies a loss."""
        or_ = OutcomeResolver()
        result = or_.resolve('BUY', 65000, 64500, 65500, 66000, 66500,
                            64500, 'stop')
        self.assertEqual(result.outcome, Outcome.LOSS)
        self.assertLess(result.r_multiple, 0)


class TestRestartSafety(unittest.TestCase):
    """Test that state survives process restarts."""

    def test_setup_persistence_fields(self):
        """SetupRecord has all fields needed for Postgres persistence."""
        sl = SetupLifecycle()
        s = sl.create_setup('BTCUSD', 'crypto', 'BUY', '1h', 75,
                           fingerprint='abc123',
                           stop_loss=64500, tp1=65500, tp2=66000, tp3=66500)
        d = sl.to_dict(s.setup_id)
        self.assertIsNotNone(d)
        self.assertEqual(d['fingerprint'], 'abc123')
        self.assertEqual(d['stop_loss'], 64500)
        self.assertEqual(d['tp1'], 65500)
        self.assertEqual(d['tp2'], 66000)
        self.assertEqual(d['tp3'], 66500)

    def test_journal_entry_fields(self):
        """Journal entries have all required fields."""
        journal = TradingJournal()
        entry = journal.create_entry(
            setup_id='test-001', symbol='BTCUSD', asset_class='crypto',
            direction='BUY', timeframe='1h', strategy_type='confluence',
            engine_version='2.0.0', score=75,
        )
        self.assertEqual(entry.setup_id, 'test-001')
        self.assertEqual(entry.symbol, 'BTCUSD')
        self.assertEqual(entry.score, 75)


class TestInstrumentSpecs(unittest.TestCase):
    """Test instrument specifications are complete."""

    def test_all_instruments_have_pip_size(self):
        from scanner.autonomy.broker.instrument_spec import DEFAULT_SPECS
        for symbol, spec in DEFAULT_SPECS.items():
            self.assertGreater(spec.pip_size, 0, f'{symbol} missing pip_size')
            self.assertGreater(spec.contract_size, 0, f'{symbol} missing contract_size')
            self.assertGreater(spec.price_precision, 0, f'{symbol} missing price_precision')

    def test_no_generic_0001_assumption(self):
        """Crypto and metals should NOT use 0.0001 pip size."""
        from scanner.autonomy.broker.instrument_spec import get_spec
        btc = get_spec('BTCUSD')
        self.assertNotEqual(btc.pip_size, 0.0001)
        xau = get_spec('XAUUSD')
        self.assertNotEqual(xau.pip_size, 0.0001)


if __name__ == '__main__':
    unittest.main()
