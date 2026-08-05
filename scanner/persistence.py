"""Signal persistence layer.

Defines a SignalRepository interface and ships a SQLite implementation
that works without any third-party deps. A Postgres implementation will
be added in Step 4 once psycopg is available in the deployment env; it
will satisfy the same interface so callers don't change.
"""
from __future__ import annotations

import datetime as _dt
import json
import logging
import sqlite3
from dataclasses import asdict
from pathlib import Path
from typing import List, Optional, Protocol

from .data_types import Direction, Tier
from .signal import Signal

log = logging.getLogger(__name__)


class SignalRepository(Protocol):
    def save(self, sig: Signal) -> int:
        """Persist a signal, return the row id."""

    def recent(self, limit: int = 50) -> List[dict]:
        """Return the N most recent signals as dicts (newest first)."""

    def close(self) -> None:
        ...


SCHEMA = """
CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at REAL NOT NULL DEFAULT (strftime('%s','now')),
    pair TEXT NOT NULL,
    direction TEXT NOT NULL,
    tier TEXT NOT NULL,
    confidence_score INTEGER NOT NULL,
    entry REAL NOT NULL,
    stop_loss REAL NOT NULL,
    tp1 REAL NOT NULL,
    tp2 REAL NOT NULL,
    tp3 REAL NOT NULL,
    risk_level TEXT,
    session TEXT,
    adr_status TEXT,
    htf_bias TEXT,
    pattern TEXT,
    reasons_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_signals_pair_created ON signals(pair, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_tier_created ON signals(tier, created_at DESC);

CREATE TABLE IF NOT EXISTS published_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT NOT NULL UNIQUE,
    published_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    pair TEXT NOT NULL,
    direction TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    score INTEGER NOT NULL,
    setup_quality TEXT NOT NULL,
    entry REAL NOT NULL,
    stop_loss REAL NOT NULL,
    tp1 REAL NOT NULL,
    tp2 REAL,
    tp3 REAL,
    net_rr REAL,
    risk_percent REAL,
    calendar_status TEXT NOT NULL,
    scenario TEXT NOT NULL,
    rationale_json TEXT NOT NULL DEFAULT '[]',
    source_candle_time REAL,
    engine_version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE'
);
CREATE INDEX IF NOT EXISTS idx_published_signals_time ON published_signals(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_published_signals_status ON published_signals(status, published_at DESC);

CREATE TABLE IF NOT EXISTS alert_preferences (
    user_id INTEGER PRIMARY KEY,
    preferences_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_events (
    event_key TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    alert_type TEXT NOT NULL,
    pair TEXT NOT NULL,
    timeframe TEXT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    severity TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alert_events_user_time ON alert_events(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lifecycle_events (
    id TEXT PRIMARY KEY,
    setup_id TEXT NOT NULL,
    from_state TEXT,
    to_state TEXT NOT NULL,
    reason_code TEXT,
    human_readable TEXT,
    timestamp TEXT NOT NULL,
    snapshot_id TEXT,
    model_version TEXT
);
CREATE INDEX IF NOT EXISTS idx_lifecycle_setup ON lifecycle_events(setup_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS analysis_forecasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    pair TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    direction TEXT NOT NULL,
    forecast_weight REAL NOT NULL,
    weight_label TEXT NOT NULL DEFAULT 'scenario_weight',
    setup_type TEXT,
    session TEXT,
    volatility_regime TEXT,
    score INTEGER,
    setup_quality_score INTEGER,
    execution_readiness_score INTEGER,
    entry REAL,
    stop_loss REAL,
    target REAL,
    engine_version TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'PENDING'
);
CREATE INDEX IF NOT EXISTS idx_forecasts_dimensions ON analysis_forecasts(pair, timeframe, setup_type, created_at DESC);

CREATE TABLE IF NOT EXISTS forecast_outcomes (
    forecast_id INTEGER PRIMARY KEY,
    resolved_at TEXT NOT NULL,
    outcome INTEGER NOT NULL,
    r_multiple REAL,
    mae_r REAL,
    mfe_r REAL,
    holding_bars INTEGER,
    exit_reason TEXT,
    review_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY(forecast_id) REFERENCES analysis_forecasts(id)
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    plan TEXT DEFAULT 'free',
    created_at TEXT NOT NULL,
    last_login TEXT
);
"""


