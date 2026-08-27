"""Unit tests for scanner.telegram_bot.

These tests avoid touching the real Telegram Bot API. The bot's
``_api`` method is monkey-patched to a recording stub so we can
assert what would have been sent without making network calls.
"""
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from scanner.alert_preferences import AlertPreferences, AlertPreferencesStore
from scanner.telegram_bot import TelegramBot


class TelegramBotLinkTokensTest(unittest.TestCase):
    def test_link_token_is_single_use(self):
        bot = TelegramBot(bot_token="t", bot_username="b")
        token = bot.mint_link_token(42)
        self.assertEqual(bot.consume_link_token(token), 42)
        # Second consume is None (single use)
        self.assertIsNone(bot.consume_link_token(token))

    def test_invalid_token_returns_none(self):
        bot = TelegramBot(bot_token="t", bot_username="b")
        self.assertIsNone(bot.consume_link_token("nope"))

    def test_deep_link_format(self):
        bot = TelegramBot(bot_token="t", bot_username="confluencex_alerts_bot")
        link = bot.deep_link("abc 123")
        self.assertTrue(link.startswith("https://t.me/confluencex_alerts_bot?start="))
        self.assertIn("abc%20123", link)

    def test_username_strips_at_prefix(self):
        bot = TelegramBot(bot_token="t", bot_username="@confluencex_alerts_bot")
        self.assertEqual(bot.bot_username, "confluencex_alerts_bot")


class TelegramBotWebhookSecretTest(unittest.TestCase):
    def test_no_secret_accepts_all(self):
        bot = TelegramBot(bot_token="t", bot_username="b", webhook_secret="")
        self.assertTrue(bot.verify_webhook_secret({"X-Telegram-Bot-Api-Secret-Token": "anything"}))

    def test_secret_mismatch_rejected(self):
        bot = TelegramBot(bot_token="t", bot_username="b", webhook_secret="expected")
        self.assertFalse(bot.verify_webhook_secret({"X-Telegram-Bot-Api-Secret-Token": "wrong"}))
        self.assertTrue(bot.verify_webhook_secret({"X-Telegram-Bot-Api-Secret-Token": "expected"}))


