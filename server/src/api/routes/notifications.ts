/**
 * Notification API Routes
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import { DatabaseService } from '../../db/database.js';
import { NotificationService } from '../../services/notificationService.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ route: 'notifications' });

/**
 * Create notification routes
 */
export function createNotificationRoutes(db: DatabaseService): Router {
  const router = Router();
  const notificationService = new NotificationService(db);

  /**
   * GET /api/v1/notifications/:userPublicKey
   *
   * Get user's notifications
   */
  router.get('/:userPublicKey', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userPublicKey } = req.params;
      const limit = parseInt(req.query.limit as string, 10) || 50;
      const unreadOnly = req.query.unreadOnly === 'true';

      const notifications = await notificationService.getUserNotifications(
        userPublicKey,
        limit,
        unreadOnly
      );

      const unreadCount = await notificationService.getUnreadCount(userPublicKey);

      res.json({
        success: true,
        data: {
          notifications,
          unreadCount,
          total: notifications.length,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/notifications/:userPublicKey/unread-count
   *
   * Get unread notification count
   */
  router.get('/:userPublicKey/unread-count', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userPublicKey } = req.params;
      const count = await notificationService.getUnreadCount(userPublicKey);

      res.json({
        success: true,
        data: { count },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/v1/notifications/:id/read
   *
   * Mark notification as read
   */
  router.post('/:id/read', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      await notificationService.markAsRead(id);

      res.json({
        success: true,
        message: 'Notification marked as read',
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/v1/notifications/:userPublicKey/read-all
   *
   * Mark all notifications as read
   */
  router.post('/:userPublicKey/read-all', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userPublicKey } = req.params;
      await notificationService.markAllAsRead(userPublicKey);

      res.json({
        success: true,
        message: 'All notifications marked as read',
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
