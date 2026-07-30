"""Tests for §14 Sentiment institutional module."""
import unittest
from unittest.mock import patch

from scanner.data_providers._http import HttpError
from scanner.modules.institutional import sentiment


def _stub_fng_ok():
    return {
        "current": {"value": 18, "classification": "Extreme Fear",
                    "timestamp": 1_700_000_000},
        "history": [
            {"value": 18, "classification": "Extreme Fear"},
            {"value": 22, "classification": "Fear"},
            {"value": 50, "classification": "Neutral"},
        ],
        "source": "alternative.me",
    }


def _stub_fng_greed():
    return {
        "current": {"value": 82, "classification": "Extreme Greed",
                    "timestamp": 1_700_000_000},
        "history": [{"value": 82, "classification": "Extreme Greed"}],
        "source": "alternative.me",
    }


def _stub_news_ok():
    return {
        "items": [
            {"title": "Bitcoin rally continues as ETF inflows surge",
             "summary": "", "pub_date": None, "categories": [],
             "link": "https://example.com/1"},
            {"title": "Ethereum breaks out to new highs",
             "summary": "", "pub_date": None, "categories": [],
             "link": "https://example.com/2"},
            {"title": "Crypto market faces sell-off pressure",
             "summary": "", "pub_date": None, "categories": [],
             "link": "https://example.com/3"},
        ],
        "count": 3,
        "source": "coindesk.com RSS",
    }


class TestSentiment(unittest.TestCase):
    def test_module_returns_estimate_kind(self):
        with patch.object(sentiment, "fear_greed"), \
             patch.object(sentiment, "coindesk_rss"):
            sentiment.fear_greed.fetch_fear_greed.return_value = _stub_fng_ok()
            sentiment.coindesk_rss.fetch_news.return_value = _stub_news_ok()
            out = sentiment.compute({"pair": "BTCUSD"})
        self.assertTrue(out["available"])
        self.assertEqual(out["kind"], "estimate")
        self.assertEqual(out["sentiment"]["fear_greed"]["contrarian_signal"],
                         "extreme_fear_buy_zone")
        self.assertIn("news", out["sentiment"])
        # Headline 1 hits bullish keywords (rally, surge, inflows),
        # headline 2 is neutral (no keyword matches), headline 3 hits
        # bearish (sell-off). score = (1-1)/3 = 0.0.
        self.assertEqual(out["sentiment"]["news"]["score"], 0.0)
        self.assertEqual(out["sentiment"]["news"]["bullish"], 1)
        self.assertEqual(out["sentiment"]["news"]["bearish"], 1)
        self.assertEqual(out["sentiment"]["news"]["neutral"], 1)

    def test_fear_greed_unavailable_is_reported(self):
        with patch.object(sentiment, "fear_greed"), \
             patch.object(sentiment, "coindesk_rss"):
            sentiment.fear_greed.fetch_fear_greed.side_effect = HttpError(
                500, "x", "down"
            )
            sentiment.coindesk_rss.fetch_news.return_value = _stub_news_ok()
            out = sentiment.compute({"pair": "BTCUSD"})
        self.assertTrue(out["available"])
        self.assertIn("fear_greed", out["unavailable"])

    def test_extreme_greed_signals_take_profits(self):
        with patch.object(sentiment, "fear_greed"), \
             patch.object(sentiment, "coindesk_rss"):
            sentiment.fear_greed.fetch_fear_greed.return_value = _stub_fng_greed()
            sentiment.coindesk_rss.fetch_news.return_value = _stub_news_ok()
            out = sentiment.compute({"pair": "BTCUSD"})
        self.assertEqual(out["sentiment"]["fear_greed"]["contrarian_signal"],
                         "extreme_greed_take_profits")

    def test_disclaimer_present(self):
        with patch.object(sentiment, "fear_greed"), \
             patch.object(sentiment, "coindesk_rss"):
            sentiment.fear_greed.fetch_fear_greed.return_value = _stub_fng_ok()
            sentiment.coindesk_rss.fetch_news.return_value = _stub_news_ok()
            out = sentiment.compute({"pair": "BTCUSD"})
        self.assertIn("disclaimer", out)
        self.assertIn("estimate", out["disclaimer"].lower())


if __name__ == "__main__":
    unittest.main()