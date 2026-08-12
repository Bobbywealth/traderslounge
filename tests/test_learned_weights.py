"""Tests for the learned-confluence-weights module."""
import unittest

from scanner.learned_weights import (
    LearnedWeightsBucket,
    SCORING_CATEGORIES,
    compute_learned_weights,
    find_bucket,
)


def _row(symbol="BTCUSD", direction="BUY", timeframe="1h", session="NY",
         regime="TRENDING", outcome="WIN", r=1.5, components=None):
    return {
        "symbol": symbol,
        "direction": direction,
        "timeframe": timeframe,
        "session": session,
        "market_regime": regime,
        "outcome": outcome,
        "r_multiple": r,
        "score_components": components or {},
    }


class TestComputeLearnedWeights(unittest.TestCase):
    def test_empty_input(self):
        self.assertEqual(compute_learned_weights([]), [])

    def test_single_row_under_min_samples(self):
        rows = [_row(r=1.0)]
        buckets = compute_learned_weights(rows, min_samples=5)
        self.assertEqual(len(buckets), 1)
        self.assertEqual(buckets[0].status, "LIMITED_SAMPLE")
        # Identity weights when not enough data
        for cat in SCORING_CATEGORIES:
            self.assertAlmostEqual(buckets[0].weights[cat], 1.0, places=6)

    def test_status_usable_at_threshold(self):
        rows = [_row(r=1.0)] * 30
        buckets = compute_learned_weights(rows, min_samples=30)
        self.assertEqual(buckets[0].status, "USABLE")
        self.assertEqual(buckets[0].sample_size, 30)

    def test_win_rate_calculation(self):
        rows = [_row(outcome="WIN", r=1.0)] * 7 + [_row(outcome="LOSS", r=-1.0)] * 3
        buckets = compute_learned_weights(rows, min_samples=5)
        self.assertEqual(buckets[0].sample_size, 10)
        self.assertAlmostEqual(buckets[0].win_rate, 0.7, places=2)

    def test_avg_r_calculation(self):
        rows = [_row(r=1.0)] * 4 + [_row(r=-0.5)] * 4
        buckets = compute_learned_weights(rows, min_samples=5)
        self.assertAlmostEqual(buckets[0].avg_r, 0.25, places=2)

    def test_multiple_buckets_by_dimension(self):
        rows = (
            [_row(symbol="BTCUSD", session="NY", regime="TRENDING")] * 30 +
            [_row(symbol="EURUSD", session="London", regime="RANGING")] * 30
        )
        buckets = compute_learned_weights(rows, min_samples=30)
        self.assertEqual(len(buckets), 2)
        keys = {(b.instrument, b.session, b.regime) for b in buckets}
        self.assertIn(("BTCUSD", "NY", "TRENDING"), keys)
        self.assertIn(("EURUSD", "LONDON", "RANGING"), keys)

    def test_weights_normalised_to_mean_one(self):
        rows = [_row(r=1.0, components={
            "structure": 8, "momentum": 6, "moving_averages": 9,
            "fibonacci": 3, "patterns": 5, "volatility": 4,
            "volume": 7, "relative_strength": 6, "liquidity": 5,
        })] * 30
        buckets = compute_learned_weights(rows, min_samples=30)
        mean = sum(buckets[0].weights.values()) / len(buckets[0].weights)
        # Mean should be very close to 1.0 (normalised).
        self.assertAlmostEqual(mean, 1.0, places=3)

    def test_weights_bounded(self):
        rows = [_row(r=1.0, components={"structure": 100})] * 30
        buckets = compute_learned_weights(rows, min_samples=30)
        for w in buckets[0].weights.values():
            self.assertGreaterEqual(w, 0.4)
            self.assertLessEqual(w, 2.0)

    def test_skip_unresolved_rows(self):
        rows = [
            _row(outcome="WIN"),
            {"symbol": "BTCUSD"},  # no outcome at all
        ]
        buckets = compute_learned_weights(rows)
        # The unresolved row is dropped; only the WIN row is counted.
        self.assertEqual(len(buckets), 1)
        self.assertEqual(buckets[0].sample_size, 1)


class TestFindBucket(unittest.TestCase):
    def setUp(self):
        rows = (
            [_row(symbol="BTCUSD", session="NY", regime="TRENDING")] * 30 +
            [_row(symbol="BTCUSD", session="London", regime="RANGING")] * 30
        )
        self.buckets = compute_learned_weights(rows, min_samples=30)

    def test_exact_match(self):
        b = find_bucket(self.buckets, "BTCUSD", "1h", "NY", "TRENDING")
        self.assertIsNotNone(b)
        self.assertEqual(b.instrument, "BTCUSD")

    def test_relaxes_session(self):
        b = find_bucket(self.buckets, "BTCUSD", "1h", "Asia", "TRENDING")
        self.assertIsNotNone(b)
        self.assertEqual(b.session, "NY")

    def test_relaxes_regime(self):
        b = find_bucket(self.buckets, "BTCUSD", "1h", "NY", "BREAKOUT")
        self.assertIsNotNone(b)
        self.assertEqual(b.regime, "TRENDING")

    def test_relaxes_both(self):
        b = find_bucket(self.buckets, "BTCUSD", "1h", "Asia", "BREAKOUT")
        self.assertIsNotNone(b)

    def test_returns_none_for_missing_instrument(self):
        b = find_bucket(self.buckets, "EURUSD", "1h", "NY", "TRENDING")
        self.assertIsNone(b)


if __name__ == "__main__":
    unittest.main()
