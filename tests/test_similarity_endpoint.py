"""Unit tests for the extracted similarity endpoint helper."""
import unittest

from scanner.similarity_endpoint import build_similarity_response, _bucket_breakdown


class TestBucketBreakdown(unittest.TestCase):
    def test_empty_matches(self):
        self.assertEqual(_bucket_breakdown([], "session"), [])

    def test_groups_by_dimension(self):
        matches = [
            {"outcome": "WIN", "metadata": {"session": "NY"}},
            {"outcome": "WIN", "metadata": {"session": "NY"}},
            {"outcome": "LOSS", "metadata": {"session": "London"}},
            {"outcome": "WIN", "metadata": {}},  # unknown bucket
        ]
        out = _bucket_breakdown(matches, "session")
        by_value = {row["value"]: row for row in out}
        self.assertEqual(by_value["NY"]["samples"], 2)
        self.assertEqual(by_value["NY"]["wins"], 2)
        self.assertEqual(by_value["London"]["samples"], 1)
        self.assertEqual(by_value["London"]["losses"], 1)
        self.assertEqual(by_value["unknown"]["samples"], 1)
        # win_rate is 100% / 0% / 100%
        self.assertEqual(by_value["NY"]["win_rate_pct"], 100.0)
        self.assertEqual(by_value["London"]["win_rate_pct"], 0.0)

    def test_skips_non_dict_metadata(self):
        matches = [{"outcome": "WIN", "metadata": "bogus"}]
        out = _bucket_breakdown(matches, "session")
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["value"], "unknown")


class TestBuildSimilarityResponse(unittest.TestCase):
    def test_returns_error_envelope_when_repository_is_none(self):
        result = build_similarity_response(
            pair="BTCUSD",
            timeframe="1h",
            limit=10,
            minimum_similarity=0.55,
            repository=None,
            analysis_or_stale={"total_score": 50},
        )
        # No resolved history -> NO_HISTORY (still a valid response shape).
        self.assertIn("status", result)
        self.assertIn("matches", result)
        self.assertIn("pair", result)
        self.assertEqual(result["pair"], "BTCUSD")
        self.assertEqual(result["timeframe"], "1h")

    def test_pair_and_timeframe_propagate(self):
        result = build_similarity_response(
            pair="xauusd",
            timeframe=None,
            limit=5,
            minimum_similarity=0.7,
            repository=None,
            analysis_or_stale={},
        )
        # pair is uppercased at the route layer, but build_similarity_response
        # preserves whatever the caller passed — the route adapter handles
        # normalisation.  Verify the field exists.
        self.assertEqual(result["pair"], "xauusd")


if __name__ == "__main__":
    unittest.main()