class TelegramBotDispatchTest(unittest.TestCase):
    def setUp(self):
        self.bot = TelegramBot(bot_token="t", bot_username="b")
        self.sent = []

        # ``fake_send`` closes over ``self.sent`` on the test instance
        # (not on the bot — the bot is the ``self`` of the bound method).
        sentinel = self

        def fake_send(self, chat_id, text, parse_mode="HTML", reply_markup=None, disable_preview=True):
            # When ``patch.object`` replaces a method, the bot instance is
            # passed as the first positional argument. Record the call.
            sentinel.sent.append({"chat_id": str(chat_id), "text": text})
            return {"ok": True, "result": {"message_id": 1}}

        self.send_patch = patch.object(TelegramBot, "send_message", fake_send)
        self.send_patch.start()

    def tearDown(self):
        self.send_patch.stop()

    def test_dispatch_requires_telegram_channel(self):
        prefs = AlertPreferences(user_id=1)
        prefs.telegram_chat_id = "12345"
        # telegram NOT in delivery_channels -> no-op
        self.assertFalse(self.bot.dispatch_event({"title": "x", "body": "y"}, prefs))
        self.assertEqual(self.sent, [])

    def test_dispatch_requires_chat_id(self):
        prefs = AlertPreferences(user_id=1)
        prefs.delivery_channels = ["telegram"]
        # telegram enabled but no chat_id -> no-op
        self.assertFalse(self.bot.dispatch_event({"title": "x", "body": "y"}, prefs))
        self.assertEqual(self.sent, [])

    def test_dispatch_sends_when_ready(self):
        prefs = AlertPreferences(user_id=1)
        prefs.delivery_channels = ["telegram"]
        prefs.telegram_chat_id = "12345"
        ok = self.bot.dispatch_event(
            {
                "title": "BTCUSD setup confirmed",
                "body": "Cleared thresholds.",
                "severity": "info",
                "pair": "BTCUSD",
                "timeframe": "4h",
                "payload": {"direction": "BUY", "entry": 67500, "stop": 66200, "targets": [69000], "atr": 1500},
            },
            prefs,
        )
        self.assertTrue(ok)
        self.assertEqual(len(self.sent), 1)
        msg = self.sent[0]
        self.assertEqual(msg["chat_id"], "12345")
        # The new compact format: pair, direction, entry zone, SL, TP1.
        self.assertIn("BTCUSD", msg["text"])
        self.assertIn("BUY", msg["text"])
        self.assertIn("66200", msg["text"])  # stop
        self.assertIn("69000", msg["text"])  # target

    def test_dispatch_respects_rate_limit(self):
        prefs = AlertPreferences(user_id=1)
        prefs.delivery_channels = ["telegram"]
        prefs.telegram_chat_id = "12345"
        # Burn through the rate limit for this chat
        for _ in range(25):
            prefs_other = AlertPreferences(user_id=_ + 2)
            prefs_other.delivery_channels = ["telegram"]
            prefs_other.telegram_chat_id = "12345"
            self.bot.dispatch_event({"title": "x", "body": "y"}, prefs_other)
        # The next call must be dropped
        prefs_next = AlertPreferences(user_id=99)
        prefs_next.delivery_channels = ["telegram"]
        prefs_next.telegram_chat_id = "12345"
        ok = self.bot.dispatch_event({"title": "x", "body": "y"}, prefs_next)
        self.assertFalse(ok)

    def test_dispatch_cooldown_blocks_same_pair_within_window(self):
        """Bobby's spec: cooldown between duplicate alerts for the same setup."""
        prefs = AlertPreferences(user_id=1)
        prefs.delivery_channels = ["telegram"]
        prefs.telegram_chat_id = "12345"
        event = {
            "alert_type": "new_trade",
            "title": "XAUUSD BUY",
            "body": "...",
            "severity": "info",
            "pair": "XAUUSD",
            "timeframe": "h1",
            "payload": {"direction": "BUY", "entry": 3387.5, "stop": 3381.0, "targets": [3395.0], "atr": 12.0},
        }
        # First call within 60-min window: should send.
        self.assertTrue(self.bot.dispatch_event(event, prefs))
        # Immediate second call: cooldown must block.
        self.assertEqual(len(self.sent), 1)
        self.assertFalse(self.bot.dispatch_event(event, prefs))
        self.assertEqual(len(self.sent), 1)

    def test_dispatch_cooldown_does_not_block_different_pairs(self):
        prefs = AlertPreferences(user_id=1)
        prefs.delivery_channels = ["telegram"]
        prefs.telegram_chat_id = "12345"
        xau = {
            "alert_type": "new_trade", "pair": "XAUUSD", "timeframe": "h1",
            "payload": {"direction": "BUY", "entry": 3387.5, "stop": 3381.0, "targets": [3395.0], "atr": 12.0},
        }
        eurusd = {
            "alert_type": "new_trade", "pair": "EURUSD", "timeframe": "h1",
            "payload": {"direction": "BUY", "entry": 1.0850, "stop": 1.0800, "targets": [1.0900], "atr": 0.0050},
        }
        self.assertTrue(self.bot.dispatch_event(xau, prefs))
        self.assertTrue(self.bot.dispatch_event(eurusd, prefs))
        self.assertEqual(len(self.sent), 2)

    def test_dispatch_cooldown_does_not_block_warning_events(self):
        """Critical alerts (news risk, invalidation) must bypass cooldowns."""
        prefs = AlertPreferences(user_id=1)
        prefs.delivery_channels = ["telegram"]
        prefs.telegram_chat_id = "12345"
        news = {
            "alert_type": "news_risk",
            "pair": "XAUUSD",
            "severity": "critical",
            "body": "USD CPI in 5 min",
            "payload": {},
        }
        for _ in range(5):
            self.assertTrue(self.bot.dispatch_event(news, prefs))
        self.assertEqual(len(self.sent), 5)


