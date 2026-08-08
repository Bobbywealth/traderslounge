"""
Sample Data Generator for Forward Validation.

Generates realistic sample data for validation testing.
"""
from __future__ import annotations

import random
import time
from typing import List

from .forward_engine import ForwardEngine, ForwardForecast


def generate_sample_forecasts(engine: ForwardEngine, count: int = 100) -> List[ForwardForecast]:
    """Generate sample forecasts for validation testing."""
    
    symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'BTCUSD']
    timeframes = ['H1', 'H4', 'D1']
    directions = ['BUY', 'SELL']
    sessions = ['asian', 'london', 'new_york', 'overlap']
    regimes = ['bull', 'bear', 'neutral', 'range']
    volatility = ['low', 'normal', 'high']
    
    forecasts = []
    
    for i in range(count):
        symbol = random.choice(symbols)
        timeframe = random.choice(timeframes)
        direction = random.choice(directions)
        
        # Generate realistic price levels
        if symbol == 'XAUUSD':
            entry = random.uniform(2300, 2400)
            stop_distance = random.uniform(5, 15)
            target_distance = random.uniform(10, 30)
        elif symbol == 'BTCUSD':
            entry = random.uniform(50000, 70000)
            stop_distance = random.uniform(500, 2000)
            target_distance = random.uniform(1000, 5000)
        else:
            entry = random.uniform(1.0, 1.5)
            stop_distance = random.uniform(0.005, 0.02)
            target_distance = random.uniform(0.01, 0.05)
        
        if direction == 'BUY':
            stop_loss = entry - stop_distance
            target_price = entry + target_distance
        else:
            stop_loss = entry + stop_distance
            target_price = entry - target_distance
        
        # Generate score components
        score = random.randint(40, 95)
        score_components = {
            'htf_bias': random.randint(0, 20),
            'market_structure': random.randint(0, 15),
            'momentum': random.randint(0, 10),
            'liquidity': random.randint(0, 10),
            'fibonacci': random.randint(0, 10),
            'session': random.randint(0, 10),
        }
        
        # Create forecast
        forecast = engine.record_forecast(
            symbol=symbol,
            timeframe=timeframe,
            direction=direction,
            entry_price=entry,
            stop_loss=stop_loss,
            target_price=target_price,
            score=score,
            score_components=score_components,
            setup_type='confluence',
            session=random.choice(sessions),
            volatility_regime=random.choice(volatility),
            market_regime=random.choice(regimes),
            engine_version='2.0.0-alpha',
            scoring_version='1.0.0',
            predicted_probability=0.4 + (score / 100) * 0.4,  # 0.4-0.8 based on score
            confidence_class='high' if score >= 80 else 'medium' if score >= 60 else 'low',
        )
        
        forecasts.append(forecast)
    
    return forecasts


def resolve_sample_forecasts(engine: ForwardEngine, 
                             forecasts: List[ForwardForecast],
                             win_rate: float = 0.55) -> int:
    """Resolve sample forecasts with realistic outcomes."""
    
    resolved_count = 0
    
    for forecast in forecasts:
        # Simulate outcome based on score and win rate
        score_factor = forecast.score / 100
        adjusted_win_rate = win_rate * (0.8 + score_factor * 0.4)
        
        outcome = random.random() < adjusted_win_rate
        
        if outcome:
            # Win: R multiple between 0.5 and 3.0
            r_multiple = random.uniform(0.5, 3.0)
            exit_price = forecast.target_price
            exit_reason = 'target'
        else:
            # Loss: R multiple between -1.0 and -0.2
            r_multiple = random.uniform(-1.0, -0.2)
            exit_price = forecast.stop_loss
            exit_reason = 'stop'
        
        # Calculate MFE and MAE
        if forecast.direction == 'BUY':
            mfe_r = abs(r_multiple) * random.uniform(1.0, 1.5)
            mae_r = abs(r_multiple) * random.uniform(0.3, 0.8)
        else:
            mfe_r = abs(r_multiple) * random.uniform(1.0, 1.5)
            mae_r = abs(r_multiple) * random.uniform(0.3, 0.8)
        
        # Resolve
        engine.resolve_forecast(
            forecast_id=forecast.forecast_id,
            outcome=outcome,
            r_multiple=r_multiple,
            exit_price=exit_price,
            exit_reason=exit_reason,
            mfe_r=mfe_r,
            mae_r=mae_r,
            holding_bars=random.randint(5, 50),
            holding_time_seconds=random.uniform(3600, 86400),
            fees=random.uniform(5, 15),
            spread=random.uniform(1, 3),
            slippage=random.uniform(0.5, 2),
        )
        
        resolved_count += 1
    
    return resolved_count
