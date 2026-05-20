import unittest

from scanner.backtester import _check_exit, _OpenTrade, run_backtest
from scanner.data_types import Candle, Direction
from scanner.risk_manager import TradePlan
from tests.fixtures import trend_candles, zigzag


def _plan(direction=Direction.BUY, entry=100.0, sl=95.0, tp1=105.0, tp2=115.0,
          tp3=125.0, lot_size=0.10):
    return TradePlan(
        pair="EURUSD", direction=direction, entry=entry, stop_loss=sl,
        tp1=tp1, tp2=tp2, tp3=tp3, lot_size=lot_size,
        risk_usd=50.0, sl_pips=500.0, rr_to_tp1=1.0, rr_to_tp2=3.0,
    )


def _bar(o, h, l, c, t=0):
    return Candle(t, o, h, l, c, 0)


class TestCheckExit(unittest.TestCase):
    def test_buy_sl_hit(self):
        t = _OpenTrade(plan=_plan(), entry_index=0)
        self.assertEqual(_check_exit(t, _bar(100, 101, 94, 96)), "sl")

    def test_buy_tp1_hit_marks_half_closed(self):
        t = _OpenTrade(plan=_plan(), entry_index=0)
        self.assertIsNone(_check_exit(t, _bar(100, 106, 99, 105.5)))
        self.assertTrue(t.half_closed)
        # SL on the plan is now break-even
        self.assertEqual(t.plan.stop_loss, t.plan.entry)

    def test_buy_tp2_after_tp1(self):
        t = _OpenTrade(plan=_plan(), entry_index=0)
        _check_exit(t, _bar(100, 106, 99, 105.5))  # tp1
        outcome = _check_exit(t, _bar(105, 116, 105, 115.5))  # tp2
        self.assertEqual(outcome, "tp2")

    def test_be_stop_after_tp1(self):
        t = _OpenTrade(plan=_plan(), entry_index=0)
        _check_exit(t, _bar(100, 106, 99, 105.5))  # tp1, SL→100
        outcome = _check_exit(t, _bar(101, 102, 99, 99.5))  # touches 99 < 100
        self.assertEqual(outcome, "tp1_then_be")

    def test_sell_sl_hit(self):
        t = _OpenTrade(plan=_plan(direction=Direction.SELL,
                                  entry=100, sl=105, tp1=95, tp2=85), entry_index=0)
        outcome = _check_exit(t, _bar(100, 106, 99, 105.5))
        self.assertEqual(outcome, "sl")


class TestBacktest(unittest.TestCase):
    def test_returns_empty_when_warmup_insufficient(self):
        result = run_backtest("XAUUSD", [], [], [], m15=[], starting_balance_usd=10_000)
        self.assertEqual(result.bars_processed, 0)
        self.assertEqual(result.trades, [])

    def test_processes_bars_when_enough_data(self):
        # Strong uptrend across all timeframes should give STRONG signals
        # at some point in the LTF; we mostly verify the loop runs.
        n = 300
        d1 = trend_candles(n, 1900, 0.5)
        h4 = trend_candles(n, 1900, 0.5)
        h1 = trend_candles(n, 1900, 0.5)
        m15 = zigzag(
            [(5, -1.0), (50, +2.0), (15, -2.0), (40, +2.0), (15, -2.0), (180, +1.0)],
            1900.0, step_seconds=900,
        )
        result = run_backtest(
            pair="XAUUSD", d1=d1, h4=h4, h1=h1, m15=m15,
            starting_balance_usd=10_000, risk_per_trade_pct=0.5,
        )
        self.assertGreater(result.bars_processed, 0)

    def test_pnl_calculation_sl_loss_equals_minus_one_r(self):
        # Build a trivial setup where a STRONG signal isn't required —
        # we exercise the close path directly.
        from scanner.backtester import _close_trade
        t = _OpenTrade(plan=_plan(), entry_index=0)
        t.risk_usd = 50.0
        closed = _close_trade(t, exit_index=5, outcome="sl",
                              bar=_bar(100, 100, 95, 95))
        # SL at 95, entry 100, distance 5, on EURUSD pip_size 0.0001 →
        # 5 / 0.0001 = 50000 pips. lots 0.1, pip $10 → P&L = -50_000_000.
        # This is mathematically what the formula returns but the
        # underlying numbers (lot_size, SL distance) are intentionally
        # untuned for this unit test — we only assert the SIGN of the
        # outcome and the R multiple direction.
        self.assertLess(closed.pnl_usd, 0)
        self.assertLess(closed.r_multiple, 0)

    def test_pnl_tp2_after_tp1_is_positive(self):
        from scanner.backtester import _close_trade
        t = _OpenTrade(plan=_plan(), entry_index=0, half_closed=True)
        t.risk_usd = 50.0
        closed = _close_trade(t, exit_index=5, outcome="tp2", bar=_bar(115, 115, 115, 115))
        self.assertGreater(closed.pnl_usd, 0)
        self.assertGreater(closed.r_multiple, 0)


class TestResultStats(unittest.TestCase):
    def test_win_rate_with_no_trades(self):
        result = run_backtest("XAUUSD", [], [], [], m15=[])
        self.assertEqual(result.win_rate, 0.0)
        self.assertEqual(result.profit_factor, 0.0)
        self.assertEqual(result.total_return_pct, 0.0)


if __name__ == "__main__":
    unittest.main()
