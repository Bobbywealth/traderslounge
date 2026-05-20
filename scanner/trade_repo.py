"""Position + closed-trade repositories.

Same dual-backend pattern as signal persistence: stdlib SQLite is the
default; PostgresPositionRepository swaps in transparently when
psycopg + DATABASE_URL are present (added in a follow-up alongside
the existing PostgresRepository).
"""
from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import List, Optional, Protocol

from .broker import Position
from .data_types import Direction


# ---- protocols ---------------------------------------------------------

class PositionRepository(Protocol):
    def upsert(self, pos: Position) -> None: ...
    def close(self, position_id: str, closed_at: float) -> None: ...
    def open_positions(self) -> List[dict]: ...
    def get(self, position_id: str) -> Optional[dict]: ...


class ClosedTradeRepository(Protocol):
    def save(self, trade: dict) -> int: ...
    def recent(self, limit: int = 100, pair: Optional[str] = None) -> List[dict]: ...
    def stats(self) -> dict: ...


# ---- SQLite schemas ----------------------------------------------------

POSITIONS_SCHEMA = """
CREATE TABLE IF NOT EXISTS positions (
    id TEXT PRIMARY KEY,
    opened_at REAL NOT NULL,
    closed_at REAL,
    pair TEXT NOT NULL,
    direction TEXT NOT NULL,
    lot_size REAL NOT NULL,
    entry REAL NOT NULL,
    stop_loss REAL NOT NULL,
    tp1 REAL NOT NULL,
    tp2 REAL NOT NULL,
    tp3 REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    half_closed INTEGER NOT NULL DEFAULT 0,
    closed_pnl_usd REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
"""

CLOSED_TRADES_SCHEMA = """
CREATE TABLE IF NOT EXISTS closed_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    position_id TEXT,
    pair TEXT NOT NULL,
    direction TEXT NOT NULL,
    opened_at REAL NOT NULL,
    closed_at REAL NOT NULL,
    entry REAL NOT NULL,
    exit_price REAL NOT NULL,
    stop_loss REAL NOT NULL,
    tp1 REAL NOT NULL,
    tp2 REAL NOT NULL,
    lot_size REAL NOT NULL,
    sl_pips REAL NOT NULL,
    pnl_usd REAL NOT NULL,
    r_multiple REAL NOT NULL,
    outcome TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_closed_trades_closed_at ON closed_trades(closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_closed_trades_pair ON closed_trades(pair, closed_at DESC);
"""


# ---- SQLite implementations -------------------------------------------

