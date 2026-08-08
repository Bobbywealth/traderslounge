import json
import unittest
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError

from scanner.data_types import Direction
from scanner.risk_manager import TradePlan
from scanner.tradelocker_broker import TradeLockerBroker, TradeLockerError


def _plan(pair="XAUUSD", direction=Direction.BUY, entry=1900.0, sl=1880.0,
          tp1=1920.0, tp2=1960.0, tp3=2000.0, lot_size=0.1):
    return TradePlan(
        pair=pair, direction=direction, entry=entry, stop_loss=sl,
        tp1=tp1, tp2=tp2, tp3=tp3, lot_size=lot_size,
        risk_usd=50.0, sl_pips=200.0, rr_to_tp1=1.0, rr_to_tp2=3.0,
    )


def _mock_response(body: dict):
    """Build a fake urlopen response context manager."""
    resp = MagicMock()
    resp.__enter__ = MagicMock(return_value=resp)
    resp.__exit__ = MagicMock(return_value=False)
    resp.read = MagicMock(return_value=json.dumps(body).encode())
    return resp


class TestTradeLockerBroker(unittest.TestCase):
    def setUp(self):
        self.broker = TradeLockerBroker(
            api_key="k", api_secret="s",
            base_url="https://api.example.com",
            account_id="acc1",
        )

    @patch("scanner.tradelocker_broker.urllib.request.urlopen")
    def test_auth_caches_token(self, urlopen):
        urlopen.side_effect = [
            _mock_response({"token": "abc123"}),
            _mock_response({"accounts": [{"id": "acc1", "balance": 5000}]}),
        ]
        balance = self.broker.get_balance()
        self.assertEqual(balance, 5000.0)
        # Second call uses cached token (cached balance, no HTTP)
        balance2 = self.broker.get_balance()
        self.assertEqual(balance2, 5000.0)
        # Only 2 HTTP calls: /auth, /accounts
        self.assertEqual(urlopen.call_count, 2)

    @patch("scanner.tradelocker_broker.urllib.request.urlopen")
    def test_place_order_returns_position(self, urlopen):
        urlopen.side_effect = [
            _mock_response({"token": "abc"}),
            _mock_response({"orderId": "ord-99"}),
        ]
        pos = self.broker.place_market_order(_plan())
        self.assertEqual(pos.id, "ord-99")
        self.assertEqual(pos.pair, "XAUUSD")
        self.assertEqual(pos.direction, Direction.BUY)

    @patch("scanner.tradelocker_broker.urllib.request.urlopen")
    def test_401_triggers_reauth(self, urlopen):
        # First auth, then place_order returns 401, then second auth, then success
        err = HTTPError("u", 401, "unauth", {}, None)
        err.read = MagicMock(return_value=b'{"error":"expired"}')
        urlopen.side_effect = [
            _mock_response({"token": "old"}),
            err,
            _mock_response({"token": "new"}),
            _mock_response({"orderId": "ord-1"}),
        ]
        pos = self.broker.place_market_order(_plan())
        self.assertEqual(pos.id, "ord-1")
        self.assertEqual(self.broker._token, "new")

    @patch("scanner.tradelocker_broker.urllib.request.urlopen")
    def test_non_401_error_raises(self, urlopen):
        err = HTTPError("u", 500, "server boom", {}, None)
        err.read = MagicMock(return_value=b'{"error":"boom"}')
        # Provide enough mock responses for 3 retry attempts
        urlopen.side_effect = [
            _mock_response({"token": "t"}),
            err,
            err,
            err,
        ]
        with self.assertRaises(TradeLockerError):
            self.broker.place_market_order(_plan())

    @patch("scanner.tradelocker_broker.urllib.request.urlopen")
    def test_close_position_full(self, urlopen):
        urlopen.side_effect = [
            _mock_response({"token": "t"}),
            _mock_response({}),
        ]
        self.broker.close_position("ord-1", fraction=1.0)
        # DELETE was called
        req = urlopen.call_args_list[1][0][0]
        self.assertEqual(req.get_method(), "DELETE")
        self.assertIn("/orders/ord-1", req.full_url)

    @patch("scanner.tradelocker_broker.urllib.request.urlopen")
    def test_modify_stop_loss_uses_patch(self, urlopen):
        urlopen.side_effect = [
            _mock_response({"token": "t"}),
            _mock_response({}),
        ]
        self.broker.modify_stop_loss("ord-1", 1895.0)
        req = urlopen.call_args_list[1][0][0]
        self.assertEqual(req.get_method(), "PATCH")
        body = json.loads(req.data.decode())
        self.assertEqual(body["stopLoss"], 1895.0)


if __name__ == "__main__":
    unittest.main()
