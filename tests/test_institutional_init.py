"""Smoke + schema contract tests for the institutional package."""
import unittest

from scanner.data_types import MarketSnapshot
from scanner.modules import institutional
from scanner.modules.institutional import (
    DEFAULT_TIMEFRAMES,
    build_institutional,
)


def _empty_snapshot() -> MarketSnapshot:
    return MarketSnapshot(pair="BTCUSDT")


def _stub_analysis(direction: str = "NEUTRAL", score: float = 50.0) -> dict:
    return {
        "pair": "BTCUSDT",
        "direction": direction,
        "total_score": score,
        "current_price": None,
        "trade_plan": None,
        "data_quality": {"primary_timeframe": "1h"},
        "indicators": {},
        "setup_zones": {},
    }


class TestPackageContract(unittest.TestCase):
    def test_default_timeframes_are_htf_set(self):
        self.assertEqual(DEFAULT_TIMEFRAMES, ["D1", "H4", "H1"])

    def test_build_institutional_returns_all_sections(self):
        result = build_institutional(_stub_analysis(), _empty_snapshot())
        expected = {
            "version",
            "schema_disclaimer",
            "market_structure_mtf",
            "hidden_divergence",
            "macd_interpret",
            "elliott",
            "ab_cd",
            "historical_volatility",
            "scenarios",
            "trade_plans",
            "risk_rating",
            "monitoring",
            "executive_summary",
        }
        self.assertEqual(set(result.keys()), expected)

    def test_no_section_modifies_total_score(self):
        analysis = _stub_analysis(direction="BUY", score=72.0)
        original_score = analysis["total_score"]
        original_direction = analysis["direction"]
        build_institutional(analysis, _empty_snapshot())
        # Build must not mutate the caller's dict.
        self.assertEqual(analysis["total_score"], original_score)
        self.assertEqual(analysis["direction"], original_direction)

    def test_schema_disclaimer_present(self):
        result = build_institutional(_stub_analysis(), _empty_snapshot())
        self.assertIn("schema_disclaimer", result)
        self.assertIn("estimate", result["schema_disclaimer"])

    def test_estimate_kind_tag(self):
        """All estimate-only modules must tag their output kind='estimate'."""
        result = build_institutional(_stub_analysis(), _empty_snapshot())
        for name in ("elliott", "ab_cd", "scenarios"):
            section = result[name]
            if section.get("available"):
                self.assertEqual(section.get("kind"), "estimate",
                                 f"{name} missing kind=estimate")


if __name__ == "__main__":
    unittest.main()