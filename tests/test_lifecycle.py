import unittest
from scanner.lifecycle_manager import is_valid_transition

class LifecycleManager:
    def can_transition(self, from_state: str, to_state: str) -> bool:
        return is_valid_transition(from_state, to_state)


class TestLifecycle(unittest.TestCase):
    def test_valid_transitions(self):
        lm = LifecycleManager()
        self.assertTrue(lm.can_transition('ready', 'active'))
        self.assertTrue(lm.can_transition('ready', 'invalidated'))

    def test_invalid_transitions(self):
        lm = LifecycleManager()
        self.assertFalse(lm.can_transition('stopped', 'ready'))
        self.assertFalse(lm.can_transition('invalidated', 'active'))


if __name__ == '__main__':
    unittest.main()
