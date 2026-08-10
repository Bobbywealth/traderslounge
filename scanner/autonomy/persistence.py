"""
Autonomous persistence layer.

Writes setup lifecycle, journal entries, forecasts, and market memory
to Postgres tables defined in scanner/postgres_repo.py.
"""
from __future__ import annotations

import json
import logging
import time
from contextlib import contextmanager
from typing import Optional

log = logging.getLogger(__name__)


def _open_cursor(conn):
    """Return a context manager yielding a psycopg cursor.

    The autonomous loop sometimes passes a raw psycopg connection and
    sometimes a ``@contextmanager`` generator (from
    ``repo._get_connection()``).  Both have to work here, otherwise the
    setup lifecycle blows up with
    ``AttributeError: '_GeneratorContextManager' object has no attribute
    'cursor'`` every cycle.  When the argument is already a connection
    we wrap it in a no-op context manager so the call sites can use a
    uniform ``with _open_cursor(conn) as cur:`` pattern.
    """
    if conn is None:
        raise ValueError("connection is None")

    if hasattr(conn, "cursor") and not hasattr(conn, "__enter__"):
        # Already a raw psycopg connection — wrap so callers can use
        # the same ``with`` syntax everywhere.
        @contextmanager
        def _wrap_raw(_raw=conn):
            try:
                yield _raw
            finally:
                pass

        @contextmanager
        def _open_raw():
            with _wrap_raw() as _c:
                with _c.cursor() as cur:
                    yield cur

        return _open_raw()

    # It's a @contextmanager generator — enter it, then cursor().
    @contextmanager
    def _open_ctx():
        with conn as _c:
            with _c.cursor() as cur:
                yield cur

    return _open_ctx()


def save_setup(conn, setup) -> None:
    """Upsert an autonomous setup into Postgres."""
    try:
        with _open_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO autonomy_setups (
                    setup_id, fingerprint, symbol, asset_class, direction, state,
                    detected_at, updated_at, timeframe, macro_timeframe,
                    strategy_type, engine_version, market_regime, session,
                    score, score_components,
                    entry_low, entry_high, entry_type,
                    stop_loss, tp1, tp2, tp3,
                    expected_rr_tp1, expected_rr_tp2, expected_rr_tp3,
                    invalidation_price, invalidation_condition,
                    technical_reasons, macro_reasons, risk_reasons,
                    news_state, data_quality,
                    state_reason, expires_at, forecast_id, position_id
                ) VALUES (
                    %s, %s, %s, %s, %s, %s,
                    to_timestamp(%s), to_timestamp(%s), %s, %s,
                    %s, %s, %s, %s,
                    %s, %s::jsonb,
                    %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s,
                    %s::jsonb, %s::jsonb, %s::jsonb,
                    %s, %s,
                    %s, to_timestamp(%s), %s, %s
                )
                ON CONFLICT (setup_id) DO UPDATE SET
                    state = EXCLUDED.state,
                    updated_at = EXCLUDED.updated_at,
                    score = EXCLUDED.score,
                    score_components = EXCLUDED.score_components,
                    entry_low = EXCLUDED.entry_low,
                    entry_high = EXCLUDED.entry_high,
                    stop_loss = EXCLUDED.stop_loss,
                    tp1 = EXCLUDED.tp1,
                    tp2 = EXCLUDED.tp2,
                    tp3 = EXCLUDED.tp3,
                    state_reason = EXCLUDED.state_reason,
                    forecast_id = EXCLUDED.forecast_id,
                    position_id = EXCLUDED.position_id,
                    technical_reasons = EXCLUDED.technical_reasons
                """,
                (
                    setup.setup_id, getattr(setup, 'fingerprint', ''), setup.symbol, setup.asset_class,
                    setup.direction, setup.state.value,
                    setup.detected_at, setup.updated_at,
                    setup.timeframe, setup.macro_timeframe,
                    setup.strategy_type, setup.engine_version,
                    setup.market_regime, setup.session,
                    setup.score, json.dumps(setup.score_components),
                    setup.entry_low, setup.entry_high, setup.entry_type,
                    setup.stop_loss, setup.tp1, setup.tp2, setup.tp3,
                    setup.expected_rr_tp1, setup.expected_rr_tp2, setup.expected_rr_tp3,
                    setup.invalidation_price, setup.invalidation_condition,
                    json.dumps(setup.technical_reasons),
                    json.dumps(setup.macro_reasons),
                    json.dumps(setup.risk_reasons),
                    setup.news_state, setup.data_quality,
                    setup.state_reason,
                    setup.expires_at or 0,
                    setup.forecast_id, setup.position_id,
                ),
            )
    except Exception:
        log.exception("Failed to save setup %s", getattr(setup, 'setup_id', '?'))


def save_setup_event(conn, setup_id: str, event) -> None:
    """Insert a setup event into Postgres."""
    try:
        with _open_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO setup_events (
                    event_id, setup_id, timestamp, from_state, to_state, reason, metadata
                ) VALUES (%s, %s, to_timestamp(%s), %s, %s, %s, %s::jsonb)
                ON CONFLICT (event_id) DO NOTHING
                """,
                (
                    event.event_id, setup_id, event.timestamp,
                    event.from_state.value if event.from_state else None,
                    event.to_state.value,
                    event.reason,
                    json.dumps(event.metadata),
                ),
            )
    except Exception:
        log.exception("Failed to save event for setup %s", setup_id)


