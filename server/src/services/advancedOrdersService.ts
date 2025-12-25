/**
 * Advanced Orders Service
 *
 * Implements advanced order types for sophisticated trading:
 * - Trailing Stop: Stop-loss that follows price upward
 * - Bracket Order: Combined take-profit and stop-loss
 * - Take Profit: Sell when price reaches target
 * - Stop Loss: Sell when price drops below threshold
 */

import { v4 as uuidv4 } from 'uuid';

import { logger } from '../utils/logger.js';

import { jupiterService } from './jupiterService.js';

const log = logger.child({ service: 'AdvancedOrders' });

// ============================================================================
// Types
// ============================================================================

/**
 * Advanced order types
 */
export type AdvancedOrderType = 'trailing_stop' | 'bracket' | 'take_profit' | 'stop_loss';

/**
 * Order status
 */
export type AdvancedOrderStatus =
  | 'pending' // Order created, waiting for activation
  | 'active' // Order is being monitored
  | 'triggered' // Order conditions met, executing
  | 'executed' // Order successfully executed
  | 'cancelled' // Order was cancelled
  | 'expired' // Order expired without triggering
  | 'failed'; // Order execution failed

/**
 * Base order configuration
 */
export interface BaseOrderConfig {
  /** User's public key */
  userPublicKey: string;
  /** Token to sell */
  inputMint: string;
  /** Token to receive */
  outputMint: string;
  /** Amount to sell (in smallest unit) */
  amount: string;
  /** Slippage tolerance (bps) */
  slippageBps: number;
  /** Order expiration (timestamp) */
  expiresAt?: number;
  /** Use MEV protection */
  useMEVProtection?: boolean;
}

/**
 * Trailing stop configuration
 */
export interface TrailingStopConfig extends BaseOrderConfig {
  type: 'trailing_stop';
  /** Trail percentage (e.g., 500 = 5%) */
  trailBps: number;
  /** Optional: activation price (order activates when price reaches this) */
  activationPrice?: number;
}

/**
 * Bracket order configuration
 */
export interface BracketOrderConfig extends BaseOrderConfig {
  type: 'bracket';
  /** Take profit price (sell when price goes above) */
  takeProfitPrice: number;
  /** Stop loss price (sell when price goes below) */
  stopLossPrice: number;
  /** Current entry price (for reference) */
  entryPrice: number;
}

/**
 * Take profit configuration
 */
export interface TakeProfitConfig extends BaseOrderConfig {
  type: 'take_profit';
  /** Target price to trigger sell */
  targetPrice: number;
}

/**
 * Stop loss configuration
 */
export interface StopLossConfig extends BaseOrderConfig {
  type: 'stop_loss';
  /** Price threshold to trigger sell */
  triggerPrice: number;
}

/**
 * Union type for all order configs
 */
export type AdvancedOrderConfig =
  | TrailingStopConfig
  | BracketOrderConfig
  | TakeProfitConfig
  | StopLossConfig;

/**
 * Advanced order record
 */
export interface AdvancedOrder {
  id: string;
  type: AdvancedOrderType;
  status: AdvancedOrderStatus;
  userPublicKey: string;
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  useMEVProtection: boolean;

  // Type-specific fields
  trailBps?: number;
  activationPrice?: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  entryPrice?: number;
  targetPrice?: number;
  triggerPrice?: number;

  // Tracking fields
  highestPrice?: number; // For trailing stop
  currentTrailPrice?: number; // Current trigger price for trailing stop
  triggeredAt?: number;
  executedAt?: number;
  txSignature?: string;
  error?: string;
}

/**
 * Price check result
 */
export interface PriceCheckResult {
  shouldTrigger: boolean;
  reason?: string;
  currentPrice: number;
  triggerPrice?: number;
}

// ============================================================================
// Service
// ============================================================================

/**
 * Advanced Orders Service
 *
 * Manages advanced order types with price monitoring and execution.
 */
export class AdvancedOrdersService {
  private orders: Map<string, AdvancedOrder> = new Map();
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map();
  private readonly priceCacheTTL = 5000; // 5 seconds

  constructor() {
    log.info('AdvancedOrdersService initialized');
  }

  // --------------------------------------------------------------------------
  // Order Creation
  // --------------------------------------------------------------------------

