/**
 * CircuitBreaker - V2 Fault Tolerance and Safety Rules
 *
 * Implements circuit breaker pattern for DEXs, RPCs, tokens, and routes.
 * Provides automatic failure detection and recovery.
 */

import { logger } from '../utils/logger';

const log = logger.child({ service: 'CircuitBreaker' });

// ==================== Types ====================

export type CircuitState = 'closed' | 'open' | 'half-open';
export type CircuitType = 'dex' | 'rpc' | 'token' | 'route' | 'global';

export interface CircuitConfig {
  failureThreshold: number; // Failures before opening
  successThreshold: number; // Successes before closing
  timeout: number; // Ms before moving to half-open
  monitoringWindow: number; // Ms for failure rate calculation
  failureRateThreshold: number; // 0-1, failure rate to trigger
}

export interface CircuitStats {
  failures: number;
  successes: number;
  lastFailure?: number;
  lastSuccess?: number;
  totalCalls: number;
  failureRate: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

export interface Circuit {
  id: string;
  type: CircuitType;
  name: string;
  state: CircuitState;
  config: CircuitConfig;
  stats: CircuitStats;
  openedAt?: number;
  lastStateChange: number;
  metadata?: Record<string, unknown>;
}

export interface CircuitEvent {
  circuitId: string;
  type: 'opened' | 'closed' | 'half-opened' | 'failure' | 'success';
  timestamp: number;
  details?: string;
}

export interface SafetyRule {
  id: string;
  name: string;
  condition: (context: SafetyContext) => boolean;
  action: 'warn' | 'block' | 'require_confirmation';
  message: string;
  priority: number;
}

export interface SafetyContext {
  circuit: Circuit;
  request?: {
    amount?: string;
    tokenMint?: string;
    dex?: string;
    slippageBps?: number;
  };
  globalStats?: {
    openCircuits: number;
    totalFailureRate: number;
  };
}

export interface SafetyCheckResult {
  allowed: boolean;
  warnings: string[];
  blockedBy?: string;
  requiresConfirmation: boolean;
}

// ==================== Default Configs ====================

const DEFAULT_CONFIGS: Record<CircuitType, CircuitConfig> = {
  dex: {
    failureThreshold: 5,
    successThreshold: 3,
    timeout: 30_000, // 30 seconds
    monitoringWindow: 60_000, // 1 minute
    failureRateThreshold: 0.5, // 50%
  },
  rpc: {
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 15_000, // 15 seconds
    monitoringWindow: 30_000,
    failureRateThreshold: 0.3,
  },
  token: {
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 60_000, // 1 minute
    monitoringWindow: 120_000,
    failureRateThreshold: 0.4,
  },
  route: {
    failureThreshold: 2,
    successThreshold: 1,
    timeout: 20_000,
    monitoringWindow: 60_000,
    failureRateThreshold: 0.3,
  },
  global: {
    failureThreshold: 10,
    successThreshold: 5,
    timeout: 60_000,
    monitoringWindow: 120_000,
    failureRateThreshold: 0.2,
  },
};

// ==================== Service ====================

export class CircuitBreakerService {
  private circuits: Map<string, Circuit> = new Map();
  private events: CircuitEvent[] = [];
  private safetyRules: SafetyRule[] = [];
  private callHistory: Map<string, { timestamp: number; success: boolean }[]> =
    new Map();

  constructor() {
    this.initializeDefaultRules();
  }

  /**
   * Get or create circuit
   */
  getCircuit(type: CircuitType, name: string): Circuit {
    const id = `${type}:${name}`;
    let circuit = this.circuits.get(id);

    if (!circuit) {
      circuit = this.createCircuit(type, name);
    }

    return circuit;
  }

  /**
   * Check if circuit allows request
   */
  isAllowed(type: CircuitType, name: string): boolean {
    const circuit = this.getCircuit(type, name);

    switch (circuit.state) {
      case 'closed':
        return true;
      case 'open':
        return this.shouldAttemptReset(circuit);
      case 'half-open':
        return true; // Allow test request
    }
  }

  /**
   * Record success
   */
  recordSuccess(type: CircuitType, name: string): void {
    const circuit = this.getCircuit(type, name);
    const now = Date.now();

    // Update stats
    circuit.stats.successes++;
    circuit.stats.totalCalls++;
    circuit.stats.lastSuccess = now;
    circuit.stats.consecutiveSuccesses++;
    circuit.stats.consecutiveFailures = 0;

    // Record in history
    this.addToHistory(circuit.id, true);

    // Update failure rate
    circuit.stats.failureRate = this.calculateFailureRate(circuit);

    // State transitions
    if (circuit.state === 'half-open') {
      if (
        circuit.stats.consecutiveSuccesses >= circuit.config.successThreshold
      ) {
        this.transitionTo(circuit, 'closed');
      }
    }

    this.recordEvent(circuit.id, 'success');
  }

