"""Pure-stdlib validation metrics for scored trading signals."""
from __future__ import annotations

from datetime import datetime, timezone
from math import isfinite
from typing import Any, Dict, Iterable, List, Mapping, Sequence

MIN_CALIBRATION_SAMPLE_SIZE = 30
MAX_CALIBRATION_ERROR = 0.10
MAX_BRIER_SCORE = 0.20
BIN_COUNT = 10

_GROUP_ALIASES = {
    "asset/pair": ("asset", "pair"),
    "asset": ("asset", "pair"),
    "pair": ("pair", "asset"),
    "timeframe": ("timeframe",),
    "volatility_regime": ("volatility_regime",),
    "session": ("session",),
    "setup_type": ("setup_type",),
}
_R_KEYS = ("r_multiple", "realized_r", "return_r", "r", "pnl_r")
_MAE_KEYS = ("mae_r", "mae", "max_adverse_excursion", "max_adverse_excursion_r")
_TIME_KEYS = ("timestamp", "time", "datetime", "date", "created_at", "entry_time", "signal_time")


def calibration_report(rows: Iterable[Any], probability_key: str = "forecast_weight",
                       outcome_key: str = "outcome") -> Dict[str, Any]:
    """Return calibration, classification, and trade-quality metrics for rows.

    Invalid rows are ignored. Forecast weights may be probabilities (0..1)
    or percentages (0..100); outcomes are normalized to realized win/loss.
    """
    return _report_from_observations(_observations(rows, probability_key, outcome_key))


def grouped_calibration(rows: Iterable[Any], dimensions: Sequence[str]) -> Dict[str, Dict[str, Dict[str, Any]]]:
    """Return reports grouped by requested dimensions, using standard aliases.

    Standard dimensions include asset/pair, timeframe, volatility_regime,
    session, and setup_type. Missing values are placed in ``unknown``.
    """
    if isinstance(dimensions, str):
        dimensions = (dimensions,)
    try:
        requested = list(dimensions)
    except TypeError:
        return {}
    raw_rows = list(rows) if rows is not None else []
    result: Dict[str, Dict[str, Dict[str, Any]]] = {}
    for dimension in requested:
        if not isinstance(dimension, str) or not dimension:
            continue
        buckets: Dict[str, List[Dict[str, Any]]] = {}
        for row in raw_rows:
            observation = _observation(row, "forecast_weight", "outcome")
            if observation is not None:
                buckets.setdefault(_group_value(row, dimension), []).append(observation)
        result[dimension] = {name: _report_from_observations(items)
                             for name, items in sorted(buckets.items())}
    return result


