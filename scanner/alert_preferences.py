"""Alert preferences and rule evaluation for ConfluenceX.

This module backs the Phase 3 alert / personalization system. It is
deliberately small and self-contained: preferences live as JSON on
disk (one file per user, mode 600) so we can ship without schema
migrations, and the evaluation engine is pure-functional so we can
unit-test it without spinning up the API.

Public surface:

  - :class:`AlertPreferences` — the persisted preference document.
  - :class:`AlertEvent`       — a single alert the engine fired.
  - :func:`evaluate_rules`    — pure rule evaluation against a
                                snapshot. Returns the list of
                                :class:`AlertEvent` for one user.
  - :class:`AlertPreferencesStore`
                              — disk-backed CRUD over
                                ``~/.openclaw/state/alerts/<user>.json``.

Per Bobby's spec the engine must fire on five event types:

  - entry_zone           — price entered the planned entry zone
  - confirmation         — setup quality + timing crossed the
                            user's minimum and the bias confirmed
  - news_risk            — economic calendar status flipped to
                            BLOCKED / CAUTION / POST_NEWS
  - invalidation         — price reached the invalidation level
                            (or the ATR stop)
  - daily_briefing       — once per day, top setups + risk
  - weekly_briefing      — once per week, performance summary

The custom watchlists + timeframes + sessions are evaluated against
the snapshot's pair + timeframe. Risk-per-trade and setup-quality
minimums gate which setups the engine will even consider firing
``entry_zone`` or ``confirmation`` for.

This file is intentionally decoupled from the API. The api layer
wraps it in handlers; the engine is testable in isolation.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import tempfile
import threading
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Iterable

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Enums and constants
# ---------------------------------------------------------------------------


class AlertType(str, Enum):
    NEW_TRADE = "new_trade"
    ENTRY_ZONE = "entry_zone"
    CONFIRMATION = "confirmation"
    NEWS_RISK = "news_risk"
    INVALIDATION = "invalidation"
    DAILY_BRIEFING = "daily_briefing"
    WEEKLY_BRIEFING = "weekly_briefing"


class DeliveryChannel(str, Enum):
    IN_APP = "in_app"
    TELEGRAM = "telegram"
    EMAIL = "email"
    PUSH = "push"


class TradingSession(str, Enum):
    LONDON = "london"
    NEW_YORK = "new_york"
    TOKYO = "tokyo"
    SYDNEY = "sydney"
    OVERLAP = "overlap"  # London/NY overlap


# ---------------------------------------------------------------------------
# Preference document
# ---------------------------------------------------------------------------


# All fields default to the most conservative settings so an empty
# preference document is safe to deploy.
@dataclass
class AlertPreferences:
    user_id: int
    # Markets the user wants alerts for. Empty = all scanner pairs.
    watchlist: list[str] = field(default_factory=list)
    # Per-timeframe interest, e.g. {"1h": True, "4h": True, "1d": False}.
    timeframes: dict[str, bool] = field(
        default_factory=lambda: {"1h": True, "4h": True, "1d": True, "1w": False}
    )
    # Sessions the user is actively trading. Empty = all.
    sessions: list[str] = field(default_factory=list)
    # 0–100 minimum setup_quality score for the engine to consider a
    # CONFIRMATION alert.
    setup_quality_minimum: int = 60
    # 0–100 minimum timing readiness for CONFIRMATION alerts.
    timing_minimum: int = 60
    # % of account per trade. Used in the briefing text and to size
    # recommended exposure. Does not auto-execute anything.
    risk_per_trade_pct: float = 1.0
    # Which alert types are enabled.
    enabled_alert_types: list[str] = field(
        default_factory=lambda: [
            AlertType.NEW_TRADE.value,
            AlertType.ENTRY_ZONE.value,
            AlertType.CONFIRMATION.value,
            AlertType.NEWS_RISK.value,
            AlertType.INVALIDATION.value,
        ]
    )
    # Delivery channels.
    delivery_channels: list[str] = field(
        default_factory=lambda: [DeliveryChannel.IN_APP.value]
    )
    # Telegram chat id, populated by /api/auth when available.
    telegram_chat_id: str | None = None
    # Briefing cadence. daily = top-of-day, weekly = end-of-week.
    daily_briefing_enabled: bool = True
    weekly_briefing_enabled: bool = True
    # ISO timestamps of the last daily / weekly delivery so the engine
    # does not double-fire.
    last_daily_briefing_at: str | None = None
    last_weekly_briefing_at: str | None = None
    # Preference schema version. Version 2 adds the dedicated new-trade
    # alert and lets older saved documents opt in automatically once.
    schema_version: int = 2

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "AlertPreferences":
        # Tolerant parsing — unknown keys are ignored, missing keys
        # fall back to defaults. This keeps the on-disk schema flexible
        # while a real DB migration is pending.
        kwargs = {"user_id": int(payload.get("user_id", 0))}
        for field_name in cls.__dataclass_fields__:  # type: ignore[attr-defined]
            if field_name == "user_id":
                continue
            if field_name in payload:
                kwargs[field_name] = payload[field_name]
        prefs = cls(**kwargs)
        # Existing preference documents predate the dedicated NEW_TRADE
        # category. Enable it once during the v1 -> v2 migration, while
        # respecting an explicit opt-out on all subsequent saves.
        try:
            prior_version = int(payload.get("schema_version") or 1)
        except (TypeError, ValueError):
            prior_version = 1
        if prior_version < 2 and AlertType.NEW_TRADE.value not in prefs.enabled_alert_types:
            prefs.enabled_alert_types = [AlertType.NEW_TRADE.value, *prefs.enabled_alert_types]
        prefs.schema_version = 2
        return prefs


# ---------------------------------------------------------------------------
# Alert event
# ---------------------------------------------------------------------------


@dataclass
class AlertEvent:
    user_id: int
    alert_type: str
    pair: str
    timeframe: str | None
    title: str
    body: str
    severity: str  # info | warning | critical
    payload: dict[str, Any] = field(default_factory=dict)
    event_key: str | None = None
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["event_key"] = alert_event_key(payload)
        return payload


# ---------------------------------------------------------------------------
# Pure rule evaluation
# ---------------------------------------------------------------------------


def _is_in_watchlist(prefs: AlertPreferences, pair: str) -> bool:
    if not prefs.watchlist:
        return True
    return pair.upper() in {p.upper() for p in prefs.watchlist}


def _is_in_timeframe(prefs: AlertPreferences, timeframe: str | None) -> bool:
    if not timeframe:
        return True
    if not prefs.timeframes:
        return True
    return prefs.timeframes.get(timeframe.lower(), True)


def _enabled(prefs: AlertPreferences, alert_type: AlertType) -> bool:
    return alert_type.value in prefs.enabled_alert_types


def alert_event_key(event: dict[str, Any]) -> str:
    """Return a deterministic key so polling cannot duplicate an alert."""
    existing = str(event.get("event_key") or "").strip()
    if existing:
        return existing
    stable = {
        "user_id": event.get("user_id"),
        "alert_type": event.get("alert_type"),
        "pair": event.get("pair"),
        "timeframe": event.get("timeframe"),
        "title": event.get("title"),
        "body": event.get("body"),
        "payload": event.get("payload") or {},
    }
    raw = json.dumps(stable, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def evaluate_new_trade(
    prefs: AlertPreferences,
    signal: dict[str, Any],
) -> list[AlertEvent]:
    """Build one alert for a newly persisted guarded trade call.

    This consumes the published signal payload rather than a forming analysis
    snapshot, so WAIT/BLOCKED/watchlist setups can never be labeled new trades.
    """
    if not _enabled(prefs, AlertType.NEW_TRADE):
        return []
    pair = str(signal.get("pair") or "").upper()
    timeframe = str(signal.get("timeframe") or "")
    direction = str(signal.get("direction") or "").upper()
    if not pair or direction not in {"BUY", "SELL"}:
        return []
    if not _is_in_watchlist(prefs, pair) or not _is_in_timeframe(prefs, timeframe):
        return []

    targets = [signal.get("tp1"), signal.get("tp2"), signal.get("tp3")]
    targets = [target for target in targets if target is not None]
    score = int(signal.get("score") or 0)
    setup_quality = str(signal.get("setup_quality") or "QUALIFIED")
    net_rr = signal.get("net_rr")
    rr_text = f" Net available R:R {float(net_rr):.2f}R." if net_rr is not None else ""
    fingerprint = str(signal.get("fingerprint") or "")
    published_at = signal.get("published_at")
    if hasattr(published_at, "isoformat"):
        published_at = published_at.isoformat()

    return [AlertEvent(
        user_id=prefs.user_id,
        alert_type=AlertType.NEW_TRADE.value,
        pair=pair,
        timeframe=timeframe or None,
        title=f"NEW TRADE: {pair} {direction}",
        body=(
            f"A {setup_quality} {direction} call cleared every ConfluenceX gate "
            f"at {score}/100.{rr_text}"
        ),
        severity="info",
        payload={
            "fingerprint": fingerprint,
            "direction": direction,
            "entry": signal.get("entry"),
            "stop": signal.get("stop_loss"),
            "targets": targets,
            "score": score,
            "setup_quality": setup_quality,
            "net_rr": net_rr,
            "published_at": published_at,
        },
        event_key=f"new_trade:{prefs.user_id}:{fingerprint or alert_event_key(signal)}",
        created_at=str(published_at or datetime.now(timezone.utc).isoformat()),
    )]


def evaluate_rules(
    prefs: AlertPreferences,
    analysis: dict[str, Any],
    calendar: dict[str, Any] | None = None,
    last_analysis: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> list[AlertEvent]:
    """Evaluate every enabled rule for one user against one snapshot.

    Returns the list of alert events. The caller is responsible for
    de-duplication and delivery.

    `analysis` is the :class:`CryptoAnalysis` dict from /api/analysis.
    `calendar` is the economic-calendar status for the pair.
    `last_analysis` is the previous snapshot (used to detect
    transitions like timing crossing the minimum).
    """
    if now is None:
        now = datetime.now(timezone.utc)

    pair = str(analysis.get("pair") or "UNKNOWN").upper()
    if not _is_in_watchlist(prefs, pair):
        return []

    timeframe = (
        (analysis.get("data_quality") or {}).get("primary_timeframe")
        or analysis.get("timeframe")
    )
    if not _is_in_timeframe(prefs, timeframe):
        return []

    decision = analysis.get("decision_quality") or {}
    setup_quality = decision.get("setup_quality")
    timing = decision.get("execution_readiness")
    bias = decision.get("market_bias_confidence")
    direction = analysis.get("direction", "NEUTRAL")
    plan = analysis.get("trade_plan") or {}
    invalidation = plan.get("invalidation") or (analysis.get("risk") or {}).get("atr_stop")
    timing_status = (analysis.get("trade_timing") or {}).get("status", "WAIT")

    events: list[AlertEvent] = []

    # --- confirmation ----------------------------------------------------
    # Confirmation means a transition, not every poll. The dedicated
    # NEW_TRADE event handles the first fully-guarded call; this rule fires
    # earlier, the moment setup QUALITY alone crosses the user's minimum,
    # even while timing/ADR/news gates are still blocking full READY state.
    # Bobby explicitly asked for this (2026-08-11): a setup like a 79/100
    # XAUUSD buy sitting on "AVOID: ADR exhausted" should still ping him,
    # since he trades off the zone before the engine calls it guard-ready.
    # The message body always states current timing/blocking status so this
    # is never confused with the fully-guarded NEW_TRADE call.
    previous_quality_ready = False
    if last_analysis is not None:
        previous_decision = last_analysis.get("decision_quality") or {}
        previous_quality_ready = (
            previous_decision.get("setup_quality") is not None
            and previous_decision.get("setup_quality") >= prefs.setup_quality_minimum
            and last_analysis.get("direction") in ("BUY", "SELL")
        )
    if (
        _enabled(prefs, AlertType.CONFIRMATION)
        and last_analysis is not None
        and not previous_quality_ready
        and setup_quality is not None
        and setup_quality >= prefs.setup_quality_minimum
        and direction in ("BUY", "SELL")
    ):
        timing_cleared = (
            timing is not None
            and timing >= prefs.timing_minimum
            and timing_status == "READY"
        )
        if timing_cleared:
            timing_note = (
                f"Timing {int(timing)}/100 also cleared ({prefs.timing_minimum} min). "
                f"Bias {int(bias or 0)}/100."
            )
        else:
            blockers = [
                r.get("message") for r in (plan.get("blocking_reasons") or [])
                if isinstance(r, dict) and r.get("message")
            ][:2]
            blocker_text = "; ".join(blockers) if blockers else f"status {timing_status}"
            timing_note = (
                f"Timing not fully clear yet ({blocker_text}) — quality alone crossed "
                f"your {prefs.setup_quality_minimum} minimum, so this is an early "
                f"heads-up, not a guarded call."
            )
        events.append(
            AlertEvent(
                user_id=prefs.user_id,
                alert_type=AlertType.CONFIRMATION.value,
                pair=pair,
                timeframe=timeframe,
                title=f"{pair} {direction} setup building ({int(setup_quality)}/100)",
                body=(
                    f"Setup quality {int(setup_quality)}/100 cleared your "
                    f"{prefs.setup_quality_minimum} minimum. {timing_note}"
                ),
                severity="info",
                payload={
                    "setup_quality": setup_quality,
                    "timing": timing,
                    "timing_status": timing_status,
                    "timing_cleared": timing_cleared,
                    "bias": bias,
                    "direction": direction,
                    "entry": plan.get("entry"),
                    "stop": plan.get("stop_loss") or invalidation,
                    "targets": plan.get("targets") or [],
                },
            )
        )

    # --- entry zone ------------------------------------------------------
    if (
        _enabled(prefs, AlertType.ENTRY_ZONE)
        and direction in ("BUY", "SELL")
        and plan.get("entry_zone") is not None
        and timing_status == "READY"
    ):
        events.append(
            AlertEvent(
                user_id=prefs.user_id,
                alert_type=AlertType.ENTRY_ZONE.value,
                pair=pair,
                timeframe=timeframe,
                title=f"{pair} entered planned entry zone",
                body=(
                    f"Price reached the planned {direction} entry zone around "
                    f"{plan.get('entry_zone')}. Stop {plan.get('stop_loss') or invalidation}."
                ),
                severity="info",
                payload={"entry_zone": plan.get("entry_zone"), "stop": plan.get("stop_loss")},
            )
        )

    # --- news risk -------------------------------------------------------
    if _enabled(prefs, AlertType.NEWS_RISK) and calendar is not None:
        status = (calendar.get("status") or "").upper()
        if status in ("BLOCKED", "POST_NEWS", "CAUTION"):
            events.append(
                AlertEvent(
                    user_id=prefs.user_id,
                    alert_type=AlertType.NEWS_RISK.value,
                    pair=pair,
                    timeframe=None,
                    title=f"{pair} news risk: {status.lower()}",
                    body="; ".join(calendar.get("blocking_reasons") or [f"Calendar status: {status}"]),
                    severity="warning" if status == "CAUTION" else "critical",
                    payload={"calendar_status": status, "events": calendar.get("upcoming_events") or []},
                )
            )

    # --- invalidation ----------------------------------------------------
    if (
        _enabled(prefs, AlertType.INVALIDATION)
        and invalidation is not None
        and plan.get("current_price") is not None
        and last_analysis is not None
    ):
        prev_price = (last_analysis.get("trade_plan") or {}).get("current_price")
        cur_price = plan.get("current_price")
        if prev_price is not None and cur_price is not None:
            try:
                cur_price_f = float(cur_price)
                invalidation_f = float(invalidation)
                prev_price_f = float(prev_price)
                crossed_down = (
                    direction == "BUY"
                    and cur_price_f <= invalidation_f
                    and prev_price_f > invalidation_f
                )
                crossed_up = (
                    direction == "SELL"
                    and cur_price_f >= invalidation_f
                    and prev_price_f < invalidation_f
                )
                if crossed_down or crossed_up:
                    events.append(
                        AlertEvent(
                            user_id=prefs.user_id,
                            alert_type=AlertType.INVALIDATION.value,
                            pair=pair,
                            timeframe=timeframe,
                            title=f"{pair} setup invalidated",
                            body=(
                                f"Price crossed the {direction} invalidation level at "
                                f"{invalidation}."
                            ),
                            severity="critical",
                            payload={
                                "invalidation": invalidation,
                                "current_price": cur_price_f,
                                "direction": direction,
                            },
                        )
                    )
            except (TypeError, ValueError):
                pass

    return events


# ---------------------------------------------------------------------------
# Disk-backed store
# ---------------------------------------------------------------------------


DEFAULT_STORE_DIR = Path(
    os.environ.get("CONFLUENCEX_ALERT_STORE", str(Path.home() / ".openclaw" / "state" / "alerts"))
)


class AlertPreferencesStore:
    """Durable preference CRUD with a local-file fallback.

    In production the signal repository supplies Postgres-backed preference
    methods. Local JSON remains available for development and as a graceful
    fallback when a database is not configured.
    """

    def __init__(self, root: Path | str | None = None, repository: Any | None = None):
        self.root = Path(root) if root else DEFAULT_STORE_DIR
        self.repository = repository
        self._lock = threading.Lock()
        self._memory: dict[int, dict[str, Any]] = {}
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            self._persist_ok = True
        except OSError as exc:
            logger.warning(
                "alert preferences store could not create %s: %s — using in-memory fallback",
                self.root,
                exc,
            )
            self._persist_ok = False

    # ---- helpers --------------------------------------------------------

    def _path_for(self, user_id: int) -> Path:
        return self.root / f"user-{int(user_id)}.json"

    def _atomic_write(self, path: Path, payload: str) -> None:
        fd, tmp = tempfile.mkstemp(prefix=".alert-", dir=str(self.root))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(payload)
            os.replace(tmp, path)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    # ---- CRUD -----------------------------------------------------------

    def get(self, user_id: int) -> AlertPreferences | None:
        with self._lock:
            if self.repository is not None and hasattr(self.repository, "get_alert_preferences"):
                try:
                    payload = self.repository.get_alert_preferences(int(user_id))
                    return AlertPreferences.from_dict(payload) if payload else None
                except Exception as exc:
                    logger.warning("durable alert prefs read failed for user %s: %s", user_id, exc)
            if self._persist_ok and self._path_for(user_id).exists():
                try:
                    payload = json.loads(self._path_for(user_id).read_text("utf-8"))
                    return AlertPreferences.from_dict(payload)
                except (OSError, json.JSONDecodeError) as exc:
                    logger.warning("alert prefs read failed for user %s: %s", user_id, exc)
                    return None
            if user_id in self._memory:
                return AlertPreferences.from_dict(self._memory[user_id])
        return None

    def upsert(self, prefs: AlertPreferences) -> AlertPreferences:
        with self._lock:
            payload = prefs.to_dict()
            if self.repository is not None and hasattr(self.repository, "upsert_alert_preferences"):
                try:
                    saved = self.repository.upsert_alert_preferences(int(prefs.user_id), payload)
                    return AlertPreferences.from_dict(saved or payload)
                except Exception as exc:
                    logger.warning("durable alert prefs write failed for user %s: %s", prefs.user_id, exc)
            if self._persist_ok:
                try:
                    self._atomic_write(
                        self._path_for(prefs.user_id), json.dumps(payload, indent=2)
                    )
                except OSError as exc:
                    logger.warning("alert prefs write failed for user %s: %s", prefs.user_id, exc)
                    self._memory[prefs.user_id] = payload
            else:
                self._memory[prefs.user_id] = payload
        return prefs

    def delete(self, user_id: int) -> bool:
        with self._lock:
            if self.repository is not None and hasattr(self.repository, "delete_alert_preferences"):
                try:
                    return bool(self.repository.delete_alert_preferences(int(user_id)))
                except Exception as exc:
                    logger.warning("durable alert prefs delete failed for user %s: %s", user_id, exc)
            path = self._path_for(user_id)
            if path.exists():
                try:
                    path.unlink()
                except OSError:
                    pass
                return True
            self._memory.pop(user_id, None)
            return False

    def all_user_ids(self) -> Iterable[int]:
        with self._lock:
            ids = set(self._memory.keys())
            if self.repository is not None and hasattr(self.repository, "alert_preference_user_ids"):
                try:
                    ids.update(int(uid) for uid in self.repository.alert_preference_user_ids())
                except Exception as exc:
                    logger.warning("durable alert prefs listing failed: %s", exc)
            if self._persist_ok and self.root.exists():
                for entry in self.root.glob("user-*.json"):
                    try:
                        ids.add(int(entry.stem.split("-", 1)[1]))
                    except (ValueError, IndexError):
                        continue
            return list(ids)