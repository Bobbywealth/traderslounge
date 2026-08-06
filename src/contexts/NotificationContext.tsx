import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import bwtsApi, { type AlertEvent } from '../services/bwtsApi';
import { isPushSupported, getPushStatus, requestPushPermissionAndSubscribe, unsubscribeFromPush, resyncExistingSubscription, type PushSubscriptionStatus } from '../services/pushNotificationService';
import { ToastContainer, alertEventToToast, type ToastNotification } from '../components/NotificationToast';

interface NotificationContextValue {
  /** Current push subscription status */
  pushStatus: PushSubscriptionStatus;
  /** Request push permission and subscribe */
  enablePush: () => Promise<void>;
  /** Unsubscribe from push */
  disablePush: () => Promise<void>;
  /** Number of unread notifications */
  unreadCount: number;
  /** All recent notifications (last 50) */
  notifications: ToastNotification[];
  /** Mark a notification as read */
  markRead: (id: string) => void;
  /** Mark all as read */
  markAllRead: () => void;
  /** Manually dismiss a toast */
  dismissToast: (id: string) => void;
  /** Whether polling is active */
  isPolling: boolean;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const MAX_TOASTS = 5; // Max visible toasts at once
const MAX_HISTORY = 50; // Max stored notifications

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const [pushStatus, setPushStatus] = useState<PushSubscriptionStatus>({
    supported: false,
    permission: 'default',
    subscribed: false,
    subscription: null,
  });
  const [notifications, setNotifications] = useState<ToastNotification[]>([]);
  const [activeToasts, setActiveToasts] = useState<ToastNotification[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const lastPollRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initialize push status on mount
  useEffect(() => {
    getPushStatus().then(setPushStatus);
    // Re-sync any existing subscription with the backend
    resyncExistingSubscription();
  }, []);

  // Poll for new alerts
  const pollAlerts = useCallback(async () => {
    try {
      const result = await bwtsApi.alertFeed(10);
      const events: AlertEvent[] = result.events || [];
      if (events.length === 0) return;

      const latestKey = `${events[0].created_at}-${events[0].pair}`;
      if (lastPollRef.current === latestKey) return;
      lastPollRef.current = latestKey;

      // Only show toasts for new events (first poll skips toasts)
      if (lastPollRef.current !== null) {
        const newToasts = events
          .slice(0, 3) // Max 3 new toasts per poll
          .map(alertEventToToast)
          .filter((t) => !activeToasts.some((at) => at.id === t.id));

        if (newToasts.length > 0) {
          setActiveToasts((prev) => [...newToasts, ...prev].slice(0, MAX_TOASTS));
          setNotifications((prev) => [...newToasts, ...prev].slice(0, MAX_HISTORY));
        }
      }
    } catch {
      // Silent — polling failures shouldn't disrupt the UI
    }
  }, [activeToasts]);

  // Start/stop polling
  useEffect(() => {
    // Initial poll
    pollAlerts();

    pollTimerRef.current = setInterval(pollAlerts, POLL_INTERVAL_MS);
    setIsPolling(true);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
      setIsPolling(false);
    };
  }, [pollAlerts]);

  const enablePush = useCallback(async () => {
    await requestPushPermissionAndSubscribe();
    const status = await getPushStatus();
    setPushStatus(status);
  }, []);

  const disablePush = useCallback(async () => {
    await unsubscribeFromPush();
    const status = await getPushStatus();
    setPushStatus(status);
  }, []);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const dismissToast = useCallback((id: string) => {
    setActiveToasts((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const handleToastClick = useCallback((notification: ToastNotification) => {
    markRead(notification.id);
    dismissToast(notification.id);
    if (notification.pair) {
      navigate(`/tradingview?symbol=${notification.pair}`);
    } else {
      navigate('/alerts');
    }
  }, [navigate, markRead, dismissToast]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const value: NotificationContextValue = {
    pushStatus,
    enablePush,
    disablePush,
    unreadCount,
    notifications,
    markRead,
    markAllRead,
    dismissToast,
    isPolling,
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <ToastContainer
        notifications={activeToasts}
        onDismiss={dismissToast}
        onClick={handleToastClick}
      />
    </NotificationContext.Provider>
  );
};

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return ctx;
}

export default NotificationContext;