def walk_forward_report(rows: Iterable[Any], folds: int = 4) -> Dict[str, Any]:
    """Evaluate disjoint chronological OOS folds with expanding training windows."""
    try:
        folds = max(1, int(folds))
    except (TypeError, ValueError):
        folds = 4
    observations = _observations(rows, "forecast_weight", "outcome", include_time=True)
    observations.sort(key=lambda item: (item["_time"] is None, item["_time"], item["_order"]))
    n = len(observations)
    if n < 2:
        return {
            "sample_size": n, "folds_requested": folds, "folds_used": 0, "folds": [],
            "out_of_sample": _report_from_observations([]), "no_lookahead": True,
            "no_lookahead_metadata": {"strategy": "expanding_window", "test_rows_reused": False,
                                      "reason": "at least two valid chronological rows are required"},
        }

    folds_used = min(folds, n - 1)
    initial_train = max(1, n // (folds_used + 1))
    base, extra = divmod(n - initial_train, folds_used)
    start, reports, oos = initial_train, [], []
    for number in range(folds_used):
        end = start + base + (1 if number < extra else 0)
        test = observations[start:end]
        oos.extend(test)
        reports.append({
            "fold": number + 1, "train_sample_size": start, "test_sample_size": len(test),
            "train_index_range": [0, start - 1], "test_index_range": [start, end - 1],
            "train_end_before_test": True, "no_lookahead": True,
            "report": _report_from_observations(test),
        })
        start = end
    return {
        "sample_size": n, "folds_requested": folds, "folds_used": folds_used, "folds": reports,
        "out_of_sample": _report_from_observations(oos), "no_lookahead": True,
        "no_lookahead_metadata": {"strategy": "expanding_window", "chronological_sort": True,
                                  "test_rows_reused": False, "training_precedes_each_test": True},
    }


def _report_from_observations(observations: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    n = len(observations)
    probabilities = [item["probability"] for item in observations]
    outcomes = [item["outcome"] for item in observations]
    brier = sum((p - y) ** 2 for p, y in zip(probabilities, outcomes)) / n if n else 0.0
    bins = _reliability_bins(observations)
    calibration_error = (sum(item["sample_size"] * abs(item["gap"])
                             for item in bins if item["sample_size"]) / n if n else 0.0)
    guesses = [p >= 0.5 for p in probabilities]
    tp = sum(guess and actual for guess, actual in zip(guesses, outcomes))
    fp = sum(guess and not actual for guess, actual in zip(guesses, outcomes))
    fn = sum(not guess and actual for guess, actual in zip(guesses, outcomes))
    r_values = [item["r"] for item in observations if item["r"] is not None]
    maes = [item["mae"] for item in observations if item["mae"] is not None]
    return {
        "sample_size": n, "brier_score": brier, "reliability_bins": bins,
        "calibration_error": calibration_error,
        "precision": tp / (tp + fp) if tp + fp else 0.0,
        "recall": tp / (tp + fn) if tp + fn else 0.0,
        "expectancy_r": sum(r_values) / len(r_values) if r_values else 0.0,
        "average_mae": sum(maes) / len(maes) if maes else 0.0,
        "max_mae": max(maes) if maes else 0.0,
        "r_sample_size": len(r_values), "mae_sample_size": len(maes),
        "calibrated": (n >= MIN_CALIBRATION_SAMPLE_SIZE and brier <= MAX_BRIER_SCORE
                       and calibration_error <= MAX_CALIBRATION_ERROR),
        "calibration_thresholds": {"minimum_sample_size": MIN_CALIBRATION_SAMPLE_SIZE,
                                   "maximum_brier_score": MAX_BRIER_SCORE,
                                   "maximum_calibration_error": MAX_CALIBRATION_ERROR},
    }


def _reliability_bins(observations: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    buckets: List[List[Dict[str, Any]]] = [[] for _ in range(BIN_COUNT)]
    for item in observations:
        buckets[min(BIN_COUNT - 1, int(item["probability"] * BIN_COUNT))].append(item)
    result = []
    for index, bucket in enumerate(buckets):
        count = len(bucket)
        forecast = sum(x["probability"] for x in bucket) / count if count else None
        observed = sum(x["outcome"] for x in bucket) / count if count else None
        result.append({"lower_bound": index / BIN_COUNT, "upper_bound": (index + 1) / BIN_COUNT,
                       "sample_size": count, "mean_forecast": forecast, "observed_rate": observed,
                       "gap": observed - forecast if count else None})
    return result


def _observations(rows: Iterable[Any], probability_key: str, outcome_key: str,
                  include_time: bool = False) -> List[Dict[str, Any]]:
    try:
        iterator = iter(rows) if rows is not None else iter(())
    except TypeError:
        return []
    result = []
    for order, row in enumerate(iterator):
        item = _observation(row, probability_key, outcome_key)
        if item is not None:
            item["_order"] = order
            item["_time"] = _row_time(row) if include_time else None
            result.append(item)
    return result


def _observation(row: Any, probability_key: str, outcome_key: str) -> Dict[str, Any] | None:
    if not isinstance(row, Mapping):
        return None
    probability, outcome = _probability(row.get(probability_key)), _outcome(row.get(outcome_key))
    if probability is None or outcome is None:
        return None
    return {"probability": probability, "outcome": outcome, "r": _first_number(row, _R_KEYS),
            "mae": _first_number(row, _MAE_KEYS)}


def _probability(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not isfinite(number) or not 0 <= number <= 100:
        return None
    return number / 100 if number > 1 else number


def _outcome(value: Any) -> int | None:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, str):
        value = value.strip().lower()
        if value in {"1", "true", "yes", "win", "won", "profit", "positive", "tp", "success"}:
            return 1
        if value in {"0", "false", "no", "loss", "lost", "negative", "sl", "failure"}:
            return 0
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return int(number > 0) if isfinite(number) else None


def _first_number(row: Mapping[str, Any], keys: Sequence[str]) -> float | None:
    for key in keys:
        try:
            number = float(row.get(key))
        except (TypeError, ValueError):
            continue
        if isfinite(number):
            return abs(number) if key in _MAE_KEYS else number
    return None


def _group_value(row: Any, dimension: str) -> str:
    if isinstance(row, Mapping):
        for key in _GROUP_ALIASES.get(dimension, (dimension,)):
            value = row.get(key)
            if value is not None and str(value).strip():
                return str(value)
    return "unknown"


def _row_time(row: Any) -> float | None:
    if not isinstance(row, Mapping):
        return None
    for key in _TIME_KEYS:
        value = row.get(key)
        if isinstance(value, (int, float)) and isfinite(float(value)):
            return float(value)
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=timezone.utc).timestamp()
            except ValueError:
                pass
    return None
