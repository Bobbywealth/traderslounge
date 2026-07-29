from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
from enum import Enum

class ExitReason(str, Enum):
    TP1_HIT = 'tp1_hit'
    TP2_HIT = 'tp2_hit'
    TP3_HIT = 'tp3_hit'
    STOP_HIT = 'stop_hit'
    EXPIRED = 'expired'
    INVALIDATED = 'invalidated'
    AMBIGUOUS = 'ambiguous'

@dataclass
class ResolutionResult:
    setup_id: str
    snapshot_id: str
    entry_triggered: bool
    entry_time: Optional[str]
    entry_price: Optional[float]
    exit_reason: Optional[ExitReason]
    exit_time: Optional[str]
    exit_price: Optional[float]
    mfe: Optional[float]  # Maximum favorable excursion
    mae: Optional[float]  # Maximum adverse excursion
    r_result: Optional[float]  # Final R multiple
    holding_bars: int
    ambiguity_note: Optional[str] = None

class ForwardTestResolver:
    def __init__(self, market_client, ledger):
        self.market_client = market_client
        self.ledger = ledger
    
    def resolve_setup(
        self,
        setup: dict,
        entry_trigger_price: float,
        stop_price: float,
        tp1: float,
        tp2: float,
        tp3: float,
        direction: str,  # 'BUY' or 'SELL'
        timeframe: str = 'H1',
        max_bars: int = 24 * 4,  # Max 24 hours on H1
    ) -> ResolutionResult:
        """
        Walk forward from entry trigger to determine outcome.
        Uses conservative ambiguity handling.
        """
        bars = self.market_client.fetch_candles(
            setup['symbol'],
            timeframe,
            limit=max_bars
        )
        
        entry_found = False
        entry_bar_idx = None
        entry_price = None
        
        stop_hit = False
        tp_hit = None  # 1, 2, or 3
        highest_mfe = 0
        lowest_mae = 0
        
        for idx, bar in enumerate(bars):
            high, low, close = bar.high, bar.low, bar.close
            
            if not entry_found:
                # Check if entry triggered
                if direction == 'BUY' and close >= entry_trigger_price:
                    entry_found = True
                    entry_bar_idx = idx
                    entry_price = entry_trigger_price
                elif direction == 'SELL' and close <= entry_trigger_price:
                    entry_found = True
                    entry_bar_idx = idx
                    entry_price = entry_trigger_price
            
            if entry_found:
                # Track MFE and MAE
                if direction == 'BUY':
                    mfe = (high - entry_price) / (stop_price - entry_price) if entry_price > stop_price else 0
                    mae = (entry_price - low) / (entry_price - stop_price) if entry_price > stop_price else 0
                else:
                    mfe = (entry_price - low) / (entry_price - stop_price) if entry_price < stop_price else 0
                    mae = (high - entry_price) / (entry_price - stop_price) if entry_price < stop_price else 0
                
                highest_mfe = max(highest_mfe, mfe)
                lowest_mae = min(lowest_mae, mae)
                
                # Check exit conditions
                if direction == 'BUY':
                    if low <= stop_price:
                        stop_hit = True
                        break
                    if high >= tp3:
                        tp_hit = 3
                        break
                    if high >= tp2:
                        tp_hit = 2
                        break
                    if high >= tp1:
                        tp_hit = 1
                        break
                else:  # SELL
                    if high >= stop_price:
                        stop_hit = True
                        break
                    if low <= tp3:
                        tp_hit = 3
                        break
                    if low <= tp2:
                        tp_hit = 2
                        break
                    if low <= tp1:
                        tp_hit = 1
                        break
        
        # Determine final result
        if not entry_found:
            return ResolutionResult(
                setup_id=setup['id'],
                snapshot_id=setup['snapshot_id'],
                entry_triggered=False,
                entry_time=None,
                entry_price=None,
                exit_reason=ExitReason.EXPIRED,
                exit_time=None,
                exit_price=None,
                mfe=None,
                mae=None,
                r_result=None,
                holding_bars=0,
                ambiguity_note='Entry trigger not reached within max bars'
            )
        
        # Calculate R result
        if tp_hit:
            r_result = tp_hit * 1.0  # TP1=1R, TP2=2R, TP3=3R
            exit_reason = {
                1: ExitReason.TP1_HIT,
                2: ExitReason.TP2_HIT,
                3: ExitReason.TP3_HIT
            }[tp_hit]
        elif stop_hit:
            r_result = -1.0  # Stopped out = -1R
            exit_reason = ExitReason.STOP_HIT
        else:
            # Expired without hitting target or stop
            r_result = highest_mfe - 1.0  # Conservative: assume partial loss
            exit_reason = ExitReason.EXPIRED
        
        return ResolutionResult(
            setup_id=setup['id'],
            snapshot_id=setup['snapshot_id'],
            entry_triggered=True,
            entry_time=bars[entry_bar_idx].time.isoformat() if entry_bar_idx else None,
            entry_price=entry_price,
            exit_reason=exit_reason,
            exit_time=bars[entry_bar_idx + (tp_hit or 1) - 1].time.isoformat() if entry_bar_idx else None,
            exit_price=exit_price,
            mfe=highest_mfe,
            mae=lowest_mae,
            r_result=r_result,
            holding_bars=entry_bar_idx + (tp_hit or 1) if entry_bar_idx else 0
        )
