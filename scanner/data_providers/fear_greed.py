"""Alternative.me Fear & Greed Index provider.

Single GET to https://api.alternative.me/fng/. Returns the current index
value (0..100), classification ("Extreme Fear" ... "Extreme Greed"),
and timestamp. Free, no API key, no rate limits documented.

Use for the institutional §14 sentiment module.
"""
from __future__ import annotations

from typing import Any, Dict

from ._http import HttpError, get_json

ENDPOINT = "https://api.alternative.me/fng/"


def fetch_fear_greed(limit: int = 30) -> Dict[str, Any]:
    """Return current + historical Fear & Greed readings.

    Raises :class:`HttpError` on transport failure. The institutional
    sentiment module catches that and reports ``available: False``.
    """
    params = f"?limit={int(limit)}&format=json"
    raw = get_json(ENDPOINT + params)
    rows = raw.get("data") or []
    if not rows:
        raise HttpError(200, ENDPOINT, "empty response")
    parsed = []
    for row in rows:
        try:
            value = int(row.get("value"))
        except (TypeError, ValueError):
            continue
        parsed.append({
            "value": value,
            "classification": str(row.get("value_classification") or ""),
            "timestamp": int(row.get("timestamp") or 0),
        })
    if not parsed:
        raise HttpError(200, ENDPOINT, "no parseable rows")
    return {
        "current": parsed[0],
        "history": parsed,
        "source": "alternative.me",
    }