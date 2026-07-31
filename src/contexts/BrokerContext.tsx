import React, { createContext, useContext, useState, useEffect } from 'react';
import { BrokerCredentials, BrokerAccount, BrokerTrade, ConnectionStatus } from '../types/broker';
import { tradeLockerService } from '../services/tradeLockerService';

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
      // Handle Trade Locker specific authentication
      if (cred.brokerType === 'trade_locker') {
        const authResponse = await tradeLockerService.authenticate({
          email: cred.email || '',
          password: cred.password || '',
          server: cred.server || '',
          accountId: cred.accountId,
          isDemo: cred.isDemo,
        });

        // Store tokens for later use
        updateCredentials(id, {
          accessToken: authResponse.accessToken,
          refreshToken: authResponse.refreshToken,
        });

        setConnectionStatus(prev => ({
          ...prev,
          [id]: {
            isConnected: true,
            lastPing: new Date(),
            latency: 0,
            error: undefined
          }
        }));

        return true;
      }

      // Only TradeLocker is integrated end-to-end. Fail other broker types
      // honestly instead of simulating a connection.
      setConnectionStatus(prev => ({
        ...prev,
        [id]: {
          isConnected: false,
          error: `${cred.brokerType} is not supported yet — connect a TradeLocker account for live data`
        }
      }));

      return false;
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
      let account: BrokerAccount;
      let syncedTrades: BrokerTrade[];

      // Handle Trade Locker specific sync
      if (cred.brokerType === 'trade_locker' && tradeLockerService.isConnected()) {
        try {
          // Fetch real positions from Trade Locker
          const positions = await tradeLockerService.getPositions();

          account = {
            id: `account_${id}`,
            brokerName: cred.name,
            accountNumber: cred.accountId || 'TL-DEMO',
            accountType: cred.isDemo ? 'demo' : 'live',
            balance: 10000,
            equity: 10000,
            margin: 0,
            freeMargin: 10000,
            marginLevel: 0,
            currency: 'USD',
            leverage: 100,
            isConnected: true,
            lastUpdate: new Date(),
          };

          // Convert Trade Locker positions to our format
          syncedTrades = positions.map((pos) => ({
            id: `trade_${id}_${pos.id}`,
            brokerTradeId: pos.id,
            symbol: pos.symbol,
            type: pos.type,
            volume: pos.volume,
            openPrice: pos.openPrice,
            closePrice: undefined,
            stopLoss: pos.stopLoss,
            takeProfit: pos.takeProfit,
            openTime: new Date(pos.openTime),
            closeTime: undefined,
            profit: pos.profit,
            commission: 0,
            swap: 0,
            status: 'open',
            comment: 'Trade Locker',
          }));
        } catch (error) {
          console.error('Failed to fetch Trade Locker positions:', error);
          throw error;
        }
      } else {
        // Only TradeLocker sync is implemented; never fabricate account or
        // trade data for other brokers.
        throw new Error(`${cred.brokerType} sync is not supported yet`);
      }

      setAccounts(prev => {
        const filtered = prev.filter(acc => acc.id !== account.id);
        return [...filtered, account];
      });

      setTrades(prev => {
        const filtered = prev.filter(trade => !trade.id.startsWith(`trade_${id}_`));
        return [...filtered, ...syncedTrades];
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