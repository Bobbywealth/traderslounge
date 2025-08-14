export interface BrokerCredentials {
  id: string;
  name: string;
  brokerType: BrokerType;
  apiKey: string;
  apiSecret: string;
  accountId?: string;
  serverUrl?: string;
  isDemo: boolean;
  isActive: boolean;
  createdAt: Date;
  lastSync?: Date;
}

export interface BrokerAccount {
  id: string;
  brokerName: string;
  accountNumber: string;
  accountType: 'demo' | 'live';
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  currency: string;
  leverage: number;
  isConnected: boolean;
  lastUpdate: Date;
}

export interface BrokerTrade {
  id: string;
  brokerTradeId: string;
  symbol: string;
  type: 'buy' | 'sell';
  volume: number;
  openPrice: number;
  closePrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  openTime: Date;
  closeTime?: Date;
  profit: number;
  commission: number;
  swap: number;
  status: 'open' | 'closed' | 'pending';
  comment?: string;
}

export type BrokerType = 
  | 'metatrader4'
  | 'metatrader5' 
  | 'ctrader'
  | 'ninjatrader'
  | 'tradingview'
  | 'interactive_brokers'
  | 'oanda'
  | 'fxcm'
  | 'alpaca'
  | 'binance';

export interface BrokerConfig {
  name: string;
  displayName: string;
  type: BrokerType;
  fields: BrokerField[];
  apiEndpoint?: string;
  documentation?: string;
  supportedFeatures: BrokerFeature[];
}

export interface BrokerField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'select' | 'number' | 'url';
  required: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  validation?: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
  };
}

export type BrokerFeature = 
  | 'real_time_data'
  | 'historical_data'
  | 'trade_execution'
  | 'account_info'
  | 'position_management'
  | 'order_management';

export interface ConnectionStatus {
  isConnected: boolean;
  lastPing?: Date;
  latency?: number;
  error?: string;
}