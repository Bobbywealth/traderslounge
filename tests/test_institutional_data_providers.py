"""Tests for the data_providers HTTP helper and provider modules."""
import unittest
from unittest.mock import patch

from scanner.data_providers import _http
from scanner.data_providers._http import HttpError, get_json, get_text
from scanner.data_providers import fear_greed, defillama, coingecko, coindesk_rss, github


class TestHttpHelper(unittest.TestCase):
    @patch.object(_http, "_request_once")
    def test_get_json_success(self, mock_request):
        mock_request.return_value = (200, b'{"ok": true}')
        result = get_json("https://example.com/api")
        self.assertEqual(result, {"ok": True})

    @patch.object(_http, "_request_once")
    def test_get_json_404_raises(self, mock_request):
        mock_request.return_value = (404, b"not found")
        with self.assertRaises(HttpError) as cm:
            get_json("https://example.com/api")
        self.assertEqual(cm.exception.status, 404)

    @patch.object(_http, "_request_once")
    def test_get_text_strips_html(self, mock_request):
        mock_request.return_value = (200, b"<p>hello</p>")
        self.assertEqual(get_text("https://example.com/api"), "<p>hello</p>")

    @patch.object(_http, "_request_once")
    def test_retry_on_5xx(self, mock_request):
        mock_request.side_effect = [
            (503, b"busy"),
            (503, b"busy"),
            (200, b"ok"),
        ]
        # Should retry and eventually succeed.
        result = get_text("https://example.com/api", retries=3)
        self.assertEqual(result, "ok")
        self.assertEqual(mock_request.call_count, 3)

    @patch.object(_http, "_request_once")
    def test_no_retry_on_4xx_other_than_429(self, mock_request):
        mock_request.return_value = (400, b"bad")
        with self.assertRaises(HttpError):
            get_text("https://example.com/api", retries=3)
        self.assertEqual(mock_request.call_count, 1)


class TestFearGreed(unittest.TestCase):
    @patch.object(fear_greed, "get_json")
    def test_fetch_parses_current(self, mock_get):
        mock_get.return_value = {
            "data": [
                {"value": "28", "value_classification": "Fear",
                 "timestamp": "1785369600"},
                {"value": "32", "value_classification": "Fear",
                 "timestamp": "1785283200"},
            ]
        }
        out = fear_greed.fetch_fear_greed()
        self.assertEqual(out["current"]["value"], 28)
        self.assertEqual(out["current"]["classification"], "Fear")
        self.assertEqual(len(out["history"]), 2)

    @patch.object(fear_greed, "get_json")
    def test_fetch_raises_on_empty(self, mock_get):
        mock_get.return_value = {"data": []}
        with self.assertRaises(HttpError):
            fear_greed.fetch_fear_greed()


class TestCoinGecko(unittest.TestCase):
    def test_coin_id_for_canonical(self):
        self.assertEqual(coingecko.coin_id_for("BTCUSD"), "bitcoin")
        self.assertEqual(coingecko.coin_id_for("ETHUSD"), "ethereum")
        self.assertEqual(coingecko.coin_id_for("LTCUSD"), "litecoin")

    def test_coin_id_for_usdt_alias(self):
        self.assertEqual(coingecko.coin_id_for("BTCUSDT"), "bitcoin")
        self.assertEqual(coingecko.coin_id_for("ETHUSDT"), "ethereum")

    def test_coin_id_for_unknown(self):
        self.assertIsNone(coingecko.coin_id_for("XYZ"))