class SQLitePositionRepository:
    def __init__(self, db_path: str | Path = "scanner.db"):
        self.path = str(db_path)
        self.conn = sqlite3.connect(self.path, isolation_level=None,
                                    check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(POSITIONS_SCHEMA)

    def upsert(self, pos: Position) -> None:
        self.conn.execute(
            """
            INSERT INTO positions (
                id, opened_at, pair, direction, lot_size, entry, stop_loss,
                tp1, tp2, tp3, status, closed_pnl_usd
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                stop_loss = excluded.stop_loss,
                lot_size = excluded.lot_size,
                status = excluded.status,
                closed_pnl_usd = excluded.closed_pnl_usd
            """,
            (
                pos.id, pos.opened_at, pos.pair, pos.direction.value,
                pos.lot_size, pos.entry, pos.stop_loss,
                pos.tp1, pos.tp2, pos.tp3, pos.status, pos.closed_pnl_usd,
            ),
        )

    def close(self, position_id: str, closed_at: float) -> None:
        self.conn.execute(
            "UPDATE positions SET status='closed', closed_at=? WHERE id=?",
            (closed_at, position_id),
        )

    def open_positions(self) -> List[dict]:
        rows = self.conn.execute(
            "SELECT * FROM positions WHERE status != 'closed' "
            "ORDER BY opened_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    def get(self, position_id: str) -> Optional[dict]:
        row = self.conn.execute(
            "SELECT * FROM positions WHERE id=?", (position_id,)
        ).fetchone()
        return dict(row) if row else None

    def close_db(self) -> None:
        self.conn.close()


class SQLiteClosedTradeRepository:
    def __init__(self, db_path: str | Path = "scanner.db"):
        self.path = str(db_path)
        self.conn = sqlite3.connect(self.path, isolation_level=None,
                                    check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(CLOSED_TRADES_SCHEMA)

    def save(self, trade: dict) -> int:
        cur = self.conn.execute(
            """
            INSERT INTO closed_trades (
                position_id, pair, direction, opened_at, closed_at,
                entry, exit_price, stop_loss, tp1, tp2, lot_size,
                sl_pips, pnl_usd, r_multiple, outcome
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                trade.get("position_id"),
                trade["pair"], trade["direction"],
                trade["opened_at"], trade["closed_at"],
                trade["entry"], trade["exit_price"],
                trade["stop_loss"], trade["tp1"], trade["tp2"],
                trade["lot_size"], trade["sl_pips"],
                trade["pnl_usd"], trade["r_multiple"], trade["outcome"],
            ),
        )
        return int(cur.lastrowid)

    def recent(self, limit: int = 100, pair: Optional[str] = None) -> List[dict]:
        if pair:
            rows = self.conn.execute(
                "SELECT * FROM closed_trades WHERE pair=? "
                "ORDER BY closed_at DESC LIMIT ?",
                (pair, limit),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT * FROM closed_trades ORDER BY closed_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(r) for r in rows]

    def stats(self) -> dict:
        rows = self.conn.execute(
            "SELECT pnl_usd, r_multiple FROM closed_trades"
        ).fetchall()
        if not rows:
            return {
                "trades": 0, "wins": 0, "losses": 0,
                "win_rate": 0.0, "gross_profit": 0.0, "gross_loss": 0.0,
                "profit_factor": 0.0, "avg_r": 0.0, "total_pnl": 0.0,
            }
        wins = sum(1 for r in rows if r["pnl_usd"] > 0)
        losses = sum(1 for r in rows if r["pnl_usd"] < 0)
        gross_profit = sum(r["pnl_usd"] for r in rows if r["pnl_usd"] > 0)
        gross_loss = abs(sum(r["pnl_usd"] for r in rows if r["pnl_usd"] < 0))
        total_pnl = sum(r["pnl_usd"] for r in rows)
        avg_r = sum(r["r_multiple"] for r in rows) / len(rows)
        decided = wins + losses
        return {
            "trades": len(rows),
            "wins": wins, "losses": losses,
            "win_rate": (wins / decided) if decided else 0.0,
            "gross_profit": gross_profit,
            "gross_loss": gross_loss,
            "profit_factor": (gross_profit / gross_loss) if gross_loss else 0.0,
            "avg_r": avg_r,
            "total_pnl": total_pnl,
        }

    def close_db(self) -> None:
        self.conn.close()


# ---- null impls for unit tests ----------------------------------------

class NullPositionRepository:
    def __init__(self):
        self.upserts: List[Position] = []
        self.closes: List[tuple[str, float]] = []

    def upsert(self, pos: Position) -> None:
        self.upserts.append(pos)

    def close(self, position_id: str, closed_at: float) -> None:
        self.closes.append((position_id, closed_at))

    def open_positions(self) -> List[dict]:
        return []

    def get(self, position_id: str) -> Optional[dict]:
        return None


class NullClosedTradeRepository:
    def __init__(self):
        self.saved: List[dict] = []

    def save(self, trade: dict) -> int:
        self.saved.append(trade)
        return len(self.saved)

    def recent(self, limit: int = 100, pair: Optional[str] = None) -> List[dict]:
        return list(self.saved[-limit:][::-1])

    def stats(self) -> dict:
        return {"trades": len(self.saved)}
