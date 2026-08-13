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



class TestPortfolioHeatGate(unittest.TestCase):
    """Portfolio-level heat check: a single setup that would push total
    open risk past the configured limit gets REDUCED (shrink-to-fit) or
    REJECTED (if shrink would be below the minimum reduction threshold)."""

    def _setup(self):
        from scanner.autonomy.risk.risk_manager import (
            RiskManager, PositionInfo, RiskDecision, RiskConfig,
        )
        return RiskManager, PositionInfo, RiskDecision, RiskConfig

    def test_single_setup_below_heat_approves(self):
        RiskManager, PositionInfo, RiskDecision, RiskConfig = self._setup()
        mgr = RiskManager(RiskConfig(portfolio_heat_limit_pct=6.0))
        result = mgr.evaluate(
            setup_symbol="BTCUSD",
            setup_direction="BUY",
            setup_score=70,
            setup_entry=100.0,
            setup_stop=99.0,
            setup_tp1=102.0,
            setup_net_rr=2.0,
            open_positions=[],
        )
        self.assertEqual(result.decision, RiskDecision.APPROVED)
        self.assertAlmostEqual(result.risk_per_trade_pct, 1.0, places=3)

    def test_projected_heat_over_limit_returns_reduced(self):
        RiskManager, PositionInfo, RiskDecision, RiskConfig = self._setup()
        # heat_limit=5%, max_risk=1%, max_concurrent=20 so step 6 doesn't fire.
        # 5 open positions = 5% current heat; new setup at 1% pushes
        # projected to 6% which exceeds the 5% limit.  Available 0.5%
        # > min_reduction 0.1% so REDUCED, not REJECTED.
        mgr = RiskManager(RiskConfig(
            portfolio_heat_limit_pct=5.5,
            max_risk_per_trade_pct=1.0,
            max_concurrent_positions=20,
        ))
        open_pos = [
            PositionInfo(position_id=f"p{i}", symbol=f"SYM{i}", direction="BUY")
            for i in range(5)
        ]
        result = mgr.evaluate(
            setup_symbol="EURUSD",
            setup_direction="BUY",
            setup_score=70,
            setup_entry=1.1000,
            setup_stop=1.0900,  # ~0.91% risk (under max_risk 1%)
            setup_tp1=1.1200,
            setup_net_rr=2.0,
            open_positions=open_pos,
        )
        self.assertEqual(result.decision, RiskDecision.REDUCED)
        self.assertLess(result.risk_per_trade_pct, 1.0)
        self.assertGreater(result.risk_per_trade_pct, 0)
        self.assertTrue(any("CORRELATION RISK" in r for r in result.reasons))

    def test_heat_exceeds_limit_by_lot_returns_rejected(self):
        RiskManager, PositionInfo, RiskDecision, RiskConfig = self._setup()
        # heat_limit=5%, 6 open positions = 6% current heat; new setup
        # at 1% risk pushes to 7%, available headroom 0% which is
        # below the min_reduction threshold → REJECTED.
        mgr = RiskManager(RiskConfig(
            portfolio_heat_limit_pct=5.5,
            max_risk_per_trade_pct=1.0,
            max_concurrent_positions=20,
        ))
        open_pos = [
            PositionInfo(position_id=f"p{i}", symbol=f"SYM{i}", direction="BUY")
            for i in range(6)
        ]
        result = mgr.evaluate(
            setup_symbol="EURUSD",
            setup_direction="BUY",
            setup_score=70,
            setup_entry=1.1000,
            setup_stop=1.0900,  # ~0.91% risk (under max_risk 1%)
            setup_tp1=1.1200,
            setup_net_rr=2.0,
            open_positions=open_pos,
        )
        self.assertEqual(result.decision, RiskDecision.REJECTED)
        self.assertTrue(any("heat" in r.lower() for r in result.reasons))

    def test_recommended_size_matches_bobby_example(self):
        """Bobby's example: 2.1% USD exposure already, new setup at 1% risk
        would push to 3.1%.  Heat limit 6% so plenty of headroom.
        Expected: APPROVED, not REDUCED."""
        RiskManager, PositionInfo, RiskDecision, RiskConfig = self._setup()
        mgr = RiskManager(RiskConfig(
            portfolio_heat_limit_pct=6.0,
            max_concurrent_positions=20,
        ))
        # Approximate 2.1% USD exposure as 2-3 open positions (each ~1%)
        open_pos = [
            PositionInfo(position_id="p1", symbol="EURUSD", direction="BUY"),
            PositionInfo(position_id="p2", symbol="GBPUSD", direction="BUY"),
        ]
        result = mgr.evaluate(
            setup_symbol="XAUUSD",
            setup_direction="BUY",
            setup_score=70,
            setup_entry=2300.0,
            setup_stop=2277.0,  # ~1.0% risk, under max_risk_per_trade_pct=1%
            setup_tp1=2350.0,
            setup_net_rr=2.0,
            open_positions=open_pos,
        )
        # 2% current + 1% proposed = 3%, under 6% — APPROVED
        self.assertEqual(result.decision, RiskDecision.APPROVED)


if __name__ == "__main__":
    unittest.main()
if __name__ == "__main__":
    unittest.main()
