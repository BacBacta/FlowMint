/**
 * Notification Service
 *
 * Manages notifications for DCA/Stop-loss executions, swap results,
 * and other important events. Supports multiple notification channels.
 */

import { DatabaseService } from '../db/database.js';
import { logger } from '../utils/logger.js';

/**
 * Notification types
 */
export enum NotificationType {
  DCA_EXECUTED = 'DCA_EXECUTED',
  DCA_COMPLETED = 'DCA_COMPLETED',
  DCA_FAILED = 'DCA_FAILED',
  STOP_LOSS_TRIGGERED = 'STOP_LOSS_TRIGGERED',
  STOP_LOSS_EXECUTED = 'STOP_LOSS_EXECUTED',
  STOP_LOSS_FAILED = 'STOP_LOSS_FAILED',
  SWAP_SUCCESS = 'SWAP_SUCCESS',
  SWAP_FAILED = 'SWAP_FAILED',
  PRICE_ALERT = 'PRICE_ALERT',
  SYSTEM_ALERT = 'SYSTEM_ALERT',
}

/**
 * Notification priority
 */
export enum NotificationPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

/**
 * Notification record
 */
export interface Notification {
  id: string;
  userPublicKey: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
  data?: Record<string, any>;
  read: boolean;
  createdAt: number;
}

/**
 * Notification channel interface
 */
export interface NotificationChannel {
  name: string;
  send(notification: Notification): Promise<boolean>;
}

/**
 * In-app notification channel (stores in database)
 */
class InAppChannel implements NotificationChannel {
  name = 'in-app';

  constructor(private readonly db: DatabaseService) {}

  async send(notification: Notification): Promise<boolean> {
    try {
      await this.db.saveNotification(notification);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Console/Log notification channel (for debugging)
 */
class LogChannel implements NotificationChannel {
  name = 'log';
  private readonly log = logger.child({ service: 'NotificationLog' });

  async send(notification: Notification): Promise<boolean> {
    this.log.info(
      {
        type: notification.type,
        user: notification.userPublicKey.slice(0, 8) + '...',
        title: notification.title,
      },
      `Notification: ${notification.message}`
    );
    return true;
  }
}

/**
 * Webhook notification channel
 */
class WebhookChannel implements NotificationChannel {
  name = 'webhook';
  private readonly log = logger.child({ service: 'NotificationWebhook' });

  constructor(private readonly webhookUrl?: string) {}

  async send(notification: Notification): Promise<boolean> {
    if (!this.webhookUrl) return false;

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: notification.type,
          user: notification.userPublicKey,
          title: notification.title,
          message: notification.message,
          data: notification.data,
          timestamp: notification.createdAt,
        }),
      });

      return response.ok;
    } catch (error) {
      this.log.error({ error }, 'Webhook notification failed');
      return false;
    }
  }
}

/**
 * Notification Service
 *
 * Manages user notifications across multiple channels.
 */
export class NotificationService {
  private readonly log = logger.child({ service: 'NotificationService' });
  private readonly channels: NotificationChannel[] = [];

  constructor(private readonly db: DatabaseService) {
    // Register default channels
    this.channels.push(new InAppChannel(db));
    this.channels.push(new LogChannel());

    // Add webhook channel if configured
    const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;
    if (webhookUrl) {
      this.channels.push(new WebhookChannel(webhookUrl));
    }

    this.log.info(
      { channels: this.channels.map((c) => c.name) },
      'NotificationService initialized'
    );
  }

  /**
   * Send a notification
   */
  async notify(
    userPublicKey: string,
    type: NotificationType,
    title: string,
    message: string,
    data?: Record<string, any>,
    priority: NotificationPriority = NotificationPriority.MEDIUM
  ): Promise<void> {
    const notification: Notification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      userPublicKey,
      type,
      priority,
      title,
      message,
      data,
      read: false,
      createdAt: Date.now(),
    };

    // Send to all channels in parallel
    const results = await Promise.allSettled(
      this.channels.map((channel) => channel.send(notification))
    );

    const successCount = results.filter(
      (r) => r.status === 'fulfilled' && r.value
    ).length;

