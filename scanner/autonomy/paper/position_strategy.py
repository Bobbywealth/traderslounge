"""
Position Management Strategy Configuration for Confluence X.

Defines per-strategy TP/SL management rules so the paper broker
(and future live broker) can manage positions according to the
setup's strategy type, not hardcoded percentages.

Default strategy: standard 40/35/25 TP1/TP2/TP3 split.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Optional


@dataclass
class TakeProfitRule:
    """Rule for a single take-profit level."""
    close_pct: float           # Percentage of original quantity to close
    move_sl_to_be: bool        # Move stop-loss to break-even after this TP
    trailing_stop: bool = False  # Activate trailing stop after this TP
    trailing_distance_r: float = 0.0  # Trailing distance in R-multiples


@dataclass
class PositionStrategy:
    """Complete position management strategy."""
    name: str
    version: str = '1.0.0'
    description: str = ''

    # TP rules
    tp1: TakeProfitRule = field(default_factory=lambda: TakeProfitRule(close_pct=40.0, move_sl_to_be=True))
    tp2: TakeProfitRule = field(default_factory=lambda: TakeProfitRule(close_pct=35.0, move_sl_to_be=False))
    tp3: TakeProfitRule = field(default_factory=lambda: TakeProfitRule(close_pct=25.0, move_sl_to_be=False))

    # Stop-loss
    initial_sl_atr_multiple: float = 1.5  # Initial SL = entry ± ATR * multiple
    be_offset_pips: float = 2.0  # Break-even offset (covers spread)

    # Time-based expiry
    max_holding_bars: int = 0  # 0 = no time limit
    max_holding_hours: float = 0.0

    # Risk adjustments
    reduce_on_news: bool = True  # Reduce position size before high-impact news
    close_on_session_end: bool = False  # Close at session end

    def to_dict(self) -> dict:
        return {
            'name': self.name,
            'version': self.version,
            'description': self.description,
            'tp1': {'close_pct': self.tp1.close_pct, 'move_sl_to_be': self.tp1.move_sl_to_be},
            'tp2': {'close_pct': self.tp2.close_pct, 'move_sl_to_be': self.tp2.move_sl_to_be},
            'tp3': {'close_pct': self.tp3.close_pct, 'move_sl_to_be': self.tp3.move_sl_to_be},
            'initial_sl_atr_multiple': self.initial_sl_atr_multiple,
            'be_offset_pips': self.be_offset_pips,
            'max_holding_bars': self.max_holding_bars,
            'max_holding_hours': self.max_holding_hours,
            'reduce_on_news': self.reduce_on_news,
            'close_on_session_end': self.close_on_session_end,
        }


# Default strategies
DEFAULT_STRATEGIES: Dict[str, PositionStrategy] = {
    'standard': PositionStrategy(
        name='standard',
        description='Standard 40/35/25 split with BE at TP1',
        tp1=TakeProfitRule(close_pct=40.0, move_sl_to_be=True),
        tp2=TakeProfitRule(close_pct=35.0, move_sl_to_be=False),
        tp3=TakeProfitRule(close_pct=25.0, move_sl_to_be=False),
    ),
    'aggressive': PositionStrategy(
        name='aggressive',
        description='Aggressive 30/30/40 split, trailing stop after TP1',
        tp1=TakeProfitRule(close_pct=30.0, move_sl_to_be=True, trailing_stop=True, trailing_distance_r=1.0),
        tp2=TakeProfitRule(close_pct=30.0, move_sl_to_be=False),
        tp3=TakeProfitRule(close_pct=40.0, move_sl_to_be=False),
    ),
    'conservative': PositionStrategy(
        name='conservative',
        description='Conservative 50/50 split, close at TP2 only',
        tp1=TakeProfitRule(close_pct=50.0, move_sl_to_be=True),
        tp2=TakeProfitRule(close_pct=50.0, move_sl_to_be=False),
        tp3=TakeProfitRule(close_pct=0.0, move_sl_to_be=False),
    ),
    'scalp': PositionStrategy(
        name='scalp',
        description='Scalp: 100% at TP1, tight SL',
        tp1=TakeProfitRule(close_pct=100.0, move_sl_to_be=False),
        tp2=TakeProfitRule(close_pct=0.0, move_sl_to_be=False),
        tp3=TakeProfitRule(close_pct=0.0, move_sl_to_be=False),
        initial_sl_atr_multiple=0.75,
        max_holding_bars=12,
    ),
}


def get_strategy(name: str) -> PositionStrategy:
    """Get a position management strategy by name. Falls back to standard."""
    return DEFAULT_STRATEGIES.get(name, DEFAULT_STRATEGIES['standard'])
