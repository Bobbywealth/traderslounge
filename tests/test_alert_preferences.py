"""Unit tests for scanner.alert_preferences."""
import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from scanner.alert_preferences import (
    AlertEvent,
    AlertPreferences,
    AlertPreferencesStore,
    AlertType,
    DeliveryChannel,
    TradingSession,
    evaluate_rules,
)


def _analysis(
    *,
    pair="BTCUSD",
    direction="BUY",
    setup_quality=70,
    timing=70,
    bias=70,
    entry_zone=None,
    current_price=100.0,
    invalidation=95.0,
    timing_status="READY",
    primary_timeframe="1h",
):
    return {
        "pair": pair,
        "direction": direction,
        "data_quality": {"primary_timeframe": primary_timeframe},
        "decision_quality": {
            "setup_quality": setup_quality,
            "execution_readiness": timing,
            "market_bias_confidence": bias,
        },
        "trade_timing": {"status": timing_status},
        "trade_plan": {
            "entry_zone": entry_zone,
            "current_price": current_price,
            "entry": 100.0,
            "stop_loss": 95.0,
            "targets": [110.0, 120.0],
        },
        "risk": {"atr_stop": 95.0},
    }


def _calendar(status="CLEAR", reasons=None):
    return {
        "status": status,
        "blocking_reasons": reasons or [],
        "upcoming_events": [],
    }


class TestPreferencesDefaults(unittest.TestCase):
    def test_minimum_defaults_are_conservative(self):
        prefs = AlertPreferences(user_id=42)
        self.assertEqual(prefs.setup_quality_minimum, 60)
        self.assertEqual(prefs.timing_minimum, 60)
        self.assertEqual(prefs.risk_per_trade_pct, 1.0)
        # Default channels must include in_app so the user sees alerts
        # even when they have not configured Telegram or email.
        self.assertIn(DeliveryChannel.IN_APP.value, prefs.delivery_channels)
        # Default alert types should include the four core types.
        for kind in (
            AlertType.ENTRY_ZONE.value,
            AlertType.CONFIRMATION.value,
            AlertType.NEWS_RISK.value,
            AlertType.INVALIDATION.value,
        ):
            self.assertIn(kind, prefs.enabled_alert_types)

    def test_round_trip_from_dict_preserves_values(self):
        original = AlertPreferences(
            user_id=7,
            watchlist=["BTCUSD", "EURUSD"],
            timeframes={"1h": True, "4h": False, "1d": True, "1w": False},
            sessions=[TradingSession.LONDON.value, TradingSession.NEW_YORK.value],
            setup_quality_minimum=75,
            timing_minimum=80,
            risk_per_trade_pct=0.5,
            enabled_alert_types=[AlertType.CONFIRMATION.value],
            delivery_channels=[DeliveryChannel.IN_APP.value, DeliveryChannel.TELEGRAM.value],
            telegram_chat_id="12345",
            daily_briefing_enabled=False,
        )
        restored = AlertPreferences.from_dict(original.to_dict())
        self.assertEqual(restored.user_id, 7)
        self.assertEqual(restored.watchlist, ["BTCUSD", "EURUSD"])
        self.assertEqual(restored.setup_quality_minimum, 75)
        self.assertEqual(restored.risk_per_trade_pct, 0.5)
        self.assertEqual(restored.telegram_chat_id, "12345")
        self.assertFalse(restored.daily_briefing_enabled)

    def test_from_dict_tolerates_unknown_keys(self):
        payload = AlertPreferences(user_id=1).to_dict()
        payload["future_field"] = "ignored"
        restored = AlertPreferences.from_dict(payload)
        self.assertEqual(restored.user_id, 1)


class TestStore(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.store = AlertPreferencesStore(root=self.tmp)

    def test_upsert_and_get_round_trip(self):
        prefs = AlertPreferences(user_id=99, watchlist=["BTCUSD"], setup_quality_minimum=80)
        self.store.upsert(prefs)
        loaded = self.store.get(99)
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded.watchlist, ["BTCUSD"])
        self.assertEqual(loaded.setup_quality_minimum, 80)

    def test_get_missing_returns_none(self):
        self.assertIsNone(self.store.get(404))

    def test_delete(self):
        self.store.upsert(AlertPreferences(user_id=11))
        self.assertTrue(self.store.delete(11))
        self.assertIsNone(self.store.get(11))

    def test_atomic_write_does_not_leave_temp_files(self):
        self.store.upsert(AlertPreferences(user_id=12))
        leftovers = [p for p in Path(self.tmp).iterdir() if p.name.startswith(".alert-")]
        self.assertEqual(leftovers, [])

    def test_all_user_ids(self):
        for uid in (1, 2, 3):
            self.store.upsert(AlertPreferences(user_id=uid))
        self.assertEqual(set(self.store.all_user_ids()), {1, 2, 3})


