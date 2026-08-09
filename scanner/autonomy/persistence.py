"""
Autonomous persistence layer.

Writes setup lifecycle, journal entries, forecasts, and market memory
to Postgres tables defined in scanner/postgres_repo.py.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Optional

log = logging.getLogger(__name__)


def save_setup(conn, setup) -> None:
    """Upsert an autonomous setup into Postgres."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO autonomy_setups (
                    setup_id, symbol, asset_class, direction, state,
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
                    %s, %s, %s, %s, %s,
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
                    setup.setup_id, setup.symbol, setup.asset_class,
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
        with conn.cursor() as cur:
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
        with conn.cursor() as cur:
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
        with conn.cursor() as cur:
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
        with conn.cursor() as cur:
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
        with conn.cursor() as cur:
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