  /**
   * Create a trailing stop order
   */
  async createTrailingStop(config: Omit<TrailingStopConfig, 'type'>): Promise<AdvancedOrder> {
    const id = `trail_${uuidv4()}`;
    const now = Date.now();

    // Validate trail percentage
    if (config.trailBps < 10 || config.trailBps > 5000) {
      throw new Error('Trail percentage must be between 0.1% and 50%');
    }

    // Get current price
    const currentPrice = await this.getPrice(config.inputMint, config.outputMint);

    const order: AdvancedOrder = {
      id,
      type: 'trailing_stop',
      status: config.activationPrice ? 'pending' : 'active',
      userPublicKey: config.userPublicKey,
      inputMint: config.inputMint,
      outputMint: config.outputMint,
      amount: config.amount,
      slippageBps: config.slippageBps,
      createdAt: now,
      updatedAt: now,
      expiresAt: config.expiresAt,
      useMEVProtection: config.useMEVProtection ?? true,
      trailBps: config.trailBps,
      activationPrice: config.activationPrice,
      highestPrice: currentPrice,
      currentTrailPrice: this.calculateTrailPrice(currentPrice, config.trailBps),
    };

    this.orders.set(id, order);
    log.info(
      { orderId: id, trailBps: config.trailBps, highestPrice: currentPrice },
      'Trailing stop created'
    );

    return order;
  }

  /**
   * Create a bracket order (take profit + stop loss)
   */
  async createBracketOrder(config: Omit<BracketOrderConfig, 'type'>): Promise<AdvancedOrder> {
    const id = `bracket_${uuidv4()}`;
    const now = Date.now();

    // Validate prices
    if (config.takeProfitPrice <= config.entryPrice) {
      throw new Error('Take profit price must be above entry price');
    }
    if (config.stopLossPrice >= config.entryPrice) {
      throw new Error('Stop loss price must be below entry price');
    }

    const order: AdvancedOrder = {
      id,
      type: 'bracket',
      status: 'active',
      userPublicKey: config.userPublicKey,
      inputMint: config.inputMint,
      outputMint: config.outputMint,
      amount: config.amount,
      slippageBps: config.slippageBps,
      createdAt: now,
      updatedAt: now,
      expiresAt: config.expiresAt,
      useMEVProtection: config.useMEVProtection ?? true,
      takeProfitPrice: config.takeProfitPrice,
      stopLossPrice: config.stopLossPrice,
      entryPrice: config.entryPrice,
    };

    this.orders.set(id, order);
    log.info(
      { orderId: id, takeProfit: config.takeProfitPrice, stopLoss: config.stopLossPrice },
      'Bracket order created'
    );

    return order;
  }

  /**
   * Create a take profit order
   */
  async createTakeProfit(config: Omit<TakeProfitConfig, 'type'>): Promise<AdvancedOrder> {
    const id = `tp_${uuidv4()}`;
    const now = Date.now();

    const order: AdvancedOrder = {
      id,
      type: 'take_profit',
      status: 'active',
      userPublicKey: config.userPublicKey,
      inputMint: config.inputMint,
      outputMint: config.outputMint,
      amount: config.amount,
      slippageBps: config.slippageBps,
      createdAt: now,
      updatedAt: now,
      expiresAt: config.expiresAt,
      useMEVProtection: config.useMEVProtection ?? true,
      targetPrice: config.targetPrice,
    };

    this.orders.set(id, order);
    log.info({ orderId: id, targetPrice: config.targetPrice }, 'Take profit order created');

    return order;
  }

  /**
   * Create a stop loss order
   */
  async createStopLoss(config: Omit<StopLossConfig, 'type'>): Promise<AdvancedOrder> {
    const id = `sl_${uuidv4()}`;
    const now = Date.now();

    const order: AdvancedOrder = {
      id,
      type: 'stop_loss',
      status: 'active',
      userPublicKey: config.userPublicKey,
      inputMint: config.inputMint,
      outputMint: config.outputMint,
      amount: config.amount,
      slippageBps: config.slippageBps,
      createdAt: now,
      updatedAt: now,
      expiresAt: config.expiresAt,
      useMEVProtection: config.useMEVProtection ?? true,
      triggerPrice: config.triggerPrice,
    };

    this.orders.set(id, order);
    log.info({ orderId: id, triggerPrice: config.triggerPrice }, 'Stop loss order created');

    return order;
  }

