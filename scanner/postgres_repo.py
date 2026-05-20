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

    def close(self) -> None:
        self.conn.close()
