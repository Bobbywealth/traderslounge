"""Postgres signal repository — same interface as SQLiteRepository.

Activated when `psycopg` is installed and a DATABASE_URL is configured.
Until pypi is allow-listed in the deployment env, `import psycopg` will
raise — that's fine, callers fall back to SQLiteRepository.
"""
from __future__ import annotations

import logging
import json
from typing import List

from .signal import Signal

try:
    import psycopg  # type: ignore
    from psycopg.rows import dict_row  # type: ignore
    _AVAILABLE = True
except ImportError:  # pragma: no cover — exercised at runtime only
    psycopg = None  # type: ignore
    dict_row = None  # type: ignore
    _AVAILABLE = False


SCHEMA = """
CREATE TABLE IF NOT EXISTS signals (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    pair TEXT NOT NULL,
    direction TEXT NOT NULL,
    tier TEXT NOT NULL,
    confidence_score INTEGER NOT NULL,
    entry DOUBLE PRECISION NOT NULL,
    stop_loss DOUBLE PRECISION NOT NULL,
    tp1 DOUBLE PRECISION NOT NULL,
    tp2 DOUBLE PRECISION NOT NULL,
    tp3 DOUBLE PRECISION NOT NULL,
    risk_level TEXT,
    session TEXT,
    adr_status TEXT,
    htf_bias TEXT,
    pattern TEXT,
    reasons JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_signals_pair_created ON signals(pair, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_tier_created ON signals(tier, created_at DESC);

CREATE TABLE IF NOT EXISTS published_signals (
    id BIGSERIAL PRIMARY KEY,
    fingerprint TEXT NOT NULL UNIQUE,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    pair TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('BUY', 'SELL')),
    timeframe TEXT NOT NULL,
    score INTEGER NOT NULL,
    setup_quality TEXT NOT NULL,
    entry DOUBLE PRECISION NOT NULL,
    stop_loss DOUBLE PRECISION NOT NULL,
    tp1 DOUBLE PRECISION NOT NULL,
    tp2 DOUBLE PRECISION,
    tp3 DOUBLE PRECISION,
    net_rr DOUBLE PRECISION,
    risk_percent DOUBLE PRECISION,
    calendar_status TEXT NOT NULL,
    scenario TEXT NOT NULL,
    rationale JSONB NOT NULL DEFAULT '[]'::jsonb,
    source_candle_time DOUBLE PRECISION,
    engine_version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE'
);
CREATE INDEX IF NOT EXISTS idx_published_signals_time ON published_signals(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_published_signals_status ON published_signals(status, published_at DESC);

CREATE TABLE IF NOT EXISTS alert_preferences (
    user_id BIGINT PRIMARY KEY,
    preferences JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_events (
    event_key TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    alert_type TEXT NOT NULL,
    pair TEXT NOT NULL,
    timeframe TEXT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    severity TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alert_events_user_time ON alert_events(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS analysis_forecasts (
    id BIGSERIAL PRIMARY KEY,
    fingerprint TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL,
    pair TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    direction TEXT NOT NULL,
    forecast_weight DOUBLE PRECISION NOT NULL,
    weight_label TEXT NOT NULL DEFAULT 'scenario_weight',
    setup_type TEXT,
    session TEXT,
    volatility_regime TEXT,
    score INTEGER,
    setup_quality_score INTEGER,
    execution_readiness_score INTEGER,
    entry DOUBLE PRECISION,
    stop_loss DOUBLE PRECISION,
    target DOUBLE PRECISION,
    engine_version TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'PENDING'
);
CREATE INDEX IF NOT EXISTS idx_forecasts_dimensions ON analysis_forecasts(pair, timeframe, setup_type, created_at DESC);

CREATE TABLE IF NOT EXISTS forecast_outcomes (
    forecast_id BIGINT PRIMARY KEY REFERENCES analysis_forecasts(id),
    resolved_at TIMESTAMPTZ NOT NULL,
    outcome BOOLEAN NOT NULL,
    r_multiple DOUBLE PRECISION,
    mae_r DOUBLE PRECISION,
    mfe_r DOUBLE PRECISION,
    holding_bars INTEGER,
    exit_reason TEXT,
    review JSONB NOT NULL DEFAULT '{}'::jsonb
);
"""


def is_available() -> bool:
    return _AVAILABLE


