"""Tests for §12 On-Chain institutional module."""
import unittest
from unittest.mock import patch

from scanner.data_providers._http import HttpError
from scanner.modules.institutional import onchain


def _stub_coin():
    return {
        "id": "bitcoin",
        "symbol": "btc",
        "name": "Bitcoin",
        "market_data": {
            "market_cap": {"usd": 1_000_000_000_000},
            "total_volume": {"usd": 30_000_000_000},
        },
        "supply": {
            "circulating": 19_500_000,
            "total": 19_500_000,
            "max": 21_000_000,
            "infinite_max": False,
        },
        "categories": ["Layer 1", "Proof of Work"],
    }


class TestOnchain(unittest.TestCase):
    def test_unavailable_when_all_providers_blocked(self):
        with patch.object(onchain, "binance_futures"), \
             patch.object(onchain, "bybit"), \
             patch.object(onchain, "coingecko"):
            onchain.binance_futures.fetch_funding_rate.side_effect = HttpError(
                451, "x", "geo"
            )
            onchain.binance_futures.fetch_open_interest.side_effect = HttpError(
                451, "x", "geo"
            )
            onchain.binance_futures.fetch_long_short_ratio.side_effect = HttpError(
                451, "x", "geo"
            )
            onchain.binance_futures.fetch_top_trader_long_short.side_effect = HttpError(
                451, "x", "geo"
            )
            onchain.bybit.fetch_funding_history.side_effect = HttpError(
                403, "x", "geo"
            )
            onchain.coingecko.fetch_coin.side_effect = HttpError(
                500, "x", "down"
            )
            out = onchain.compute({"pair": "BTCUSD"})
        # No metrics succeeded; available is False
        self.assertFalse(out["available"])
        # Multiple gaps explicitly listed
        self.assertIn("funding_rate", out["unavailable"])
        self.assertIn("open_interest", out["unavailable"])
        self.assertIn("whale_alerts", out["unavailable"])
        self.assertIn("mvrv", out["unavailable"])

    def test_supply_data_from_coingecko_when_binance_blocked(self):
        with patch.object(onchain, "binance_futures"), \
             patch.object(onchain, "bybit"), \
             patch.object(onchain, "coingecko"):
            onchain.binance_futures.fetch_funding_rate.side_effect = HttpError(
                451, "x", "geo"
            )
            onchain.binance_futures.fetch_open_interest.side_effect = HttpError(
                451, "x", "geo"
            )
            onchain.binance_futures.fetch_long_short_ratio.side_effect = HttpError(
                451, "x", "geo"
            )
            onchain.binance_futures.fetch_top_trader_long_short.side_effect = HttpError(
                451, "x", "geo"
            )
            onchain.bybit.fetch_funding_history.side_effect = HttpError(
                403, "x", "geo"
            )
            onchain.coingecko.fetch_coin.return_value = _stub_coin()
            out = onchain.compute({"pair": "BTCUSD"})
        self.assertTrue(out["available"])  # supply was populated
        self.assertIn("supply", out["metrics"])
        self.assertEqual(out["metrics"]["supply"]["circulating"], 19_500_000)
        self.assertIn("funding_rate", out["unavailable"])

    def test_disclaimer_present(self):
        out = onchain.compute({"pair": "BTCUSD"})
        self.assertIn("disclaimer", out)
        self.assertIn("geo", out["disclaimer"].lower())


if __name__ == "__main__":
    unittest.main()