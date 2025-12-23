/**
 * Authentication Routes
 *
 * Handles wallet-based authentication flow:
 * 1. Client requests a nonce
 * 2. Client signs message with wallet
 * 3. Server verifies signature and issues JWT
 */

import { Router, Request, Response } from 'express';

import {
  generateNonce,
  createAuthMessage,
  verifyWalletSignature,
  generateToken,
  verifyToken,
  authRateLimit,
  AuthenticatedRequest,
  requireAuth,
} from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ service: 'AuthRoutes' });

// Store pending authentication nonces
const pendingNonces = new Map<string, { nonce: string; timestamp: number; expiresAt: number }>();

// Clean up expired nonces periodically
setInterval(() => {
  const now = Date.now();
  for (const [publicKey, data] of pendingNonces.entries()) {
    if (now > data.expiresAt) {
      pendingNonces.delete(publicKey);
    }
  }
}, 60000);

export function createAuthRoutes(): Router {
  const router = Router();

  /**
   * Request authentication nonce
   * POST /auth/nonce
   */
  router.post('/nonce', authRateLimit(10, 60000), (req: Request, res: Response) => {
    const { publicKey } = req.body;

    if (!publicKey || typeof publicKey !== 'string') {
      res.status(400).json({
        error: 'Invalid request',
        message: 'publicKey is required',
      });
      return;
    }

    // Validate public key format (base58, 32-44 chars)
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(publicKey)) {
      res.status(400).json({
        error: 'Invalid public key',
        message: 'Public key must be a valid base58 Solana address',
      });
      return;
    }

    const nonce = generateNonce();
    const timestamp = Date.now();
    const expiresAt = timestamp + 5 * 60 * 1000; // 5 minutes

    pendingNonces.set(publicKey, { nonce, timestamp, expiresAt });

    const message = createAuthMessage(nonce, timestamp);

    log.debug({ publicKey }, 'Nonce generated for authentication');

    res.json({
      nonce,
      message,
      timestamp,
      expiresAt,
    });
  });

  /**
   * Verify signature and issue JWT
   * POST /auth/verify
   */
  router.post('/verify', authRateLimit(5, 60000), (req: Request, res: Response) => {
    const { publicKey, signature } = req.body;

    if (!publicKey || !signature) {
      res.status(400).json({
        error: 'Invalid request',
        message: 'publicKey and signature are required',
      });
      return;
    }

    // Get pending nonce
    const pending = pendingNonces.get(publicKey);

    if (!pending) {
      res.status(400).json({
        error: 'No pending authentication',
        message: 'Please request a nonce first',
      });
      return;
    }

    // Check if nonce expired
    if (Date.now() > pending.expiresAt) {
      pendingNonces.delete(publicKey);
      res.status(400).json({
        error: 'Nonce expired',
        message: 'Please request a new nonce',
      });
      return;
    }

    // Reconstruct the message that was signed
    const message = createAuthMessage(pending.nonce, pending.timestamp);

    // Verify signature
    const isValid = verifyWalletSignature(message, signature, publicKey);

    if (!isValid) {
      log.warn({ publicKey }, 'Invalid signature provided');
      res.status(401).json({
        error: 'Invalid signature',
        message: 'The signature could not be verified',
      });
      return;
    }

    // Clean up used nonce
    pendingNonces.delete(publicKey);

    // Generate JWT
    const token = generateToken(publicKey);

    log.info({ publicKey }, 'User authenticated successfully');

    res.json({
      token,
      publicKey,
      expiresIn: '24h',
    });
  });

  /**
   * Verify current token
   * GET /auth/me
   */
  router.get('/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    res.json({
      authenticated: true,
      publicKey: req.user?.publicKey,
    });
  });

  /**
   * Refresh token
   * POST /auth/refresh
   */
  router.post('/refresh', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const token = generateToken(req.user.publicKey);

    res.json({
      token,
      publicKey: req.user.publicKey,
      expiresIn: '24h',
    });
  });

  /**
   * Logout (client-side only, but useful for logging)
   * POST /auth/logout
   */
  router.post('/logout', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    log.info({ publicKey: req.user?.publicKey }, 'User logged out');
    res.json({ success: true });
  });

  return router;
}
