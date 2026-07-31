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
    # Crypto pip values are USD-per-1.0-of-base-asset price move.
    # For 1.0 unit of base (1 BTC, 1 ETH, etc.), a $1 price move = $1
    # P&L; pip size is set so "pips" align to whole-dollar moves on
    # high-priced coins and finer granularity on cheap ones.
    "BTCUSD": 1.0, "ETHUSD": 1.0, "XRPUSD": 1.0, "LTCUSD": 1.0,
    "DOTUSD": 1.0, "XLMUSD": 1.0, "BATUSD": 1.0, "NEOUSD": 1.0,
}

# Pip size in price units (1 pip = N price units).
PIP_SIZE: Dict[str, float] = {
    "USDJPY": 0.01, "GBPJPY": 0.01,
    "XAUUSD": 0.10, "XAGUSD": 0.01,
    "NAS100": 1.0,  "US30": 1.0,
    # Crypto: pip = a sensible price step per coin, chosen so a typical
    # SL distance lands in the 50-500 pip range like FX.
    "BTCUSD": 10.0,    # $10 step ≈ FX pip-equivalent on BTC at ~$60k
    "ETHUSD": 1.0,     # $1 step on ETH at ~$3k
    "XRPUSD": 0.001,   # $0.001 on a ~$0.50 coin
    "LTCUSD": 0.1,
    "DOTUSD": 0.01,
    "XLMUSD": 0.0001,
    "BATUSD": 0.001,
    "NEOUSD": 0.01,
}
DEFAULT_PIP_SIZE = 0.0001  # most FX


def pip_size_for(pair: str) -> float:
    return PIP_SIZE.get(pair, DEFAULT_PIP_SIZE)


def price_distance_to_pips(pair: str, distance: float) -> float:
    return abs(distance) / pip_size_for(pair)


ASSET_PARAMS = {
    'forex': {
        'pip_size': 0.0001,
        'pip_value_per_lot': 10.0,
        'min_lot': 0.01,
        'max_lot': 100.0
    },
    'forex_jpy': {
        'pip_size': 0.01,
        'pip_value_per_lot': 9.0,
        'min_lot': 0.01,
        'max_lot': 100.0
    },
    'metals': {
        # Must match PIP_SIZE['XAUUSD']. These disagreed (0.01 here vs 0.10
        # there), so a gold stop measured 2000 points in the sizing path and
        # 200 pips everywhere else — a 10x position-sizing error.
        'point_size': 0.10,
        'point_value_per_lot': 10.0,
        'min_lot': 0.01,
        'max_lot': 50.0
    },
    'cryptocurrency': {
        'tick_size': 0.01,
        'tick_value_per_lot': 1.0,
        'min_lot': 0.001,
        'max_lot': 100.0
    }
}


def symbol_pip_size(symbol: str) -> float:
    JPY_PAIRS = {'USDJPY', 'GBPJPY', 'EURJPY'}
    if symbol in JPY_PAIRS:
        return 0.01
    return 0.0001


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
    asset_class: str = 'forex'


@dataclass
class TradeRejection:
    reason: str


