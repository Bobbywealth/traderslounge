"""Portfolio Risk Brain — directional-cluster / USD-exposure / portfolio heat.

Roadmap #4.  Computes the kind of portfolio view that turns four
'separate' setups (EURUSD BUY + GBPUSD BUY + AUDUSD BUY + XAUUSD BUY)
into a single 2.1%-equivalent USD-short bet.

Inputs are a list of setups (active paper positions + eligible setups)
with symbol, direction, asset_class, and size_r_pct (risk as percent
of equity).  Outputs:

  exposure_by_currency     — net long/short exposure per quote currency
  directional_clusters     — same-direction clusters by asset_class
  correlation_matrix       — pairwise symbol correlations (heuristic
                             by asset class + direction for now;
                             learned correlations come later)
  open_risk_pct            — sum of risk_pct across open positions
  daily_risk_pct           — risk taken in the last 24h
  weekly_drawdown_pct      — realized loss in the last 7 days
  sector_exposure          — fx/metals/crypto/equity breakdown
  gold_usd_correlation     — explicit XAUUSD vs DXY-style proxy
  portfolio_heat_pct       — single-number 'how exposed are we' gauge

Recommendation: if a new setup would push portfolio_heat above the
configured limit (default 6%), shrink the new position's risk to
keep heat constant.  Mirrors Bobby's example:

  ⚠ CORRELATION RISK
  You currently have 2.1% equivalent USD-short exposure.
  New XAUUSD BUY would increase effective exposure to 2.8%.
  Recommended risk: 0.35% rather than 1%.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Optional


# USD-positive symbols: when LONG, you are SHORT USD.
# USD-negative symbols: when LONG, you are LONG USD.
USD_POSITIVE = frozenset({
    "EURUSD", "GBPUSD", "AUDUSD", "NZDUSD",
    "XAUUSD", "XAGUSD",
    "BTCUSD", "ETHUSD", "SOLUSD",
})
USD_NEGATIVE = frozenset({
    "USDJPY", "USDCHF", "USDCAD",
    "US30USD", "US500USD", "NAS100USD",
})

# Sector classification.  Crude but explicit so the breakdown is
# inspectable.
SECTOR_MAP: dict[str, str] = {
    "EURUSD": "fx", "GBPUSD": "fx", "AUDUSD": "fx", "NZDUSD": "fx",
    "USDJPY": "fx", "USDCHF": "fx", "USDCAD": "fx",
    "XAUUSD": "metals", "XAGUSD": "metals",
    "BTCUSD": "crypto", "ETHUSD": "crypto", "SOLUSD": "crypto",
    "US30USD": "equity_index", "US500USD": "equity_index", "NAS100USD": "equity_index",
    "AAPLUSD": "equity", "MSFTUSD": "equity", "NVDAUSD": "equity",
    "GOOGLUSD": "equity", "AMZNUSD": "equity", "METAUSD": "equity",
    "TSLAUSD": "equity",
}


@dataclass
class SetupExposure:
    """Minimal view of a setup or paper position for portfolio math."""
    symbol: str
    direction: str  # 'BUY' or 'SELL'
    asset_class: str = ""
    size_r_pct: float = 1.0  # risk as % of equity
    age_hours: float = 0.0   # hours since the trade was opened


@dataclass
class PortfolioRiskReport:
    """Output of ``analyze_portfolio_risk``."""
    heat_pct: float = 0.0
    open_risk_pct: float = 0.0
    daily_risk_pct: float = 0.0
    weekly_drawdown_pct: float = 0.0
    exposure_by_currency: dict[str, float] = field(default_factory=dict)
    directional_clusters: dict[str, dict[str, float]] = field(default_factory=dict)
    correlation_matrix: dict[str, dict[str, float]] = field(default_factory=dict)
    sector_exposure: dict[str, float] = field(default_factory=dict)
    gold_usd_correlation: float = 0.0
    warnings: list[str] = field(default_factory=list)
    recommended_size_pct: Optional[float] = None
    setup_count: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "heat_pct": round(self.heat_pct, 3),
            "open_risk_pct": round(self.open_risk_pct, 3),
            "daily_risk_pct": round(self.daily_risk_pct, 3),
            "weekly_drawdown_pct": round(self.weekly_drawdown_pct, 3),
            "exposure_by_currency": {k: round(v, 3) for k, v in self.exposure_by_currency.items()},
            "directional_clusters": {
                k: {d: round(v, 3) for d, v in dirs.items()}
                for k, dirs in self.directional_clusters.items()
            },
            "correlation_matrix": {
                a: {b: round(c, 3) for b, c in row.items()}
                for a, row in self.correlation_matrix.items()
            },
            "sector_exposure": {k: round(v, 3) for k, v in self.sector_exposure.items()},
            "gold_usd_correlation": round(self.gold_usd_correlation, 3),
            "warnings": list(self.warnings),
            "recommended_size_pct": (
                round(self.recommended_size_pct, 3)
                if self.recommended_size_pct is not None else None
            ),
            "setup_count": self.setup_count,
        }


def _direction_sign(direction: str) -> int:
    return 1 if str(direction or "").upper() == "BUY" else -1


def _usd_exposure_delta(symbol: str, direction: str) -> float:
    """Return the +USD exposure contribution of a single setup.

    Positive means a LONG-USD bet; negative means a SHORT-USD bet.
    Sized by 1.0 per unit of size_r_pct — caller scales by the actual risk.
    """
    sym = str(symbol or "").upper()
    sign = _direction_sign(direction)
    if sym in USD_POSITIVE:
        return -sign
    if sym in USD_NEGATIVE:
        return sign
    return 0.0


def _correlation(symbol_a: str, symbol_b: str, dir_a: str, dir_b: str) -> float:
    """Heuristic pairwise correlation.  Same-direction same-cluster setups
    are highly correlated; cross-cluster setups are not.  Real learned
    correlations come later."""
    if symbol_a == symbol_b:
        return 1.0
    sector_a = SECTOR_MAP.get(symbol_a.upper(), "other")
    sector_b = SECTOR_MAP.get(symbol_b.upper(), "other")
    same_sector = sector_a == sector_b
    same_direction = _direction_sign(dir_a) == _direction_sign(dir_b)
    if same_sector and same_direction:
        return 0.85
    if same_sector and not same_direction:
        return -0.6
    if symbol_a.upper() == "XAUUSD" or symbol_b.upper() == "XAUUSD":
        # Gold is the universal hedge — partial negative correlation
        # against everything else.
        return -0.3
    return 0.0


def analyze_portfolio_risk(
    setups: Iterable[SetupExposure],
    weekly_realized_pnl_pct: float = 0.0,
    heat_limit_pct: float = 6.0,
) -> PortfolioRiskReport:
    """Compute the portfolio risk report for the given open + eligible setups.

    ``weekly_realized_pnl_pct`` is the realized P&L as a % of equity for
    the trailing 7 days (negative = drawdown).  ``heat_limit_pct`` is the
    maximum total risk the portfolio should carry.
    """
    setups = list(setups)
    report = PortfolioRiskReport(setup_count=len(setups))

    if not setups:
        return report

    # Per-currency USD exposure — scale by risk %.
    usd_total = 0.0
    for s in setups:
        delta = _usd_exposure_delta(s.symbol, s.direction)
        usd_total += delta * float(s.size_r_pct or 0.0)
    report.exposure_by_currency["USD"] = round(usd_total, 3)

    # Directional clusters: group by asset_class, accumulate by direction.
    clusters: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for s in setups:
        sector = SECTOR_MAP.get(s.symbol.upper(), "other")
        sign = _direction_sign(s.direction)
        clusters[sector]["LONG" if sign > 0 else "SHORT"] += float(s.size_r_pct or 0.0)
    report.directional_clusters = {k: dict(v) for k, v in clusters.items()}

    # Sector exposure as % of total risk.
    total_risk = sum(float(s.size_r_pct or 0.0) for s in setups)
    if total_risk > 0:
        report.sector_exposure = {
            sector: round(sum(dirs.values()), 3)
            for sector, dirs in clusters.items()
        }

    # Open risk and daily risk (≤24h).
    report.open_risk_pct = round(total_risk, 3)
    report.daily_risk_pct = round(
        sum(float(s.size_r_pct or 0.0) for s in setups if s.age_hours <= 24.0),
        3,
    )

    # Weekly drawdown.
    report.weekly_drawdown_pct = float(weekly_realized_pnl_pct)

    # Portfolio heat — same as open_risk for now; future PRs can
    # add correlation-weighted exposure here.
    report.heat_pct = round(report.open_risk_pct, 3)

    # Pairwise correlation matrix.
    symbols = sorted({s.symbol.upper() for s in setups})
    matrix: dict[str, dict[str, float]] = {}
    for a in symbols:
        row: dict[str, float] = {}
        dir_a = next(s.direction for s in setups if s.symbol.upper() == a)
        for b in symbols:
            dir_b = next(s.direction for s in setups if s.symbol.upper() == b)
            row[b] = _correlation(a, b, dir_a, dir_b)
        matrix[a] = row
    report.correlation_matrix = matrix

    # Gold / USD correlation: average of XAUUSD cross-correlations,
    # excluding the self-correlation (1.0) so we report the *average
    # pairwise hedge relationship* rather than a tautology.
    if "XAUUSD" in matrix:
        gold_row = matrix["XAUUSD"]
        cross = [c for other, c in gold_row.items() if other != "XAUUSD"]
        report.gold_usd_correlation = (
            round(sum(cross) / len(cross), 3) if cross else 0.0
        )

    # Warnings + sizing recommendation.
    if abs(usd_total) > heat_limit_pct:
        report.warnings.append(
            f"USD exposure {usd_total:.2f}% exceeds limit {heat_limit_pct:.2f}%"
        )
        # Shrink the next USD-positive position to keep heat constant.
        report.recommended_size_pct = max(0.0, heat_limit_pct - abs(usd_total))
    elif total_risk > heat_limit_pct:
        report.warnings.append(
            f"Portfolio heat {total_risk:.2f}% exceeds limit {heat_limit_pct:.2f}%"
        )
        report.recommended_size_pct = max(0.0, heat_limit_pct - total_risk)
    return report


def setup_exposures_from_lifecycle(
    lifecycle: Any,
    default_risk_pct: float = 1.0,
    now_ts: Optional[float] = None,
) -> list[SetupExposure]:
    """Translate the autonomy loop's active setups into SetupExposure rows.

    lifecycle is a SetupLifecycle instance; get_active_setups()
    returns the list of SetupRecord rows.  Each row carries symbol,
    direction, asset_class, and a detected_at timestamp; per-trade
    risk is approximated by default_risk_pct because SetupRecord
    doesn't carry equity-denominated size (the canonical per-trade cap
    in scanner.autonomy.risk.risk_manager is also 1.0%).

    This helper is intentionally tolerant: missing fields default to
    safe values so a partially-populated lifecycle never crashes the
    portfolio endpoint.
    """
    if lifecycle is None or not hasattr(lifecycle, "get_active_setups"):
        return []
    try:
        records = lifecycle.get_active_setups() or []
    except Exception:
        return []

    now = float(now_ts) if now_ts is not None else __import__("time").time()
    out: list[SetupExposure] = []
    for r in records:
        try:
            symbol = str(getattr(r, "symbol", "") or "").upper()
            if not symbol:
                continue
            direction = str(getattr(r, "direction", "") or "BUY").upper()
            if direction not in {"BUY", "SELL"}:
                continue
            asset_class = str(getattr(r, "asset_class", "") or "")
            detected_at = float(getattr(r, "detected_at", now) or now)
            age_hours = max(0.0, (now - detected_at) / 3600.0)
            out.append(SetupExposure(
                symbol=symbol,
                direction=direction,
                asset_class=asset_class,
                size_r_pct=float(default_risk_pct),
                age_hours=age_hours,
            ))
        except Exception:
            continue
    return out
