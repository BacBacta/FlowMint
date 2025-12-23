/**
 * Intent Scheduler Service
 *
 * Manages DCA (Dollar-Cost Averaging) and stop-loss intents.
 * Uses cron scheduling and Pyth oracle for price monitoring.
 */

import { CronJob } from 'cron';
import axios from 'axios';

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { DatabaseService } from '../db/database.js';
import { ExecutionEngine } from './executionEngine.js';
import { NotificationService, NotificationType, NotificationPriority } from './notificationService.js';

// Helper to safely notify (logs warning if service not initialized)
async function safeNotify(
  userPublicKey: string,
  type: NotificationType,
  title: string,
  message: string,
  data?: Record<string, any>,
  priority: NotificationPriority = NotificationPriority.MEDIUM
): Promise<void> {
  try {
    await NotificationService.notifyStatic(userPublicKey, type, title, message, data, priority);
  } catch (err) {
    logger.warn({ err, type, title }, 'Failed to send notification');
  }
}

/**
 * Intent types
 */
export enum IntentType {
  DCA = 'DCA',
  STOP_LOSS = 'STOP_LOSS',
}

/**
 * Intent status
 */
export enum IntentStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  FAILED = 'failed',
}

/**
 * Intent definition
 */
export interface Intent {
  /** Unique intent ID */
  id: string;
  /** User's public key */
  userPublicKey: string;
  /** Type of intent */
  intentType: IntentType;
  /** Input token mint */
  tokenFrom: string;
  /** Output token mint */
  tokenTo: string;
  /** Total amount to swap (in smallest unit) */
  totalAmount: string;
  /** Remaining amount to swap */
  remainingAmount: string;
  /** For DCA: interval in seconds between swaps */
  intervalSeconds?: number;
  /** For DCA: amount per swap */
  amountPerSwap?: string;
  /** For stop-loss: trigger price (in USD) */
  priceThreshold?: number;
  /** For stop-loss: trigger when price goes above or below */
  priceDirection?: 'above' | 'below';
  /** Pyth price feed ID for the token */
  priceFeedId?: string;
  /** Current status */
  status: IntentStatus;
  /** Slippage tolerance in basis points */
  slippageBps: number;
  /** Number of executions completed */
  executionCount: number;
  /** Last execution timestamp */
  lastExecutionAt?: number;
  /** Next scheduled execution */
  nextExecutionAt?: number;
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
}

/**
 * Create intent request
 */
export interface CreateIntentRequest {
  userPublicKey: string;
  intentType: IntentType;
  tokenFrom: string;
  tokenTo: string;
  totalAmount: string;
  /** For DCA */
  intervalSeconds?: number;
  numberOfSwaps?: number;
  /** For stop-loss */
  priceThreshold?: number;
  priceDirection?: 'above' | 'below';
  priceFeedId?: string;
  slippageBps?: number;
}

/**
 * Pyth price data
 */
interface PythPriceData {
  id: string;
  price: {
    price: string;
    conf: string;
    expo: number;
    publish_time: number;
  };
  ema_price: {
    price: string;
    conf: string;
    expo: number;
    publish_time: number;
  };
}

/**
 * Intent Scheduler Service
 *
 * Handles scheduling and execution of DCA and stop-loss orders.
 */
export class IntentScheduler {
  private readonly log = logger.child({ service: 'IntentScheduler' });
  private executionEngine: ExecutionEngine;
  private dcaJob?: CronJob;
  private stopLossJob?: CronJob;
  private isRunning = false;

  constructor(private readonly db: DatabaseService) {
    this.executionEngine = new ExecutionEngine(db);
  }

