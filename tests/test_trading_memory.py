"""
Tests for scanner.trading_memory — persistent institutional-style insights.

Uses mock objects to test business logic without requiring a running
Postgres instance.
"""
import unittest
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone

from scanner.trading_memory import (
    Insight,
    InsightCategory,
    InsightStrength,
    TradingMemoryManager,
)


def _mock_conn_factory(rowcount=1):
    """Return a mock conn_factory with proper __enter__ chain."""
    factory = MagicMock()
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_cursor.rowcount = rowcount
    mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
    mock_cursor.__exit__ = MagicMock(return_value=False)
    mock_conn.cursor = MagicMock(return_value=mock_cursor)
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)
    factory.return_value = mock_conn
    return factory


class TestInsightDataclass(unittest.TestCase):
    def test_from_row_converts_fields(self):
        row = {
            "id": 1, "created_at": "2026-08-12T10:00:00",
            "category": "zone_rejection", "symbol": "XAUUSD",
            "condition_key": "XAUUSD|supply|3380",
            "observation": "Gold rejected 3380 supply 3 times.",
            "evidence_count": 3, "evidence_strength": "medium",
            "evidence_data": '{"interactions": []}',
            "source": "system", "created_by": None,
            "confidence": 65.0, "tags": '["session:london"]',
        }
        ins = Insight.from_row(row)
        self.assertEqual(ins.category, InsightCategory.ZONE_REJECTION)
        self.assertEqual(ins.evidence_count, 3)
        self.assertEqual(ins.tags, ["session:london"])

    def test_to_dict_serializes_enums(self):
        ins = Insight(
            category=InsightCategory.NEWS_IMPACT, evidence_strength=InsightStrength.HIGH,
            observation="test", created_at=datetime(2026, 8, 12, tzinfo=timezone.utc),
        )
        d = ins.to_dict()
        self.assertEqual(d["category"], "news_impact")
        self.assertEqual(d["evidence_strength"], "high")


class TestTradingMemoryCRUD(unittest.TestCase):
    def test_create_calls_insert(self):
        tm = TradingMemoryManager(_mock_conn_factory())
        test_insight = Insight(id=42, observation="test", category=InsightCategory.ANNOTATION, symbol="XAUUSD")
        with patch.object(tm, 'get', return_value=test_insight):
            result = tm.create(category="annotation", symbol="XAUUSD",
                               condition_key="manual|t", observation="test", confidence=75)
        self.assertEqual(result.id, 42)

    def test_delete_returns_true_when_rowcount_positive(self):
        tm = TradingMemoryManager(_mock_conn_factory(rowcount=1))
        self.assertTrue(tm.delete(42))

    def test_delete_returns_false_when_rowcount_zero(self):
        tm = TradingMemoryManager(_mock_conn_factory(rowcount=0))
        self.assertFalse(tm.delete(42))


