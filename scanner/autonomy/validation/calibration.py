"""
Calibration Analyzer for Confluence X.

Analyzes the calibration of probability forecasts.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class CalibrationBucket:
    """A bucket for calibration analysis."""
    lower_bound: float
    upper_bound: float
    count: int = 0
    wins: int = 0
    losses: int = 0
    avg_predicted_prob: float = 0.0
    actual_win_rate: float = 0.0


@dataclass
class CalibrationResult:
    """Result of calibration analysis."""
    n_bins: int = 10
    buckets: List[CalibrationBucket] = field(default_factory=list)
    ece: float = 0.0  # Expected Calibration Error
    mce: float = 0.0  # Maximum Calibration Error
    brier_score: float = 0.0
    log_loss: float = 0.0
    is_well_calibrated: bool = False


class CalibrationAnalyzer:
    """
    Calibration Analyzer.
    
    Analyzes the calibration of probability forecasts.
    """
    
    def __init__(self, n_bins: int = 10):
        self.n_bins = n_bins
    
    def analyze(self, forecasts: List[dict]) -> CalibrationResult:
        """Analyze calibration of probability forecasts."""
        if not forecasts:
            return CalibrationResult(n_bins=self.n_bins)
        
        # Create buckets
        buckets = self._create_buckets(forecasts)
        
        # Calculate ECE
        ece = self._calculate_ece(buckets, len(forecasts))
        
        # Calculate MCE
        mce = self._calculate_mce(buckets)
        
        # Calculate Brier Score
        brier_score = self._calculate_brier_score(forecasts)
        
        # Calculate Log Loss
        log_loss = self._calculate_log_loss(forecasts)
        
        # Determine if well calibrated
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
    
    def _calculate_ece(self, buckets: List[CalibrationBucket], 
                       total_samples: int) -> float:
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
        
        epsilon = 1e-15
        total_loss = 0
        
        for f in forecasts:
            prob = max(epsilon, min(1 - epsilon, f.get('predicted_probability', 0.5)))
            outcome = 1.0 if f.get('outcome', False) else 0.0
            
            if outcome == 1:
                total_loss -= math.log(prob)
            else:
                total_loss -= math.log(1 - prob)
        
        return total_loss / len(forecasts)
