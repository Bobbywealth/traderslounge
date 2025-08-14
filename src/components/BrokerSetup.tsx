import React, { useState } from 'react';
import { X, Plus, Settings, Wifi, WifiOff, RefreshCw, Eye, EyeOff, ExternalLink, Shield, AlertTriangle } from 'lucide-react';
import { BROKER_CONFIGS } from '../config/brokers';
import { BrokerType, BrokerCredentials } from '../types/broker';
import { useBroker } from '../contexts/BrokerContext';

interface BrokerSetupProps {
  isOpen: boolean;
  onClose: () => void;
}

const BrokerSetup: React.FC<BrokerSetupProps> = ({ isOpen, onClose }) => {
  const { credentials, connectionStatus, addCredentials, removeCredentials, testConnection, syncData, isLoading } = useBroker();
  const [selectedBroker, setSelectedBroker] = useState<BrokerType | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [isDemo, setIsDemo] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleInputChange = (key: string, value: string) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const togglePasswordVisibility = (key: string) => {
    setShowPasswords(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBroker) return;

    setIsSubmitting(true);
    try {
      const config = BROKER_CONFIGS[selectedBroker];
      const newCredentials: Omit<BrokerCredentials, 'id' | 'createdAt'> = {
        name: `${config.displayName} ${isDemo ? 'Demo' : 'Live'}`,
        brokerType: selectedBroker,
        apiKey: formData.apiKey || '',
        apiSecret: formData.apiSecret || '',
        accountId: formData.accountId,
        serverUrl: formData.serverUrl,
        isDemo,
        isActive: true,
      };

      addCredentials(newCredentials);
      setFormData({});
      setSelectedBroker(null);
      setShowPasswords({});
    } catch (error) {
      console.error('Failed to add broker credentials:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTestConnection = async (id: string) => {
    const success = await testConnection(id);
    if (success) {
      // Auto-sync data after successful connection
      await syncData(id);
    }
  };

  const renderBrokerForm = () => {
    if (!selectedBroker) return null;

    const config = BROKER_CONFIGS[selectedBroker];

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg flex items-center justify-center">
              <Settings className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {config.displayName} Setup
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Configure your {config.displayName} connection
              </p>
            </div>
          </div>
          <button
            onClick={() => setSelectedBroker(null)}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors duration-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5" />
            <div>
              <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-1">
                Security Notice
              </h4>
              <p className="text-sm text-blue-800 dark:text-blue-200">
                Your credentials are encrypted and stored locally. We never send your API keys to external servers.
              </p>
              {config.documentation && (
                <a
                  href={config.documentation}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center space-x-1 text-sm text-blue-600 dark:text-blue-400 hover:underline mt-2"
                >
                  <span>View API Documentation</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center space-x-4">
            <label className="flex items-center space-x-2">
              <input
                type="radio"
                name="accountType"
                checked={isDemo}
                onChange={() => setIsDemo(true)}
                className="w-4 h-4 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Demo Account</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="radio"
                name="accountType"
                checked={!isDemo}
                onChange={() => setIsDemo(false)}
                className="w-4 h-4 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Live Account</span>
            </label>
          </div>

          {config.fields.map((field) => (
            <div key={field.key}>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {field.label}
                {field.required && <span className="text-red-500 ml-1">*</span>}
              </label>
              
              {field.type === 'select' ? (
                <select
                  value={formData[field.key] || ''}
                  onChange={(e) => handleInputChange(field.key, e.target.value)}
                  required={field.required}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                >
                  <option value="">Select {field.label}</option>
                  {field.options?.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="relative">
                  <input
                    type={field.type === 'password' && !showPasswords[field.key] ? 'password' : 'text'}
                    value={formData[field.key] || ''}
                    onChange={(e) => handleInputChange(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    required={field.required}
                    pattern={field.validation?.pattern}
                    minLength={field.validation?.minLength}
                    maxLength={field.validation?.maxLength}
                    className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  />
                  {field.type === 'password' && (
                    <button
                      type="button"
                      onClick={() => togglePasswordVisibility(field.key)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      {showPasswords[field.key] ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}

          <div className="flex space-x-3 pt-4">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 bg-emerald-500 text-white py-2 px-4 rounded-lg font-medium hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
            >
              {isSubmitting ? 'Adding...' : 'Add Broker Account'}
            </button>
            <button
              type="button"
              onClick={() => setSelectedBroker(null)}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-200"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    );
  };

  const renderBrokerList = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Broker Connections
        </h3>
        <button
          onClick={onClose}
          className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors duration-200"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {credentials.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-medium text-gray-900 dark:text-white">Connected Accounts</h4>
          {credentials.map((cred) => {
            const status = connectionStatus[cred.id];
            const config = BROKER_CONFIGS[cred.brokerType];
            
            return (
              <div key={cred.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-3">
                    <div className={`w-3 h-3 rounded-full ${
                      status?.isConnected ? 'bg-emerald-500' : 'bg-red-500'
                    }`} />
                    <div>
                      <h5 className="font-medium text-gray-900 dark:text-white">
                        {cred.name}
                      </h5>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {config.displayName} • {cred.isDemo ? 'Demo' : 'Live'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleTestConnection(cred.id)}
                      disabled={isLoading}
                      className="p-2 text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors duration-200"
                      title="Test Connection"
                    >
                      {status?.isConnected ? (
                        <Wifi className="w-4 h-4" />
                      ) : (
                        <WifiOff className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      onClick={() => syncData(cred.id)}
                      disabled={isLoading}
                      className="p-2 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200"
                      title="Sync Data"
                    >
                      <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                      onClick={() => removeCredentials(cred.id)}
                      className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors duration-200"
                      title="Remove"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                
                {status?.error && (
                  <div className="flex items-center space-x-2 text-sm text-red-600 dark:text-red-400">
                    <AlertTriangle className="w-4 h-4" />
                    <span>{status.error}</span>
                  </div>
                )}
                
                {status?.isConnected && status.latency && (
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    Latency: {status.latency}ms • Last sync: {cred.lastSync?.toLocaleString() || 'Never'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-3">
        <h4 className="font-medium text-gray-900 dark:text-white">Add New Broker</h4>
        <div className="grid grid-cols-2 gap-3">
          {Object.values(BROKER_CONFIGS).map((config) => (
            <button
              key={config.type}
              onClick={() => setSelectedBroker(config.type)}
              className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-200 text-left"
            >
              <div className="flex items-center space-x-3">
                <Plus className="w-5 h-5 text-emerald-500" />
                <div>
                  <h5 className="font-medium text-gray-900 dark:text-white">
                    {config.displayName}
                  </h5>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    {config.supportedFeatures.length} features
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {selectedBroker ? renderBrokerForm() : renderBrokerList()}
        </div>
      </div>
    </div>
  );
};

export default BrokerSetup;