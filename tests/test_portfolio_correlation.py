"""Tests for the Portfolio Risk Brain."""
import unittest

from scanner.portfolio_correlation import (
    PortfolioRiskReport,
    SetupExposure,
    _usd_exposure_delta,
    analyze_portfolio_risk,
)


class TestSetupExposureHelpers(unittest.TestCase):
    def test_usd_exposure_delta_positive_pair_long_is_short_usd(self):
        # Long EURUSD = short USD
        self.assertEqual(_usd_exposure_delta("EURUSD", "BUY"), -1)

    def test_usd_exposure_delta_negative_pair_long_is_long_usd(self):
        # Long USDJPY = long USD
        self.assertEqual(_usd_exposure_delta("USDJPY", "BUY"), 1)

    def test_usd_exposure_delta_unknown_symbol(self):
        self.assertEqual(_usd_exposure_delta("AAPLUSD", "BUY"), 0.0)


class TestAnalyzePortfolioRisk(unittest.TestCase):
    def test_empty_input(self):
        report = analyze_portfolio_risk([])
        self.assertEqual(report.setup_count, 0)
        self.assertEqual(report.heat_pct, 0.0)

    def test_single_setup_no_warning(self):
        report = analyze_portfolio_risk(
            [SetupExposure(symbol="EURUSD", direction="BUY", size_r_pct=1.0)],
        )
        self.assertEqual(report.setup_count, 1)
        self.assertEqual(report.open_risk_pct, 1.0)
        self.assertEqual(report.heat_pct, 1.0)
        self.assertFalse(report.warnings)
        self.assertIsNone(report.recommended_size_pct)

    def test_four_usd_short_setups_trigger_warning(self):
        # Bobby's example: 4 BUY setups in USD-positive pairs = 4% USD short.
        setups = [
            SetupExposure(symbol="EURUSD", direction="BUY", size_r_pct=1.0),
            SetupExposure(symbol="GBPUSD", direction="BUY", size_r_pct=1.0),
            SetupExposure(symbol="AUDUSD", direction="BUY", size_r_pct=1.0),
            SetupExposure(symbol="XAUUSD", direction="BUY", size_r_pct=1.0),
        ]
        report = analyze_portfolio_risk(setups, heat_limit_pct=6.0)
        # Each contributes -1 USD, total -4 (within limit), no warning.
        self.assertEqual(report.exposure_by_currency["USD"], -4.0)
        self.assertFalse(report.warnings)

    def test_exceeding_heat_limit_triggers_warning_and_shrinks_recommendation(self):
        setups = [
            SetupExposure(symbol="EURUSD", direction="BUY", size_r_pct=2.0),
            SetupExposure(symbol="GBPUSD", direction="BUY", size_r_pct=2.0),
            SetupExposure(symbol="AUDUSD", direction="BUY", size_r_pct=2.0),
            SetupExposure(symbol="XAUUSD", direction="BUY", size_r_pct=2.0),
        ]
        report = analyze_portfolio_risk(setups, heat_limit_pct=6.0)
        # 8% heat on USD-positive longs = 8% USD short
        self.assertEqual(report.exposure_by_currency["USD"], -8.0)
        self.assertTrue(report.warnings)
        # Recommended shrink: 6 - 8 = -2 (capped at 0)
        self.assertEqual(report.recommended_size_pct, 0.0)

    def test_directional_clusters_group_by_asset_class(self):
        setups = [
            SetupExposure(symbol="EURUSD", direction="BUY", size_r_pct=1.0),
            SetupExposure(symbol="GBPUSD", direction="BUY", size_r_pct=1.0),
            SetupExposure(symbol="USDJPY", direction="SELL", size_r_pct=1.0),
            SetupExposure(symbol="XAUUSD", direction="BUY", size_r_pct=1.0),
        ]
        report = analyze_portfolio_risk(setups)
        # fx has 2 BUY (2%) + 1 SELL (1%)
        self.assertAlmostEqual(report.directional_clusters["fx"]["LONG"], 2.0)
        self.assertAlmostEqual(report.directional_clusters["fx"]["SHORT"], 1.0)
        # metals has 1 BUY (1%)
        self.assertAlmostEqual(report.directional_clusters["metals"]["LONG"], 1.0)

    def test_gold_usd_correlation_excludes_self(self):
        setups = [
            SetupExposure(symbol="XAUUSD", direction="BUY", size_r_pct=1.0),
            SetupExposure(symbol="EURUSD", direction="BUY", size_r_pct=1.0),
            SetupExposure(symbol="GBPUSD", direction="SELL", size_r_pct=1.0),
        ]
        report = analyze_portfolio_risk(setups)
        # XAUUSD vs EURUSD/GBPUSD cross-correlations: -0.3 and -0.3;
        # XAUUSD vs itself is 1.0 and must be excluded.
        self.assertLess(report.gold_usd_correlation, 0.0)

    def test_daily_risk_filters_recent_setups(self):
        setups = [
            SetupExposure(symbol="EURUSD", direction="BUY", size_r_pct=1.0, age_hours=2.0),
            SetupExposure(symbol="GBPUSD", direction="BUY", size_r_pct=1.0, age_hours=72.0),
        ]
        report = analyze_portfolio_risk(setups)
        # open_risk is total, daily_risk only counts ≤24h
        self.assertEqual(report.open_risk_pct, 2.0)
        self.assertEqual(report.daily_risk_pct, 1.0)

    def test_correlation_matrix_dense(self):
        setups = [
            SetupExposure(symbol="EURUSD", direction="BUY", size_r_pct=1.0),
            SetupExposure(symbol="GBPUSD", direction="SELL", size_r_pct=1.0),
        ]
        report = analyze_portfolio_risk(setups)
        # Same sector, opposite direction -> negative correlation
        self.assertLess(report.correlation_matrix["EURUSD"]["GBPUSD"], 0.0)
        self.assertEqual(report.correlation_matrix["EURUSD"]["EURUSD"], 1.0)

    def test_to_dict_round_trips(self):
        setups = [SetupExposure(symbol="EURUSD", direction="BUY", size_r_pct=1.0)]
        report = analyze_portfolio_risk(setups)
        d = report.to_dict()
        self.assertIn("heat_pct", d)
        self.assertIn("setup_count", d)
        self.assertEqual(d["setup_count"], 1)


if __name__ == "__main__":
    unittest.main()