def save_forecast(conn, forecast) -> None:
    """Persist a forward forecast to Postgres."""
    try:
        with _open_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO forward_forecasts (
                    forecast_id, fingerprint, created_at, symbol, timeframe,
                    direction, entry_price, stop_loss, target_price,
                    score, score_components, setup_type, session,
                    volatility_regime, market_regime, engine_version,
                    predicted_probability, confidence_class, status
                ) VALUES (
                    %s, %s, to_timestamp(%s), %s, %s,
                    %s, %s, %s, %s,
                    %s, %s::jsonb, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s
                )
                ON CONFLICT (forecast_id) DO NOTHING
                """,
                (
                    forecast.forecast_id, forecast.fingerprint, forecast.created_at,
                    forecast.symbol, forecast.timeframe,
                    forecast.direction, forecast.entry_price,
                    forecast.stop_loss, forecast.target_price,
                    forecast.score, json.dumps(forecast.score_components),
                    forecast.setup_type, forecast.session,
                    forecast.volatility_regime, forecast.market_regime,
                    forecast.engine_version,
                    forecast.predicted_probability, forecast.confidence_class,
                    forecast.status.value,
                ),
            )
    except Exception:
        log.exception("Failed to save forecast %s", getattr(forecast, 'forecast_id', '?'))


def load_active_setups(conn) -> list:
    """Load active setups from Postgres on startup."""
    try:
        with _open_cursor(conn) as cur:
            cur.execute(
                "SELECT * FROM autonomy_setups "
                "WHERE state NOT IN ('closed', 'invalidated', 'expired', 'cancelled') "
                "ORDER BY detected_at DESC LIMIT 100"
            )
            return cur.fetchall()
    except Exception:
        log.exception("Failed to load active setups")
        return []


def save_journal_entry(conn, entry) -> None:
    """Upsert a journal entry into Postgres."""
    try:
        with _open_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO journal_entries (
                    setup_id, symbol, asset_class, direction, timeframe,
                    strategy_type, engine_version,
                    detected_at, triggered_at, entry_at, closed_at,
                    score, score_components, market_regime, session,
                    news_state, data_quality,
                    entry_price, stop_loss, tp1, tp2, tp3,
                    actual_entry, actual_exit, lot_size, fees, spread, slippage,
                    outcome, r_multiple, pnl_usd, mfe_r, mae_r,
                    exit_reason, holding_bars, holding_time_seconds,
                    technical_reasons, macro_reasons, risk_reasons
                ) VALUES (
                    %s, %s, %s, %s, %s,
                    %s, %s,
                    to_timestamp(%s), to_timestamp(%s), to_timestamp(%s), to_timestamp(%s),
                    %s, %s::jsonb, %s, %s,
                    %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s,
                    %s::jsonb, %s::jsonb, %s::jsonb
                )
                ON CONFLICT (setup_id) DO UPDATE SET
                    triggered_at = COALESCE(EXCLUDED.triggered_at, journal_entries.triggered_at),
                    entry_at = COALESCE(EXCLUDED.entry_at, journal_entries.entry_at),
                    closed_at = COALESCE(EXCLUDED.closed_at, journal_entries.closed_at),
                    actual_entry = COALESCE(EXCLUDED.actual_entry, journal_entries.actual_entry),
                    actual_exit = COALESCE(EXCLUDED.actual_exit, journal_entries.actual_exit),
                    outcome = COALESCE(EXCLUDED.outcome, journal_entries.outcome),
                    r_multiple = COALESCE(EXCLUDED.r_multiple, journal_entries.r_multiple),
                    pnl_usd = COALESCE(EXCLUDED.pnl_usd, journal_entries.pnl_usd),
                    exit_reason = COALESCE(EXCLUDED.exit_reason, journal_entries.exit_reason),
                    state_history = EXCLUDED.technical_reasons
                """,
                (
                    entry.setup_id, entry.symbol, entry.asset_class,
                    entry.direction, entry.timeframe,
                    entry.strategy_type, entry.engine_version,
                    entry.detected_at or 0, entry.triggered_at or 0,
                    entry.entry_at or 0, entry.closed_at or 0,
                    entry.score, json.dumps(entry.score_components),
                    entry.market_regime, entry.session,
                    entry.news_state, entry.data_quality,
                    entry.entry_price, entry.stop_loss,
                    entry.tp1, entry.tp2, entry.tp3,
                    entry.actual_entry, entry.actual_exit,
                    entry.lot_size, entry.fees, entry.spread, entry.slippage,
                    entry.outcome, entry.r_multiple, entry.pnl_usd,
                    entry.mfe_r, entry.mae_r,
                    entry.exit_reason, entry.holding_bars,
                    entry.holding_time_seconds,
                    json.dumps(entry.technical_reasons),
                    json.dumps(entry.macro_reasons),
                    json.dumps(entry.risk_reasons),
                ),
            )
    except Exception:
        log.exception("Failed to save journal entry %s", getattr(entry, 'setup_id', '?'))


