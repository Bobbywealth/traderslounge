"""
Position Manager for Confluence X Paper Trading.

Manages position lifecycle including TP/SL, break-even, and trailing stops.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

log = logging.getLogger(__name__)


@dataclass
class PositionEvent:
    """A position management event."""
    position_id: str
    event_type: str  # tp1_hit, tp2_hit, sl_hit, be_moved, trailing_updated
    timestamp: float = field(default_factory=time.time)
    price: float = 0.0
    quantity_closed: float = 0.0
    pnl: float = 0.0
    metadata: dict = field(default_factory=dict)


@dataclass
class PositionConfig:
    """Position management configuration."""
    tp1_close_pct: float = 0.5  # Close 50% at TP1
    tp2_close_pct: float = 0.35  # Close 35% at TP2
    tp3_close_pct: float = 0.15  # Close remaining 15% at TP3
    move_sl_to_be_at_tp1: bool = True
    trailing_stop_activation_rr: float = 1.0  # Activate trailing at 1R
    trailing_stop_distance_pct: float = 0.5  # 0.5% trailing distance


class PaperPositionManager:
    """
    Position Manager.
    
    Manages position lifecycle including TP/SL, break-even, and trailing stops.
    """
    
    def __init__(self, config: Optional[PositionConfig] = None):
        self._config = config or PositionConfig()
        self._events: Dict[str, List[PositionEvent]] = {}
        self._callbacks: List[Callable] = []
    
    def register_callback(self, callback: Callable):
        """Register a callback for position events."""
        self._callbacks.append(callback)
    
    def check_position(self, position_id: str, current_price: float,
                       entry_price: float, stop_loss: float,
                       direction: str, quantity: float,
                       tp1: float = 0.0, tp2: float = 0.0, tp3: float = 0.0,
                       tp1_hit: bool = False, break_even_moved: bool = False,
                       original_quantity: float = 0.0) -> List[PositionEvent]:
        """Check position and generate events."""
        events = []
        
        # Check stop loss
        sl_event = self._check_stop_loss(
            position_id, current_price, entry_price, stop_loss, 
            direction, quantity
        )
        if sl_event:
            events.append(sl_event)
        
        # Check take profits
        tp_events = self._check_take_profits(
            position_id, current_price, entry_price, direction,
            quantity, tp1, tp2, tp3, tp1_hit, original_quantity
        )
        events.extend(tp_events)
        
        # Check break-even
        if not break_even_moved and tp1_hit:
            be_event = self._move_to_break_even(
                position_id, entry_price, direction
            )
            if be_event:
                events.append(be_event)
        
        # Check trailing stop activation
        if not tp1_hit:
            rr = self._calculate_rr(current_price, entry_price, stop_loss, direction)
            if rr >= self._config.trailing_stop_activation_rr:
                trailing_event = self._activate_trailing_stop(
                    position_id, current_price, direction
                )
                if trailing_event:
                    events.append(trailing_event)
        
        # Store events
        if position_id not in self._events:
            self._events[position_id] = []
        self._events[position_id].extend(events)
        
        # Emit events
        for event in events:
            self._emit_event(event)
        
        return events
    
    def _check_stop_loss(self, position_id: str, current_price: float,
                         entry_price: float, stop_loss: float,
                         direction: str, quantity: float) -> Optional[PositionEvent]:
        """Check if stop loss is hit."""
        if stop_loss <= 0:
            return None
        
        if direction == 'BUY' and current_price <= stop_loss:
            pnl = (current_price - entry_price) * quantity
            return PositionEvent(
                position_id=position_id,
                event_type='sl_hit',
                price=current_price,
                quantity_closed=quantity,
                pnl=pnl,
                metadata={'stop_loss': stop_loss},
            )
        
        elif direction == 'SELL' and current_price >= stop_loss:
            pnl = (entry_price - current_price) * quantity
            return PositionEvent(
                position_id=position_id,
                event_type='sl_hit',
                price=current_price,
                quantity_closed=quantity,
                pnl=pnl,
                metadata={'stop_loss': stop_loss},
            )
        
        return None
    
    def _check_take_profits(self, position_id: str, current_price: float,
                            entry_price: float, direction: str,
                            quantity: float, tp1: float, tp2: float, tp3: float,
                            tp1_hit: bool, original_quantity: float) -> List[PositionEvent]:
        """Check take profit levels."""
        events = []
        
        # TP1
        if not tp1_hit and tp1 > 0:
            if direction == 'BUY' and current_price >= tp1:
                close_qty = original_quantity * self._config.tp1_close_pct
                pnl = (tp1 - entry_price) * close_qty
                events.append(PositionEvent(
                    position_id=position_id,
                    event_type='tp1_hit',
                    price=tp1,
                    quantity_closed=close_qty,
                    pnl=pnl,
                    metadata={'target': 'tp1'},
                ))
            
            elif direction == 'SELL' and current_price <= tp1:
                close_qty = original_quantity * self._config.tp1_close_pct
                pnl = (entry_price - tp1) * close_qty
                events.append(PositionEvent(
                    position_id=position_id,
                    event_type='tp1_hit',
                    price=tp1,
                    quantity_closed=close_qty,
                    pnl=pnl,
                    metadata={'target': 'tp1'},
                ))
        
        # TP2
        if tp1_hit and tp2 > 0:
            if direction == 'BUY' and current_price >= tp2:
                remaining = quantity - (original_quantity * self._config.tp1_close_pct)
                close_qty = remaining * (self._config.tp2_close_pct / (1 - self._config.tp1_close_pct))
                pnl = (tp2 - entry_price) * close_qty
                events.append(PositionEvent(
                    position_id=position_id,
                    event_type='tp2_hit',
                    price=tp2,
                    quantity_closed=close_qty,
                    pnl=pnl,
                    metadata={'target': 'tp2'},
                ))
            
            elif direction == 'SELL' and current_price <= tp2:
                remaining = quantity - (original_quantity * self._config.tp1_close_pct)
                close_qty = remaining * (self._config.tp2_close_pct / (1 - self._config.tp1_close_pct))
                pnl = (entry_price - tp2) * close_qty
                events.append(PositionEvent(
                    position_id=position_id,
                    event_type='tp2_hit',
                    price=tp2,
                    quantity_closed=close_qty,
                    pnl=pnl,
                    metadata={'target': 'tp2'},
                ))
        
        # TP3 (close remaining)
        if tp1_hit and tp3 > 0:
            if direction == 'BUY' and current_price >= tp3:
                remaining = quantity
                pnl = (tp3 - entry_price) * remaining
                events.append(PositionEvent(
                    position_id=position_id,
                    event_type='tp3_hit',
                    price=tp3,
                    quantity_closed=remaining,
                    pnl=pnl,
                    metadata={'target': 'tp3'},
                ))
            
            elif direction == 'SELL' and current_price <= tp3:
                remaining = quantity
                pnl = (entry_price - tp3) * remaining
                events.append(PositionEvent(
                    position_id=position_id,
                    event_type='tp3_hit',
                    price=tp3,
                    quantity_closed=remaining,
                    pnl=pnl,
                    metadata={'target': 'tp3'},
                ))
        
        return events
    
    def _move_to_break_even(self, position_id: str, entry_price: float,
                            direction: str) -> Optional[PositionEvent]:
        """Move stop loss to break-even."""
        return PositionEvent(
            position_id=position_id,
            event_type='be_moved',
            price=entry_price,
            metadata={'new_stop': entry_price},
        )
    
    def _activate_trailing_stop(self, position_id: str, current_price: float,
                                direction: str) -> Optional[PositionEvent]:
        """Activate trailing stop."""
        return PositionEvent(
            position_id=position_id,
            event_type='trailing_activated',
            price=current_price,
            metadata={'activation_price': current_price},
        )
    
    def _calculate_rr(self, current_price: float, entry_price: float,
                      stop_loss: float, direction: str) -> float:
        """Calculate current R multiple."""
        risk = abs(entry_price - stop_loss)
        if risk == 0:
            return 0.0
        
        if direction == 'BUY':
            return (current_price - entry_price) / risk
        else:
            return (entry_price - current_price) / risk
    
    def get_events(self, position_id: str) -> List[PositionEvent]:
        """Get all events for a position."""
        return self._events.get(position_id, [])
    
    def _emit_event(self, event: PositionEvent):
        """Emit event to all callbacks."""
        for callback in self._callbacks:
            try:
                callback(event)
            except Exception as e:
                log.error("Error in position manager callback: %s", e)
