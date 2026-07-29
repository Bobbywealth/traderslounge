import unittest
from scanner.risk_manager import RiskManager, ASSET_PARAMS, _get_asset_class

class TestPositionSizing(unittest.TestCase):
    def test_forex_position_size_calculation(self):
        rm = RiskManager(risk_per_trade_pct=1.0)
        result = rm.calculate_position_size(
            account_balance_usd=10000,
            entry=1.0850,
            stop=1.0800,
            symbol='EURUSD',
            direction='BUY',
            asset_class='forex'
        )
        self.assertAlmostEqual(result['risk_amount_usd'], 100.0, places=0)

    def test_gold_position_size_calculation(self):
        rm = RiskManager(risk_per_trade_pct=1.0)
        result = rm.calculate_position_size(
            account_balance_usd=10000,
            entry=1950.00,
            stop=1940.00,
            symbol='XAUUSD',
            direction='BUY',
            asset_class='metals'
        )
        self.assertGreater(result['risk_amount_usd'], 0)

    def test_crypto_position_size(self):
        rm = RiskManager(risk_per_trade_pct=1.0)
        result = rm.calculate_position_size(
            account_balance_usd=10000,
            entry=43000,
            stop=42500,
            symbol='BTCUSD',
            direction='BUY',
            asset_class='cryptocurrency'
        )
        self.assertGreater(result['risk_amount_usd'], 0)

    def test_asset_class_detection(self):
        self.assertEqual(_get_asset_class('EURUSD'), 'forex')
        self.assertEqual(_get_asset_class('USDJPY'), 'forex_jpy')
        self.assertEqual(_get_asset_class('XAUUSD'), 'metals')
        self.assertEqual(_get_asset_class('BTCUSD'), 'cryptocurrency')


class TestNetRRCalculation(unittest.TestCase):
    def test_net_rr_with_costs(self):
        from scanner.trade_planner import calculate_net_rr

        result = calculate_net_rr(
            entry=1.0850,
            stop=1.0800,
            target=1.0950,
            direction=1,
            asset_class='forex',
            entry_type='market'
        )

        self.assertGreater(result['gross_rr'], 1.9)
        self.assertLess(result['gross_rr'], 2.1)
        self.assertLess(result['net_rr'], result['gross_rr'])


if __name__ == '__main__':
    unittest.main()
