import { describe, it, expect } from 'vitest';
import { BROKER_CONFIGS } from './brokers';

describe('brokers configuration', () => {
  it('should have broker configs defined', () => {
    expect(BROKER_CONFIGS).toBeDefined();
    expect(Object.keys(BROKER_CONFIGS).length).toBeGreaterThan(0);
  });

  it('should have required broker properties', () => {
    Object.values(BROKER_CONFIGS).forEach((broker) => {
      expect(broker).toHaveProperty('name');
      expect(broker).toHaveProperty('displayName');
      expect(broker).toHaveProperty('type');
      expect(broker).toHaveProperty('apiEndpoint');
      expect(broker).toHaveProperty('documentation');
      expect(broker).toHaveProperty('supportedFeatures');
      expect(broker).toHaveProperty('fields');
    });
  });

  it('should have valid broker types', () => {
    Object.values(BROKER_CONFIGS).forEach((broker) => {
      expect(typeof broker.type).toBe('string');
    });
  });

  it('should have supported features as array', () => {
    Object.values(BROKER_CONFIGS).forEach((broker) => {
      expect(Array.isArray(broker.supportedFeatures)).toBe(true);
    });
  });

  it('should have fields as array with required properties', () => {
    Object.values(BROKER_CONFIGS).forEach((broker) => {
      expect(Array.isArray(broker.fields)).toBe(true);
      broker.fields.forEach((field: any) => {
        expect(field).toHaveProperty('key');
        expect(field).toHaveProperty('label');
        expect(field).toHaveProperty('type');
        expect(field).toHaveProperty('required');
      });
    });
  });

  it('should have valid field types', () => {
    const validFieldTypes = ['text', 'password', 'email', 'url', 'number', 'select'];
    Object.values(BROKER_CONFIGS).forEach((broker) => {
      broker.fields.forEach((field: any) => {
        expect(validFieldTypes).toContain(field.type);
      });
    });
  });

  it('should have MetaTrader configurations', () => {
    expect(BROKER_CONFIGS.metatrader4).toBeDefined();
    expect(BROKER_CONFIGS.metatrader5).toBeDefined();
  });

  it('should have TradeLocker configuration', () => {
    expect(BROKER_CONFIGS.trade_locker).toBeDefined();
  });
});
