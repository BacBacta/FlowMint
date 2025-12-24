import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { DatabaseService, ReceiptRecord } from '../../src/db/database';
import { Intent, IntentType, IntentStatus } from '../../src/services/intentScheduler';
import { randomUUID } from 'crypto';

describe('DatabaseService', () => {
  let db: DatabaseService;

  beforeAll(async () => {
    db = new DatabaseService(':memory:');
    await db.initialize();
  });

  afterAll(async () => {
    await db.close();
  });

  describe('Receipts', () => {
    it('should save and retrieve a receipt', async () => {
      const receipt: ReceiptRecord = {
        receiptId: randomUUID(),
        userPublicKey: 'test-pubkey-' + randomUUID().slice(0, 8),
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '1000000000',
        outAmount: '150000000',
        slippageBps: 50,
        protectedMode: false,
        priceImpactPct: '0.001',
        status: 'success',
        txSignature: 'test-signature',
        timestamp: Date.now(),
      };

      await db.saveReceipt(receipt);
      const retrieved = await db.getReceipt(receipt.receiptId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.userPublicKey).toBe(receipt.userPublicKey);
      expect(retrieved?.status).toBe('success');
    });

    it('should get receipts by user', async () => {
      const userPubkey = 'test-user-' + randomUUID().slice(0, 8);
      
      // Insert multiple receipts
      for (let i = 0; i < 3; i++) {
        await db.saveReceipt({
          receiptId: randomUUID(),
          userPublicKey: userPubkey,
          inputMint: 'mint1',
          outputMint: 'mint2',
          inAmount: '1000',
          outAmount: '100',
          slippageBps: 50,
          protectedMode: false,
          priceImpactPct: '0.001',
          txSignature: `sig-${i}`,
          status: 'success',
          timestamp: Date.now(),
        });
      }

      const receipts = await db.getUserReceipts(userPubkey);
      expect(receipts.length).toBe(3);
    });

    it('should update receipt status', async () => {
      const receipt: ReceiptRecord = {
        receiptId: randomUUID(),
        userPublicKey: 'test-pubkey-' + randomUUID().slice(0, 8),
        inputMint: 'mint1',
        outputMint: 'mint2',
        inAmount: '1000',
        outAmount: '100',
        slippageBps: 50,
        protectedMode: false,
        priceImpactPct: '0.001',
        status: 'pending',
        timestamp: Date.now(),
      };

      await db.saveReceipt(receipt);
      await db.updateReceiptStatus(receipt.receiptId, 'success', 'new-signature');

      const updated = await db.getReceipt(receipt.receiptId);
      expect(updated?.status).toBe('success');
      expect(updated?.txSignature).toBe('new-signature');
    });
  });

  describe('Intents', () => {
    it('should save and retrieve a DCA intent', async () => {
      const intent: Intent = {
        id: randomUUID(),
        userPublicKey: 'test-pubkey-' + randomUUID().slice(0, 8),
        intentType: 'dca' as IntentType,
        tokenFrom: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        tokenTo: 'So11111111111111111111111111111111111111112',
        totalAmount: '100000000',
        remainingAmount: '100000000',
        intervalSeconds: 86400,
        amountPerSwap: '10000000',
        status: 'active' as IntentStatus,
        slippageBps: 50,
        executionCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await db.saveIntent(intent);
      const retrieved = await db.getIntent(intent.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.intentType).toBe('dca');
    });

    it('should save and retrieve a stop-loss intent', async () => {
      const intent: Intent = {
        id: randomUUID(),
        userPublicKey: 'test-pubkey-' + randomUUID().slice(0, 8),
        intentType: 'stop_loss' as IntentType,
        tokenFrom: 'So11111111111111111111111111111111111111112',
        tokenTo: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        totalAmount: '10000000000',
        remainingAmount: '10000000000',
        priceThreshold: 80.0,
        priceDirection: 'below',
        priceFeedId: 'test-feed-id',
        status: 'active' as IntentStatus,
        slippageBps: 100,
        executionCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await db.saveIntent(intent);
      const retrieved = await db.getIntent(intent.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.intentType).toBe('stop_loss');
      expect(retrieved?.priceThreshold).toBe(80.0);
    });

    it('should get active intents by type', async () => {
      const userPubkey = 'test-user-' + randomUUID().slice(0, 8);

      // Insert DCA intent
      await db.saveIntent({
        id: randomUUID(),
        userPublicKey: userPubkey,
        intentType: 'dca' as IntentType,
        tokenFrom: 'mint1',
        tokenTo: 'mint2',
        totalAmount: '1000',
        remainingAmount: '1000',
        intervalSeconds: 86400,
        amountPerSwap: '100',
        status: 'active' as IntentStatus,
        slippageBps: 50,
        executionCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Insert stop-loss intent
      await db.saveIntent({
        id: randomUUID(),
        userPublicKey: userPubkey,
        intentType: 'stop_loss' as IntentType,
        tokenFrom: 'mint1',
        tokenTo: 'mint2',
        totalAmount: '1000',
        remainingAmount: '1000',
        priceThreshold: 100,
        priceDirection: 'below',
        status: 'active' as IntentStatus,
        slippageBps: 50,
        executionCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const dcaIntents = await db.getActiveIntents('dca');
      const stopLossIntents = await db.getActiveIntents('stop_loss');

      expect(dcaIntents.length).toBeGreaterThanOrEqual(1);
      expect(stopLossIntents.length).toBeGreaterThanOrEqual(1);
    });

    it('should update intent status', async () => {
      const intent: Intent = {
        id: randomUUID(),
        userPublicKey: 'test-pubkey-' + randomUUID().slice(0, 8),
        intentType: 'dca' as IntentType,
        tokenFrom: 'mint1',
        tokenTo: 'mint2',
        totalAmount: '1000',
        remainingAmount: '1000',
        intervalSeconds: 86400,
        amountPerSwap: '100',
        status: 'active' as IntentStatus,
        slippageBps: 50,
        executionCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await db.saveIntent(intent);
      await db.updateIntentStatus(intent.id, 'cancelled');

      const updated = await db.getIntent(intent.id);
      expect(updated?.status).toBe('cancelled');
    });
  });

  describe('Payments', () => {
    it('should save and retrieve a payment', async () => {
      const paymentId = randomUUID();
      const payment = {
        paymentId,
        payerPublicKey: 'payer-' + randomUUID().slice(0, 8),
        merchantPublicKey: 'merchant-' + randomUUID().slice(0, 8),
        inputToken: 'So11111111111111111111111111111111111111112',
        inputAmount: '1000000000',
        usdcAmount: '100000000',
        memo: 'test payment',
        status: 'pending' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await db.savePayment(payment);
      const retrieved = await db.getPayment(payment.paymentId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.merchantPublicKey).toBe(payment.merchantPublicKey);
    });

    it('should update payment status', async () => {
      const payment = {
        paymentId: randomUUID(),
        payerPublicKey: 'payer-' + randomUUID().slice(0, 8),
        merchantPublicKey: 'merchant-' + randomUUID().slice(0, 8),
        inputToken: 'So11111111111111111111111111111111111111112',
        inputAmount: '500000000',
        usdcAmount: '50000000',
        status: 'pending' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await db.savePayment(payment);
      await db.updatePaymentStatus(payment.paymentId, 'success', 'tx-signature');

      const updated = await db.getPayment(payment.paymentId);
      expect(updated?.status).toBe('success');
    });

    it('should get payments by user', async () => {
      const userPubkey = 'user-' + randomUUID().slice(0, 8);

      for (let i = 0; i < 3; i++) {
        await db.savePayment({
          paymentId: randomUUID(),
          payerPublicKey: userPubkey,
          merchantPublicKey: 'merchant-' + i,
          inputToken: 'So11111111111111111111111111111111111111112',
          inputAmount: '100000000',
          usdcAmount: '10000000',
          status: 'pending' as const,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }

      const payments = await db.getUserPayments(userPubkey);
      expect(payments.length).toBe(3);
    });
  });

  describe('Job Locks', () => {
    it('should create and retrieve a job lock', async () => {
      const intentId = randomUUID();
      const jobKey = `dca-${intentId}-0`;

      await db.createJobLock({
        id: randomUUID(),
        jobKey,
        intentId,
        scheduledAt: Date.now(),
        status: 'pending',
        attempts: 0,
        createdAt: Date.now(),
      });

      const job = await db.getJobByKey(jobKey);

      expect(job).toBeDefined();
      expect(job?.intentId).toBe(intentId);
      expect(job?.status).toBe('pending');
    });

    it('should update job lock status', async () => {
      const intentId = randomUUID();
      const jobKey = `dca-${intentId}-1`;
      const jobId = randomUUID();

      await db.createJobLock({
        id: jobId,
        jobKey,
        intentId,
        scheduledAt: Date.now(),
        status: 'pending',
        attempts: 0,
        createdAt: Date.now(),
      });

      // updateJobLock takes jobId (not jobKey)
      await db.updateJobLock(jobId, {
        status: 'completed',
        result: JSON.stringify({ success: true }),
      });

      const job = await db.getJobByKey(jobKey);
      expect(job?.status).toBe('completed');
    });

    it('should get jobs by intent', async () => {
      const intentId = randomUUID();

      for (let i = 0; i < 3; i++) {
        await db.createJobLock({
          id: randomUUID(),
          jobKey: `dca-${intentId}-${i}`,
          intentId,
          scheduledAt: Date.now() + i * 1000,
          status: 'pending',
          attempts: 0,
          createdAt: Date.now(),
        });
      }

      const jobs = await db.getJobsByIntent(intentId);
      expect(jobs.length).toBe(3);
    });
  });
});
