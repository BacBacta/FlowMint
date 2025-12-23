import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { database } from '../../src/db/database';
import { randomUUID } from 'crypto';

describe('Database', () => {
  describe('Receipts', () => {
    it('should insert and retrieve a receipt', () => {
      const receipt = {
        id: randomUUID(),
        userPublicKey: 'test-pubkey',
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inputAmount: 1000000000,
        outputAmount: 150000000,
        slippageBps: 50,
        priceImpact: 0.001,
        signature: 'test-signature',
        status: 'confirmed' as const,
        timestamp: new Date().toISOString(),
      };

      database.insertReceipt(receipt);
      const retrieved = database.getReceiptById(receipt.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.userPublicKey).toBe('test-pubkey');
      expect(retrieved?.status).toBe('confirmed');
    });

    it('should get receipts by user', () => {
      const userPubkey = 'test-user-' + randomUUID();
      
      // Insert multiple receipts
      for (let i = 0; i < 3; i++) {
        database.insertReceipt({
          id: randomUUID(),
          userPublicKey: userPubkey,
          inputMint: 'mint1',
          outputMint: 'mint2',
          inputAmount: 1000,
          outputAmount: 100,
          slippageBps: 50,
          priceImpact: 0.001,
          signature: `sig-${i}`,
          status: 'confirmed',
          timestamp: new Date().toISOString(),
        });
      }

      const receipts = database.getReceiptsByUser(userPubkey);
      expect(receipts.length).toBe(3);
    });

    it('should update receipt status', () => {
      const receipt = {
        id: randomUUID(),
        userPublicKey: 'test-pubkey',
        inputMint: 'mint1',
        outputMint: 'mint2',
        inputAmount: 1000,
        outputAmount: 100,
        slippageBps: 50,
        priceImpact: 0.001,
        signature: null,
        status: 'pending' as const,
        timestamp: new Date().toISOString(),
      };

      database.insertReceipt(receipt);
      database.updateReceiptStatus(receipt.id, 'confirmed', 'new-signature');

      const updated = database.getReceiptById(receipt.id);
      expect(updated?.status).toBe('confirmed');
      expect(updated?.signature).toBe('new-signature');
    });
  });

  describe('Intents', () => {
    it('should insert and retrieve a DCA intent', () => {
      const intent = {
        id: randomUUID(),
        userPublicKey: 'test-pubkey',
        type: 'dca' as const,
        status: 'active' as const,
        inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        outputMint: 'So11111111111111111111111111111111111111112',
        totalAmount: 100000000,
        executedAmount: 0,
        intervalMs: 86400000,
        numberOfOrders: 10,
        ordersExecuted: 0,
        nextExecutionTime: new Date(Date.now() + 86400000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      database.insertIntent(intent);
      const retrieved = database.getIntentById(intent.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.type).toBe('dca');
      expect(retrieved?.numberOfOrders).toBe(10);
    });

    it('should insert and retrieve a stop-loss intent', () => {
      const intent = {
        id: randomUUID(),
        userPublicKey: 'test-pubkey',
        type: 'stop-loss' as const,
        status: 'active' as const,
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        totalAmount: 10000000000,
        executedAmount: 0,
        triggerPrice: 80.0,
        pythFeedId: 'test-feed-id',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      database.insertIntent(intent);
      const retrieved = database.getIntentById(intent.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.type).toBe('stop-loss');
      expect(retrieved?.triggerPrice).toBe(80.0);
    });

    it('should get active intents by type', () => {
      const userPubkey = 'test-user-' + randomUUID();

      // Insert DCA intent
      database.insertIntent({
        id: randomUUID(),
        userPublicKey: userPubkey,
        type: 'dca',
        status: 'active',
        inputMint: 'mint1',
        outputMint: 'mint2',
        totalAmount: 1000,
        executedAmount: 0,
        intervalMs: 86400000,
        numberOfOrders: 5,
        ordersExecuted: 0,
        nextExecutionTime: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Insert stop-loss intent
      database.insertIntent({
        id: randomUUID(),
        userPublicKey: userPubkey,
        type: 'stop-loss',
        status: 'active',
        inputMint: 'mint1',
        outputMint: 'mint2',
        totalAmount: 1000,
        executedAmount: 0,
        triggerPrice: 100,
        pythFeedId: 'feed-id',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const dcaIntents = database.getActiveIntentsByType('dca');
      const stopLossIntents = database.getActiveIntentsByType('stop-loss');

      expect(dcaIntents.length).toBeGreaterThanOrEqual(1);
      expect(stopLossIntents.length).toBeGreaterThanOrEqual(1);
    });

    it('should cancel an intent', () => {
      const intent = {
        id: randomUUID(),
        userPublicKey: 'test-pubkey',
        type: 'dca' as const,
        status: 'active' as const,
        inputMint: 'mint1',
        outputMint: 'mint2',
        totalAmount: 1000,
        executedAmount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      database.insertIntent(intent);
      database.updateIntentStatus(intent.id, 'cancelled');

      const updated = database.getIntentById(intent.id);
      expect(updated?.status).toBe('cancelled');
    });
  });

  describe('Payments', () => {
    it('should insert and retrieve a payment', () => {
      const payment = {
        id: randomUUID(),
        merchantId: 'test-merchant',
        orderId: 'order-123',
        amountUsdc: 100.0,
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };

      database.insertPayment(payment);
      const retrieved = database.getPaymentById(payment.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.merchantId).toBe('test-merchant');
      expect(retrieved?.amountUsdc).toBe(100.0);
    });

    it('should update payment to completed', () => {
      const payment = {
        id: randomUUID(),
        merchantId: 'test-merchant',
        orderId: 'order-456',
        amountUsdc: 50.0,
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };

      database.insertPayment(payment);
      database.completePayment(payment.id, 'payer-pubkey', 'SOL-mint', 0.5, 'tx-signature');

      const updated = database.getPaymentById(payment.id);
      expect(updated?.status).toBe('completed');
      expect(updated?.payerPublicKey).toBe('payer-pubkey');
      expect(updated?.signature).toBe('tx-signature');
    });

    it('should get payments by merchant', () => {
      const merchantId = 'merchant-' + randomUUID();

      for (let i = 0; i < 3; i++) {
        database.insertPayment({
          id: randomUUID(),
          merchantId,
          orderId: `order-${i}`,
          amountUsdc: 100,
          status: 'pending',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        });
      }

      const payments = database.getPaymentsByMerchant(merchantId);
      expect(payments.length).toBe(3);
    });
  });
});