class SQLiteRepository:
    def __init__(self, db_path: str | Path = "scanner.db"):
        self.path = str(db_path)
        # check_same_thread=False so the API HTTP server can read from a
        # different thread than the worker that writes. SQLite serializes
        # access internally; we don't hold cursors across statements.
        self.conn = sqlite3.connect(self.path, isolation_level=None,
                                    check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)

    def save(self, sig: Signal) -> int:
        cur = self.conn.execute(
            """
            INSERT INTO signals (
                pair, direction, tier, confidence_score, entry, stop_loss,
                tp1, tp2, tp3, risk_level, session, adr_status, htf_bias,
                pattern, reasons_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                sig.pair,
                sig.direction.value,
                sig.tier.value,
                sig.confidence_score,
                sig.entry,
                sig.stop_loss,
                sig.tp1,
                sig.tp2,
                sig.tp3,
                sig.risk_level,
                sig.session,
                sig.adr_status,
                sig.htf_bias,
                sig.pattern,
                json.dumps(sig.reasons),
            ),
        )
        return int(cur.lastrowid)

    def recent(self, limit: int = 50) -> List[dict]:
        rows = self.conn.execute(
            "SELECT * FROM signals ORDER BY created_at DESC, id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        out: List[dict] = []
        for row in rows:
            d = dict(row)
            d["reasons"] = json.loads(d.pop("reasons_json") or "[]")
            out.append(d)
        return out

    def by_pair(self, pair: str, limit: int = 50) -> List[dict]:
        rows = self.conn.execute(
            "SELECT * FROM signals WHERE pair = ? ORDER BY created_at DESC LIMIT ?",
            (pair, limit),
        ).fetchall()
        return [
            {**dict(r), "reasons": json.loads(dict(r).pop("reasons_json") or "[]")}
            for r in rows
        ]

    def count(self) -> int:
        return int(self.conn.execute("SELECT COUNT(*) FROM signals").fetchone()[0])

    def publish_actionable(self, payload: dict) -> int:
        published_at = payload["published_at"].isoformat() if hasattr(payload["published_at"], "isoformat") else str(payload["published_at"])
        self.conn.execute(
            """
            INSERT INTO published_signals (
                fingerprint, published_at, updated_at, pair, direction, timeframe,
                score, setup_quality, entry, stop_loss, tp1, tp2, tp3, net_rr,
                risk_percent, calendar_status, scenario, rationale_json,
                source_candle_time, engine_version, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(fingerprint) DO UPDATE SET updated_at = excluded.updated_at
            """,
            (
                payload["fingerprint"], published_at, published_at, payload["pair"],
                payload["direction"], payload["timeframe"], payload["score"],
                payload["setup_quality"], payload["entry"], payload["stop_loss"],
                payload["tp1"], payload.get("tp2"), payload.get("tp3"),
                payload.get("net_rr"), payload.get("risk_percent"),
                payload["calendar_status"], payload["scenario"],
                json.dumps(payload.get("rationale") or []), payload.get("source_candle_time"),
                payload["engine_version"], payload.get("status", "ACTIVE"),
            ),
        )
        row = self.conn.execute(
            "SELECT id FROM published_signals WHERE fingerprint = ?", (payload["fingerprint"],)
        ).fetchone()
        return int(row["id"])

    def publish_actionable_once(self, payload: dict) -> tuple[int, bool]:
        """Persist one active call per pair/timeframe and report if it is new."""
        self._expire_stale_published()
        current = self.conn.execute(
            "SELECT id, direction FROM published_signals "
            "WHERE pair = ? AND timeframe = ? AND status = 'ACTIVE' "
            "ORDER BY published_at DESC LIMIT 1",
            (payload["pair"], payload["timeframe"]),
        ).fetchone()
        if current is not None and str(current["direction"]).upper() == str(payload["direction"]).upper():
            self.conn.execute(
                "UPDATE published_signals SET updated_at = ? WHERE id = ?",
                (_dt.datetime.now(_dt.timezone.utc).isoformat(), int(current["id"])),
            )
            return int(current["id"]), False
        if current is not None:
            self.conn.execute(
                "UPDATE published_signals SET status = 'CANCELLED', updated_at = ? WHERE id = ?",
                (_dt.datetime.now(_dt.timezone.utc).isoformat(), int(current["id"])),
            )
        return self.publish_actionable(payload), True

    # An entry area goes stale long before this, but a call that is never
    # retired reads as live forever. Age ACTIVE calls out on read.
    PUBLISHED_TTL_HOURS = 24

    def _expire_stale_published(self) -> None:
        cutoff = (
            _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(hours=self.PUBLISHED_TTL_HOURS)
        ).isoformat()
        try:
            self.conn.execute(
                "UPDATE published_signals SET status = 'EXPIRED', updated_at = ? "
                "WHERE status = 'ACTIVE' AND published_at < ?",
                (_dt.datetime.now(_dt.timezone.utc).isoformat(), cutoff),
            )
        except Exception:  # pragma: no cover — never block the feed on a sweep
            log.exception("failed to expire stale published signals")

    def published(self, limit: int = 50, status: str | None = None) -> List[dict]:
        self._expire_stale_published()
        if status:
            rows = self.conn.execute(
                "SELECT * FROM published_signals WHERE status = ? ORDER BY published_at DESC LIMIT ?",
                (status, limit),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT * FROM published_signals ORDER BY published_at DESC LIMIT ?", (limit,)
            ).fetchall()
        output = []
        for row in rows:
            item = dict(row)
            item["rationale"] = json.loads(item.pop("rationale_json") or "[]")
            output.append(item)
        return output

    def get_alert_preferences(self, user_id: int) -> dict | None:
        row = self.conn.execute(
            "SELECT preferences_json FROM alert_preferences WHERE user_id = ?",
            (int(user_id),),
        ).fetchone()
        return json.loads(row["preferences_json"]) if row else None

    def upsert_alert_preferences(self, user_id: int, preferences: dict) -> dict:
        now = _dt.datetime.now(_dt.timezone.utc).isoformat()
        self.conn.execute(
            """
            INSERT INTO alert_preferences (user_id, preferences_json, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                preferences_json = excluded.preferences_json,
                updated_at = excluded.updated_at
            """,
            (int(user_id), json.dumps(preferences), now),
        )
        return dict(preferences)

    def delete_alert_preferences(self, user_id: int) -> bool:
        cur = self.conn.execute("DELETE FROM alert_preferences WHERE user_id = ?", (int(user_id),))
        return bool(cur.rowcount)

    def alert_preference_user_ids(self) -> List[int]:
        rows = self.conn.execute("SELECT user_id FROM alert_preferences ORDER BY user_id").fetchall()
        return [int(row["user_id"]) for row in rows]

    def save_events(self, events: List[dict]) -> List[dict]:
        from .alert_preferences import alert_event_key
        inserted: List[dict] = []
        for event in events:
            key = alert_event_key(event)
            created_at = str(event.get("created_at") or _dt.datetime.now(_dt.timezone.utc).isoformat())
            cur = self.conn.execute(
                """
                INSERT OR IGNORE INTO alert_events (
                    event_key, user_id, alert_type, pair, timeframe, title, body,
                    severity, payload_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    key, int(event.get("user_id") or 0), str(event.get("alert_type") or ""),
                    str(event.get("pair") or ""), event.get("timeframe"),
                    str(event.get("title") or "Alert"), str(event.get("body") or ""),
                    str(event.get("severity") or "info"),
                    json.dumps(event.get("payload") or {}, default=str), created_at,
                ),
            )
            if cur.rowcount:
                inserted.append({**event, "event_key": key, "created_at": created_at})
        return inserted

    def recent_for_user(self, user_id: int, limit: int = 50) -> List[dict]:
        rows = self.conn.execute(
            "SELECT * FROM alert_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (int(user_id), int(limit)),
        ).fetchall()
        output: List[dict] = []
        for row in rows:
            item = dict(row)
            item["payload"] = json.loads(item.pop("payload_json") or "{}")
            output.append(item)
        return output

    def save_lifecycle_event(self, event: dict) -> None:
        self.conn.execute(
            """
            INSERT INTO lifecycle_events (
                id, setup_id, from_state, to_state, reason_code,
                human_readable, timestamp, snapshot_id, model_version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event.get("id"),
                event.get("setup_id"),
                event.get("from_state"),
                event.get("to_state"),
                event.get("reason_code"),
                event.get("human_readable"),
                event.get("timestamp"),
                event.get("snapshot_id"),
                event.get("model_version"),
            ),
        )

    def lifecycle_events_for(self, setup_id: str, limit: int = 50) -> List[dict]:
        rows = self.conn.execute(
            "SELECT * FROM lifecycle_events WHERE setup_id = ? ORDER BY timestamp DESC LIMIT ?",
            (setup_id, limit),
        ).fetchall()
        return [dict(row) for row in rows]

    def save_forecast(self, payload: dict) -> int:
        self.conn.execute(
            """
            INSERT INTO analysis_forecasts (
                fingerprint, created_at, pair, timeframe, direction,
                forecast_weight, weight_label, setup_type, session,
                volatility_regime, score, setup_quality_score,
                execution_readiness_score, entry, stop_loss, target,
                engine_version, metadata_json, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(fingerprint) DO UPDATE SET metadata_json = excluded.metadata_json
            """,
            (
                payload["fingerprint"], payload["created_at"], payload["pair"],
                payload["timeframe"], payload["direction"], payload["forecast_weight"],
                payload.get("weight_label", "scenario_weight"), payload.get("setup_type"),
                payload.get("session"), payload.get("volatility_regime"), payload.get("score"),
                payload.get("setup_quality_score"), payload.get("execution_readiness_score"),
                payload.get("entry"), payload.get("stop_loss"), payload.get("target"),
                payload.get("engine_version"), json.dumps(payload.get("metadata") or {}),
                payload.get("status", "PENDING"),
            ),
        )
        row = self.conn.execute(
            "SELECT id FROM analysis_forecasts WHERE fingerprint = ?", (payload["fingerprint"],)
        ).fetchone()
        return int(row["id"])

    def save_forecast_outcome(self, payload: dict) -> None:
        self.conn.execute(
            """
            INSERT INTO forecast_outcomes (
                forecast_id, resolved_at, outcome, r_multiple, mae_r, mfe_r,
                holding_bars, exit_reason, review_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(forecast_id) DO UPDATE SET
                resolved_at = excluded.resolved_at, outcome = excluded.outcome,
                r_multiple = excluded.r_multiple, mae_r = excluded.mae_r,
                mfe_r = excluded.mfe_r, holding_bars = excluded.holding_bars,
                exit_reason = excluded.exit_reason, review_json = excluded.review_json
            """,
            (
                payload["forecast_id"], payload["resolved_at"], int(bool(payload["outcome"])),
                payload.get("r_multiple"), payload.get("mae_r"), payload.get("mfe_r"),
                payload.get("holding_bars"), payload.get("exit_reason"),
                json.dumps(payload.get("review") or {}),
            ),
        )
        self.conn.execute("UPDATE analysis_forecasts SET status = 'RESOLVED' WHERE id = ?", (payload["forecast_id"],))

    def forecast_rows(self, limit: int = 5000) -> List[dict]:
        rows = self.conn.execute(
            """
            SELECT f.*, o.resolved_at, o.outcome, o.r_multiple, o.mae_r,
                   o.mfe_r, o.holding_bars, o.exit_reason, o.review_json
            FROM analysis_forecasts f
            LEFT JOIN forecast_outcomes o ON o.forecast_id = f.id
            ORDER BY f.created_at DESC LIMIT ?
            """,
            (limit,),
        ).fetchall()
        output = []
        for row in rows:
            item = dict(row)
            item["metadata"] = json.loads(item.pop("metadata_json") or "{}")
            item["review"] = json.loads(item.pop("review_json") or "{}")
            output.append(item)
        return output

    def close(self) -> None:
        self.conn.close()


class SQLiteUserRepository:
    def __init__(self, db_path: str | Path = "scanner.db"):
        self.path = str(db_path)
        self.conn = sqlite3.connect(self.path, isolation_level=None,
                                   check_same_thread=False)
        self.conn.row_factory = sqlite3.Row

    def get_by_email(self, email: str) -> Optional[dict]:
        row = self.conn.execute(
            "SELECT * FROM users WHERE email = ?", (email,),
        ).fetchone()
        return dict(row) if row else None

    def get_by_id(self, user_id: int) -> Optional[dict]:
        row = self.conn.execute(
            "SELECT * FROM users WHERE id = ?", (user_id,),
        ).fetchone()
        return dict(row) if row else None

    def create(self, email: str, password_hash: str, name: str) -> dict:
        from datetime import datetime, timezone
        created_at = datetime.now(timezone.utc).isoformat()
        cur = self.conn.execute(
            "INSERT INTO users (email, password_hash, name, created_at) VALUES (?, ?, ?, ?)",
            (email, password_hash, name, created_at),
        )
        user_id = int(cur.lastrowid)
        return {
            "id": user_id,
            "email": email,
            "name": name,
            "role": "user",
            "plan": "free",
            "created_at": created_at,
        }

    def update_last_login(self, user_id: int) -> None:
        from datetime import datetime, timezone
        last_login = datetime.now(timezone.utc).isoformat()
        self.conn.execute(
            "UPDATE users SET last_login = ? WHERE id = ?",
            (last_login, user_id),
        )

    def set_role(self, user_id: int, role: str) -> bool:
        """Update a user's role. Returns True if the user existed.

        Used to bootstrap admin accounts from the ADMIN_EMAILS env var
        during auth_register / auth_login. Roles are intentionally
        low-cardinality (``user`` / ``admin`` / ``demo``) so this can be
        invoked safely without per-call authorisation when the caller
        has already proven control of the user account via password.
        """
        cur = self.conn.execute(
            "UPDATE users SET role = ? WHERE id = ?",
            (role, int(user_id)),
        )
        return cur.rowcount > 0

    def close(self) -> None:
        self.conn.close()


class NullRepository:
    """Drop-in repo for unit tests when persistence isn't being exercised."""

    def __init__(self):
        self.saved: List[Signal] = []

    def save(self, sig: Signal) -> int:
        self.saved.append(sig)
        return len(self.saved)

    def recent(self, limit: int = 50) -> List[dict]:
        return [asdict(s) for s in self.saved[-limit:][::-1]]

    def close(self) -> None:
        pass
