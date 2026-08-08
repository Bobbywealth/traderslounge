"""
Forward test resolver for trading validation.

Handles:
- Resolving forecast outcomes
- Tracking trade lifecycle
- Preventing look-ahead bias
- Walk-forward validation
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from enum import Enum
from typing import List, Optional

log = logging.getLogger(__name__)


class ForecastStatus(Enum):
    """Forecast resolution status."""
    PENDING = 'PENDING'
    ACTIVE = 'ACTIVE'
    RESOLVED_WIN = 'RESOLVED_WIN'
    RESOLVED_LOSS = 'RESOLVED_LOSS'
    RESOLVED_BREAK_EVEN = 'RESOLVED_BREAK_EVEN'
    EXPIRED = 'EXPIRED'
    CANCELLED = 'CANCELLED'


@dataclass
class Forecast:
    """A trading forecast to be validated."""
    id: str
    fingerprint: str
    created_at: float
    symbol: str
    timeframe: str
    direction: str  # BUY or SELL
    entry: float
    stop_loss: float
    target: float
    score: int
    setup_type: Optional[str] = None
    session: Optional[str] = None
    volatility_regime: Optional[str] = None
    engine_version: Optional[str] = None
    predicted_probability: Optional[float] = None
    metadata: Optional[dict] = None


@dataclass
class ForecastOutcome:
    """Outcome of a resolved forecast."""
    forecast_id: str
    resolved_at: float
    outcome: bool  # True = win, False = loss
    r_multiple: float
    mae_r: float  # Maximum adverse excursion in R
    mfe_r: float  # Maximum favorable excursion in R
    holding_bars: int
    exit_reason: str  # 'target', 'stop', 'expired', etc.
    actual_entry: Optional[float] = None
    actual_exit: Optional[float] = None


class ForwardTestResolver:
    """Resolves forecast outcomes using historical data."""
    
    def __init__(self, candle_provider):
        """
        Args:
            candle_provider: Callable that returns candles for (symbol, timeframe)
        """
        self._candle_provider = candle_provider
    
    def resolve_forecast(
        self,
        forecast: Forecast,
        max_holding_bars: int = 100,
    ) -> Optional[ForecastOutcome]:
        """Resolve a forecast using historical candle data.
        
        Args:
            forecast: The forecast to resolve
            max_holding_bars: Maximum bars to hold before expiry
        
        Returns:
            ForecastOutcome if resolved, None if still pending
        """
        # Get candles after forecast creation
        candles = self._candle_provider(forecast.symbol, forecast.timeframe)
        
        if not candles:
            return None
        
        # Filter candles to only those after forecast creation
        future_candles = [
            c for c in candles 
            if self._get_candle_time(c) > forecast.created_at
        ]
        
        if not future_candles:
            return None
        
        # Check if entry was triggered
        entry_triggered = False
        entry_price = None
        entry_bar = 0
        
        for i, candle in enumerate(future_candles[:max_holding_bars]):
            if self._check_entry_triggered(candle, forecast):
                entry_triggered = True
                entry_price = forecast.entry  # Use forecast entry for consistency
                entry_bar = i
                break
        
        if not entry_triggered:
            # Entry never triggered - expired
            return ForecastOutcome(
                forecast_id=forecast.id,
                resolved_at=time.time(),
                outcome=False,
                r_multiple=0,
                mae_r=0,
                mfe_r=0,
                holding_bars=0,
                exit_reason='expired',
            )
        
        # Track price movement after entry
        post_entry_candles = future_candles[entry_bar:]
        
        mae_r = 0  # Maximum adverse excursion
        mfe_r = 0  # Maximum favorable excursion
        exit_price = None
        exit_reason = 'expired'
        holding_bars = 0
        
        risk_distance = abs(forecast.entry - forecast.stop_loss)
        if risk_distance == 0:
            risk_distance = forecast.entry * 0.01  # Default 1% risk
        
        for i, candle in enumerate(post_entry_candles[:max_holding_bars]):
            holding_bars = i + 1
            
            high = self._get_candle_high(candle)
            low = self._get_candle_low(candle)
            
            # Calculate R for this bar's extremes
            if forecast.direction == 'BUY':
                adverse_r = (forecast.entry - low) / risk_distance
                favorable_r = (high - forecast.entry) / risk_distance
            else:  # SELL
                adverse_r = (low - forecast.entry) / risk_distance
                favorable_r = (forecast.entry - high) / risk_distance
            
            mae_r = min(mae_r, -adverse_r)
            mfe_r = max(mfe_r, favorable_r)
            
            # Check if stop loss hit
            if self._check_stop_hit(candle, forecast):
                exit_price = forecast.stop_loss
                exit_reason = 'stop'
                break
            
            # Check if target hit
            if self._check_target_hit(candle, forecast):
                exit_price = forecast.target
                exit_reason = 'target'
                break
        
        # If no exit triggered, use last candle close
        if exit_price is None:
            last_candle = post_entry_candles[min(holding_bars - 1, len(post_entry_candles) - 1)]
            exit_price = self._get_candle_close(last_candle)
            exit_reason = 'expired'
        
        # Calculate final R-multiple
        if forecast.direction == 'BUY':
            r_multiple = (exit_price - forecast.entry) / risk_distance
        else:
            r_multiple = (forecast.entry - exit_price) / risk_distance
        
        outcome = r_multiple > 0
        
        return ForecastOutcome(
            forecast_id=forecast.id,
            resolved_at=time.time(),
            outcome=outcome,
            r_multiple=r_multiple,
            mae_r=mae_r,
            mfe_r=mfe_r,
            holding_bars=holding_bars,
            exit_reason=exit_reason,
            actual_entry=entry_price,
            actual_exit=exit_price,
        )
    
    def _check_entry_triggered(self, candle: dict, forecast: Forecast) -> bool:
        """Check if entry price was reached in this candle."""
        high = self._get_candle_high(candle)
        low = self._get_candle_low(candle)
        
        if forecast.direction == 'BUY':
            return low <= forecast.entry
        else:
            return high >= forecast.entry
    
    def _check_stop_hit(self, candle: dict, forecast: Forecast) -> bool:
        """Check if stop loss was hit in this candle."""
        high = self._get_candle_high(candle)
        low = self._get_candle_low(candle)
        
        if forecast.direction == 'BUY':
            return low <= forecast.stop_loss
        else:
            return high >= forecast.stop_loss
    
    def _check_target_hit(self, candle: dict, forecast: Forecast) -> bool:
        """Check if target was hit in this candle."""
        high = self._get_candle_high(candle)
        low = self._get_candle_low(candle)
        
        if forecast.direction == 'BUY':
            return high >= forecast.target
        else:
            return low <= forecast.target
    
    def _get_candle_time(self, candle: dict) -> float:
        """Extract timestamp from candle."""
        return float(candle.get('time', candle.get('t', 0)))
    
    def _get_candle_high(self, candle: dict) -> float:
        """Extract high from candle."""
        return float(candle.get('high', candle.get('h', 0)))
    
    def _get_candle_low(self, candle: dict) -> float:
        """Extract low from candle."""
        return float(candle.get('low', candle.get('l', 0)))
    
    def _get_candle_close(self, candle: dict) -> float:
        """Extract close from candle."""
        return float(candle.get('close', candle.get('c', 0)))
