import json
import unittest
from unittest.mock import MagicMock

from scanner.data_provider import (
    SYMBOL_MAP,
    TF_MAP,
    DataProviderError,
    TwelveDataClient,
    _parse_values_to_candles,
)


SAMPLE_RESPONSE = {
    "meta": {"symbol": "XAU/USD", "interval": "1h"},
    "values": [
        # newest first (Twelve Data convention)
        {"datetime": "2026-05-20 12:00:00", "open": "2360.5", "high": "2362.1",
         "low": "2359.0", "close": "2361.2", "volume": "0"},
        {"datetime": "2026-05-20 11:00:00", "open": "2358.0", "high": "2361.0",
         "low": "2357.5", "close": "2360.4", "volume": "0"},
    ],
    "status": "ok",
}


class TestParse(unittest.TestCase):
    def test_reverses_to_chronological(self):
        candles = _parse_values_to_candles(SAMPLE_RESPONSE["values"])
        self.assertEqual(len(candles), 2)
        self.assertLess(candles[0].time, candles[1].time)
        self.assertAlmostEqual(candles[1].close, 2361.2)

    def test_skips_malformed_rows(self):
        bad = [{"datetime": "not-a-date", "open": "x", "high": "y",
                "low": "z", "close": "q"}]
        self.assertEqual(_parse_values_to_candles(bad), [])


class TestClient(unittest.TestCase):
    def _client(self, body: str) -> TwelveDataClient:
        http = MagicMock(return_value=body)
        return TwelveDataClient(api_key="testkey", http=http), http

    def test_fetch_candles_happy_path(self):
        client, http = self._client(json.dumps(SAMPLE_RESPONSE))
        candles = client.fetch_candles("XAUUSD", "H1")
        self.assertEqual(len(candles), 2)
        url = http.call_args[0][0]
        self.assertIn("symbol=XAU%2FUSD", url)
        self.assertIn("interval=1h", url)
        self.assertIn("apikey=testkey", url)

    def test_missing_api_key_raises(self):
        c = TwelveDataClient(api_key="", http=MagicMock())
        with self.assertRaises(DataProviderError):
            c.fetch_candles("XAUUSD", "H1")

    def test_unknown_pair_raises(self):
        c = TwelveDataClient(api_key="k", http=MagicMock())
        with self.assertRaises(DataProviderError):
            c.fetch_candles("BOGUSPAIR", "H1")

    def test_unknown_timeframe_raises(self):
        c = TwelveDataClient(api_key="k", http=MagicMock())
        with self.assertRaises(DataProviderError):
            c.fetch_candles("XAUUSD", "M99")

    def test_api_error_raises(self):
        client, _ = self._client(json.dumps({
            "status": "error", "message": "API limit exceeded"
        }))
        with self.assertRaises(DataProviderError):
            client.fetch_candles("XAUUSD", "H1")

    def test_fetch_snapshot_populates_timeframes(self):
        # Distinct payload per call so we can verify routing
        http = MagicMock(side_effect=[json.dumps(SAMPLE_RESPONSE)] * 4)
        c = TwelveDataClient(api_key="k", http=http)
        snap = c.fetch_snapshot("XAUUSD")
        self.assertEqual(snap.pair, "XAUUSD")
        self.assertEqual(len(snap.d1), 2)
        self.assertEqual(len(snap.h4), 2)
        self.assertEqual(len(snap.h1), 2)
        self.assertEqual(len(snap.m15), 2)
        self.assertEqual(http.call_count, 4)

    def test_snapshot_continues_when_one_tf_fails(self):
        http = MagicMock(side_effect=[
            json.dumps(SAMPLE_RESPONSE),
            json.dumps({"status": "error", "message": "boom"}),
            json.dumps(SAMPLE_RESPONSE),
            json.dumps(SAMPLE_RESPONSE),
        ])
        c = TwelveDataClient(api_key="k", http=http)
        snap = c.fetch_snapshot("XAUUSD")
        # The H4 call failed → bucket should be empty but others populated.
        self.assertEqual(len(snap.d1), 2)
        self.assertEqual(len(snap.h4), 0)
        self.assertEqual(len(snap.h1), 2)

    def test_fetch_candles_serves_from_cache_within_ttl(self):
        # Bar-aligned cache: a repeat call within the TTL must not hit the
        # network again. This is what keeps FX scanning under the free quota.
        http = MagicMock(return_value=json.dumps(SAMPLE_RESPONSE))
        c = TwelveDataClient(api_key="k", http=http)
        first = c.fetch_candles("XAUUSD", "H1")
        second = c.fetch_candles("XAUUSD", "H1")
        self.assertEqual(first, second)
        self.assertEqual(http.call_count, 1, "cached call should not hit network")
        # A different (pair, timeframe) is a cache miss → new network call.
        c.fetch_candles("XAUUSD", "D1")
        self.assertEqual(http.call_count, 2)


class TestMaps(unittest.TestCase):
    def test_all_spec_pairs_mapped(self):
        for pair in ("XAUUSD", "GBPUSD", "EURUSD", "USDJPY", "GBPJPY", "NAS100", "US30"):
            self.assertIn(pair, SYMBOL_MAP, f"{pair} not in SYMBOL_MAP")

    def test_all_required_timeframes_mapped(self):
        for tf in ("D1", "H4", "H1", "M15", "M5", "M1"):
            self.assertIn(tf, TF_MAP)


if __name__ == "__main__":
    unittest.main()
