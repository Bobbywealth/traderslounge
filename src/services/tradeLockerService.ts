import axios, { AxiosInstance } from 'axios';

const DEMO_BASE_URL = 'https://demo.tradelocker.com/backend-api';
const LIVE_BASE_URL = 'https://live.tradelocker.com/backend-api';

export interface TradeLockerConfig {
  email: string;
  password: string;
  server: string;
  accountId?: string;
  isDemo: boolean;
}

export interface TradeLockerAuthResponse {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiration: number;
  refreshTokenExpiration: number;
}

export interface TradeLockerPosition {
  id: string;
  symbol: string;
  type: 'buy' | 'sell';
  volume: number;
  openPrice: number;
  currentPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  profit: number;
  openTime: string;
}

export interface TradeLockerOrder {
  id: string;
  symbol: string;
  type: 'buy' | 'sell' | 'buy_limit' | 'sell_limit' | 'buy_stop' | 'sell_stop';
  volume: number;
  price: number;
  status: 'pending' | 'filled' | 'cancelled';
  createdAt: string;
}

class TradeLockerService {
  private client: AxiosInstance | null = null;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private accountId: string | null = null;
  private isDemo: boolean = true;

  /**
   * Authenticate with TradeLocker and get JWT tokens
   */
  async authenticate(config: TradeLockerConfig): Promise<TradeLockerAuthResponse> {
    const baseUrl = config.isDemo ? DEMO_BASE_URL : LIVE_BASE_URL;
    this.isDemo = config.isDemo;
    this.accountId = config.accountId || '';

    try {
      const response = await axios.post<TradeLockerAuthResponse>(
        `${baseUrl}/auth/jwt/token`,
        {
          email: config.email,
          password: config.password,
          server: config.server,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      this.accessToken = response.data.accessToken;
      this.refreshToken = response.data.refreshToken;

      // Create axios client with auth header
      this.client = axios.create({
        baseURL: baseUrl,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      return response.data;
    } catch (error: any) {
      console.error('TradeLocker authentication failed:', error);
      // Surface TradeLocker's actual error payload (e.g. "Incorrect email or
      // password", "Server not found", CORS) instead of a generic message so
      // users can debug without opening devtools.
      const apiMessage =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        'Unknown TradeLocker authentication error';
      const status = error?.response?.status;
      const detail = status ? ` (HTTP ${status})` : '';
      throw new Error(`TradeLocker auth failed: ${apiMessage}${detail}`);
    }
  }

  /**
   * Refresh the access token
   */
  async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    const baseUrl = this.isDemo ? DEMO_BASE_URL : LIVE_BASE_URL;

    try {
      const response = await axios.post<TradeLockerAuthResponse>(
        `${baseUrl}/auth/jwt/refresh`,
        {
          refreshToken: this.refreshToken,
        }
      );

      this.accessToken = response.data.accessToken;
      this.refreshToken = response.data.refreshToken;

      // Update client headers
      if (this.client) {
        this.client.defaults.headers['Authorization'] = `Bearer ${this.accessToken}`;
      }
    } catch (error) {
      console.error('Token refresh failed:', error);
      throw new Error('Failed to refresh TradeLocker token');
    }
  }

  /**
   * Get all positions for the account
   */
  async getPositions(): Promise<TradeLockerPosition[]> {
    if (!this.client || !this.accountId) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    try {
      const response = await this.client.get<TradeLockerPosition[]>(
        `/trade/accounts/${this.accountId}/positions`
      );
      return response.data;
    } catch (error) {
      console.error('Failed to get positions:', error);
      throw new Error('Failed to fetch TradeLocker positions');
    }
  }

  /**
   * Get all orders for the account
   */
  async getOrders(): Promise<TradeLockerOrder[]> {
    if (!this.client || !this.accountId) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    try {
      const response = await this.client.get<TradeLockerOrder[]>(
        `/trade/accounts/${this.accountId}/orders`
      );
      return response.data;
    } catch (error) {
      console.error('Failed to get orders:', error);
      throw new Error('Failed to fetch TradeLocker orders');
    }
  }

  /**
   * Get available trading instruments
   */
  async getInstruments(): Promise<any[]> {
    if (!this.client || !this.accountId) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    try {
      const response = await this.client.get(
        `/trade/accounts/${this.accountId}/instruments`
      );
      return response.data;
    } catch (error) {
      console.error('Failed to get instruments:', error);
      throw new Error('Failed to fetch TradeLocker instruments');
    }
  }

  /**
   * Create a new order
   */
  async createOrder(order: {
    symbol: string;
    type: 'buy' | 'sell' | 'buy_limit' | 'sell_limit' | 'buy_stop' | 'sell_stop';
    volume: number;
    price?: number;
    stopLoss?: number;
    takeProfit?: number;
  }): Promise<TradeLockerOrder> {
    if (!this.client || !this.accountId) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    try {
      const response = await this.client.post<TradeLockerOrder>(
        `/trade/accounts/${this.accountId}/orders`,
        order
      );
      return response.data;
    } catch (error) {
      console.error('Failed to create order:', error);
      throw new Error('Failed to create TradeLocker order');
    }
  }

  /**
   * Close a position
   */
  async closePosition(positionId: string): Promise<void> {
    if (!this.client || !this.accountId) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    try {
      await this.client.delete(
        `/trade/accounts/${this.accountId}/positions/${positionId}`
      );
    } catch (error) {
      console.error('Failed to close position:', error);
      throw new Error('Failed to close TradeLocker position');
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string): Promise<void> {
    if (!this.client || !this.accountId) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    try {
      await this.client.delete(
        `/trade/accounts/${this.accountId}/orders/${orderId}`
      );
    } catch (error) {
      console.error('Failed to cancel order:', error);
      throw new Error('Failed to cancel TradeLocker order');
    }
  }

  /**
   * Get historical data for a symbol
   */
  async getHistory(symbol: string, timeframe: string = '1H', count: number = 100): Promise<any[]> {
    if (!this.client) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    try {
      const response = await this.client.get('/trade/history', {
        params: { symbol, timeframe, count },
      });
      return response.data;
    } catch (error) {
      console.error('Failed to get history:', error);
      throw new Error('Failed to fetch TradeLocker history');
    }
  }

  /**
   * Check connection status
   */
  isConnected(): boolean {
    return this.client !== null && this.accessToken !== null;
  }

  /**
   * Disconnect and clear tokens
   */
  disconnect(): void {
    this.client = null;
    this.accessToken = null;
    this.refreshToken = null;
    this.accountId = null;
  }

  /**
   * Get stored tokens for persistence
   */
  getTokens(): { accessToken: string | null; refreshToken: string | null } {
    return {
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
    };
  }
}

// Export singleton instance
export const tradeLockerService = new TradeLockerService();
export default tradeLockerService;
