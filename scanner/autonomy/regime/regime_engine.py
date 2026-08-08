"""
Market Regime Engine for Confluence X.

Classifies market conditions into regimes for trading decisions.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional

log = logging.getLogger(__name__)


class MarketRegime(Enum):
    """Market regime classifications."""
    STRONG_BULL = 'strong_bull'
    BULL = 'bull'
    NEUTRAL = 'neutral'
    BEAR = 'bear'
    STRONG_BEAR = 'strong_bear'
    RANGE = 'range'
    BREAKOUT = 'breakout'
    HIGH_VOLATILITY = 'high_volatility'
    LOW_VOLATILITY = 'low_volatility'
    NEWS_DISLOCATION = 'news_dislocation'


@dataclass
class RegimeSnapshot:
    """A market regime snapshot for a symbol."""
    symbol: str
    timestamp: float = field(default_factory=time.time)
    engine_version: str = '2.0.0-alpha'
    
    # Regime classification
    macro_direction: str = 'neutral'  # bullish, bearish, neutral
    regime: MarketRegime = MarketRegime.NEUTRAL
    strength: float = 0.0  # 0-100
    volatility_regime: str = 'normal'  # low, normal, high
    confidence: float = 0.5  # 0-1
    
    # Analysis components
    reasons: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    
    # Timeframe alignment
    monthly_trend: str = ''
    weekly_trend: str = ''
    daily_trend: str = ''
    h4_trend: str = ''
    h1_trend: str = ''
    
    # Key levels
    key_support: List[float] = field(default_factory=list)
    key_resistance: List[float] = field(default_factory=list)
    
    # Volatility
    atr: float = 0.0
    atr_percent: float = 0.0
    
    def to_dict(self) -> dict:
        return {
            'symbol': self.symbol,
            'timestamp': self.timestamp,
            'engine_version': self.engine_version,
            'macro_direction': self.macro_direction,
            'regime': self.regime.value,
            'strength': self.strength,
            'volatility_regime': self.volatility_regime,
            'confidence': self.confidence,
            'reasons': self.reasons,
            'warnings': self.warnings,
            'trends': {
                'monthly': self.monthly_trend,
                'weekly': self.weekly_trend,
                'daily': self.daily_trend,
                'h4': self.h4_trend,
                'h1': self.h1_trend,
            },
            'key_support': self.key_support,
            'key_resistance': self.key_resistance,
            'atr': self.atr,
            'atr_percent': self.atr_percent,
        }


class RegimeEngine:
    """
    Market Regime Engine.
    
    Classifies market conditions into regimes for trading decisions.
    """
    
    def __init__(self):
        self._snapshots: Dict[str, RegimeSnapshot] = {}
        self._history: Dict[str, List[RegimeSnapshot]] = {}
    
    def analyze(self, symbol: str,
                htf_bias: int = 0,
                market_structure: str = '',
                adx: float = 0.0,
                atr: float = 0.0,
                current_price: float = 0.0,
                ema_20: float = 0.0,
                ema_50: float = 0.0,
                rsi: float = 50.0,
                **kwargs) -> RegimeSnapshot:
        """Analyze and classify market regime for a symbol."""
        
        # Calculate trend strength from HTF bias
        # HTF bias ranges from -80 to +80 (from scoring engine)
        trend_strength = abs(htf_bias)
        
        # Determine macro direction
        if htf_bias > 20:
            macro_direction = 'bullish'
        elif htf_bias < -20:
            macro_direction = 'bearish'
        else:
            macro_direction = 'neutral'
        
        # Determine regime
        regime = self._classify_regime(
            htf_bias=htf_bias,
            adx=adx,
            atr=atr,
            current_price=current_price,
            ema_20=ema_20,
            ema_50=ema_50,
            rsi=rsi,
        )
        
        # Determine volatility regime
        volatility_regime = self._classify_volatility(atr, current_price)
        
        # Calculate confidence
        confidence = self._calculate_confidence(
            htf_bias=htf_bias,
            adx=adx,
            trend_strength=trend_strength,
        )
        
        # Generate reasons
        reasons = self._generate_reasons(
            macro_direction=macro_direction,
            regime=regime,
            htf_bias=htf_bias,
            adx=adx,
            rsi=rsi,
        )
        
        # Create snapshot
        snapshot = RegimeSnapshot(
            symbol=symbol,
            macro_direction=macro_direction,
            regime=regime,
            strength=trend_strength,
            volatility_regime=volatility_regime,
            confidence=confidence,
            reasons=reasons,
            atr=atr,
            atr_percent=(atr / current_price * 100) if current_price > 0 else 0,
        )
        
        # Store snapshot
        self._snapshots[symbol] = snapshot
        
        # Store in history
        if symbol not in self._history:
            self._history[symbol] = []
        self._history[symbol].append(snapshot)
        
        # Keep only last 100 snapshots
        if len(self._history[symbol]) > 100:
            self._history[symbol] = self._history[symbol][-100:]
        
        return snapshot
    
    def _classify_regime(self, htf_bias: float, adx: float, atr: float,
                         current_price: float, ema_20: float, ema_50: float,
                         rsi: float) -> MarketRegime:
        """Classify market regime based on indicators."""
        
        # Strong trend (high ADX + strong bias)
        if adx > 25 and abs(htf_bias) > 40:
            if htf_bias > 0:
                return MarketRegime.STRONG_BULL
            else:
                return MarketRegime.STRONG_BEAR
        
        # Moderate trend
        if adx > 20 and abs(htf_bias) > 20:
            if htf_bias > 0:
                return MarketRegime.BULL
            else:
                return MarketRegime.BEAR
        
        # Range-bound (low ADX)
        if adx < 20:
            return MarketRegime.RANGE
        
        # High volatility
        if current_price > 0 and atr / current_price > 0.02:
            return MarketRegime.HIGH_VOLATILITY
        
        # Low volatility
        if current_price > 0 and atr / current_price < 0.005:
            return MarketRegime.LOW_VOLATILITY
        
        # Default to neutral
        return MarketRegime.NEUTRAL
    
    def _classify_volatility(self, atr: float, current_price: float) -> str:
        """Classify volatility regime."""
        if current_price <= 0:
            return 'normal'
        
        atr_percent = (atr / current_price) * 100
        
        if atr_percent > 2.0:
            return 'high'
        elif atr_percent < 0.5:
            return 'low'
        else:
            return 'normal'
    
    def _calculate_confidence(self, htf_bias: float, adx: float,
                              trend_strength: float) -> float:
        """Calculate confidence in regime classification."""
        # Higher ADX and trend strength = higher confidence
        adx_score = min(adx / 50, 1.0)  # Normalize ADX to 0-1
        trend_score = min(trend_strength / 60, 1.0)  # Normalize trend to 0-1
        
        # Combine scores
        confidence = (adx_score * 0.6 + trend_score * 0.4)
        
        return round(confidence, 2)
    
    def _generate_reasons(self, macro_direction: str, regime: MarketRegime,
                          htf_bias: float, adx: float, rsi: float) -> List[str]:
        """Generate human-readable reasons for regime classification."""
        reasons = []
        
        # Direction
        if macro_direction == 'bullish':
            reasons.append(f'HTF bias bullish ({htf_bias:+.0f})')
        elif macro_direction == 'bearish':
            reasons.append(f'HTF bias bearish ({htf_bias:+.0f})')
        else:
            reasons.append(f'HTF bias neutral ({htf_bias:+.0f})')
        
        # ADX
        if adx > 25:
            reasons.append(f'Strong trend (ADX {adx:.1f})')
        elif adx > 20:
            reasons.append(f'Moderate trend (ADX {adx:.1f})')
        elif adx < 15:
            reasons.append(f'Weak trend (ADX {adx:.1f})')
        
        # RSI
        if rsi > 70:
            reasons.append(f'Overbought (RSI {rsi:.1f})')
        elif rsi < 30:
            reasons.append(f'Oversold (RSI {rsi:.1f})')
        
        # Regime
        reasons.append(f'Regime: {regime.value}')
        
        return reasons
    
    def get_snapshot(self, symbol: str) -> Optional[RegimeSnapshot]:
        """Get current regime snapshot for a symbol."""
        return self._snapshots.get(symbol)
    
    def get_history(self, symbol: str, limit: int = 10) -> List[RegimeSnapshot]:
        """Get regime history for a symbol."""
        history = self._history.get(symbol, [])
        return history[-limit:]
    
    def get_all_regimes(self) -> Dict[str, dict]:
        """Get current regime for all symbols."""
        return {
            symbol: snapshot.to_dict()
            for symbol, snapshot in self._snapshots.items()
        }
    
    def has_regime_changed(self, symbol: str) -> bool:
        """Check if regime has changed since last snapshot."""
        history = self._history.get(symbol, [])
        if len(history) < 2:
            return False
        
        return history[-1].regime != history[-2].regime
