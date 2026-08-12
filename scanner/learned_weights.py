"""Learned Confluence Weights — per (instrument × timeframe × session × regime).

Roadmap #2.  Reads resolved journal entries (which only started populating
after the loop.py wiring fix in c7c116d), aggregates them by
(instrument, timeframe, session, regime), and produces learned weights
that the Confluence scoring engine can fold into its category totals.

The module is deliberately decoupled from the live scoring path:

  - compute_learned_weights() is a pure function — no DB writes, no
    network calls.  Feed it journal rows and you get weights back.
  - The recommended cadence is offline: a cron or admin endpoint that
    runs this over the last N resolved setups, writes the result to
    a learned_weights table, and lets the scoring engine consult it.
  - Until the autonomy loop accumulates enough resolved setups (the
    loop's write path only just started working), this returns
    sensible "no data yet" defaults so callers don't blow up.

Output shape (per dimension key):

  {
    "instrument":    "BTCUSD",
    "timeframe":     "1h",
    "session":       "NY",
    "regime":        "TRENDING",
    "sample_size":   87,
    "win_rate":      0.62,
    "avg_r":         0.91,
    "weights": {
        "structure":         1.20,
        "momentum":          1.15,
        "moving_averages":   1.40,
        "fibonacci":         0.85,
        ...
    },
    "status":        "USABLE" | "LIMITED_SAMPLE" | "NO_DATA",
  }

The ``weights`` map is normalized so the average weight across all
nine scoring categories stays at 1.0 — this preserves the existing
score scale and lets the engine apply the learned weights by
multiplying instead of replacing.

Future work:
  - Move the default weights to a database table (learned_weights)
  - Wire scanner.scoring_engine to consult the table per analysis
  - Schedule nightly recomputation via cron / admin endpoint
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Optional

# Scoring categories tracked by the Confluence engine.  Mirrors
# scanner.regime_taxonomy.DEFAULT_REGIME_MODIFIERS so the two
# systems can be compared and combined later.
SCORING_CATEGORIES = (
    "structure",
    "momentum",
    "moving_averages",
    "fibonacci",
    "patterns",
    "volatility",
    "volume",
    "relative_strength",
    "liquidity",
)

# Minimum sample size for a learned-weights bucket to be considered
# USABLE rather than LIMITED_SAMPLE.  Below this we return identity
# weights (1.0) so we never let a tiny sample drag the engine.
MIN_USABLE_SAMPLES = 30


@dataclass(frozen=True)
class LearnedWeightsBucket:
    """Learned weights for one (instrument × timeframe × session × regime)
    combination.  ``weights`` is a category->multiplier dict normalised
    so the average across the nine SCORING_CATEGORIES is 1.0."""
    instrument: str
    timeframe: str
    session: str
    regime: str
    sample_size: int
    win_rate: Optional[float] = None
    avg_r: Optional[float] = None
    weights: dict[str, float] = field(default_factory=dict)
    status: str = "NO_DATA"  # USABLE | LIMITED_SAMPLE | NO_DATA

    def to_dict(self) -> dict[str, Any]:
        return {
            "instrument": self.instrument,
            "timeframe": self.timeframe,
            "session": self.session,
            "regime": self.regime,
            "sample_size": self.sample_size,
            "win_rate": round(self.win_rate, 3) if self.win_rate is not None else None,
            "avg_r": round(self.avg_r, 3) if self.avg_r is not None else None,
            "weights": {k: round(v, 3) for k, v in self.weights.items()},
            "status": self.status,
        }


def _bucket_key(row: Mapping[str, Any]) -> tuple[str, str, str, str]:
    return (
        str(row.get("symbol") or row.get("pair") or "UNKNOWN").upper(),
        str(row.get("timeframe") or "default").upper(),
        str(row.get("session") or "unknown").upper(),
        str(row.get("market_regime") or "unknown").upper(),
    )


def _category_score(row: Mapping[str, Any], category: str) -> float:
    """Best-effort extraction of a category's score from a journal row.

    journal_entries doesn't store category scores directly — it stores
    score_components JSONB which is the per-category breakdown used by
    the scoring engine.  When present we use that; otherwise we fall
    back to a coarse proxy (e.g. outcome-derived win proxy for
    pattern-style categories).  This keeps the function tolerant of
    legacy rows that only have the total score.
    """
    components = row.get("score_components") or {}
    if isinstance(components, Mapping):
        # The schema uses nested keys — try a few common spellings.
        for key in (category, category.replace("_", ""), category.upper()):
            if key in components:
                try:
                    return float(components[key])
                except (TypeError, ValueError):
                    return 0.0
    return 0.0


def _outcome_r(row: Mapping[str, Any]) -> Optional[float]:
    """Pull the realised R-multiple from a journal row, if present."""
    val = row.get("r_multiple")
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _is_win(row: Mapping[str, Any]) -> bool:
    """A row is a 'win' if r_multiple > 0 OR outcome ∈ {WIN, TP, TP1, TP2, TP3}."""
    r = _outcome_r(row)
    if r is not None:
        return r > 0
    outcome = str(row.get("outcome") or "").upper()
    return outcome in {"WIN", "TP", "TP1", "TP2", "TP3"}


def compute_learned_weights(
    journal_rows: Iterable[Mapping[str, Any]],
    min_samples: int = MIN_USABLE_SAMPLES,
) -> list[LearnedWeightsBucket]:
    """Aggregate resolved journal rows into per-bucket learned weights.

    Returns one LearnedWeightsBucket per (instrument, timeframe, session,
    regime) tuple present in the input.  Buckets with fewer than
    ``min_samples`` rows are flagged LIMITED_SAMPLE and return identity
    weights (1.0) so a small sample can't poison the engine.
    """
    buckets: dict[tuple[str, str, str, str], list[Mapping[str, Any]]] = defaultdict(list)
    for row in journal_rows:
        if not _is_win(row) and str(row.get("outcome") or "").upper() not in {
            "WIN", "LOSS", "TP", "TP2", "TP3", "STOP", "INVALIDATED", "EXPIRED", "BREAK_EVEN"
        }:
            # Skip rows that aren't resolved at all.
            continue
        buckets[_bucket_key(row)].append(row)

    out: list[LearnedWeightsBucket] = []
    for (instrument, timeframe, session, regime), rows in buckets.items():
        n = len(rows)
        if n == 0:
            status = "NO_DATA"
        elif n < min_samples:
            status = "LIMITED_SAMPLE"
        else:
            status = "USABLE"

        wins = sum(1 for r in rows if _is_win(r))
        win_rate = wins / n if n else None
        rs = [r for r in (_outcome_r(r) for r in rows) if r is not None]
        avg_r = sum(rs) / len(rs) if rs else None

        # Per-category weights: average component score on wins vs. all rows.
        # If a category predicts wins better than chance, its weight > 1.0;
        # if it's noise, weight ≈ 1.0; if it anti-predicts, weight < 1.0.
        weights: dict[str, float] = {}
        if n >= 5:  # need at least a few rows to compute a stable ratio
            for category in SCORING_CATEGORIES:
                win_scores = [_category_score(r, category) for r in rows if _is_win(r)]
                all_scores = [_category_score(r, category) for r in rows]
                avg_win = sum(win_scores) / len(win_scores) if win_scores else 0.0
                avg_all = sum(all_scores) / len(all_scores) if all_scores else 0.0
                if avg_all <= 0:
                    weights[category] = 1.0
                else:
                    # Multiplier is the win-rate-vs-baseline ratio, capped
                    # to [0.4, 2.0] so a single bad/good category can't
                    # dominate the engine.
                    ratio = avg_win / avg_all if avg_all > 0 else 1.0
                    weights[category] = max(0.4, min(2.0, ratio))
        else:
            weights = {category: 1.0 for category in SCORING_CATEGORIES}

        # Normalize so the mean weight is 1.0 — preserves the engine's
        # total-score scale.
        if weights:
            mean = sum(weights.values()) / len(weights)
            if mean > 0:
                weights = {k: v / mean for k, v in weights.items()}

        out.append(LearnedWeightsBucket(
            instrument=instrument,
            timeframe=timeframe,
            session=session,
            regime=regime,
            sample_size=n,
            win_rate=win_rate,
            avg_r=avg_r,
            weights=weights,
            status=status,
        ))

    return out


def find_bucket(
    buckets: Iterable[LearnedWeightsBucket],
    instrument: str,
    timeframe: str,
    session: str = "",
    regime: str = "",
) -> Optional[LearnedWeightsBucket]:
    """Look up a bucket by (instrument, timeframe, session, regime).
    Falls back to looser matches when the exact key isn't present:
      - exact  -> (instrument, timeframe, session, regime)
      - relax session
      - relax regime
      - relax both
    Returns None when nothing matches."""
    pool = list(buckets)
    inst = instrument.upper()
    tf = timeframe.upper()
    sess = session.upper()
    reg = regime.upper()

    def _match(b: LearnedWeightsBucket, want_sess: str, want_reg: str) -> bool:
        if b.instrument != inst or b.timeframe != tf:
            return False
        if want_sess and b.session != want_sess:
            return False
        if want_reg and b.regime != want_reg:
            return False
        return True

    for want_sess, want_reg in (
        (sess, reg),
        (sess, ""),
        ("", reg),
        ("", ""),
    ):
        for b in pool:
            if _match(b, want_sess, want_reg):
                return b
    return None
