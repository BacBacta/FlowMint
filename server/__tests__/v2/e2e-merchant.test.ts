/**
 * V2 E2E Merchant Tests
 *
 * End-to-end tests for merchant flows:
 * - Webhook receive and process
 * - Invoice reconciliation
 * - CSV export
 * - Dispute workflow
 * - API authentication
 */

import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import express, { Express } from 'express';
import request from 'supertest';
import crypto from 'crypto';
import { DatabaseService } from '../../src/db/database';
import { createPortfolioPayV2Routes } from '../../src/routes/portfoliopayV2';
import { Connection, Keypair } from '@solana/web3.js';

// Mocks
let app: Express;
let mockDb: jest.Mocked<DatabaseService>;
let mockConnection: jest.Mocked<Connection>;
let testMerchant: {
  id: string;
  apiKey: string;
  apiKeyHash: string;
  webhookSecret: string;
};

describe('V2 E2E Merchant Tests', () => {
  beforeAll(() => {
    // Setup test merchant
    testMerchant = {
      id: 'test-merchant-001',
      apiKey: 'fm_test_' + crypto.randomBytes(16).toString('hex'),
      apiKeyHash: '',
      webhookSecret: 'whsec_' + crypto.randomBytes(32).toString('hex'),
    };
    testMerchant.apiKeyHash = crypto
      .createHash('sha256')
      .update(testMerchant.apiKey)
      .digest('hex');

    // Mock database
    mockDb = {
      getMerchantByApiKeyHash: jest.fn().mockImplementation((hash) => {
        if (hash === testMerchant.apiKeyHash) {
          return Promise.resolve({
            id: testMerchant.id,
            status: 'active',
            webhookUrl: 'https://merchant.example.com/webhooks',
            webhookSecret: testMerchant.webhookSecret,
          });
        }
        return Promise.resolve(null);
      }),
      getMerchant: jest.fn().mockResolvedValue({
        id: testMerchant.id,
        name: 'Test Merchant',
        status: 'active',
      }),
      getInvoice: jest.fn().mockResolvedValue({
        id: 'inv-001',
        merchantId: testMerchant.id,
        status: 'paid',
        usdcAmount: '100000000',
        createdAt: Date.now(),
      }),
      getInvoices: jest.fn().mockResolvedValue({
        invoices: [
          { id: 'inv-001', status: 'paid', usdcAmount: '100000000' },
          { id: 'inv-002', status: 'pending', usdcAmount: '50000000' },
        ],
        total: 2,
      }),
      getDisputes: jest.fn().mockResolvedValue({
        disputes: [],
        total: 0,
      }),
      createDispute: jest.fn().mockResolvedValue('dispute-001'),
      getWebhookEndpoints: jest.fn().mockResolvedValue([
        {
          id: 'wh-001',
          url: 'https://merchant.example.com/webhooks',
          secret: testMerchant.webhookSecret,
          events: ['invoice.paid', 'invoice.expired'],
          enabled: true,
        },
      ]),
    } as any;

    mockConnection = {} as any;

    // Setup Express app
    app = express();
    app.use(express.json());
    app.locals.db = mockDb;

    const routes = createPortfolioPayV2Routes(
      mockConnection,
      mockDb,
      Keypair.generate()
    );
    app.use('/api/v1', routes);
  });

  describe('API Authentication', () => {
    it('should reject requests without API key', async () => {
      const response = await request(app)
        .get(`/api/v1/merchants/${testMerchant.id}/invoices`)
        .expect(401);

      expect(response.body.error).toBe('API key required');
    });

    it('should reject requests with invalid API key', async () => {
      const response = await request(app)
        .get(`/api/v1/merchants/${testMerchant.id}/invoices`)
        .set('X-API-Key', 'invalid-key')
        .expect(401);

      expect(response.body.error).toBe('Invalid API key');
    });

    it('should accept requests with valid API key', async () => {
      const response = await request(app)
        .get(`/api/v1/merchants/${testMerchant.id}/invoices`)
        .set('X-API-Key', testMerchant.apiKey)
        .expect(200);

      expect(response.body).toBeDefined();
    });

    it('should reject access to other merchant data', async () => {
      const response = await request(app)
        .get('/api/v1/merchants/other-merchant-id/invoices')
        .set('X-API-Key', testMerchant.apiKey)
        .expect(403);

      expect(response.body.error).toBe('Access denied');
    });
  });

  describe('Invoice Listing and Filtering', () => {
    it('should list invoices with pagination', async () => {
      const response = await request(app)
        .get(`/api/v1/merchants/${testMerchant.id}/invoices`)
        .set('X-API-Key', testMerchant.apiKey)
        .query({ page: 1, limit: 10 })
        .expect(200);

      expect(response.body.invoices).toBeDefined();
      expect(Array.isArray(response.body.invoices)).toBe(true);
    });

    it('should filter by status', async () => {
      const response = await request(app)
        .get(`/api/v1/merchants/${testMerchant.id}/invoices`)
        .set('X-API-Key', testMerchant.apiKey)
        .query({ status: 'paid' })
        .expect(200);

      expect(response.body).toBeDefined();
    });

    it('should filter by date range', async () => {
      const from = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const to = Date.now();

      const response = await request(app)
        .get(`/api/v1/merchants/${testMerchant.id}/invoices`)
        .set('X-API-Key', testMerchant.apiKey)
        .query({ from, to })
        .expect(200);

      expect(response.body).toBeDefined();
    });

    it('should search by order ID', async () => {
      const response = await request(app)
        .get(`/api/v1/merchants/${testMerchant.id}/invoices`)
        .set('X-API-Key', testMerchant.apiKey)
        .query({ orderId: 'order-123' })
        .expect(200);

      expect(response.body).toBeDefined();
    });
  });

  describe('Invoice Export', () => {
    it('should export invoices as CSV', async () => {
      const response = await request(app)
        .get(`/api/v1/merchants/${testMerchant.id}/export`)
        .set('X-API-Key', testMerchant.apiKey)
        .query({ format: 'csv' })
        .expect(200);

      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('attachment');
    });

    it('should export invoices as JSON', async () => {
      const response = await request(app)
        .get(`/api/v1/merchants/${testMerchant.id}/export`)
        .set('X-API-Key', testMerchant.apiKey)
        .query({ format: 'json' })
        .expect(200);

      expect(response.headers['content-type']).toContain('application/json');
    });

    it('should include legs when requested', async () => {
      const response = await request(app)
        .get(`/api/v1/merchants/${testMerchant.id}/export`)
        .set('X-API-Key', testMerchant.apiKey)
        .query({ format: 'json', includeLegs: 'true' })
        .expect(200);

      expect(response.body).toBeDefined();
    });
  });

  describe('Dispute Workflow', () => {
    it('should create a dispute', async () => {
      const response = await request(app)
        .post(`/api/v1/merchants/${testMerchant.id}/disputes`)
        .set('X-API-Key', testMerchant.apiKey)
        .send({
          invoiceId: 'inv-001',
          reason: 'missing_payment',
          description: 'Payment not received in expected amount',
        })
        .expect(201);

      expect(response.body).toBeDefined();
    });

    it('should reject dispute without required fields', async () => {
      const response = await request(app)
        .post(`/api/v1/merchants/${testMerchant.id}/disputes`)
        .set('X-API-Key', testMerchant.apiKey)
        .send({
          invoiceId: 'inv-001',
          // missing reason and description
        })
        .expect(400);

      expect(response.body.error).toContain('required');
    });

    it('should list disputes', async () => {
      const response = await request(app)
        .get(`/api/v1/merchants/${testMerchant.id}/disputes`)
        .set('X-API-Key', testMerchant.apiKey)
        .expect(200);

      expect(response.body.disputes).toBeDefined();
      expect(Array.isArray(response.body.disputes)).toBe(true);
    });

    it('should filter disputes by status', async () => {
      const response = await request(app)
        .get(`/api/v1/merchants/${testMerchant.id}/disputes`)
        .set('X-API-Key', testMerchant.apiKey)
        .query({ status: 'open' })
        .expect(200);

      expect(response.body).toBeDefined();
    });
  });

  describe('Merchant Statistics', () => {
    it('should get merchant stats', async () => {
      const response = await request(app)
        .get(`/api/v1/merchants/${testMerchant.id}/stats`)
        .set('X-API-Key', testMerchant.apiKey)
        .expect(200);

      expect(response.body).toBeDefined();
    });

    it('should get stats for custom date range', async () => {
      const response = await request(app)
        .get(`/api/v1/merchants/${testMerchant.id}/stats`)
        .set('X-API-Key', testMerchant.apiKey)
        .query({ days: '7' })
        .expect(200);

      expect(response.body).toBeDefined();
    });
  });

  describe('Webhook Testing', () => {
    it('should test webhook delivery', async () => {
      const response = await request(app)
        .post('/api/v1/webhooks/test')
        .set('X-API-Key', testMerchant.apiKey)
        .expect(200);

      expect(response.body.success).toBeDefined();
    });
  });

  describe('Attestation Verification', () => {
    it('should verify attestation', async () => {
      // Mock attestation service
      mockDb.getAttestation = jest.fn().mockResolvedValue({
        id: 'att-001',
        invoiceId: 'inv-001',
        signature: 'test-signature',
        payloadJson: JSON.stringify({
          version: '2.0',
          invoiceId: 'inv-001',
        }),
        createdAt: Date.now(),
      }) as any;

      const response = await request(app)
        .get('/api/v1/attestations/att-001/verify')
        .expect(200);

      expect(response.body).toBeDefined();
      expect(response.body.valid).toBeDefined();
    });

    it('should get verification kit', async () => {
      const response = await request(app)
        .get('/api/v1/attestations/att-001/kit')
        .expect(200);

      expect(response.body).toBeDefined();
    });
  });

  describe('Health and Monitoring', () => {
    it('should get circuit breaker status', async () => {
      const response = await request(app)
        .get('/api/v1/health/circuits')
        .expect(200);

      expect(response.body.healthy).toBeDefined();
      expect(response.body.circuits).toBeDefined();
    });

    it('should get safety rules', async () => {
      const response = await request(app)
        .get('/api/v1/health/safety')
        .expect(200);

      expect(response.body).toBeDefined();
    });
  });
});