class PostgresRepository:
    def __init__(self, dsn: str):
        if not _AVAILABLE:
            raise RuntimeError(
                "psycopg is not installed — pip install 'psycopg[binary]' to enable Postgres"
            )
        self.dsn = dsn
        self.conn = psycopg.connect(dsn, autocommit=True, row_factory=dict_row)
        with self.conn.cursor() as cur:
            cur.execute(SCHEMA)

    def save(self, sig: Signal) -> int:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO signals (
                    pair, direction, tier, confidence_score, entry, stop_loss,
                    tp1, tp2, tp3, risk_level, session, adr_status, htf_bias,
                    pattern, reasons
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                RETURNING id
                """,
                (
                    sig.pair, sig.direction.value, sig.tier.value, sig.confidence_score,
                    sig.entry, sig.stop_loss, sig.tp1, sig.tp2, sig.tp3,
                    sig.risk_level, sig.session, sig.adr_status, sig.htf_bias,
                    sig.pattern, json.dumps(sig.reasons),
                ),
            )
            row = cur.fetchone()
            return int(row["id"])

    def recent(self, limit: int = 50) -> List[dict]:
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM signals ORDER BY created_at DESC, id DESC LIMIT %s",
                (limit,),
            )
            return list(cur.fetchall())

    def by_pair(self, pair: str, limit: int = 50) -> List[dict]:
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM signals WHERE pair = %s ORDER BY created_at DESC LIMIT %s",
                (pair, limit),
            )
            return list(cur.fetchall())

    def count(self) -> int:
        with self.conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS n FROM signals")
            return int(cur.fetchone()["n"])

    def publish_actionable(self, payload: dict) -> int:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO published_signals (
                    fingerprint, pair, direction, timeframe, score, setup_quality,
                    entry, stop_loss, tp1, tp2, tp3, net_rr, risk_percent,
                    calendar_status, scenario, rationale, source_candle_time,
                    engine_version, status
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s::jsonb, %s, %s, %s
                )
                ON CONFLICT (fingerprint) DO UPDATE SET updated_at = NOW()
                RETURNING id
                """,
                (
                    payload["fingerprint"], payload["pair"], payload["direction"],
                    payload["timeframe"], payload["score"], payload["setup_quality"],
                    payload["entry"], payload["stop_loss"], payload["tp1"],
                    payload.get("tp2"), payload.get("tp3"), payload.get("net_rr"),
                    payload.get("risk_percent"), payload["calendar_status"],
                    payload["scenario"], json.dumps(payload.get("rationale") or []),
                    payload.get("source_candle_time"), payload["engine_version"],
                    payload.get("status", "ACTIVE"),
                ),
            )
            return int(cur.fetchone()["id"])

    def publish_actionable_once(self, payload: dict) -> tuple[int, bool]:
        """Persist one active call per pair/timeframe and report if it is new."""
        self._expire_stale_published()
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT id, direction FROM published_signals "
                "WHERE pair = %s AND timeframe = %s AND status = 'ACTIVE' "
                "ORDER BY published_at DESC LIMIT 1",
                (payload["pair"], payload["timeframe"]),
            )
            current = cur.fetchone()
            if current is not None and str(current["direction"]).upper() == str(payload["direction"]).upper():
                cur.execute("UPDATE published_signals SET updated_at = NOW() WHERE id = %s", (int(current["id"]),))
                return int(current["id"]), False
            if current is not None:
                cur.execute(
                    "UPDATE published_signals SET status = 'CANCELLED', updated_at = NOW() WHERE id = %s",
                    (int(current["id"]),),
                )
        return self.publish_actionable(payload), True

    # An entry area goes stale long before this, but a call that is never
    # retired reads as live forever. Age ACTIVE calls out on read.
    PUBLISHED_TTL_HOURS = 24

    def _expire_stale_published(self) -> None:
        try:
            with self.conn.cursor() as cur:
                cur.execute(
                    "UPDATE published_signals SET status = 'EXPIRED', updated_at = NOW() "
                    "WHERE status = 'ACTIVE' AND published_at < NOW() - make_interval(hours => %s)",
                    (self.PUBLISHED_TTL_HOURS,),
                )
        except Exception:  # pragma: no cover — never block the feed on a sweep
            logging.exception("failed to expire stale published signals")

    def published(self, limit: int = 50, status: str | None = None) -> List[dict]:
        self._expire_stale_published()
        with self.conn.cursor() as cur:
            if status:
                cur.execute(
                    "SELECT * FROM published_signals WHERE status = %s ORDER BY published_at DESC LIMIT %s",
                    (status, limit),
                )
            else:
                cur.execute(
                    "SELECT * FROM published_signals ORDER BY published_at DESC LIMIT %s",
                    (limit,),
                )
            return list(cur.fetchall())

    def get_alert_preferences(self, user_id: int) -> dict | None:
        with self.conn.cursor() as cur:
            cur.execute("SELECT preferences FROM alert_preferences WHERE user_id = %s", (int(user_id),))
            row = cur.fetchone()
            if not row:
                return None
            value = row["preferences"]
            return dict(value) if isinstance(value, dict) else json.loads(value)

    def upsert_alert_preferences(self, user_id: int, preferences: dict) -> dict:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO alert_preferences (user_id, preferences, updated_at)
                VALUES (%s, %s::jsonb, NOW())
                ON CONFLICT (user_id) DO UPDATE SET
                    preferences = EXCLUDED.preferences, updated_at = NOW()
                """,
                (int(user_id), json.dumps(preferences, default=str)),
            )
        return dict(preferences)

    def delete_alert_preferences(self, user_id: int) -> bool:
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM alert_preferences WHERE user_id = %s", (int(user_id),))
            return bool(cur.rowcount)

    def alert_preference_user_ids(self) -> List[int]:
        with self.conn.cursor() as cur:
            cur.execute("SELECT user_id FROM alert_preferences ORDER BY user_id")
            return [int(row["user_id"]) for row in cur.fetchall()]

    def save_events(self, events: List[dict]) -> List[dict]:
        from .alert_preferences import alert_event_key
        inserted: List[dict] = []
        with self.conn.cursor() as cur:
            for event in events:
                key = alert_event_key(event)
                created_at = event.get("created_at")
                cur.execute(
                    """
                    INSERT INTO alert_events (
                        event_key, user_id, alert_type, pair, timeframe, title,
                        body, severity, payload, created_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (event_key) DO NOTHING
                    RETURNING event_key, created_at
                    """,
                    (
                        key, int(event.get("user_id") or 0), str(event.get("alert_type") or ""),
                        str(event.get("pair") or ""), event.get("timeframe"),
                        str(event.get("title") or "Alert"), str(event.get("body") or ""),
                        str(event.get("severity") or "info"),
                        json.dumps(event.get("payload") or {}, default=str), created_at,
                    ),
                )
                row = cur.fetchone()
                if row:
                    inserted.append({**event, "event_key": key, "created_at": row["created_at"]})
        return inserted

    def recent_for_user(self, user_id: int, limit: int = 50) -> List[dict]:
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM alert_events WHERE user_id = %s ORDER BY created_at DESC LIMIT %s",
                (int(user_id), int(limit)),
            )
            return list(cur.fetchall())

    def save_forecast(self, payload: dict) -> int:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO analysis_forecasts (
                    fingerprint, created_at, pair, timeframe, direction,
                    forecast_weight, weight_label, setup_type, session,
                    volatility_regime, score, setup_quality_score,
                    execution_readiness_score, entry, stop_loss, target,
                    engine_version, metadata, status
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s::jsonb, %s
                )
                ON CONFLICT (fingerprint) DO UPDATE SET metadata = EXCLUDED.metadata
                RETURNING id
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
            return int(cur.fetchone()["id"])

    def save_forecast_outcome(self, payload: dict) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO forecast_outcomes (
                    forecast_id, resolved_at, outcome, r_multiple, mae_r, mfe_r,
                    holding_bars, exit_reason, review
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                ON CONFLICT (forecast_id) DO UPDATE SET
                    resolved_at = EXCLUDED.resolved_at, outcome = EXCLUDED.outcome,
                    r_multiple = EXCLUDED.r_multiple, mae_r = EXCLUDED.mae_r,
                    mfe_r = EXCLUDED.mfe_r, holding_bars = EXCLUDED.holding_bars,
                    exit_reason = EXCLUDED.exit_reason, review = EXCLUDED.review
                """,
                (
                    payload["forecast_id"], payload["resolved_at"], bool(payload["outcome"]),
                    payload.get("r_multiple"), payload.get("mae_r"), payload.get("mfe_r"),
                    payload.get("holding_bars"), payload.get("exit_reason"),
                    json.dumps(payload.get("review") or {}),
                ),
            )
            cur.execute("UPDATE analysis_forecasts SET status = 'RESOLVED' WHERE id = %s", (payload["forecast_id"],))

    def forecast_rows(self, limit: int = 5000) -> List[dict]:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                SELECT f.*, o.resolved_at, o.outcome, o.r_multiple, o.mae_r,
                       o.mfe_r, o.holding_bars, o.exit_reason, o.review
                FROM analysis_forecasts f
                LEFT JOIN forecast_outcomes o ON o.forecast_id = f.id
                ORDER BY f.created_at DESC LIMIT %s
                """,
                (limit,),
            )
            return list(cur.fetchall())

    def close(self) -> None:
        self.conn.close()
