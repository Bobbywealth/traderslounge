import json
import unittest
from unittest.mock import MagicMock

from scanner.binance_client import BinanceClient
from scanner.data_provider import TwelveDataClient
from scanner.multi_source import MultiSourceClient


class TestMultiSource(unittest.TestCase):
    def test_routes_fx_to_twelvedata(self):
        fx = MagicMock(spec=TwelveDataClient)
        fx.fetch_candles.return_value = []
        crypto = MagicMock(spec=BinanceClient)
        crypto.fetch_candles.return_value = []
        client = MultiSourceClient(fx=fx, crypto=crypto)
        client.fetch_snapshot("XAUUSD")
        self.assertTrue(fx.fetch_candles.called)
        self.assertFalse(crypto.fetch_candles.called)

    def test_routes_crypto_to_binance(self):
        fx = MagicMock(spec=TwelveDataClient)
        fx.fetch_candles.return_value = []
        crypto = MagicMock(spec=BinanceClient)
        crypto.fetch_candles.return_value = []
        client = MultiSourceClient(fx=fx, crypto=crypto)
        client.fetch_snapshot("BTCUSD")
        self.assertTrue(crypto.fetch_candles.called)
        self.assertFalse(fx.fetch_candles.called)

    def test_fetch_candles_single_tf_routes_too(self):
        fx = MagicMock(spec=TwelveDataClient)
        fx.fetch_candles.return_value = []
        crypto = MagicMock(spec=BinanceClient)
        crypto.fetch_candles.return_value = []
        client = MultiSourceClient(fx=fx, crypto=crypto)
        client.fetch_candles("ETHUSD", "M15")
        crypto.fetch_candles.assert_called_once_with("ETHUSD", "M15")
        client.fetch_candles("EURUSD", "M15")
        fx.fetch_candles.assert_called_once_with("EURUSD", "M15")

    def test_per_timeframe_failure_does_not_abort(self):
        from scanner.data_provider import DataProviderError
        crypto = MagicMock(spec=BinanceClient)
        crypto.fetch_candles.side_effect = [
            [],  # D1 ok (empty)
            DataProviderError("H4 boom"),
            [],  # H1
            [],  # M15
        ]
        fx = MagicMock(spec=TwelveDataClient)
        client = MultiSourceClient(fx=fx, crypto=crypto)
        snap = client.fetch_snapshot("BTCUSD")
        self.assertEqual(snap.pair, "BTCUSD")
        self.assertEqual(crypto.fetch_candles.call_count, 4)


if __name__ == "__main__":
    unittest.main()
