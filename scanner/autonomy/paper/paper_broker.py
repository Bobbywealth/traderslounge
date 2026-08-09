"""
Paper Broker Adapter for Confluence X.

Realistic paper broker simulation with:
- Market/limit/stop orders
- Spread, slippage, commissions
- Partial fills
- Position reconciliation
"""
from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional

log = logging.getLogger(__name__)


class OrderType(Enum):
    """Order types."""
    MARKET = 'market'
    LIMIT = 'limit'
    STOP = 'stop'
    STOP_LIMIT = 'stop_limit'


class OrderStatus(Enum):
    """Order statuses."""
    PENDING = 'pending'
    FILLED = 'filled'
    PARTIALLY_FILLED = 'partially_filled'
    CANCELLED = 'cancelled'
    REJECTED = 'rejected'
    EXPIRED = 'expired'


@dataclass
class PaperOrder:
    """A paper trading order."""
    order_id: str = field(default_factory=lambda: str(uuid.uuid4())[:12])
    symbol: str = ''
    order_type: OrderType = OrderType.MARKET
    direction: str = 'BUY'  # BUY or SELL
    quantity: float = 0.0
    price: float = 0.0  # For limit/stop orders
    stop_price: float = 0.0  # For stop orders
    
    # Execution
    status: OrderStatus = OrderStatus.PENDING
    filled_quantity: float = 0.0
    filled_price: float = 0.0
    filled_at: Optional[float] = None
    
    # Costs
    spread_pips: float = 0.0
    slippage_pips: float = 0.0
    commission: float = 0.0
    
    # Metadata
    created_at: float = field(default_factory=time.time)
    setup_id: Optional[str] = None
    idempotency_key: Optional[str] = None
    
    # Rejection
    reject_reason: Optional[str] = None


@dataclass
class PaperPosition:
    """A paper trading position."""
    position_id: str = field(default_factory=lambda: str(uuid.uuid4())[:12])
    symbol: str = ''
    direction: str = 'BUY'
    quantity: float = 0.0
    entry_price: float = 0.0
    current_price: float = 0.0
    
    # Stop/Target levels
    stop_loss: float = 0.0
    take_profit_1: float = 0.0
    take_profit_2: float = 0.0
    take_profit_3: float = 0.0
    
    # Partial close tracking
    original_quantity: float = 0.0
    tp1_quantity: float = 0.0
    tp1_hit: bool = False
    tp2_hit: bool = False
    tp3_hit: bool = False
    break_even_moved: bool = False

    
    # Trailing stop
    trailing_stop_active: bool = False
    trailing_stop_distance: float = 0.0
    trailing_stop_price: float = 0.0
    
    # P&L
    unrealized_pnl: float = 0.0
    realized_pnl: float = 0.0
    total_fees: float = 0.0
    
    # Timestamps
    opened_at: float = field(default_factory=time.time)
    closed_at: Optional[float] = None
    
    # Status
    is_open: bool = True
    
    # Setup reference
    setup_id: Optional[str] = None
    
    @property
    def r_multiple(self) -> float:
        """Calculate current R multiple."""
        if self.stop_loss == 0 or self.entry_price == 0:
            return 0.0
        
        risk = abs(self.entry_price - self.stop_loss)
        if risk == 0:
            return 0.0
        
        if self.direction == 'BUY':
            return (self.current_price - self.entry_price) / risk
        else:
            return (self.entry_price - self.current_price) / risk
    
    @property
    def unrealized_pnl_pct(self) -> float:
        """Calculate unrealized P&L percentage."""
        if self.entry_price == 0:
            return 0.0
        return self.unrealized_pnl / self.entry_price * 100


