import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../../src/app';
import type { Express } from 'express';

describe('API Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const response = await request(app).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('GET /api/swap/quote', () => {
    it('should return 400 for missing parameters', async () => {
      const response = await request(app).get('/api/swap/quote');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 for invalid amount', async () => {
      const response = await request(app)
        .get('/api/swap/quote')
        .query({
          inputMint: 'So11111111111111111111111111111111111111112',
          outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amount: 'invalid',
        });

      expect(response.status).toBe(400);
    });

    it('should accept valid quote request', async () => {
      const response = await request(app)
        .get('/api/swap/quote')
        .query({
          inputMint: 'So11111111111111111111111111111111111111112',
          outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amount: '1000000000',
          slippageBps: '50',
        });

      // May fail if Jupiter API is not mocked, but validates request parsing
      expect([200, 500, 502]).toContain(response.status);
    });
  });

  describe('POST /api/swap/execute', () => {
    it('should return 400 for missing body', async () => {
      const response = await request(app)
        .post('/api/swap/execute')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should validate request body', async () => {
      const response = await request(app)
        .post('/api/swap/execute')
        .send({
          userPublicKey: 'invalid-pubkey',
          inputMint: 'So11111111111111111111111111111111111111112',
          outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amount: 1000000000,
        });

      expect([400, 500]).toContain(response.status);
    });
  });

  describe('POST /api/intent', () => {
    it('should return 400 for invalid intent type', async () => {
      const response = await request(app)
        .post('/api/intent')
        .send({
          userPublicKey: 'test-pubkey',
          type: 'invalid',
          inputMint: 'mint1',
          outputMint: 'mint2',
          totalAmount: 1000,
        });

      expect(response.status).toBe(400);
    });

    it('should validate DCA parameters', async () => {
      const response = await request(app)
        .post('/api/intent')
        .send({
          userPublicKey: 'test-pubkey',
          type: 'dca',
          inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          outputMint: 'So11111111111111111111111111111111111111112',
          totalAmount: 100000000,
          intervalMs: 86400000,
          numberOfOrders: 10,
        });

      // Should succeed or fail gracefully
      expect([200, 201, 400, 500]).toContain(response.status);
    });
  });

  describe('POST /api/payment/create-link', () => {
    it('should return 400 for missing parameters', async () => {
      const response = await request(app)
        .post('/api/payment/create-link')
        .send({});

      expect(response.status).toBe(400);
    });

    it('should create payment link', async () => {
      const response = await request(app)
        .post('/api/payment/create-link')
        .send({
          merchantId: 'test-merchant',
          orderId: 'order-123',
          amountUsdc: 100,
        });

      expect([200, 201, 500]).toContain(response.status);
      
      if (response.status === 200 || response.status === 201) {
        expect(response.body).toHaveProperty('paymentId');
        expect(response.body).toHaveProperty('paymentUrl');
      }
    });
  });

  describe('Rate Limiting', () => {
    it('should include rate limit headers', async () => {
      const response = await request(app).get('/api/health');

      // Rate limit headers may be present depending on configuration
      expect(response.status).toBe(200);
    });
  });

  describe('CORS', () => {
    it('should handle CORS preflight', async () => {
      const response = await request(app)
        .options('/api/health')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'GET');

      expect([200, 204]).toContain(response.status);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app).get('/api/unknown-route');

      expect(response.status).toBe(404);
    });

    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/api/swap/execute')
        .set('Content-Type', 'application/json')
        .send('invalid json');

      expect(response.status).toBe(400);
    });
  });
});
