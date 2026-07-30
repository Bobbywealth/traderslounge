from scanner.analysis_history import (
    analysis_fingerprint,
    build_forecast_payload,
    persist_analysis,
    resolved_similarity_history,
)


def sample_analysis():
    return {
        "version": "2.0",
        "pair": "BTCUSD",
        "direction": "BUY",
        "total_score": 82,
        "data_quality": {"primary_timeframe": "H1", "closed_bar_time": 123456},
        "indicators": {"rsi": 61, "atr": 200, "adx": 28},
        "trade_timing": {"status": "READY", "session": "NEW_YORK", "regime": {"label": "trend"}},
        "trade_plan": {
            "eligible": True,
            "entry": 100000,
            "stop": 99000,
            "tp1": 102500,
            "targets": [{"price": 102500}],
        },
        "scenarios": {"primary": "trend continuation"},
        "decision_quality": {
            "setup_quality": 78,
            "execution_readiness": 84,
            "scenario_weights": {"weights": {"bull": 62, "base": 23, "bear": 15}},
        },
        "institutional_intelligence_v2": {
            "trade_grade": {"grade": "A-", "score": 81},
            "multi_agent_consensus": {"status": "ALIGNED", "agreement_pct": 71.4},
        },
        "economic_calendar": {"status": "CLEAR"},
    }


class Repo:
    def __init__(self):
        self.saved = []

    def save_forecast(self, payload):
        self.saved.append(payload)
        return 7

    def forecast_rows(self, limit=5000):
        return [
            {"id": 1, "status": "PENDING", "outcome": None, "metadata": {}},
            {
                "id": 2,
                "fingerprint": "resolved",
                "status": "RESOLVED",
                "pair": "BTCUSD",
                "timeframe": "H1",
                "direction": "BUY",
                "outcome": 1,
                "r_multiple": 2.4,
                "resolved_at": "2026-07-30T00:00:00Z",
                "metadata": {"vector": {"score": 0.82}},
            },
        ]


def test_fingerprint_is_stable_for_same_canonical_setup():
    analysis = sample_analysis()
    assert analysis_fingerprint(analysis) == analysis_fingerprint(dict(analysis))


def test_payload_preserves_advisory_metadata_without_granting_authority():
    payload = build_forecast_payload(sample_analysis(), created_at="2026-07-30T00:00:00Z")
    assert payload["forecast_weight"] == 62
    assert payload["weight_label"] == "scenario_weight_not_probability"
    assert payload["metadata"]["canonical_eligible"] is True
    assert payload["metadata"]["trade_grade"]["grade"] == "A-"
    assert "vector" in payload["metadata"]


def test_persist_analysis_uses_existing_repository_contract():
    repo = Repo()
    assert persist_analysis(repo, sample_analysis()) == 7
    assert len(repo.saved) == 1


def test_similarity_history_excludes_pending_rows():
    rows = resolved_similarity_history(Repo())
    assert len(rows) == 1
    assert rows[0]["outcome"] == "WIN"
    assert rows[0]["realized_r"] == 2.4


def test_missing_repository_capabilities_degrade_to_noop():
    assert persist_analysis(object(), sample_analysis()) is None
    assert resolved_similarity_history(object()) == []
