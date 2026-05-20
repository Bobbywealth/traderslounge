"""End-to-end scoring tests using the spec's Best BUY / Best SELL setups."""
import unittest

from scanner.data_types import Candle, Direction, MarketSnapshot, Tier
from scanner.scoring_engine import MAX_TOTAL, score
from tests.fixtures import trend_candles, zigzag


def _gold_buy_snapshot() -> MarketSnapshot:
    snap = MarketSnapshot(pair="XAUUSD")
    # HTF: all bullish
    snap.d1 = trend_candles(220, 1900, 0.5, step_seconds=86400)
    snap.h4 = trend_candles(220, 1900, 0.5, step_seconds=14400)
    snap.h1 = trend_candles(220, 1900, 0.5, step_seconds=3600)
    # Today daily candle: small range so ADR not exhausted — replace last bar
    last_d1 = snap.d1[-1]
    snap.d1[-1] = Candle(last_d1.time, last_d1.open, last_d1.open + 0.2, last_d1.open - 0.2, last_d1.open + 0.05)

    # LTF: small dip (establishes a low pivot), big up leg, then pullback into
    # the 0.50-0.786 zone with bullish confirm.
    # Up leg 20 * 2.0 = 40, pullback 13 * 2.0 = 26 → ~65% retrace.
    ltf = zigzag([(5, -1.0), (20, +2.0), (13, -2.0)], 1900.0, step_seconds=900)
    # Inject a liquidity-sweep candle: wick below the pullback low, close back above
    sweep_close_above = ltf[-1].close
    sweep = Candle(ltf[-1].time + 900, sweep_close_above, sweep_close_above + 3.0,
                   sweep_close_above - 50.0, sweep_close_above + 2.0)
    ltf.append(sweep)
    # Bullish confirmation candle
    last = ltf[-1]
    ltf.append(Candle(last.time + 900, last.close, last.close + 4.0, last.close - 0.5, last.close + 3.0))
    snap.m15 = ltf
    return snap


def _gold_sell_snapshot() -> MarketSnapshot:
    snap = MarketSnapshot(pair="XAUUSD")
    snap.d1 = trend_candles(220, 2100, -0.5, step_seconds=86400)
    snap.h4 = trend_candles(220, 2100, -0.5, step_seconds=14400)
    snap.h1 = trend_candles(220, 2100, -0.5, step_seconds=3600)
    last_d1 = snap.d1[-1]
    snap.d1[-1] = Candle(last_d1.time, last_d1.open, last_d1.open + 0.2, last_d1.open - 0.2, last_d1.open - 0.05)

    ltf = zigzag([(5, +1.0), (20, -2.0), (13, +2.0)], 2100.0, step_seconds=900)
    sweep_close = ltf[-1].close
    sweep = Candle(ltf[-1].time + 900, sweep_close, sweep_close + 50.0, sweep_close - 3.0, sweep_close - 2.0)
    ltf.append(sweep)
    last = ltf[-1]
    ltf.append(Candle(last.time + 900, last.close, last.close + 0.5, last.close - 4.0, last.close - 3.0))
    snap.m15 = ltf
    return snap


def _no_trade_snapshot() -> MarketSnapshot:
    snap = MarketSnapshot(pair="XAUUSD")
    # Conflicting HTF (mixed) → bias = NEUTRAL, score collapses
    snap.d1 = trend_candles(220, 1900, 0.5, step_seconds=86400)
    snap.h4 = trend_candles(220, 2100, -0.5, step_seconds=14400)
    snap.h1 = trend_candles(220, 1900, 0.5, step_seconds=3600)
    snap.m15 = trend_candles(60, 1950, 0.0, body=0.01, wick=0.05, step_seconds=900)
    return snap


class TestScoringEngine(unittest.TestCase):
    def test_max_total_is_80(self):
        self.assertEqual(MAX_TOTAL, 80)

    def test_best_buy_setup_tradeable(self):
        # Synthetic fixture: hits at least GOOD tier with all primary
        # confluences (HTF + ADR + Fib). STRONG (65+) requires RSI/structure
        # to align too, which is hard to construct with stdlib zigzags;
        # we'll validate STRONG against real historical data in Step 2.
        sig = score(_gold_buy_snapshot())
        self.assertGreaterEqual(sig.confidence_score, 50,
                                f"Expected GOOD+, got {sig.confidence_score} ({sig.reasons})")
        self.assertEqual(sig.direction, Direction.BUY)
        self.assertIn(sig.tier, (Tier.GOOD, Tier.STRONG))
        self.assertGreater(sig.tp1, sig.entry)
        self.assertLess(sig.stop_loss, sig.entry)
        # TPs must be in increasing order for a BUY
        self.assertLess(sig.tp1, sig.tp2)
        self.assertLess(sig.tp2, sig.tp3)

    def test_best_sell_setup_tradeable(self):
        sig = score(_gold_sell_snapshot())
        self.assertGreaterEqual(sig.confidence_score, 50,
                                f"Expected GOOD+, got {sig.confidence_score} ({sig.reasons})")
        self.assertEqual(sig.direction, Direction.SELL)
        self.assertIn(sig.tier, (Tier.GOOD, Tier.STRONG))
        self.assertLess(sig.tp1, sig.entry)
        self.assertGreater(sig.stop_loss, sig.entry)
        # TPs must be in decreasing order for a SELL
        self.assertGreater(sig.tp1, sig.tp2)
        self.assertGreater(sig.tp2, sig.tp3)

    def test_no_confluence_no_trade(self):
        sig = score(_no_trade_snapshot())
        self.assertEqual(sig.tier, Tier.NO_TRADE)
        self.assertEqual(sig.direction, Direction.NEUTRAL)


if __name__ == "__main__":
    unittest.main()
