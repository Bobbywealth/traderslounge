"""8-state regime taxonomy with per-state score modifiers.

Roadmap #5 — replaces the coarser regime classification with the eight
states Bobby specified:

    TRENDING         — directional move with sustained momentum
    RANGING          — sideways, mean-reverting
    BREAKOUT         — fresh break of range or structure
    COMPRESSION      — volatility contraction, often pre-breakout
    EXPANSION        — volatility expansion (often after breakout)
    REVERSAL         — directional change against the prior trend
    NEWS-DOMINATED   — economic calendar is the dominant driver
    LOW-LIQUIDITY    — thin book, unreliable fills

Each state carries a `score_modifiers` dict that says how much weight
each scoring category should add or subtract when this regime is
active.  The Confluence scoring engine can fold these into its total
so a 'BUY during BREAKOUT' scores differently from a 'BUY during
NEWS-DOMINATED'.  This is the first step toward per-regime learned
weights (Roadmap #2).

Initial values are heuristic defaults, derived from the README's
guidance ("an EMA stack is incredibly predictive during trending
markets but nearly worthless in ranges").  Future PRs should derive
them from the journal_entries calibration pipeline.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Mapping


class RegimeState(str, Enum):
    TRENDING = "TRENDING"
    RANGING = "RANGING"
    BREAKOUT = "BREAKOUT"
    COMPRESSION = "COMPRESSION"
    EXPANSION = "EXPANSION"
    REVERSAL = "REVERSAL"
    NEWS_DOMINATED = "NEWS_DOMINATED"
    LOW_LIQUIDITY = "LOW_LIQUIDITY"


# Heuristic per-state multipliers for each scoring category.  A value of
# 1.0 means "no change"; 1.5 means "this category is more predictive
# in this regime"; 0.5 means "weight this category down".
#
# Categories map to the canonical V2 scoring categories used by
# scanner/scoring_engine.py.  When a category isn't relevant for a
# regime it stays at 1.0 so the existing scoring flow keeps working.
DEFAULT_REGIME_MODIFIERS: dict[RegimeState, dict[str, float]] = {
    RegimeState.TRENDING: {
        # EMA stack + structure + momentum dominate in trends.
        "structure": 1.4,
        "momentum": 1.3,
        "moving_averages": 1.5,
        "fibonacci": 0.9,
        "patterns": 1.1,
        "volatility": 0.7,
        "volume": 1.1,
        "relative_strength": 1.2,
        "liquidity": 1.0,
    },
    RegimeState.RANGING: {
        # Oscillators + Fib retracements matter; trend-following hurts.
        "structure": 0.6,
        "momentum": 1.2,
        "moving_averages": 0.5,
        "fibonacci": 1.5,
        "patterns": 1.1,
        "volatility": 0.9,
        "volume": 1.0,
        "relative_strength": 1.1,
        "liquidity": 1.2,
    },
    RegimeState.BREAKOUT: {
        # Volume + patterns + volatility expansion confirm the break.
        "structure": 1.3,
        "momentum": 1.1,
        "moving_averages": 1.0,
        "fibonacci": 1.1,
        "patterns": 1.4,
        "volatility": 1.3,
        "volume": 1.5,
        "relative_strength": 1.0,
        "liquidity": 1.3,
    },
    RegimeState.COMPRESSION: {
        # Tight ranges reward patience and oscillator extremes.
        "structure": 0.9,
        "momentum": 1.0,
        "moving_averages": 0.7,
        "fibonacci": 1.1,
        "patterns": 1.0,
        "volatility": 1.5,  # expansion incoming, watch ATR contraction
        "volume": 0.6,
        "relative_strength": 0.9,
        "liquidity": 1.0,
    },
    RegimeState.EXPANSION: {
        # Volatility is the headline; structure catches the leg.
        "structure": 1.2,
        "momentum": 1.2,
        "moving_averages": 1.0,
        "fibonacci": 0.8,
        "patterns": 1.1,
        "volatility": 1.5,
        "volume": 1.3,
        "relative_strength": 1.1,
        "liquidity": 1.2,
    },
    RegimeState.REVERSAL: {
        # Reversals punish trend-following setups.  Liquidity sweeps
        # + Fib levels + pattern exhaustion are the tell.
        "structure": 1.2,
        "momentum": 0.7,
        "moving_averages": 0.7,
        "fibonacci": 1.3,
        "patterns": 1.4,
        "volatility": 1.1,
        "volume": 1.3,
        "relative_strength": 0.8,
        "liquidity": 1.4,
    },
    RegimeState.NEWS_DOMINATED: {
        # Calendar gates should keep us out — but if we trade through
        # them, momentum + relative_strength become noise.
        "structure": 0.9,
        "momentum": 0.7,
        "moving_averages": 0.7,
        "fibonacci": 1.0,
        "patterns": 0.8,
        "volatility": 1.4,
        "volume": 1.3,
        "relative_strength": 0.6,
        "liquidity": 1.4,
    },
    RegimeState.LOW_LIQUIDITY: {
        # Thin books kill reliability.  Discount most signals.
        "structure": 0.6,
        "momentum": 0.6,
        "moving_averages": 0.6,
        "fibonacci": 0.7,
        "patterns": 0.7,
        "volatility": 0.8,
        "volume": 0.4,
        "relative_strength": 0.7,
        "liquidity": 1.5,
    },
}


@dataclass(frozen=True)
class RegimeClassification:
    """Result of running the regime classifier over a snapshot."""
    state: RegimeState
    confidence: float  # 0..1, how confident we are in this state
    supporting: dict[str, Any] = field(default_factory=dict)

    def modifier(self, category: str) -> float:
        """Return the multiplier for a given scoring category under this
        regime.  Defaults to 1.0 when no modifier is defined."""
        mods = DEFAULT_REGIME_MODIFIERS.get(self.state, {})
        return float(mods.get(category, 1.0))

    def to_dict(self) -> dict[str, Any]:
        return {
            "state": self.state.value,
            "confidence": self.confidence,
            "supporting": self.supporting,
            "modifiers": {k: round(v, 3) for k, v in DEFAULT_REGIME_MODIFIERS.get(self.state, {}).items()},
        }


def classify_regime(snapshot: Mapping[str, Any]) -> RegimeClassification:
    """Map a market snapshot's regime/volume/news fields into one of the
    eight RegimeState values.

    The classifier is heuristic and intentionally conservative: when in
    doubt it falls back to RANGING so the engine never claims a regime
    it can't justify.  Future PRs should derive these rules from
    outcome data instead of heuristics.
    """
    market_regime = str(snapshot.get("market_regime") or snapshot.get("regime") or "").upper()
    volatility = str(snapshot.get("volatility") or "normal").upper()
    trend = str(snapshot.get("trend") or "").upper()
    news_state = str(snapshot.get("news_state") or "CLEAR").upper()
    session = str(snapshot.get("session") or "").upper()

    # News dominated takes precedence — calendar gates should keep us
    # out, but if we're scoring, downweight trend signals.
    if news_state in {"BLOCKED", "POST_NEWS", "HIGH_IMPACT_PENDING"}:
        return RegimeClassification(
            state=RegimeState.NEWS_DOMINATED,
            confidence=0.9,
            supporting={"news_state": news_state, "session": session},
        )

    # Explicit regime hints from the engine win over heuristics.
    if market_regime == "TRENDING":
        return RegimeClassification(state=RegimeState.TRENDING, confidence=0.8,
                                     supporting={"market_regime": market_regime, "trend": trend})
    if market_regime == "BREAKOUT":
        return RegimeClassification(state=RegimeState.BREAKOUT, confidence=0.8,
                                     supporting={"market_regime": market_regime, "volatility": volatility})
    if market_regime == "REVERSAL":
        return RegimeClassification(state=RegimeState.REVERSAL, confidence=0.7,
                                     supporting={"market_regime": market_regime, "trend": trend})

    if volatility == "COMPRESSED" or market_regime == "COMPRESSION":
        return RegimeClassification(state=RegimeState.COMPRESSION, confidence=0.7,
                                     supporting={"volatility": volatility})

    if volatility == "EXPANDED" or market_regime == "EXPANSION":
        return RegimeClassification(state=RegimeState.EXPANSION, confidence=0.7,
                                     supporting={"volatility": volatility})

    if market_regime == "RANGING" or volatility == "NORMAL" or not market_regime:
        return RegimeClassification(state=RegimeState.RANGING, confidence=0.6,
                                     supporting={"market_regime": market_regime, "volatility": volatility})

    # Low-liquidity sentinel: dead session + compressed vol + no clear bias.
    if session in {"ASIA"} and volatility == "COMPRESSED" and not trend:
        return RegimeClassification(state=RegimeState.LOW_LIQUIDITY, confidence=0.5,
                                     supporting={"session": session, "volatility": volatility})

    return RegimeClassification(state=RegimeState.RANGING, confidence=0.4,
                                 supporting={"fallback": True})


def apply_regime_modifiers(score_components: Mapping[str, float], regime: RegimeClassification) -> dict[str, float]:
    """Return a new dict of score components with per-category multipliers
    applied.  Components not present in DEFAULT_REGIME_MODIFIERS pass
    through unchanged.

    The function never raises — invalid input becomes an empty dict —
    because callers are scoring pipelines that must keep flowing.
    """
    out: dict[str, float] = {}
    for category, raw_value in dict(score_components or {}).items():
        try:
            multiplier = regime.modifier(category)
            out[category] = float(raw_value) * multiplier
        except (TypeError, ValueError):
            out[category] = 0.0
    return out
