/**
 * Notification Service Tests
 *
 * Unit tests for the Notification Service.
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';

// Mock DatabaseService
const mockDb = {
  saveNotification: jest.fn().mockResolvedValue(undefined),
  getUserNotifications: jest.fn().mockResolvedValue([]),
  markNotificationRead: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../db/database.js', () => ({
  DatabaseService: jest.fn().mockImplementation(() => mockDb),
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

describe('NotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Notification Types', () => {
    it('should export all notification types', async () => {
      const { NotificationType } = await import('../services/notificationService.js');

      expect(NotificationType.DCA_EXECUTED).toBeDefined();
      expect(NotificationType.STOP_LOSS_TRIGGERED).toBeDefined();
      expect(NotificationType.SWAP_SUCCESS).toBeDefined();
      expect(NotificationType.SWAP_FAILED).toBeDefined();
      expect(NotificationType.INTENT_COMPLETED).toBeDefined();
    });

    it('should export all priority levels', async () => {
      const { NotificationPriority } = await import('../services/notificationService.js');

      expect(NotificationPriority.LOW).toBeDefined();
      expect(NotificationPriority.NORMAL).toBeDefined();
      expect(NotificationPriority.HIGH).toBeDefined();
      expect(NotificationPriority.URGENT).toBeDefined();
    });
  });

  describe('Static Methods', () => {
    it('should initialize service with database', async () => {
      const { NotificationService } = await import('../services/notificationService.js');
      const { DatabaseService } = await import('../db/database.js');

      const db = new DatabaseService(':memory:');
      NotificationService.initialize(db);

      // Should not throw
      expect(true).toBe(true);
    });

    it('should send notification via notify method', async () => {
      const { NotificationService, NotificationType, NotificationPriority } =
        await import('../services/notificationService.js');
      const { DatabaseService } = await import('../db/database.js');

      const db = new DatabaseService(':memory:');
      NotificationService.initialize(db);

      await NotificationService.notify({
        userId: 'test-user-public-key',
        type: NotificationType.SWAP_SUCCESS,
        title: 'Test Notification',
        message: 'This is a test',
        priority: NotificationPriority.NORMAL,
      });

      // Verify DB was called
      expect(mockDb.saveNotification).toHaveBeenCalled();
    });
  });

  describe('DCA Notifications', () => {
    it('should send DCA executed notification on success', async () => {
      const { NotificationService } = await import('../services/notificationService.js');
      const { DatabaseService } = await import('../db/database.js');

      const db = new DatabaseService(':memory:');
      NotificationService.initialize(db);

      await NotificationService.notifyDCAExecuted(
        'user-public-key',
        'intent-123',
        5,
        '1000000000',
        true
      );

      expect(mockDb.saveNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-public-key',
          type: expect.stringMatching(/DCA/i),
        })
      );
    });

    it('should send DCA failure notification with error', async () => {
      const { NotificationService } = await import('../services/notificationService.js');
      const { DatabaseService } = await import('../db/database.js');

      const db = new DatabaseService(':memory:');
      NotificationService.initialize(db);

      await NotificationService.notifyDCAExecuted(
        'user-public-key',
        'intent-123',
        3,
        '500000000',
        false,
        'Transaction simulation failed'
      );

      expect(mockDb.saveNotification).toHaveBeenCalled();
    });
  });

  describe('Stop-Loss Notifications', () => {
    it('should send stop-loss triggered notification', async () => {
      const { NotificationService } = await import('../services/notificationService.js');
      const { DatabaseService } = await import('../db/database.js');

      const db = new DatabaseService(':memory:');
      NotificationService.initialize(db);

      await NotificationService.notifyStopLossTriggered(
        'user-public-key',
        'intent-456',
        100.0,
        98.5,
        true
      );

      expect(mockDb.saveNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-public-key',
          type: expect.stringMatching(/STOP_LOSS/i),
        })
      );
    });

    it('should include price information in stop-loss notification', async () => {
      const { NotificationService } = await import('../services/notificationService.js');
      const { DatabaseService } = await import('../db/database.js');

      const db = new DatabaseService(':memory:');
      NotificationService.initialize(db);

      await NotificationService.notifyStopLossTriggered(
        'user-public-key',
        'intent-789',
        50.0,
        48.0,
        true
      );

      const call = mockDb.saveNotification.mock.calls[0][0];
      expect(call.metadata).toBeDefined();
      expect(call.metadata.triggerPrice).toBe(50.0);
      expect(call.metadata.currentPrice).toBe(48.0);
    });
  });

  describe('Swap Notifications', () => {
    it('should send swap success notification', async () => {
      const { NotificationService } = await import('../services/notificationService.js');
      const { DatabaseService } = await import('../db/database.js');

      const db = new DatabaseService(':memory:');
      NotificationService.initialize(db);

      await NotificationService.notifySwapSuccess(
        'user-public-key',
        'receipt-abc',
        '1000000000',
        '950000'
      );

      expect(mockDb.saveNotification).toHaveBeenCalled();
    });

    it('should send swap failed notification', async () => {
      const { NotificationService } = await import('../services/notificationService.js');
      const { DatabaseService } = await import('../db/database.js');

      const db = new DatabaseService(':memory:');
      NotificationService.initialize(db);

      await NotificationService.notifySwapFailed(
        'user-public-key',
        'receipt-def',
        'Slippage exceeded'
      );

      expect(mockDb.saveNotification).toHaveBeenCalled();
    });
  });
});
