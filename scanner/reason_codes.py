from enum import Enum
from typing import Any, Dict, List, Optional


class ReasonCode(Enum):
    NEWS_BLOCK_HIGH_IMPACT = "news_block_high_impact"
    NEWS_COOLING_PERIOD = "news_cooling_period"
    ADR_EXHAUSTED = "adr_exhausted"
    INSUFFICIENT_VOLUME_DATA = "insufficient_volume_data"
    INSUFFICIENT_CANDLE_HISTORY = "insufficient_candle_history"
    DIRECTION_CONFLICT = "direction_conflict"
    RR_BELOW_MINIMUM = "rr_below_minimum"
    ENTRY_TOO_EXTENDED = "entry_too_extended"
    STALE_CANDLES = "stale_candles"
    STRUCTURE_NOT_CONFIRMED = "structure_not_confirmed"
    SPREAD_TOO_WIDE = "spread_too_wide"
    LIQUIDITY_NOT_CONFIRMED = "liquidity_not_confirmed"
    VOLATILITY_TOO_HIGH = "volatility_too_high"
    VOLATILITY_TOO_LOW = "volatility_too_low"
    PORTFOLIO_RISK_EXCEEDED = "portfolio_risk_exceeded"
    PROVIDER_RATE_LIMITED = "provider_rate_limited"
    PROVIDER_UNAVAILABLE = "provider_unavailable"
    MODEL_COVERAGE_LOW = "model_coverage_low"
    GATHERING_EVIDENCE = "gathering_evidence"
    AWAITING_TRIGGER = "awaiting_trigger"
    SCORE_BELOW_THRESHOLD = "score_below_threshold"
    COVERAGE_IMPROVING = "coverage_improving"
    NO_USABLE_CANDLES = "no_usable_candles"
    NO_CONFIRMED_DIRECTION = "no_confirmed_direction"
    DATA_QUALITY_POOR = "data_quality_poor"
    CALENDAR_BLOCKED = "calendar_blocked"
    INVALID_STRUCTURAL_STOP = "invalid_structural_stop"
    TRADE_TIMING_AVOID = "trade_timing_avoid"


