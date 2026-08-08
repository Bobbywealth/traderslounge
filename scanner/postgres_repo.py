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

-- User accounts (auth) — mirrors SQLiteUserRepository. Email is the
-- unique login handle; password_hash is bcrypt.
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'user',
    plan TEXT NOT NULL DEFAULT 'free',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login TIMESTAMPTZ
);

-- Open positions — written by TradeManager on every state change.
-- half_closed distinguishes a position that's still partially open after TP1
-- from one that was closed entirely without taking TP1.
CREATE TABLE IF NOT EXISTS positions (
    id TEXT PRIMARY KEY,
    opened_at DOUBLE PRECISION NOT NULL,
    closed_at DOUBLE PRECISION,
    pair TEXT NOT NULL,
    direction TEXT NOT NULL,
    lot_size DOUBLE PRECISION NOT NULL,
    entry DOUBLE PRECISION NOT NULL,
    stop_loss DOUBLE PRECISION NOT NULL,
    tp1 DOUBLE PRECISION NOT NULL,
    tp2 DOUBLE PRECISION NOT NULL,
    tp3 DOUBLE PRECISION NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    half_closed BOOLEAN NOT NULL DEFAULT FALSE,
    closed_pnl_usd DOUBLE PRECISION NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);

-- Closed-trade journal — append-only history used by /performance and
-- /journal. Mirrors SQLiteClosedTradeRepository.
CREATE TABLE IF NOT EXISTS closed_trades (
    id BIGSERIAL PRIMARY KEY,
    position_id TEXT,
    pair TEXT NOT NULL,
    direction TEXT NOT NULL,
    opened_at DOUBLE PRECISION NOT NULL,
    closed_at DOUBLE PRECISION NOT NULL,
    entry DOUBLE PRECISION NOT NULL,
    exit_price DOUBLE PRECISION NOT NULL,
    stop_loss DOUBLE PRECISION NOT NULL,
    tp1 DOUBLE PRECISION NOT NULL,
    tp2 DOUBLE PRECISION NOT NULL,
    lot_size DOUBLE PRECISION NOT NULL,
    sl_pips DOUBLE PRECISION NOT NULL,
    pnl_usd DOUBLE PRECISION NOT NULL,
    r_multiple DOUBLE PRECISION NOT NULL,
    outcome TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_closed_trades_closed_at ON closed_trades(closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_closed_trades_pair ON closed_trades(pair, closed_at DESC);

-- Trade manager in-flight state — tracks per-position TP1 + original
-- sizing so partial-close P&L math survives a Render restart. Replaces
-- the in-memory _tp1_taken / _opened_state dicts in TradeManager.
CREATE TABLE IF NOT EXISTS trade_manager_state (
    position_id TEXT PRIMARY KEY,
    tp1_taken BOOLEAN NOT NULL DEFAULT FALSE,
    original_lots DOUBLE PRECISION,
    risk_usd DOUBLE PRECISION,
    sl_pips DOUBLE PRECISION,
    original_sl DOUBLE PRECISION,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Last analysis snapshot per pair — feeds the invalidation detector so
-- it doesn't fire on every cycle after a restart. Replaces the in-memory
-- last_analysis_by_pair dict.
CREATE TABLE IF NOT EXISTS last_analysis_snapshots (
    pair TEXT PRIMARY KEY,
    snapshot JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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


# --- Postgres user repository ----------------------------------------------
# Same interface as SQLiteUserRepository in scanner/persistence.py.
# Activated when DATABASE_URL is configured.

class PostgresUserRepository:
    def __init__(self, dsn: str):
        if not _AVAILABLE:
            raise RuntimeError("psycopg is not installed")
        self.dsn = dsn
        self.conn = psycopg.connect(dsn, autocommit=True, row_factory=dict_row)

    def get_by_email(self, email: str) -> Optional[dict]:
        with self.conn.cursor() as cur:
            cur.execute("SELECT * FROM users WHERE email = %s", (email,))
            row = cur.fetchone()
            return _normalize_user_row(row) if row else None

    def get_by_id(self, user_id: int) -> Optional[dict]:
        with self.conn.cursor() as cur:
            cur.execute("SELECT * FROM users WHERE id = %s", (int(user_id),))
            row = cur.fetchone()
            return _normalize_user_row(row) if row else None

    def create(self, email: str, password_hash: str, name: str) -> dict:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO users (email, password_hash, name)
                VALUES (%s, %s, %s)
                RETURNING id, email, name, role, plan, created_at, last_login
                """,
                (email, password_hash, name or ""),
            )
            row = cur.fetchone()
            return _normalize_user_row(row)

    def update_last_login(self, user_id: int) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET last_login = NOW() WHERE id = %s",
                (int(user_id),),
            )

    def set_role(self, user_id: int, role: str) -> bool:
        with self.conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET role = %s WHERE id = %s",
                (role, int(user_id)),
            )
            return cur.rowcount > 0

    def close(self) -> None:
        self.conn.close()


def _normalize_user_row(row: dict) -> dict:
    """Coerce Postgres timestamps to ISO strings so the auth layer's
    dataclass + JSON responses work the same as with SQLite."""
    out = dict(row)
    for key in ("created_at", "last_login"):
        value = out.get(key)
        if hasattr(value, "isoformat"):
            out[key] = value.isoformat()
    return out


# --- Postgres position / closed-trade repositories --------------------------
# Mirror SQLitePositionRepository + SQLiteClosedTradeRepository.

class PostgresPositionRepository:
    def __init__(self, dsn: str):
        if not _AVAILABLE:
            raise RuntimeError("psycopg is not installed")
        self.dsn = dsn
        self.conn = psycopg.connect(dsn, autocommit=True, row_factory=dict_row)

    def upsert(self, pos: "Position") -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO positions (
                    id, opened_at, pair, direction, lot_size, entry, stop_loss,
                    tp1, tp2, tp3, status, closed_pnl_usd
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    stop_loss = EXCLUDED.stop_loss,
                    lot_size = EXCLUDED.lot_size,
                    status = EXCLUDED.status,
                    closed_pnl_usd = EXCLUDED.closed_pnl_usd
                """,
                (
                    pos.id, pos.opened_at, pos.pair, pos.direction.value,
                    pos.lot_size, pos.entry, pos.stop_loss,
                    pos.tp1, pos.tp2, pos.tp3, pos.status, pos.closed_pnl_usd,
                ),
            )

    def close(self, position_id: str, closed_at: float) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                "UPDATE positions SET status='closed', closed_at=%s WHERE id=%s",
                (closed_at, position_id),
            )

    def open_positions(self) -> List[dict]:
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM positions WHERE status != 'closed' ORDER BY opened_at DESC"
            )
            return list(cur.fetchall())

    def get(self, position_id: str) -> Optional[dict]:
        with self.conn.cursor() as cur:
            cur.execute("SELECT * FROM positions WHERE id = %s", (position_id,))
            row = cur.fetchone()
            return dict(row) if row else None

    def close(self) -> None:
        self.conn.close()


class PostgresClosedTradeRepository:
    def __init__(self, dsn: str):
        if not _AVAILABLE:
            raise RuntimeError("psycopg is not installed")
        self.dsn = dsn
        self.conn = psycopg.connect(dsn, autocommit=True, row_factory=dict_row)

    def save(self, trade: dict) -> int:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO closed_trades (
                    position_id, pair, direction, opened_at, closed_at,
                    entry, exit_price, stop_loss, tp1, tp2, lot_size,
                    sl_pips, pnl_usd, r_multiple, outcome
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
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
            row = cur.fetchone()
            return int(row["id"]) if row else 0

    def recent(self, limit: int = 100, pair: Optional[str] = None) -> List[dict]:
        with self.conn.cursor() as cur:
            if pair:
                cur.execute(
                    "SELECT * FROM closed_trades WHERE pair = %s ORDER BY closed_at DESC LIMIT %s",
                    (pair, limit),
                )
            else:
                cur.execute(
                    "SELECT * FROM closed_trades ORDER BY closed_at DESC LIMIT %s",
                    (limit,),
                )
            return list(cur.fetchall())

    def stats(self) -> dict:
        with self.conn.cursor() as cur:
            cur.execute("SELECT pnl_usd, r_multiple FROM closed_trades")
            rows = list(cur.fetchall())
        if not rows:
            return {
                "trades": 0, "wins": 0, "losses": 0,
                "win_rate": 0.0, "gross_profit": 0.0, "gross_loss": 0.0,
                "profit_factor": 0.0, "avg_r": 0.0, "total_pnl": 0.0,
            }
        wins = sum(1 for r in rows if r["pnl_usd"] > 0)
        losses = sum(1 for r in rows if r["pnl_usd"] < 0)
        gross_profit = sum(float(r["pnl_usd"]) for r in rows if r["pnl_usd"] > 0)
        gross_loss = abs(sum(float(r["pnl_usd"]) for r in rows if r["pnl_usd"] < 0))
        total_pnl = sum(float(r["pnl_usd"]) for r in rows)
        avg_r = sum(float(r["r_multiple"]) for r in rows) / len(rows)
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

    def close(self) -> None:
        self.conn.close()


# --- Postgres trade-manager state repository -------------------------------
# Persists TradeManager._tp1_taken + _opened_state so partial-close P&L
# math and TP1 bookkeeping survive a Render restart.

class PostgresTradeManagerStateRepository:
    def __init__(self, dsn: str):
        if not _AVAILABLE:
            raise RuntimeError("psycopg is not installed")
        self.dsn = dsn
        self.conn = psycopg.connect(dsn, autocommit=True, row_factory=dict_row)

    def upsert_state(self, position_id: str, tp1_taken: bool, opened_state: dict) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO trade_manager_state (
                    position_id, tp1_taken, original_lots, risk_usd, sl_pips, original_sl
                ) VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (position_id) DO UPDATE SET
                    tp1_taken = EXCLUDED.tp1_taken,
                    original_lots = EXCLUDED.original_lots,
                    risk_usd = EXCLUDED.risk_usd,
                    sl_pips = EXCLUDED.sl_pips,
                    original_sl = EXCLUDED.original_sl,
                    updated_at = NOW()
                """,
                (
                    position_id, tp1_taken,
                    opened_state.get("original_lots"),
                    opened_state.get("risk_usd"),
                    opened_state.get("sl_pips"),
                    opened_state.get("original_sl"),
                ),
            )

    def clear_state(self, position_id: str) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                "DELETE FROM trade_manager_state WHERE position_id = %s",
                (position_id,),
            )

    def load_all(self) -> dict:
        """Return {position_id: (tp1_taken, opened_state_dict)} for all rows."""
        with self.conn.cursor() as cur:
            cur.execute("SELECT * FROM trade_manager_state")
            rows = list(cur.fetchall())
        result: dict = {}
        for row in rows:
            result[row["position_id"]] = (
                bool(row["tp1_taken"]),
                {
                    "original_lots": row.get("original_lots"),
                    "risk_usd": row.get("risk_usd"),
                    "sl_pips": row.get("sl_pips"),
                    "original_sl": row.get("original_sl"),
                },
            )
        return result

    def close(self) -> None:
        self.conn.close()


# --- Postgres last-analysis snapshot repository ----------------------------
# One row per pair; holds the most recent analysis snapshot so the
# invalidation detector has a baseline to compare against on each cycle.

class PostgresLastAnalysisRepository:
    def __init__(self, dsn: str):
        if not _AVAILABLE:
            raise RuntimeError("psycopg is not installed")
        self.dsn = dsn
        self.conn = psycopg.connect(dsn, autocommit=True, row_factory=dict_row)

    def save_snapshot(self, pair: str, snapshot: dict) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO last_analysis_snapshots (pair, snapshot)
                VALUES (%s, %s::jsonb)
                ON CONFLICT (pair) DO UPDATE SET
                    snapshot = EXCLUDED.snapshot, updated_at = NOW()
                """,
                (pair, json.dumps(snapshot, default=str)),
            )

    def load_all(self) -> dict:
        """Return {pair: snapshot_dict} for every persisted row."""
        with self.conn.cursor() as cur:
            cur.execute("SELECT pair, snapshot FROM last_analysis_snapshots")
            rows = list(cur.fetchall())
        result: dict = {}
        for row in rows:
            value = row["snapshot"]
            result[row["pair"]] = dict(value) if isinstance(value, dict) else json.loads(value)
        return result

    def close(self) -> None:
        self.conn.close()
