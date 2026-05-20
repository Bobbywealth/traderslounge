import unittest

from scanner.data_types import Direction, Tier
from scanner.risk_manager import (
    RiskManager,
    TradePlan,
    TradeRejection,
    price_distance_to_pips,
)
from scanner.signal import Signal


def _sig(pair="XAUUSD", entry=1900.0, sl=1880.0, tp1=1920.0, tp2=1960.0, tp3=2000.0,
         direction=Direction.BUY):
    return Signal(
        pair=pair, direction=direction, entry=entry, stop_loss=sl,
        tp1=tp1, tp2=tp2, tp3=tp3,
        confidence_score=72, tier=Tier.STRONG,
        reasons=[], risk_level="Low", session="London",
        adr_status="", htf_bias="BUY", pattern="",
    )


class TestPipMath(unittest.TestCase):
    def test_fx_default_pip_size(self):
        # 50 pips on EURUSD = 0.0050
        self.assertAlmostEqual(price_distance_to_pips("EURUSD", 0.0050), 50.0)

    def test_jpy_pip_size(self):
        # 50 pips on USDJPY = 0.50
        self.assertAlmostEqual(price_distance_to_pips("USDJPY", 0.50), 50.0)

    def test_gold_pip_size(self):
        # 20 "pips" on XAUUSD with 0.10 pip size = 2.00 price
        self.assertAlmostEqual(price_distance_to_pips("XAUUSD", 2.00), 20.0)


class TestRiskManagerSizing(unittest.TestCase):
    def setUp(self):
        self.rm = RiskManager(risk_per_trade_pct=0.5)

    def test_basic_lot_size_calculation(self):
        # XAUUSD: 1900 entry, 1880 SL → 20 price = 200 pips (pip size 0.10).
        # Wait: 20 / 0.10 = 200 pips. pip value $10. risk = 10_000 * 0.005 = $50.
        # lots = 50 / (200 * 10) = 0.025 → rounds down to 0.02.
        plan = self.rm.plan_trade(_sig(entry=1900, sl=1880, tp2=1960), 10_000)
        self.assertIsInstance(plan, TradePlan)
        self.assertAlmostEqual(plan.lot_size, 0.02)
        self.assertAlmostEqual(plan.sl_pips, 200.0)
        self.assertAlmostEqual(plan.risk_usd, 50.0)

    def test_scales_with_balance(self):
        # Use EURUSD with a 50-pip SL so even a $1k account can size up.
        s = _sig(pair="EURUSD", entry=1.1000, sl=1.0950, tp1=1.1050,
                 tp2=1.1150, tp3=1.1200)
        small = self.rm.plan_trade(s, 1_000)
        big = self.rm.plan_trade(s, 100_000)
        self.assertIsInstance(small, TradePlan)
        self.assertIsInstance(big, TradePlan)
        self.assertGreater(big.lot_size, small.lot_size)

    def test_rejects_neutral_direction(self):
        s = _sig(direction=Direction.NEUTRAL)
        result = self.rm.plan_trade(s, 10_000)
        self.assertIsInstance(result, TradeRejection)

    def test_rejects_zero_balance(self):
        self.assertIsInstance(self.rm.plan_trade(_sig(), 0), TradeRejection)

    def test_rejects_zero_sl_distance(self):
        s = _sig(entry=1900, sl=1900)
        self.assertIsInstance(self.rm.plan_trade(s, 10_000), TradeRejection)

    def test_rejects_below_min_rr(self):
        # TP2 only 1.5x SL — should fail with min_rr=2
        # XAUUSD entry 1900, SL 1880 (distance 20). TP2 1930 (distance 30) → R:R 1.5
        s = _sig(entry=1900, sl=1880, tp1=1910, tp2=1930, tp3=1940)
        result = self.rm.plan_trade(s, 10_000)
        self.assertIsInstance(result, TradeRejection)
        self.assertIn("R:R", result.reason)

    def test_lot_size_caps_at_max(self):
        rm = RiskManager(risk_per_trade_pct=5.0, max_lot_size=1.0)
        plan = rm.plan_trade(_sig(), 10_000_000)
        self.assertIsInstance(plan, TradePlan)
        self.assertLessEqual(plan.lot_size, 1.0)

    def test_rejects_tiny_sl(self):
        # SL distance < min_sl_pips
        s = _sig(entry=1900.0, sl=1899.95)  # 0.5 pips on gold (pip=0.1)
        result = self.rm.plan_trade(s, 10_000)
        self.assertIsInstance(result, TradeRejection)

    def test_rejects_unknown_pair(self):
        s = _sig(pair="MADEUPPAIR", entry=1.1000, sl=1.0950, tp1=1.1050,
                 tp2=1.1150, tp3=1.1200)
        result = self.rm.plan_trade(s, 10_000)
        self.assertIsInstance(result, TradeRejection)
        self.assertIn("pip value", result.reason)

    def test_constructor_validates_risk_pct(self):
        with self.assertRaises(ValueError):
            RiskManager(risk_per_trade_pct=0)
        with self.assertRaises(ValueError):
            RiskManager(risk_per_trade_pct=10)


if __name__ == "__main__":
    unittest.main()