  // --------------------------------------------------------------------------
  // Order Management
  // --------------------------------------------------------------------------

  /**
   * Get order by ID
   */
  getOrder(orderId: string): AdvancedOrder | undefined {
    return this.orders.get(orderId);
  }

  /**
   * Get all orders for a user
   */
  getUserOrders(userPublicKey: string, status?: AdvancedOrderStatus): AdvancedOrder[] {
    return Array.from(this.orders.values()).filter(order => {
      if (order.userPublicKey !== userPublicKey) return false;
      if (status && order.status !== status) return false;
      return true;
    });
  }

  /**
   * Get all active orders
   */
  getActiveOrders(): AdvancedOrder[] {
    return Array.from(this.orders.values()).filter(
      order => order.status === 'active' || order.status === 'pending'
    );
  }

  /**
   * Cancel an order
   */
  cancelOrder(orderId: string): AdvancedOrder {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    if (order.status === 'executed' || order.status === 'triggered') {
      throw new Error('Cannot cancel order that is already executing');
    }

    order.status = 'cancelled';
    order.updatedAt = Date.now();

    log.info({ orderId }, 'Order cancelled');
    return order;
  }

  // --------------------------------------------------------------------------
  // Price Monitoring
  // --------------------------------------------------------------------------

  /**
   * Check if an order should be triggered
   */
  async checkOrder(orderId: string): Promise<PriceCheckResult> {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    // Check expiration
    if (order.expiresAt && Date.now() > order.expiresAt) {
      order.status = 'expired';
      order.updatedAt = Date.now();
      return { shouldTrigger: false, reason: 'Order expired', currentPrice: 0 };
    }

    // Get current price
    const currentPrice = await this.getPrice(order.inputMint, order.outputMint);

    switch (order.type) {
      case 'trailing_stop':
        return this.checkTrailingStop(order, currentPrice);
      case 'bracket':
        return this.checkBracketOrder(order, currentPrice);
      case 'take_profit':
        return this.checkTakeProfit(order, currentPrice);
      case 'stop_loss':
        return this.checkStopLoss(order, currentPrice);
      default:
        return { shouldTrigger: false, reason: 'Unknown order type', currentPrice };
    }
  }

  /**
   * Check trailing stop order
   */
  private checkTrailingStop(order: AdvancedOrder, currentPrice: number): PriceCheckResult {
    // Check if order needs activation first
    if (order.status === 'pending' && order.activationPrice) {
      if (currentPrice >= order.activationPrice) {
        order.status = 'active';
        order.highestPrice = currentPrice;
        order.currentTrailPrice = this.calculateTrailPrice(currentPrice, order.trailBps!);
        order.updatedAt = Date.now();
        log.info(
          { orderId: order.id, activationPrice: order.activationPrice },
          'Trailing stop activated'
        );
      }
      return {
        shouldTrigger: false,
        reason: 'Waiting for activation price',
        currentPrice,
      };
    }

    // Update highest price if current is higher
    if (currentPrice > (order.highestPrice || 0)) {
      order.highestPrice = currentPrice;
      order.currentTrailPrice = this.calculateTrailPrice(currentPrice, order.trailBps!);
      order.updatedAt = Date.now();
    }

    // Check if price has dropped below trail price
    if (currentPrice <= (order.currentTrailPrice || 0)) {
      return {
        shouldTrigger: true,
        reason: `Price dropped ${order.trailBps! / 100}% from high`,
        currentPrice,
        triggerPrice: order.currentTrailPrice,
      };
    }

    return {
      shouldTrigger: false,
      currentPrice,
      triggerPrice: order.currentTrailPrice,
    };
  }

  /**
   * Check bracket order (take profit OR stop loss)
   */
  private checkBracketOrder(order: AdvancedOrder, currentPrice: number): PriceCheckResult {
    // Check take profit
    if (currentPrice >= order.takeProfitPrice!) {
      return {
        shouldTrigger: true,
        reason: 'Take profit triggered',
        currentPrice,
        triggerPrice: order.takeProfitPrice,
      };
    }

    // Check stop loss
    if (currentPrice <= order.stopLossPrice!) {
      return {
        shouldTrigger: true,
        reason: 'Stop loss triggered',
        currentPrice,
        triggerPrice: order.stopLossPrice,
      };
    }

    return { shouldTrigger: false, currentPrice };
  }

