"""Regression tests for durable, de-duplicated new-trade alerts."""
from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone

from scanner.alert_preferences import (
    AlertPreferences,
    AlertPreferencesStore,
    AlertType,
    evaluate_new_trade,
    evaluate_no_trade,
)
from scanner.persistence import SQLiteRepository


def _published(*, fingerprint="fp-buy-1", direction="BUY", pair="XAUUSD"):
    return {
        "fingerprint": fingerprint,
        "pair": pair,
        "direction": direction,
        "timeframe": "1h",
        "score": 72,
        "setup_quality": "VALID",
        "entry": 4239.78,
        "stop_loss": 4199.20,
        "tp1": 4280.35,
        "tp2": 4320.93,
        "tp3": 4361.50,
        "net_rr": 3.0,
        "risk_percent": 1.0,
        "calendar_status": "CLEAR",
        "scenario": "confirmed guarded setup",
        "rationale": ["Structure", "Momentum"],
        "source_candle_time": 1785952800,
        "engine_version": "V2",
        "status": "ACTIVE",
        "published_at": datetime.now(timezone.utc),
    }


class NewTradeRuleTest(unittest.TestCase):
    def test_published_call_builds_rich_new_trade_event(self):
        prefs = AlertPreferences(user_id=7)
        events = evaluate_new_trade(prefs, _published())
        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event.alert_type, AlertType.NEW_TRADE.value)
        # New compact template: title is just "XAUUSD BUY" — the
        # Telegram renderer adds the green emoji and details from the
        # payload. The old verbose "NEW TRADE: ..." prefix is gone.
        self.assertEqual(event.title, "XAUUSD BUY")
        self.assertEqual(event.payload["entry"], 4239.78)
        self.assertEqual(event.payload["stop"], 4199.20)
        self.assertEqual(event.payload["targets"], [4280.35, 4320.93, 4361.50])
        self.assertEqual(event.event_key, "new_trade:7:fp-buy-1")

    def test_watchlist_and_timeframe_preferences_are_respected(self):
        prefs = AlertPreferences(user_id=7, watchlist=["BTCUSD"])
        self.assertEqual(evaluate_new_trade(prefs, _published()), [])
        prefs = AlertPreferences(user_id=7, timeframes={"1h": False})
        self.assertEqual(evaluate_new_trade(prefs, _published()), [])

    def test_v1_preferences_gain_new_trade_once_and_v2_opt_out_sticks(self):
        legacy = AlertPreferences.from_dict({
            "user_id": 1,
            "enabled_alert_types": [AlertType.CONFIRMATION.value],
        })
        self.assertIn(AlertType.NEW_TRADE.value, legacy.enabled_alert_types)
        saved = legacy.to_dict()
        saved["enabled_alert_types"] = [AlertType.CONFIRMATION.value]
        restored = AlertPreferences.from_dict(saved)
        self.assertNotIn(AlertType.NEW_TRADE.value, restored.enabled_alert_types)


class DurableAlertRepositoryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.repo = SQLiteRepository(self.tmp.name)

    def tearDown(self):
        self.repo.close()

    def test_preferences_survive_new_store_instance(self):
        store = AlertPreferencesStore(root=tempfile.mkdtemp(), repository=self.repo)
        store.upsert(AlertPreferences(
            user_id=11,
            delivery_channels=["in_app", "telegram"],
            telegram_chat_id="123456",
        ))
        restored_store = AlertPreferencesStore(root=tempfile.mkdtemp(), repository=self.repo)
        restored = restored_store.get(11)
        self.assertIsNotNone(restored)
        self.assertEqual(restored.telegram_chat_id, "123456")
        self.assertIn("telegram", restored.delivery_channels)
        self.assertEqual(list(restored_store.all_user_ids()), [11])

    def test_event_persistence_deduplicates_before_delivery(self):
        prefs = AlertPreferences(user_id=11)
        event = evaluate_new_trade(prefs, _published())[0].to_dict()
        first = self.repo.save_events([event])
        second = self.repo.save_events([event])
        self.assertEqual(len(first), 1)
        self.assertEqual(second, [])
        feed = self.repo.recent_for_user(11)
        self.assertEqual(len(feed), 1)
        self.assertEqual(feed[0]["alert_type"], AlertType.NEW_TRADE.value)

    def test_only_one_active_call_per_market_direction(self):
        first_id, first_created = self.repo.publish_actionable_once(_published())
        second = _published(fingerprint="fp-buy-2")
        second_id, second_created = self.repo.publish_actionable_once(second)
        self.assertTrue(first_created)
        self.assertFalse(second_created)
        self.assertEqual(first_id, second_id)

        sell = _published(fingerprint="fp-sell-1", direction="SELL")
        sell_id, sell_created = self.repo.publish_actionable_once(sell)
        self.assertTrue(sell_created)
        self.assertNotEqual(sell_id, first_id)
        active = self.repo.published(status="ACTIVE")
        self.assertEqual(len(active), 1)
        self.assertEqual(active[0]["direction"], "SELL")
        history = self.repo.published()
        self.assertEqual({row["status"] for row in history}, {"ACTIVE", "CANCELLED"})


