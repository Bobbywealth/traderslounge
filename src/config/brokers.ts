import { BrokerConfig, BrokerType } from '../types/broker';

export const BROKER_CONFIGS: Record<BrokerType, BrokerConfig> = {
  metatrader4: {
    name: 'metatrader4',
    displayName: 'MetaTrader 4',
    type: 'metatrader4',
    apiEndpoint: 'https://api.mt4.com',
    documentation: 'https://docs.mql4.com/integration',
    supportedFeatures: ['real_time_data', 'historical_data', 'trade_execution', 'account_info'],
    fields: [
      {
        key: 'serverUrl',
        label: 'Server URL',
        type: 'url',
        required: true,
        placeholder: 'https://your-broker-server.com',
      },
      {
        key: 'accountId',
        label: 'Account Number',
        type: 'text',
        required: true,
        placeholder: '12345678',
        validation: { pattern: '^[0-9]+$', minLength: 6, maxLength: 12 }
      },
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true,
        placeholder: 'Your MT4 API Key',
      },
      {
        key: 'apiSecret',
        label: 'API Secret',
        type: 'password',
        required: true,
        placeholder: 'Your MT4 API Secret',
      }
    ]
  },
  metatrader5: {
    name: 'metatrader5',
    displayName: 'MetaTrader 5',
    type: 'metatrader5',
    apiEndpoint: 'https://api.mt5.com',
    documentation: 'https://docs.mql5.com/integration',
    supportedFeatures: ['real_time_data', 'historical_data', 'trade_execution', 'account_info', 'position_management'],
    fields: [
      {
        key: 'serverUrl',
        label: 'Server URL',
        type: 'url',
        required: true,
        placeholder: 'https://your-broker-server.com',
      },
      {
        key: 'accountId',
        label: 'Account Number',
        type: 'text',
        required: true,
        placeholder: '12345678',
        validation: { pattern: '^[0-9]+$', minLength: 6, maxLength: 12 }
      },
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true,
        placeholder: 'Your MT5 API Key',
      },
      {
        key: 'apiSecret',
        label: 'API Secret',
        type: 'password',
        required: true,
        placeholder: 'Your MT5 API Secret',
      }
    ]
  },
  oanda: {
    name: 'oanda',
    displayName: 'OANDA',
    type: 'oanda',
    apiEndpoint: 'https://api-fxtrade.oanda.com',
    documentation: 'https://developer.oanda.com/rest-live-v20/introduction/',
    supportedFeatures: ['real_time_data', 'historical_data', 'trade_execution', 'account_info', 'position_management'],
    fields: [
      {
        key: 'apiKey',
        label: 'API Token',
        type: 'password',
        required: true,
        placeholder: 'Your OANDA API Token',
      },
      {
        key: 'accountId',
        label: 'Account ID',
        type: 'text',
        required: true,
        placeholder: '101-001-12345678-001',
      },
      {
        key: 'serverUrl',
        label: 'Environment',
        type: 'select',
        required: true,
        options: [
          { value: 'https://api-fxtrade.oanda.com', label: 'Live Trading' },
          { value: 'https://api-fxpractice.oanda.com', label: 'Practice/Demo' }
        ]
      }
    ]
  },
  interactive_brokers: {
    name: 'interactive_brokers',
    displayName: 'Interactive Brokers',
    type: 'interactive_brokers',
    apiEndpoint: 'https://api.ibkr.com',
    documentation: 'https://interactivebrokers.github.io/tws-api/',
    supportedFeatures: ['real_time_data', 'historical_data', 'trade_execution', 'account_info'],
    fields: [
      {
        key: 'accountId',
        label: 'Account Number',
        type: 'text',
        required: true,
        placeholder: 'DU123456',
      },
      {
        key: 'apiKey',
        label: 'Consumer Key',
        type: 'password',
        required: true,
        placeholder: 'Your IB Consumer Key',
      },
      {
        key: 'apiSecret',
        label: 'Consumer Secret',
        type: 'password',
        required: true,
        placeholder: 'Your IB Consumer Secret',
      },
      {
        key: 'serverUrl',
        label: 'Gateway URL',
        type: 'url',
        required: true,
        placeholder: 'https://localhost:5000',
      }
    ]
  },
  alpaca: {
    name: 'alpaca',
    displayName: 'Alpaca Markets',
    type: 'alpaca',
    apiEndpoint: 'https://paper-api.alpaca.markets',
    documentation: 'https://alpaca.markets/docs/api-documentation/',
    supportedFeatures: ['real_time_data', 'historical_data', 'trade_execution', 'account_info'],
    fields: [
      {
        key: 'apiKey',
        label: 'API Key ID',
        type: 'text',
        required: true,
        placeholder: 'Your Alpaca API Key ID',
      },
      {
        key: 'apiSecret',
        label: 'Secret Key',
        type: 'password',
        required: true,
        placeholder: 'Your Alpaca Secret Key',
      },
      {
        key: 'serverUrl',
        label: 'Environment',
        type: 'select',
        required: true,
        options: [
          { value: 'https://api.alpaca.markets', label: 'Live Trading' },
          { value: 'https://paper-api.alpaca.markets', label: 'Paper Trading' }
        ]
      }
    ]
  },
  binance: {
    name: 'binance',
    displayName: 'Binance',
    type: 'binance',
    apiEndpoint: 'https://api.binance.com',
    documentation: 'https://binance-docs.github.io/apidocs/',
    supportedFeatures: ['real_time_data', 'historical_data', 'trade_execution', 'account_info'],
    fields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'text',
        required: true,
        placeholder: 'Your Binance API Key',
      },
      {
        key: 'apiSecret',
        label: 'Secret Key',
        type: 'password',
        required: true,
        placeholder: 'Your Binance Secret Key',
      },
      {
        key: 'serverUrl',
        label: 'Environment',
        type: 'select',
        required: true,
        options: [
          { value: 'https://api.binance.com', label: 'Binance Global' },
          { value: 'https://testnet.binance.vision', label: 'Testnet' }
        ]
      }
    ]
  },
  ctrader: {
    name: 'ctrader',
    displayName: 'cTrader',
    type: 'ctrader',
    apiEndpoint: 'https://api.ctrader.com',
    documentation: 'https://help.ctrader.com/open-api',
    supportedFeatures: ['real_time_data', 'historical_data', 'trade_execution', 'account_info'],
    fields: [
      {
        key: 'apiKey',
        label: 'Client ID',
        type: 'text',
        required: true,
        placeholder: 'Your cTrader Client ID',
      },
      {
        key: 'apiSecret',
        label: 'Client Secret',
        type: 'password',
        required: true,
        placeholder: 'Your cTrader Client Secret',
      },
      {
        key: 'accountId',
        label: 'Account ID',
        type: 'text',
        required: true,
        placeholder: '12345678',
      }
    ]
  },
  ninjatrader: {
    name: 'ninjatrader',
    displayName: 'NinjaTrader',
    type: 'ninjatrader',
    apiEndpoint: 'http://localhost:8080',
    documentation: 'https://ninjatrader.com/support/helpGuides/nt8/automated_trading_interface.htm',
    supportedFeatures: ['real_time_data', 'historical_data', 'trade_execution', 'account_info'],
    fields: [
      {
        key: 'serverUrl',
        label: 'NinjaTrader URL',
        type: 'url',
        required: true,
        placeholder: 'http://localhost:8080',
      },
      {
        key: 'accountId',
        label: 'Account Name',
        type: 'text',
        required: true,
        placeholder: 'Sim101',
      }
    ]
  },
  tradingview: {
    name: 'tradingview',
    displayName: 'TradingView',
    type: 'tradingview',
    apiEndpoint: 'https://api.tradingview.com',
    documentation: 'https://www.tradingview.com/brokerage-integration/',
    supportedFeatures: ['real_time_data', 'historical_data'],
    fields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true,
        placeholder: 'Your TradingView API Key',
      }
    ]
  },
  fxcm: {
    name: 'fxcm',
    displayName: 'FXCM',
    type: 'fxcm',
    apiEndpoint: 'https://api.fxcm.com',
    documentation: 'https://github.com/fxcm/RestAPI',
    supportedFeatures: ['real_time_data', 'historical_data', 'trade_execution', 'account_info'],
    fields: [
      {
        key: 'apiKey',
        label: 'Access Token',
        type: 'password',
        required: true,
        placeholder: 'Your FXCM Access Token',
      },
      {
        key: 'serverUrl',
        label: 'Environment',
        type: 'select',
        required: true,
        options: [
          { value: 'https://api.fxcm.com', label: 'Live Trading' },
          { value: 'https://api-demo.fxcm.com', label: 'Demo Trading' }
        ]
      }
    ]
  }
};