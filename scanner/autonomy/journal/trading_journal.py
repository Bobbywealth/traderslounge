"""
Trading Journal for Confluence X.

Records every setup's complete history from detection to resolution.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

log = logging.getLogger(__name__)


@dataclass
class JournalEntry:
    """A complete journal entry for a setup."""
    # Identity
    setup_id: str
    symbol: str
    asset_class: str
    direction: str
    timeframe: str
    strategy_type: str
    engine_version: str
    
    # Timestamps
    detected_at: float = 0.0
    triggered_at: Optional[float] = None
    entry_at: Optional[float] = None
    closed_at: Optional[float] = None
    
    # Analysis
    score: int = 0
    score_components: Dict[str, int] = field(default_factory=dict)
    market_regime: str = ''
    session: str = ''
    news_state: str = ''
    data_quality: str = ''
    
    # Trade levels
    entry_price: float = 0.0
    stop_loss: float = 0.0
    tp1: float = 0.0
    tp2: float = 0.0
    tp3: float = 0.0
    
    # Execution
    actual_entry: float = 0.0
    actual_exit: float = 0.0
    lot_size: float = 0.0
    fees: float = 0.0
    spread: float = 0.0
    slippage: float = 0.0
    
    # Outcome
    outcome: str = ''  # win, loss, breakeven, expired, invalidated
    r_multiple: float = 0.0
    pnl_usd: float = 0.0
    
    # Excursion
    mfe_r: float = 0.0  # Maximum favorable excursion
    mae_r: float = 0.0  # Maximum adverse excursion
    
    # Exit details
    exit_reason: str = ''  # tp1, tp2, tp3, stop, expired, manual
    holding_bars: int = 0
    holding_time_seconds: float = 0.0
    
    # Reasons
    technical_reasons: List[str] = field(default_factory=list)
    macro_reasons: List[str] = field(default_factory=list)
    risk_reasons: List[str] = field(default_factory=list)
    
    # State history
    state_history: List[dict] = field(default_factory=list)


class TradingJournal:
    """
    Trading Journal.
    
    Records every setup's complete history from detection to resolution.
    """
    
    def __init__(self):
        self._entries: Dict[str, JournalEntry] = {}
        self._symbol_index: Dict[str, List[str]] = {}  # symbol -> [setup_ids]
        self._date_index: Dict[str, List[str]] = {}  # date -> [setup_ids]
    
    def create_entry(self, setup_id: str, symbol: str, asset_class: str,
                     direction: str, timeframe: str, strategy_type: str,
                     engine_version: str, **kwargs) -> JournalEntry:
        """Create a new journal entry."""
        entry = JournalEntry(
            setup_id=setup_id,
            symbol=symbol,
            asset_class=asset_class,
            direction=direction,
            timeframe=timeframe,
            strategy_type=strategy_type,
            engine_version=engine_version,
            detected_at=time.time(),
            **kwargs,
        )
        
        self._entries[setup_id] = entry
        
        # Update indexes
        if symbol not in self._symbol_index:
            self._symbol_index[symbol] = []
        self._symbol_index[symbol].append(setup_id)
        
        date_str = time.strftime('%Y-%m-%d')
        if date_str not in self._date_index:
            self._date_index[date_str] = []
        self._date_index[date_str].append(setup_id)
        
        log.info("Journal entry created: %s (%s %s)", setup_id, symbol, direction)
        
        return entry
    
    def record_state_change(self, setup_id: str, new_state: str, 
                           reason: str = '', **metadata):
        """Record a state change."""
        if setup_id not in self._entries:
            log.warning("Journal entry not found: %s", setup_id)
            return
        
        entry = self._entries[setup_id]
        entry.state_history.append({
            'state': new_state,
            'timestamp': time.time(),
            'reason': reason,
            'metadata': metadata,
        })
    
    def record_entry(self, setup_id: str, entry_price: float, 
                    lot_size: float, fees: float = 0.0, 
                    spread: float = 0.0, slippage: float = 0.0):
        """Record trade entry."""
        if setup_id not in self._entries:
            log.warning("Journal entry not found: %s", setup_id)
            return
        
        entry = self._entries[setup_id]
        entry.entry_at = time.time()
        entry.actual_entry = entry_price
        entry.lot_size = lot_size
        entry.fees = fees
        entry.spread = spread
        entry.slippage = slippage
        
        log.info("Journal entry recorded: %s entered at %.5f", setup_id, entry_price)
    
    def record_exit(self, setup_id: str, exit_price: float, 
                   exit_reason: str, r_multiple: float, pnl_usd: float,
                   mfe_r: float = 0.0, mae_r: float = 0.0,
                   holding_bars: int = 0):
        """Record trade exit."""
        if setup_id not in self._entries:
            log.warning("Journal entry not found: %s", setup_id)
            return
        
        entry = self._entries[setup_id]
        entry.closed_at = time.time()
        entry.actual_exit = exit_price
        entry.exit_reason = exit_reason
        entry.r_multiple = r_multiple
        entry.pnl_usd = pnl_usd
        entry.mfe_r = mfe_r
        entry.mae_r = mae_r
        entry.holding_bars = holding_bars
        
        # Determine outcome
        if r_multiple > 0:
            entry.outcome = 'win'
        elif r_multiple < 0:
            entry.outcome = 'loss'
        else:
            entry.outcome = 'breakeven'
        
        # Calculate holding time
        if entry.entry_at:
            entry.holding_time_seconds = entry.closed_at - entry.entry_at
        
        log.info("Journal entry closed: %s (%s, %.2fR, $%.2f)", 
                setup_id, entry.outcome, r_multiple, pnl_usd)
    
    def get_entry(self, setup_id: str) -> Optional[JournalEntry]:
        """Get a journal entry by setup ID."""
        return self._entries.get(setup_id)
    
    def get_entries_by_symbol(self, symbol: str) -> List[JournalEntry]:
        """Get all journal entries for a symbol."""
        setup_ids = self._symbol_index.get(symbol, [])
        return [self._entries[sid] for sid in setup_ids if sid in self._entries]
    
    def get_entries_by_date(self, date_str: str) -> List[JournalEntry]:
        """Get all journal entries for a date (YYYY-MM-DD)."""
        setup_ids = self._date_index.get(date_str, [])
        return [self._entries[sid] for sid in setup_ids if sid in self._entries]
    
    def get_closed_entries(self) -> List[JournalEntry]:
        """Get all closed journal entries."""
        return [e for e in self._entries.values() if e.closed_at is not None]
    
    def get_stats(self, symbol: Optional[str] = None) -> dict:
        """Get journal statistics."""
        if symbol:
            entries = self.get_entries_by_symbol(symbol)
        else:
            entries = list(self._entries.values())
        
        closed = [e for e in entries if e.closed_at is not None]
        
        if not closed:
            return {
                'total': len(entries),
                'closed': 0,
                'open': len(entries),
                'wins': 0,
                'losses': 0,
                'win_rate': 0,
                'avg_r': 0,
                'total_pnl': 0,
                'profit_factor': 0,
            }
        
        wins = sum(1 for e in closed if e.outcome == 'win')
        losses = sum(1 for e in closed if e.outcome == 'loss')
        total_pnl = sum(e.pnl_usd for e in closed)
        
        gross_profit = sum(e.pnl_usd for e in closed if e.pnl_usd > 0)
        gross_loss = abs(sum(e.pnl_usd for e in closed if e.pnl_usd < 0))
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else float('inf')
        
        return {
            'total': len(entries),
            'closed': len(closed),
            'open': len(entries) - len(closed),
            'wins': wins,
            'losses': losses,
            'win_rate': wins / len(closed) if closed else 0,
            'avg_r': sum(e.r_multiple for e in closed) / len(closed) if closed else 0,
            'total_pnl': total_pnl,
            'profit_factor': profit_factor,
        }
    
    def to_dict(self, setup_id: str) -> Optional[dict]:
        """Convert a journal entry to dictionary."""
        entry = self._entries.get(setup_id)
        if not entry:
            return None
        
        return {
            'setup_id': entry.setup_id,
            'symbol': entry.symbol,
            'asset_class': entry.asset_class,
            'direction': entry.direction,
            'timeframe': entry.timeframe,
            'strategy_type': entry.strategy_type,
            'engine_version': entry.engine_version,
            'detected_at': entry.detected_at,
            'triggered_at': entry.triggered_at,
            'entry_at': entry.entry_at,
            'closed_at': entry.closed_at,
            'score': entry.score,
            'score_components': entry.score_components,
            'market_regime': entry.market_regime,
            'session': entry.session,
            'news_state': entry.news_state,
            'data_quality': entry.data_quality,
            'entry_price': entry.entry_price,
            'stop_loss': entry.stop_loss,
            'tp1': entry.tp1,
            'tp2': entry.tp2,
            'tp3': entry.tp3,
            'actual_entry': entry.actual_entry,
            'actual_exit': entry.actual_exit,
            'lot_size': entry.lot_size,
            'fees': entry.fees,
            'spread': entry.spread,
            'slippage': entry.slippage,
            'outcome': entry.outcome,
            'r_multiple': entry.r_multiple,
            'pnl_usd': entry.pnl_usd,
            'mfe_r': entry.mfe_r,
            'mae_r': entry.mae_r,
            'exit_reason': entry.exit_reason,
            'holding_bars': entry.holding_bars,
            'holding_time_seconds': entry.holding_time_seconds,
            'technical_reasons': entry.technical_reasons,
            'macro_reasons': entry.macro_reasons,
            'risk_reasons': entry.risk_reasons,
            'state_history': entry.state_history,
        }
