"""
Segmentation Analyzer for Confluence X.

Analyzes performance by different segments (symbol, timeframe, session, etc.).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class SegmentResult:
    """Result for a single segment."""
    segment_name: str
    segment_value: str
    sample_size: int = 0
    wins: int = 0
    losses: int = 0
    win_rate: float = 0.0
    avg_r: float = 0.0
    expectancy: float = 0.0
    profit_factor: float = 0.0
    max_drawdown: float = 0.0
    confidence_interval: tuple = (0.0, 0.0)
    is_significant: bool = False
    
    def to_dict(self) -> dict:
        return {
            'segment_name': self.segment_name,
            'segment_value': self.segment_value,
            'sample_size': self.sample_size,
            'wins': self.wins,
            'losses': self.losses,
            'win_rate': self.win_rate,
            'avg_r': self.avg_r,
            'expectancy': self.expectancy,
            'profit_factor': self.profit_factor,
            'max_drawdown': self.max_drawdown,
            'confidence_interval': self.confidence_interval,
            'is_significant': self.is_significant,
        }


@dataclass
class SegmentationReport:
    """Complete segmentation analysis report."""
    segment_name: str
    segments: List[SegmentResult] = field(default_factory=list)
    total_samples: int = 0
    
    def to_dict(self) -> dict:
        return {
            'segment_name': self.segment_name,
            'segments': [s.to_dict() for s in self.segments],
            'total_samples': self.total_samples,
        }


class SegmentationAnalyzer:
    """
    Segmentation Analyzer.
    
    Analyzes performance by different segments.
    """
    
    def analyze_by_segment(self, forecasts: List[dict], 
                          segment_key: str) -> SegmentationReport:
        """Analyze performance by a specific segment."""
        
        # Group by segment
        segments: Dict[str, List[dict]] = {}
        for f in forecasts:
            value = f.get(segment_key, 'unknown')
            if value not in segments:
                segments[value] = []
            segments[value].append(f)
        
        # Analyze each segment
        segment_results = []
        for segment_value, segment_forecasts in segments.items():
            result = self._analyze_segment(
                segment_key, segment_value, segment_forecasts
            )
            segment_results.append(result)
        
        # Sort by sample size
        segment_results.sort(key=lambda x: x.sample_size, reverse=True)
        
        return SegmentationReport(
            segment_name=segment_name,
            segments=segment_results,
            total_samples=len(forecasts),
        )
    
    def _analyze_segment(self, segment_name: str, segment_value: str,
                        forecasts: List[dict]) -> SegmentResult:
        """Analyze a single segment."""
        
        # Filter to resolved forecasts
        resolved = [f for f in forecasts if f.get('outcome') is not None]
        
        if not resolved:
            return SegmentResult(
                segment_name=segment_name,
                segment_value=segment_value,
            )
        
        # Calculate metrics
        wins = sum(1 for f in resolved if f.get('outcome', False))
        losses = len(resolved) - wins
        
        win_rate = wins / len(resolved) if resolved else 0
        
        r_multiples = [f.get('r_multiple', 0) for f in resolved]
        avg_r = sum(r_multiples) / len(r_multiples) if r_multiples else 0
        
        gross_profit = sum(r for r in r_multiples if r > 0)
        gross_loss = abs(sum(r for r in r_multiples if r < 0))
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else float('inf')
        
        # Calculate max drawdown
        max_drawdown = self._calculate_max_drawdown(r_multiples)
        
        # Calculate confidence interval
        ci_lower, ci_upper = self._wilson_interval(wins, len(resolved))
        
        # Statistical significance
        p_value = self._binomial_p_value(wins, len(resolved))
        is_significant = p_value < 0.05
        
        return SegmentResult(
            segment_name=segment_name,
            segment_value=segment_value,
            sample_size=len(resolved),
            wins=wins,
            losses=losses,
            win_rate=win_rate,
            avg_r=avg_r,
            expectancy=avg_r,
            profit_factor=profit_factor,
            max_drawdown=max_drawdown,
            confidence_interval=(ci_lower, ci_upper),
            is_significant=is_significant,
        )
    
    def _calculate_max_drawdown(self, r_multiples: List[float]) -> float:
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
    
    def _wilson_interval(self, successes: int, total: int, 
                        confidence: float = 0.95) -> tuple:
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
        
        p_hat = successes / total
        se = math.sqrt(0.5 * 0.5 / total)
        
        if se == 0:
            return 1.0
        
        z = abs(p_hat - 0.5) / se
        
        # Approximate p-value
        p_value = 2 * (1 - 0.5 * (1 + math.erf(z / math.sqrt(2))))
        return p_value
