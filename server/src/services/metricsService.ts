/**
 * Metrics Service
 *
 * Provides Prometheus metrics for monitoring swap/payment/intent execution.
 * Exposes counters, histograms, and gauges for observability.
 */

import {
  Counter,
  Histogram,
  Gauge,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

import { logger } from '../utils/logger.js';

const log = logger.child({ service: 'Metrics' });

/**
 * Risk levels for tracking
 */
export type RiskLevel = 'GREEN' | 'AMBER' | 'RED';

/**
 * Execution profile types
 */
export type ExecutionProfile = 'AUTO' | 'FAST' | 'CHEAP';

/**
 * Operation types for metrics
 */
export type OperationType = 'swap' | 'payment' | 'dca' | 'stop_loss';

/**
 * Metrics Service class
 */
export class MetricsService {
  private readonly registry: Registry;

  // Counters
  private readonly operationsTotal: Counter<string>;
  private readonly operationsSuccess: Counter<string>;
  private readonly operationsFailed: Counter<string>;
  private readonly requotesTotal: Counter<string>;
  private readonly retriesTotal: Counter<string>;
  private readonly riskBlockedTotal: Counter<string>;

  // Histograms
  private readonly operationDuration: Histogram<string>;
  private readonly confirmationDuration: Histogram<string>;
  private readonly quoteLatency: Histogram<string>;

  // Gauges
  private readonly activeIntents: Gauge<string>;
  private readonly pendingJobs: Gauge<string>;

  constructor() {
    this.registry = new Registry();

    // Collect default Node.js metrics (CPU, memory, event loop, etc.)
    collectDefaultMetrics({ register: this.registry });

    // ==========================================================================
    // Counters
    // ==========================================================================

    this.operationsTotal = new Counter({
      name: 'flowmint_operations_total',
      help: 'Total number of operations (swaps, payments, intents)',
      labelNames: ['type', 'profile'],
      registers: [this.registry],
    });

    this.operationsSuccess = new Counter({
      name: 'flowmint_operations_success_total',
      help: 'Total number of successful operations',
      labelNames: ['type', 'profile'],
      registers: [this.registry],
    });

    this.operationsFailed = new Counter({
      name: 'flowmint_operations_failed_total',
      help: 'Total number of failed operations',
      labelNames: ['type', 'profile', 'error_code'],
      registers: [this.registry],
    });

    this.requotesTotal = new Counter({
      name: 'flowmint_requotes_total',
      help: 'Total number of re-quotes during execution',
      labelNames: ['type'],
      registers: [this.registry],
    });

    this.retriesTotal = new Counter({
      name: 'flowmint_retries_total',
      help: 'Total number of transaction retries',
      labelNames: ['type', 'reason'],
      registers: [this.registry],
    });

    this.riskBlockedTotal = new Counter({
      name: 'flowmint_risk_blocked_total',
      help: 'Total number of operations blocked by risk gating',
      labelNames: ['type', 'risk_level', 'reason'],
      registers: [this.registry],
    });

    // ==========================================================================
    // Histograms
    // ==========================================================================

    this.operationDuration = new Histogram({
      name: 'flowmint_operation_duration_seconds',
      help: 'Duration of operations from start to completion',
      labelNames: ['type', 'profile', 'status'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120],
      registers: [this.registry],
    });

    this.confirmationDuration = new Histogram({
      name: 'flowmint_confirmation_duration_seconds',
      help: 'Duration from transaction send to confirmation',
      labelNames: ['type'],
      buckets: [0.5, 1, 2, 5, 10, 20, 30, 45, 60],
      registers: [this.registry],
    });

    this.quoteLatency = new Histogram({
      name: 'flowmint_quote_latency_seconds',
      help: 'Latency of Jupiter quote API calls',
      labelNames: ['mode'],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    // ==========================================================================
    // Gauges
    // ==========================================================================

    this.activeIntents = new Gauge({
      name: 'flowmint_active_intents',
      help: 'Number of active intents (DCA, stop-loss)',
      labelNames: ['type'],
      registers: [this.registry],
    });

    this.pendingJobs = new Gauge({
      name: 'flowmint_pending_jobs',
      help: 'Number of pending jobs in the scheduler',
      labelNames: ['type'],
      registers: [this.registry],
    });

    log.info('MetricsService initialized');
  }

  /**
   * Get the Prometheus registry
   */
  getRegistry(): Registry {
    return this.registry;
  }

  /**
   * Get metrics in Prometheus format
   */
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  /**
   * Get content type for metrics endpoint
   */
  getContentType(): string {
    return this.registry.contentType;
  }

  // ==========================================================================
  // Operation Tracking
  // ==========================================================================

  /**
   * Record operation start
   */
  recordOperationStart(type: OperationType, profile: ExecutionProfile = 'AUTO'): () => void {
    this.operationsTotal.inc({ type, profile });
    const startTime = Date.now();

    return () => {
      const duration = (Date.now() - startTime) / 1000;
      return duration;
    };
  }

  /**
   * Record successful operation
   */
  recordOperationSuccess(
    type: OperationType,
    profile: ExecutionProfile,
    durationSeconds: number
  ): void {
    this.operationsSuccess.inc({ type, profile });
    this.operationDuration.observe({ type, profile, status: 'success' }, durationSeconds);
    log.debug({ type, profile, durationSeconds }, 'Operation succeeded');
  }

  /**
   * Record failed operation
   */
  recordOperationFailure(
    type: OperationType,
    profile: ExecutionProfile,
    durationSeconds: number,
    errorCode: string = 'unknown'
  ): void {
    this.operationsFailed.inc({ type, profile, error_code: errorCode });
    this.operationDuration.observe({ type, profile, status: 'failed' }, durationSeconds);
    log.debug({ type, profile, durationSeconds, errorCode }, 'Operation failed');
  }

  // ==========================================================================
  // Quote & Execution Tracking
  // ==========================================================================

  /**
   * Record a re-quote event
   */
  recordRequote(type: OperationType): void {
    this.requotesTotal.inc({ type });
  }

  /**
   * Record a retry event
   */
  recordRetry(type: OperationType, reason: string): void {
    this.retriesTotal.inc({ type, reason });
  }

  /**
   * Record confirmation duration
   */
  recordConfirmationDuration(type: OperationType, durationSeconds: number): void {
    this.confirmationDuration.observe({ type }, durationSeconds);
  }

  /**
   * Record quote latency
   */
  recordQuoteLatency(mode: 'ExactIn' | 'ExactOut', durationSeconds: number): void {
    this.quoteLatency.observe({ mode }, durationSeconds);
  }

  // ==========================================================================
  // Risk Gating
  // ==========================================================================

  /**
   * Record a blocked operation due to risk gating
   */
  recordRiskBlocked(
    type: OperationType,
    riskLevel: RiskLevel,
    reason: string
  ): void {
    this.riskBlockedTotal.inc({ type, risk_level: riskLevel, reason });
    log.warn({ type, riskLevel, reason }, 'Operation blocked by risk gating');
  }

  // ==========================================================================
  // Intent Tracking
  // ==========================================================================

  /**
   * Set active intents count
   */
  setActiveIntents(type: 'dca' | 'stop_loss', count: number): void {
    this.activeIntents.set({ type }, count);
  }

  /**
   * Set pending jobs count
   */
  setPendingJobs(type: OperationType, count: number): void {
    this.pendingJobs.set({ type }, count);
  }

  // ==========================================================================
  // Convenience Methods
  // ==========================================================================

  /**
   * Create a timer for measuring operation duration
   */
  startTimer(
    type: OperationType,
    profile: ExecutionProfile = 'AUTO'
  ): {
    end: (status: 'success' | 'failed', errorCode?: string) => void;
  } {
    const startTime = Date.now();
    this.operationsTotal.inc({ type, profile });

    return {
      end: (status: 'success' | 'failed', errorCode?: string) => {
        const durationSeconds = (Date.now() - startTime) / 1000;

        if (status === 'success') {
          this.recordOperationSuccess(type, profile, durationSeconds);
        } else {
          this.recordOperationFailure(type, profile, durationSeconds, errorCode);
        }
      },
    };
  }

  /**
   * Time an async function
   */
  async timeAsync<T>(
    type: OperationType,
    profile: ExecutionProfile,
    fn: () => Promise<T>
  ): Promise<T> {
    const timer = this.startTimer(type, profile);

    try {
      const result = await fn();
      timer.end('success');
      return result;
    } catch (error) {
      const errorCode = error instanceof Error ? error.name : 'unknown';
      timer.end('failed', errorCode);
      throw error;
    }
  }
}

// Singleton instance
let metricsInstance: MetricsService | null = null;

/**
 * Get the metrics service singleton
 */
export function getMetricsService(): MetricsService {
  if (!metricsInstance) {
    metricsInstance = new MetricsService();
  }
  return metricsInstance;
}

/**
 * Reset metrics (for testing)
 */
export function resetMetrics(): void {
  metricsInstance = null;
}
