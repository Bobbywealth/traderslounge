"""
Forward Validation Engine for Confluence X.

Records forecasts before outcomes and resolves them deterministically.
"""
from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional

log = logging.getLogger(__name__)


class ForecastStatus(Enum):
    """Forecast resolution status."""
    PENDING = 'pending'
    ACTIVE = 'active'
    RESOLVED_WIN = 'resolved_win'
    RESOLVED_LOSS = 'resolved_loss'
    RESOLVED_BREAKEVEN = 'resolved_breakeven'
    EXPIRED = 'expired'
    CANCELLED = 'cancelled'
    AMBIGUOUS = 'ambiguous'


@dataclass
class ForwardForecast:
    """A forward forecast recorded before outcome."""
    forecast_id: str = field(default_factory=lambda: str(uuid.uuid4())[:12])
    fingerprint: str = ''  # Unique hash of forecast parameters
    created_at: float = field(default_factory=time.time)
    
    # Instrument
    symbol: str = ''
    timeframe: str = ''
    direction: str = ''  # BUY or SELL
    
    # Entry
    entry_price: float = 0.0
    stop_loss: float = 0.0
    target_price: float = 0.0
    
    # Analysis
    score: int = 0
    score_components: Dict[str, int] = field(default_factory=dict)
    setup_type: str = ''
    session: str = ''
    volatility_regime: str = ''
    market_regime: str = ''
    
    # Engine
    engine_version: str = ''
    scoring_version: str = ''
    
    # Metadata
    predicted_probability: float = 0.5  # 0-1
    confidence_class: str = ''  # high, medium, low
    
    # Status
    status: ForecastStatus = ForecastStatus.PENDING
    resolved_at: Optional[float] = None
    
    # Outcome
    outcome: Optional[ForecastOutcome] = None
    
    def to_dict(self) -> dict:
        return {
            'forecast_id': self.forecast_id,
            'fingerprint': self.fingerprint,
            'created_at': self.created_at,
            'symbol': self.symbol,
            'timeframe': self.timeframe,
            'direction': self.direction,
            'entry_price': self.entry_price,
            'stop_loss': self.stop_loss,
            'target_price': self.target_price,
            'score': self.score,
            'score_components': self.score_components,
            'setup_type': self.setup_type,
            'session': self.session,
            'volatility_regime': self.volatility_regime,
            'market_regime': self.market_regime,
            'engine_version': self.engine_version,
            'scoring_version': self.scoring_version,
            'predicted_probability': self.predicted_probability,
            'confidence_class': self.confidence_class,
            'status': self.status.value,
            'resolved_at': self.resolved_at,
        }


@dataclass
class ForecastOutcome:
    """Outcome of a resolved forecast."""
    forecast_id: str
    resolved_at: float = field(default_factory=time.time)
    
    # Result
    outcome: bool = False  # True = win, False = loss
    r_multiple: float = 0.0
    
    # Excursion
    mfe_r: float = 0.0  # Maximum favorable excursion
    mae_r: float = 0.0  # Maximum adverse excursion
    
    # Exit
    exit_price: float = 0.0
    exit_reason: str = ''  # target, stop, expired, manual
    holding_bars: int = 0
    holding_time_seconds: float = 0.0
    
    # Fees
    fees: float = 0.0
    spread: float = 0.0
    slippage: float = 0.0
    
    def to_dict(self) -> dict:
        return {
            'forecast_id': self.forecast_id,
            'resolved_at': self.resolved_at,
            'outcome': self.outcome,
            'r_multiple': self.r_multiple,
            'mfe_r': self.mfe_r,
            'mae_r': self.mae_r,
            'exit_price': self.exit_price,
            'exit_reason': self.exit_reason,
            'holding_bars': self.holding_bars,
            'holding_time_seconds': self.holding_time_seconds,
            'fees': self.fees,
            'spread': self.spread,
            'slippage': self.slippage,
        }