class TestAutoDerivation(unittest.TestCase):
    def _make_tm_with_mock_list(self, existing_insights):
        """Create a TradingMemoryManager with a mocked list() method."""
        tm = TradingMemoryManager(MagicMock())
        tm.list = MagicMock(return_value=existing_insights)
        tm._record_zone_datapoint = MagicMock()
        tm._record_news_datapoint = MagicMock()
        return tm

    def test_zone_below_threshold_no_promote(self):
        tm = self._make_tm_with_mock_list([])
        result = tm.record_zone_interaction(
            symbol="XAUUSD", zone_price=3380.0, zone_type="supply",
            reaction="rejection", price_change_pct=-0.8, timeframe="H1",
        )
        self.assertIsNone(result)

    def test_zone_at_threshold_promotes(self):
        existing = [
            Insight(id=1, condition_key="XAUUSD|supply|3380.0", evidence_data={}, confidence=40, evidence_count=1),
            Insight(id=2, condition_key="XAUUSD|supply|3380.0", evidence_data={}, confidence=45, evidence_count=1),
        ]
        tm = self._make_tm_with_mock_list(existing)
        promoted = Insight(
            id=10, category=InsightCategory.ZONE_REJECTION, symbol="XAUUSD",
            observation="XAUUSD has rejected the 3380.0 supply zone 3 times.",
            evidence_count=3, evidence_strength=InsightStrength.MEDIUM, confidence=64,
        )
        tm.create = MagicMock(return_value=promoted)
        result = tm.record_zone_interaction(
            symbol="XAUUSD", zone_price=3380.0, zone_type="supply",
            reaction="rejection", price_change_pct=-0.5, timeframe="H1",
        )
        self.assertIsNotNone(result)
        self.assertEqual(result.category, InsightCategory.ZONE_REJECTION)
        self.assertIn("3380", result.observation)

    def test_news_below_threshold_no_promote(self):
        tm = self._make_tm_with_mock_list([])
        result = tm.record_news_impact(
            symbol="XAUUSD", event_name="CPI", event_impact="high",
            price_before=3400.0, price_after_5m=3450.0, currency="USD",
        )
        self.assertIsNone(result)

    def test_news_at_threshold_promotes(self):
        existing = [
            Insight(id=i, condition_key="XAUUSD|CPI|USD", evidence_data={}, confidence=50, evidence_count=1)
            for i in range(3)
        ]
        tm = self._make_tm_with_mock_list(existing)
        promoted = Insight(
            id=20, category=InsightCategory.NEWS_IMPACT, symbol="XAUUSD",
            observation="Last 4 CPI releases produced >2.5% initial XAUUSD move.",
            evidence_count=4, evidence_strength=InsightStrength.MEDIUM, confidence=82,
        )
        tm.create = MagicMock(return_value=promoted)
        result = tm.record_news_impact(
            symbol="XAUUSD", event_name="CPI", event_impact="high",
            price_before=3400.0, price_after_5m=3450.0, currency="USD",
        )
        self.assertIsNotNone(result)
        self.assertEqual(result.category, InsightCategory.NEWS_IMPACT)


class TestContextRetrieval(unittest.TestCase):
    def test_get_context_for_setup(self):
        symbol_insights = [
            Insight(id=1, symbol="XAUUSD", observation="zone rejection", confidence=80, evidence_count=3),
            Insight(id=2, symbol="XAUUSD", observation="CPI impact", confidence=70, evidence_count=2),
        ]
        general_insights = [
            Insight(id=3, symbol=None, observation="risk-on regime", confidence=60, evidence_count=1),
        ]
        tm = TradingMemoryManager(MagicMock())

        def mock_list(**kwargs):
            if kwargs.get("symbol") == "XAUUSD" and not kwargs.get("tags"):
                return symbol_insights
            if kwargs.get("tags") and "session:london" in kwargs["tags"]:
                return []
            if kwargs.get("symbol") is None and not kwargs.get("tags"):
                return general_insights
            return []
        tm.list = mock_list

        results = tm.get_context_for_setup(
            symbol="XAUUSD", direction="SELL", session="london", regime="trending",
        )
        self.assertGreater(len(results), 0)
        ids = [i.id for i in results]
        self.assertEqual(len(ids), len(set(ids)))

    def test_limit_works(self):
        all_insights = [Insight(id=i, symbol="XAUUSD", observation=f"obs {i}", confidence=50, evidence_count=1) for i in range(5)]
        tm = TradingMemoryManager(MagicMock())
        tm.list = lambda **kwargs: all_insights
        results = tm.get_context_for_setup(symbol="XAUUSD", direction="BUY", limit=3)
        self.assertEqual(len(results), 3)


class TestManualAnnotation(unittest.TestCase):
    def test_record_manual_annotation(self):
        tm = TradingMemoryManager(MagicMock())
        mock_insight = Insight(
            id=50, category=InsightCategory.ANNOTATION, symbol="ETHUSD",
            observation="ETH looks weak below 3200 support.",
            source="manual", created_by="trader", confidence=65,
        )
        tm.create = MagicMock(return_value=mock_insight)
        result = tm.record_manual_annotation(
            symbol="ETHUSD", observation="ETH looks weak below 3200 support.",
            created_by="trader", tags=["manual"], confidence=65,
        )
        self.assertEqual(result.source, "manual")
        self.assertEqual(result.category, InsightCategory.ANNOTATION)


if __name__ == "__main__":
    unittest.main()
