import React, { createContext, useContext, useState, useEffect } from 'react';
import { BrokerCredentials, BrokerAccount, BrokerTrade, ConnectionStatus } from '../types/broker';

interface BrokerContextType {
  credentials: BrokerCredentials[];
  accounts: BrokerAccount[];
  trades: BrokerTrade[];
  connectionStatus: Record<string, ConnectionStatus>;
  addCredentials: (credentials: Omit<BrokerCredentials, 'id' | 'createdAt'>) => void;
  updateCredentials: (id: string, credentials: Partial<BrokerCredentials>) => void;
  removeCredentials: (id: string) => void;
  testConnection: (id: string) => Promise<boolean>;
  syncData: (id: string) => Promise<void>;
  isLoading: boolean;
}

const BrokerContext = createContext<BrokerContextType | undefined>(undefined);

export const BrokerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [credentials, setCredentials] = useState<BrokerCredentials[]>([]);
  const [accounts, setAccounts] = useState<BrokerAccount[]>([]);
  const [trades, setTrades] = useState<BrokerTrade[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<Record<string, ConnectionStatus>>({});
  const [isLoading, setIsLoading] = useState(false);

  // Load saved credentials from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('broker_credentials');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setCredentials(parsed.map((cred: any) => ({
          ...cred,
          createdAt: new Date(cred.createdAt),
          lastSync: cred.lastSync ? new Date(cred.lastSync) : undefined,
        })));
      } catch (error) {
        console.error('Failed to load broker credentials:', error);
      }
    }
  }, []);

  // Save credentials to localStorage
  useEffect(() => {
    localStorage.setItem('broker_credentials', JSON.stringify(credentials));
  }, [credentials]);

  const addCredentials = (newCredentials: Omit<BrokerCredentials, 'id' | 'createdAt'>) => {
    const credentials_with_id: BrokerCredentials = {
      ...newCredentials,
      id: Date.now().toString(),
      createdAt: new Date(),
    };
    setCredentials(prev => [...prev, credentials_with_id]);
  };

  const updateCredentials = (id: string, updates: Partial<BrokerCredentials>) => {
    setCredentials(prev => prev.map(cred => 
      cred.id === id ? { ...cred, ...updates } : cred
    ));
  };

  const removeCredentials = (id: string) => {
    setCredentials(prev => prev.filter(cred => cred.id !== id));
    setConnectionStatus(prev => {
      const { [id]: removed, ...rest } = prev;
      return rest;
    });
  };

  const testConnection = async (id: string): Promise<boolean> => {
    const cred = credentials.find(c => c.id === id);
    if (!cred) return false;

    setConnectionStatus(prev => ({
      ...prev,
      [id]: { isConnected: false, error: 'Testing connection...' }
    }));

    try {
      // Simulate API call to test connection
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Mock successful connection
      const isConnected = Math.random() > 0.3; // 70% success rate for demo
      
      setConnectionStatus(prev => ({
        ...prev,
        [id]: {
          isConnected,
          lastPing: new Date(),
          latency: Math.floor(Math.random() * 100) + 50,
          error: isConnected ? undefined : 'Invalid credentials or server unreachable'
        }
      }));

      return isConnected;
    } catch (error) {
      setConnectionStatus(prev => ({
        ...prev,
        [id]: {
          isConnected: false,
          error: error instanceof Error ? error.message : 'Connection failed'
        }
      }));
      return false;
    }
  };

  const syncData = async (id: string) => {
    const cred = credentials.find(c => c.id === id);
    if (!cred) return;

    setIsLoading(true);
    try {
      // Simulate API calls to fetch account data and trades
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Mock account data
      const mockAccount: BrokerAccount = {
        id: `account_${id}`,
        brokerName: cred.name,
        accountNumber: cred.accountId || 'DEMO123456',
        accountType: cred.isDemo ? 'demo' : 'live',
        balance: 10000 + Math.random() * 50000,
        equity: 10000 + Math.random() * 50000,
        margin: Math.random() * 5000,
        freeMargin: 8000 + Math.random() * 40000,
        marginLevel: 100 + Math.random() * 200,
        currency: 'USD',
        leverage: 100,
        isConnected: true,
        lastUpdate: new Date(),
      };

      // Mock trades data
      const mockTrades: BrokerTrade[] = Array.from({ length: 10 }, (_, i) => ({
        id: `trade_${id}_${i}`,
        brokerTradeId: `${Math.floor(Math.random() * 1000000)}`,
        symbol: ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'][Math.floor(Math.random() * 4)],
        type: Math.random() > 0.5 ? 'buy' : 'sell',
        volume: parseFloat((Math.random() * 2).toFixed(2)),
        openPrice: 1.0800 + Math.random() * 0.1,
        closePrice: Math.random() > 0.3 ? 1.0800 + Math.random() * 0.1 : undefined,
        stopLoss: 1.0700 + Math.random() * 0.05,
        takeProfit: 1.0900 + Math.random() * 0.05,
        openTime: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
        closeTime: Math.random() > 0.3 ? new Date() : undefined,
        profit: (Math.random() - 0.5) * 1000,
        commission: -Math.random() * 10,
        swap: (Math.random() - 0.5) * 5,
        status: Math.random() > 0.3 ? 'closed' : 'open',
        comment: 'Imported from broker',
      }));

      setAccounts(prev => {
        const filtered = prev.filter(acc => acc.id !== mockAccount.id);
        return [...filtered, mockAccount];
      });

      setTrades(prev => {
        const filtered = prev.filter(trade => !trade.id.startsWith(`trade_${id}_`));
        return [...filtered, ...mockTrades];
      });

      updateCredentials(id, { lastSync: new Date() });
    } catch (error) {
      console.error('Failed to sync data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <BrokerContext.Provider value={{
      credentials,
      accounts,
      trades,
      connectionStatus,
      addCredentials,
      updateCredentials,
      removeCredentials,
      testConnection,
      syncData,
      isLoading,
    }}>
      {children}
    </BrokerContext.Provider>
  );
};

export const useBroker = () => {
  const context = useContext(BrokerContext);
  if (context === undefined) {
    throw new Error('useBroker must be used within a BrokerProvider');
  }
  return context;
};