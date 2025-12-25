/**
 * PortfolioPay V1 - Unit Tests
 *
 * Tests for InvoiceService, AttestationService, and RelayerService.
 */

import { Keypair, Connection } from '@solana/web3.js';
import { DatabaseService } from '../src/db/database';
import { InvoiceService, CreateInvoiceParams } from '../src/services/invoiceService';
import { AttestationService, PlannedExecution, ActualExecution } from '../src/services/attestationService';
import { RelayerService } from '../src/services/relayerService';

// Mock data
const MOCK_MERCHANT_ID = 'merchant-test-123';
const MOCK_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const MOCK_PAYER = 'PayerPubkey111111111111111111111111111111111';

describe('PortfolioPay V1 - InvoiceService', () => {
  let db: DatabaseService;
  let invoiceService: InvoiceService;

  beforeAll(async () => {
    db = new DatabaseService(':memory:');
    await db.initialize();

    // Create test merchant
    await db.saveMerchant({
      id: MOCK_MERCHANT_ID,
      name: 'Test Merchant',
      settleMint: MOCK_USDC_MINT,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    invoiceService = new InvoiceService(db);
  });

  afterAll(() => {
    db.close();
  });

  describe('createInvoice', () => {
    it('should create an invoice successfully', async () => {
      const params: CreateInvoiceParams = {
        merchantId: MOCK_MERCHANT_ID,
        settleMint: MOCK_USDC_MINT,
        amountOut: '1000000', // 1 USDC
        orderId: 'order-123',
      };

      const invoice = await invoiceService.createInvoice(params);

      expect(invoice).toBeDefined();
      expect(invoice.id).toBeDefined();
      expect(invoice.merchantId).toBe(MOCK_MERCHANT_ID);
      expect(invoice.settleMint).toBe(MOCK_USDC_MINT);
      expect(invoice.amountOut).toBe('1000000');
      expect(invoice.status).toBe('pending');
    });

    it('should support idempotency keys', async () => {
      const idempotencyKey = 'unique-key-' + Date.now();
      const params: CreateInvoiceParams = {
        merchantId: MOCK_MERCHANT_ID,
        settleMint: MOCK_USDC_MINT,
        amountOut: '2000000',
        idempotencyKey,
      };

      const invoice1 = await invoiceService.createInvoice(params);
      const invoice2 = await invoiceService.createInvoice(params);

      expect(invoice1.id).toBe(invoice2.id);
    });

    it('should throw for non-existent merchant', async () => {
      const params: CreateInvoiceParams = {
        merchantId: 'non-existent',
        settleMint: MOCK_USDC_MINT,
        amountOut: '1000000',
      };

      await expect(invoiceService.createInvoice(params)).rejects.toThrow('Merchant not found');
    });
  });

  describe('reserveForPayer', () => {
    it('should reserve invoice for payer', async () => {
      const invoice = await invoiceService.createInvoice({
        merchantId: MOCK_MERCHANT_ID,
        settleMint: MOCK_USDC_MINT,
        amountOut: '1000000',
      });

      const reserved = await invoiceService.reserveForPayer({
        invoiceId: invoice.id,
        payerPublicKey: MOCK_PAYER,
      });

      expect(reserved.status).toBe('reserved');
      expect(reserved.payerPublicKey).toBe(MOCK_PAYER);
      expect(reserved.reservedUntil).toBeGreaterThan(Date.now());
    });

    it('should throw when reserved by another payer', async () => {
      const invoice = await invoiceService.createInvoice({
        merchantId: MOCK_MERCHANT_ID,
        settleMint: MOCK_USDC_MINT,
        amountOut: '1000000',
      });

      await invoiceService.reserveForPayer({
        invoiceId: invoice.id,
        payerPublicKey: MOCK_PAYER,
      });

      await expect(
        invoiceService.reserveForPayer({
          invoiceId: invoice.id,
          payerPublicKey: 'AnotherPayer11111111111111111111111111111111',
        })
      ).rejects.toThrow('reserved by another payer');
    });
  });

  describe('markPaid', () => {
    it('should mark invoice as paid', async () => {
      const invoice = await invoiceService.createInvoice({
        merchantId: MOCK_MERCHANT_ID,
        settleMint: MOCK_USDC_MINT,
        amountOut: '1000000',
      });

      const paid = await invoiceService.markPaid({
        invoiceId: invoice.id,
        txSignature: 'tx-sig-123',
      });

      expect(paid.status).toBe('paid');
      expect(paid.txSignature).toBe('tx-sig-123');
      expect(paid.paidAt).toBeDefined();
    });

    it('should be idempotent for already paid invoices', async () => {
      const invoice = await invoiceService.createInvoice({
        merchantId: MOCK_MERCHANT_ID,
        settleMint: MOCK_USDC_MINT,
        amountOut: '1000000',
      });

      await invoiceService.markPaid({ invoiceId: invoice.id, txSignature: 'tx-1' });
      const paid2 = await invoiceService.markPaid({ invoiceId: invoice.id, txSignature: 'tx-2' });

      expect(paid2.txSignature).toBe('tx-1'); // Original signature preserved
    });
  });

  describe('validatePayable', () => {
    it('should validate payable invoice', async () => {
      const invoice = await invoiceService.createInvoice({
        merchantId: MOCK_MERCHANT_ID,
        settleMint: MOCK_USDC_MINT,
        amountOut: '1000000',
      });

      const result = await invoiceService.validatePayable(invoice.id, MOCK_PAYER);

      expect(result.valid).toBe(true);
      expect(result.invoice).toBeDefined();
    });

    it('should reject paid invoices', async () => {
      const invoice = await invoiceService.createInvoice({
        merchantId: MOCK_MERCHANT_ID,
        settleMint: MOCK_USDC_MINT,
        amountOut: '1000000',
      });

      await invoiceService.markPaid({ invoiceId: invoice.id, txSignature: 'tx' });

      const result = await invoiceService.validatePayable(invoice.id, MOCK_PAYER);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('already paid');
    });
  });
});

describe('PortfolioPay V1 - AttestationService', () => {
  let db: DatabaseService;
  let attestationService: AttestationService;
  let signerKeypair: Keypair;

  beforeAll(async () => {
    db = new DatabaseService(':memory:');
    await db.initialize();
    attestationService = new AttestationService(db, 'https://test.example.com');
    signerKeypair = Keypair.generate();
  });

  afterAll(() => {
    db.close();
  });

  describe('hashPolicy', () => {
    it('should generate consistent hash for same policy', () => {
      const policy = {
        id: 'policy-1',
        merchantId: 'merchant-1',
        name: 'Test Policy',
        jsonCanonical: '{}',
        hash: '',
        version: 1,
        maxSlippageBps: 100,
        maxPriceImpactBps: 300,
        maxHops: 4,
        protectedMode: true,
        createdAt: Date.now(),
      };

      const hash1 = attestationService.hashPolicy(policy);
      const hash2 = attestationService.hashPolicy(policy);

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64); // SHA256 hex
    });
  });

  describe('validateAgainstPolicy', () => {
    const mockPolicy = {
      id: 'policy-1',
      merchantId: 'merchant-1',
      name: 'Test Policy',
      jsonCanonical: '{}',
      hash: '',
      version: 1,
      maxSlippageBps: 100,
      maxPriceImpactBps: 300,
      maxHops: 4,
      protectedMode: true,
      createdAt: Date.now(),
    };

    it('should validate compliant execution', () => {
      const planned: PlannedExecution = {
        payMint: 'SOL',
        settleMint: 'USDC',
        amountIn: '1000000',
        amountOut: '1000000',
        route: [{ dex: 'Raydium', inputMint: 'SOL', outputMint: 'USDC', inputAmount: '1000000', outputAmount: '1000000' }],
        priceImpactBps: 50,
        slippageBps: 50,
        gasless: false,
      };

      const result = attestationService.validateAgainstPolicy(planned, mockPolicy);

      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('should detect slippage violation', () => {
      const planned: PlannedExecution = {
        payMint: 'SOL',
        settleMint: 'USDC',
        amountIn: '1000000',
        amountOut: '1000000',
        route: [{ dex: 'Raydium', inputMint: 'SOL', outputMint: 'USDC', inputAmount: '1000000', outputAmount: '1000000' }],
        priceImpactBps: 50,
        slippageBps: 200, // Exceeds 100
        gasless: false,
      };

      const result = attestationService.validateAgainstPolicy(planned, mockPolicy);

      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.field === 'slippageBps')).toBe(true);
    });

    it('should detect max hops violation', () => {
      const planned: PlannedExecution = {
        payMint: 'SOL',
        settleMint: 'USDC',
        amountIn: '1000000',
        amountOut: '1000000',
        route: [
          { dex: 'A', inputMint: '1', outputMint: '2', inputAmount: '1', outputAmount: '1' },
          { dex: 'B', inputMint: '2', outputMint: '3', inputAmount: '1', outputAmount: '1' },
          { dex: 'C', inputMint: '3', outputMint: '4', inputAmount: '1', outputAmount: '1' },
          { dex: 'D', inputMint: '4', outputMint: '5', inputAmount: '1', outputAmount: '1' },
          { dex: 'E', inputMint: '5', outputMint: '6', inputAmount: '1', outputAmount: '1' }, // 5 hops > 4
        ],
        priceImpactBps: 50,
        slippageBps: 50,
        gasless: false,
      };

      const result = attestationService.validateAgainstPolicy(planned, mockPolicy);

      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.field === 'hops')).toBe(true);
    });
  });

  describe('assessRisk', () => {
    it('should identify simple routes', () => {
      const planned: PlannedExecution = {
        payMint: 'SOL',
        settleMint: 'USDC',
        amountIn: '1000000',
        amountOut: '1000000',
        route: [{ dex: 'Raydium', inputMint: 'SOL', outputMint: 'USDC', inputAmount: '1000000', outputAmount: '1000000' }],
        priceImpactBps: 50,
        slippageBps: 50,
        gasless: false,
      };

      const risk = attestationService.assessRisk(planned);

      expect(risk.routeComplexity).toBe('simple');
      expect(risk.hops).toBe(1);
    });

    it('should flag complex routes', () => {
      const planned: PlannedExecution = {
        payMint: 'SOL',
        settleMint: 'USDC',
        amountIn: '1000000',
        amountOut: '1000000',
        route: [
          { dex: 'A', inputMint: '1', outputMint: '2', inputAmount: '1', outputAmount: '1' },
          { dex: 'B', inputMint: '2', outputMint: '3', inputAmount: '1', outputAmount: '1' },
          { dex: 'C', inputMint: '3', outputMint: '4', inputAmount: '1', outputAmount: '1' },
          { dex: 'D', inputMint: '4', outputMint: '5', inputAmount: '1', outputAmount: '1' },
        ],
        priceImpactBps: 50,
        slippageBps: 50,
        gasless: false,
      };

      const risk = attestationService.assessRisk(planned);

      expect(risk.routeComplexity).toBe('complex');
      expect(risk.warnings.some((w) => w.includes('MEV'))).toBe(true);
    });
  });

  describe('createAttestation & verifyAttestation', () => {
    it('should create and verify attestation', async () => {
      // Create test invoice
      const invoiceId = 'invoice-test-' + Date.now();
      await db.saveInvoice({
        id: invoiceId,
        merchantId: 'merchant-1',
        settleMint: MOCK_USDC_MINT,
        amountOut: '1000000',
        status: 'paid',
        expiresAt: Date.now() + 3600000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const policy = {
        id: 'policy-1',
        merchantId: 'merchant-1',
        name: 'Test Policy',
        jsonCanonical: '{}',
        hash: '',
        version: 1,
        maxSlippageBps: 100,
        maxPriceImpactBps: 300,
        maxHops: 4,
        protectedMode: true,
        createdAt: Date.now(),
      };

      const planned: PlannedExecution = {
        payMint: 'SOL',
        settleMint: 'USDC',
        amountIn: '1000000',
        amountOut: '1000000',
        route: [],
        priceImpactBps: 50,
        slippageBps: 50,
        gasless: false,
      };

      const actual: ActualExecution = {
        signature: 'tx-sig-123',
        slot: 12345,
        amountInActual: '1000000',
        amountOutActual: '1000000',
        feesPaid: '5000',
        success: true,
        timestamp: Date.now(),
      };

      const attestation = await attestationService.createAttestation({
        invoiceId,
        policy,
        planned,
        actual,
        signerKeypair,
      });

      expect(attestation).toBeDefined();
      expect(attestation.id).toBeDefined();
      expect(attestation.signature).toBeDefined();
      expect(attestation.verificationUrl).toContain(attestation.id);

      // Verify
      const verification = await attestationService.verifyAttestation(attestation.id);

      expect(verification.valid).toBe(true);
      expect(verification.errors).toHaveLength(0);
      expect(verification.attestation).toBeDefined();
    });
  });
});

describe('PortfolioPay V1 - RelayerService', () => {
  let db: DatabaseService;
  let relayerService: RelayerService;
  let mockConnection: Connection;

  beforeAll(async () => {
    db = new DatabaseService(':memory:');
    await db.initialize();

    // Mock connection
    mockConnection = {
      getBalance: jest.fn().mockResolvedValue(0),
      sendRawTransaction: jest.fn().mockResolvedValue('mock-tx-sig'),
      confirmTransaction: jest.fn().mockResolvedValue({ value: { err: null } }),
      getTransaction: jest.fn().mockResolvedValue({ slot: 12345 }),
    } as unknown as Connection;

    relayerService = new RelayerService(mockConnection, db);
  });

  afterAll(() => {
    db.close();
  });

  describe('checkGaslessEligibility', () => {
    // Use a valid base58 Solana public key for tests
    const VALID_PUBKEY = 'DRpbCBMxVnDK7maPMBRnCnCn5J7pQGHKqfxK3V5iqRxD';

    it('should return eligible for user with 0 SOL and allowed token', async () => {
      const result = await relayerService.checkGaslessEligibility(
        VALID_PUBKEY,
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' // USDC
      );

      expect(result.eligible).toBe(true);
      expect(result.userSolBalance).toBe(0);
    });

    it('should return ineligible for non-allowlisted token', async () => {
      const result = await relayerService.checkGaslessEligibility(
        VALID_PUBKEY,
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' // Valid but not in allowlist
      );

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('not eligible');
    });

    it('should return ineligible for user with SOL balance', async () => {
      (mockConnection.getBalance as any).mockResolvedValueOnce(1000000);

      const result = await relayerService.checkGaslessEligibility(
        VALID_PUBKEY,
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      );

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('sufficient SOL');
    });
  });

  describe('getGaslessAllowlist', () => {
    it('should return the allowlist', () => {
      const allowlist = relayerService.getGaslessAllowlist();

      expect(allowlist).toContain('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC
      expect(allowlist).toContain('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'); // USDT
      expect(allowlist).toContain('So11111111111111111111111111111111111111112'); // wSOL
    });
  });

  describe('estimateRelayerFee', () => {
    it('should return fee estimate', async () => {
      const estimate = await relayerService.estimateRelayerFee();

      expect(estimate.feeLamports).toBeGreaterThan(0);
      expect(estimate.feeUsd).toBeGreaterThan(0);
    });
  });

  describe('getSubmission', () => {
    it('should return undefined for non-existent submission', async () => {
      const result = await relayerService.getSubmission('non-existent');
      expect(result).toBeUndefined();
    });
  });
});

describe('PortfolioPay V1 - Database CRUD', () => {
  let db: DatabaseService;

  beforeAll(async () => {
    db = new DatabaseService(':memory:');
    await db.initialize();
  });

  afterAll(() => {
    db.close();
  });

  describe('Merchant CRUD', () => {
    it('should save and retrieve merchant', async () => {
      const merchant = {
        id: 'merchant-db-test',
        name: 'DB Test Merchant',
        settleMint: MOCK_USDC_MINT,
        status: 'active' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await db.saveMerchant(merchant);
      const retrieved = await db.getMerchant(merchant.id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe('DB Test Merchant');
    });
  });

  describe('Policy CRUD', () => {
    it('should save and retrieve policy by hash', async () => {
      const policy = {
        id: 'policy-db-test',
        merchantId: 'merchant-1',
        name: 'DB Test Policy',
        jsonCanonical: '{"test": true}',
        hash: 'test-hash-123',
        version: 1,
        maxSlippageBps: 100,
        maxPriceImpactBps: 300,
        maxHops: 4,
        protectedMode: true,
        createdAt: Date.now(),
      };

      await db.savePolicy(policy);
      const retrieved = await db.getPolicyByHash('test-hash-123');

      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe('DB Test Policy');
    });
  });

  describe('Invoice CRUD', () => {
    it('should save and update invoice', async () => {
      const invoice = {
        id: 'invoice-db-test',
        merchantId: 'merchant-1',
        settleMint: MOCK_USDC_MINT,
        amountOut: '1000000',
        status: 'pending' as const,
        expiresAt: Date.now() + 3600000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await db.saveInvoice(invoice);
      await db.updateInvoice(invoice.id, { status: 'paid', paidAt: Date.now() });

      const retrieved = await db.getInvoice(invoice.id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.status).toBe('paid');
      expect(retrieved!.paidAt).toBeDefined();
    });
  });

  describe('PaymentAttempt CRUD', () => {
    it('should save and retrieve payment attempts', async () => {
      const attempt = {
        invoiceId: 'invoice-db-test',
        attemptNo: 1,
        eventType: 'BUILD' as const,
        mode: 'normal' as const,
        createdAt: Date.now(),
      };

      await db.savePaymentAttempt(attempt);
      const attempts = await db.getPaymentAttempts('invoice-db-test');

      expect(attempts.length).toBeGreaterThan(0);
      expect(attempts[0].eventType).toBe('BUILD');
    });
  });
});