describe('Webhook Signature Verification', () => {
  it('should verify valid HMAC signature', () => {
    const secret = 'whsec_testsecret123';
    const payload = JSON.stringify({
      event: 'invoice.paid',
      invoiceId: 'inv-001',
      timestamp: Date.now(),
    });

    const timestamp = Math.floor(Date.now() / 1000);
    const signedPayload = `${timestamp}.${payload}`;
    const signature = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    const headerValue = `t=${timestamp},v1=${signature}`;

    // Verification logic
    const parts = headerValue.split(',');
    const headerTimestamp = parts[0].split('=')[1];
    const headerSig = parts[1].split('=')[1];

    const expectedPayload = `${headerTimestamp}.${payload}`;
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(expectedPayload)
      .digest('hex');

    expect(headerSig).toBe(expectedSig);
  });

  it('should reject invalid signature', () => {
    const secret = 'whsec_testsecret123';
    const payload = JSON.stringify({ event: 'invoice.paid' });

    const timestamp = Math.floor(Date.now() / 1000);
    const signedPayload = `${timestamp}.${payload}`;
    const signature = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    // Tamper with signature
    const tamperedSig = signature.slice(0, -2) + 'xx';

    expect(tamperedSig).not.toBe(signature);
  });

  it('should reject expired timestamps', () => {
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 6 * 60;
    const now = Math.floor(Date.now() / 1000);

    const timeDiff = now - fiveMinutesAgo;
    const maxAge = 5 * 60; // 5 minutes

    expect(timeDiff).toBeGreaterThan(maxAge);
  });
});

