"""
Autonomy Configuration for Confluence X.

Defines system modes, instrument universe, and operational parameters.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional


class AutonomyMode(Enum):
    """System autonomy modes."""
    INTELLIGENCE = 'intelligence'  # Monitor, analyze, alert only
    PAPER_TRADING = 'paper'        # Simulated execution
    LIVE_TRADING = 'live'          # Real broker execution (requires explicit enable)


class AssetClass(Enum):
    """Asset classes for instrument classification."""
    FOREX = 'forex'
    METALS = 'metals'
    CRYPTO = 'crypto'
    INDICES = 'indices'
    STOCKS = 'stocks'


@dataclass
class InstrumentConfig:
    """Configuration for a single instrument."""
    symbol: str
    asset_class: AssetClass
    pip_size: float  # Minimum price movement
    pip_value_per_lot: float  # USD value per pip per lot
    tick_size: float  # Minimum tick size
    typical_spread_pips: float  # Average spread
    trading_hours_utc: tuple[int, int] = (0, 24)  # Default: 24h
    enabled: bool = True


# Default instrument universe
DEFAULT_INSTRUMENTS: Dict[str, InstrumentConfig] = {
    # Forex Majors
    'EURUSD': InstrumentConfig('EURUSD', AssetClass.FOREX, 0.0001, 10.0, 0.0001, 1.0),
    'GBPUSD': InstrumentConfig('GBPUSD', AssetClass.FOREX, 0.0001, 10.0, 0.0001, 1.5),
    'USDJPY': InstrumentConfig('USDJPY', AssetClass.FOREX, 0.01, 6.67, 0.01, 1.0),
    'AUDUSD': InstrumentConfig('AUDUSD', AssetClass.FOREX, 0.0001, 10.0, 0.0001, 1.2),
    'USDCAD': InstrumentConfig('USDCAD', AssetClass.FOREX, 0.0001, 7.5, 0.0001, 1.5),
    'USDCHF': InstrumentConfig('USDCHF', AssetClass.FOREX, 0.0001, 11.0, 0.0001, 1.5),
    'NZDUSD': InstrumentConfig('NZDUSD', AssetClass.FOREX, 0.0001, 10.0, 0.0001, 2.0),
    # Metals
    'XAUUSD': InstrumentConfig('XAUUSD', AssetClass.METALS, 0.10, 1.0, 0.10, 3.0),
    'XAGUSD': InstrumentConfig('XAGUSD', AssetClass.METALS, 0.01, 50.0, 0.01, 5.0),
    # Crypto
    'BTCUSD': InstrumentConfig('BTCUSD', AssetClass.CRYPTO, 1.0, 0.01, 1.0, 10.0),
    'ETHUSD': InstrumentConfig('ETHUSD', AssetClass.CRYPTO, 0.01, 1.0, 0.01, 5.0),
    # Indices
    'US30': InstrumentConfig('US30', AssetClass.INDICES, 1.0, 1.0, 1.0, 2.0),
    'NAS100': InstrumentConfig('NAS100', AssetClass.INDICES, 0.1, 1.0, 0.1, 2.0),
    'SPX500': InstrumentConfig('SPX500', AssetClass.INDICES, 0.1, 1.0, 0.1, 2.0),
}


@dataclass
class RiskPolicy:
    """Account-level risk policy."""
    max_risk_per_trade_pct: float = 1.0
    max_daily_loss_pct: float = 3.0
    max_weekly_loss_pct: float = 6.0
    max_open_positions: int = 5
    max_total_risk_pct: float = 10.0
    max_symbol_exposure_pct: float = 3.0
    max_asset_class_exposure_pct: float = 6.0
    max_correlated_exposure_pct: float = 8.0
    max_consecutive_losses: int = 5
    max_spread_pips: float = 5.0
    max_slippage_pips: float = 2.0
    
    # Drawdown guards (configurable)
    daily_dd_normal_pct: float = 2.0
    daily_dd_reduced_pct: float = 3.0
    daily_dd_blocked_pct: float = 4.0
    daily_dd_kill_switch_pct: float = 5.0


@dataclass
class NewsPolicy:
    """News/economic event trading policy."""
    high_impact_pre_event_minutes: int = 15
    high_impact_post_event_minutes: int = 10
    medium_impact_pre_event_minutes: int = 5
    medium_impact_post_event_minutes: int = 5
    block_on_critical: bool = True
    cooldown_after_news_minutes: int = 5


@dataclass
class ScannerPolicy:
    """Scanner operational policy."""
    scan_interval_seconds: int = 300  # 5 minutes
    strong_threshold: int = 65
    good_threshold: int = 50
    watchlist_threshold: int = 35
    max_alerts_per_hour: int = 10
    alert_deduplication_minutes: int = 60


@dataclass
class AutonomyConfig:
    """Complete autonomy configuration."""
    # Mode
    mode: AutonomyMode = AutonomyMode.INTELLIGENCE
    
    # Instrument universe
    instruments: Dict[str, InstrumentConfig] = field(default_factory=lambda: dict(DEFAULT_INSTRUMENTS))
    
    # Timeframes to analyze per instrument
    timeframes: List[str] = field(default_factory=lambda: ['D1', 'H4', 'H1', 'M15'])
    
    # Policies
    risk: RiskPolicy = field(default_factory=RiskPolicy)
    news: NewsPolicy = field(default_factory=NewsPolicy)
    scanner: ScannerPolicy = field(default_factory=ScannerPolicy)
    
    # Engine versions
    engine_version: str = '2.0.0-alpha'
    scoring_version: str = '1.0.0'
    strategy_version: str = '1.0.0'
    risk_policy_version: str = '1.0.0'
    
    @classmethod
    def from_env(cls) -> 'AutonomyConfig':
        """Load configuration from environment variables."""
        config = cls()
        
        # Mode
        mode_str = os.environ.get('AUTONOMY_MODE', 'intelligence').lower()
        try:
            config.mode = AutonomyMode(mode_str)
        except ValueError:
            config.mode = AutonomyMode.INTELLIGENCE
        
        # Scanner
        config.scanner.scan_interval_seconds = int(os.environ.get('SCAN_INTERVAL_SECONDS', '300'))
        config.scanner.strong_threshold = int(os.environ.get('STRONG_THRESHOLD', '65'))
        config.scanner.good_threshold = int(os.environ.get('GOOD_THRESHOLD', '50'))
        config.scanner.watchlist_threshold = int(os.environ.get('WATCHLIST_THRESHOLD', '35'))
        
        # Risk
        config.risk.max_risk_per_trade_pct = float(os.environ.get('MAX_RISK_PER_TRADE_PCT', '1.0'))
        config.risk.max_daily_loss_pct = float(os.environ.get('MAX_DAILY_LOSS_PCT', '3.0'))
        config.risk.max_open_positions = int(os.environ.get('MAX_OPEN_POSITIONS', '5'))
        
        # News
        config.news.high_impact_pre_event_minutes = int(os.environ.get('NEWS_HIGH_PRE_MINUTES', '15'))
        config.news.high_impact_post_event_minutes = int(os.environ.get('NEWS_HIGH_POST_MINUTES', '10'))
        
        return config
    
    def get_enabled_instruments(self) -> Dict[str, InstrumentConfig]:
        """Get only enabled instruments."""
        return {k: v for k, v in self.instruments.items() if v.enabled}
    
    def get_instruments_by_class(self, asset_class: AssetClass) -> Dict[str, InstrumentConfig]:
        """Get instruments filtered by asset class."""
        return {k: v for k, v in self.instruments.items() 
                if v.asset_class == asset_class and v.enabled}
    
    def is_live_trading_allowed(self) -> bool:
        """Check if live trading is explicitly enabled."""
        return (
            self.mode == AutonomyMode.LIVE_TRADING and
            os.environ.get('LIVE_TRADING_ENABLED', 'false').lower() == 'true' and
            os.environ.get('EXECUTION_MODE', 'paper').lower() == 'live'
        )


# Singleton
_config: Optional[AutonomyConfig] = None


def get_autonomy_config() -> AutonomyConfig:
    """Get or create the singleton AutonomyConfig."""
    global _config
    if _config is None:
        _config = AutonomyConfig.from_env()
    return _config
