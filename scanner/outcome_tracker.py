"""Outcome tracker — persists resolved outcomes and computes aggregate statistics.

This module provides:
  - OutcomeStorage: persists resolved outcomes to SQLite
  - OutcomeTracker: computes aggregate statistics by market, timeframe, session, direction, setup type
"""
from __future__ import annotations

import json
import logging
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .signal_resolver import OutcomeType

log = logging.getLogger(__name__)


OUTCOME_SCHEMA = """
CREATE TABLE IF NOT EXISTS resolved_outcomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id INTEGER,
    fingerprint TEXT NOT NULL,
    pair TEXT NOT NULL,
    direction TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    entry REAL NOT NULL,
    stop_loss REAL NOT NULL,
    tp1 REAL NOT NULL,
    tp2 REAL,
    tp3 REAL,
    score INTEGER,
    setup_quality TEXT,
    session TEXT,
    engine_version TEXT,
    published_at TEXT NOT NULL,
    resolved_at TEXT NOT NULL,
    outcome TEXT,
    outcome_detail TEXT,
    entry_triggered INTEGER DEFAULT 0,
    actual_entry_price REAL,
    actual_exit_price REAL,
    r_result REAL,
    r_after_costs REAL,
    mfe_r REAL,
    mae_r REAL,
    holding_bars INTEGER DEFAULT 0,
    bars_to_resolution INTEGER DEFAULT 0,
    data_source TEXT DEFAULT 'backtested',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE(fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_outcomes_pair ON resolved_outcomes(pair, resolved_at DESC);
CREATE INDEX IF NOT EXISTS idx_outcomes_timeframe ON resolved_outcomes(timeframe, resolved_at DESC);
CREATE INDEX IF NOT EXISTS idx_outcomes_session ON resolved_outcomes(session, resolved_at DESC);
CREATE INDEX IF NOT EXISTS idx_outcomes_direction ON resolved_outcomes(direction, resolved_at DESC);
CREATE INDEX IF NOT EXISTS idx_outcomes_outcome ON resolved_outcomes(outcome, resolved_at DESC);
CREATE INDEX IF NOT EXISTS idx_outcomes_data_source ON resolved_outcomes(data_source, resolved_at DESC);
"""


@dataclass
class OutcomeBucket:
    trades: int = 0
    wins: int = 0
    losses: int = 0
    break_even: int = 0
    win_rate: float = 0.0
    avg_r: float = 0.0
    avg_r_after_costs: float = 0.0
    expectancy: float = 0.0
    profit_factor: float = 0.0
    total_r: float = 0.0
    total_r_after_costs: float = 0.0
    mfe_avg: float = 0.0
    mae_avg: float = 0.0
    tp1_hits: int = 0
    tp2_hits: int = 0
    tp3_hits: int = 0
    stop_hits: int = 0
    expired: int = 0
    invalidated: int = 0
    tp1_rate: float = 0.0
    tp2_rate: float = 0.0
    tp3_rate: float = 0.0
    stop_rate: float = 0.0
    sample_size: int = 0
    confidence_interval_95: float = 0.0


@dataclass
class OutcomeStatistics:
    total_resolved: int = 0
    total_pending: int = 0
    win_rate: float = 0.0
    avg_r: float = 0.0
    expectancy: float = 0.0
    profit_factor: float = 0.0
    avg_mfe: float = 0.0
    avg_mae: float = 0.0
    by_market: Dict[str, OutcomeBucket] = field(default_factory=dict)
    by_timeframe: Dict[str, OutcomeBucket] = field(default_factory=dict)
    by_session: Dict[str, OutcomeBucket] = field(default_factory=dict)
    by_direction: Dict[str, OutcomeBucket] = field(default_factory=dict)
    by_setup_quality: Dict[str, OutcomeBucket] = field(default_factory=dict)
    by_outcome: Dict[str, int] = field(default_factory=dict)
    data_source_breakdown: Dict[str, int] = field(default_factory=dict)