  /**
   * Record failure
   */
  recordFailure(type: CircuitType, name: string, details?: string): void {
    const circuit = this.getCircuit(type, name);
    const now = Date.now();

    // Update stats
    circuit.stats.failures++;
    circuit.stats.totalCalls++;
    circuit.stats.lastFailure = now;
    circuit.stats.consecutiveFailures++;
    circuit.stats.consecutiveSuccesses = 0;

    // Record in history
    this.addToHistory(circuit.id, false);

    // Update failure rate
    circuit.stats.failureRate = this.calculateFailureRate(circuit);

    this.recordEvent(circuit.id, 'failure', details);

    // State transitions
    if (circuit.state === 'closed') {
      const shouldOpen =
        circuit.stats.consecutiveFailures >= circuit.config.failureThreshold ||
        circuit.stats.failureRate >= circuit.config.failureRateThreshold;

      if (shouldOpen) {
        this.transitionTo(circuit, 'open');
      }
    } else if (circuit.state === 'half-open') {
      // Any failure in half-open goes back to open
      this.transitionTo(circuit, 'open');
    }
  }

  /**
   * Execute with circuit breaker protection
   */
  async execute<T>(
    type: CircuitType,
    name: string,
    fn: () => Promise<T>
  ): Promise<T> {
    if (!this.isAllowed(type, name)) {
      throw new CircuitOpenError(type, name);
    }

    const circuit = this.getCircuit(type, name);

    // Move to half-open if testing from open state
    if (circuit.state === 'open') {
      this.transitionTo(circuit, 'half-open');
    }

    try {
      const result = await fn();
      this.recordSuccess(type, name);
      return result;
    } catch (error) {
      this.recordFailure(type, name, String(error));
      throw error;
    }
  }

  /**
   * Check safety rules
   */
  checkSafety(type: CircuitType, name: string, request?: SafetyContext['request']): SafetyCheckResult {
    const circuit = this.getCircuit(type, name);
    const globalStats = this.getGlobalStats();

    const context: SafetyContext = {
      circuit,
      request,
      globalStats,
    };

    const warnings: string[] = [];
    let blockedBy: string | undefined;
    let requiresConfirmation = false;

    // Sort rules by priority and evaluate
    const sortedRules = [...this.safetyRules].sort(
      (a, b) => b.priority - a.priority
    );

    for (const rule of sortedRules) {
      if (rule.condition(context)) {
        switch (rule.action) {
          case 'block':
            blockedBy = rule.id;
            break;
          case 'warn':
            warnings.push(rule.message);
            break;
          case 'require_confirmation':
            requiresConfirmation = true;
            warnings.push(rule.message);
            break;
        }
      }
    }

    return {
      allowed: !blockedBy,
      warnings,
      blockedBy,
      requiresConfirmation,
    };
  }

  /**
   * Add custom safety rule
   */
  addSafetyRule(rule: SafetyRule): void {
    this.safetyRules.push(rule);
    log.info({ ruleId: rule.id, ruleName: rule.name }, 'Safety rule added');
  }

  /**
   * Get circuit status
   */
  getStatus(type: CircuitType, name: string): Circuit {
    return this.getCircuit(type, name);
  }

  /**
   * Get all circuits
   */
  getAllCircuits(): Circuit[] {
    return Array.from(this.circuits.values());
  }

  /**
   * Get open circuits
   */
  getOpenCircuits(): Circuit[] {
    return Array.from(this.circuits.values()).filter(
      (c) => c.state === 'open'
    );
  }

  /**
   * Force circuit state
   */
  forceState(type: CircuitType, name: string, state: CircuitState): void {
    const circuit = this.getCircuit(type, name);
    this.transitionTo(circuit, state);
    log.info({ circuitId: circuit.id, state }, 'Circuit state forced');
  }

  /**
   * Reset circuit
   */
  reset(type: CircuitType, name: string): void {
    const id = `${type}:${name}`;
    this.circuits.delete(id);
    this.callHistory.delete(id);
    log.info({ circuitId: id }, 'Circuit reset');
  }

  /**
   * Get recent events
   */
  getEvents(limit: number = 100): CircuitEvent[] {
    return this.events.slice(-limit);
  }

  /**
   * Get global stats
   */
  getGlobalStats(): {
    openCircuits: number;
    totalFailureRate: number;
    totalCircuits: number;
  } {
    const circuits = Array.from(this.circuits.values());
    const openCount = circuits.filter((c) => c.state === 'open').length;

    let totalFailures = 0;
    let totalCalls = 0;

    for (const circuit of circuits) {
      totalFailures += circuit.stats.failures;
      totalCalls += circuit.stats.totalCalls;
    }

    return {
      openCircuits: openCount,
      totalFailureRate: totalCalls > 0 ? totalFailures / totalCalls : 0,
      totalCircuits: circuits.length,
    };
  }

  /**
   * Health check
   */
  healthCheck(): {
    healthy: boolean;
    openCircuits: string[];
    failureRate: number;
  } {
    const openCircuits = this.getOpenCircuits().map((c) => c.id);
    const stats = this.getGlobalStats();

    return {
      healthy: openCircuits.length === 0 && stats.totalFailureRate < 0.1,
      openCircuits,
      failureRate: stats.totalFailureRate,
    };
  }