class TestCoinDeskRSS(unittest.TestCase):
    @patch.object(coindesk_rss, "get_text")
    def test_fetch_parses_items(self, mock_get):
        mock_get.return_value = """<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Bitcoin rallies to new high</title>
      <link>https://example.com/a</link>
      <pubDate>Mon, 30 Jul 2026 16:00:00 +0000</pubDate>
      <description>Some summary text.</description>
      <category>Markets</category>
      <category>Bitcoin</category>
    </item>
    <item>
      <link>https://example.com/b</link>
    </item>
  </channel>
</rss>"""
        out = coindesk_rss.fetch_news()
        self.assertEqual(out["count"], 1)
        item = out["items"][0]
        self.assertEqual(item["title"], "Bitcoin rallies to new high")
        self.assertEqual(item["link"], "https://example.com/a")
        self.assertIn("2026", item["pub_date"])  # ISO year
        self.assertEqual(item["categories"], ["Markets", "Bitcoin"])

    @patch.object(coindesk_rss, "get_text")
    def test_fetch_raises_on_empty(self, mock_get):
        mock_get.return_value = """<?xml version="1.0"?>
<rss version="2.0"><channel></channel></rss>"""
        with self.assertRaises(HttpError):
            coindesk_rss.fetch_news()


class TestGitHub(unittest.TestCase):
    def test_repo_for_canonical(self):
        self.assertEqual(github.repo_for("BTCUSD"), "bitcoin/bitcoin")
        self.assertEqual(github.repo_for("ETHUSD"), "ethereum/go-ethereum")
        self.assertEqual(github.repo_for("XRPUSD"), "XRPLF/rippled")

    def test_repo_for_usdt_alias(self):
        self.assertEqual(github.repo_for("BTCUSDT"), "bitcoin/bitcoin")
        self.assertEqual(github.repo_for("ETHUSDT"), "ethereum/go-ethereum")

    def test_repo_for_unknown(self):
        self.assertIsNone(github.repo_for("XYZ"))

    @patch.object(github, "get_json")
    def test_fetch_repo_extracts_metrics(self, mock_get):
        # Mock repo endpoint
        def mock_get_side_effect(url, **kwargs):
            if "commits" in url:
                return [{"sha": "abc123"}, {"sha": "def456"}]
            return {
                "html_url": "https://github.com/bitcoin/bitcoin",
                "description": "Bitcoin Core",
                "stargazers_count": 75000,
                "forks_count": 45000,
                "watchers_count": 2500,
                "open_issues_count": 500,
                "pushed_at": "2026-01-30T12:00:00Z",
            }

        mock_get.side_effect = mock_get_side_effect
        out = github.fetch_repo("BTCUSD")

        self.assertEqual(out["repository"], "bitcoin/bitcoin")
        self.assertEqual(out["popularity"]["stars"], 75000)
        self.assertEqual(out["popularity"]["forks"], 45000)
        self.assertEqual(out["activity"]["recent_commits"], 2)

    @patch.object(github, "get_json")
    def test_fetch_repo_unknown_pair(self, mock_get):
        with self.assertRaises(HttpError) as cm:
            github.fetch_repo("XYZUSD")
        self.assertEqual(cm.exception.status, 0)
        self.assertIn("unknown pair", str(cm.exception))

    @patch.object(github, "get_json")
    def test_fetch_repo_404_on_not_found(self, mock_get):
        mock_get.side_effect = HttpError(404, "https://api.github.com/repos/unknown",
                                         "repository not found")
        with self.assertRaises(HttpError) as cm:
            github.fetch_repo("BTCUSD")
        self.assertEqual(cm.exception.status, 404)

    @patch.object(github, "get_json")
    def test_fetch_repo_with_auth_token(self, mock_get):
        # Mock repo endpoint
        def mock_get_side_effect(url, **kwargs):
            # Check that auth token was passed
            if kwargs.get("headers") and "Authorization" in kwargs["headers"]:
                self.assertIn("token", kwargs["headers"]["Authorization"])
            if "commits" in url:
                return []
            return {
                "html_url": "https://github.com/bitcoin/bitcoin",
                "description": "Bitcoin Core",
                "stargazers_count": 75000,
                "forks_count": 45000,
                "watchers_count": 2500,
                "open_issues_count": 500,
                "pushed_at": "2026-01-30T12:00:00Z",
            }

        mock_get.side_effect = mock_get_side_effect
        out = github.fetch_repo("BTCUSD", auth_token="test_token_123")
        self.assertEqual(out["popularity"]["stars"], 75000)


if __name__ == "__main__":
    unittest.main()