"""Signal resolution — determines the outcome of published signals.

Resolution triggers:
  - TP1_HIT, TP2_HIT, TP3_HIT  — price reached a take-profit level
  - STOP_HIT                    — price reached the stop-loss level
  - EXPIRED                     — setup timed out without triggering
  - INVALIDATED                 — market conditions changed and invalidated the setup
  - CANCELLED                   — user cancelled the signal before resolution

The resolver walks forward from the signal's published time using the market
client and determines the actual outcome, computing the real R result after
estimated costs (spread, slippage, overnight swaps).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

log = logging.getLogger(__name__)


class OutcomeType(str, Enum):
    TP1_HIT = "TP1_HIT"
    TP2_HIT = "TP2_HIT"
    TP3_HIT = "TP3_HIT"
    STOP_HIT = "STOP_HIT"
    EXPIRED = "EXPIRED"
    INVALIDATED = "INVALIDATED"
    CANCELLED = "CANCELLED"


@dataclass
class ResolvedSignal:
    signal_id: int
    fingerprint: str
    pair: str
    direction: str
    timeframe: str
    entry: float
    stop_loss: float
    tp1: float
    tp2: float
    tp3: float
    score: int
    setup_quality: str
    session: str
    engine_version: str
    published_at: str
    resolved_at: Optional[str] = None
    outcome: Optional[OutcomeType] = None
    outcome_detail: Optional[str] = None
    entry_triggered: bool = False
    actual_entry_price: Optional[float] = None
    actual_exit_price: Optional[float] = None
    r_result: Optional[float] = None
    r_after_costs: Optional[float] = None
    mfe_r: Optional[float] = None
    mae_r: Optional[float] = None
    holding_bars: int = 0
    bars_to_resolution: int = 0
    data_source: str = "backtested"
    metadata_json: str = "{}"


@dataclass
class ResolutionContext:
    market_client: Any
    signal: Dict[str, Any]
    outcome_repo: Optional[Any] = None
    max_bars: int = 96


class SignalResolver:
    DEFAULT_TTL_HOURS = 24
    COST_ESTIMATE_BPS = 2.5

    def __init__(self, market_client, outcome_repo=None):
        self.market_client = market_client
        self.outcome_repo = outcome_repo

    def resolve(
        self,
        signal: Dict[str, Any],
        max_bars: int = 96,
        estimated_cost_bps: float = COST_ESTIMATE_BPS,
    ) -> ResolvedSignal:
        """Resolve a published signal to its outcome.

        Args:
            signal: Published signal dict with keys like pair, direction,
                entry, stop_loss, tp1, tp2, tp3, published_at, etc.
            max_bars: Maximum bars to walk forward before expiring.
            estimated_cost_bps: Estimated round-trip cost in basis points.

        Returns:
            ResolvedSignal with outcome, R values, and metadata.
        """
        resolved = ResolvedSignal(
            signal_id=signal.get("id", 0),
            fingerprint=signal.get("fingerprint", ""),
            pair=signal.get("pair", ""),
            direction=signal.get("direction", ""),
            timeframe=signal.get("timeframe", "H1"),
            entry=float(signal.get("entry", 0)),
            stop_loss=float(signal.get("stop_loss", 0)),
            tp1=float(signal.get("tp1", 0)),
            tp2=float(signal.get("tp2", 0)) or 0.0,
            tp3=float(signal.get("tp3", 0)) or 0.0,
            score=int(signal.get("score", 0)),
            setup_quality=signal.get("setup_quality", "STRONG"),
            session=signal.get("session", "Unknown"),
            engine_version=signal.get("engine_version", "V2"),
            published_at=str(signal.get("published_at", "")),
        )

        pair = resolved.pair
        direction = resolved.direction
        entry = resolved.entry
        stop = resolved.stop_loss
        tp1 = resolved.tp1
        tp2 = resolved.tp2
        tp3 = resolved.tp3

        if not pair or not direction or entry <= 0 or stop <= 0 or tp1 <= 0:
            resolved.outcome = OutcomeType.INVALIDATED
            resolved.outcome_detail = "Missing or invalid price levels"
            resolved.resolved_at = datetime.now(timezone.utc).isoformat()
            return resolved

        timeframe = self._normalize_timeframe(resolved.timeframe)
        try:
            bars = self.market_client.fetch_candles(pair, timeframe, limit=max_bars)
        except Exception as exc:
            log.warning("Failed to fetch candles for %s %s: %s", pair, timeframe, exc)
            resolved.outcome = OutcomeType.EXPIRED
            resolved.outcome_detail = f"Market data unavailable: {exc}"
            resolved.resolved_at = datetime.now(timezone.utc).isoformat()
            return resolved

        if not bars:
            resolved.outcome = OutcomeType.EXPIRED
            resolved.outcome_detail = "No candle data available"
            resolved.resolved_at = datetime.now(timezone.utc).isoformat()
            return resolved

        resolved = self._walk_forward(resolved, bars, stop, tp1, tp2, tp3, direction, estimated_cost_bps)
        resolved.resolved_at = datetime.now(timezone.utc).isoformat()

        if self.outcome_repo and resolved.outcome:
            self._persist_outcome(resolved, signal)

        return resolved

    def _walk_forward(
        self,
        resolved: ResolvedSignal,
        bars: List[Any],
        stop: float,
        tp1: float,
        tp2: float,
        tp3: float,
        direction: str,
        cost_bps: float,
    ) -> ResolvedSignal:
        entry_found = False
        entry_idx = None
        entry_price = None
        highest_mfe = 0.0
        highest_mae = 0.0
        tp_hit_level = None
        exit_idx = None
        exit_price = None

        for idx, bar in enumerate(bars):
            high, low, close = bar.high, bar.low, bar.close

            if not entry_found:
                if direction == "BUY" and close >= resolved.entry:
                    entry_found = True
                    entry_idx = idx
                    entry_price = resolved.entry
                elif direction == "SELL" and close <= resolved.entry:
                    entry_found = True
                    entry_idx = idx
                    entry_price = resolved.entry

            if entry_found:
                if direction == "BUY":
                    if entry_price > stop:
                        mfe = (high - entry_price) / (entry_price - stop)
                        mae = (entry_price - low) / (entry_price - stop)
                    else:
                        mfe, mae = 0.0, 0.0
                    if low <= stop:
                        resolved.outcome = OutcomeType.STOP_HIT
                        tp_hit_level = 0
                        exit_idx, exit_price = idx, stop
                        highest_mfe = max(highest_mfe, mfe)
                        highest_mae = max(highest_mae, mae)
                        break
                    if high >= tp3:
                        resolved.outcome = OutcomeType.TP3_HIT
                        tp_hit_level = 3
                        exit_idx, exit_price = idx, tp3
                        break
                    if high >= tp2:
                        resolved.outcome = OutcomeType.TP2_HIT
                        tp_hit_level = 2
                        exit_idx, exit_price = idx, tp2
                        break
                    if high >= tp1:
                        resolved.outcome = OutcomeType.TP1_HIT
                        tp_hit_level = 1
                        exit_idx, exit_price = idx, tp1
                        break
                else:
                    if entry_price < stop:
                        mfe = (entry_price - low) / (stop - entry_price)
                        mae = (high - entry_price) / (stop - entry_price)
                    else:
                        mfe, mae = 0.0, 0.0
                    if high >= stop:
                        resolved.outcome = OutcomeType.STOP_HIT
                        tp_hit_level = 0
                        exit_idx, exit_price = idx, stop
                        highest_mfe = max(highest_mfe, mfe)
                        highest_mae = max(highest_mae, mae)
                        break
                    if low <= tp3:
                        resolved.outcome = OutcomeType.TP3_HIT
                        tp_hit_level = 3
                        exit_idx, exit_price = idx, tp3
                        break
                    if low <= tp2:
                        resolved.outcome = OutcomeType.TP2_HIT
                        tp_hit_level = 2
                        exit_idx, exit_price = idx, tp2
                        break
                    if low <= tp1:
                        resolved.outcome = OutcomeType.TP1_HIT
                        tp_hit_level = 1
                        exit_idx, exit_price = idx, tp1
                        break

                highest_mfe = max(highest_mfe, mfe)
                highest_mae = max(highest_mae, mae)

        resolved.entry_triggered = entry_found
        resolved.actual_entry_price = entry_price
        resolved.actual_exit_price = exit_price
        resolved.holding_bars = max(0, (exit_idx or 0) - (entry_idx or 0) + 1) if entry_found else 0
        resolved.bars_to_resolution = (exit_idx or len(bars) - 1) - (entry_idx or 0) + 1 if entry_found else len(bars)
        resolved.mfe_r = round(highest_mfe, 4) if highest_mfe else 0.0
        resolved.mae_r = round(highest_mae, 4) if highest_mae else 0.0

        if not entry_found:
            resolved.outcome = OutcomeType.EXPIRED
            resolved.outcome_detail = "Entry trigger not reached within resolution window"
            resolved.r_result = 0.0
            resolved.r_after_costs = 0.0
            return resolved

        if resolved.outcome and resolved.outcome != OutcomeType.EXPIRED:
            if tp_hit_level is not None and tp_hit_level > 0:
                resolved.r_result = float(tp_hit_level)
            else:
                resolved.r_result = -1.0
        else:
            resolved.outcome = OutcomeType.EXPIRED
            resolved.outcome_detail = resolved.outcome_detail or "Setup timed out"
            resolved.r_result = round(resolved.mfe_r - 1.0, 4) if resolved.mfe_r else 0.0

        cost_multiplier = cost_bps / 10000.0
        resolved.r_after_costs = round(resolved.r_result - cost_multiplier, 4) if resolved.r_result is not None else None

        return resolved

    def _normalize_timeframe(self, tf: str) -> str:
        mapping = {
            "1m": "M1", "m1": "M1",
            "5m": "M5", "m5": "M5",
            "15m": "M15", "m15": "M15",
            "30m": "M30", "m30": "M30",
            "1h": "H1", "h1": "H1",
            "4h": "H4", "h4": "H4",
            "1d": "D1", "d1": "D1",
            "1w": "W1", "w1": "W1",
        }
        return mapping.get(tf.lower(), "H1")

    def _persist_outcome(self, resolved: ResolvedSignal, signal: Dict[str, Any]) -> None:
        if not self.outcome_repo:
            return
        try:
            self.outcome_repo.save_resolved_outcome({
                "signal_id": resolved.signal_id,
                "fingerprint": resolved.fingerprint,
                "pair": resolved.pair,
                "direction": resolved.direction,
                "timeframe": resolved.timeframe,
                "entry": resolved.entry,
                "stop_loss": resolved.stop_loss,
                "tp1": resolved.tp1,
                "tp2": resolved.tp2,
                "tp3": resolved.tp3,
                "score": resolved.score,
                "setup_quality": resolved.setup_quality,
                "session": resolved.session,
                "engine_version": resolved.engine_version,
                "published_at": resolved.published_at,
                "resolved_at": resolved.resolved_at,
                "outcome": resolved.outcome.value if resolved.outcome else None,
                "outcome_detail": resolved.outcome_detail,
                "entry_triggered": resolved.entry_triggered,
                "actual_entry_price": resolved.actual_entry_price,
                "actual_exit_price": resolved.actual_exit_price,
                "r_result": resolved.r_result,
                "r_after_costs": resolved.r_after_costs,
                "mfe_r": resolved.mfe_r,
                "mae_r": resolved.mae_r,
                "holding_bars": resolved.holding_bars,
                "bars_to_resolution": resolved.bars_to_resolution,
                "data_source": resolved.data_source,
                "metadata_json": resolved.metadata_json,
            })
        except Exception:
            log.exception("Failed to persist resolved outcome for signal %s", resolved.signal_id)
