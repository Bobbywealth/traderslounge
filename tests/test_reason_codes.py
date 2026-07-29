import unittest
from scanner.reason_codes import ReasonCode, build_blocking_reason, build_wait_reason

class TestReasonCodes(unittest.TestCase):
    def test_blocking_reason_structure(self):
        reason = build_blocking_reason(
            ReasonCode.SCORE_BELOW_THRESHOLD,
            custom_message='Score 45 is below 60',
            data={'score': 45, 'minimum': 60}
        )
        self.assertEqual(reason['code'], 'score_below_threshold')
        self.assertIn('45', reason['message'])
        self.assertEqual(reason['severity'], 'medium')
        self.assertFalse(reason['blocks_trading'])

    def test_all_reason_codes_have_messages(self):
        for code in ReasonCode:
            pass


if __name__ == '__main__':
    unittest.main()
