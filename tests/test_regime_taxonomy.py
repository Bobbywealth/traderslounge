"""Tests for the 8-state regime taxonomy + modifiers."""
import unittest

from scanner.regime_taxonomy import (
    DEFAULT_REGIME_MODIFIERS,
    RegimeState,
    apply_regime_modifiers,
    classify_regime,
)


class TestClassifyRegime(unittest.TestCase):
    def test_news_dominated_takes_precedence(self):
        c = classify_regime({"news_state": "BLOCKED", "market_regime": "TRENDING"})
        self.assertEqual(c.state, RegimeState.NEWS_DOMINATED)
        self.assertGreaterEqual(c.confidence, 0.8)

    def test_explicit_trending(self):
        c = classify_regime({"market_regime": "TRENDING", "trend": "UP"})
        self.assertEqual(c.state, RegimeState.TRENDING)

    def test_breakout(self):
        c = classify_regime({"market_regime": "BREAKOUT", "volatility": "EXPANDED"})
        self.assertEqual(c.state, RegimeState.BREAKOUT)

    def test_compression(self):
        c = classify_regime({"volatility": "COMPRESSED"})
        self.assertEqual(c.state, RegimeState.COMPRESSION)

    def test_expansion(self):
        c = classify_regime({"volatility": "EXPANDED"})
        self.assertEqual(c.state, RegimeState.EXPANSION)

    def test_ranging_fallback(self):
        c = classify_regime({"market_regime": "RANGING", "volatility": "NORMAL"})
        self.assertEqual(c.state, RegimeState.RANGING)

    def test_unknown_falls_back_to_ranging(self):
        c = classify_regime({})
        self.assertEqual(c.state, RegimeState.RANGING)


class TestRegimeModifiers(unittest.TestCase):
    def test_all_eight_states_present(self):
        for state in RegimeState:
            self.assertIn(state, DEFAULT_REGIME_MODIFIERS)
            self.assertGreater(len(DEFAULT_REGIME_MODIFIERS[state]), 0)

    def test_modifier_lookup_returns_one_for_missing(self):
        from scanner.regime_taxonomy import RegimeClassification
        c = RegimeClassification(state=RegimeState.TRENDING, confidence=0.5)
        self.assertEqual(c.modifier("not_a_real_category"), 1.0)

    def test_trending_rewards_moving_averages(self):
        c = classify_regime({"market_regime": "TRENDING"})
        self.assertGreater(c.modifier("moving_averages"), 1.2)

    def test_ranging_punishes_moving_averages(self):
        c = classify_regime({"market_regime": "RANGING"})
        self.assertLess(c.modifier("moving_averages"), 0.8)

    def test_low_liquidity_punishes_volume(self):
        c = classify_regime({"session": "ASIA", "volatility": "COMPRESSED"})
        self.assertLessEqual(c.modifier("volume"), 0.6)


class TestApplyRegimeModifiers(unittest.TestCase):
    def test_multiplies_each_category(self):
        c = classify_regime({"market_regime": "TRENDING"})
        out = apply_regime_modifiers(
            {"structure": 10, "moving_averages": 5, "momentum": 3},
            c,
        )
        # trending should boost moving_averages strongly
        self.assertGreater(out["moving_averages"], 5)
        self.assertGreater(out["structure"], 10)

    def test_handles_invalid_input_safely(self):
        c = classify_regime({"market_regime": "TRENDING"})
        self.assertEqual(apply_regime_modifiers(None, c), {})
        self.assertEqual(apply_regime_modifiers({"x": "bad"}, c), {"x": 0.0})


if __name__ == "__main__":
    unittest.main()
