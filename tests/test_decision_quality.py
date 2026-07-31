import copy
import unittest

from scanner.decision_quality import (
    SCENARIO_WEIGHT_DISCLAIMER,
    attach_decision_quality,
    build_evidence_ledger,
)


def analysis_fixture():
    return {
        "direction": "BUY",
        "total_score": 74,
        "current_price": 100.0,
        "market_context": {"opposing_frames": []},
        "trade_timing": {"status": "READY"},
        "liquidity": {"status": "available"},
        "trade_plan": {
            "eligible": True,
            "entry": 100.0,
            "stop": 95.0,
            "atr": 2.5,
            "net_rr": 2.4,
            "spread_assumption_bps": 8,
            "slippage_assumption_bps": 4,
        },
        "scenarios": {"bull": {"probability_pct": 99.0}},
    }


class TestDecisionQuality(unittest.TestCase):
    def test_preserves_canonical_fields_and_separates_components(self):
        analysis = analysis_fixture()
        original = copy.deepcopy(analysis)
        enriched = attach_decision_quality(
            analysis,
            calendar={"status": "CLEAR", "proximity_minutes": 120},
            portfolio={"correlation": 0.3},
            historical_stats={"max_drawdown": -0.12},
        )

        self.assertEqual(enriched["direction"], "BUY")
        self.assertEqual(enriched["total_score"], 74)
        # attach_decision_quality deliberately caps account_risk_percent by the
        # financial risk profile and records where that cap came from, so the
        # enriched plan is not byte-identical. What must hold is that every
        # canonical field survives untouched and the input is not mutated.
        for field in ("eligible", "entry", "stop", "atr", "net_rr",
                      "spread_assumption_bps", "slippage_assumption_bps"):
            self.assertEqual(enriched["trade_plan"][field], original["trade_plan"][field], field)
        self.assertLessEqual(enriched["trade_plan"]["account_risk_percent"],
                             original["trade_plan"].get("account_risk_percent", float("inf")))
        self.assertFalse(enriched["trade_plan"]["scenario_weights_used_for_sizing"])
        self.assertEqual(analysis, original)
        quality = enriched["decision_quality"]
        self.assertEqual(
            {"market_bias_confidence", "setup_quality", "execution_readiness"},
            {key for key in quality if key in {"market_bias_confidence", "setup_quality", "execution_readiness"}},
        )
        self.assertIn("uncalibrated", quality["scenario_weight_disclaimer"].lower())
        self.assertEqual(quality["scenario_weight_disclaimer"], SCENARIO_WEIGHT_DISCLAIMER)

    def test_ledger_contains_positive_negative_entries_and_final_score(self):
        analysis = analysis_fixture()
        analysis["market_context"] = {"opposing_frames": ["H4"]}
        analysis["trade_timing"] = {"status": "AVOID"}
        ledger = build_evidence_ledger(analysis, {"status": "BLOCKED"})

        self.assertTrue(any(item["points"] > 0 for item in ledger["entries"]))
        self.assertTrue(any(item["points"] < 0 for item in ledger["entries"]))
        self.assertGreaterEqual(ledger["final_setup_score"], 0)
        self.assertLessEqual(ledger["final_setup_score"], 100)

    def test_scenario_weights_never_affect_exposure(self):
        first = analysis_fixture()
        second = analysis_fixture()
        second["scenarios"] = {"bull": {"probability_pct": 1.0}, "bear": {"probability_pct": 99.0}}
        kwargs = {
            "calendar": {"status": "CLEAR"},
            "portfolio": {"correlation": 0.2},
            "historical_stats": {"max_drawdown": -0.1},
        }
        one = attach_decision_quality(first, **kwargs)
        two = attach_decision_quality(second, **kwargs)
        self.assertEqual(
            one["decision_quality"]["financial_risk_profile"]["max_recommended_account_exposure_pct"],
            two["decision_quality"]["financial_risk_profile"]["max_recommended_account_exposure_pct"],
        )

    def test_blocked_gate_has_no_recommended_exposure_and_missing_inputs_are_explicit(self):
        analysis = analysis_fixture()
        analysis["trade_plan"]["eligible"] = False
        result = attach_decision_quality(analysis, calendar={"status": "BLOCKED"})
        risk = result["decision_quality"]["financial_risk_profile"]

        self.assertEqual(risk["max_recommended_account_exposure_pct"], 0.0)
        self.assertEqual(risk["news_status"], "BLOCKED")
        self.assertFalse(risk["portfolio_correlation_available"])
        self.assertFalse(risk["historical_drawdown_available"])
        self.assertEqual(risk["stop_pct"], 5.0)
        self.assertEqual(risk["atr_normalized_stop"], 2.0)
        self.assertEqual(risk["spread_bps"], 8.0)
        self.assertEqual(risk["slippage_bps"], 4.0)


if __name__ == "__main__":
    unittest.main()
