import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { Connection, Keypair } from '@solana/web3.js';

import { DatabaseService } from '../../src/db/database';
import { RelayerService } from '../../src/services/relayerService';

describe('RelayerService gasless eligibility', () => {
  const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const NOT_ALLOWLISTED_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

  let db: DatabaseService;

  beforeAll(async () => {
    db = new DatabaseService(':memory:');
    await db.initialize();
  });

  afterAll(async () => {
    await db.close();
  });

  it('returns ineligible when user has sufficient SOL balance', async () => {
    const connection = {
      getBalance: jest.fn().mockResolvedValue(10001),
    } as unknown as Connection;

    const service = new RelayerService(connection, db);

    const userPublicKey = Keypair.generate().publicKey.toBase58();
    const r = await service.checkGaslessEligibility(userPublicKey, USDC_MINT);

    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/sufficient SOL balance/i);
    expect(r.payMint).toBe(USDC_MINT);
    expect(r.userSolBalance).toBe(10001);
  });

  it('returns eligible when user SOL is at threshold and token is allowlisted', async () => {
    const connection = {
      getBalance: jest.fn().mockResolvedValue(10000),
    } as unknown as Connection;

    const service = new RelayerService(connection, db);

    const userPublicKey = Keypair.generate().publicKey.toBase58();
    const r = await service.checkGaslessEligibility(userPublicKey, USDC_MINT);

    expect(r.eligible).toBe(true);
    expect(r.reason).toBeUndefined();
    expect(r.payMint).toBe(USDC_MINT);
    expect(r.userSolBalance).toBe(10000);
  });

  it('returns ineligible when token is not in allowlist (even if SOL is low)', async () => {
    const connection = {
      getBalance: jest.fn().mockResolvedValue(0),
    } as unknown as Connection;

    const service = new RelayerService(connection, db);

    const userPublicKey = Keypair.generate().publicKey.toBase58();
    const r = await service.checkGaslessEligibility(userPublicKey, NOT_ALLOWLISTED_MINT);

    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/not eligible for gasless payments/i);
    expect(r.payMint).toBe(NOT_ALLOWLISTED_MINT);
    expect(r.userSolBalance).toBe(0);
  });

  it('returns eligible when token is allowlisted and SOL is low', async () => {
    const connection = {
      getBalance: jest.fn().mockResolvedValue(0),
    } as unknown as Connection;

    const service = new RelayerService(connection, db);

    const userPublicKey = Keypair.generate().publicKey.toBase58();
    const r = await service.checkGaslessEligibility(userPublicKey, USDC_MINT);

    expect(r.eligible).toBe(true);
    expect(r.payMint).toBe(USDC_MINT);
    expect(r.userSolBalance).toBe(0);
  });

  it('returns ineligible with an error reason when RPC balance fetch fails', async () => {
    const connection = {
      getBalance: jest.fn().mockRejectedValue(new Error('RPC down')),
    } as unknown as Connection;

    const service = new RelayerService(connection, db);

    const userPublicKey = Keypair.generate().publicKey.toBase58();
    const r = await service.checkGaslessEligibility(userPublicKey, USDC_MINT);

    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/Error checking eligibility/i);
    expect(r.reason).toMatch(/RPC down/i);
    expect(r.payMint).toBe(USDC_MINT);
  });
});
