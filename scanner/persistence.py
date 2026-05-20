"""Signal persistence layer.

Defines a SignalRepository interface and ships a SQLite implementation
that works without any third-party deps. A Postgres implementation will
be added in Step 4 once psycopg is available in the deployment env; it
will satisfy the same interface so callers don't change.
"""
from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict
from pathlib import Path
from typing import List, Optional, Protocol

from .data_types import Direction, Tier
from .signal import Signal


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
