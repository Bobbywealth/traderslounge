"""ConfluenceX Telegram bot.

Provides:

- ``TelegramBot`` — minimal Bot API client. Handles incoming ``/start``,
  ``/stop``, ``/status``, ``/help``, ``/subscribe``, ``/unsubscribe``
  commands and outgoing alert dispatches. State is kept in-process and
  is intentionally not durable across restarts: link tokens are short
  lived (10 min), and the ``chat_id -> user_id`` map is rebuilt from
  the ``AlertPreferencesStore`` on each cold start.
- Per-chat rate limiting so a misconfigured user cannot flood Telegram.
- ``send_message`` / ``set_webhook`` / ``get_webhook_info`` wrappers
  around the official Bot API over HTTPS.

The bot deliberately avoids pulling in extra dependencies and uses
``urllib`` so the existing Render Starter footprint does not grow.
"""
from __future__ import annotations

import json
import logging
import os
import secrets
import threading
import time
import urllib.parse
import urllib.request
import uuid
from typing import Any, Callable, Optional
from urllib.error import HTTPError, URLError

logger = logging.getLogger(__name__)

TELEGRAM_API = "https://api.telegram.org/bot{token}/{method}"
LINK_TOKEN_TTL_SECONDS = 600  # 10 minutes, single-use
RATE_LIMIT_PER_MINUTE = 20
ALLOWED_UPDATES = ["message"]


