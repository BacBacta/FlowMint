/**
 * Notification Bell Component
 *
 * Displays a bell icon with unread notification count badge.
 * Opens a dropdown panel showing recent notifications.
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Bell, Check, CheckCheck, X } from 'lucide-react';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  priority: string;
  read: boolean;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

export function NotificationBell() {
  const { publicKey } = useWallet();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch notifications
  const fetchNotifications = async () => {
    if (!publicKey) return;

    try {
      setIsLoading(true);
      const response = await fetch(`${API_BASE}/notifications/${publicKey.toBase58()}?limit=20`);
      if (response.ok) {
        const data = await response.json();
        setNotifications(data.notifications || []);
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch unread count
  const fetchUnreadCount = async () => {
    if (!publicKey) return;

    try {
      const response = await fetch(
        `${API_BASE}/notifications/${publicKey.toBase58()}/unread-count`
      );
      if (response.ok) {
        const data = await response.json();
        setUnreadCount(data.count || 0);
      }
    } catch (error) {
      console.error('Failed to fetch unread count:', error);
    }
  };

  // Mark notification as read
  const markAsRead = async (notificationId: string) => {
    if (!publicKey) return;

    try {
      await fetch(`${API_BASE}/notifications/${notificationId}/read`, {
        method: 'POST',
      });

      setNotifications(prev => prev.map(n => (n.id === notificationId ? { ...n, read: true } : n)));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  };

  // Mark all as read
  const markAllAsRead = async () => {
    if (!publicKey) return;

    try {
      await fetch(`${API_BASE}/notifications/${publicKey.toBase58()}/read-all`, {
        method: 'POST',
      });

      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  };

  // Fetch on mount and when wallet changes
  useEffect(() => {
    if (publicKey) {
      fetchNotifications();
      fetchUnreadCount();

      // Poll for new notifications every 30 seconds
      const interval = setInterval(fetchUnreadCount, 30000);
      return () => clearInterval(interval);
    } else {
      setNotifications([]);
      setUnreadCount(0);
    }
  }, [publicKey]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Format timestamp
  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "À l'instant";
    if (minutes < 60) return `Il y a ${minutes}m`;
    if (hours < 24) return `Il y a ${hours}h`;
    return `Il y a ${days}j`;
  };

  // Get notification icon based on type
  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'dca_executed':
        return '🔄';
      case 'stop_loss_triggered':
        return '⚠️';
      case 'swap_success':
        return '✅';
      case 'swap_failed':
        return '❌';
      case 'intent_completed':
        return '🎉';
      default:
        return '📢';
    }
  };

  // Get priority color
  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'border-l-red-500';
      case 'high':
        return 'border-l-orange-500';
      case 'normal':
        return 'border-l-blue-500';
      default:
        return 'border-l-gray-500';
    }
  };

  if (!publicKey) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) fetchNotifications();
        }}
        className="relative rounded-lg p-2 transition-colors hover:bg-gray-700"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5 text-gray-300" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div className="absolute right-0 z-50 mt-2 flex max-h-[70vh] w-80 flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-800 shadow-xl md:w-96">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-700 p-4">
            <h3 className="font-semibold text-white">Notifications</h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                >
                  <CheckCheck className="h-4 w-4" />
                  Tout marquer lu
                </button>
              )}
              <button onClick={() => setIsOpen(false)} className="rounded p-1 hover:bg-gray-700">
                <X className="h-4 w-4 text-gray-400" />
              </button>
            </div>
          </div>

          {/* Notification list */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-8 text-center text-gray-400">
                <div className="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                Chargement...
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <Bell className="mx-auto mb-2 h-12 w-12 opacity-50" />
                <p>Aucune notification</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-700">
                {notifications.map(notification => (
                  <li
                    key={notification.id}
                    className={`hover:bg-gray-750 border-l-4 p-4 transition-colors ${getPriorityColor(notification.priority)} ${
                      !notification.read ? 'bg-gray-750' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="flex-shrink-0 text-xl">
                        {getNotificationIcon(notification.type)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="truncate font-medium text-white">{notification.title}</h4>
                          <span className="flex-shrink-0 text-xs text-gray-500">
                            {formatTime(notification.createdAt)}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-gray-400">
                          {notification.message}
                        </p>
                        {!notification.read && (
                          <button
                            onClick={() => markAsRead(notification.id)}
                            className="mt-2 flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                          >
                            <Check className="h-3 w-3" />
                            Marquer comme lu
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="border-t border-gray-700 p-3 text-center">
              <a href="/notifications" className="text-sm text-blue-400 hover:text-blue-300">
                Voir toutes les notifications
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
