"""
Forward Validation Engine for Confluence X.

Provides:
- Forward forecast recording (before outcomes)
- Score calibration analysis
- Walk-forward validation
- Segment performance analysis
- Confidence intervals
"""
from .forward_engine import ForwardEngine, ForwardForecast, ForecastOutcome
from .calibration import CalibrationAnalyzer, CalibrationResult
from .segmentation import SegmentationAnalyzer, SegmentResult

__all__ = [
    'ForwardEngine',
    'ForwardForecast',
    'ForecastOutcome',
    'CalibrationAnalyzer',
    'CalibrationResult',
    'SegmentationAnalyzer',
    'SegmentResult',
]
