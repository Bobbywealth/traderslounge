"""Scheduled scanner: fetch → score → persist → emit, for the configured pair list.

Designed to run as a Render background worker. Every scanned signal is
written to the SignalRepository; signals at or above the emit threshold
are also pushed to the sink (stdout for now; Telegram in a later step).
News blackouts are refreshed from ForexFactory on a configurable cadence.
"""
from __future__ import annotations

import datetime as _dt
import logging
import time
from dataclasses import dataclass, field
from typing import Callable, List, Optional, Protocol

from .config import Config
from .data_provider import DataProviderError, TwelveDataClient
from .news_feed import ForexFactoryClient, refresh_filter
from .news_filter import NewsFilter
from .persistence import NullRepository, SignalRepository
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
    clock: Clock = field(default_factory=_SystemClock)
    repository: SignalRepository = field(default_factory=NullRepository)
    news_client: Optional[ForexFactoryClient] = None
    # Tier minimum required to emit. Below this, the signal is still
    # persisted but not pushed to the sink.
    emit_threshold: int = 50
    # Refresh ForexFactory feed every N seconds (default 6h)
    news_refresh_seconds: int = 6 * 3600
    _last_news_refresh: float = 0.0
    # Path to a trigger file the API can touch to request an immediate scan
    scan_request_path: Optional[str] = None

    def scan_once(self) -> List[ScanResult]:
        self._maybe_refresh_news()
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
        try:
            self.repository.save(sig)
        except Exception:  # pragma: no cover — never crash the loop on persistence
            log.exception("persistence save failed for %s", pair)
        if sig.confidence_score >= self.emit_threshold:
            self.sink(sig)
        return ScanResult(pair=pair, signal=sig)

    def _maybe_refresh_news(self) -> None:
        if self.news_client is None:
            return
        now = time.monotonic()
        if now - self._last_news_refresh < self.news_refresh_seconds:
            return
        try:
            count = refresh_filter(self.news_client, self.news)
            log.info("news feed refreshed: %d high-impact events", count)
        except Exception:
            log.exception("news feed refresh failed")
        self._last_news_refresh = now

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
            # Sleep in short slices so a refresh trigger from the API can
            # wake us up without waiting the full interval.
            slept = 0.0
            slice_s = 1.0
            while slept < sleep_for:
                self.clock.sleep(min(slice_s, sleep_for - slept))
                slept += slice_s
                if self._scan_requested():
                    log.info("scan trigger detected — running immediately")
                    break

    def _scan_requested(self) -> bool:
        path = getattr(self, "scan_request_path", None)
        if not path:
            return False
        from pathlib import Path as _P
        p = _P(path)
        if p.exists():
            try:
                p.unlink()
            except OSError:
                pass
            return True
        return False