class TestEvaluateRules(unittest.TestCase):
    def test_watchlist_filters(self):
        prefs = AlertPreferences(user_id=1, watchlist=["EURUSD"])
        events = evaluate_rules(prefs, _analysis(pair="BTCUSD"))
        self.assertEqual(events, [])

    def test_timeframe_filters(self):
        prefs = AlertPreferences(
            user_id=1, timeframes={"1h": False, "4h": True, "1d": True, "1w": False}
        )
        events = evaluate_rules(prefs, _analysis(primary_timeframe="1h"))
        self.assertEqual(events, [])

    def test_confirmation_fires_when_thresholds_met(self):
        prefs = AlertPreferences(
            user_id=1,
            setup_quality_minimum=60,
            timing_minimum=60,
        )
        previous = _analysis(setup_quality=50, timing=50, timing_status="WAIT")
        events = evaluate_rules(
            prefs, _analysis(setup_quality=70, timing=70), last_analysis=previous
        )
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].alert_type, AlertType.CONFIRMATION.value)
        self.assertEqual(events[0].severity, "info")
        self.assertIn("70/100", events[0].body)

    def test_confirmation_silent_when_setup_quality_below_minimum(self):
        prefs = AlertPreferences(user_id=1, setup_quality_minimum=80)
        events = evaluate_rules(prefs, _analysis(setup_quality=70, timing=70))
        self.assertEqual(events, [])

    def test_confirmation_silent_when_timing_below_minimum(self):
        prefs = AlertPreferences(user_id=1, timing_minimum=80)
        events = evaluate_rules(prefs, _analysis(setup_quality=70, timing=70))
        self.assertEqual(events, [])

    def test_confirmation_silent_when_timing_status_not_ready(self):
        prefs = AlertPreferences(user_id=1)
        events = evaluate_rules(prefs, _analysis(timing_status="WAIT"))
        self.assertEqual(events, [])

    def test_confirmation_silent_when_direction_neutral(self):
        prefs = AlertPreferences(user_id=1)
        events = evaluate_rules(prefs, _analysis(direction="NEUTRAL"))
        self.assertEqual(events, [])

    def test_entry_zone_fires(self):
        prefs = AlertPreferences(user_id=1)
        events = evaluate_rules(prefs, _analysis(entry_zone=[99.0, 101.0]))
        types = [e.alert_type for e in events]
        self.assertIn(AlertType.ENTRY_ZONE.value, types)

    def test_news_risk_fires_on_blocked(self):
        prefs = AlertPreferences(user_id=1)
        events = evaluate_rules(prefs, _analysis(), calendar=_calendar(status="BLOCKED", reasons=["FOMC in 5m"]))
        types = [e.alert_type for e in events]
        self.assertIn(AlertType.NEWS_RISK.value, types)
        news = next(e for e in events if e.alert_type == AlertType.NEWS_RISK.value)
        self.assertEqual(news.severity, "critical")

    def test_news_risk_caution_is_warning(self):
        prefs = AlertPreferences(user_id=1)
        events = evaluate_rules(prefs, _analysis(), calendar=_calendar(status="CAUTION"))
        news = next(e for e in events if e.alert_type == AlertType.NEWS_RISK.value)
        self.assertEqual(news.severity, "warning")

    def test_news_risk_clear_does_not_fire(self):
        prefs = AlertPreferences(user_id=1)
        events = evaluate_rules(prefs, _analysis(), calendar=_calendar(status="CLEAR"))
        types = [e.alert_type for e in events]
        self.assertNotIn(AlertType.NEWS_RISK.value, types)

    def test_invalidation_fires_on_buy_cross_down(self):
        prefs = AlertPreferences(user_id=1)
        last = _analysis(current_price=96.0, invalidation=95.0)
        cur = _analysis(current_price=94.0, invalidation=95.0)
        events = evaluate_rules(prefs, cur, last_analysis=last)
        types = [e.alert_type for e in events]
        self.assertIn(AlertType.INVALIDATION.value, types)
        invalidation = next(e for e in events if e.alert_type == AlertType.INVALIDATION.value)
        self.assertEqual(invalidation.severity, "critical")

    def test_invalidation_does_not_fire_when_no_cross(self):
        prefs = AlertPreferences(user_id=1)
        last = _analysis(current_price=110.0, invalidation=95.0)
        cur = _analysis(current_price=108.0, invalidation=95.0)
        events = evaluate_rules(prefs, cur, last_analysis=last)
        types = [e.alert_type for e in events]
        self.assertNotIn(AlertType.INVALIDATION.value, types)

    def test_disabled_alert_type_does_not_fire(self):
        prefs = AlertPreferences(
            user_id=1,
            enabled_alert_types=[],  # all disabled
        )
        events = evaluate_rules(prefs, _analysis(setup_quality=80, timing=80), calendar=_calendar(status="BLOCKED"))
        self.assertEqual(events, [])

    def test_event_metadata_contains_pair_and_timeframe(self):
        prefs = AlertPreferences(user_id=42)
        previous = _analysis(pair="EURUSD", primary_timeframe="4h", setup_quality=50, timing=50, timing_status="WAIT")
        events = evaluate_rules(
            prefs,
            _analysis(pair="EURUSD", primary_timeframe="4h", setup_quality=80, timing=80),
            last_analysis=previous,
        )
        self.assertGreater(len(events), 0)
        for event in events:
            self.assertEqual(event.user_id, 42)
            self.assertEqual(event.pair, "EURUSD")
            self.assertEqual(event.timeframe, "4h")
            self.assertTrue(event.title)
            self.assertTrue(event.body)
            self.assertTrue(event.created_at)


class TestAlertEventShape(unittest.TestCase):
    def test_to_dict(self):
        event = AlertEvent(
            user_id=1,
            alert_type=AlertType.CONFIRMATION.value,
            pair="BTCUSD",
            timeframe="1h",
            title="t",
            body="b",
            severity="info",
        )
        d = event.to_dict()
        for key in ("user_id", "alert_type", "pair", "timeframe", "title", "body", "severity", "created_at"):
            self.assertIn(key, d)


if __name__ == "__main__":
    unittest.main()