class TelegramBotCommandTest(unittest.TestCase):
    """The command handlers read from / write to AlertPreferencesStore."""

    def _state(self, tmp_dir):
        store = AlertPreferencesStore(root=tmp_dir)
        state = SimpleNamespace(alert_preferences_store=store)
        return state, store

    def test_start_with_valid_token_links_chat(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            state, store = self._state(tmp)
            bot = TelegramBot(bot_token="t", bot_username="b")
            token = bot.mint_link_token(7)
            update = {
                "message": {
                    "chat": {"id": 555},
                    "text": f"/start {token}",
                }
            }
            response = bot.handle_update(update, state)
            self.assertIsNotNone(response)
            self.assertIn("Connected", response)
            prefs = store.get(7)
            self.assertIsNotNone(prefs)
            self.assertEqual(prefs.telegram_chat_id, "555")
            self.assertIn("telegram", prefs.delivery_channels)
            self.assertEqual(bot.user_for_chat(555), 7)

    def test_start_with_invalid_token_does_not_link(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            state, _ = self._state(tmp)
            bot = TelegramBot(bot_token="t", bot_username="b")
            update = {
                "message": {
                    "chat": {"id": 555},
                    "text": "/start bogus",
                }
            }
            response = bot.handle_update(update, state)
            self.assertIsNotNone(response)
            self.assertIn("invalid", response.lower())
            self.assertIsNone(bot.user_for_chat(555))

    def test_status_requires_linked_chat(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            state, _ = self._state(tmp)
            bot = TelegramBot(bot_token="t", bot_username="b")
            response = bot.handle_update(
                {"message": {"chat": {"id": 555}, "text": "/status"}}, state
            )
            self.assertIn("not linked", response.lower())

    def test_subscribe_and_unsubscribe(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            state, store = self._state(tmp)
            bot = TelegramBot(bot_token="t", bot_username="b")
            token = bot.mint_link_token(11)
            bot.handle_update({"message": {"chat": {"id": 999}, "text": f"/start {token}"}}, state)
            bot.handle_update(
                {"message": {"chat": {"id": 999}, "text": "/subscribe BTCUSD"}}, state
            )
            prefs = store.get(11)
            self.assertIn("BTCUSD", prefs.watchlist)
            bot.handle_update(
                {"message": {"chat": {"id": 999}, "text": "/unsubscribe btcusd"}}, state
            )
            prefs = store.get(11)
            self.assertNotIn("BTCUSD", prefs.watchlist)

    def test_stop_disables_telegram_but_keeps_chat_id(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            state, store = self._state(tmp)
            bot = TelegramBot(bot_token="t", bot_username="b")
            token = bot.mint_link_token(13)
            bot.handle_update({"message": {"chat": {"id": 888}, "text": f"/start {token}"}}, state)
            bot.handle_update({"message": {"chat": {"id": 888}, "text": "/stop"}}, state)
            prefs = store.get(13)
            # chat_id preserved for re-enable, but telegram disabled
            self.assertEqual(prefs.telegram_chat_id, "888")
            self.assertNotIn("telegram", prefs.delivery_channels)


class TelegramBotFormatTest(unittest.TestCase):
    def test_format_event_renders_required_fields(self):
        text = TelegramBot.format_event(
            {
                "title": "BTCUSD BUY setup confirmed",
                "body": "Setup quality 75/100 and timing 65/100 cleared your thresholds.",
                "severity": "info",
                "pair": "BTCUSD",
                "timeframe": "4h",
                "payload": {
                    "direction": "BUY",
                    "entry": 67500,
                    "stop": 66200,
                    "targets": [69000, 71000],
                    "atr": 1500,
                    "score": 78,
                    "net_rr": 2.3,
                    "rationale": ["H1 Bullish Structure", "M15 Breakout Retest"],
                },
            }
        )
        # Compact shape: pair, direction, TF, zone, stop, tp1, tp2, score, RR.
        self.assertIn("BTCUSD", text)
        self.assertIn("4H", text)
        self.assertIn("66200", text)  # stop
        self.assertIn("69000", text)  # tp1
        self.assertIn("71000", text)  # tp2
        self.assertIn("78", text)     # score
        self.assertIn("2.3", text)    # rr
        # Compact: no verbose body, no Entry label-only line for single price.
        self.assertNotIn("Direction:", text)
        self.assertNotIn("Targets:", text)

    def test_format_event_critical_severity_uses_emoji(self):
        text = TelegramBot.format_event(
            {
                "alert_type": "news_risk",
                "title": "News risk",
                "body": "Calendar blocked.",
                "severity": "critical",
                "pair": "ETHUSD",
                "payload": {},
            }
        )
        self.assertIn("ETHUSD", text)
        self.assertIn("🚨", text)
        self.assertNotIn("Targets:", text)

    def test_format_compact_xauusd_template(self):
        """Bobby's preferred XAUUSD compact alert shape."""
        text = TelegramBot.format_event({
            "alert_type": "new_trade",
            "title": "NEW TRADE: XAUUSD BUY",
            "body": "STRONG BUY at 82/100",
            "severity": "info",
            "pair": "XAUUSD",
            "timeframe": "h1",
            "payload": {
                "direction": "BUY",
                "entry": 3387.50,
                "stop": 3381.00,
                "targets": [3395.00, 3402.00, 3410.00],
                "atr": 12.0,
                "score": 82,
                "net_rr": 2.1,
                "rationale": ["H1 Bullish Structure", "M15 Breakout Retest", "EMA50 Support"],
                "why": "H1 bullish BOS + M15 retest + EMA50 support",
                "risk": "USD CPI 10:00 ET (15m)",
                "bar_time": "13:00",
                "live_price": 3388.40,
            },
        })
        # Bobby's example: "🟢 XAUUSD BUY / Entry: 3387–3389 / SL: 3381 / TP1: 3395 / TP2: 3402 / R:R: 1:2.1 / Confidence: 82%"
        for needle in (
            "XAUUSD", "BUY", "3381.00", "3395.00", "3402.00", "3410.00",
            "1:2.1", "82",
            "H1 bullish BOS", "USD CPI 10:00 ET",
            "3388.40",
        ):
            self.assertIn(needle, text, f"missing {needle} in:\n{text}")
        # Compact: should NOT include verbose boilerplate from the old format.
        for forbidden in ("Direction:", "Targets:", "Pair:", "TF:", "[INFO]"):
            self.assertNotIn(forbidden, text, f"verbose boilerplate leaked: {forbidden}")
        # Sanity bound: should be readable in 5–10 seconds, not a paragraph.
        self.assertLess(len(text), 500, f"alert too long ({len(text)} chars):\n{text}")

    def test_format_compact_includes_why_line(self):
        text = TelegramBot.format_event({
            "alert_type": "new_trade",
            "pair": "XAUUSD",
            "timeframe": "h1",
            "payload": {
                "direction": "BUY",
                "entry": 3387.5,
                "stop": 3381.0,
                "targets": [3395.0],
                "atr": 12.0,
                "rationale": ["H1 Bullish Structure", "M15 Breakout Retest", "EMA50 Support"],
            },
        })
        self.assertIn("Why:", text)
        self.assertIn("H1 Bullish Structure", text)

    def test_format_compact_sell_uses_red_emoji(self):
        text = TelegramBot.format_event({
            "alert_type": "new_trade",
            "pair": "XAUUSD",
            "timeframe": "h1",
            "payload": {
                "direction": "SELL",
                "entry": 3400.0,
                "stop": 3407.0,
                "targets": [3390.0],
                "atr": 12.0,
            },
        })
        self.assertIn("🔴", text)
        self.assertIn("SELL", text)

    def test_format_compact_no_trade_state(self):
        text = TelegramBot.format_event({
            "alert_type": "no_trade",
            "pair": "XAUUSD",
            "severity": "info",
            "payload": {"score": 17, "reasons": ["HTF conflict", "ADX too low"]},
            "body": "No qualified setup",
        })
        self.assertIn("XAUUSD", text)
        self.assertIn("no trade", text.lower())

    def test_format_compact_marks_stale_data(self):
        text = TelegramBot.format_event({
            "alert_type": "new_trade",
            "pair": "XAUUSD",
            "timeframe": "h1",
            "payload": {
                "direction": "BUY",
                "entry": 3387.5,
                "stop": 3381.0,
                "targets": [3395.0],
                "atr": 12.0,
                "stale_minutes": 92,
                "live_price": 3388.4,
            },
        })
        self.assertIn("stale 92m", text)

    def test_format_event_handles_missing_atr_with_wider_zone(self):
        # No ATR → falls back to entry*0.001 width. Should still render cleanly.
        text = TelegramBot.format_event({
            "alert_type": "new_trade",
            "pair": "XAUUSD",
            "payload": {
                "direction": "BUY",
                "entry": 3387.5,
                "stop": 3381.0,
                "targets": [3395.0],
            },
        })
        self.assertIn("Entry:", text)
        # No crash, no NaN, no None in the output.
        self.assertNotIn("None", text)
        self.assertNotIn("nan", text.lower())


if __name__ == "__main__":
    unittest.main()