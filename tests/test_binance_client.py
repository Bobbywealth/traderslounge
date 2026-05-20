import json
import unittest
from unittest.mock import MagicMock

from scanner.binance_client import (
    BINANCE_SYMBOL_MAP,
    BINANCE_TF_MAP,
    BinanceClient,
    _parse_klines,
    supports,
)
from scanner.data_provider import DataProviderError


SAMPLE_KLINES = [
    # [openTime_ms, open, high, low, close, volume, closeTime, ...]
    [1_716_000_000_000, "60000.0", "60500.0", "59800.0", "60300.0", "12.5",
     1_716_000_899_999, "750000", 100, "6.0", "360000", "0"],
    [1_716_000_900_000, "60300.0", "60800.0", "60200.0", "60700.0", "10.0",
     1_716_001_799_999, "600000", 80, "5.0", "300000", "0"],
]


class TestSupports(unittest.TestCase):
    def test_known_crypto_supported(self):
        for p in ("BTCUSD", "ETHUSD", "XRPUSD", "LTCUSD",
                  "DOTUSD", "XLMUSD", "BATUSD", "NEOUSD"):
            self.assertTrue(supports(p), p)

    def test_fx_not_supported(self):
        self.assertFalse(supports("XAUUSD"))
        self.assertFalse(supports("EURUSD"))


class TestParse(unittest.TestCase):
    def test_klines_parse_chronological(self):
        candles = _parse_klines(SAMPLE_KLINES)
        self.assertEqual(len(candles), 2)
        self.assertLess(candles[0].time, candles[1].time)
        self.assertAlmostEqual(candles[1].close, 60700.0)

    def test_skips_malformed_rows(self):
        bad = [["not", "enough"]]
        self.assertEqual(_parse_klines(bad), [])


class TestClient(unittest.TestCase):
    def test_happy_path(self):
        http = MagicMock(return_value=json.dumps(SAMPLE_KLINES))
        c = BinanceClient(http=http)
        candles = c.fetch_candles("BTCUSD", "M15")
        self.assertEqual(len(candles), 2)
        url = http.call_args[0][0]
        self.assertIn("symbol=BTCUSDT", url)
        self.assertIn("interval=15m", url)

    def test_unknown_pair_raises(self):
        c = BinanceClient(http=MagicMock())
        with self.assertRaises(DataProviderError):
            c.fetch_candles("BOGUSCOIN", "M15")

    def test_unknown_timeframe_raises(self):
        c = BinanceClient(http=MagicMock())
        with self.assertRaises(DataProviderError):
            c.fetch_candles("BTCUSD", "M99")

    def test_binance_error_payload_raises(self):
        c = BinanceClient(http=lambda u, t: json.dumps({"code": -1121, "msg": "Invalid symbol"}))
        with self.assertRaises(DataProviderError):
            c.fetch_candles("BTCUSD", "M15")

    def test_maps_cover_all_spec_pairs(self):
        for p in ("BTCUSD", "ETHUSD", "XRPUSD", "LTCUSD",
                  "DOTUSD", "XLMUSD", "BATUSD", "NEOUSD"):
            self.assertIn(p, BINANCE_SYMBOL_MAP)
        for tf in ("D1", "H4", "H1", "M15", "M5", "M1"):
            self.assertIn(tf, BINANCE_TF_MAP)


if __name__ == "__main__":
    unittest.main()