class OutcomeStorage:
    def __init__(self, db_path: str | Path = "outcomes.db"):
        self.path = str(db_path)
        self.conn = sqlite3.connect(self.path, isolation_level=None, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(OUTCOME_SCHEMA)

    def save_resolved_outcome(self, outcome: Dict[str, Any]) -> int:
        self.conn.execute(
            """
            INSERT INTO resolved_outcomes (
                signal_id, fingerprint, pair, direction, timeframe,
                entry, stop_loss, tp1, tp2, tp3, score, setup_quality,
                session, engine_version, published_at, resolved_at,
                outcome, outcome_detail, entry_triggered,
                actual_entry_price, actual_exit_price,
                r_result, r_after_costs, mfe_r, mae_r,
                holding_bars, bars_to_resolution, data_source, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(fingerprint) DO UPDATE SET
                resolved_at = excluded.resolved_at,
                outcome = excluded.outcome,
                outcome_detail = excluded.outcome_detail,
                entry_triggered = excluded.entry_triggered,
                actual_entry_price = excluded.actual_entry_price,
                actual_exit_price = excluded.actual_exit_price,
                r_result = excluded.r_result,
                r_after_costs = excluded.r_after_costs,
                mfe_r = excluded.mfe_r,
                mae_r = excluded.mae_r,
                holding_bars = excluded.holding_bars,
                bars_to_resolution = excluded.bars_to_resolution
            """,
            (
                outcome.get("signal_id"),
                outcome["fingerprint"],
                outcome["pair"],
                outcome["direction"],
                outcome["timeframe"],
                outcome["entry"],
                outcome["stop_loss"],
                outcome["tp1"],
                outcome.get("tp2") or outcome["tp1"],
                outcome.get("tp3") or outcome["tp1"],
                outcome.get("score"),
                outcome.get("setup_quality"),
                outcome.get("session", "Unknown"),
                outcome.get("engine_version", "V2"),
                outcome["published_at"],
                outcome["resolved_at"],
                outcome.get("outcome"),
                outcome.get("outcome_detail"),
                int(bool(outcome.get("entry_triggered"))),
                outcome.get("actual_entry_price"),
                outcome.get("actual_exit_price"),
                outcome.get("r_result"),
                outcome.get("r_after_costs"),
                outcome.get("mfe_r"),
                outcome.get("mae_r"),
                outcome.get("holding_bars", 0),
                outcome.get("bars_to_resolution", 0),
                outcome.get("data_source", "backtested"),
                outcome.get("metadata_json", "{}"),
            ),
        )
        row = self.conn.execute("SELECT id FROM resolved_outcomes WHERE fingerprint = ?", (outcome["fingerprint"],)).fetchone()
        return int(row["id"]) if row else 0

    def get_outcomes(
        self,
        limit: int = 100,
        offset: int = 0,
        pair: Optional[str] = None,
        direction: Optional[str] = None,
        timeframe: Optional[str] = None,
        outcome: Optional[str] = None,
        data_source: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        query = "SELECT * FROM resolved_outcomes WHERE 1=1"
        params: List[Any] = []
        if pair:
            query += " AND pair = ?"
            params.append(pair)
        if direction:
            query += " AND direction = ?"
            params.append(direction)
        if timeframe:
            query += " AND timeframe = ?"
            params.append(timeframe)
        if outcome:
            query += " AND outcome = ?"
            params.append(outcome)
        if data_source:
            query += " AND data_source = ?"
            params.append(data_source)
        query += " ORDER BY resolved_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        rows = self.conn.execute(query, params).fetchall()
        return [self._row_to_outcome(dict(row)) for row in rows]

    def count_outcomes(self, **filters) -> int:
        query = "SELECT COUNT(*) FROM resolved_outcomes WHERE 1=1"
        params: List[Any] = []
        for key in ("pair", "direction", "timeframe", "outcome", "data_source"):
            if filters.get(key):
                query += f" AND {key} = ?"
                params.append(filters[key])
        row = self.conn.execute(query, params).fetchone()
        return int(row[0]) if row else 0

    def _row_to_outcome(self, row: Dict[str, Any]) -> Dict[str, Any]:
        row.pop("metadata_json", None)
        row["entry_triggered"] = bool(row.get("entry_triggered"))
        return row

    def close(self) -> None:
        self.conn.close()


class OutcomeTracker:
    def __init__(self, storage: OutcomeStorage):
        self.storage = storage

    def compute_statistics(
        self,
        pair: Optional[str] = None,
        direction: Optional[str] = None,
        timeframe: Optional[str] = None,
        session: Optional[str] = None,
        data_source: Optional[str] = None,
    ) -> OutcomeStatistics:
        outcomes = self.storage.get_outcomes(
            limit=10000,
            pair=pair,
            direction=direction,
            timeframe=timeframe,
            data_source=data_source,
        )
        if session:
            outcomes = [o for o in outcomes if o.get("session") == session]

        stats = OutcomeStatistics()
        stats.total_resolved = len(outcomes)

        if not outcomes:
            return stats

        r_values = [o.get("r_after_costs", o.get("r_result", 0)) for o in outcomes if o.get("r_result") is not None]
        wins = [r for r in r_values if r > 0]
        losses = [r for r in r_values if r < 0]
        be_count = len([r for r in r_values if r == 0])

        stats.win_rate = len(wins) / len(r_values) if r_values else 0.0
        stats.avg_r = sum(r_values) / len(r_values) if r_values else 0.0
        stats.expectancy = stats.avg_r
        total_wins = sum(wins) if wins else 0.0
        total_losses = abs(sum(losses)) if losses else 0.0
        stats.profit_factor = total_wins / total_losses if total_losses > 0 else 0.0
        mfe_values = [o.get("mfe_r", 0) for o in outcomes if o.get("mfe_r") is not None]
        mae_values = [o.get("mae_r", 0) for o in outcomes if o.get("mae_r") is not None]
        stats.avg_mfe = sum(mfe_values) / len(mfe_values) if mfe_values else 0.0
        stats.avg_mae = sum(mae_values) / len(mae_values) if mae_values else 0.0

        stats.by_market = self._bucket_by(outcomes, "pair")
        stats.by_timeframe = self._bucket_by(outcomes, "timeframe")
        stats.by_session = self._bucket_by(outcomes, "session")
        stats.by_direction = self._bucket_by(outcomes, "direction")
        stats.by_setup_quality = self._bucket_by(outcomes, "setup_quality")

        outcome_counts: Dict[str, int] = {}
        for o in outcomes:
            outcome = o.get("outcome", "UNKNOWN") or "UNKNOWN"
            outcome_counts[outcome] = outcome_counts.get(outcome, 0) + 1
        stats.by_outcome = outcome_counts

        source_counts: Dict[str, int] = {}
        for o in outcomes:
            source = o.get("data_source", "backtested") or "backtested"
            source_counts[source] = source_counts.get(source, 0) + 1
        stats.data_source_breakdown = source_counts

        return stats

    def _bucket_by(self, outcomes: List[Dict[str, Any]], key: str) -> Dict[str, OutcomeBucket]:
        buckets: Dict[str, List[Dict[str, Any]]] = {}
        for o in outcomes:
            bucket_name = o.get(key) or "Unknown"
            if bucket_name not in buckets:
                buckets[bucket_name] = []
            buckets[bucket_name].append(o)

        result: Dict[str, OutcomeBucket] = {}
        for bucket_name, bucket_outcomes in buckets.items():
            result[bucket_name] = self._compute_bucket(bucket_outcomes)

        return result

    def _compute_bucket(self, outcomes: List[Dict[str, Any]]) -> OutcomeBucket:
        bucket = OutcomeBucket()
        bucket.trades = len(outcomes)
        bucket.sample_size = bucket.trades

        r_values = [o.get("r_after_costs", o.get("r_result", 0)) for o in outcomes if o.get("r_result") is not None]
        wins = [r for r in r_values if r > 0]
        losses = [r for r in r_values if r < 0]
        bucket.wins = len(wins)
        bucket.losses = len(losses)
        bucket.break_even = len([r for r in r_values if r == 0])

        bucket.win_rate = len(wins) / len(r_values) if r_values else 0.0
        bucket.avg_r = sum(r_values) / len(r_values) if r_values else 0.0
        bucket.total_r = sum(r_values) if r_values else 0.0

        r_after_costs = [o.get("r_after_costs", o.get("r_result", 0)) for o in outcomes if o.get("r_after_costs") is not None or o.get("r_result") is not None]
        bucket.avg_r_after_costs = sum(r_after_costs) / len(r_after_costs) if r_after_costs else 0.0
        bucket.total_r_after_costs = sum(r_after_costs) if r_after_costs else 0.0

        bucket.expectancy = bucket.avg_r
        total_wins = sum(wins) if wins else 0.0
        total_losses = abs(sum(losses)) if losses else 0.0
        bucket.profit_factor = total_wins / total_losses if total_losses > 0 else 0.0

        mfe_values = [o.get("mfe_r", 0) for o in outcomes if o.get("mfe_r") is not None]
        mae_values = [o.get("mae_r", 0) for o in outcomes if o.get("mae_r") is not None]
        bucket.mfe_avg = sum(mfe_values) / len(mfe_values) if mfe_values else 0.0
        bucket.mae_avg = sum(mae_values) / len(mae_values) if mae_values else 0.0

        for o in outcomes:
            outcome = o.get("outcome")
            if outcome == OutcomeType.TP1_HIT.value:
                bucket.tp1_hits += 1
            elif outcome == OutcomeType.TP2_HIT.value:
                bucket.tp2_hits += 1
            elif outcome == OutcomeType.TP3_HIT.value:
                bucket.tp3_hits += 1
            elif outcome == OutcomeType.STOP_HIT.value:
                bucket.stop_hits += 1
            elif outcome == OutcomeType.EXPIRED.value:
                bucket.expired += 1
            elif outcome == OutcomeType.INVALIDATED.value:
                bucket.invalidated += 1

        total = bucket.trades or 1
        bucket.tp1_rate = bucket.tp1_hits / total
        bucket.tp2_rate = bucket.tp2_hits / total
        bucket.tp3_rate = bucket.tp3_hits / total
        bucket.stop_rate = bucket.stop_hits / total

        import math
        p = bucket.win_rate
        n = bucket.trades
        if n > 0 and p > 0 and p < 1:
            se = math.sqrt((p * (1 - p)) / n)
            bucket.confidence_interval_95 = 1.96 * se
        else:
            bucket.confidence_interval_95 = 0.0

        return bucket

    def get_outcome_list(
        self,
        limit: int = 100,
        offset: int = 0,
        pair: Optional[str] = None,
        direction: Optional[str] = None,
        timeframe: Optional[str] = None,
        outcome: Optional[str] = None,
        data_source: Optional[str] = None,
    ) -> Dict[str, Any]:
        outcomes = self.storage.get_outcomes(
            limit=limit,
            offset=offset,
            pair=pair,
            direction=direction,
            timeframe=timeframe,
            outcome=outcome,
            data_source=data_source,
        )
        total = self.storage.count_outcomes(
            pair=pair,
            direction=direction,
            timeframe=timeframe,
            outcome=outcome,
            data_source=data_source,
        )
        return {
            "outcomes": outcomes,
            "total": total,
            "limit": limit,
            "offset": offset,
        }
