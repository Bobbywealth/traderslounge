"""Tests for §13 Fundamentals institutional module."""
import unittest
from unittest.mock import patch

from scanner.data_providers._http import HttpError
from scanner.modules.institutional import fundamentals


def _stub_coin():
    return {
        "id": "ethereum",
        "name": "Ethereum",
        "symbol": "eth",
        "categories": ["Smart Contract Platform"],
        "genesis_date": "2015-07-30",
        "hashing_algorithm": "Ethash",
        "market_data": {
            "market_cap": {"usd": 200_000_000_000},
            "fully_diluted_valuation": {"usd": 200_000_000_000},
            "total_volume": {"usd": 10_000_000_000},
            "circulating_supply": 120_000_000,
        },
        "supply": {
            "circulating": 120_000_000,
            "total": 120_000_000,
            "max": None,
            "infinite_max": False,
        },
    }


def _stub_protocol():
    return {
        "id": "2269",
        "name": "Ethereum",
        "slug": "ethereum",
        "symbol": "ETH",
        "category": "Chain",
        "tvl": 50_000_000_000,
        "chainTvls": {"Ethereum": 50_000_000_000, "Lido": 25_000_000_000},
    }


def _stub_github_repo():
    return {
        "repository": "ethereum/go-ethereum",
        "url": "https://github.com/ethereum/go-ethereum",
        "description": "Official Go implementation of the Ethereum protocol",
        "popularity": {
            "stars": 50000,
            "forks": 20000,
            "watchers": 1500,
            "open_issues": 300,
        },
        "activity": {
            "last_pushed": "2024-01-01T12:00:00Z",
            "recent_commits": 100,
        },
        "source": "github",
    }


class TestFundamentals(unittest.TestCase):
    def test_eth_tvl_and_supply(self):
        with patch.object(fundamentals, "coingecko"), \
             patch.object(fundamentals, "defillama"):
            fundamentals.coingecko.fetch_coin.return_value = _stub_coin()
            fundamentals.defillama.find_protocol_by_symbol.return_value = _stub_protocol()
            out = fundamentals.compute({"pair": "ETHUSD"})
        self.assertTrue(out["available"])
        self.assertEqual(out["fundamentals"]["tvl"]["protocol"], "Ethereum")
        self.assertEqual(out["fundamentals"]["tvl"]["tvl_usd"], 50_000_000_000)
        self.assertEqual(out["fundamentals"]["supply_schedule"]["circulating"],
                         120_000_000)

    def test_no_defillama_match_reports_unavailable(self):
        with patch.object(fundamentals, "coingecko"), \
             patch.object(fundamentals, "defillama"):
            fundamentals.coingecko.fetch_coin.return_value = _stub_coin()
            fundamentals.defillama.find_protocol_by_symbol.return_value = None
            out = fundamentals.compute({"pair": "ETHUSD"})
        # No DefiLlama protocol match is reported under the defillama key.
        self.assertIn("defillama", out["unavailable"])
        self.assertEqual(out["unavailable"]["defillama"], "no protocol match")

    def test_coingecko_failure(self):
        with patch.object(fundamentals, "coingecko"), \
             patch.object(fundamentals, "defillama"):
            fundamentals.coingecko.fetch_coin.side_effect = HttpError(
                500, "x", "down"
            )
            fundamentals.defillama.find_protocol_by_symbol.return_value = _stub_protocol()
            out = fundamentals.compute({"pair": "ETHUSD"})
        self.assertFalse(out["available"])
        self.assertIn("coingecko", out["unavailable"])

    def test_disclaimer_present(self):
        out = fundamentals.compute({"pair": "BTCUSD"})
        self.assertIn("disclaimer", out)
        self.assertIn("paid provider", out["disclaimer"].lower())

    def test_github_developer_activity(self):
        with patch.object(fundamentals, "coingecko"), \
             patch.object(fundamentals, "defillama"), \
             patch.object(fundamentals, "github"):
            fundamentals.coingecko.fetch_coin.return_value = _stub_coin()
            fundamentals.defillama.find_protocol_by_symbol.return_value = _stub_protocol()
            fundamentals.github.fetch_repo.return_value = _stub_github_repo()
            out = fundamentals.compute({"pair": "ETHUSD"}, github_token="test_token")
        self.assertIn("developer_activity", out["fundamentals"])
        dev = out["fundamentals"]["developer_activity"]
        self.assertEqual(dev["repository"], "ethereum/go-ethereum")
        self.assertEqual(dev["popularity"]["stars"], 50000)
        self.assertEqual(dev["activity"]["recent_commits"], 100)

    def test_github_failure_reports_unavailable(self):
        with patch.object(fundamentals, "coingecko"), \
             patch.object(fundamentals, "defillama"), \
             patch.object(fundamentals, "github"):
            fundamentals.coingecko.fetch_coin.return_value = _stub_coin()
            fundamentals.defillama.find_protocol_by_symbol.return_value = _stub_protocol()
            fundamentals.github.fetch_repo.side_effect = HttpError(
                404, "https://api.github.com/repos/ethereum/go-ethereum",
                "repository not found"
            )
            out = fundamentals.compute({"pair": "ETHUSD"}, github_token="test_token")
        self.assertIn("developer_activity", out["unavailable"])
        self.assertIn("repository not found", out["unavailable"]["developer_activity"])


if __name__ == "__main__":
    unittest.main()