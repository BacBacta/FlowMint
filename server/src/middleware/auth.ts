/**
 * Authentication Middleware
 *
 * Provides JWT authentication and wallet signature verification.
 * Supports both session-based and stateless authentication.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ service: 'AuthMiddleware' });

/**
 * JWT Payload structure
 */
export interface JwtPayload {
  publicKey: string;
  iat: number;
  exp: number;
}

/**
 * Extended Request with authenticated user
 */
export interface AuthenticatedRequest extends Request {
  user?: {
    publicKey: string;
  };
}

/**
 * Generate a nonce for wallet signature
 */
export function generateNonce(): string {
  const nonce = nacl.randomBytes(32);
  return bs58.encode(nonce);
}

/**
 * Create authentication message for wallet signing
 */
export function createAuthMessage(nonce: string, timestamp: number): string {
  return `FlowMint Authentication\n\nNonce: ${nonce}\nTimestamp: ${timestamp}\n\nSign this message to authenticate with FlowMint. This will not trigger a blockchain transaction.`;
}

/**
 * Verify wallet signature
 */
export function verifyWalletSignature(
  message: string,
  signature: string,
  publicKey: string
): boolean {
  try {
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = bs58.decode(signature);
    const publicKeyBytes = bs58.decode(publicKey);

    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
  } catch (error) {
    log.error({ error, publicKey }, 'Signature verification failed');
    return false;
  }
}

/**
 * Generate JWT token for authenticated user
 */
export function generateToken(publicKey: string): string {
  const payload: Omit<JwtPayload, 'iat' | 'exp'> = { publicKey };
  
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: '24h',
    issuer: 'flowmint',
    audience: 'flowmint-api',
  });
}

/**
 * Verify and decode JWT token
 */
export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret, {
      issuer: 'flowmint',
      audience: 'flowmint-api',
    }) as JwtPayload;
    
    return decoded;
  } catch (error) {
    return null;
  }
}

/**
 * Extract token from Authorization header
 */
function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) return null;
  
  // Support both "Bearer token" and just "token"
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  return authHeader;
}

/**
 * Authentication middleware - requires valid JWT
 */
export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const token = extractToken(req);
  
  if (!token) {
    res.status(401).json({
      error: 'Authentication required',
      message: 'Please provide a valid authentication token',
    });
    return;
  }
  
  const payload = verifyToken(token);
  
  if (!payload) {
    res.status(401).json({
      error: 'Invalid token',
      message: 'The authentication token is invalid or expired',
    });
    return;
  }
  
  req.user = { publicKey: payload.publicKey };
  next();
}

/**
 * Optional authentication middleware - attaches user if token present
 */
export function optionalAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  const token = extractToken(req);
  
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      req.user = { publicKey: payload.publicKey };
    }
  }
  
  next();
}

/**
 * Verify request is from the specified wallet owner
 */
export function requireOwnership(paramName: string = 'userPublicKey') {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'Please authenticate to access this resource',
      });
      return;
    }

    const resourceOwner = req.params[paramName] || req.body[paramName];
    
    if (!resourceOwner) {
      res.status(400).json({
        error: 'Missing parameter',
        message: `Parameter '${paramName}' is required`,
      });
      return;
    }

    if (req.user.publicKey !== resourceOwner) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have permission to access this resource',
      });
      return;
    }

    next();
  };
}

/**
 * Rate limiter for authentication endpoints
 */
const authAttempts = new Map<string, { count: number; resetAt: number }>();

export function authRateLimit(maxAttempts: number = 5, windowMs: number = 60000) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    
    const attempt = authAttempts.get(ip);
    
    if (attempt) {
      if (now > attempt.resetAt) {
        // Window expired, reset
        authAttempts.set(ip, { count: 1, resetAt: now + windowMs });
      } else if (attempt.count >= maxAttempts) {
        res.status(429).json({
          error: 'Too many attempts',
          message: 'Please wait before trying again',
          retryAfter: Math.ceil((attempt.resetAt - now) / 1000),
        });
        return;
      } else {
        attempt.count++;
      }
    } else {
      authAttempts.set(ip, { count: 1, resetAt: now + windowMs });
    }
    
    next();
  };
}

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, attempt] of authAttempts.entries()) {
    if (now > attempt.resetAt) {
      authAttempts.delete(ip);
    }
  }
}, 60000);

export default {
  generateNonce,
  createAuthMessage,
  verifyWalletSignature,
  generateToken,
  verifyToken,
  requireAuth,
  optionalAuth,
  requireOwnership,
  authRateLimit,
};
