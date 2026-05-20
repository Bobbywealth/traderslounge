import os
import tempfile
import unittest
from pathlib import Path

from scanner.kill_switch import KillSwitch


class TestKillSwitch(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = Path(self.tmp) / "kill"

    def tearDown(self):
        if self.path.exists():
            self.path.unlink()
        os.rmdir(self.tmp)

    def test_default_disengaged(self):
        ks = KillSwitch(self.path)
        self.assertFalse(ks.is_engaged())
        self.assertEqual(ks.reason(), "")

    def test_engage_disengage(self):
        ks = KillSwitch(self.path)
        ks.engage("test pause")
        self.assertTrue(ks.is_engaged())
        self.assertEqual(ks.reason(), "test pause")
        ks.disengage()
        self.assertFalse(ks.is_engaged())

    def test_disengage_when_not_engaged_is_safe(self):
        KillSwitch(self.path).disengage()  # no exception


if __name__ == "__main__":
    unittest.main()
