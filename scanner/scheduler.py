"""Scheduled scanner: fetch → score → emit, for the configured pair list.

Designed to run as a Render background worker. Step 2 emits signals to a
callable sink (default: log + stdout). Step 3 will wire the sink to
Telegram + Postgres.
"""
from __future__ import annotations

import datetime as _dt
import logging
import time
from dataclasses import dataclass
from typing import Callable, List, Optional, Protocol

from .config import Config
from .data_provider import DataProviderError, TwelveDataClient
from .news_filter import NewsFilter
from .scoring_engine import score
from .signal import Signal

log = logging.getLogger(__name__)

SignalSink = Callable[[Signal], None]


def stdout_sink(sig: Signal) -> None:
    print("=" * 60)
    print(sig.telegram_card())


@dataclass
class ScanResult:
    pair: str
    signal: Optional[Signal] = None
    error: Optional[str] = None
    blackout: Optional[str] = None


class Clock(Protocol):
    def now(self) -> _dt.datetime: ...
    def sleep(self, seconds: float) -> None: ...


class _SystemClock:
    def now(self) -> _dt.datetime:
        return _dt.datetime.now(_dt.timezone.utc)

    def sleep(self, seconds: float) -> None:
        time.sleep(seconds)


@dataclass
class Scanner:
    config: Config
    client: TwelveDataClient
    news: NewsFilter
    sink: SignalSink = stdout_sink
    clock: Clock = _SystemClock()
    # Tier minimum required to emit. Below this, the signal is logged but
    # not pushed to the sink.
    emit_threshold: int = 50

    def scan_once(self) -> List[ScanResult]:
        results: List[ScanResult] = []
        for pair in self.config.pairs:
            results.append(self._scan_pair(pair))
        return results

    def _scan_pair(self, pair: str) -> ScanResult:
        blackout = self.news.is_blacked_out(pair, self.clock.now())
        if blackout is not None:
            log.info("blackout for %s: %s", pair, blackout.title or blackout.impact)
            return ScanResult(pair=pair, blackout=blackout.title or blackout.impact)
        try:
            snap = self.client.fetch_snapshot(pair)
        except DataProviderError as exc:
            log.warning("data error for %s: %s", pair, exc)
            return ScanResult(pair=pair, error=str(exc))
        sig = score(snap)
        log.info("scanned %s → %s %d/80", pair, sig.tier.value, sig.confidence_score)
        if sig.confidence_score >= self.emit_threshold:
            self.sink(sig)
        return ScanResult(pair=pair, signal=sig)

    def run_forever(self) -> None:
        log.info("scanner starting: %d pairs, interval=%ds",
                 len(self.config.pairs), self.config.scan_interval_seconds)
        while True:
            started = time.monotonic()
            try:
                self.scan_once()
            except Exception:  # pragma: no cover — last-resort safety
                log.exception("scan_once crashed")
            elapsed = time.monotonic() - started
            sleep_for = max(1.0, self.config.scan_interval_seconds - elapsed)
            self.clock.sleep(sleep_for)