def _get_asset_class(pair: str) -> str:
    CRYPTO_PAIRS = {'BTCUSD', 'ETHUSD', 'XRPUSD', 'LTCUSD'}
    JPY_PAIRS = {'USDJPY', 'GBPJPY', 'EURJPY'}
    METALS = {'XAUUSD', 'XAGUSD'}

    if pair in CRYPTO_PAIRS:
        return 'cryptocurrency'
    elif pair in JPY_PAIRS:
        return 'forex_jpy'
    elif pair in METALS:
        return 'metals'
    else:
        return 'forex'


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

    def calculate_position_size(
        self,
        account_balance_usd: float,
        entry: float,
        stop: float,
        symbol: str,
        direction: str,
        asset_class: str = 'forex'
    ) -> dict:
        params = ASSET_PARAMS.get(asset_class, ASSET_PARAMS['forex'])
        stop_distance = abs(entry - stop)

        if asset_class == 'forex':
            sl_pips = stop_distance / symbol_pip_size(symbol)
            pip_value = params['pip_value_per_lot']
            risk_amount = account_balance_usd * self.risk_pct
            raw_lots = risk_amount / (sl_pips * pip_value)
            stop_distance_pips = sl_pips

        elif asset_class == 'forex_jpy':
            sl_pips = stop_distance / symbol_pip_size(symbol)
            pip_value = params['pip_value_per_lot']
            risk_amount = account_balance_usd * self.risk_pct
            raw_lots = risk_amount / (sl_pips * pip_value)
            stop_distance_pips = sl_pips

        elif asset_class == 'metals':
            sl_points = stop_distance / params['point_size']
            risk_amount = account_balance_usd * self.risk_pct
            raw_lots = risk_amount / (sl_points * params['point_value_per_lot'])
            stop_distance_pips = sl_points

        elif asset_class == 'cryptocurrency':
            sl_ticks = stop_distance / params['tick_size']
            risk_amount = account_balance_usd * self.risk_pct
            raw_lots = risk_amount / (sl_ticks * params['tick_value_per_lot'])
            stop_distance_pips = sl_ticks

        else:
            sl_pips = stop_distance / symbol_pip_size(symbol)
            pip_value = params['pip_value_per_lot']
            risk_amount = account_balance_usd * self.risk_pct
            raw_lots = risk_amount / (sl_pips * pip_value)
            stop_distance_pips = sl_pips

        # Round before flooring. Stop distances arrive with binary-float error
        # (a 50-pip stop computes as 50.00000000000115), which makes an exact
        # 0.01-lot position land at 0.00999999… and floor away to zero — a
        # valid trade rejected as unsizeable.
        lot_size = math.floor(round(raw_lots, 8) * 100) / 100

        return {
            'lot_size': lot_size,
            'risk_amount_usd': risk_amount,
            'stop_distance': stop_distance,
            'stop_distance_pips': stop_distance_pips,
            'pip_value_per_lot': pip_value if asset_class in ('forex', 'forex_jpy') else params.get('point_value_per_lot', params.get('tick_value_per_lot', 10.0)),
            'asset_class': asset_class
        }

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

        # An unrecognised symbol previously fell through to the forex defaults
        # and was sized as if it were a standard 0.0001-pip, $10-per-pip pair.
        # Refuse instead: guessing contract specs for an unknown instrument can
        # produce a wildly wrong lot size on a real account.
        if sig.pair not in PIP_VALUE_PER_LOT_USD and sig.pair not in PIP_SIZE:
            return TradeRejection(
                f"No pip value configured for {sig.pair}; refusing to size an unknown instrument"
            )

        asset_class = _get_asset_class(sig.pair)
        position = self.calculate_position_size(
            account_balance_usd=account_balance_usd,
            entry=sig.entry,
            stop=sig.stop_loss,
            symbol=sig.pair,
            direction=sig.direction.value,
            asset_class=asset_class
        )

        sl_pips = position['stop_distance_pips']
        if sl_pips < self.min_sl_pips:
            return TradeRejection(
                f"SL distance {sl_pips:.1f} pips below minimum {self.min_sl_pips}"
            )

        tp1_distance = abs(sig.tp1 - sig.entry)
        tp2_distance = abs(sig.tp2 - sig.entry)
        rr_tp1 = tp1_distance / sl_distance
        rr_tp2 = tp2_distance / sl_distance
        if rr_tp2 < self.min_rr:
            return TradeRejection(
                f"R:R {rr_tp2:.2f} below minimum {self.min_rr:.1f}:1 (TP2 vs SL)"
            )

        lot_size = position['lot_size']
        if lot_size <= 0:
            return TradeRejection(
                f"Computed lot size rounds to 0 (risk ${position['risk_amount_usd']:.2f}, "
                f"SL {sl_pips:.1f}p, pip ${position['pip_value_per_lot']})"
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
            risk_usd=position['risk_amount_usd'],
            sl_pips=sl_pips,
            rr_to_tp1=rr_tp1,
            rr_to_tp2=rr_tp2,
            asset_class=asset_class,
        )
