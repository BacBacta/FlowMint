/**
 * Authentication Middleware Tests
 *
 * Unit tests for JWT authentication and wallet signature verification.
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';

// Mock config
jest.mock('../config/index.js', () => ({
  config: {
    jwtSecret: 'test-secret-key-for-testing-only',
    nodeEnv: 'test',
  },
}));

// Mock logger
jest.mock('../utils/logger.js', () => ({
  logger: {
    child: () => ({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

describe('Authentication Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('generateNonce', () => {
    it('should generate a random base58 encoded nonce', async () => {
      const { generateNonce } = await import('../middleware/auth.js');

      const nonce1 = generateNonce();
      const nonce2 = generateNonce();

      expect(nonce1).toBeDefined();
      expect(typeof nonce1).toBe('string');
      expect(nonce1.length).toBeGreaterThan(20);
      expect(nonce1).not.toBe(nonce2); // Should be unique
    });
  });

  describe('createAuthMessage', () => {
    it('should create a formatted authentication message', async () => {
      const { createAuthMessage } = await import('../middleware/auth.js');

      const nonce = 'test-nonce-123';
      const timestamp = 1703340000000;

      const message = createAuthMessage(nonce, timestamp);

      expect(message).toContain('FlowMint Authentication');
      expect(message).toContain(nonce);
      expect(message).toContain(String(timestamp));
      expect(message).toContain('Sign this message to authenticate');
    });
  });

  describe('generateToken & verifyToken', () => {
    it('should generate a valid JWT token', async () => {
      const { generateToken, verifyToken } = await import('../middleware/auth.js');

      const publicKey = 'test-public-key-abc123';
      const token = generateToken(publicKey);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT format

      const decoded = verifyToken(token);
      expect(decoded).not.toBeNull();
      expect(decoded?.publicKey).toBe(publicKey);
    });

    it('should reject invalid token', async () => {
      const { verifyToken } = await import('../middleware/auth.js');

      const invalidToken = 'not.a.valid.token';
      const decoded = verifyToken(invalidToken);

      expect(decoded).toBeNull();
    });

    it('should reject tampered token', async () => {
      const { generateToken, verifyToken } = await import('../middleware/auth.js');

      const token = generateToken('original-user');
      const tamperedToken = token.slice(0, -5) + 'xxxxx';

      const decoded = verifyToken(tamperedToken);

      expect(decoded).toBeNull();
    });
  });

  describe('requireAuth middleware', () => {
    it('should pass with valid token', async () => {
      const { requireAuth, generateToken, AuthenticatedRequest } =
        await import('../middleware/auth.js');

      const token = generateToken('user-123');

      const req = {
        headers: { authorization: `Bearer ${token}` },
      } as unknown as AuthenticatedRequest;

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;

      const next = jest.fn() as NextFunction;

      requireAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user?.publicKey).toBe('user-123');
    });

    it('should reject request without token', async () => {
      const { requireAuth, AuthenticatedRequest } = await import('../middleware/auth.js');

      const req = {
        headers: {},
      } as AuthenticatedRequest;

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;

      const next = jest.fn() as NextFunction;

      requireAuth(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
    });

    it('should reject request with invalid token', async () => {
      const { requireAuth, AuthenticatedRequest } = await import('../middleware/auth.js');

      const req = {
        headers: { authorization: 'Bearer invalid-token' },
      } as AuthenticatedRequest;

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;

      const next = jest.fn() as NextFunction;

      requireAuth(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('optionalAuth middleware', () => {
    it('should attach user if valid token provided', async () => {
      const { optionalAuth, generateToken, AuthenticatedRequest } =
        await import('../middleware/auth.js');

      const token = generateToken('user-456');

      const req = {
        headers: { authorization: `Bearer ${token}` },
      } as unknown as AuthenticatedRequest;

      const res = {} as Response;
      const next = jest.fn() as NextFunction;

      optionalAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user?.publicKey).toBe('user-456');
    });

    it('should continue without user if no token', async () => {
      const { optionalAuth, AuthenticatedRequest } = await import('../middleware/auth.js');

      const req = {
        headers: {},
      } as AuthenticatedRequest;

      const res = {} as Response;
      const next = jest.fn() as NextFunction;

      optionalAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeUndefined();
    });
  });

  describe('requireOwnership middleware', () => {
    it('should allow access when user matches resource owner', async () => {
      const { requireOwnership, generateToken, AuthenticatedRequest } =
        await import('../middleware/auth.js');

      const publicKey = 'owner-user-789';

      const req = {
        user: { publicKey },
        params: { userPublicKey: publicKey },
        body: {},
      } as unknown as AuthenticatedRequest;

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;

      const next = jest.fn() as NextFunction;

      const middleware = requireOwnership('userPublicKey');
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should reject when user does not match resource owner', async () => {
      const { requireOwnership, AuthenticatedRequest } = await import('../middleware/auth.js');

      const req = {
        user: { publicKey: 'different-user' },
        params: { userPublicKey: 'resource-owner' },
        body: {},
      } as unknown as AuthenticatedRequest;

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;

      const next = jest.fn() as NextFunction;

      const middleware = requireOwnership('userPublicKey');
      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('authRateLimit middleware', () => {
    it('should allow requests within limit', async () => {
      const { authRateLimit } = await import('../middleware/auth.js');

      const req = {
        ip: '192.168.1.100',
        socket: { remoteAddress: '192.168.1.100' },
      } as Request;

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;

      const next = jest.fn() as NextFunction;

      const middleware = authRateLimit(5, 60000);

      // First request should pass
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should block requests exceeding limit', async () => {
      const { authRateLimit } = await import('../middleware/auth.js');

      const req = {
        ip: '10.0.0.1', // Different IP to avoid pollution from other tests
        socket: { remoteAddress: '10.0.0.1' },
      } as Request;

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;

      const middleware = authRateLimit(2, 60000);

      // First two should pass
      middleware(req, res, jest.fn());
      middleware(req, res, jest.fn());

      // Third should be blocked
      const next = jest.fn() as NextFunction;
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
    });
  });
});