def save_market_snapshot(conn, snapshot) -> None:
    """Insert a market snapshot into Postgres."""
    try:
        with _open_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO market_snapshots (
                    symbol, timestamp, price, regime, trend, volatility,
                    session, ema_20, ema_50, rsi, adx, atr, news_state
                ) VALUES (%s, to_timestamp(%s), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    snapshot.symbol, snapshot.timestamp, snapshot.price,
                    snapshot.regime, snapshot.trend, snapshot.volatility,
                    snapshot.session, snapshot.ema_20, snapshot.ema_50,
                    snapshot.rsi, snapshot.adx, snapshot.atr, snapshot.news_state,
                ),
            )
    except Exception:
        log.exception("Failed to save market snapshot for %s", getattr(snapshot, 'symbol', '?'))


def save_paper_order(conn, order) -> None:
    """Persist a paper order to Postgres."""
    try:
        with _open_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO paper_orders (
                    order_id, setup_id, idempotency_key, symbol, direction,
                    order_type, requested_quantity, requested_price,
                    fill_price, status, spread_pips, slippage_pips,
                    commission, created_at, filled_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, to_timestamp(%s), to_timestamp(%s))
                ON CONFLICT (order_id) DO UPDATE SET
                    fill_price = EXCLUDED.fill_price,
                    status = EXCLUDED.status,
                    filled_at = EXCLUDED.filled_at
                """,
                (
                    order.order_id, order.setup_id, order.idempotency_key,
                    order.symbol, order.direction, order.order_type.value,
                    order.quantity, order.price, order.filled_price,
                    order.status.value, order.spread_pips, order.slippage_pips,
                    order.commission, order.created_at,
                    order.filled_at or 0,
                ),
            )
    except Exception:
        log.exception("Failed to save paper order %s", getattr(order, 'order_id', '?'))


def save_paper_position(conn, position) -> None:
    """Persist a paper position to Postgres."""
    try:
        with _open_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO paper_positions (
                    position_id, setup_id, symbol, direction,
                    original_quantity, remaining_quantity, average_entry,
                    stop_loss, tp1, tp2, tp3,
                    tp1_hit, tp2_hit, tp3_hit, break_even_moved,
                    realized_pnl, unrealized_pnl, total_fees,
                    opened_at, closed_at, state
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, to_timestamp(%s), to_timestamp(%s), %s
                )
                ON CONFLICT (position_id) DO UPDATE SET
                    remaining_quantity = EXCLUDED.remaining_quantity,
                    stop_loss = EXCLUDED.stop_loss,
                    tp1_hit = EXCLUDED.tp1_hit,
                    tp2_hit = EXCLUDED.tp2_hit,
                    tp3_hit = EXCLUDED.tp3_hit,
                    break_even_moved = EXCLUDED.break_even_moved,
                    realized_pnl = EXCLUDED.realized_pnl,
                    unrealized_pnl = EXCLUDED.unrealized_pnl,
                    total_fees = EXCLUDED.total_fees,
                    closed_at = EXCLUDED.closed_at,
                    state = EXCLUDED.state
                """,
                (
                    position.position_id, getattr(position, 'setup_id', ''),
                    position.symbol, position.direction,
                    position.original_quantity, position.quantity, position.entry_price,
                    position.stop_loss, position.take_profit_1, position.take_profit_2,
                    position.take_profit_3, position.tp1_hit, position.tp2_hit,
                    position.tp3_hit, position.break_even_moved,
                    position.realized_pnl, position.unrealized_pnl, position.total_fees,
                    position.opened_at, position.closed_at or 0,
                    'open' if position.is_open else 'closed',
                ),
            )
    except Exception:
        log.exception("Failed to save paper position %s", getattr(position, 'position_id', '?'))


