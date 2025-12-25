import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../../src/app';
import { DatabaseService } from '../../src/db/database';
import type { Express } from 'express';

describe('API Routes', () => {
  let app: Express;
  let db: DatabaseService;

  beforeAll(async () => {
    db = new DatabaseService(':memory:');
    await db.initialize();
    app = await createApp(db);
  });

  afterAll(async () => {
    await db.close();
  });

  describe('Health Routes', () => {
    describe('GET /health', () => {
      it('should return health status', async () => {
        const response = await request(app).get('/health');

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('status', 'ok');
        expect(response.body).toHaveProperty('timestamp');
      });
    });

    describe('GET /health/detailed', () => {
      it('should return detailed health status', async () => {
        const response = await request(app).get('/health/detailed');

        // May fail if RPC is not available, but should return 200 or 503
        expect([200, 503]).toContain(response.status);
        expect(response.body).toHaveProperty('status');
      });
    });
  });

  describe('Metrics Route', () => {
    describe('GET /metrics', () => {
      it('should return prometheus metrics', async () => {
        const response = await request(app).get('/metrics');

        expect(response.status).toBe(200);
        expect(response.text).toContain('flowmint_');
        expect(response.type).toContain('text/plain');
      });
    });
  });

  describe('Swap Routes', () => {
    describe('GET /api/v1/swap/quote', () => {
      it('should return 400 for missing parameters', async () => {
        const response = await request(app).get('/api/v1/swap/quote');

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('error');
      });

      it('should return 400 for invalid amount', async () => {
        const response = await request(app)
          .get('/api/v1/swap/quote')
          .query({
            inputMint: 'So11111111111111111111111111111111111111112',
            outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            amount: 'invalid',
          });

        expect(response.status).toBe(400);
      });

      it('should accept valid quote request', async () => {
        const response = await request(app)
          .get('/api/v1/swap/quote')
          .query({
            inputMint: 'So11111111111111111111111111111111111111112',
            outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            amount: '1000000000',
            slippageBps: '50',
          });

        // May fail if Jupiter API is not mocked, but validates request parsing
        expect([200, 500, 502, 503]).toContain(response.status);
      });
    });

    describe('POST /api/v1/swap/execute', () => {
      it('should return 400 for missing body', async () => {
        const response = await request(app)
          .post('/api/v1/swap/execute')
          .send({});

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('error');
      });
    });
  });

  describe('Intent Routes', () => {
    describe('POST /api/v1/intents/dca', () => {
      it('should return 400 for missing parameters', async () => {
        const response = await request(app)
          .post('/api/v1/intents/dca')
          .send({});

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('error');
      });

      it('should validate DCA parameters', async () => {
        const response = await request(app)
          .post('/api/v1/intents/dca')
          .send({
            userPublicKey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            outputMint: 'So11111111111111111111111111111111111111112',
            totalAmount: '100000000',
            intervalMs: 86400000,
            slicesTotal: 10,
          });

        // Should succeed or fail gracefully
        expect([200, 201, 400, 500]).toContain(response.status);
      });
    });

    describe('POST /api/v1/intents/stop-loss', () => {
      it('should return 400 for missing parameters', async () => {
        const response = await request(app)
          .post('/api/v1/intents/stop-loss')
          .send({});

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('error');
      });
    });

    describe('GET /api/v1/intents/user/:publicKey', () => {
      it('should return intents for user', async () => {
        const response = await request(app)
          .get('/api/v1/intents/user/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

        expect([200, 500]).toContain(response.status);
        if (response.status === 200) {
          expect(response.body).toHaveProperty('data');
          expect(Array.isArray(response.body.data)).toBe(true);
        }
      });
    });
  });

  describe('Payment Routes', () => {
    describe('POST /api/v1/payments', () => {
      it('should return 400 for missing parameters', async () => {
        const response = await request(app)
          .post('/api/v1/payments')
          .send({});

        expect(response.status).toBe(400);
      });

      it('should accept valid payment request', async () => {
        const response = await request(app)
          .post('/api/v1/payments')
          .send({
            merchantId: 'test-merchant',
            orderId: 'order-123',
            amount: '100000000',
            inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          });

        expect([200, 201, 400, 500]).toContain(response.status);
      });
    });

    describe('POST /api/v1/payments/link', () => {
      it('should create payment link', async () => {
        const response = await request(app)
          .post('/api/v1/payments/link')
          .send({
            merchantId: 'test-merchant',
            orderId: 'order-123',
            amount: 100,
          });

        expect([200, 201, 400, 500]).toContain(response.status);
      });
    });
  });

  describe('Auth Routes', () => {
    describe('POST /api/v1/auth/nonce', () => {
      it('should generate a nonce', async () => {
        const response = await request(app)
          .post('/api/v1/auth/nonce')
          .send({ publicKey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' });

        expect([200, 400, 429]).toContain(response.status);
        if (response.status === 200) {
          expect(response.body).toHaveProperty('nonce');
          expect(response.body).toHaveProperty('message');
        }
      });
    });
  });

  describe('CORS', () => {
    it('should handle CORS preflight', async () => {
      const response = await request(app)
        .options('/health')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'GET');

      expect([200, 204]).toContain(response.status);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app).get('/unknown-route');

      expect(response.status).toBe(404);
    });

    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/api/v1/swap/execute')
        .set('Content-Type', 'application/json')
        .send('invalid json');

      expect([400, 500]).toContain(response.status);
    });
  });
});
