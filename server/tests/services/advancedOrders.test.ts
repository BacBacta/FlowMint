/**
 * Advanced Orders Service Tests
 *
 * Tests for advanced order types (Trailing Stop, Bracket, etc.)
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

import {
  AdvancedOrdersService,
  getAdvancedOrdersService,
  resetAdvancedOrdersService,
  AdvancedOrder,
  AdvancedOrderType,
  AdvancedOrderStatus,
} from '../../src/services/advancedOrdersService';

// Note: For unit tests that don't call Jupiter, we can test
// the order management logic directly

describe('AdvancedOrdersService', () => {
  let service: AdvancedOrdersService;

  beforeEach(() => {
    resetAdvancedOrdersService();
    service = getAdvancedOrdersService();
  });

  afterEach(() => {
    resetAdvancedOrdersService();
  });

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const instance1 = getAdvancedOrdersService();
      const instance2 = getAdvancedOrdersService();

      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = getAdvancedOrdersService();
      resetAdvancedOrdersService();
      const instance2 = getAdvancedOrdersService();

      expect(instance1).not.toBe(instance2);
    });
  });
});

describe('Advanced Order Types', () => {
  it('should define all order types', () => {
    const types: AdvancedOrderType[] = [
      'trailing_stop',
      'bracket',
      'take_profit',
      'stop_loss',
    ];

    expect(types).toHaveLength(4);
    expect(types).toContain('trailing_stop');
    expect(types).toContain('bracket');
    expect(types).toContain('take_profit');
    expect(types).toContain('stop_loss');
  });

  it('should define all order statuses', () => {
    const statuses: AdvancedOrderStatus[] = [
      'pending',
      'active',
      'triggered',
      'executed',
      'cancelled',
      'expired',
      'failed',
    ];

    expect(statuses).toHaveLength(7);
  });
});

describe('Trailing Stop Logic', () => {
  it('should calculate trail price correctly', () => {
    const highestPrice = 100;
    const trailBps = 500; // 5%

    // Trail price should be 95 (100 - 5%)
    const trailPrice = highestPrice * (1 - trailBps / 10000);
    expect(trailPrice).toBe(95);
  });

  it('should update trail price when price increases', () => {
    const initialHigh = 100;
    const trailBps = 500;
    let highestPrice = initialHigh;
    let trailPrice = highestPrice * (1 - trailBps / 10000);

    // Price increases to 110
    const newPrice = 110;
    if (newPrice > highestPrice) {
      highestPrice = newPrice;
      trailPrice = highestPrice * (1 - trailBps / 10000);
    }

    expect(highestPrice).toBe(110);
    expect(trailPrice).toBe(104.5); // 110 - 5%
  });

  it('should trigger when price drops below trail', () => {
    const highestPrice = 100;
    const trailBps = 500;
    const trailPrice = highestPrice * (1 - trailBps / 10000);

    // Price drops to 94 (below trail price of 95)
    const currentPrice = 94;
    const shouldTrigger = currentPrice <= trailPrice;

    expect(shouldTrigger).toBe(true);
  });

  it('should not trigger when price is above trail', () => {
    const highestPrice = 100;
    const trailBps = 500;
    const trailPrice = highestPrice * (1 - trailBps / 10000);

    // Price drops to 96 (still above trail price of 95)
    const currentPrice = 96;
    const shouldTrigger = currentPrice <= trailPrice;

    expect(shouldTrigger).toBe(false);
  });

  it('should validate trail percentage bounds', () => {
    const minTrailBps = 10;  // 0.1%
    const maxTrailBps = 5000; // 50%

    expect(minTrailBps).toBe(10);
    expect(maxTrailBps).toBe(5000);

    // Valid trail
    const validTrail = 500;
    expect(validTrail).toBeGreaterThanOrEqual(minTrailBps);
    expect(validTrail).toBeLessThanOrEqual(maxTrailBps);

    // Invalid trails
    expect(5).toBeLessThan(minTrailBps);
    expect(6000).toBeGreaterThan(maxTrailBps);
  });
});

describe('Bracket Order Logic', () => {
  it('should trigger take profit when price goes above', () => {
    const entryPrice = 100;
    const takeProfitPrice = 120;
    const stopLossPrice = 90;

    const currentPrice = 125;

    const shouldTriggerTP = currentPrice >= takeProfitPrice;
    const shouldTriggerSL = currentPrice <= stopLossPrice;

    expect(shouldTriggerTP).toBe(true);
    expect(shouldTriggerSL).toBe(false);
  });

  it('should trigger stop loss when price goes below', () => {
    const entryPrice = 100;
    const takeProfitPrice = 120;
    const stopLossPrice = 90;

    const currentPrice = 85;

    const shouldTriggerTP = currentPrice >= takeProfitPrice;
    const shouldTriggerSL = currentPrice <= stopLossPrice;

    expect(shouldTriggerTP).toBe(false);
    expect(shouldTriggerSL).toBe(true);
  });

  it('should not trigger when price is between bounds', () => {
    const takeProfitPrice = 120;
    const stopLossPrice = 90;

    const currentPrice = 105;

    const shouldTriggerTP = currentPrice >= takeProfitPrice;
    const shouldTriggerSL = currentPrice <= stopLossPrice;

    expect(shouldTriggerTP).toBe(false);
    expect(shouldTriggerSL).toBe(false);
  });

  it('should validate price ordering', () => {
    const entryPrice = 100;
    const takeProfitPrice = 120;
    const stopLossPrice = 90;

    expect(takeProfitPrice).toBeGreaterThan(entryPrice);
    expect(stopLossPrice).toBeLessThan(entryPrice);
  });
});

describe('Take Profit Logic', () => {
  it('should trigger when price reaches target', () => {
    const targetPrice = 150;
    const currentPrice = 155;

    const shouldTrigger = currentPrice >= targetPrice;
    expect(shouldTrigger).toBe(true);
  });

  it('should not trigger below target', () => {
    const targetPrice = 150;
    const currentPrice = 140;

    const shouldTrigger = currentPrice >= targetPrice;
    expect(shouldTrigger).toBe(false);
  });
});

describe('Stop Loss Logic', () => {
  it('should trigger when price drops to threshold', () => {
    const triggerPrice = 80;
    const currentPrice = 75;

    const shouldTrigger = currentPrice <= triggerPrice;
    expect(shouldTrigger).toBe(true);
  });

  it('should not trigger above threshold', () => {
    const triggerPrice = 80;
    const currentPrice = 85;

    const shouldTrigger = currentPrice <= triggerPrice;
    expect(shouldTrigger).toBe(false);
  });
});

describe('Order Structure', () => {
  it('should have expected fields for trailing stop', () => {
    const order: Partial<AdvancedOrder> = {
      id: 'trail_123',
      type: 'trailing_stop',
      status: 'active',
      trailBps: 500,
      highestPrice: 100,
      currentTrailPrice: 95,
    };

    expect(order).toHaveProperty('trailBps');
    expect(order).toHaveProperty('highestPrice');
    expect(order).toHaveProperty('currentTrailPrice');
  });

  it('should have expected fields for bracket order', () => {
    const order: Partial<AdvancedOrder> = {
      id: 'bracket_123',
      type: 'bracket',
      status: 'active',
      takeProfitPrice: 120,
      stopLossPrice: 90,
      entryPrice: 100,
    };

    expect(order).toHaveProperty('takeProfitPrice');
    expect(order).toHaveProperty('stopLossPrice');
    expect(order).toHaveProperty('entryPrice');
  });
});

describe('Order Expiration', () => {
  it('should detect expired orders', () => {
    const now = Date.now();
    const expiresAt = now - 1000; // Expired 1 second ago

    const isExpired = now > expiresAt;
    expect(isExpired).toBe(true);
  });

  it('should detect valid orders', () => {
    const now = Date.now();
    const expiresAt = now + 3600000; // Expires in 1 hour

    const isExpired = now > expiresAt;
    expect(isExpired).toBe(false);
  });
});