def save_position_event(conn, position_id: str, event_type: str,
                       event_data: dict) -> None:
    """Persist a position event (fill, TP, SL, BE, close, etc.)"""
    try:
        import uuid
        with _open_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO position_events (
                    event_id, position_id, event_type, data, created_at
                ) VALUES (%s, %s, %s, %s::jsonb, NOW())
                """,
                (
                    str(uuid.uuid4())[:12], position_id, event_type,
                    json.dumps(event_data),
                ),
            )
    except Exception:
        log.exception("Failed to save position event for %s", position_id)


def check_idempotency_key(conn, key: str) -> Optional[str]:
    """Check if an idempotency key already exists in Postgres.
    Returns the existing order_id if found, None otherwise.
    """
    try:
        with _open_cursor(conn) as cur:
            cur.execute(
                "SELECT order_id FROM paper_orders WHERE idempotency_key = %s",
                (key,),
            )
            row = cur.fetchone()
            return row['order_id'] if row else None
    except Exception:
        log.exception("Failed to check idempotency key %s", key)
        return None


def acquire_setup_lock(conn, setup_id: str, timeout_seconds: int = 30) -> bool:
    """Acquire a Postgres advisory lock for a setup.
    Returns True if lock acquired, False if already locked.
    Prevents two workers from executing the same setup simultaneously.
    """
    try:
        # Use pg_try_advisory_lock with a hash of the setup_id as the lock key
        lock_key = hash(setup_id) % (2**31)  # Fit in int32
        with _open_cursor(conn) as cur:
            cur.execute("SELECT pg_try_advisory_lock(%s)", (lock_key,))
            row = cur.fetchone()
            acquired = bool(row and row[0])
            if acquired:
                log.debug("Acquired lock for setup %s (key=%d)", setup_id, lock_key)
            else:
                log.info("Setup %s is already locked by another worker", setup_id)
            return acquired
    except Exception:
        log.exception("Failed to acquire lock for setup %s", setup_id)
        return False


def release_setup_lock(conn, setup_id: str) -> bool:
    """Release a Postgres advisory lock for a setup."""
    try:
        lock_key = hash(setup_id) % (2**31)
        with _open_cursor(conn) as cur:
            cur.execute("SELECT pg_advisory_unlock(%s)", (lock_key,))
            return True
    except Exception:
        log.exception("Failed to release lock for setup %s", setup_id)
        return False
