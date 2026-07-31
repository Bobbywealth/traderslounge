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

      // Trade Locker is the only broker with a real integration. Every other
      // type used to resolve via `Math.random() > 0.3`, reporting "connected"
      // with an invented latency for credentials that were never checked.
      // Report the truth instead: not implemented.
      setConnectionStatus(prev => ({
        ...prev,
        [id]: {
          isConnected: false,
          error: `${cred.brokerType} is not supported yet — only Trade Locker has a live integration.`,
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
      let mockAccount: BrokerAccount;
      let mockTrades: BrokerTrade[];

      // Handle Trade Locker specific sync
      if (cred.brokerType === 'trade_locker' && tradeLockerService.isConnected()) {
        try {
          // Fetch real positions from Trade Locker
          const positions = await tradeLockerService.getPositions();
          
          // NOTE: positions below are real, but these balance figures are NOT.
          // tradeLockerService has no account-state endpoint, so balance/equity/
          // margin are placeholders. Do not present them as the user's actual
          // account until getAccountState() exists and populates them.
          mockAccount = {
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
          mockTrades = positions.map((pos) => ({
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
        // Every non-Trade-Locker broker used to land here and fabricate an
        // account (random balance/equity/margin) plus ten random trades
        // labelled "Imported from broker" — indistinguishable from real fills.
        // Never invent account or trade data; surface the gap instead.
        throw new Error(
          `${cred.brokerType} is not supported yet — only Trade Locker has a live integration.`
        );
      }

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
      // Surface the failure — a silent catch left the UI looking synced.
      setConnectionStatus(prev => ({
        ...prev,
        [id]: {
          ...(prev[id] || {}),
          isConnected: false,
          error: error instanceof Error ? error.message : 'Sync failed',
        }
      }));
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