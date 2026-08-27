"""End-to-end unit coverage for new eligible trade publication and delivery."""
from __future__ import annotations

import tempfile
import time
import unittest

from scanner.alert_preferences import AlertPreferences, AlertPreferencesStore
from scanner.api import ApiState, _ApiHandler, set_state, start_signal_monitor
from scanner.config import Config
from scanner.persistence import SQLiteRepository


class _RecordingBot:
    def __init__(self):
        self.events = []

    def dispatch_event(self, event, prefs):
        self.events.append((event, prefs.user_id))
        return True


class NewTradePipelineTest(unittest.TestCase):
    def setUp(self):
        db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        db_file.close()
        self.repo = SQLiteRepository(db_file.name)
        self.store = AlertPreferencesStore(root=tempfile.mkdtemp(), repository=self.repo)
        self.store.upsert(AlertPreferences(
            user_id=1,
            delivery_channels=["in_app", "telegram"],
            telegram_chat_id="123456",
        ))
        self.bot = _RecordingBot()
        self.state = ApiState(
            repository=self.repo,
            config=Config(pairs=[]),
            alert_preferences_store=self.store,
            alert_repo=self.repo,
            telegram_bot=self.bot,
        )
        set_state(self.state)
        self.handler = object.__new__(_ApiHandler)

    def tearDown(self):
        self.repo.close()

    @staticmethod
    def analysis():
        return {
            "pair": "XAUUSD",
            "direction": "BUY",
            "total_score": 72,
            "version": "V2",
            "data_quality": {
                "primary_timeframe": "1h",
                "closed_bar_time": 1785952800,
            },
            "category_breakdown": {"structure": 20, "momentum": 18, "location": 16},
            "scenarios": {"primary": "confirmed guarded gold continuation"},
            "economic_calendar": {"status": "CLEAR"},
            "decision_quality": {
                "setup_quality": 80,
                "execution_readiness": 75,
                "market_bias_confidence": 78,
                "scenario_weights": {"weights": {"bull": 65, "base": 25, "bear": 10}},
            },
            "trade_timing": {"status": "READY", "location_signals": ["fib", "structure"]},
            "trade_plan": {
                "eligible": True,
                "status": "VALID",
                "entry": 4239.78,
                "stop": 4199.20,
                "tp1": 4280.35,
                "tp2": 4320.93,
                "tp3": 4361.50,
                "net_rr": 3.0,
                "account_risk_percent": 1.0,
                "calendar_status": "CLEAR",
                "current_price": 4239.78,
            },
        }

    def test_eligible_analysis_publishes_and_delivers_exactly_once(self):
        self.handler._publish_actionable_analysis(self.analysis())
        self.handler._publish_actionable_analysis(self.analysis())

        published = self.repo.published(status="ACTIVE")
        self.assertEqual(len(published), 1)
        self.assertEqual(published[0]["pair"], "XAUUSD")
        self.assertEqual(published[0]["tp3"], 4361.50)

        feed = self.repo.recent_for_user(1)
        self.assertEqual(len(feed), 1)
        self.assertEqual(feed[0]["alert_type"], "new_trade")
        self.assertEqual(feed[0]["payload"]["entry"], 4239.78)
        self.assertEqual(len(self.bot.events), 1)
        # New compact format: title dropped to "XAUUSD BUY" — the
        # Telegram renderer adds the colored emoji and the rest of
        # the card from payload fields.
        self.assertEqual(self.bot.events[0][0]["title"], "XAUUSD BUY")

    def test_monitor_builds_without_an_http_request(self):
        stop = start_signal_monitor(self.state, interval_seconds=30)
        try:
            for _ in range(40):
                with self.state.cache_lock:
                    payload = self.state.dashboard_cache.get("payload")
                    building = self.state.dashboard_cache.get("building")
                if payload is not None and not building:
                    break
                time.sleep(0.05)
            self.assertIsNotNone(payload)
            self.assertFalse(building)
        finally:
            stop.set()


if __name__ == "__main__":
    unittest.main()
