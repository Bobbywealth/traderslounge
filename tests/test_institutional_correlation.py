"""Tests for §15 Correlation and §16 Relative Strength modules."""
import unittest
from unittest.mock import MagicMock

from scanner.data_types import Candle
from scanner.modules.institutional import correlation, relative_strength


def _make_candles(n: int, start: float, step: float, step_seconds: int = 3600
                   ) -> list:
    out = []
    price = start
    for i in range(n):
        o, c = price, price + step
        out.append(Candle(1_700_000_000 + i * step_seconds,
                          o, max(o, c) + 0.1, min(o, c) - 0.1, c))
        price = c
    return out


class _StubClient:
    def __init__(self, candles_by_pair):
        self._candles = candles_by_pair

    def fetch_candles(self, pair, tf, limit=None):
        return self._candles.get(pair, [])


class TestCorrelation(unittest.TestCase):
    def test_perfect_correlation_identical_series(self):
        candles = _make_candles(60, 100.0, 0.5)
        client = _StubClient({"BTCUSD": candles, "ETHUSD": candles})
        out = correlation.compute({"pair": "BTCUSD"}, market_client=client)
        self.assertTrue(out["available"])
        # Identical series → correlation 1.0
        v = out["matrix"]["BTCUSD_vs_ETHUSD"]
        self.assertIsNotNone(v)
        self.assertAlmostEqual(v, 1.0, places=2)

    def test_no_client_returns_unavailable(self):
        out = correlation.compute({"pair": "BTCUSD"}, market_client=None)
        self.assertFalse(out["available"])

    def test_paid_provider_gaps_listed(self):
        out = correlation.compute({"pair": "BTCUSD"}, market_client=None)
        for key in ("spx_correlation", "nasdaq_correlation",
                    "dxy_correlation", "ust_yield_correlation"):
            self.assertIn(key, out["unavailable"])


class TestRelativeStrength(unittest.TestCase):
    def test_btc_btc_is_zero(self):
        candles = _make_candles(30, 100.0, 0.1)
        client = _StubClient({"BTCUSD": candles})
        out = relative_strength.compute({"pair": "BTCUSD"},
                                        market_client=client)
        self.assertTrue(out["available"])
        self.assertEqual(out["benchmark"], "BTCUSD")
        self.assertEqual(out["rs_pct_24h"], 0.0)

    def test_outperformer_is_leader(self):
        btc = _make_candles(30, 100.0, 0.5)   # 1.5% up over the window
        eth = _make_candles(30, 100.0, 0.1)   # 0.3% up
        client = _StubClient({
            "BTCUSD": btc, "ETHUSD": eth, "XRPUSD": _make_candles(30, 100.0, -0.2),
        })
        out = relative_strength.compute({"pair": "BTCUSD"}, market_client=client)
        self.assertEqual(out["benchmark"], "BTCUSD")
        # BTC vs BTC is always zero — the leader signal comes from the
        # ranking being higher than everyone else, not from rs_pct.
        self.assertEqual(out["rs_pct_24h"], 0.0)
        self.assertEqual(out["leadership"], "leader")
        # Sanity: ETH underperforms BTC.
        self.assertLess(out["ranking"]["ETHUSD"], 0)

    def test_no_client_returns_unavailable(self):
        out = relative_strength.compute({"pair": "BTCUSD"}, market_client=None)
        self.assertFalse(out["available"])

    def test_fx_pair_uses_usdjpy_benchmark(self):
        out = relative_strength.compute({"pair": "EURUSD"}, market_client=None)
        self.assertEqual(out["benchmark"], "USDJPY")


if __name__ == "__main__":
    unittest.main()