REASON_MESSAGES: Dict[ReasonCode, Dict[str, Any]] = {
    ReasonCode.NEWS_BLOCK_HIGH_IMPACT: {
        "message": "High-impact news event within blackout window",
        "severity": "high",
        "blocks_trading": True,
    },
    ReasonCode.NEWS_COOLING_PERIOD: {
        "message": "Recent high-impact news, cooling period active",
        "severity": "medium",
        "blocks_trading": False,
    },
    ReasonCode.ADR_EXHAUSTED: {
        "message": "Daily range fully utilized, limited upside remaining",
        "severity": "medium",
        "blocks_trading": False,
    },
    ReasonCode.INSUFFICIENT_VOLUME_DATA: {
        "message": "Volume data unavailable or insufficient",
        "severity": "medium",
        "blocks_trading": True,
    },
    ReasonCode.INSUFFICIENT_CANDLE_HISTORY: {
        "message": "Insufficient candle history for analysis",
        "severity": "medium",
        "blocks_trading": True,
    },
    ReasonCode.DIRECTION_CONFLICT: {
        "message": "Higher timeframe and lower timeframe directions disagree",
        "severity": "medium",
        "blocks_trading": False,
    },
    ReasonCode.RR_BELOW_MINIMUM: {
        "message": "Risk-reward ratio below minimum threshold",
        "severity": "medium",
        "blocks_trading": False,
    },
    ReasonCode.ENTRY_TOO_EXTENDED: {
        "message": "Entry price too far from ideal zone",
        "severity": "low",
        "blocks_trading": False,
    },
    ReasonCode.STALE_CANDLES: {
        "message": "Candle data may be stale, awaiting fresh data",
        "severity": "low",
        "blocks_trading": False,
    },
    ReasonCode.STRUCTURE_NOT_CONFIRMED: {
        "message": "Market structure not yet confirmed",
        "severity": "medium",
        "blocks_trading": False,
    },
    ReasonCode.SPREAD_TOO_WIDE: {
        "message": "Spread exceeds acceptable threshold",
        "severity": "high",
        "blocks_trading": True,
    },
    ReasonCode.LIQUIDITY_NOT_CONFIRMED: {
        "message": "Sufficient liquidity not yet confirmed",
        "severity": "medium",
        "blocks_trading": False,
    },
    ReasonCode.VOLATILITY_TOO_HIGH: {
        "message": "Volatility exceeds safe trading thresholds",
        "severity": "high",
        "blocks_trading": True,
    },
    ReasonCode.VOLATILITY_TOO_LOW: {
        "message": "Volatility too low for effective trading",
        "severity": "low",
        "blocks_trading": False,
    },
    ReasonCode.PORTFOLIO_RISK_EXCEEDED: {
        "message": "Portfolio risk limit would be exceeded",
        "severity": "high",
        "blocks_trading": True,
    },
    ReasonCode.PROVIDER_RATE_LIMITED: {
        "message": "Data provider rate limit reached",
        "severity": "medium",
        "blocks_trading": True,
    },
    ReasonCode.PROVIDER_UNAVAILABLE: {
        "message": "Data provider temporarily unavailable",
        "severity": "high",
        "blocks_trading": True,
    },
    ReasonCode.MODEL_COVERAGE_LOW: {
        "message": "Model confidence coverage below threshold",
        "severity": "medium",
        "blocks_trading": False,
    },
    ReasonCode.GATHERING_EVIDENCE: {
        "message": "Gathering additional evidence for setup",
        "severity": "low",
        "blocks_trading": False,
    },
    ReasonCode.AWAITING_TRIGGER: {
        "message": "Awaiting specific trigger condition",
        "severity": "low",
        "blocks_trading": False,
    },
    ReasonCode.SCORE_BELOW_THRESHOLD: {
        "message": "Setup score below minimum threshold",
        "severity": "medium",
        "blocks_trading": False,
    },
    ReasonCode.COVERAGE_IMPROVING: {
        "message": "Model coverage improving over time",
        "severity": "low",
        "blocks_trading": False,
    },
    ReasonCode.NO_USABLE_CANDLES: {
        "message": "No usable entry-timeframe candles",
        "severity": "high",
        "blocks_trading": True,
    },
    ReasonCode.NO_CONFIRMED_DIRECTION: {
        "message": "V2 has no confirmed direction",
        "severity": "medium",
        "blocks_trading": True,
    },
    ReasonCode.DATA_QUALITY_POOR: {
        "message": "Data quality is insufficient for trading",
        "severity": "medium",
        "blocks_trading": True,
    },
    ReasonCode.CALENDAR_BLOCKED: {
        "message": "Economic calendar blocks trading",
        "severity": "high",
        "blocks_trading": True,
    },
    ReasonCode.INVALID_STRUCTURAL_STOP: {
        "message": "Could not calculate a valid structural stop",
        "severity": "medium",
        "blocks_trading": True,
    },
    ReasonCode.TRADE_TIMING_AVOID: {
        "message": "Trade timing conditions avoid entry",
        "severity": "medium",
        "blocks_trading": False,
    },
}


def build_blocking_reason(
    code: ReasonCode,
    data: Optional[Dict[str, Any]] = None,
    custom_message: Optional[str] = None,
) -> Dict[str, Any]:
    template = REASON_MESSAGES.get(code, {})
    return {
        "code": code.value,
        "message": custom_message or template.get("message", code.value),
        "severity": template.get("severity", "medium"),
        "blocks_trading": template.get("blocks_trading", False),
        "data": data,
    }


def build_wait_reason(
    code: ReasonCode,
    message: str,
    severity: str = "medium",
    blocks_trading: bool = False,
    data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return {
        "code": code.value,
        "message": message,
        "severity": severity,
        "blocks_trading": blocks_trading,
        "data": data,
    }
