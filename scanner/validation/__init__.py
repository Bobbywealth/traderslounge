"""
Trading edge validation module for ConfluenceX.

Provides statistical validation of trading signals and forecasts.
"""
from .metrics import ValidationMetrics
from .forward_test import ForwardTestResolver
from .calibration import CalibrationAnalyzer

__all__ = [
    'ValidationMetrics',
    'ForwardTestResolver',
    'CalibrationAnalyzer',
]
