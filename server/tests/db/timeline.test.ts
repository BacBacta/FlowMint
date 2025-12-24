/**
 * Execution Timeline Tests
 *
 * Tests for execution event persistence and timeline retrieval.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DatabaseService, ExecutionEventType } from '../../src/db/database';

describe('Execution Timeline', () => {
  let db: DatabaseService;

  beforeEach(async () => {
    db = new DatabaseService(':memory:');
    await db.initialize();
  });

  afterEach(() => {
    db.close();
  });

  describe('saveExecutionEvent', () => {
    it('should save an execution event', async () => {
      const event = {
        receiptId: 'test-receipt-123',
        eventType: 'quote' as ExecutionEventType,
        timestamp: Date.now(),
        slippageBps: 50,
        metadata: { inAmount: '1000000000', outAmount: '100000000' },
      };

      await db.saveExecutionEvent(event);

      const events = await db.getExecutionEvents('test-receipt-123');
      expect(events).toHaveLength(1);
      expect(events[0].receiptId).toBe('test-receipt-123');
      expect(events[0].eventType).toBe('quote');
      expect(events[0].slippageBps).toBe(50);
      expect(events[0].metadata).toEqual({ inAmount: '1000000000', outAmount: '100000000' });
    });

    it('should save multiple events in order', async () => {
      const receiptId = 'test-receipt-456';
      const now = Date.now();

      await db.saveExecutionEvent({
        receiptId,
        eventType: 'quote',
        timestamp: now,
      });

      await db.saveExecutionEvent({
        receiptId,
        eventType: 'tx_build',
        timestamp: now + 100,
        priorityFee: 50000,
      });

      await db.saveExecutionEvent({
        receiptId,
        eventType: 'tx_send',
        timestamp: now + 200,
        rpcEndpoint: 'https://api.mainnet.solana.com',
      });

      await db.saveExecutionEvent({
        receiptId,
        eventType: 'tx_confirm',
        timestamp: now + 500,
        signature: 'abc123signature',
        status: 'confirmed',
      });

      await db.saveExecutionEvent({
        receiptId,
        eventType: 'success',
        timestamp: now + 510,
      });

      const events = await db.getExecutionEvents(receiptId);
      expect(events).toHaveLength(5);
      expect(events[0].eventType).toBe('quote');
      expect(events[1].eventType).toBe('tx_build');
      expect(events[2].eventType).toBe('tx_send');
      expect(events[3].eventType).toBe('tx_confirm');
      expect(events[4].eventType).toBe('success');
    });

    it('should save error details for failures', async () => {
      const receiptId = 'test-receipt-error';

      await db.saveExecutionEvent({
        receiptId,
        eventType: 'failure',
        timestamp: Date.now(),
        errorCode: 'SLIPPAGE_EXCEEDED',
        errorMessage: 'Slippage tolerance exceeded',
      });

      const events = await db.getExecutionEvents(receiptId);
      expect(events).toHaveLength(1);
      expect(events[0].errorCode).toBe('SLIPPAGE_EXCEEDED');
      expect(events[0].errorMessage).toBe('Slippage tolerance exceeded');
    });

    it('should save retry and requote events', async () => {
      const receiptId = 'test-receipt-retry';
      const now = Date.now();

      await db.saveExecutionEvent({
        receiptId,
        eventType: 'quote',
        timestamp: now,
        slippageBps: 50,
      });

      await db.saveExecutionEvent({
        receiptId,
        eventType: 'retry',
        timestamp: now + 100,
        errorCode: 'TIMEOUT',
        metadata: { attempt: 1, delayMs: 500 },
      });

      await db.saveExecutionEvent({
        receiptId,
        eventType: 'requote',
        timestamp: now + 600,
        slippageBps: 75, // Increased slippage
        errorCode: 'STALE_QUOTE',
      });

      const events = await db.getExecutionEvents(receiptId);
      expect(events).toHaveLength(3);
      expect(events[1].eventType).toBe('retry');
      expect(events[1].metadata).toEqual({ attempt: 1, delayMs: 500 });
      expect(events[2].eventType).toBe('requote');
      expect(events[2].slippageBps).toBe(75);
    });
  });

  describe('getExecutionEvents', () => {
    it('should return empty array for non-existent receipt', async () => {
      const events = await db.getExecutionEvents('non-existent');
      expect(events).toEqual([]);
    });

    it('should return events ordered by timestamp', async () => {
      const receiptId = 'test-order';
      const now = Date.now();

      // Insert out of order
      await db.saveExecutionEvent({
        receiptId,
        eventType: 'success',
        timestamp: now + 300,
      });

      await db.saveExecutionEvent({
        receiptId,
        eventType: 'quote',
        timestamp: now,
      });

      await db.saveExecutionEvent({
        receiptId,
        eventType: 'tx_build',
        timestamp: now + 100,
      });

      const events = await db.getExecutionEvents(receiptId);
      expect(events[0].eventType).toBe('quote');
      expect(events[1].eventType).toBe('tx_build');
      expect(events[2].eventType).toBe('success');
    });

    it('should isolate events by receiptId', async () => {
      await db.saveExecutionEvent({
        receiptId: 'receipt-a',
        eventType: 'quote',
        timestamp: Date.now(),
      });

      await db.saveExecutionEvent({
        receiptId: 'receipt-b',
        eventType: 'quote',
        timestamp: Date.now(),
      });

      await db.saveExecutionEvent({
        receiptId: 'receipt-a',
        eventType: 'success',
        timestamp: Date.now() + 100,
      });

      const eventsA = await db.getExecutionEvents('receipt-a');
      const eventsB = await db.getExecutionEvents('receipt-b');

      expect(eventsA).toHaveLength(2);
      expect(eventsB).toHaveLength(1);
    });
  });

  describe('FlowMint injection event', () => {
    it('should record FlowMint program injection', async () => {
      const receiptId = 'test-flowmint';

      await db.saveExecutionEvent({
        receiptId,
        eventType: 'flowmint_inject',
        timestamp: Date.now(),
        metadata: {
          receiptPda: 'FMxyz...',
          routeDataLen: 256,
        },
      });

      const events = await db.getExecutionEvents(receiptId);
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('flowmint_inject');
      expect(events[0].metadata?.receiptPda).toBe('FMxyz...');
    });
  });
});
