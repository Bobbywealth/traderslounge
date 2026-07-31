import json
import unittest
from unittest.mock import MagicMock

from scanner.news_feed import ForexFactoryClient, parse_events, refresh_filter
from scanner.news_filter import NewsFilter


SAMPLE_FEED = [
    {"title": "FOMC Statement", "country": "USD", "impact": "High",
     "date": "2026-05-20T18:00:00+00:00"},
    {"title": "ECB Press Conf", "country": "EUR", "impact": "High",
     "date": "2026-05-21T12:30:00+00:00"},
    {"title": "AUD Retail Sales", "country": "AUD", "impact": "High",  # fans to AUDUSD
     "date": "2026-05-22T01:30:00+00:00"},
    {"title": "CNY GDP", "country": "CNY", "impact": "High",  # not in our pairs
     "date": "2026-05-22T02:00:00+00:00"},
    {"title": "Medium event", "country": "USD", "impact": "Medium",   # filtered out
     "date": "2026-05-20T13:00:00+00:00"},
    {"title": "Bad date", "country": "USD", "impact": "High",
     "date": "definitely-not-a-date"},
]


class TestParseEvents(unittest.TestCase):
    def test_keeps_only_high_impact(self):
        events = parse_events(SAMPLE_FEED)
        # FOMC fans out to all 18 scanned USD pairs (8 FX/gold + 2 indices +
        # 8 crypto), ECB to 1 EUR pair, AUD Retail Sales to AUDUSD → 20 events
        self.assertEqual(len(events), 20)
        titles = {e.title for e in events}
        self.assertIn("FOMC Statement", titles)
        self.assertIn("ECB Press Conf", titles)
        self.assertNotIn("Medium event", titles)

    def test_fans_out_currency_to_pairs(self):
        events = parse_events(SAMPLE_FEED)
        fomc_pairs = {e.pair for e in events if e.title == "FOMC Statement"}
        self.assertIn("XAUUSD", fomc_pairs)
        self.assertIn("EURUSD", fomc_pairs)
        self.assertIn("NAS100", fomc_pairs)

    def test_drops_unsupported_currencies(self):
        events = parse_events(SAMPLE_FEED)
        self.assertFalse(any(e.title == "CNY GDP" for e in events))

    def test_aud_news_blocks_audusd(self):
        events = parse_events(SAMPLE_FEED)
        aud_pairs = {e.pair for e in events if e.title == "AUD Retail Sales"}
        self.assertEqual(aud_pairs, {"AUDUSD"})

    def test_usd_news_blocks_usdcad_and_usdchf(self):
        # Regression: these scanned pairs were missing from the blackout map.
        events = parse_events(SAMPLE_FEED)
        fomc_pairs = {e.pair for e in events if e.title == "FOMC Statement"}
        self.assertIn("USDCAD", fomc_pairs)
        self.assertIn("USDCHF", fomc_pairs)

    def test_drops_unparseable_dates(self):
        events = parse_events(SAMPLE_FEED)
        self.assertFalse(any(e.title == "Bad date" for e in events))


class TestClient(unittest.TestCase):
    def test_fetch_events_parses_response(self):
        http = MagicMock(return_value=json.dumps(SAMPLE_FEED))
        client = ForexFactoryClient(http=http)
        events = client.fetch_events()
        self.assertEqual(len(events), 20)
        http.assert_called_once()

    def test_fetch_handles_invalid_json(self):
        client = ForexFactoryClient(http=lambda u, t: "not-json")
        self.assertEqual(client.fetch_events(), [])

    def test_refresh_filter_replaces_events(self):
        nf = NewsFilter()
        nf.events = [MagicMock()]  # something stale
        client = ForexFactoryClient(http=lambda u, t: json.dumps(SAMPLE_FEED))
        n = refresh_filter(client, nf)
        self.assertEqual(n, 20)
        self.assertEqual(len(nf.events), 20)


if __name__ == "__main__":
    unittest.main()