  /**
   * Check take profit order
   */
  private checkTakeProfit(order: AdvancedOrder, currentPrice: number): PriceCheckResult {
    if (currentPrice >= order.targetPrice!) {
      return {
        shouldTrigger: true,
        reason: 'Target price reached',
        currentPrice,
        triggerPrice: order.targetPrice,
      };
    }

    return { shouldTrigger: false, currentPrice };
  }

  /**
   * Check stop loss order
   */
  private checkStopLoss(order: AdvancedOrder, currentPrice: number): PriceCheckResult {
    if (currentPrice <= order.triggerPrice!) {
      return {
        shouldTrigger: true,
        reason: 'Stop loss triggered',
        currentPrice,
        triggerPrice: order.triggerPrice,
      };
    }

    return { shouldTrigger: false, currentPrice };
  }

  /**
   * Calculate trail price from highest price
   */
  private calculateTrailPrice(highestPrice: number, trailBps: number): number {
    return highestPrice * (1 - trailBps / 10000);
  }

  // --------------------------------------------------------------------------
  // Price Fetching
  // --------------------------------------------------------------------------

  /**
   * Get price from Jupiter (with caching)
   */
  async getPrice(inputMint: string, outputMint: string): Promise<number> {
    const cacheKey = `${inputMint}_${outputMint}`;
    const cached = this.priceCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.priceCacheTTL) {
      return cached.price;
    }

    try {
      // Get a small quote to determine price
      const quote = await jupiterService.quoteSwap({
        inputMint,
        outputMint,
        amount: '1000000', // 1 unit for price discovery
        slippageBps: 50,
      });

      const price = parseFloat(quote.outAmount) / parseFloat(quote.inAmount);
      this.priceCache.set(cacheKey, { price, timestamp: Date.now() });

      return price;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error: message, inputMint, outputMint }, 'Failed to get price');
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Execution
  // --------------------------------------------------------------------------

  /**
   * Build execution transaction for a triggered order
   */
  async buildExecutionTransaction(orderId: string): Promise<{
    transaction: string;
    lastValidBlockHeight: number;
  }> {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    // Get quote
    const quote = await jupiterService.quoteSwap({
      inputMint: order.inputMint,
      outputMint: order.outputMint,
      amount: order.amount,
      slippageBps: order.slippageBps,
    });

    // Get swap transaction
    const swap = await jupiterService.getSwapTransaction({
      quoteResponse: quote,
      userPublicKey: order.userPublicKey,
      wrapAndUnwrapSol: true,
      prioritizationFeeLamports: order.useMEVProtection ? 'auto' : undefined,
    });

    // Update order status
    order.status = 'triggered';
    order.triggeredAt = Date.now();
    order.updatedAt = Date.now();

    log.info({ orderId, type: order.type }, 'Order triggered, transaction built');

    return {
      transaction: swap.swapTransaction,
      lastValidBlockHeight: swap.lastValidBlockHeight,
    };
  }

  /**
   * Mark order as executed
   */
  markExecuted(orderId: string, txSignature: string): AdvancedOrder {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    order.status = 'executed';
    order.executedAt = Date.now();
    order.txSignature = txSignature;
    order.updatedAt = Date.now();

    log.info({ orderId, txSignature }, 'Order executed');
    return order;
  }

  /**
   * Mark order as failed
   */
  markFailed(orderId: string, error: string): AdvancedOrder {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    order.status = 'failed';
    order.error = error;
    order.updatedAt = Date.now();

    log.error({ orderId, error }, 'Order execution failed');
    return order;
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  /**
   * Clear expired and old orders
   */
  cleanup(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;

    for (const [id, order] of this.orders.entries()) {
      if (
        order.createdAt < cutoff &&
        ['executed', 'cancelled', 'expired', 'failed'].includes(order.status)
      ) {
        this.orders.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      log.info({ removed }, 'Cleaned up old orders');
    }

    return removed;
  }
}

// Singleton instance
let advancedOrdersService: AdvancedOrdersService | null = null;

export function getAdvancedOrdersService(): AdvancedOrdersService {
  if (!advancedOrdersService) {
    advancedOrdersService = new AdvancedOrdersService();
  }
  return advancedOrdersService;
}

export function resetAdvancedOrdersService(): void {
  advancedOrdersService = null;
}
