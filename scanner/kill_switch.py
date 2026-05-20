"""Global kill switch — blocks all new orders when engaged.

File-based for simplicity: presence of the file at KILL_SWITCH_PATH
means engaged. Easy to flip from Render's shell or via a small admin
endpoint later. Survives restarts; visible at a glance.
"""
from __future__ import annotations

import os
from pathlib import Path


class KillSwitch:
    def __init__(self, path: str | Path = None):
        self.path = Path(path or os.environ.get("KILL_SWITCH_PATH", "/tmp/bwts.kill"))

    def is_engaged(self) -> bool:
        return self.path.exists()

    def engage(self, reason: str = "") -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(reason or "engaged")

    def disengage(self) -> None:
        if self.path.exists():
            self.path.unlink()

    def reason(self) -> str:
        if not self.is_engaged():
            return ""
        try:
            return self.path.read_text().strip()
        except OSError:
            return ""