  // ==================== Private Helpers ====================

  private createCircuit(type: CircuitType, name: string): Circuit {
    const id = `${type}:${name}`;
    const circuit: Circuit = {
      id,
      type,
      name,
      state: 'closed',
      config: { ...DEFAULT_CONFIGS[type] },
      stats: {
        failures: 0,
        successes: 0,
        totalCalls: 0,
        failureRate: 0,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
      },
      lastStateChange: Date.now(),
    };

    this.circuits.set(id, circuit);
    return circuit;
  }

  private transitionTo(circuit: Circuit, newState: CircuitState): void {
    const oldState = circuit.state;
    circuit.state = newState;
    circuit.lastStateChange = Date.now();

    if (newState === 'open') {
      circuit.openedAt = Date.now();
    }

    if (newState === 'closed') {
      // Reset consecutive counters on close
      circuit.stats.consecutiveFailures = 0;
      circuit.stats.consecutiveSuccesses = 0;
    }

    const eventType =
      newState === 'open'
        ? 'opened'
        : newState === 'closed'
        ? 'closed'
        : 'half-opened';

    this.recordEvent(circuit.id, eventType, `${oldState} -> ${newState}`);

    log.info(
      { circuitId: circuit.id, oldState, newState },
      'Circuit state changed'
    );
  }

  private shouldAttemptReset(circuit: Circuit): boolean {
    if (circuit.state !== 'open' || !circuit.openedAt) {
      return false;
    }

    const elapsed = Date.now() - circuit.openedAt;
    return elapsed >= circuit.config.timeout;
  }

  private addToHistory(circuitId: string, success: boolean): void {
    const history = this.callHistory.get(circuitId) || [];
    history.push({ timestamp: Date.now(), success });

    // Keep only recent history
    const cutoff = Date.now() - 300_000; // 5 minutes
    const filtered = history.filter((h) => h.timestamp > cutoff);
    this.callHistory.set(circuitId, filtered);
  }

  private calculateFailureRate(circuit: Circuit): number {
    const history = this.callHistory.get(circuit.id) || [];
    const cutoff = Date.now() - circuit.config.monitoringWindow;
    const recent = history.filter((h) => h.timestamp > cutoff);

    if (recent.length === 0) {
      return 0;
    }

    const failures = recent.filter((h) => !h.success).length;
    return failures / recent.length;
  }

  private recordEvent(
    circuitId: string,
    type: CircuitEvent['type'],
    details?: string
  ): void {
    this.events.push({
      circuitId,
      type,
      timestamp: Date.now(),
      details,
    });

    // Keep only recent events
    if (this.events.length > 1000) {
      this.events = this.events.slice(-500);
    }
  }

  private initializeDefaultRules(): void {
    // High failure rate warning
    this.safetyRules.push({
      id: 'high-failure-rate',
      name: 'High Failure Rate',
      condition: (ctx) => ctx.circuit.stats.failureRate > 0.3,
      action: 'warn',
      message: 'High failure rate detected',
      priority: 50,
    });

    // Circuit open block
    this.safetyRules.push({
      id: 'circuit-open',
      name: 'Circuit Open',
      condition: (ctx) => ctx.circuit.state === 'open',
      action: 'block',
      message: 'Circuit is open due to failures',
      priority: 100,
    });

    // Multiple open circuits
    this.safetyRules.push({
      id: 'multiple-open-circuits',
      name: 'Multiple Open Circuits',
      condition: (ctx) =>
        (ctx.globalStats?.openCircuits || 0) >= 3,
      action: 'require_confirmation',
      message: 'Multiple circuits are open, system may be degraded',
      priority: 80,
    });

    // High slippage request
    this.safetyRules.push({
      id: 'high-slippage',
      name: 'High Slippage',
      condition: (ctx) =>
        (ctx.request?.slippageBps || 0) > 200,
      action: 'warn',
      message: 'Request has high slippage tolerance',
      priority: 30,
    });

    // Large amount request
    this.safetyRules.push({
      id: 'large-amount',
      name: 'Large Amount',
      condition: (ctx) => {
        const amount = BigInt(ctx.request?.amount || '0');
        return amount > 10_000_000_000n; // > 10,000 USDC
      },
      action: 'require_confirmation',
      message: 'Large payment amount requires confirmation',
      priority: 60,
    });
  }
}

// ==================== Error ====================

export class CircuitOpenError extends Error {
  constructor(
    public readonly type: CircuitType,
    public readonly name: string
  ) {
    super(`Circuit ${type}:${name} is open`);
    this.name = 'CircuitOpenError';
  }
}

// ==================== Singleton ====================

let circuitBreakerInstance: CircuitBreakerService | null = null;

export function getCircuitBreaker(): CircuitBreakerService {
  if (!circuitBreakerInstance) {
    circuitBreakerInstance = new CircuitBreakerService();
  }
  return circuitBreakerInstance;
}

export default CircuitBreakerService;
