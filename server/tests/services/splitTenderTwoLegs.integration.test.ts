import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';

jest.mock('../../src/utils/logger', () => ({
  logger: {
    child: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: (...args: any[]) => {
        // Keep visibility on errors during integration-style tests
        // eslint-disable-next-line no-console
        console.error(...args);
      },
      debug: jest.fn(),
    }),
    info: jest.fn(),
    warn: jest.fn(),
    error: (...args: any[]) => {
      // eslint-disable-next-line no-console
      console.error(...args);
    },
    debug: jest.fn(),
  },
}));

// Mock Solana Connection everywhere in this test file (no network)
jest.mock('@solana/web3.js', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const actual = jest.requireActual('@solana/web3.js');

  class MockConnection {
    getLatestBlockhash = jest
      .fn()
      .mockResolvedValue({ blockhash: actual.Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 123 });

    sendTransaction = jest.fn().mockResolvedValue('mock-tx-sig');

    confirmTransaction = jest.fn().mockResolvedValue({ value: { err: null } });

    getBalance = jest.fn().mockResolvedValue(0);

    // Some code paths use these, keep them safe
    sendRawTransaction = jest.fn().mockResolvedValue('mock-raw-tx-sig');
    getTransaction = jest.fn().mockResolvedValue({ slot: 12345 });

    constructor(_endpoint?: string, _commitment?: any) {}
  }

  return {
    ...actual,
    Connection: MockConnection,
  };
});

import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';

import type { Express } from 'express';

function buildDummySignedV0TxBase64(payer: Keypair): string {
  const recentBlockhash = Keypair.generate().publicKey.toBase58();
  const recipient = Keypair.generate().publicKey;

  const ix = SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: recipient,
    lamports: 1,
  });

  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash,
    instructions: [ix],
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([payer]);

  return Buffer.from(tx.serialize()).toString('base64');
}

describe('Split-tender integration (2 legs: swap + direct transfer)', () => {
  let app: Express;
  let db: any;
  let invoiceService: any;

  beforeAll(async () => {
    // Ensure the app config is loaded in development mode so errors include messages.
    process.env.NODE_ENV = 'development';

    // Jest runs this suite in CommonJS mode (ts-jest useESM=false), so use require().
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DatabaseService } = require('../../src/db/database');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createApp } = require('../../src/app');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { InvoiceService } = require('../../src/services/invoiceService');

    db = new DatabaseService(':memory:');
    await db.initialize();

    app = await createApp(db);
    invoiceService = new InvoiceService(db);
  });

  afterAll(async () => {
    if (db) {
      await db.close();
    }
  });

  it('executes 2 legs sequentially and persists attestation on completion', async () => {
    const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const SOL_MINT = 'So11111111111111111111111111111111111111112';

    const payer = Keypair.generate();
    const merchantWallet = Keypair.generate();

    // Merchant ID must be a valid pubkey (direct transfer path derives a Pubkey from invoice.merchantId)
    await db.saveMerchant({
      id: merchantWallet.publicKey.toBase58(),
      name: 'Test Merchant',
      settleMint: USDC_MINT,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const invoice = await invoiceService.createInvoice({
      merchantId: merchantWallet.publicKey.toBase58(),
      settleMint: USDC_MINT,
      amountOut: '2000000',
      orderId: 'order-a8',
    });

    const reservationId = 'resv-a8-' + Date.now();
    const now = Date.now();

    await db.saveInvoiceReservation({
      id: reservationId,
      invoiceId: invoice.id,
      payer: payer.publicKey.toBase58(),
      strategy: 'min-risk',
      planJson: JSON.stringify({
        strategy: 'min-risk',
        settlementAmount: invoice.amountOut,
        totalExpectedUsdcOut: invoice.amountOut,
        refundPolicy: 'refund_surplus',
        legs: [
          { payMint: SOL_MINT, amountIn: '1000000000', expectedUsdcOut: '1000000' },
          { payMint: USDC_MINT, amountIn: '1000000', expectedUsdcOut: '1000000' },
        ],
      }),
      totalLegs: 2,
      completedLegs: 0,
      usdcCollected: '0',
      status: 'active',
      expiresAt: now + 60_000,
      createdAt: now,
      updatedAt: now,
    });

    // Leg 0: swap leg (client provides a signed VersionedTransaction)
    await db.savePaymentLeg({
      id: 'leg0-' + Date.now(),
      reservationId,
      invoiceId: invoice.id,
      legIndex: 0,
      payMint: SOL_MINT,
      amountIn: '1000000000',
      expectedUsdcOut: '1000000',
      status: 'pending',
      retryCount: 0,
      maxRetries: 3,
      createdAt: now,
    });

    // Leg 1: direct transfer leg (USDC -> USDC), no signed tx provided
    await db.savePaymentLeg({
      id: 'leg1-' + Date.now(),
      reservationId,
      invoiceId: invoice.id,
      legIndex: 1,
      payMint: USDC_MINT,
      amountIn: '1000000',
      expectedUsdcOut: '1000000',
      status: 'pending',
      retryCount: 0,
      maxRetries: 3,
      createdAt: now,
    });

    const signedSwapTx = buildDummySignedV0TxBase64(payer);

    // Execute leg 0
    const r0 = await request(app)
      .post('/api/v1/payments/execute-leg')
      .send({ reservationId, legIndex: 0, signedTransaction: signedSwapTx });

    if (r0.status !== 200) {
      throw new Error(
        `Leg0 failed: status=${r0.status} body=${JSON.stringify(r0.body)} text=${r0.text}`
      );
    }

    expect(r0.status).toBe(200);
    expect(r0.body).toHaveProperty('success', true);
    expect(r0.body).toHaveProperty('legIndex', 0);
    expect(r0.body).toHaveProperty('txSignature');

    // Execute leg 1
    const r1 = await request(app)
      .post('/api/v1/payments/execute-leg')
      .send({ reservationId, legIndex: 1 });

    expect(r1.status).toBe(200);
    expect(r1.body).toHaveProperty('success', true);
    expect(r1.body).toHaveProperty('legIndex', 1);

    const updatedInvoice = await db.getInvoice(invoice.id);
    expect(updatedInvoice?.status).toBe('paid');

    const attestation = await db.getAttestationByInvoice(invoice.id);
    expect(attestation).toBeDefined();
    expect(attestation?.merkleRoot).toBeTruthy();
    expect(Array.isArray(attestation?.legProofs)).toBe(true);
    expect(attestation?.legProofs?.length).toBe(2);

    // Attestation kit endpoint should succeed
    const kit = await request(app).get(`/api/v1/invoices/${invoice.id}/attestation/kit`);
    expect(kit.status).toBe(200);
    expect(kit.body).toHaveProperty('attestation');
    expect(kit.body).toHaveProperty('merkleRoot');
    expect(kit.body).toHaveProperty('legProofs');

    // Per-leg verification should be valid for both legs
    const verify0 = await request(app).get(`/api/v1/attestations/${attestation!.id}/verify?leg=0`);
    const verify1 = await request(app).get(`/api/v1/attestations/${attestation!.id}/verify?leg=1`);

    expect(verify0.status).toBe(200);
    expect(verify0.body).toHaveProperty('valid', true);

    expect(verify1.status).toBe(200);
    expect(verify1.body).toHaveProperty('valid', true);
  });
});
