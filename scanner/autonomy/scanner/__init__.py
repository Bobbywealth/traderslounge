"""
Autonomous Scanner for Confluence X.

Continuously scans the instrument universe, detects opportunities,
and ranks them by confluence score.
"""
from .autonomous_scanner import AutonomousScanner, RankedOpportunity

__all__ = [
    'AutonomousScanner',
    'RankedOpportunity',
]
