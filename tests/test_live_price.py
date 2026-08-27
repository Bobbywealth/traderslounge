"""Tests for the live-price sanity check used by the XAUUSD alert path."""
import json
import time
import unittest
from unittest.mock import patch

from scanner.live_price import LivePriceClient, LiveSpot


class LivePriceClientTest(unittest.TestCase):
    def _make_payload(self, price=4635.0, updated="2026-08-27T03:35:44Z"):
        return json.dumps({
            "currency": "USD",
            "price": price,
            "updatedAt": updated,
            "symbol": "XAU",
        })

    def test_fetch_live_spot_parses_json(self):
        payload = self._make_payload(4635.0)
        client = LivePriceClient(http=lambda url, t: payload)
        spot = client.fetch_live_spot()
        self.assertIsNotNone(spot)
        self.assertEqual(spot.price, 4635.0)
        self.assertEqual(spot.updated_at, "2026-08-27T03:35:44Z")
        self.assertEqual(spot.source, "gold-api.com")

    def test_fetch_returns_cached_within_ttl(self):
        payload = self._make_payload(4635.0)
        client = LivePriceClient(http=lambda url, t: payload, cache_ttl_seconds=60.0)
        first = client.fetch_live_spot()
        second = client.fetch_live_spot()  # cache hit, no http call
        self.assertIs(first, second)
        self.assertEqual(second.fetched_at, first.fetched_at)

    def test_fetch_falls_back_to_last_good_cache_on_network_error(self):
        def boom(url, t):
            raise OSError("network down")
        client = LivePriceClient(http=boom)
        # First call fails, no cache yet, returns None.
        self.assertIsNone(client.fetch_live_spot())
        # Manually seed cache so the next failure can fall back.
        cached = LiveSpot(price=4635.0, updated_at="x", fetched_at=time.time())
        client._cache = cached
        # Subsequent failure returns last-good cache instead of None.
        self.assertEqual(client.fetch_live_spot(force=True), cached)

    def test_fetch_handles_invalid_json(self):
        client = LivePriceClient(http=lambda url, t: "not json")
        self.assertIsNone(client.fetch_live_spot())

    def test_validate_reference_price_flags_stale(self):
        payload = self._make_payload(4635.0)
        client = LivePriceClient(http=lambda url, t: payload)
        # Reference price matches live → not stale.
        result = client.validate_reference_price(4635.0)
        self.assertEqual(result["live_price"], 4635.0)
        self.assertEqual(result["gap_usd"], 0.0)
        self.assertFalse(result["stale"])

    def test_validate_reference_price_flags_large_gap(self):
        payload = self._make_payload(4635.0)
        client = LivePriceClient(http=lambda url, t: payload)
        # Reference is $12 off live → stale flag should fire.
        result = client.validate_reference_price(4623.0)
        self.assertEqual(result["gap_usd"], 12.0)
        self.assertTrue(result["stale"])

    def test_validate_handles_missing_reference(self):
        payload = self._make_payload(4635.0)
        client = LivePriceClient(http=lambda url, t: payload)
        result = client.validate_reference_price(None)
        self.assertIsNone(result["live_price"])
        self.assertIsNone(result["stale"])

    def test_validate_skips_live_fetch_for_non_xauusd(self):
        """Only XAUUSD uses the spot endpoint; other pairs return bare ref check."""
        client = LivePriceClient(http=lambda url, t: self.fail("should not call"))
        result = client.validate_reference_price(1.0850, pair="EURUSD")
        self.assertIsNone(result["live_price"])

    def test_age_seconds_grows_with_time(self):
        spot = LiveSpot(price=4635.0, updated_at="x", fetched_at=time.time() - 30)
        self.assertGreaterEqual(spot.age_seconds, 30)


if __name__ == "__main__":
    unittest.main()