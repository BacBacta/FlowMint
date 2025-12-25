/**
 * Health Check Routes
 */

import { Router, Request, Response as ExpressResponse } from 'express';
import { Connection } from '@solana/web3.js';

import { config } from '../../config/index.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    // Don't keep the process alive just for timeouts.
    (t as any)?.unref?.();
  });
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<globalThis.Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  (t as any)?.unref?.();
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: any;
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
    (timeout as any)?.unref?.();
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Create health check routes
 */
export function createHealthRoutes(): Router {
  const router = Router();

  /**
   * Basic health check
   */
  router.get('/', (_req: Request, res: ExpressResponse) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
    });
  });

  /**
   * Detailed health check
   */
  router.get('/detailed', async (_req: Request, res: ExpressResponse) => {
    const checks: Record<string, { status: string; latency?: number; error?: string }> = {};
    const externalTimeoutMs = 2500;

    // Check Solana RPC
    try {
      const start = Date.now();
      const connection = new Connection(config.solana.rpcUrl);
      await withTimeout(connection.getSlot(), externalTimeoutMs, 'solana');
      checks.solana = {
        status: 'ok',
        latency: Date.now() - start,
      };
    } catch (error) {
      checks.solana = {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    // Check Jupiter API
    try {
      const start = Date.now();
      const response = await fetchWithTimeout(
        `${config.jupiter.apiUrl}/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000&slippageBps=50`,
        externalTimeoutMs
      );
      if (response.ok) {
        checks.jupiter = {
          status: 'ok',
          latency: Date.now() - start,
        };
      } else {
        checks.jupiter = {
          status: 'degraded',
          error: `HTTP ${response.status}`,
        };
      }
    } catch (error) {
      checks.jupiter = {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    // Check Pyth
    try {
      const start = Date.now();
      const response = await fetchWithTimeout(
        `${config.pyth.endpoint}/api/latest_price_feeds?ids[]=0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43`,
        externalTimeoutMs
      );
      if (response.ok) {
        checks.pyth = {
          status: 'ok',
          latency: Date.now() - start,
        };
      } else {
        checks.pyth = {
          status: 'degraded',
          error: `HTTP ${response.status}`,
        };
      }
    } catch (error) {
      checks.pyth = {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    const overallStatus = Object.values(checks).every((c) => c.status === 'ok')
      ? 'ok'
      : Object.values(checks).some((c) => c.status === 'error')
        ? 'error'
        : 'degraded';

    res.status(overallStatus === 'ok' ? 200 : overallStatus === 'degraded' ? 200 : 503).json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks,
      config: {
        network: config.solana.network,
        environment: config.nodeEnv,
      },
    });
  });

  return router;
}