  /**
   * Start the scheduler
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.log.warn('Scheduler already running');
      return;
    }

    this.log.info('Starting intent scheduler');

    // DCA job - runs every minute to check for pending DCA executions
    this.dcaJob = new CronJob(
      '* * * * *', // Every minute
      () => this.processDCAIntents(),
      null,
      true,
      'UTC'
    );

    // Stop-loss job - runs every 10 seconds to check prices
    this.stopLossJob = new CronJob(
      '*/10 * * * * *', // Every 10 seconds
      () => this.processStopLossIntents(),
      null,
      true,
      'UTC'
    );

    this.isRunning = true;
    this.log.info('Intent scheduler started');
  }

  /**
   * Stop the scheduler
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.log.info('Stopping intent scheduler');

    this.dcaJob?.stop();
    this.stopLossJob?.stop();

    this.isRunning = false;
    this.log.info('Intent scheduler stopped');
  }

  /**
   * Create a new intent
   */
  async createIntent(request: CreateIntentRequest): Promise<Intent> {
    const now = Date.now();
    const id = `intent_${now}_${Math.random().toString(36).substring(7)}`;

    let amountPerSwap: string | undefined;
    let nextExecutionAt: number | undefined;

    if (request.intentType === IntentType.DCA) {
      if (!request.intervalSeconds || !request.numberOfSwaps) {
        throw new Error('DCA intent requires intervalSeconds and numberOfSwaps');
      }

      const totalAmountBigInt = BigInt(request.totalAmount);
      amountPerSwap = (totalAmountBigInt / BigInt(request.numberOfSwaps)).toString();
      nextExecutionAt = now + request.intervalSeconds * 1000;
    }

    if (request.intentType === IntentType.STOP_LOSS) {
      if (!request.priceThreshold || !request.priceDirection || !request.priceFeedId) {
        throw new Error('Stop-loss intent requires priceThreshold, priceDirection, and priceFeedId');
      }
    }

    const intent: Intent = {
      id,
      userPublicKey: request.userPublicKey,
      intentType: request.intentType,
      tokenFrom: request.tokenFrom,
      tokenTo: request.tokenTo,
      totalAmount: request.totalAmount,
      remainingAmount: request.totalAmount,
      intervalSeconds: request.intervalSeconds,
      amountPerSwap,
      priceThreshold: request.priceThreshold,
      priceDirection: request.priceDirection,
      priceFeedId: request.priceFeedId,
      status: IntentStatus.ACTIVE,
      slippageBps: request.slippageBps || 100,
      executionCount: 0,
      nextExecutionAt,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.saveIntent(intent);

    this.log.info(
      {
        intentId: id,
        type: request.intentType,
        totalAmount: request.totalAmount,
      },
      'Intent created'
    );

    return intent;
  }

  /**
   * Cancel an intent
   */
  async cancelIntent(intentId: string, userPublicKey: string): Promise<void> {
    const intent = await this.db.getIntent(intentId);

    if (!intent) {
      throw new Error('Intent not found');
    }

    if (intent.userPublicKey !== userPublicKey) {
      throw new Error('Unauthorized');
    }

    if (intent.status !== IntentStatus.ACTIVE && intent.status !== IntentStatus.PAUSED) {
      throw new Error('Intent cannot be cancelled');
    }

    await this.db.updateIntentStatus(intentId, IntentStatus.CANCELLED);
    this.log.info({ intentId }, 'Intent cancelled');
  }

  /**
   * Get user's intents
   */
  async getUserIntents(userPublicKey: string): Promise<Intent[]> {
    return this.db.getUserIntents(userPublicKey);
  }

  /**
   * Process DCA intents
   */
  private async processDCAIntents(): Promise<void> {
    try {
      const activeIntents = await this.db.getActiveIntents(IntentType.DCA);
      const now = Date.now();

      for (const intent of activeIntents) {
        if (intent.nextExecutionAt && intent.nextExecutionAt <= now) {
          await this.executeDCASlice(intent);
        }
      }
    } catch (error) {
      this.log.error({ error }, 'Error processing DCA intents');
    }
  }

  /**
   * Execute a single DCA slice
   */
  private async executeDCASlice(intent: Intent): Promise<void> {
    this.log.info({ intentId: intent.id }, 'Executing DCA slice');

    try {
      const amountToSwap = intent.amountPerSwap || intent.remainingAmount;

      const result = await this.executionEngine.executeSwap({
        userPublicKey: intent.userPublicKey,
        inputMint: intent.tokenFrom,
        outputMint: intent.tokenTo,
        amount: amountToSwap,
        slippageBps: intent.slippageBps,
        protectedMode: true, // Use protected mode for automated trades
      });

      if (result.status === 'failed') {
        this.log.error(
          { intentId: intent.id, error: result.error },
          'DCA slice failed'
        );
        // Don't fail the whole intent, just skip this slice
        // Notify user of failure
        await safeNotify(
          intent.userPublicKey,
          NotificationType.DCA_FAILED,
          'DCA Execution Failed',
          `DCA slice #${intent.executionCount + 1} failed: ${result.error}`,
          { intentId: intent.id, error: result.error },
          NotificationPriority.HIGH
        );
      } else {
        // Notify user of successful DCA execution
        await safeNotify(
          intent.userPublicKey,
          NotificationType.DCA_EXECUTED,
          'DCA Executed',
          `DCA slice #${intent.executionCount + 1} completed: ${amountToSwap} swapped`,
          { intentId: intent.id, amountSwapped: amountToSwap },
          NotificationPriority.LOW
        );
      }

      // Update remaining amount
      const remaining = BigInt(intent.remainingAmount) - BigInt(amountToSwap);
      const now = Date.now();

      if (remaining <= 0n) {
        // Intent completed
        await this.db.updateIntentStatus(intent.id, IntentStatus.COMPLETED);
        this.log.info({ intentId: intent.id }, 'DCA intent completed');
        
        // Notify user of DCA completion
        await safeNotify(
          intent.userPublicKey,
          NotificationType.DCA_COMPLETED,
          'DCA Completed',
          `Your DCA plan completed successfully after ${intent.executionCount + 1} executions.`,
          { intentId: intent.id, intentType: 'DCA' },
          NotificationPriority.MEDIUM
        );
      } else {
        // Schedule next execution
        const nextExecution = now + (intent.intervalSeconds || 0) * 1000;
        await this.db.updateIntent(intent.id, {
          remainingAmount: remaining.toString(),
          executionCount: intent.executionCount + 1,
          lastExecutionAt: now,
          nextExecutionAt: nextExecution,
          updatedAt: now,
        });
      }
    } catch (error) {
      this.log.error({ intentId: intent.id, error }, 'Error executing DCA slice');
    }
  }

  /**
   * Process stop-loss intents
   */
  private async processStopLossIntents(): Promise<void> {
    try {
      const activeIntents = await this.db.getActiveIntents(IntentType.STOP_LOSS);

      if (activeIntents.length === 0) return;

      // Group intents by price feed
      const intentsByFeed = new Map<string, Intent[]>();
      for (const intent of activeIntents) {
        if (!intent.priceFeedId) continue;

        const existing = intentsByFeed.get(intent.priceFeedId) || [];
        existing.push(intent);
        intentsByFeed.set(intent.priceFeedId, existing);
      }

      // Fetch prices for all feeds
      const feedIds = Array.from(intentsByFeed.keys());
      const prices = await this.fetchPythPrices(feedIds);

      // Check each intent against current price
      for (const [feedId, intents] of intentsByFeed) {
        const priceData = prices.get(feedId);
        if (!priceData) continue;

        const currentPrice = this.parsePythPrice(priceData);

        for (const intent of intents) {
          await this.checkStopLossTrigger(intent, currentPrice);
        }
      }
    } catch (error) {
      this.log.error({ error }, 'Error processing stop-loss intents');
    }
  }

  /**
   * Check if a stop-loss should be triggered
   */
  private async checkStopLossTrigger(intent: Intent, currentPrice: number): Promise<void> {
    if (!intent.priceThreshold || !intent.priceDirection) return;

    const shouldTrigger =
      (intent.priceDirection === 'below' && currentPrice <= intent.priceThreshold) ||
      (intent.priceDirection === 'above' && currentPrice >= intent.priceThreshold);

    if (shouldTrigger) {
      this.log.info(
        {
          intentId: intent.id,
          currentPrice,
          threshold: intent.priceThreshold,
          direction: intent.priceDirection,
        },
        'Stop-loss triggered'
      );

      await this.executeStopLoss(intent, currentPrice);
    }
  }

  /**
   * Execute stop-loss swap
   */
  private async executeStopLoss(intent: Intent, currentPrice: number): Promise<void> {
    try {
      const result = await this.executionEngine.executeSwap({
        userPublicKey: intent.userPublicKey,
        inputMint: intent.tokenFrom,
        outputMint: intent.tokenTo,
        amount: intent.remainingAmount,
        slippageBps: intent.slippageBps,
        protectedMode: true,
      });

      if (result.status === 'failed') {
        this.log.error(
          { intentId: intent.id, error: result.error },
          'Stop-loss execution failed'
        );
        await this.db.updateIntentStatus(intent.id, IntentStatus.FAILED);
        
        // Notify user of stop-loss failure
        await safeNotify(
          intent.userPublicKey,
          NotificationType.STOP_LOSS_FAILED,
          'Stop-Loss Failed',
          `Stop-loss execution failed: ${result.error}`,
          { intentId: intent.id, triggerPrice: intent.priceThreshold, currentPrice, error: result.error },
          NotificationPriority.URGENT
        );
      } else {
        await this.db.updateIntentStatus(intent.id, IntentStatus.COMPLETED);
        this.log.info({ intentId: intent.id }, 'Stop-loss executed successfully');
        
        // Notify user of successful stop-loss execution
        await safeNotify(
          intent.userPublicKey,
          NotificationType.STOP_LOSS_EXECUTED,
          'Stop-Loss Executed',
          `Stop-loss executed successfully at price ${currentPrice}`,
          { intentId: intent.id, triggerPrice: intent.priceThreshold, currentPrice },
          NotificationPriority.HIGH
        );
      }
    } catch (error) {
      this.log.error({ intentId: intent.id, error }, 'Error executing stop-loss');
      await this.db.updateIntentStatus(intent.id, IntentStatus.FAILED);
      
      // Notify user of stop-loss error
      await safeNotify(
        intent.userPublicKey,
        NotificationType.STOP_LOSS_FAILED,
        'Stop-Loss Error',
        `Stop-loss error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { intentId: intent.id, triggerPrice: intent.priceThreshold, currentPrice },
        NotificationPriority.URGENT
      );
    }
  }

  /**
   * Fetch prices from Pyth
   */
  private async fetchPythPrices(feedIds: string[]): Promise<Map<string, PythPriceData>> {
    try {
      const idsParam = feedIds.map((id) => `ids[]=${id}`).join('&');
      const response = await axios.get<PythPriceData[]>(
        `${config.pyth.endpoint}/api/latest_price_feeds?${idsParam}`
      );

      const prices = new Map<string, PythPriceData>();
      for (const priceData of response.data) {
        prices.set(priceData.id, priceData);
      }

      return prices;
    } catch (error) {
      this.log.error({ error }, 'Error fetching Pyth prices');
      return new Map();
    }
  }

  /**
   * Parse Pyth price to a number
   */
  private parsePythPrice(priceData: PythPriceData): number {
    const price = parseInt(priceData.price.price, 10);
    const expo = priceData.price.expo;
    return price * Math.pow(10, expo);
  }
}
