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
from .sample_data import generate_sample_forecasts, resolve_sample_forecasts

__all__ = [
    'ForwardEngine',
    'ForwardForecast',
    'ForecastOutcome',
    'CalibrationAnalyzer',
    'CalibrationResult',
    'SegmentationAnalyzer',
    'SegmentResult',
    'generate_sample_forecasts',
    'resolve_sample_forecasts',
]