class TelegramBot:
    """Stateful bot handle. Construct once at API startup."""

    def __init__(
        self,
        bot_token: Optional[str] = None,
        bot_username: Optional[str] = None,
        webhook_secret: Optional[str] = None,
    ) -> None:
        self.bot_token = (bot_token if bot_token is not None else os.environ.get("TELEGRAM_BOT_TOKEN", "")).strip()
        self.bot_username = (
            bot_username if bot_username is not None else os.environ.get("TELEGRAM_BOT_USERNAME", "")
        ).strip().lstrip("@")
        self.webhook_secret = (
            webhook_secret if webhook_secret is not None else os.environ.get("TELEGRAM_WEBHOOK_SECRET", "")
        ).strip()

        self._link_tokens: dict[str, dict[str, Any]] = {}
        self._link_tokens_lock = threading.Lock()
        self._rate_buckets: dict[int, list[float]] = {}
        self._rate_lock = threading.Lock()
        self._chat_to_user: dict[int, int] = {}
        self._chat_lock = threading.Lock()
        # Per-pair+direction cooldown so a chatty market can't replay the
        # same setup every scanner cycle. See ``should_send`` for policy.
        self._alert_cooldowns: dict[str, float] = {}
        self._cooldowns_lock = threading.Lock()

    @property
    def is_configured(self) -> bool:
        return bool(self.bot_token)

    @property
    def deep_link_base(self) -> str:
        user = self.bot_username or "bot"
        return f"https://t.me/{user}"

    def _api(self, method: str, params: Optional[dict] = None, files: Optional[dict] = None) -> Optional[dict]:
        if not self.bot_token:
            logger.warning("telegram bot token not configured; skipping %s", method)
            return None
        url = TELEGRAM_API.format(token=self.bot_token, method=method)
        try:
            if files:
                boundary = uuid.uuid4().hex
                body = (
                    f"--{boundary}\r\n".encode()
                    + "".join(
                        f'Content-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n--{boundary}\r\n'.encode()
                        for k, v in (params or {}).items()
                    )
                )
                for k, (filename, content, mime) in files.items():
                    body += (
                        f'Content-Disposition: form-data; name="{k}"; filename="{filename}"\r\n'
                        f"Content-Type: {mime}\r\n\r\n"
                    ).encode() + content + b"\r\n--" + boundary.encode() + b"\r\n"
                body += f"--{boundary}--\r\n".encode()
                req = urllib.request.Request(
                    url,
                    data=body,
                    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
                )
            else:
                req = urllib.request.Request(
                    url,
                    data=json.dumps(params or {}).encode(),
                    headers={"Content-Type": "application/json"},
                )
            with urllib.request.urlopen(req, timeout=10) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
                if not payload.get("ok"):
                    logger.warning(
                        "telegram api %s returned error: %s", method, payload.get("description")
                    )
                return payload
        except (HTTPError, URLError) as exc:
            logger.warning("telegram api %s network failure: %s", method, exc)
            return None
        except Exception as exc:
            logger.warning("telegram api %s unexpected failure: %s", method, exc)
            return None

    def send_message(self, chat_id, text, parse_mode="HTML", reply_markup=None, disable_preview=True):
        params = {
            "chat_id": str(chat_id),
            "text": text,
            "parse_mode": parse_mode,
            "disable_web_page_preview": disable_preview,
        }
        if reply_markup is not None:
            params["reply_markup"] = json.dumps(reply_markup)
        return self._api("sendMessage", params)

    def set_webhook(self, url):
        params = {
            "url": url,
            "drop_pending_updates": True,
            "allowed_updates": ALLOWED_UPDATES,
        }
        if self.webhook_secret:
            params["secret_token"] = self.webhook_secret
        return self._api("setWebhook", params)

    def delete_webhook(self):
        return self._api("deleteWebhook", {"drop_pending_updates": True})

    def get_webhook_info(self):
        return self._api("getWebhookInfo")

    def mint_link_token(self, user_id):
        token = secrets.token_urlsafe(24)
        expires_at = time.time() + LINK_TOKEN_TTL_SECONDS
        with self._link_tokens_lock:
            self._link_tokens[token] = {"user_id": int(user_id), "expires_at": expires_at}
            self._gc_link_tokens()
        return token

    def consume_link_token(self, token):
        with self._link_tokens_lock:
            meta = self._link_tokens.pop(token, None)
        if not meta:
            return None
        if meta["expires_at"] < time.time():
            return None
        return int(meta["user_id"])

    def deep_link(self, token):
        return f"{self.deep_link_base}?start={urllib.parse.quote(token)}"

    def _gc_link_tokens(self):
        now = time.time()
        self._link_tokens = {t: meta for t, meta in self._link_tokens.items() if meta["expires_at"] > now}

    def remember_chat_link(self, chat_id, user_id):
        try:
            cid = int(chat_id)
            uid = int(user_id)
        except (TypeError, ValueError):
            return
        with self._chat_lock:
            self._chat_to_user[cid] = uid

    def user_for_chat(self, chat_id):
        try:
            cid = int(chat_id)
        except (TypeError, ValueError):
            return None
        with self._chat_lock:
            return self._chat_to_user.get(cid)

    def forget_chat_link(self, chat_id):
        try:
            cid = int(chat_id)
        except (TypeError, ValueError):
            return
        with self._chat_lock:
            self._chat_to_user.pop(cid, None)

    def allow_send(self, chat_id):
        try:
            cid = int(chat_id)
        except (TypeError, ValueError):
            return False
        now = time.time()
        with self._rate_lock:
            history = self._rate_buckets.setdefault(cid, [])
            cutoff = now - 60.0
            history[:] = [t for t in history if t > cutoff]
            if len(history) >= RATE_LIMIT_PER_MINUTE:
                return False
            history.append(now)
            return True

    def verify_webhook_secret(self, headers):
        if not self.webhook_secret:
            return True
        return headers.get("X-Telegram-Bot-Api-Secret-Token", "") == self.webhook_secret

    def handle_update(self, update, api_state):
        msg = update.get("message") or update.get("edited_message")
        if not msg:
            return None
        text = (msg.get("text") or "").strip()
        chat = msg.get("chat") or {}
        chat_id = chat.get("id")
        if not chat_id or not text:
            return None

        parts = text.split(maxsplit=1)
        cmd = parts[0].lower()
        arg = parts[1] if len(parts) > 1 else ""

        if cmd == "/start":
            return self._cmd_start(chat_id, arg, api_state)
        if cmd == "/stop":
            return self._cmd_stop(chat_id, api_state)
        if cmd == "/status":
            return self._cmd_status(chat_id, api_state)
        if cmd == "/help":
            return self._cmd_help()
        if cmd == "/subscribe":
            return self._cmd_subscribe(chat_id, arg, api_state)
        if cmd == "/unsubscribe":
            return self._cmd_unsubscribe(chat_id, arg, api_state)
        return self._cmd_help()

    def _cmd_start(self, chat_id, arg, api_state):
        token = (arg or "").strip()
        if not token:
            return (
                "Welcome to <b>ConfluenceX Alerts</b>.\n\n"
                "To connect this chat, open the Alerts page on the dashboard "
                "and click <b>Connect Telegram</b>. Send /help for commands."
            )
        user_id = self.consume_link_token(token)
        if user_id is None:
            return (
                "This link is invalid or expired. Please go back to the Alerts "
                "page on the dashboard and click <b>Connect Telegram</b> again."
            )
        store = getattr(api_state, "alert_preferences_store", None)
        if store is None or not hasattr(store, "get"):
            return "Alerts service not ready. Try again in a moment."
        prefs = store.get(int(user_id))
        if prefs is None:
            from .alert_preferences import AlertPreferences
            prefs = AlertPreferences(user_id=int(user_id))
        prefs.telegram_chat_id = str(chat_id)
        if "telegram" not in prefs.delivery_channels:
            prefs.delivery_channels = list(prefs.delivery_channels) + ["telegram"]
        store.upsert(prefs)
        self.remember_chat_link(chat_id, user_id)
        return (
            "Connected. ConfluenceX alerts will now arrive in this chat.\n\n"
            "<b>Commands</b>\n"
            "/status — show your preferences\n"
            "/subscribe BTCUSD — add a pair to your watchlist\n"
            "/unsubscribe BTCUSD — remove a pair\n"
            "/stop — disable Telegram delivery (keeps chat linked)\n"
            "/help — full command list"
        )

    def _cmd_stop(self, chat_id, api_state):
        prefs = self._lookup_prefs_by_chat(chat_id, api_state)
        if prefs is None:
            return "This chat is not linked. Use /start with a link token from the dashboard."
        if "telegram" in prefs.delivery_channels:
            prefs.delivery_channels = [c for c in prefs.delivery_channels if c != "telegram"]
        store = getattr(api_state, "alert_preferences_store", None)
        if store is not None and hasattr(store, "upsert"):
            store.upsert(prefs)
        return (
            "Telegram delivery disabled. Your chat is still linked. "
            "Re-enable from the dashboard or send /start again."
        )

    def _cmd_status(self, chat_id, api_state):
        prefs = self._lookup_prefs_by_chat(chat_id, api_state)
        if prefs is None:
            return "This chat is not linked. Use /start with a link token from the dashboard."
        pairs = ", ".join(prefs.watchlist) if prefs.watchlist else "<i>all pairs</i>"
        channels = ", ".join(prefs.delivery_channels) if prefs.delivery_channels else "<i>none</i>"
        return (
            "<b>Status</b>\n"
            f"Linked chat: <code>{chat_id}</code>\n"
            f"Watchlist: {pairs}\n"
            f"Channels: {channels}\n"
            f"Setup quality ≥ {prefs.setup_quality_minimum}/100\n"
            f"Timing ≥ {prefs.timing_minimum}/100\n"
            f"Risk/trade: {prefs.risk_per_trade_pct}%"
        )

    def _cmd_help(self):
        return (
            "<b>ConfluenceX Alerts</b>\n\n"
            "/start [token] — link this chat to your account\n"
            "/status — show your preferences\n"
            "/subscribe BTCUSD — add a pair to your watchlist\n"
            "/unsubscribe BTCUSD — remove a pair\n"
            "/stop — disable Telegram delivery (keeps chat linked)\n"
            "/help — this message"
        )

    def _cmd_subscribe(self, chat_id, arg, api_state):
        pair = self._normalise_pair(arg)
        if not pair:
            return "Usage: <code>/subscribe BTCUSD</code>"
        prefs = self._lookup_prefs_by_chat(chat_id, api_state)
        if prefs is None:
            return "This chat is not linked. Use /start with a link token from the dashboard."
        if not any(p.upper() == pair for p in prefs.watchlist):
            prefs.watchlist = list(prefs.watchlist) + [pair]
        store = getattr(api_state, "alert_preferences_store", None)
        if store is not None and hasattr(store, "upsert"):
            store.upsert(prefs)
        return f"Added <b>{pair}</b> to your watchlist."

    def _cmd_unsubscribe(self, chat_id, arg, api_state):
        pair = self._normalise_pair(arg)
        if not pair:
            return "Usage: <code>/unsubscribe BTCUSD</code>"
        prefs = self._lookup_prefs_by_chat(chat_id, api_state)
        if prefs is None:
            return "This chat is not linked. Use /start with a link token from the dashboard."
        before = len(prefs.watchlist)
        prefs.watchlist = [p for p in prefs.watchlist if p.upper() != pair]
        removed = before - len(prefs.watchlist)
        store = getattr(api_state, "alert_preferences_store", None)
        if store is not None and hasattr(store, "upsert"):
            store.upsert(prefs)
        if removed:
            return f"Removed <b>{pair}</b> from your watchlist."
        return f"<b>{pair}</b> was not on your watchlist."

    def _lookup_prefs_by_chat(self, chat_id, api_state):
        user_id = self.user_for_chat(chat_id)
        if user_id is None:
            return None
        store = getattr(api_state, "alert_preferences_store", None)
        if store is None or not hasattr(store, "get"):
            return None
        return store.get(int(user_id))

    @staticmethod
    def _normalise_pair(arg):
        return (arg or "").strip().upper().replace("/", "").replace("-", "")

    @staticmethod
    def _fmt_price(value, decimals=2):
        """Render a price with at most ``decimals`` decimals, no scientific."""
        try:
            v = float(value)
        except (TypeError, ValueError):
            return "-"
        # No thousands separator on purpose — Bobby's preferred alert
        # format keeps prices compact and aligned (e.g. "3387.00" not
        # "3,387.00"). Comma noise also fights Telegram's monospace
        # alignment in <code> blocks.
        return f"{v:.{decimals}f}"

    @staticmethod
    def _fmt_ratio(rr):
        try:
            r = float(rr)
        except (TypeError, ValueError):
            return "1:0"
        return f"1:{r:.1f}"

    @staticmethod
    def _entry_zone(entry, atr_value):
        """Turn a single entry price into a tight zone (entry ± 0.25*ATR).

        Gold-style instruments trade in tight zones around the planned
        entry, not exact ticks. A zone also gives the trader room to
        scale in rather than chasing a single price level.
        """
        try:
            entry_f = float(entry)
        except (TypeError, ValueError):
            return "-"
        try:
            atr_f = float(atr_value) if atr_value is not None else 0.0
        except (TypeError, ValueError):
            atr_f = 0.0
        # Default zone width: 0.4*ATR, clamped to sensible gold range.
        half = atr_f * 0.20 if atr_f > 0 else max(0.5, abs(entry_f) * 0.001)
        low = entry_f - half
        high = entry_f + half
        return f"{low:.2f}–{high:.2f}"

    @classmethod
    def format_event(cls, event):
        """Render an alert in the compact, action-first format Bobby asked for.

        Compact ``NEW_TRADE`` shape::

            🟢 XAUUSD BUY
            Entry: 3387.50–3389.00
            SL:    3381.00
            TP1:   3395.00  TP2: 3402.00
            R:R:   1:2.1   Conf: 82%
            Why:   H1 bullish BOS + M15 retest + EMA50 support
            Risk:  USD CPI 10:00 ET (15m)
            Bar:   H1 closed 13:00 UTC · live 3388.40

        All other event types fall back to a compact summary so the bot
        never spams long paragraphs into Telegram.
        """
        alert_type = (event.get("alert_type") or "").lower()
        title = event.get("title") or "Alert"
        body = event.get("body") or ""
        severity = (event.get("severity") or "info").lower()
        payload = event.get("payload") or {}
        pair = (event.get("pair") or payload.get("pair") or "").upper()
        timeframe = (event.get("timeframe") or payload.get("timeframe") or "").upper()
        direction = (payload.get("direction") or "").upper()

        # --- Actionable guarded trade call (compact card) ----------------
        if alert_type == "new_trade" or (
            payload.get("entry") is not None
            and payload.get("stop") is not None
            and direction in ("BUY", "SELL")
        ):
            return cls._format_compact_trade(
                pair=pair, timeframe=timeframe, direction=direction,
                payload=payload, title=title, body=body, severity=severity,
            )

        # --- News risk / invalidation / confirmation / fallback -----------
        return cls._format_status_event(
            alert_type=alert_type, pair=pair, timeframe=timeframe,
            title=title, body=body, severity=severity, payload=payload,
        )

    @classmethod
    def _format_compact_trade(cls, *, pair, timeframe, direction, payload, title, body, severity):
        entry = payload.get("entry")
        stop = payload.get("stop") or payload.get("stop_loss")
        atr = payload.get("atr")
        targets = payload.get("targets") or []
        targets = [t for t in targets if t is not None]
        score = payload.get("score")
        net_rr = payload.get("net_rr")
        rationale = payload.get("rationale") or []
        why = payload.get("why")  # explicit override if caller pre-formats
        risk = payload.get("risk")  # next news event string
        bar_time = payload.get("bar_time") or payload.get("source_candle_time")
        live_price = payload.get("live_price")
        stale_minutes = payload.get("stale_minutes")

        emoji = {"buy": "🟢", "sell": "🔴"}.get(direction.lower(), "⚪️")
        head = f"{emoji} <b>{pair} {direction}</b>"
        if timeframe:
            head += f"  <i>{timeframe}</i>"

        zone = cls._entry_zone(entry, atr)
        lines = [head, f"Entry: <code>{zone}</code>"]

        if stop is not None:
            lines.append(f"SL:    <code>{cls._fmt_price(stop)}</code>")
        for idx, target in enumerate(targets[:3], start=1):
            label = f"TP{idx}"
            lines.append(f"{label}:   <code>{cls._fmt_price(target)}</code>")

        meta_bits = []
        if net_rr is not None:
            meta_bits.append(f"R:R <code>{cls._fmt_ratio(net_rr)}</code>")
        if score is not None:
            meta_bits.append(f"Conf <code>{int(score)}/100</code>")
        if meta_bits:
            lines.append(" · ".join(meta_bits))

        if not why and rationale:
            # rationale is a list of category names like ["H1 Bullish Structure",
            # "M15 Breakout Retest", "EMA Support"]. Turn into a compact
            # "Why" line the user can read in 1 second.
            why = " + ".join(str(r) for r in rationale[:3])
        if why:
            lines.append(f"<i>Why:</i> {why}")

        if risk:
            lines.append(f"<i>Risk:</i> {risk}")

        # Show where the alert's "entry" actually came from so the user can
        # tell at-a-glance whether they're looking at a live tick, an H1
        # candle close, or a stale bar.
        src_bits = []
        if bar_time:
            try:
                src_bits.append(f"bar {bar_time}")
            except Exception:
                pass
        if live_price is not None:
            src_bits.append(f"live <code>{cls._fmt_price(live_price)}</code>")
        if stale_minutes is not None and int(stale_minutes) > 0:
            src_bits.append(f"<b>stale {int(stale_minutes)}m</b>")
        if src_bits:
            lines.append(f"<i>Source:</i> {' · '.join(src_bits)}")

        if severity == "critical":
            lines.append("⚠ <b>CRITICAL</b>")
        elif severity == "warning":
            lines.append("⚠ <i>heads-up</i>")

        return "\n".join(lines)

    @classmethod
    def _format_status_event(cls, *, alert_type, pair, timeframe, title, body, severity, payload):
        emoji = {"info": "ℹ️", "warning": "⚠️", "critical": "🚨"}.get(severity, "ℹ️")
        head_bits = [emoji]
        if pair:
            head_bits.append(f"<b>{pair}</b>")
        if alert_type:
            head_bits.append(f"<i>{alert_type.replace('_', ' ')}</i>")
        if timeframe:
            head_bits.append(f"({timeframe})")
        head = " ".join(head_bits)
        # Keep the body but trim noisy boilerplate — at most 4 lines, ~400 chars.
        compact_body = (body or title).strip().replace("\n", " · ")
        if len(compact_body) > 380:
            compact_body = compact_body[:377] + "..."
        lines = [head, compact_body]
        if payload.get("calendar_status"):
            lines.append(f"Calendar: <code>{payload['calendar_status']}</code>")
        return "\n".join(lines)

    @staticmethod
    def _cooldown_key(pair, direction, alert_type):
        return f"{(pair or '').upper()}|{(direction or '').upper()}|{(alert_type or '').lower()}"

    def should_send(self, event, cooldown_minutes=60):
        """Return True if the alert is past its cooldown window.

        Trade-call cooldowns default to 60 minutes for the same
        pair+direction so a quiet market can't replay the same setup
        every scan cycle. WAIT/NO_TRADE and NEWS_RISK have shorter
        windows so the user still gets the protective context.
        """
        payload = event.get("payload") or {}
        pair = (event.get("pair") or payload.get("pair") or "").upper()
        direction = (payload.get("direction") or "").upper()
        alert_type = (event.get("alert_type") or "").lower()
        if not pair:
            return True
        # Only cooldown actionable trade-call alerts; never gate warnings.
        if alert_type and alert_type not in ("new_trade", "entry_zone", "confirmation"):
            return True
        key = self._cooldown_key(pair, direction, alert_type)
        now = time.time()
        with self._cooldowns_lock:
            last = self._alert_cooldowns.get(key)
            if last is None or (now - last) >= cooldown_minutes * 60:
                self._alert_cooldowns[key] = now
                return True
            remaining = cooldown_minutes - (now - last) / 60
        logger.info(
            "telegram cooldown active for %s (%.0fm remaining); dropping alert",
            key, remaining,
        )
        return False

    def dispatch_event(self, event, user_prefs, *, cooldown_minutes=60):
        if not self.is_configured:
            return False
        if not user_prefs:
            return False
        if "telegram" not in (user_prefs.delivery_channels or []):
            return False
        chat_id = getattr(user_prefs, "telegram_chat_id", None)
        if not chat_id:
            return False
        if not self.allow_send(chat_id):
            logger.info("telegram rate limit hit for chat %s; dropping alert", chat_id)
            return False
        if not self.should_send(event, cooldown_minutes=cooldown_minutes):
            return False
        text = self.format_event(event)
        result = self.send_message(chat_id, text)
        return bool(result and result.get("ok"))