class QualityGateTest(unittest.TestCase):
    """Bobby's spec: prefer NO TRADE over manufacturing a weak trade.

    New-trade alerts must be suppressed when:
      * score < 65
      * net R:R < 1.5
      * calendar status is BLOCKED / POST_NEWS
      * live spot is more than $5 (for XAUUSD) off the cached bar
    """

    def _signal(self, **overrides):
        base = _published()
        base.update(overrides)
        return base

    def test_score_below_threshold_is_suppressed(self):
        prefs = AlertPreferences(user_id=1)
        self.assertEqual(evaluate_new_trade(prefs, self._signal(score=64)), [])
        self.assertEqual(evaluate_new_trade(prefs, self._signal(score=50)), [])

    def test_score_at_threshold_passes(self):
        prefs = AlertPreferences(user_id=1)
        events = evaluate_new_trade(prefs, self._signal(score=65))
        self.assertEqual(len(events), 1)

    def test_rr_below_threshold_is_suppressed(self):
        prefs = AlertPreferences(user_id=1)
        self.assertEqual(evaluate_new_trade(prefs, self._signal(net_rr=1.4)), [])
        self.assertEqual(evaluate_new_trade(prefs, self._signal(net_rr=0.8)), [])

    def test_rr_at_threshold_passes(self):
        prefs = AlertPreferences(user_id=1)
        events = evaluate_new_trade(prefs, self._signal(net_rr=1.5))
        self.assertEqual(len(events), 1)

    def test_calendar_blocked_suppresses_alert(self):
        prefs = AlertPreferences(user_id=1)
        self.assertEqual(
            evaluate_new_trade(prefs, self._signal(calendar_status="BLOCKED")),
            [],
        )
        self.assertEqual(
            evaluate_new_trade(prefs, self._signal(calendar_status="POST_NEWS")),
            [],
        )

    def test_calendar_clear_passes(self):
        prefs = AlertPreferences(user_id=1)
        events = evaluate_new_trade(prefs, self._signal(calendar_status="CLEAR"))
        self.assertEqual(len(events), 1)

    def test_stale_live_price_suppresses_alert(self):
        prefs = AlertPreferences(user_id=1)
        self.assertEqual(
            evaluate_new_trade(prefs, self._signal(live_price_stale=True)),
            [],
        )

    def test_payload_includes_atr_and_rationale(self):
        prefs = AlertPreferences(user_id=1)
        events = evaluate_new_trade(prefs, self._signal(atr=12.0))
        self.assertEqual(events[0].payload["atr"], 12.0)
        self.assertIn("Structure", events[0].payload["rationale"])
        # ``why`` is the rationale joined with " + " — the "Why:" label
        # is added by the Telegram renderer, not by this evaluator.
        self.assertEqual(events[0].payload["why"], "Structure + Momentum")


class NoTradeTransitionTest(unittest.TestCase):
    """NO_TRADE alert fires only on the BUY/SELL → NEUTRAL transition."""

    def _analysis(self, direction, *, score=20, blocking=None):
        return {
            "pair": "XAUUSD",
            "direction": direction,
            "total_score": score,
            "data_quality": {"primary_timeframe": "1h"},
            "trade_timing": {"status": "WAIT"},
            "trade_plan": {"blocking_reasons": blocking or ["HTF conflict"]},
        }

    def test_fires_on_buy_to_neutral_transition(self):
        prefs = AlertPreferences(user_id=1)
        events = evaluate_no_trade(
            prefs,
            self._analysis("NEUTRAL"),
            last_analysis=self._analysis("BUY"),
        )
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].alert_type, "no_trade")
        self.assertIn("HTF conflict", events[0].body)

    def test_does_not_fire_when_already_neutral(self):
        prefs = AlertPreferences(user_id=1)
        events = evaluate_no_trade(
            prefs,
            self._analysis("NEUTRAL"),
            last_analysis=self._analysis("NEUTRAL"),
        )
        self.assertEqual([], events)

    def test_does_not_fire_when_now_actionable(self):
        prefs = AlertPreferences(user_id=1)
        events = evaluate_no_trade(
            prefs,
            self._analysis("BUY"),
            last_analysis=self._analysis("NEUTRAL"),
        )
        self.assertEqual([], events)

    def test_respects_watchlist(self):
        prefs = AlertPreferences(user_id=1, watchlist=["BTCUSD"])
        events = evaluate_no_trade(
            prefs,
            self._analysis("NEUTRAL"),
            last_analysis=self._analysis("BUY"),
        )
        self.assertEqual([], events)

    def test_no_previous_snapshot_no_fire(self):
        prefs = AlertPreferences(user_id=1)
        events = evaluate_no_trade(prefs, self._analysis("NEUTRAL"), last_analysis=None)
        self.assertEqual([], events)


if __name__ == "__main__":
    unittest.main()
