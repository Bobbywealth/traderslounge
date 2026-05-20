"""ForexFactory news feed client.

ForexFactory publishes a weekly JSON economic calendar at:
  https://nfs.faireconomy.media/ff_calendar_thisweek.json

This module fetches that feed, filters for high-impact events that
affect the pairs we trade, and converts them into NewsEvent objects
suitable for the NewsFilter.
"""
from __future__ import annotations

import datetime as _dt
import json
import logging
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Callable, Dict, List

from .news_filter import NewsEvent, NewsFilter

log = logging.getLogger(__name__)

FOREXFACTORY_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"

# Currency → list of pairs that touch it. Used to fan a "USD high-impact"
# event out to every pair containing USD.
CURRENCY_TO_PAIRS: Dict[str, List[str]] = {
    "USD": ["XAUUSD", "GBPUSD", "EURUSD", "USDJPY", "NAS100", "US30"],
    "EUR": ["EURUSD"],
    "GBP": ["GBPUSD", "GBPJPY"],
    "JPY": ["USDJPY", "GBPJPY"],
    "XAU": ["XAUUSD"],
}

HttpFn = Callable[[str, float], str]


def _default_http(url: str, timeout: float) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "bwts-scanner/0.1"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
        return resp.read().decode("utf-8")


@dataclass
class ForexFactoryClient:
    url: str = FOREXFACTORY_URL
    timeout_seconds: float = 15.0
    http: HttpFn = _default_http

    def fetch_raw(self) -> List[dict]:
        try:
            body = self.http(self.url, self.timeout_seconds)
        except urllib.error.URLError as exc:
            log.warning("forexfactory fetch failed: %s", exc)
            return []
        try:
            data = json.loads(body)
        except json.JSONDecodeError as exc:
            log.warning("forexfactory invalid JSON: %s", exc)
            return []
        if not isinstance(data, list):
            return []
        return data

    def fetch_events(self) -> List[NewsEvent]:
        return parse_events(self.fetch_raw())


def parse_events(raw: List[dict]) -> List[NewsEvent]:
    """Turn ForexFactory rows into NewsEvent objects (high-impact only).

    A USD-wide event fans out to one NewsEvent per affected pair. Events
    that don't map to a pair we trade are dropped.
    """
    out: List[NewsEvent] = []
    for row in raw:
        impact = (row.get("impact") or "").lower()
        if impact != "high":
            continue
        currency = (row.get("country") or row.get("currency") or "").upper()
        pairs = CURRENCY_TO_PAIRS.get(currency)
        if not pairs:
            continue
        when = _parse_event_time(row.get("date"))
        if when is None:
            continue
        title = row.get("title") or ""
        for pair in pairs:
            out.append(NewsEvent(pair=pair, when=when, impact="high", title=title))
    return out


def _parse_event_time(value) -> _dt.datetime | None:
    if not value:
        return None
    if isinstance(value, (int, float)):
        return _dt.datetime.fromtimestamp(value, tz=_dt.timezone.utc)
    if isinstance(value, str):
        # ForexFactory uses ISO 8601 with offset, e.g. "2026-05-20T12:30:00-04:00"
        try:
            dt = _dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=_dt.timezone.utc)
        return dt.astimezone(_dt.timezone.utc)
    return None


def refresh_filter(client: ForexFactoryClient, news_filter: NewsFilter) -> int:
    """Replace the filter's events with a fresh fetch. Returns count loaded."""
    events = client.fetch_events()
    news_filter.events = events
    return len(events)