    this.log.debug(
      {
        notificationId: notification.id,
        type,
        successCount,
        totalChannels: this.channels.length,
      },
      'Notification sent'
    );
  }

  // ==================== DCA Notifications ====================

  /**
   * Notify DCA slice executed
   */
  async notifyDCAExecuted(
    userPublicKey: string,
    intentId: string,
    amountSwapped: string,
    tokenFrom: string,
    tokenTo: string,
    executionCount: number,
    totalOrders: number
  ): Promise<void> {
    await this.notify(
      userPublicKey,
      NotificationType.DCA_EXECUTED,
      'DCA Order Executed',
      `Swapped ${amountSwapped} ${tokenFrom} to ${tokenTo} (${executionCount}/${totalOrders})`,
      { intentId, amountSwapped, tokenFrom, tokenTo, executionCount, totalOrders },
      NotificationPriority.LOW
    );
  }

  /**
   * Notify DCA completed
   */
  async notifyDCACompleted(
    userPublicKey: string,
    intentId: string,
    totalAmount: string,
    tokenFrom: string,
    tokenTo: string,
    totalOrders: number
  ): Promise<void> {
    await this.notify(
      userPublicKey,
      NotificationType.DCA_COMPLETED,
      'DCA Order Completed 🎉',
      `Successfully completed all ${totalOrders} orders. Total: ${totalAmount} ${tokenFrom} → ${tokenTo}`,
      { intentId, totalAmount, tokenFrom, tokenTo, totalOrders },
      NotificationPriority.MEDIUM
    );
  }

  /**
   * Notify DCA failed
   */
  async notifyDCAFailed(
    userPublicKey: string,
    intentId: string,
    error: string,
    executionCount: number
  ): Promise<void> {
    await this.notify(
      userPublicKey,
      NotificationType.DCA_FAILED,
      'DCA Order Failed ⚠️',
      `Order #${executionCount} failed: ${error}. The DCA will continue with the next scheduled order.`,
      { intentId, error, executionCount },
      NotificationPriority.HIGH
    );
  }

  // ==================== Stop-Loss Notifications ====================

  /**
   * Notify stop-loss triggered
   */
  async notifyStopLossTriggered(
    userPublicKey: string,
    intentId: string,
    currentPrice: number,
    triggerPrice: number,
    token: string
  ): Promise<void> {
    await this.notify(
      userPublicKey,
      NotificationType.STOP_LOSS_TRIGGERED,
      'Stop-Loss Triggered ⚡',
      `${token} price ($${currentPrice.toFixed(2)}) hit your trigger at $${triggerPrice.toFixed(2)}. Executing...`,
      { intentId, currentPrice, triggerPrice, token },
      NotificationPriority.URGENT
    );
  }

  /**
   * Notify stop-loss executed
   */
  async notifyStopLossExecuted(
    userPublicKey: string,
    intentId: string,
    amount: string,
    tokenFrom: string,
    tokenTo: string,
    executionPrice: number,
    txSignature?: string
  ): Promise<void> {
    await this.notify(
      userPublicKey,
      NotificationType.STOP_LOSS_EXECUTED,
      'Stop-Loss Executed ✅',
      `Successfully sold ${amount} ${tokenFrom} at ~$${executionPrice.toFixed(2)} → ${tokenTo}`,
      { intentId, amount, tokenFrom, tokenTo, executionPrice, txSignature },
      NotificationPriority.HIGH
    );
  }

  /**
   * Notify stop-loss failed
   */
  async notifyStopLossFailed(
    userPublicKey: string,
    intentId: string,
    error: string
  ): Promise<void> {
    await this.notify(
      userPublicKey,
      NotificationType.STOP_LOSS_FAILED,
      'Stop-Loss Failed ❌',
      `Failed to execute stop-loss: ${error}. Please check your position manually.`,
      { intentId, error },
      NotificationPriority.URGENT
    );
  }

  // ==================== Swap Notifications ====================

  /**
   * Notify swap success
   */
  async notifySwapSuccess(
    userPublicKey: string,
    receiptId: string,
    inAmount: string,
    outAmount: string,
    tokenFrom: string,
    tokenTo: string,
    txSignature: string
  ): Promise<void> {
    await this.notify(
      userPublicKey,
      NotificationType.SWAP_SUCCESS,
      'Swap Completed ✅',
      `Swapped ${inAmount} ${tokenFrom} → ${outAmount} ${tokenTo}`,
      { receiptId, inAmount, outAmount, tokenFrom, tokenTo, txSignature },
      NotificationPriority.LOW
    );
  }

  /**
   * Notify swap failed
   */
  async notifySwapFailed(
    userPublicKey: string,
    receiptId: string,
    error: string,
    tokenFrom: string,
    tokenTo: string
  ): Promise<void> {
    await this.notify(
      userPublicKey,
      NotificationType.SWAP_FAILED,
      'Swap Failed ❌',
      `Failed to swap ${tokenFrom} → ${tokenTo}: ${error}`,
      { receiptId, error, tokenFrom, tokenTo },
      NotificationPriority.MEDIUM
    );
  }

  // ==================== Query Methods ====================

  /**
   * Get user's notifications
   */
  async getUserNotifications(
    userPublicKey: string,
    limit = 50,
    unreadOnly = false
  ): Promise<Notification[]> {
    return this.db.getUserNotifications(userPublicKey, limit, unreadOnly);
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string): Promise<void> {
    await this.db.markNotificationAsRead(notificationId);
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(userPublicKey: string): Promise<void> {
    await this.db.markAllNotificationsAsRead(userPublicKey);
  }

  /**
   * Get unread count
   */
  async getUnreadCount(userPublicKey: string): Promise<number> {
    return this.db.getUnreadNotificationCount(userPublicKey);
  }
}
