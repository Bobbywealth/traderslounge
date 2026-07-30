import unittest

from scanner.institutional_confidence import build_data_provenance, build_institutional_confidence
from scanner.portfolio_risk import portfolio_adjustment, portfolio_heat, position_size


class InstitutionalConfidenceTest(unittest.TestCase):
    def test_score_is_explainable_and_not_probability(self):
        analysis = {
            "direction": "BUY",
            "current_price": 100,
            "category_breakdown": {"structure": 20, "momentum": 15},
            "market_context": {"opposing_frames": []},
            "indicators": {"rsi": 60, "macd": 1.2, "atr": 2},
            "liquidity": {"provider_backed": False, "zones": [98, 105]},
            "trade_timing": {"status": "READY", "regime": {"name": "TRENDING"}},
            "trade_plan": {"eligible": True, "entry": 100, "stop": 98},
        }
        result = build_institutional_confidence(analysis, {"status": "CLEAR"})
        self.assertGreater(result["score"], 0)
        self.assertFalse(result["is_probability"])
        self.assertFalse(result["position_sizing_allowed"])
        self.assertEqual(result["decision_state"], "READY")
        self.assertTrue(result["components"])

    def test_blocked_calendar_forces_blocked_state(self):
        result = build_institutional_confidence(
            {"direction": "BUY", "trade_timing": {"status": "READY"}, "trade_plan": {"eligible": True}},
            {"status": "BLOCKED"},
        )
        self.assertEqual(result["decision_state"], "BLOCKED")

    def test_provenance_does_not_claim_order_flow_without_provider(self):
        provenance = build_data_provenance({"current_price": 100, "order_flow": {"imbalance": 2}})
        order_flow = next(item for item in provenance["items"] if item["key"] == "order_flow")
        self.assertEqual(order_flow["status"], "unavailable")
        self.assertEqual(order_flow["source_type"], "unavailable_provider_data")


class PortfolioRiskTest(unittest.TestCase):
    def test_position_size_uses_fixed_risk_budget(self):
        result = position_size(account_equity=10000, max_risk_pct=0.5, entry=100, stop=98)
        self.assertEqual(result["risk_budget"], 50.0)
        self.assertEqual(result["recommended_units"], 25.0)
        self.assertFalse(result["confidence_used_to_raise_risk"])

    def test_costs_reduce_position_size(self):
        without_costs = position_size(account_equity=10000, max_risk_pct=0.5, entry=100, stop=98)
        with_costs = position_size(
            account_equity=10000,
            max_risk_pct=0.5,
            entry=100,
            stop=98,
            spread_bps=10,
            slippage_bps=10,
            fee_bps_round_trip=10,
        )
        self.assertLess(with_costs["recommended_units"], without_costs["recommended_units"])

    def test_portfolio_heat_detects_concentration(self):
        heat = portfolio_heat([
            {"symbol": "BTC/USD", "direction": "LONG", "risk_pct": 0.5, "correlation_group": "CRYPTO"},
            {"symbol": "ETH/USD", "direction": "LONG", "risk_pct": 0.5, "correlation_group": "CRYPTO"},
            {"symbol": "SOL/USD", "direction": "LONG", "risk_pct": 0.5, "correlation_group": "CRYPTO"},
        ])
        self.assertEqual(heat["concentration_status"], "HIGH")
        adjustment = portfolio_adjustment(heat, max_portfolio_heat_pct=2.0)
        self.assertEqual(adjustment["new_trade_exposure_multiplier"], 0.5)


if __name__ == "__main__":
    unittest.main()
