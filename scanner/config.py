"""Scanner runtime config — env-var driven."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import List


@dataclass
class Config:
    twelve_data_api_key: str = ""
    # Twelve Data free tier caps at 8 requests/minute. Override upward after
    # upgrading the plan so the client rate limiter stops throttling.
    twelve_data_rpm: int = 8
    pairs: List[str] = field(default_factory=lambda: [
        # Forex majors + gold (Twelve Data) — lean free-tier default.
        # Indices (NAS100, US30) and crosses (GBPJPY) are supported in
        # SYMBOL_MAP; add them via SCANNER_PAIRS once the data budget allows.
        "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD", "XAUUSD",
        # Crypto (Binance) — spec §1.1
        "BTCUSD", "ETHUSD", "XRPUSD", "LTCUSD", "DOTUSD", "XLMUSD", "BATUSD", "NEOUSD",
    ])
    # Seconds between full scans of all pairs.
    scan_interval_seconds: int = 300  # 5 minutes
    # Per-tier score thresholds (mirror spec §2.1; tweakable via env)
    strong_threshold: int = 65
    good_threshold: int = 50
    watchlist_threshold: int = 35
    # News blackout: skip scans for any pair within N minutes of a red event.
    news_blackout_minutes: int = 15
    log_level: str = "INFO"


def load_from_env() -> Config:
    c = Config()
    c.twelve_data_api_key = os.environ.get("TWELVE_DATA_API_KEY", "")
    if env_pairs := os.environ.get("SCANNER_PAIRS"):
        c.pairs = [p.strip().upper() for p in env_pairs.split(",") if p.strip()]
    if v := os.environ.get("SCAN_INTERVAL_SECONDS"):
        c.scan_interval_seconds = int(v)
    if v := os.environ.get("STRONG_THRESHOLD"):
        c.strong_threshold = int(v)
    if v := os.environ.get("GOOD_THRESHOLD"):
        c.good_threshold = int(v)
    if v := os.environ.get("WATCHLIST_THRESHOLD"):
        c.watchlist_threshold = int(v)
    if v := os.environ.get("TWELVE_DATA_RPM"):
        c.twelve_data_rpm = int(v)
    if v := os.environ.get("NEWS_BLACKOUT_MINUTES"):
        c.news_blackout_minutes = int(v)
    if v := os.environ.get("LOG_LEVEL"):
        c.log_level = v.upper()
    return c
