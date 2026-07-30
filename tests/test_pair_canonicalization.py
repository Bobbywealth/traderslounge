"""Tests for pair-name canonicalization in the market data layer.

Regression coverage for the case where a caller passes the more familiar
Binance notation (e.g., ``BTCUSDT``) but the scanner's canonical routing
key is the no-T form (``BTCUSD``). Without normalization the request
silently routes to Twelve Data, returns an empty snapshot, and every
Phase 1 institutional module reports ``available: false``.
"""
import unittest

from scanner.binance_client import BINANCE_SYMBOL_MAP, canonicalize, supports
from scanner.multi_source import MultiSourceClient


class TestCanonicalize(unittest.TestCase):
    def test_canonical_passthrough(self):
        for pair in ("BTCUSD", "ETHUSD", "XRPUSD", "LTCUSD", "DOTUSD",
                     "XLMUSD", "BATUSD", "NEOUSD"):
            self.assertEqual(canonicalize(pair), pair)

    def test_usdt_aliases_normalized(self):
        cases = {
            "BTCUSDT": "BTCUSD",
            "ETHUSDT": "ETHUSD",
            "XRPUSDT": "XRPUSD",
            "LTCUSDT": "LTCUSD",
            "DOTUSDT": "DOTUSD",
            "XLMUSDT": "XLMUSD",
            "BATUSDT": "BATUSD",
            "NEOUSDT": "NEOUSD",
        }
        for alias, canonical in cases.items():
            self.assertEqual(canonicalize(alias), canonical, alias)

    def test_lowercase_and_whitespace_normalized(self):
        self.assertEqual(canonicalize("btcusdt"), "BTCUSD")
        self.assertEqual(canonicalize(" btcusdt "), "BTCUSD")
        self.assertEqual(canonicalize("ETH usdt"), "ETHUSD")

    def test_unknown_pairs_passthrough(self):
        for pair in ("EURUSD", "USDJPY", "XAUUSD", "GBPUSD", "XYZ123"):
            self.assertEqual(canonicalize(pair), pair)

    def test_empty_string(self):
        self.assertEqual(canonicalize(""), "")

    def test_non_string_returns_empty(self):
        self.assertEqual(canonicalize(None), "")  # type: ignore[arg-type]


class TestSupports(unittest.TestCase):
    def test_supports_canonical_crypto(self):
        self.assertTrue(supports("BTCUSD"))

    def test_supports_usdt_alias(self):
        # The whole point of this change: the USDT alias must register as
        # crypto so MultiSourceClient routes it to Binance, not Twelve Data.
        self.assertTrue(supports("BTCUSDT"))
        self.assertTrue(supports("ethusdt"))

    def test_does_not_support_fx(self):
        self.assertFalse(supports("EURUSD"))
        self.assertFalse(supports("USDJPY"))
        self.assertFalse(supports("XAUUSD"))


class TestMultiSourceCanonicalization(unittest.TestCase):
    """Smoke-test the canonicalization wiring at the MultiSourceClient layer."""

    def _client(self) -> MultiSourceClient:
        # Real BinanceClient + TwelveDataClient are not required — we only
        # check that pair names are routed through canonicalize() before
        # they reach the provider. Stubs satisfy the dataclass signature.
        class _StubProvider:
            calls: list = []

            def fetch_candles(self, pair, tf, limit=None):
                # Record what the routing layer forwarded to us so the test
                # can assert that aliases were canonicalized before they
                # reached the provider.
                type(self).calls.append(pair)
                from scanner.data_types import Candle
                return [Candle(time=1, open=1.0, high=2.0, low=0.5, close=1.5)]

        return MultiSourceClient(fx=_StubProvider(), crypto=_StubProvider())

    def test_snapshot_canonicalizes_input_pair(self):
        client = self._client()
        type(client.crypto).calls = []
        # BTCUSDT (with T) must route to crypto (Binance stub) and produce
        # a populated snapshot whose pair field is the canonical BTCUSD.
        snap = client.fetch_snapshot("BTCUSDT")
        self.assertEqual(snap.pair, "BTCUSD")
        self.assertGreater(len(snap.m15), 0)
        # Every forwarded pair must be in canonical form, never the alias.
        for call_pair in client.crypto.calls:
            self.assertNotIn(call_pair, ("BTCUSDT", "btcusdt"))
            self.assertEqual(call_pair, "BTCUSD")

    def test_snapshot_fx_passthrough(self):
        client = self._client()
        type(client.fx).calls = []
        snap = client.fetch_snapshot("EURUSD")
        # FX pairs must NOT be touched by canonicalize().
        self.assertEqual(snap.pair, "EURUSD")
        # The FX provider received the pair unchanged.
        self.assertIn("EURUSD", client.fx.calls)


if __name__ == "__main__":
    unittest.main()