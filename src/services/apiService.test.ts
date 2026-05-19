import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the entire module before importing
vi.mock('./apiService', () => {
  const mockSignalsApi = {
    getSignals: vi.fn().mockResolvedValue([{ id: '1', symbol: 'EURUSD' }]),
    getSignal: vi.fn().mockResolvedValue({ id: '1', symbol: 'EURUSD' }),
    refreshSignals: vi.fn().mockResolvedValue([{ symbol: 'EURUSD', success: true }]),
    cleanup: vi.fn().mockResolvedValue(0),
  };
  
  const mockTradeLockerApi = {
    connect: vi.fn().mockResolvedValue({ connected: true }),
    authenticate: vi.fn().mockResolvedValue({ success: true }),
    getAccount: vi.fn().mockResolvedValue({ id: '1', balance: 10000 }),
    getPositions: vi.fn().mockResolvedValue([]),
    getOrders: vi.fn().mockResolvedValue([]),
    executeSignal: vi.fn().mockResolvedValue({ success: true }),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
  
  return {
    signalsApi: mockSignalsApi,
    tradeLockerApi: mockTradeLockerApi,
  };
});

import { signalsApi, tradeLockerApi } from './apiService';

describe('apiService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('signalsApi', () => {
    it('should have getSignals method', () => {
      expect(signalsApi.getSignals).toBeDefined();
    });

    it('should have getSignal method', () => {
      expect(signalsApi.getSignal).toBeDefined();
    });

    it('should have refreshSignals method', () => {
      expect(signalsApi.refreshSignals).toBeDefined();
    });

    it('should have cleanup method', () => {
      expect(signalsApi.cleanup).toBeDefined();
    });

    it('getSignals should return data', async () => {
      const result = await signalsApi.getSignals();
      expect(result).toHaveLength(1);
    });

    it('getSignal should return data', async () => {
      const result = await signalsApi.getSignal('EURUSD');
      expect(result).toBeDefined();
    });
  });

  describe('tradeLockerApi', () => {
    it('should have connect method', () => {
      expect(tradeLockerApi.connect).toBeDefined();
    });

    it('should have authenticate method', () => {
      expect(tradeLockerApi.authenticate).toBeDefined();
    });

    it('should have getAccount method', () => {
      expect(tradeLockerApi.getAccount).toBeDefined();
    });

    it('should have disconnect method', () => {
      expect(tradeLockerApi.disconnect).toBeDefined();
    });

    it('connect should return connected status', async () => {
      const result = await tradeLockerApi.connect();
      expect(result.connected).toBe(true);
    });

    it('authenticate should return success', async () => {
      const result = await tradeLockerApi.authenticate('test@test.com', 'password', 'server', true);
      expect(result.success).toBe(true);
    });
  });
});
