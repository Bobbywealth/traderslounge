"""CoinDesk RSS news provider.

Free, no API key. Endpoint:
  https://www.coindesk.com/arc/outboundfeeds/rss/

The wire is RSS 2.0 XML. We extract a small, structured subset:

  - title (string)
  - link (string)
  - pub_date (ISO 8601 string, normalized from RFC 822)
  - summary (text before first ``<p>`` close)
  - categories (list of strings from ``<category>`` tags)

Used by the §14 sentiment module to compute a directional headline
classifier (bullish / bearish / neutral) without invoking a paid NLP
service. The classifier is a tiny keyword list tagged ``estimate`` —
not statistically calibrated — and must never be presented as
provider-backed.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Dict, List, Optional
from xml.etree import ElementTree as ET

from ._http import HttpError, get_text

ENDPOINT = "https://www.coindesk.com/arc/outboundfeeds/rss/"

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _strip_html(text: str) -> str:
    return _WS_RE.sub(" ", _TAG_RE.sub("", text or "")).strip()


def _pub_to_iso(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        dt = parsedate_to_datetime(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


def fetch_news(limit: int = 30) -> Dict[str, Any]:
    """Return the latest CoinDesk RSS items, parsed."""
    raw = get_text(ENDPOINT)
    root = ET.fromstring(raw)
    items: List[Dict[str, Any]] = []
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub_date = _pub_to_iso(item.findtext("pubDate"))
        description = _strip_html(item.findtext("description") or "")
        categories = [
            (c.text or "").strip() for c in item.findall("category")
            if (c.text or "").strip()
        ]
        if not title:
            continue
        items.append({
            "title": title,
            "link": link,
            "pub_date": pub_date,
            "summary": description[:400],
            "categories": categories,
        })
        if len(items) >= limit:
            break
    if not items:
        raise HttpError(200, ENDPOINT, "empty RSS feed")
    return {
        "items": items,
        "count": len(items),
        "source": "coindesk.com RSS",
    }