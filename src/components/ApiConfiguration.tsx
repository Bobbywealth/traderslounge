import React, { useState } from 'react';
import { X, Key, ExternalLink, CheckCircle, AlertCircle, Info } from 'lucide-react';
import { getApiInstructions } from '../services/newsApi';

interface ApiConfigurationProps {
  isOpen: boolean;
  onClose: () => void;
}

const ApiConfiguration: React.FC<ApiConfigurationProps> = ({ isOpen, onClose }) => {
  const [apiKeys, setApiKeys] = useState({
    alphaVantage: localStorage.getItem('api_alphaVantage') || 'N35281CO4LORS4CU',
    finnhub: localStorage.getItem('api_finnhub') || '',
    newsApi: localStorage.getItem('api_newsApi') || 'c57dc72d29424da3a896faf4e7fd380b',
    tradingEconomics: localStorage.getItem('api_trading_economics') || '',
    polygon: localStorage.getItem('api_polygon') || '31WWhm2uoSkHLi9EMiyLnL5lavXRkA1h',
    fcsapi: localStorage.getItem('api_fcsapi') || 'oBvRl6ovyvldsUPhXdoC8ug7',
  });

  const [showKeys, setShowKeys] = useState({
    alphaVantage: false,
    finnhub: false,
    newsApi: false,
    tradingEconomics: false,
    polygon: false,
  });

  const { providers } = getApiInstructions();

  if (!isOpen) return null;

  const handleSaveKey = (provider: string, key: string) => {
    const storageKey = provider === 'alphaVantage' ? 'api_alphaVantage' : `api_${provider}`;
    localStorage.setItem(storageKey, key);
    setApiKeys(prev => ({ ...prev, [provider]: key }));
  };

  const handleTestConnection = async (provider: string) => {
    // This would test the actual API connection
    console.log(`Testing ${provider} connection...`);
  };

  const isConfigured = (key: string) => key && key !== 'demo' && key.length > 10;

  const apiProviders = [
    {
      id: 'alphaVantage',
      name: 'Alpha Vantage',
      description: 'Financial market data and news',
      url: 'https://www.alphavantage.co/support/#api-key',
      features: ['Real-time quotes', 'Financial news', 'Technical indicators'],
      limits: 'Free: 5 calls/min, 500/day',
      keyFormat: 'Example: ABCD1234EFGH5678',
    },
    {
      id: 'finnhub',
      name: 'Finnhub',
      description: 'Real-time financial data',
      url: 'https://finnhub.io/register',
      features: ['Stock prices', 'Forex data', 'Market news'],
      limits: 'Free: 60 calls/min',
      keyFormat: 'Example: c123456789abcdef',
    },
    {
      id: 'newsApi',
      name: 'NewsAPI',
      description: 'Financial news from major sources',
      url: 'https://newsapi.org/register',
      features: ['Breaking news', 'Market analysis', 'Economic reports'],
      limits: 'Free: 1000 requests/month',
      keyFormat: 'Example: 1234567890abcdef1234567890abcdef',
    },
    {
      id: 'tradingEconomics',
      name: 'Trading Economics',
      description: 'Economic calendar and indicators',
      url: 'https://tradingeconomics.com/api',
      features: ['Economic calendar', 'GDP data', 'Inflation rates'],
      limits: 'Free tier available',
      keyFormat: 'Example: guest:guest',
    },
    {
      id: 'polygon',
      name: 'Polygon.io',
      description: 'Market data and forex rates',
      url: 'https://polygon.io/',
      features: ['Forex rates', 'Stock data', 'Crypto prices'],
      limits: 'Free: 5 calls/min',
      keyFormat: 'Example: abcdef123456789',
    },
    {
      id: 'fcsapi',
      name: 'FCS API',
      description: 'Economic calendar and forex news',
      url: 'https://fcsapi.com/register',
      features: ['Economic calendar', 'Forex news', 'Market events'],
      limits: 'Free: 500 calls/month',
      keyFormat: 'Example: oBvRl6ovyvldsUPhXdoC8ug7',
    },
    {
      id: 'fcsapi',
      name: 'FCS API',
      description: 'FREE Economic Calendar (500 calls/month)',
      url: 'https://fcsapi.com/register',
      features: ['Economic calendar', 'Forex news', 'Market events'],
      limits: 'Free: 500 calls/month',
      keyFormat: 'Example: abc123def456ghi789',
    },
    {
      id: 'marketstack',
      name: 'Marketstack',
      description: 'FREE Market data (1000 calls/month)',
      url: 'https://marketstack.com/signup/free',
      features: ['Stock prices', 'Market data', 'Historical data'],
      limits: 'Free: 1000 calls/month',
      keyFormat: 'Example: 1234567890abcdef1234567890abcdef',
    },
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                <Key className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  API Configuration
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Configure real financial data providers
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors duration-200"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
            <div className="flex items-start space-x-3">
              <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5" />
              <div>
                <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-1">
                  Real Financial Data
                </h4>
                <p className="text-sm text-blue-800 dark:text-blue-200 mb-2">
                  Configure API keys to get real-time financial news, economic calendar events, and market data. 
                  Without API keys, the system uses realistic mock data for demonstration.
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  All API keys are stored locally in your browser and never sent to external servers.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {apiProviders.map((provider) => (
              <div key={provider.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <h4 className="font-semibold text-gray-900 dark:text-white">
                        {provider.name}
                      </h4>
                      {isConfigured(apiKeys[provider.id as keyof typeof apiKeys]) ? (
                        <CheckCircle className="w-5 h-5 text-emerald-500" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-orange-500" />
                      )}
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                      {provider.description}
                    </p>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {provider.features.map((feature) => (
                        <span
                          key={feature}
                          className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-xs rounded-full text-gray-700 dark:text-gray-300"
                        >
                          {feature}
                        </span>
                      ))}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {provider.limits}
                    </div>
                  </div>
                  <a
                    href={provider.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center space-x-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    <span>Get API Key</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      API Key
                    </label>
                    <div className="relative">
                      <input
                        type={showKeys[provider.id as keyof typeof showKeys] ? 'text' : 'password'}
                        value={apiKeys[provider.id as keyof typeof apiKeys]}
                        onChange={(e) => setApiKeys(prev => ({ ...prev, [provider.id]: e.target.value }))}
                        placeholder={provider.keyFormat}
                        className="w-full px-3 py-2 pr-20 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex space-x-1">
                        <button
                          type="button"
                          onClick={() => setShowKeys(prev => ({ ...prev, [provider.id]: !prev[provider.id as keyof typeof prev] }))}
                          className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                          {showKeys[provider.id as keyof typeof showKeys] ? '👁️' : '👁️‍🗨️'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleSaveKey(provider.id, apiKeys[provider.id as keyof typeof apiKeys])}
                      className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors duration-200 text-sm"
                    >
                      Save Key
                    </button>
                    <button
                      onClick={() => handleTestConnection(provider.id)}
                      disabled={!isConfigured(apiKeys[provider.id as keyof typeof apiKeys])}
                      className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 text-sm"
                    >
                      Test Connection
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
            <div className="flex justify-between items-center">
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {Object.values(apiKeys).filter(key => isConfigured(key)).length} of {apiProviders.length} APIs configured
              </div>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApiConfiguration;