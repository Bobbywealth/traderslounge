"""Regression tests for the V2 walk-forward backtester.

The production backtest endpoint started returning 502
``"V2 backtest unavailable: unhashable type: 'dict'"`` because
``build_trade_plan`` emits structured reason dicts and the backtester
was inserting them directly as ``defaultdict`` keys. This test pins
that contract so a future refactor of either side can't reintroduce the
crash.
"""
import unittest
from datetime import datetime, timedelta, timezone

from scanner.data_types import Candle, MarketSnapshot
from scanner.v2_backtester import _reason_key, run_v2_backtest


def _trending_candles(start: datetime, count: int, step: timedelta, *, base: float = 100.0, drift: float = 0.05) -> list:
    """Synthesize a trending series with healthy ATR so a plan is buildable."""
    candles = []
    price = base
    for i in range(count):
        ts = int((start + step * i).timestamp())
        # Oscillate around a slow uptrend so structure/volume/HTF score is non-zero.
        swing = (1 if i % 2 == 0 else -1) * 0.6
        open_p = price
        close_p = price + drift + swing
        high_p = max(open_p, close_p) + 0.4
        low_p = min(open_p, close_p) - 0.4
        candles.append(Candle(time=ts, open=open_p, high=high_p, low=low_p, close=close_p, volume=1000.0))
        price = close_p
    return candles


class ReasonKeyTest(unittest.TestCase):
    def test_structured_dict_uses_code(self):
        reason = {"code": "score_below_threshold", "message": "ignored when code present", "severity": "low"}
        self.assertEqual(_reason_key(reason), "score_below_threshold")

    def test_structured_dict_without_code_uses_message(self):
        reason = {"message": "calendar blocked"}
        self.assertEqual(_reason_key(reason), "calendar blocked")

    def test_plain_string_is_passthrough(self):
        self.assertEqual(_reason_key("score_below_threshold"), "score_below_threshold")

    def test_unrecognized_object_does_not_raise(self):
        # Anything else must not raise — the bucketing is best-effort.
        self.assertIsInstance(_reason_key(object()), str)


class V2BacktestSmokeTest(unittest.TestCase):
    """A small end-to-end run that exercises the bucketing path.

    We don't claim the strategy is profitable here — we only verify that
    ``run_v2_backtest`` finishes without raising ``TypeError`` and
    returns a report shape. This is the regression for the production 502.
    """

    def test_run_does_not_raise_on_structured_reasons(self):
        start = datetime(2024, 1, 1, tzinfo=timezone.utc)
        step = timedelta(hours=1)
        # Enough bars for H1 replay to find a couple of candidates and
        # multiple rejection reasons without being slow.
        d1 = _trending_candles(start, 80, timedelta(days=1), drift=0.6)
        h4 = _trending_candles(start, 480, timedelta(hours=4), drift=0.4)
        h1 = _trending_candles(start, 1920, timedelta(hours=1), drift=0.3)
        m15 = _trending_candles(start, 7680, timedelta(minutes=15), drift=0.2)

        report = run_v2_backtest(
            "BTCUSD",
            d1,
            h4,
            h1,
            m15,
            stride=4,
            maximum_holding_bars=12,
            timeframe="1h",
            round_trip_cost_bps=24.0,
        )
        self.assertEqual(report["pair"], "BTCUSD")
        self.assertEqual(report["timeframe"], "1h")
        self.assertIn("overall", report)
        # The blocked-reason bucket must itself be a plain dict of
        # string → int (hashable keys, integer counts). If the bucketing
        # is broken the response would have raised before reaching here.
        self.assertIsInstance(report.get("rules"), dict)
        self.assertGreaterEqual(report.get("bars", 0), 1)
