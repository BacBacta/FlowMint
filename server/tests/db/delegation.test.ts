/**
 * Token Delegation Tests
 *
 * Tests for token delegation database operations.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DatabaseService, DelegationRecord } from '../../src/db/database';
import { randomUUID } from 'crypto';

describe('Token Delegation', () => {
  let db: DatabaseService;

  beforeEach(async () => {
    db = new DatabaseService(':memory:');
    await db.initialize();
  });

  afterEach(() => {
    db.close();
  });

  const createMockDelegation = (overrides: Partial<DelegationRecord> = {}): DelegationRecord => ({
    id: `del_${Date.now()}_${randomUUID().slice(0, 8)}`,
    userPublicKey: 'user123pubkey',
    tokenMint: 'So11111111111111111111111111111111111111112',
    tokenAccount: 'ataAccount123',
    delegatePublicKey: 'delegatePubkey456',
    approvedAmount: '1000000000',
    remainingAmount: '1000000000',
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  });

  describe('saveDelegation', () => {
    it('should save a new delegation', async () => {
      const delegation = createMockDelegation();

      await db.saveDelegation(delegation);

      const retrieved = await db.getDelegation(delegation.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(delegation.id);
      expect(retrieved?.userPublicKey).toBe(delegation.userPublicKey);
      expect(retrieved?.status).toBe('pending');
    });

    it('should save delegation with optional fields', async () => {
      const delegation = createMockDelegation({
        intentId: 'intent_123',
        approvalSignature: 'sig_abc',
      });

      await db.saveDelegation(delegation);

      const retrieved = await db.getDelegation(delegation.id);
      expect(retrieved?.intentId).toBe('intent_123');
      expect(retrieved?.approvalSignature).toBe('sig_abc');
    });
  });

  describe('getDelegationsByUser', () => {
    it('should return all delegations for a user', async () => {
      const user1 = 'user1pubkey';
      const user2 = 'user2pubkey';

      await db.saveDelegation(createMockDelegation({ userPublicKey: user1 }));
      await db.saveDelegation(createMockDelegation({ userPublicKey: user1 }));
      await db.saveDelegation(createMockDelegation({ userPublicKey: user2 }));

      const user1Delegations = await db.getDelegationsByUser(user1);
      const user2Delegations = await db.getDelegationsByUser(user2);

      expect(user1Delegations).toHaveLength(2);
      expect(user2Delegations).toHaveLength(1);
    });

    it('should return empty array for user with no delegations', async () => {
      const delegations = await db.getDelegationsByUser('nonexistent');
      expect(delegations).toEqual([]);
    });
  });

  describe('getActiveDelegation', () => {
    it('should return active delegation for user and token', async () => {
      const userPublicKey = 'userPubkey';
      const tokenMint = 'tokenMint123';

      // Create pending delegation
      await db.saveDelegation(
        createMockDelegation({
          userPublicKey,
          tokenMint,
          status: 'pending',
        })
      );

      // Create active delegation
      const activeDelegation = createMockDelegation({
        userPublicKey,
        tokenMint,
        status: 'active',
      });
      await db.saveDelegation(activeDelegation);

      const result = await db.getActiveDelegation(userPublicKey, tokenMint);

      expect(result).toBeDefined();
      expect(result?.id).toBe(activeDelegation.id);
      expect(result?.status).toBe('active');
    });

    it('should return undefined if no active delegation exists', async () => {
      const result = await db.getActiveDelegation('user', 'token');
      expect(result).toBeUndefined();
    });
  });

  describe('updateDelegation', () => {
    it('should update delegation status', async () => {
      const delegation = createMockDelegation({ status: 'pending' });
      await db.saveDelegation(delegation);

      const updated: DelegationRecord = {
        ...delegation,
        status: 'active',
        approvalSignature: 'sig_confirmed',
        updatedAt: Date.now() + 1000,
      };
      await db.updateDelegation(updated);

      const retrieved = await db.getDelegation(delegation.id);
      expect(retrieved?.status).toBe('active');
      expect(retrieved?.approvalSignature).toBe('sig_confirmed');
    });

    it('should update remaining amount', async () => {
      const delegation = createMockDelegation({
        status: 'active',
        approvedAmount: '1000000000',
        remainingAmount: '1000000000',
      });
      await db.saveDelegation(delegation);

      const updated: DelegationRecord = {
        ...delegation,
        remainingAmount: '500000000',
        updatedAt: Date.now() + 1000,
      };
      await db.updateDelegation(updated);

      const retrieved = await db.getDelegation(delegation.id);
      expect(retrieved?.remainingAmount).toBe('500000000');
    });

    it('should mark delegation as exhausted', async () => {
      const delegation = createMockDelegation({
        status: 'active',
        remainingAmount: '100',
      });
      await db.saveDelegation(delegation);

      const updated: DelegationRecord = {
        ...delegation,
        remainingAmount: '0',
        status: 'exhausted',
        updatedAt: Date.now() + 1000,
      };
      await db.updateDelegation(updated);

      const retrieved = await db.getDelegation(delegation.id);
      expect(retrieved?.status).toBe('exhausted');
      expect(retrieved?.remainingAmount).toBe('0');
    });

    it('should mark delegation as revoked', async () => {
      const delegation = createMockDelegation({ status: 'active' });
      await db.saveDelegation(delegation);

      const updated: DelegationRecord = {
        ...delegation,
        status: 'revoked',
        updatedAt: Date.now() + 1000,
      };
      await db.updateDelegation(updated);

      const retrieved = await db.getDelegation(delegation.id);
      expect(retrieved?.status).toBe('revoked');
    });
  });
});
