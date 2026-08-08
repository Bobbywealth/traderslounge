"""
Calibration analysis for trading forecasts.

Handles:
- Probability calibration
- Confidence interval analysis
- Score distribution analysis
- Segment-level validation
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional


@dataclass
class CalibrationBucket:
    """A bucket for calibration analysis."""
    lower_bound: float
    upper_bound: float
    count: int
    wins: int
    losses: int
    avg_predicted_prob: float
    actual_win_rate: float


@dataclass
class CalibrationResult:
    """Result of calibration analysis."""
    n_bins: int
    buckets: List[CalibrationBucket]
    ece: float  # Expected Calibration Error
    mce: float  # Maximum Calibration Error
    brier_score: float
    log_loss: float
    is_well_calibrated: bool


@dataclass
class SegmentValidation:
    """Validation result for a specific segment."""
    segment_name: str
    segment_value: str
    sample_size: int
    win_rate: float
    expectancy: float
    profit_factor: float
    confidence_interval: tuple[float, float]
    is_significant: bool


class CalibrationAnalyzer:
    """Analyze calibration of probability forecasts."""
    
    def __init__(self, n_bins: int = 10):
        self.n_bins = n_bins
    
    def analyze_calibration(
        self,
        forecasts: List[dict],
    ) -> CalibrationResult:
        """Analyze calibration of probability forecasts.
        
        Args:
            forecasts: List of forecasts with 'predicted_probability' and 'outcome'
        
        Returns:
            CalibrationResult with detailed analysis
        """
        if not forecasts:
            return CalibrationResult(
                n_bins=self.n_bins,
                buckets=[],
                ece=1.0,
                mce=1.0,
                brier_score=1.0,
                log_loss=float('inf'),
                is_well_calibrated=False,
            )
        
        # Create buckets
        buckets = self._create_buckets(forecasts)
        
        # Calculate ECE (Expected Calibration Error)
        ece = self._calculate_ece(buckets, len(forecasts))
        
        # Calculate MCE (Maximum Calibration Error)
        mce = self._calculate_mce(buckets)
        
        # Calculate Brier Score
        brier_score = self._calculate_brier_score(forecasts)
        
        # Calculate Log Loss
        log_loss = self._calculate_log_loss(forecasts)
        
        # Determine if well calibrated (ECE < 0.05)
        is_well_calibrated = ece < 0.05
        
        return CalibrationResult(
            n_bins=self.n_bins,
            buckets=buckets,
            ece=ece,
            mce=mce,
            brier_score=brier_score,
            log_loss=log_loss,
            is_well_calibrated=is_well_calibrated,
        )
    
    def analyze_by_segment(
        self,
        forecasts: List[dict],
        segment_key: str,
    ) -> List[SegmentValidation]:
        """Analyze calibration by segment (e.g., symbol, timeframe)."""
        # Group forecasts by segment
        segments: Dict[str, List[dict]] = {}
        for f in forecasts:
            value = f.get(segment_key, 'unknown')
            if value not in segments:
                segments[value] = []
            segments[value].append(f)
        
        results = []
        for segment_value, segment_forecasts in segments.items():
            # Calculate metrics for this segment
            resolved = [f for f in segment_forecasts if f.get('outcome') is not None]
            
            if not resolved:
                continue
            
            wins = sum(1 for f in resolved if f.get('outcome', False))
            r_multiples = [f.get('r_multiple', 0) for f in resolved]
            
            win_rate = wins / len(resolved) if resolved else 0
            expectancy = sum(r_multiples) / len(r_multiples) if r_multiples else 0
            
            gross_profit = sum(r for r in r_multiples if r > 0)
            gross_loss = abs(sum(r for r in r_multiples if r < 0))
            profit_factor = gross_profit / gross_loss if gross_loss > 0 else float('inf')
            
            # Confidence interval
            ci_lower, ci_upper = self._wilson_interval(wins, len(resolved))
            
            # Statistical significance (is win rate significantly different from 50%?)
            p_value = self._binomial_p_value(wins, len(resolved))
            is_significant = p_value < 0.05
            
            results.append(SegmentValidation(
                segment_name=segment_key,
                segment_value=segment_value,
                sample_size=len(resolved),
                win_rate=win_rate,
                expectancy=expectancy,
                profit_factor=profit_factor,
                confidence_interval=(ci_lower, ci_upper),
                is_significant=is_significant,
            ))
        
        return sorted(results, key=lambda x: x.sample_size, reverse=True)
    
    def _create_buckets(self, forecasts: List[dict]) -> List[CalibrationBucket]:
        """Create calibration buckets."""
        buckets = []
        
        for i in range(self.n_bins):
            lower = i / self.n_bins
            upper = (i + 1) / self.n_bins
            
            # Get forecasts in this bucket
            bucket_forecasts = [
                f for f in forecasts
                if lower <= f.get('predicted_probability', 0.5) < upper
            ]
            
            if not bucket_forecasts:
                buckets.append(CalibrationBucket(
                    lower_bound=lower,
                    upper_bound=upper,
                    count=0,
                    wins=0,
                    losses=0,
                    avg_predicted_prob=(lower + upper) / 2,
                    actual_win_rate=0,
                ))
                continue
            
            wins = sum(1 for f in bucket_forecasts if f.get('outcome', False))
            losses = len(bucket_forecasts) - wins
            
            avg_predicted_prob = sum(
                f.get('predicted_probability', 0.5) for f in bucket_forecasts
            ) / len(bucket_forecasts)
            
            actual_win_rate = wins / len(bucket_forecasts)
            
            buckets.append(CalibrationBucket(
                lower_bound=lower,
                upper_bound=upper,
                count=len(bucket_forecasts),
                wins=wins,
                losses=losses,
                avg_predicted_prob=avg_predicted_prob,
                actual_win_rate=actual_win_rate,
            ))
        
        return buckets
    
    def _calculate_ece(self, buckets: List[CalibrationBucket], total_samples: int) -> float:
        """Calculate Expected Calibration Error."""
        if total_samples == 0:
            return 1.0
        
        ece = 0
        for bucket in buckets:
            if bucket.count == 0:
                continue
            
            weight = bucket.count / total_samples
            ece += weight * abs(bucket.actual_win_rate - bucket.avg_predicted_prob)
        
        return ece
    
    def _calculate_mce(self, buckets: List[CalibrationBucket]) -> float:
        """Calculate Maximum Calibration Error."""
        mce = 0
        for bucket in buckets:
            if bucket.count == 0:
                continue
            
            error = abs(bucket.actual_win_rate - bucket.avg_predicted_prob)
            mce = max(mce, error)
        
        return mce
    
    def _calculate_brier_score(self, forecasts: List[dict]) -> float:
        """Calculate Brier Score."""
        if not forecasts:
            return 1.0
        
        total_score = 0
        for f in forecasts:
            prob = f.get('predicted_probability', 0.5)
            outcome = 1.0 if f.get('outcome', False) else 0.0
            total_score += (prob - outcome) ** 2
        
        return total_score / len(forecasts)
    
    def _calculate_log_loss(self, forecasts: List[dict]) -> float:
        """Calculate Log Loss."""
        if not forecasts:
            return float('inf')
        
        epsilon = 1e-15  # Prevent log(0)
        total_loss = 0
        
        for f in forecasts:
            prob = max(epsilon, min(1 - epsilon, f.get('predicted_probability', 0.5)))
            outcome = 1.0 if f.get('outcome', False) else 0.0
            
            if outcome == 1:
                total_loss -= math.log(prob)
            else:
                total_loss -= math.log(1 - prob)
        
        return total_loss / len(forecasts)
    
    def _wilson_interval(self, successes: int, total: int, confidence: float = 0.95) -> tuple[float, float]:
        """Calculate Wilson score confidence interval."""
        if total == 0:
            return (0, 1)
        
        p = successes / total
        z = 1.96 if confidence == 0.95 else 2.576
        
        denominator = 1 + z**2 / total
        center = (p + z**2 / (2 * total)) / denominator
        spread = z * math.sqrt((p * (1 - p) + z**2 / (4 * total)) / total) / denominator
        
        return (max(0, center - spread), min(1, center + spread))
    
    def _binomial_p_value(self, successes: int, total: int) -> float:
        """Calculate p-value for two-tailed binomial test."""
        if total == 0:
            return 1.0
        
        # Normal approximation
        p_hat = successes / total
        se = math.sqrt(0.5 * 0.5 / total)
        
        if se == 0:
            return 1.0
        
        z = abs(p_hat - 0.5) / se
        
        # Approximate p-value
        p_value = 2 * (1 - 0.5 * (1 + math.erf(z / math.sqrt(2))))
        return p_value
