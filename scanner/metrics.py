import json
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List

@dataclass
class Metric:
    name: str
    value: float
    labels: Dict[str, str] = field(default_factory=dict)
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class MetricsCollector:
    def __init__(self):
        self._metrics: List[Metric] = []
        self._counters: Dict[str, float] = {}
        self._histograms: Dict[str, List[float]] = {}
        self._lock = threading.Lock()
    
    def increment(self, name: str, value: float = 1, labels: Dict[str, str] = None):
        with self._lock:
            key = f"{name}:{json.dumps(labels or {})}"
            self._counters[key] = self._counters.get(key, 0) + value
            self._metrics.append(Metric(name=name, value=value, labels=labels or {}))
    
    def observe(self, name: str, value: float, labels: Dict[str, str] = None):
        with self._lock:
            key = f"{name}:{json.dumps(labels or {})}"
            if key not in self._histograms:
                self._histograms[key] = []
            self._histograms[key].append(value)
            self._metrics.append(Metric(name=name, value=value, labels=labels or {}))
    
    def timing(self, name: str, duration_ms: float, labels: Dict[str, str] = None):
        self.observe(f"{name}.duration_ms", duration_ms, labels)
    
    def get_prometheus_metrics(self) -> str:
        lines = []
        with self._lock:
            for key, value in self._counters.items():
                name = key.split(':')[0]
                lines.append(f"# TYPE {name} counter")
                lines.append(f"{name} {value}")
            for key, values in self._histograms.items():
                name = key.split(':')[0]
                avg = sum(values) / len(values) if values else 0
                lines.append(f"# TYPE {name} gauge")
                lines.append(f"{name}_avg {avg}")
                lines.append(f"{name}_count {len(values)}")
        return '\n'.join(lines)

metrics = MetricsCollector()