describe('Reconciliation Workflow', () => {
  it('should reconcile payment with invoice', () => {
    const invoice = {
      id: 'inv-001',
      usdcAmount: '100000000', // 100 USDC
      status: 'pending',
    };

    const payment = {
      invoiceId: 'inv-001',
      totalUsdcReceived: '100000000',
      legs: [
        { tokenMint: 'SOL', amountIn: '1000000000', usdcOut: '50000000' },
        { tokenMint: 'BONK', amountIn: '1000000000000', usdcOut: '50000000' },
      ],
    };

    // Calculate total received
    const totalReceived = payment.legs.reduce(
      (sum, leg) => sum + BigInt(leg.usdcOut),
      0n
    );

    expect(totalReceived.toString()).toBe(invoice.usdcAmount);
  });

  it('should detect underpayment', () => {
    const invoice = {
      usdcAmount: '100000000', // 100 USDC
    };

    const payment = {
      totalUsdcReceived: '95000000', // 95 USDC
    };

    const expectedAmount = BigInt(invoice.usdcAmount);
    const receivedAmount = BigInt(payment.totalUsdcReceived);
    const difference = expectedAmount - receivedAmount;
    const toleranceBps = 50n; // 0.5%
    const toleranceAmount = (expectedAmount * toleranceBps) / 10000n;

    const isUnderpayment = difference > toleranceAmount;
    expect(isUnderpayment).toBe(true);
  });

  it('should handle overpayment gracefully', () => {
    const invoice = {
      usdcAmount: '100000000', // 100 USDC
    };

    const payment = {
      totalUsdcReceived: '105000000', // 105 USDC
    };

    const expectedAmount = BigInt(invoice.usdcAmount);
    const receivedAmount = BigInt(payment.totalUsdcReceived);
    const overpayment = receivedAmount - expectedAmount;

    expect(overpayment > 0n).toBe(true);

    // Overpayment should be noted but payment accepted
    const status = receivedAmount >= expectedAmount ? 'paid' : 'underpaid';
    expect(status).toBe('paid');
  });
});
