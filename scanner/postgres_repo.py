"""Postgres signal repository — same interface as SQLiteRepository.

Activated when `psycopg` is installed and a DATABASE_URL is configured.
Until pypi is allow-listed in the deployment env, `import psycopg` will
raise — that's fine, callers fall back to SQLiteRepository.
"""
from __future__ import annotations

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

    def published(self, limit: int = 50, status: str | None = None) -> List[dict]:
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

    def close(self) -> None:
        self.conn.close()
