import unittest

from scanner.validation_metrics import calibration_report, grouped_calibration, walk_forward_report


class TestCalibrationReport(unittest.TestCase):
    def test_metrics_normalize_percentages_and_measure_quality(self):
        rows = [
            {"forecast_weight": 80, "outcome": "win", "r_multiple": 2, "mae": -0.2},
            {"forecast_weight": 0.2, "outcome": "loss", "r_multiple": -1, "mae_r": 0.4},
            {"forecast_weight": 60, "outcome": 1, "r": 1, "max_adverse_excursion": 0.1},
        ]
        report = calibration_report(rows)
        self.assertEqual(report["sample_size"], 3)
        self.assertAlmostEqual(report["brier_score"], (0.04 + 0.04 + 0.16) / 3)
        self.assertEqual(report["precision"], 1.0)
        self.assertEqual(report["recall"], 1.0)
        self.assertAlmostEqual(report["expectancy_r"], 2 / 3)
        self.assertAlmostEqual(report["average_mae"], (0.2 + 0.4 + 0.1) / 3)
        self.assertEqual(report["max_mae"], 0.4)
        self.assertEqual(len(report["reliability_bins"]), 10)
        self.assertFalse(report["calibrated"])

    def test_empty_and_malformed_rows_are_safe(self):
        report = calibration_report([
            None, "not a row", {}, {"forecast_weight": "nan", "outcome": 1},
            {"forecast_weight": 101, "outcome": 1}, {"forecast_weight": 0.5, "outcome": "maybe"},
        ])
        self.assertEqual(report["sample_size"], 0)
        self.assertEqual(report["brier_score"], 0.0)
        self.assertEqual(report["average_mae"], 0.0)

    def test_calibrated_requires_sample_and_error_thresholds(self):
        good = [{"forecast_weight": 100 if i % 2 else 0, "outcome": i % 2}
                for i in range(30)]
        self.assertTrue(calibration_report(good)["calibrated"])
        self.assertFalse(calibration_report(good[:29])["calibrated"])


class TestGroupedCalibration(unittest.TestCase):
    def test_standard_dimensions_and_asset_pair_alias(self):
        rows = [
            {"forecast_weight": 80, "outcome": 1, "pair": "BTCUSDT", "timeframe": "1h",
             "volatility_regime": "high", "session": "NY", "setup_type": "breakout"},
            {"forecast_weight": 20, "outcome": 0, "asset": "ETH", "timeframe": "4h",
             "volatility_regime": "low", "session": "Asia", "setup_type": "reversal"},
        ]
        dimensions = ["asset/pair", "timeframe", "volatility_regime", "session", "setup_type"]
        grouped = grouped_calibration(rows, dimensions)
        self.assertEqual(grouped["asset/pair"]["BTCUSDT"]["sample_size"], 1)
        self.assertEqual(grouped["asset/pair"]["ETH"]["sample_size"], 1)
        self.assertEqual(grouped["timeframe"]["1h"]["sample_size"], 1)
        self.assertEqual(grouped["setup_type"]["reversal"]["sample_size"], 1)


class TestWalkForwardReport(unittest.TestCase):
    def test_chronological_disjoint_oos_folds_and_metadata(self):
        rows = [
            {"timestamp": f"2026-01-{day:02d}T00:00:00Z", "forecast_weight": 90 if day % 2 else 10,
             "outcome": day % 2}
            for day in range(1, 9)
        ]
        result = walk_forward_report(list(reversed(rows)), folds=3)
        self.assertTrue(result["no_lookahead"])
        self.assertTrue(result["no_lookahead_metadata"]["test_rows_reused"] is False)
        self.assertEqual(result["folds_used"], 3)
        self.assertEqual(sum(fold["test_sample_size"] for fold in result["folds"]), 6)
        for fold in result["folds"]:
            self.assertTrue(fold["train_end_before_test"])
            self.assertLess(fold["train_index_range"][1], fold["test_index_range"][0])
        self.assertEqual(result["out_of_sample"]["sample_size"], 6)

    def test_walk_forward_handles_tiny_or_invalid_input(self):
        result = walk_forward_report([{"forecast_weight": "bad", "outcome": 1}], folds=0)
        self.assertEqual(result["sample_size"], 0)
        self.assertEqual(result["folds_used"], 0)
        self.assertTrue(result["no_lookahead"])


if __name__ == "__main__":
    unittest.main()