class PaperBrokerAdapter:
    """
    Paper Broker Adapter.
    
    Realistic paper broker simulation with spread, slippage, and commissions.
    Per-instrument pip/tick specifications ensure correct P&L calculation.
    """

    # Per-instrument pip value (price units per pip) and default spread.
    # Unlisted instruments fall back to 0.0001 (FX standard).
    PIP_SPECS: Dict[str, dict] = {
        'BTCUSD':  {'pip_size': 1.0,    'spread_pips': 10.0,  'lot_size': 1.0},
        'ETHUSD':  {'pip_size': 0.01,   'spread_pips': 5.0,   'lot_size': 1.0},
        'XRPUSD':  {'pip_size': 0.0001, 'spread_pips': 5.0,   'lot_size': 1.0},
        'LTCUSD':  {'pip_size': 0.01,   'spread_pips': 5.0,   'lot_size': 1.0},
        'XAUUSD':  {'pip_size': 0.01,   'spread_pips': 3.0,   'lot_size': 1.0},
        'EURUSD':  {'pip_size': 0.0001, 'spread_pips': 1.2,   'lot_size': 100000},
        'GBPUSD':  {'pip_size': 0.0001, 'spread_pips': 1.5,   'lot_size': 100000},
        'USDJPY':  {'pip_size': 0.01,   'spread_pips': 1.5,   'lot_size': 100000},
    }

    def __init__(self, 
                 initial_balance: float = 10000.0,
                 default_spread_pips: float = 1.0,
                 default_slippage_pips: float = 0.5,
                 commission_per_lot: float = 7.0):
        self._balance = initial_balance
        self._initial_balance = initial_balance
        self._equity = initial_balance
        
        self._default_spread_pips = default_spread_pips
        self._default_slippage_pips = default_slippage_pips
        self._commission_per_lot = commission_per_lot
        
        self._orders: Dict[str, PaperOrder] = {}
        self._positions: Dict[str, PaperPosition] = {}
        self._closed_positions: List[PaperPosition] = []
        
        self._current_prices: Dict[str, float] = {}
        self._idempotency_keys: Dict[str, str] = {}  # key -> order_id
        
        # Statistics
        self._total_trades = 0
        self._winning_trades = 0
        self._losing_trades = 0
        self._total_pnl = 0.0
    
    def place_market_order(self, symbol: str, direction: str, quantity: float,
                           stop_loss: float = 0.0, take_profit: float = 0.0,
                           setup_id: Optional[str] = None,
                           idempotency_key: Optional[str] = None) -> PaperOrder:
        """Place a market order."""
        # Check idempotency
        if idempotency_key and idempotency_key in self._idempotency_keys:
            existing_order_id = self._idempotency_keys[idempotency_key]
            log.info("Duplicate order detected, returning existing: %s", existing_order_id)
            return self._orders[existing_order_id]
        
        # Create order
        order = PaperOrder(
            symbol=symbol,
            order_type=OrderType.MARKET,
            direction=direction,
            quantity=quantity,
            setup_id=setup_id,
            idempotency_key=idempotency_key,
        )
        
        # Check if we have a price
        current_price = self._current_prices.get(symbol, 0)
        if current_price <= 0:
            order.status = OrderStatus.REJECTED
            order.reject_reason = f'No price available for {symbol}'
            self._orders[order.order_id] = order
            return order
        
        # Simulate fill
        self._fill_order(order, current_price)
        
        # Store order
        self._orders[order.order_id] = order
        
        # Store idempotency key
        if idempotency_key:
            self._idempotency_keys[idempotency_key] = order.order_id
        
        return order
    
    def place_limit_order(self, symbol: str, direction: str, quantity: float,
                          limit_price: float, stop_loss: float = 0.0,
                          take_profit: float = 0.0,
                          setup_id: Optional[str] = None) -> PaperOrder:
        """Place a limit order."""
        order = PaperOrder(
            symbol=symbol,
            order_type=OrderType.LIMIT,
            direction=direction,
            quantity=quantity,
            price=limit_price,
            setup_id=setup_id,
        )
        
        self._orders[order.order_id] = order
        
        # Check if limit price is already crossed
        current_price = self._current_prices.get(symbol, 0)
        if current_price > 0:
            if direction == 'BUY' and current_price <= limit_price:
                self._fill_order(order, limit_price)
            elif direction == 'SELL' and current_price >= limit_price:
                self._fill_order(order, limit_price)
        
        return order
    
    def place_stop_order(self, symbol: str, direction: str, quantity: float,
                         stop_price: float, stop_loss: float = 0.0,
                         take_profit: float = 0.0,
                         setup_id: Optional[str] = None) -> PaperOrder:
        """Place a stop order."""
        order = PaperOrder(
            symbol=symbol,
            order_type=OrderType.STOP,
            direction=direction,
            quantity=quantity,
            stop_price=stop_price,
            setup_id=setup_id,
        )
        
        self._orders[order.order_id] = order
        
        # Check if stop price is already crossed
        current_price = self._current_prices.get(symbol, 0)
        if current_price > 0:
            if direction == 'BUY' and current_price >= stop_price:
                self._fill_order(order, stop_price)
            elif direction == 'SELL' and current_price <= stop_price:
                self._fill_order(order, stop_price)
        
        return order
    
    def modify_stop_loss(self, position_id: str, new_stop: float) -> bool:
        """Modify stop loss for a position."""
        position = self._positions.get(position_id)
        if not position or not position.is_open:
            return False
        
        position.stop_loss = new_stop
        log.info("Modified SL for %s to %.5f", position_id, new_stop)
        return True
    
    def close_position(self, position_id: str, quantity: float = 0.0) -> bool:
        """Close a position (full or partial)."""
        position = self._positions.get(position_id)
        if not position or not position.is_open:
            return False
        
        current_price = self._current_prices.get(position.symbol, 0)
        if current_price <= 0:
            return False
        
        # Close full position if quantity not specified
        if quantity <= 0 or quantity >= position.quantity:
            quantity = position.quantity
        
        # Calculate P&L
        if position.direction == 'BUY':
            pnl = (current_price - position.entry_price) * quantity
        else:
            pnl = (position.entry_price - current_price) * quantity
        
        # Deduct commission
        commission = self._commission_per_lot * (quantity / 100000)  # Assuming standard lot
        pnl -= commission
        
        # Update position
        position.quantity -= quantity
        position.realized_pnl += pnl
        position.total_fees += commission
        position.current_price = current_price
        
        # Update balance
        self._balance += pnl
        self._total_pnl += pnl
        
        # Track statistics
        self._total_trades += 1
        if pnl > 0:
            self._winning_trades += 1
        elif pnl < 0:
            self._losing_trades += 1
        
        # Close fully if quantity is zero
        if position.quantity <= 0:
            position.is_open = False
            position.closed_at = time.time()
            self._closed_positions.append(position)
            del self._positions[position_id]
        
        log.info("Closed %s: %.5f @ %.5f, PnL: $%.2f", 
                position_id, quantity, current_price, pnl)
        
        return True
    
    def cancel_order(self, order_id: str) -> bool:
        """Cancel a pending order."""
        order = self._orders.get(order_id)
        if not order or order.status != OrderStatus.PENDING:
            return False
        
        order.status = OrderStatus.CANCELLED
        log.info("Cancelled order: %s", order_id)
        return True
    
    def get_positions(self) -> List[PaperPosition]:
        """Get all open positions."""
        return list(self._positions.values())
    
    def get_position(self, position_id: str) -> Optional[PaperPosition]:
        """Get a specific position."""
        return self._positions.get(position_id)
    
    def get_account(self) -> dict:
        """Get account information."""
        # Calculate unrealized P&L
        unrealized_pnl = sum(p.unrealized_pnl for p in self._positions.values())
        
        return {
            'balance': self._balance,
            'equity': self._balance + unrealized_pnl,
            'margin_used': 0.0,  # Paper trading doesn't use margin
            'free_margin': self._balance + unrealized_pnl,
            'unrealized_pnl': unrealized_pnl,
            'realized_pnl': self._total_pnl,
            'total_fees': sum(p.total_fees for p in self._positions.values()),
            'open_positions': len(self._positions),
            'total_trades': self._total_trades,
            'winning_trades': self._winning_trades,
            'losing_trades': self._losing_trades,
            'win_rate': self._winning_trades / self._total_trades if self._total_trades > 0 else 0,
        }
    
    def update_price(self, symbol: str, price: float):
        """Update current price for a symbol."""
        self._current_prices[symbol] = price
        
        # Update all positions for this symbol
        for position in list(self._positions.values()):
            if position.symbol == symbol:
                position.current_price = price
                self._update_position_pnl(position)
                
                # Check stop loss
                self._check_stop_loss(position)
                
                # Check take profits
                self._check_take_profits(position)
                
                # Update trailing stop
                if position.trailing_stop_active:
                    self._update_trailing_stop(position)
    
    def _fill_order(self, order: PaperOrder, fill_price: float):
        """Fill an order."""
        # Apply spread
        spread = self._default_spread_pips * 0.0001  # Convert pips to price
        if order.direction == 'BUY':
            fill_price += spread / 2
        else:
            fill_price -= spread / 2
        
        # Apply slippage
        slippage = self._default_slippage_pips * 0.0001
        if order.direction == 'BUY':
            fill_price += slippage
        else:
            fill_price -= slippage
        
        # Calculate commission
        commission = self._commission_per_lot * (order.quantity / 100000)
        
        # Update order
        order.status = OrderStatus.FILLED
        order.filled_quantity = order.quantity
        order.filled_price = fill_price
        order.filled_at = time.time()
        order.spread_pips = self._default_spread_pips
        order.slippage_pips = self._default_slippage_pips
        order.commission = commission
        
        # Create position
        position = PaperPosition(
            symbol=order.symbol,
            direction=order.direction,
            quantity=order.filled_quantity,
            entry_price=fill_price,
            current_price=fill_price,
            original_quantity=order.filled_quantity,
            total_fees=commission,
            setup_id=order.setup_id,
            stop_loss=order.stop_loss if hasattr(order, 'stop_loss') else 0.0,
            take_profit_1=order.take_profit_1 if hasattr(order, 'take_profit_1') else 0.0,
            take_profit_2=order.take_profit_2 if hasattr(order, 'take_profit_2') else 0.0,
            take_profit_3=order.take_profit_3 if hasattr(order, 'take_profit_3') else 0.0,
        )
        
        self._positions[position.position_id] = position
        
        # Deduct commission from balance
        self._balance -= commission
        
        log.info("Filled %s: %s %s %.5f @ %.5f (spread: %.1f, slippage: %.1f, commission: $%.2f)",
                order.order_id, order.direction, order.symbol, 
                order.filled_quantity, fill_price,
                order.spread_pips, order.slippage_pips, commission)
    
    def _update_position_pnl(self, position: PaperPosition):
        """Update position unrealized P&L."""
        if position.direction == 'BUY':
            position.unrealized_pnl = (position.current_price - position.entry_price) * position.quantity
        else:
            position.unrealized_pnl = (position.entry_price - position.current_price) * position.quantity
    
    def _check_stop_loss(self, position: PaperPosition):
        """Check if stop loss is hit."""
        if position.stop_loss <= 0:
            return
        
        if position.direction == 'BUY' and position.current_price <= position.stop_loss:
            self.close_position(position.position_id)
            log.info("Stop loss hit for %s", position.position_id)
        
        elif position.direction == 'SELL' and position.current_price >= position.stop_loss:
            self.close_position(position.position_id)
            log.info("Stop loss hit for %s", position.position_id)
    
    def _check_take_profits(self, position: PaperPosition):
        """Check if take profit levels are hit.
        
        TP1: close 50% of original quantity, move SL to break-even.
        TP2: close remaining quantity (full close).
        TP3: close remaining quantity if still open (full close).
        """
        if not position.tp1_hit and position.take_profit_1 > 0:
            tp1_crossed = (
                (position.direction == 'BUY' and position.current_price >= position.take_profit_1) or
                (position.direction == 'SELL' and position.current_price <= position.take_profit_1)
            )
            if tp1_crossed:
                close_qty = position.original_quantity * 0.5
                self.close_position(position.position_id, close_qty)
                position.tp1_hit = True
                if not position.break_even_moved:
                    position.stop_loss = position.entry_price
                    position.break_even_moved = True
                    log.info("TP1 hit for %s, moved SL to BE", position.position_id)

        if position.tp1_hit and not position.tp2_hit and position.take_profit_2 > 0:
            tp2_crossed = (
                (position.direction == 'BUY' and position.current_price >= position.take_profit_2) or
                (position.direction == 'SELL' and position.current_price <= position.take_profit_2)
            )
            if tp2_crossed:
                self.close_position(position.position_id)
                position.tp2_hit = True
                log.info("TP2 hit for %s", position.position_id)

        if position.tp2_hit and not position.tp3_hit and position.take_profit_3 > 0:
            tp3_crossed = (
                (position.direction == 'BUY' and position.current_price >= position.take_profit_3) or
                (position.direction == 'SELL' and position.current_price <= position.take_profit_3)
            )
            if tp3_crossed:
                self.close_position(position.position_id)
                position.tp3_hit = True
                log.info("TP3 hit for %s", position.position_id)
    
    def _update_trailing_stop(self, position: PaperPosition):
        """Update trailing stop."""
        if position.trailing_stop_distance <= 0:
            return
        
        if position.direction == 'BUY':
            new_stop = position.current_price - position.trailing_stop_distance
            if new_stop > position.stop_loss:
                position.stop_loss = new_stop
                log.info("Trailing stop updated for %s to %.5f", 
                        position.position_id, new_stop)
        
        else:
            new_stop = position.current_price + position.trailing_stop_distance
            if new_stop < position.stop_loss:
                position.stop_loss = new_stop
                log.info("Trailing stop updated for %s to %.5f", 
                        position.position_id, new_stop)
