"""
Instrument Specification for Confluence X.

Authoritative per-instrument configuration for execution math:
pip size, tick size, pip value, contract size, quantity increments,
price precision, default spread.

Used by PaperBroker, RiskManager, and any future live broker adapter.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional


@dataclass
class InstrumentSpec:
    """Specification for a single tradeable instrument."""
    symbol: str
    asset_class: str  # cryptocurrency, forex, metals, indices, equity

    # Price geometry
    pip_size: float          # Minimum price movement that counts as 1 pip
    tick_size: float         # Minimum price increment (may be finer than pip)
    pip_value_per_lot: float # USD value of 1 pip per standard lot
    contract_size: float     # Units per standard lot (e.g. 100000 for forex, 1 for crypto)

    # Quantity rules
    min_quantity: float      # Minimum order size
    quantity_step: float     # Quantity increment (lot step)
    max_quantity: float      # Maximum order size (0 = unlimited)

    # Price rules
    price_precision: int     # Decimal places for price display
    quantity_precision: int  # Decimal places for quantity display

    # Default execution assumptions
    typical_spread_pips: float  # Typical spread in pips
    typical_slippage_pips: float  # Expected slippage in pips
    commission_per_lot: float  # Commission per standard lot (round-turn)

    @property
    def pip_size_digits(self) -> int:
        """Number of decimal places in pip_size."""
        s = f"{self.pip_size:.10f}".rstrip('0')
        if '.' in s:
            return len(s.split('.')[1])
        return 0


# Default specs for common instruments
DEFAULT_SPECS: Dict[str, InstrumentSpec] = {
    # Crypto
    'BTCUSD': InstrumentSpec(
        symbol='BTCUSD', asset_class='cryptocurrency',
        pip_size=1.0, tick_size=0.01, pip_value_per_lot=1.0, contract_size=1.0,
        min_quantity=0.001, quantity_step=0.001, max_quantity=0,
        price_precision=2, quantity_precision=6,
        typical_spread_pips=10.0, typical_slippage_pips=2.0, commission_per_lot=0.0,
    ),
    'ETHUSD': InstrumentSpec(
        symbol='ETHUSD', asset_class='cryptocurrency',
        pip_size=0.01, tick_size=0.01, pip_value_per_lot=0.01, contract_size=1.0,
        min_quantity=0.01, quantity_step=0.01, max_quantity=0,
        price_precision=2, quantity_precision=4,
        typical_spread_pips=5.0, typical_slippage_pips=1.0, commission_per_lot=0.0,
    ),
    'XRPUSD': InstrumentSpec(
        symbol='XRPUSD', asset_class='cryptocurrency',
        pip_size=0.0001, tick_size=0.0001, pip_value_per_lot=0.0001, contract_size=1.0,
        min_quantity=1.0, quantity_step=1.0, max_quantity=0,
        price_precision=4, quantity_precision=0,
        typical_spread_pips=5.0, typical_slippage_pips=1.0, commission_per_lot=0.0,
    ),
    'LTCUSD': InstrumentSpec(
        symbol='LTCUSD', asset_class='cryptocurrency',
        pip_size=0.01, tick_size=0.01, pip_value_per_lot=0.01, contract_size=1.0,
        min_quantity=0.01, quantity_step=0.01, max_quantity=0,
        price_precision=2, quantity_precision=4,
        typical_spread_pips=5.0, typical_slippage_pips=1.0, commission_per_lot=0.0,
    ),
    # Metals
    'XAUUSD': InstrumentSpec(
        symbol='XAUUSD', asset_class='metals',
        pip_size=0.01, tick_size=0.01, pip_value_per_lot=1.0, contract_size=100.0,
        min_quantity=0.01, quantity_step=0.01, max_quantity=0,
        price_precision=2, quantity_precision=2,
        typical_spread_pips=3.0, typical_slippage_pips=0.5, commission_per_lot=0.0,
    ),
    # Forex
    'EURUSD': InstrumentSpec(
        symbol='EURUSD', asset_class='forex',
        pip_size=0.0001, tick_size=0.00001, pip_value_per_lot=10.0, contract_size=100000.0,
        min_quantity=0.01, quantity_step=0.01, max_quantity=0,
        price_precision=5, quantity_precision=2,
        typical_spread_pips=1.2, typical_slippage_pips=0.3, commission_per_lot=7.0,
    ),
    'GBPUSD': InstrumentSpec(
        symbol='GBPUSD', asset_class='forex',
        pip_size=0.0001, tick_size=0.00001, pip_value_per_lot=10.0, contract_size=100000.0,
        min_quantity=0.01, quantity_step=0.01, max_quantity=0,
        price_precision=5, quantity_precision=2,
        typical_spread_pips=1.5, typical_slippage_pips=0.3, commission_per_lot=7.0,
    ),
    'USDJPY': InstrumentSpec(
        symbol='USDJPY', asset_class='forex',
        pip_size=0.01, tick_size=0.001, pip_value_per_lot=6.67, contract_size=100000.0,
        min_quantity=0.01, quantity_step=0.01, max_quantity=0,
        price_precision=3, quantity_precision=2,
        typical_spread_pips=1.5, typical_slippage_pips=0.3, commission_per_lot=7.0,
    ),
    'USDCHF': InstrumentSpec(
        symbol='USDCHF', asset_class='forex',
        pip_size=0.0001, tick_size=0.00001, pip_value_per_lot=10.0, contract_size=100000.0,
        min_quantity=0.01, quantity_step=0.01, max_quantity=0,
        price_precision=5, quantity_precision=2,
        typical_spread_pips=1.5, typical_slippage_pips=0.3, commission_per_lot=7.0,
    ),
    'AUDUSD': InstrumentSpec(
        symbol='AUDUSD', asset_class='forex',
        pip_size=0.0001, tick_size=0.00001, pip_value_per_lot=10.0, contract_size=100000.0,
        min_quantity=0.01, quantity_step=0.01, max_quantity=0,
        price_precision=5, quantity_precision=2,
        typical_spread_pips=1.5, typical_slippage_pips=0.3, commission_per_lot=7.0,
    ),
    # Indices
    'NAS100': InstrumentSpec(
        symbol='NAS100', asset_class='indices',
        pip_size=0.01, tick_size=0.01, pip_value_per_lot=0.01, contract_size=1.0,
        min_quantity=0.1, quantity_step=0.1, max_quantity=0,
        price_precision=2, quantity_precision=1,
        typical_spread_pips=5.0, typical_slippage_pips=1.0, commission_per_lot=0.0,
    ),
    'US30': InstrumentSpec(
        symbol='US30', asset_class='indices',
        pip_size=0.01, tick_size=0.01, pip_value_per_lot=0.01, contract_size=1.0,
        min_quantity=0.1, quantity_step=0.1, max_quantity=0,
        price_precision=2, quantity_precision=1,
        typical_spread_pips=5.0, typical_slippage_pips=1.0, commission_per_lot=0.0,
    ),
}


def get_spec(symbol: str) -> InstrumentSpec:
    """Get instrument specification. Falls back to a generic FX spec if unknown."""
    spec = DEFAULT_SPECS.get(symbol.upper())
    if spec:
        return spec
    # Fallback: assume standard forex
    return InstrumentSpec(
        symbol=symbol, asset_class='forex',
        pip_size=0.0001, tick_size=0.00001, pip_value_per_lot=10.0, contract_size=100000.0,
        min_quantity=0.01, quantity_step=0.01, max_quantity=0,
        price_precision=5, quantity_precision=2,
        typical_spread_pips=2.0, typical_slippage_pips=0.5, commission_per_lot=7.0,
    )
