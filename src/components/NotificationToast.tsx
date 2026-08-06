import React, { useCallback, useEffect, useState } from 'react';
import { X, AlertTriangle, CheckCircle2, Info, Bell, XCircle } from 'lucide-react';
import type { AlertEvent } from '../services/bwtsApi';

export interface ToastNotification {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
  pair?: string;
  alertType?: string;
  timestamp: number;
  read: boolean;
}

interface NotificationToastProps {
  notification: ToastNotification;
  onDismiss: (id: string) => void;
  onClick?: (notification: ToastNotification) => void;
}

const severityConfig = {
  info: {
    icon: Info,
    border: 'border-cyan-400/30',
    bg: 'bg-cyan-400/[0.08]',
    accent: 'text-cyan-300',
    glow: 'shadow-cyan-400/10',
  },
  warning: {
    icon: AlertTriangle,
    border: 'border-amber-400/30',
    bg: 'bg-amber-400/[0.08]',
    accent: 'text-amber-300',
    glow: 'shadow-amber-400/10',
  },
  critical: {
    icon: XCircle,
    border: 'border-rose-400/30',
    bg: 'bg-rose-400/[0.08]',
    accent: 'text-rose-300',
    glow: 'shadow-rose-400/10',
  },
};

const NotificationToast: React.FC<NotificationToastProps> = ({ notification, onDismiss, onClick }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const config = severityConfig[notification.severity] || severityConfig.info;
  const Icon = config.icon;

  useEffect(() => {
    // Slide in
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => onDismiss(notification.id), 300);
  }, [notification.id, onDismiss]);

  // Auto-dismiss after 8 seconds for info, 15 for warning, never for critical
  useEffect(() => {
    if (notification.severity === 'critical') return;
    const duration = notification.severity === 'warning' ? 15000 : 8000;
    const timer = setTimeout(handleDismiss, duration);
    return () => clearTimeout(timer);
  }, [notification.severity, handleDismiss]);

  return (
    <div
      className={`
        pointer-events-auto w-full max-w-sm overflow-hidden rounded-2xl border
        ${config.border} ${config.bg} backdrop-blur-xl shadow-lg ${config.glow}
        transition-all duration-300 ease-out cursor-pointer
        ${isVisible && !isExiting ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
      `}
      onClick={() => onClick?.(notification)}
      role="alert"
    >
      <div className="flex items-start gap-3 p-4">
        <div className={`mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg border ${config.border} ${config.bg}`}>
          <Icon className={`h-4 w-4 ${config.accent}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-bold text-white">{notification.title}</p>
            <button
              onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
              className="flex-none rounded-md p-1 transition hover:bg-white/10"
              aria-label="Dismiss notification"
            >
              <X className="h-3.5 w-3.5 text-gray-400" />
            </button>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-gray-300">{notification.body}</p>
          <div className="mt-2 flex items-center gap-2">
            {notification.pair && (
              <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${config.border} ${config.bg} ${config.accent}`}>
                {notification.pair}
              </span>
            )}
            <span className="text-[10px] text-gray-500">
              {new Date(notification.timestamp).toLocaleTimeString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Toast Container ──────────────────────────────────────────────────

interface ToastContainerProps {
  notifications: ToastNotification[];
  onDismiss: (id: string) => void;
  onClick?: (notification: ToastNotification) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ notifications, onDismiss, onClick }) => {
  if (notifications.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex max-h-[80vh] w-full max-w-sm flex-col-reverse gap-2 pointer-events-none">
      {notifications.map((n) => (
        <NotificationToast key={n.id} notification={n} onDismiss={onDismiss} onClick={onClick} />
      ))}
    </div>
  );
};

// ── Helper: create a ToastNotification from an AlertEvent ────────────

export function alertEventToToast(event: AlertEvent): ToastNotification {
  return {
    id: `${event.created_at}-${event.pair}-${event.alert_type}`,
    title: event.title,
    body: event.body,
    severity: event.severity,
    pair: event.pair,
    alertType: event.alert_type,
    timestamp: new Date(event.created_at).getTime(),
    read: false,
  };
}

export default NotificationToast;
