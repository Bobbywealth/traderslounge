"""
Validation metrics for trading edge analysis.

Calculates:
- Win rate
- Expectancy
- Profit factor
- Maximum drawdown
- Sharpe ratio
- Brier score
- Calibration error
- Confidence intervals
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class ValidationResult:
    """Complete validation result with all metrics."""
    # Sample sizes
    total_forecasts: int
    resolved_forecasts: int
    unresolved_forecasts: int
    
    # Core metrics
    win_rate: float
    expectancy: float  # Expected R per trade
    profit_factor: float
    max_drawdown: float  # Maximum drawdown in R
    
    # Risk-adjusted metrics
    sharpe_ratio: float
    sortino_ratio: float
    
    # Calibration metrics
    brier_score: float
    calibration_error: float
    
    # Statistical significance
    confidence_interval_95: tuple[float, float]
    p_value: float
    statistically_significant: bool
    
    # Segment breakdown (optional)
    by_symbol: Optional[dict] = None
    by_timeframe: Optional[dict] = None
    by_direction: Optional[dict] = None
    by_score_range: Optional[dict] = None


class ValidationMetrics:
    """Calculate validation metrics for trading forecasts."""
    
    @staticmethod
    def calculate(forecasts: List[dict]) -> ValidationResult:
        """Calculate all validation metrics from forecast data.
        
        Args:
            forecasts: List of forecast dictionaries with outcome data
        
        Returns:
            ValidationResult with all calculated metrics
        """
        # Separate resolved and unresolved
        resolved = [f for f in forecasts if f.get('outcome') is not None]
        unresolved = [f for f in forecasts if f.get('outcome') is None]
        
        total = len(forecasts)
        resolved_count = len(resolved)
        unresolved_count = len(unresolved)
        
        if resolved_count == 0:
            return ValidationResult(
                total_forecasts=total,
                resolved_forecasts=0,
                unresolved_forecasts=unresolved_count,
                win_rate=0,
                expectancy=0,
                profit_factor=0,
                max_drawdown=0,
                sharpe_ratio=0,
                sortino_ratio=0,
                brier_score=1.0,
                calibration_error=1.0,
                confidence_interval_95=(0, 0),
                p_value=1.0,
                statistically_significant=False,
            )
        
        # Extract R-multiples
        r_multiples = [f.get('r_multiple', 0) for f in resolved]
        outcomes = [f.get('outcome', False) for f in resolved]
        
        # Win rate
        wins = sum(1 for o in outcomes if o)
        win_rate = wins / resolved_count
        
        # Expectancy (average R per trade)
        expectancy = sum(r_multiples) / resolved_count
        
        # Profit factor
        gross_profit = sum(r for r in r_multiples if r > 0)
        gross_loss = abs(sum(r for r in r_multiples if r < 0))
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else float('inf')
        
        # Maximum drawdown
        max_drawdown = ValidationMetrics._calculate_max_drawdown(r_multiples)
        
        # Sharpe ratio (assuming risk-free rate = 0)
        sharpe_ratio = ValidationMetrics._calculate_sharpe(r_multiples)
        
        # Sortino ratio
        sortino_ratio = ValidationMetrics._calculate_sortino(r_multiples)
        
        # Brier score (for probability forecasts)
        brier_score = ValidationMetrics._calculate_brier_score(resolved)
        
        # Calibration error
        calibration_error = ValidationMetrics._calculate_calibration_error(resolved)
        
        # Confidence interval for win rate
        ci_lower, ci_upper = ValidationMetrics._calculate_confidence_interval(
            wins, resolved_count, 0.95
        )
        
        # P-value (is win rate significantly different from 50%?)
        p_value = ValidationMetrics._calculate_p_value(wins, resolved_count)
        
        # Statistical significance (p < 0.05)
        statistically_significant = p_value < 0.05
        
        return ValidationResult(
            total_forecasts=total,
            resolved_forecasts=resolved_count,
            unresolved_forecasts=unresolved_count,
            win_rate=win_rate,
            expectancy=expectancy,
            profit_factor=profit_factor,
            max_drawdown=max_drawdown,
            sharpe_ratio=sharpe_ratio,
            sortino_ratio=sortino_ratio,
            brier_score=brier_score,
            calibration_error=calibration_error,
            confidence_interval_95=(ci_lower, ci_upper),
            p_value=p_value,
            statistically_significant=statistically_significant,
        )
    
    @staticmethod
    def _calculate_max_drawdown(r_multiples: List[float]) -> float:
        """Calculate maximum drawdown in R."""
        if not r_multiples:
            return 0
        
        peak = 0
        max_dd = 0
        cumulative = 0
        
        for r in r_multiples:
            cumulative += r
            if cumulative > peak:
                peak = cumulative
            dd = peak - cumulative
            if dd > max_dd:
                max_dd = dd
        
        return max_dd
    
    @staticmethod
    def _calculate_sharpe(r_multiples: List[float], risk_free_rate: float = 0) -> float:
        """Calculate Sharpe ratio."""
        if len(r_multiples) < 2:
            return 0
        
        mean_return = sum(r_multiples) / len(r_multiples)
        variance = sum((r - mean_return) ** 2 for r in r_multiples) / (len(r_multiples) - 1)
        std_dev = math.sqrt(variance)
        
        if std_dev == 0:
            return 0
        
        return (mean_return - risk_free_rate) / std_dev
    
    @staticmethod
    def _calculate_sortino(r_multiples: List[float], risk_free_rate: float = 0) -> float:
        """Calculate Sortino ratio (uses only downside deviation)."""
        if len(r_multiples) < 2:
            return 0
        
        mean_return = sum(r_multiples) / len(r_multiples)
        downside_returns = [r for r in r_multiples if r < risk_free_rate]
        
        if not downside_returns:
            return float('inf') if mean_return > risk_free_rate else 0
        
        downside_variance = sum((r - risk_free_rate) ** 2 for r in downside_returns) / len(downside_returns)
        downside_std = math.sqrt(downside_variance)
        
        if downside_std == 0:
            return 0
        
        return (mean_return - risk_free_rate) / downside_std
    
    @staticmethod
    def _calculate_brier_score(forecasts: List[dict]) -> float:
        """Calculate Brier score for probability forecasts.
        
        Lower is better (0 = perfect, 1 = worst).
        """
        if not forecasts:
            return 1.0
        
        total_score = 0
        for f in forecasts:
            predicted_prob = f.get('predicted_probability', 0.5)
            outcome = 1.0 if f.get('outcome', False) else 0.0
            total_score += (predicted_prob - outcome) ** 2
        
        return total_score / len(forecasts)
    
    @staticmethod
    def _calculate_calibration_error(forecasts: List[dict], n_bins: int = 10) -> float:
        """Calculate Expected Calibration Error (ECE)."""
        if not forecasts:
            return 1.0
        
        # Create bins
        bins = [[] for _ in range(n_bins)]
        
        for f in forecasts:
            prob = f.get('predicted_probability', 0.5)
            bin_idx = min(int(prob * n_bins), n_bins - 1)
            bins[bin_idx].append(f)
        
        # Calculate ECE
        total_error = 0
        total_samples = len(forecasts)
        
        for i, bin_forecasts in enumerate(bins):
            if not bin_forecasts:
                continue
            
            bin_prob = (i + 0.5) / n_bins
            bin_outcomes = [1.0 if f.get('outcome', False) else 0.0 for f in bin_forecasts]
            actual_prob = sum(bin_outcomes) / len(bin_outcomes)
            
            bin_weight = len(bin_forecasts) / total_samples
            total_error += bin_weight * abs(actual_prob - bin_prob)
        
        return total_error
    
    @staticmethod
    def _calculate_confidence_interval(
        successes: int, 
        total: int, 
        confidence: float = 0.95
    ) -> tuple[float, float]:
        """Calculate confidence interval for proportion."""
        if total == 0:
            return (0, 1)
        
        # Wilson score interval
        p = successes / total
        z = 1.96 if confidence == 0.95 else 2.576  # 95% or 99%
        
        denominator = 1 + z**2 / total
        center = (p + z**2 / (2 * total)) / denominator
        spread = z * math.sqrt((p * (1 - p) + z**2 / (4 * total)) / total) / denominator
        
        return (max(0, center - spread), min(1, center + spread))
    
    @staticmethod
    def _calculate_p_value(successes: int, total: int) -> float:
        """Calculate p-value for binomial test (H0: p = 0.5)."""
        if total == 0:
            return 1.0
        
        # Normal approximation for large samples
        if total >= 30:
            p_hat = successes / total
            se = math.sqrt(0.5 * 0.5 / total)
            z = abs(p_hat - 0.5) / se if se > 0 else 0
            
            # Approximate p-value from z-score
            # Using approximation of normal CDF
            p_value = 2 * (1 - ValidationMetrics._normal_cdf(z))
            return p_value
        
        # For small samples, use exact binomial
        # This is an approximation
        from scipy import stats  # type: ignore
        try:
            return 2 * min(
                stats.binom.cdf(successes, total, 0.5),
                1 - stats.binom.cdf(successes, total, 0.5)
            )
        except ImportError:
            # Fallback approximation
            return 0.5
    
    @staticmethod
    def _normal_cdf(x: float) -> float:
        """Approximate normal CDF."""
        return 0.5 * (1 + math.erf(x / math.sqrt(2)))
