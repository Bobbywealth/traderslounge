"""Section 14 (Sentiment) — Phase 2.

Combines two free, keyless signals:

  - alternative.me Fear & Greed Index (current + 30-day history).
  - CoinDesk RSS headlines with a tiny keyword classifier that
    derives a directional sentiment score.

Both are tagged ``kind: "estimate"`` — neither is statistically
calibrated or provider-backed. The classifier is intentionally
simple and auditable:

  - Each headline is matched against a small bullish / bearish
    keyword list (audit the lists below; they're explicit).
  - The sentiment score is (bullish_hits - bearish_hits) / total
    matched headlines, in [-1, +1].

Google Trends, social sentiment (LunarCrush / Santiment), and
analyst ratings all need paid providers and are reported as
unavailable.

Report-only — never feeds the BWTS score or Signals gate.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

from scanner.data_providers import coindesk_rss, fear_greed
from scanner.data_providers._http import HttpError

log = logging.getLogger(__name__)


# Headline keyword classifier. Explicit lists so the rule can be
# audited and tweaked without code changes. Lowercase substring match.
_BULLISH_KEYWORDS = {
    "rally", "surge", "soar", "jump", "gain", "bull", "bullish",
    "breakout", "record high", "all-time high", "ath", "approve",
    "approval", "etf approved", "adoption", "accumulate", "accumulation",
    "inflows", "inflow", "buy", "buying", "long", "support",
}
_BEARISH_KEYWORDS = {
    "crash", "plunge", "tumble", "drop", "fall", "decline", "bear",
    "bearish", "sell-off", "selloff", "liquidation", "liquidate",
    "outflow", "outflows", "fear", "sell", "selling", "short",
    "hack", "exploit", "ban", "reject", "rejected",
    "etf denied",
}

_WORD_RE = re.compile(r"[a-z0-9\-]+")


def _headline_score(headline: str) -> int:
    if not headline:
        return 0
    words = set(_WORD_RE.findall(headline.lower()))
    bull = len(words & _BULLISH_KEYWORDS)
    bear = len(words & _BEARISH_KEYWORDS)
    if bull and not bear:
        return 1
    if bear and not bull:
        return -1
    return 0  # neutral or both hit


def _classify(samples: List[int]) -> Dict[str, Any]:
    if not samples:
        return {"score": 0.0, "bullish": 0, "bearish": 0, "neutral": 0,
                "total": 0}
    bull = sum(1 for s in samples if s > 0)
    bear = sum(1 for s in samples if s < 0)
    neutral = sum(1 for s in samples if s == 0)
    total = len(samples)
    return {
        "score": round((bull - bear) / total, 3),
        "bullish": bull,
        "bearish": bear,
        "neutral": neutral,
        "total": total,
    }


def _try(fn, *args, **kwargs):
    try:
        return {"ok": True, "data": fn(*args, **kwargs)}
    except HttpError as exc:
        return {"ok": False, "status": exc.status, "reason": exc.reason}
    except Exception as exc:  # pragma: no cover - defensive
        return {"ok": False, "status": 0, "reason": str(exc)}


def compute(analysis: Dict[str, Any], snapshot: Any = None
            ) -> Dict[str, Any]:
    sentiment: Dict[str, Any] = {}
    unavailable: Dict[str, str] = {}

    # 1. Fear & Greed Index.
    fng = _try(fear_greed.fetch_fear_greed, 30)
    if fng["ok"]:
        cur = fng["data"]["current"]
        history = fng["data"]["history"]
        # Compare current vs 30-day average to derive a 30-day delta.
        avg_30 = (
            sum(h.get("value", 0) for h in history) / len(history)
            if history else cur.get("value", 50)
        )
        sentiment["fear_greed"] = {
            "current": cur,
            "value": cur.get("value"),
            "classification": cur.get("classification"),
            "avg_30d": round(avg_30, 1),
            "delta_vs_30d_avg": round(cur.get("value", 50) - avg_30, 1),
            "contrarian_signal": (
                "extreme_fear_buy_zone" if cur.get("value", 50) < 25
                else "extreme_greed_take_profits" if cur.get("value", 50) > 75
                else "neutral"
            ),
            "source": fng["data"].get("source"),
        }
    else:
        unavailable["fear_greed"] = fng.get("reason") or "unreachable"

    # 2. News sentiment from CoinDesk RSS.
    news = _try(coindesk_rss.fetch_news, 30)
    if news["ok"]:
        items = news["data"]["items"]
        scores: List[int] = [_headline_score(item.get("title") or "") for item in items]
        sentiment["news"] = {
            **_classify(scores),
            "sample_titles": [it.get("title") for it in items[:5]],
            "source": news["data"].get("source"),
            "disclaimer": (
                "Sentiment score is a transparent keyword count "
                "(bullish_hits - bearish_hits) / total. Not a "
                "statistically calibrated NLP model. See _BULLISH_KEYWORDS "
                "and _BEARISH_KEYWORDS in scanner/modules/institutional/"
                "sentiment.py for the exact lists."
            ),
        }
    else:
        unavailable["news"] = news.get("reason") or "unreachable"

    # Gaps that need paid providers.
    unavailable["social_sentiment"] = (
        "requires_paid_provider (LunarCrush / Santiment)"
    )
    unavailable["google_trends"] = (
        "requires_scraping_or_paid_provider"
    )
    unavailable["analyst_ratings"] = (
        "requires_curated_feed (not available in this phase)"
    )

    available = bool(sentiment)
    return {
        "available": available,
        "kind": "estimate",
        "sentiment": sentiment,
        "unavailable": unavailable,
        "disclaimer": (
            "Sentiment combines the alternative.me Fear & Greed Index "
            "with a transparent keyword classifier over CoinDesk RSS "
            "headlines. This estimate is not statistically calibrated. "
            "The Fear & Greed value is treated as a contrarian signal at "
            "<25 (extreme fear) or >75 (extreme greed); other ranges are "
            "neutral."
        ),
    }