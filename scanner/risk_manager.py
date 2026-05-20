"""Position sizing + per-trade risk validation.

Implements spec §6.1:
    lot_size = (account_balance * risk_pct) / (sl_pips * pip_value_per_lot)

Also enforces the spec §6 trade qualification rules:
    - Minimum R:R of 1:2
    - Reject trades with SL distance disproportionate to TP
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict

from .data_types import Direction
from .signal import Signal


# Approximate USD pip value per 1.00 standard lot, by pair.
# Standard lot sizes vary by instrument; brokers normalise to USD value.
# These are reasonable defaults — real-world tuning against the broker's
# actual contract specs happens in Step 8 deploy verification.
PIP_VALUE_PER_LOT_USD: Dict[str, float] = {
    "EURUSD": 10.0,
    "GBPUSD": 10.0,
    "AUDUSD": 10.0,
    "NZDUSD": 10.0,
    "USDCAD": 10.0,
    "USDCHF": 10.0,
    "USDJPY": 9.0,    # varies with JPY rate; midpoint
    "GBPJPY": 9.0,
    "XAUUSD": 10.0,   # 100 oz contract * $0.10/pip
    "XAGUSD": 50.0,
    "NAS100": 1.0,    # CFD: 1 point = $1 per contract
    "US30":   1.0,
}

# Pip size in price units (1 pip = N price units).
PIP_SIZE: Dict[str, float] = {
    "USDJPY": 0.01, "GBPJPY": 0.01,
    "XAUUSD": 0.10, "XAGUSD": 0.01,
    "NAS100": 1.0,  "US30": 1.0,
}
DEFAULT_PIP_SIZE = 0.0001  # most FX


def pip_size_for(pair: str) -> float:
    return PIP_SIZE.get(pair, DEFAULT_PIP_SIZE)


def price_distance_to_pips(pair: str, distance: float) -> float:
    return abs(distance) / pip_size_for(pair)


@dataclass
class TradePlan:
    pair: str
    direction: Direction
    entry: float
    stop_loss: float
    tp1: float
    tp2: float
    tp3: float
    lot_size: float
    risk_usd: float
    sl_pips: float
    rr_to_tp1: float
    rr_to_tp2: float


@dataclass
class TradeRejection:
    reason: str


class RiskManager:
    def __init__(
        self,
        risk_per_trade_pct: float = 0.5,
        min_rr_ratio: float = 2.0,
        max_lot_size: float = 50.0,
        min_sl_pips: float = 5.0,
    ):
        if not 0 < risk_per_trade_pct <= 5:
            raise ValueError("risk_per_trade_pct must be in (0, 5]")
        self.risk_pct = risk_per_trade_pct / 100.0
        self.min_rr = min_rr_ratio
        self.max_lot = max_lot_size
        self.min_sl_pips = min_sl_pips

    def plan_trade(
        self,
        sig: Signal,
        account_balance_usd: float,
    ) -> TradePlan | TradeRejection:
        if account_balance_usd <= 0:
            return TradeRejection("Account balance is non-positive")
        if sig.direction == Direction.NEUTRAL:
            return TradeRejection("Signal direction is NEUTRAL")

        sl_distance = abs(sig.entry - sig.stop_loss)
        if sl_distance == 0:
            return TradeRejection("Entry equals stop loss")

        sl_pips = price_distance_to_pips(sig.pair, sl_distance)
        if sl_pips < self.min_sl_pips:
            return TradeRejection(
                f"SL distance {sl_pips:.1f} pips below minimum {self.min_sl_pips}"
            )

        tp1_distance = abs(sig.tp1 - sig.entry)
        tp2_distance = abs(sig.tp2 - sig.entry)
        rr_tp1 = tp1_distance / sl_distance
        rr_tp2 = tp2_distance / sl_distance
        # Spec §6: minimum 1:2 R:R. We measure on TP2 since TP1 is the
        # partial-close target and isn't required to clear 2R alone.
        if rr_tp2 < self.min_rr:
            return TradeRejection(
                f"R:R {rr_tp2:.2f} below minimum {self.min_rr:.1f}:1 (TP2 vs SL)"
            )

        pip_value = PIP_VALUE_PER_LOT_USD.get(sig.pair)
        if pip_value is None:
            return TradeRejection(f"No pip value table entry for {sig.pair}")

        risk_usd = account_balance_usd * self.risk_pct
        raw_lots = risk_usd / (sl_pips * pip_value)
        # Round down to 2 decimals (most brokers accept 0.01 lots). Add a
        # tiny epsilon to dodge float artifacts (0.01 * 100 = 0.9999...).
        lot_size = math.floor(raw_lots * 100 + 1e-9) / 100
        if lot_size <= 0:
            return TradeRejection(
                f"Computed lot size rounds to 0 (risk ${risk_usd:.2f}, "
                f"SL {sl_pips:.1f}p, pip ${pip_value})"
            )
        if lot_size > self.max_lot:
            lot_size = self.max_lot

        return TradePlan(
            pair=sig.pair,
            direction=sig.direction,
            entry=sig.entry,
            stop_loss=sig.stop_loss,
            tp1=sig.tp1,
            tp2=sig.tp2,
            tp3=sig.tp3,
            lot_size=lot_size,
            risk_usd=risk_usd,
            sl_pips=sl_pips,
            rr_to_tp1=rr_tp1,
            rr_to_tp2=rr_tp2,
        )