class ForwardEngine:
    """
    Forward Validation Engine.
    
    Records forecasts before outcomes and resolves them deterministically.
    """
    
    def __init__(self):
        self._forecasts: Dict[str, ForwardForecast] = {}
        self._pending: List[str] = []  # forecast_ids pending resolution
        self._resolved: List[str] = []  # forecast_ids resolved
    
    def record_forecast(self, symbol: str, timeframe: str, direction: str,
                       entry_price: float, stop_loss: float, target_price: float,
                       score: int, score_components: Dict[str, int],
                       setup_type: str = '', session: str = '',
                       volatility_regime: str = '', market_regime: str = '',
                       engine_version: str = '', scoring_version: str = '',
                       predicted_probability: float = 0.5,
                       confidence_class: str = '') -> ForwardForecast:
        """Record a forward forecast before outcome is known."""
        
        # Generate fingerprint
        fingerprint = self._generate_fingerprint(
            symbol, timeframe, direction, entry_price, stop_loss, target_price
        )
        
        forecast = ForwardForecast(
            fingerprint=fingerprint,
            symbol=symbol,
            timeframe=timeframe,
            direction=direction,
            entry_price=entry_price,
            stop_loss=stop_loss,
            target_price=target_price,
            score=score,
            score_components=score_components,
            setup_type=setup_type,
            session=session,
            volatility_regime=volatility_regime,
            market_regime=market_regime,
            engine_version=engine_version,
            scoring_version=scoring_version,
            predicted_probability=predicted_probability,
            confidence_class=confidence_class,
            status=ForecastStatus.ACTIVE,
        )
        
        self._forecasts[forecast.forecast_id] = forecast
        self._pending.append(forecast.forecast_id)
        
        log.info("Recorded forecast: %s (%s %s %s, score=%d)",
                forecast.forecast_id, symbol, direction, timeframe, score)
        
        return forecast
    
    def resolve_forecast(self, forecast_id: str, outcome: bool, 
                        r_multiple: float, exit_price: float,
                        exit_reason: str, mfe_r: float = 0.0,
                        mae_r: float = 0.0, holding_bars: int = 0,
                        holding_time_seconds: float = 0.0,
                        fees: float = 0.0, spread: float = 0.0,
                        slippage: float = 0.0) -> Optional[ForecastOutcome]:
        """Resolve a forecast with its outcome."""
        
        if forecast_id not in self._forecasts:
            log.warning("Forecast not found: %s", forecast_id)
            return None
        
        forecast = self._forecasts[forecast_id]
        
        # Create outcome
        outcome_obj = ForecastOutcome(
            forecast_id=forecast_id,
            outcome=outcome,
            r_multiple=r_multiple,
            mfe_r=mfe_r,
            mae_r=mae_r,
            exit_price=exit_price,
            exit_reason=exit_reason,
            holding_bars=holding_bars,
            holding_time_seconds=holding_time_seconds,
            fees=fees,
            spread=spread,
            slippage=slippage,
        )
        
        # Update forecast
        forecast.outcome = outcome_obj
        forecast.resolved_at = time.time()
        
        if outcome:
            forecast.status = ForecastStatus.RESOLVED_WIN
        elif r_multiple == 0:
            forecast.status = ForecastStatus.RESOLVED_BREAKEVEN
        else:
            forecast.status = ForecastStatus.RESOLVED_LOSS
        
        # Move from pending to resolved
        if forecast_id in self._pending:
            self._pending.remove(forecast_id)
        self._resolved.append(forecast_id)
        
        log.info("Resolved forecast: %s (%s, %.2fR)",
                forecast_id, "WIN" if outcome else "LOSS", r_multiple)
        
        return outcome_obj
    
    def get_forecast(self, forecast_id: str) -> Optional[ForwardForecast]:
        """Get a forecast by ID."""
        return self._forecasts.get(forecast_id)
    
    def get_pending_forecasts(self) -> List[ForwardForecast]:
        """Get all pending forecasts."""
        return [self._forecasts[fid] for fid in self._pending 
                if fid in self._forecasts]
    
    def get_resolved_forecasts(self) -> List[ForwardForecast]:
        """Get all resolved forecasts."""
        return [self._forecasts[fid] for fid in self._resolved
                if fid in self._forecasts]
    
    def get_statistics(self) -> dict:
        """Get validation statistics."""
        resolved = self.get_resolved_forecasts()
        
        if not resolved:
            return {
                'total_forecasts': len(self._forecasts),
                'pending': len(self._pending),
                'resolved': 0,
                'wins': 0,
                'losses': 0,
                'breakevens': 0,
                'win_rate': 0,
                'avg_r': 0,
                'expectancy': 0,
                'profit_factor': 0,
            }
        
        wins = sum(1 for f in resolved if f.status == ForecastStatus.RESOLVED_WIN)
        losses = sum(1 for f in resolved if f.status == ForecastStatus.RESOLVED_LOSS)
        breakevens = sum(1 for f in resolved if f.status == ForecastStatus.RESOLVED_BREAKEVEN)
        
        r_multiples = [f.outcome.r_multiple for f in resolved if f.outcome]
        avg_r = sum(r_multiples) / len(r_multiples) if r_multiples else 0
        
        gross_profit = sum(r for r in r_multiples if r > 0)
        gross_loss = abs(sum(r for r in r_multiples if r < 0))
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else float('inf')
        
        return {
            'total_forecasts': len(self._forecasts),
            'pending': len(self._pending),
            'resolved': len(resolved),
            'wins': wins,
            'losses': losses,
            'breakevens': breakevens,
            'win_rate': wins / len(resolved) if resolved else 0,
            'avg_r': avg_r,
            'expectancy': avg_r,  # Expectancy = average R
            'profit_factor': profit_factor,
        }
    
    def _generate_fingerprint(self, symbol: str, timeframe: str, 
                              direction: str, entry: float, stop: float,
                              target: float) -> str:
        """Generate a unique fingerprint for a forecast."""
        import hashlib
        data = f"{symbol}:{timeframe}:{direction}:{entry}:{stop}:{target}"
        return hashlib.sha256(data.encode()).hexdigest()[:16]
