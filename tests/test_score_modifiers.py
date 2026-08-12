"""Tests for the regime + learned-weights score modifier pipeline."""
import unittest

from scanner.learned_weights import LearnedWeightsBucket
from scanner.regime_taxonomy import RegimeState
from scanner.score_modifiers import (
    CATEGORY_CAPS,
    MAX_TOTAL,
    apply_score_modifiers,
)


def _us_bucket() -> LearnedWeightsBucket:
    return LearnedWeightsBucket(
        instrument="BTCUSD",
        timeframe="1H",
        session="NY",
        regime="TRENDING",
        sample_size=87,
        win_rate=0.62,
        avg_r=0.91,
        weights={
            "structure": 1.4,
            "momentum": 1.0,
            "moving_averages": 1.5,
            "fibonacci": 0.8,
            "patterns": 1.0,
            "volatility": 1.0,
            "volume": 1.0,
            "relative_strength": 1.0,
            "liquidity": 1.0,
        },
        status="USABLE",
    )


def _analysis(regime_state="TRENDING", volatility="NORMAL", session="NY", news_state="CLEAR"):
    return {
        "pair": "BTCUSD",
        "primary_timeframe": "1H",
        "data_quality": {"primary_timeframe": "1H"},
        "session": session,
        "volatility": volatility,
        "market_regime": regime_state,
        "news_state": news_state,
        "market_context": {
            "regime": {"state": regime_state, "volatility": volatility},
        },
        "trade_timing": {"session": session},
    }


class TestApplyScoreModifiers(unittest.TestCase):
    def test_caps_match_existing_v2_taxonomy(self):
        # The canonical V2 caps from crypto_analysis.py are mirrored here.
        self.assertEqual(sum(CATEGORY_CAPS.values()), MAX_TOTAL)
        self.assertEqual(CATEGORY_CAPS["structure"], 15)
        self.assertEqual(CATEGORY_CAPS["liquidity"], 15)
        self.assertEqual(CATEGORY_CAPS["relative_strength"], 5)

    def test_returns_adjusted_scores_total_and_metadata(self):
        scores = {"structure": 10, "momentum": 5, "moving_averages": 6, "liquidity": 8}
        adjusted, total, applied = apply_score_modifiers(scores, _analysis())
        # Returns the same shape as input + a total + applied metadata.
        self.assertIsInstance(adjusted, dict)
        self.assertIsInstance(total, int)
        self.assertIn("regime", applied)
        self.assertIn("learned_weights", applied)
        # regime modifier metadata is populated.
        self.assertEqual(applied["regime"]["state"], "TRENDING")

    def test_trending_rewards_moving_averages(self):
        scores = {"moving_averages": 6}
        adjusted, _, _ = apply_score_modifiers(scores, _analysis("TRENDING"))
        # Trending multiplier for moving_averages is 1.5 → 9.
        self.assertEqual(adjusted["moving_averages"], 9.0)

    def test_ranging_punishes_moving_averages(self):
        scores = {"moving_averages": 6}
        adjusted, _, _ = apply_score_modifiers(scores, _analysis("RANGING"))
        # Ranging multiplier for moving_averages is 0.5 → 3.
        self.assertEqual(adjusted["moving_averages"], 3.0)

    def test_news_dominated_downgrades_relative_strength(self):
        scores = {"relative_strength": 5}
        adjusted, _, applied = apply_score_modifiers(scores, _analysis("TRENDING", news_state="BLOCKED"))
        self.assertEqual(applied["regime"]["state"], "NEWS_DOMINATED")
        # 5 * 0.6 = 3.
        self.assertEqual(adjusted["relative_strength"], 3.0)

    def test_total_clamped_to_category_caps(self):
        # Try to overflow a single category.
        scores = {"structure": 100}  # cap is 15
        adjusted, total, _ = apply_score_modifiers(scores, _analysis("TRENDING"))
        # trending * 1.4 = 140 → clamped to 15.
        self.assertEqual(adjusted["structure"], 15.0)
        self.assertEqual(total, 15)

    def test_learned_weights_only_applied_when_usable(self):
        scores = {"structure": 10}
        # No lookup → no learned weights applied.
        _, _, applied = apply_score_modifiers(scores, _analysis())
        self.assertIsNone(applied["learned_weights"])

        # Limited sample bucket → surfaced but NOT applied.
        limited = LearnedWeightsBucket(
            instrument="BTCUSD",
            timeframe="1H",
            session="NY",
            regime="TRENDING",
            sample_size=5,
            weights={"structure": 2.0},
            status="LIMITED_SAMPLE",
        )
        _, _, applied = apply_score_modifiers(
            scores, _analysis(), learned_weights_lookup=lambda: [limited]
        )
        self.assertIsNotNone(applied["learned_weights"])
        self.assertEqual(applied["learned_weights"]["applied"], False)
        self.assertEqual(applied["learned_weights"]["status"], "LIMITED_SAMPLE")

    def test_learned_weights_apply_when_usable(self):
        scores = {"moving_averages": 6, "structure": 5}
        adjusted, total, applied = apply_score_modifiers(
            scores,
            _analysis("TRENDING"),
            learned_weights_lookup=lambda: [_us_bucket()],
        )
        # TRENDING multiplier: moving_averages x1.5, structure x1.4
        # Learned weight: moving_averages x1.5, structure x1.4
        # Combined: moving_averages = 6 * 1.5 * 1.5 = 13.5 (clamped to 10)
        #            structure = 5 * 1.4 * 1.4 = 9.8 (clamped to 15)
        self.assertEqual(adjusted["moving_averages"], 10.0)
        self.assertAlmostEqual(adjusted["structure"], 9.8, places=3)
        self.assertEqual(applied["learned_weights"]["status"], "USABLE")
        self.assertEqual(applied["learned_weights"]["sample_size"], 87)
        # Total = clamped moving_averages (10) + clamped structure (9.8) ≈ 19
        self.assertEqual(total, 20)  # round to 20

    def test_falls_back_gracefully_when_lookup_throws(self):
        def bad_lookup():
            raise RuntimeError("db down")
        adjusted, total, applied = apply_score_modifiers(
            {"structure": 5}, _analysis(), learned_weights_lookup=bad_lookup
        )
        # Regime modifiers still applied; learned weights stays None.
        self.assertIn("structure", adjusted)
        self.assertIsNone(applied["learned_weights"])

    def test_handles_missing_categories(self):
        # Score dict that's missing some categories — pass-through unchanged.
        scores = {"structure": 10}
        adjusted, _, _ = apply_score_modifiers(scores, _analysis())
        self.assertIn("structure", adjusted)

    def test_handles_empty_scores(self):
        adjusted, total, applied = apply_score_modifiers({}, _analysis())
        self.assertEqual(total, 0)


if __name__ == "__main__":
    unittest.main()
