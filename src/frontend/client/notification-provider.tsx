'use client';

import {
  createContext,
  useContext,
  useRef,
  createElement,
} from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
  useNotifications,
  useOnNewNotification,
} from './notification-hooks';
import type {
  Notification,
  NotificationWithStatus,
  UseNotificationsResult,
} from './notification-hooks';

// ─── Context ─────────────────────────────────────────────────────────────────

const NotificationContext = createContext<UseNotificationsResult | null>(null);

/**
 * Access notification state + actions from context.
 * Must be used inside `<NotificationProvider>`.
 */
export function useNotificationContext(): UseNotificationsResult {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error(
      'useNotificationContext must be used within a <NotificationProvider>',
    );
  }
  return ctx;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export interface NotificationProviderProps {
  /** Fire toast on new notification. Default: true */
  autoToast?: boolean;
  /** Toast duration ms. Default: 5000 */
  toastDuration?: number;
  /** Custom toast render. Return null to suppress. */
  renderToast?: (notification: Notification) => ReactNode;
  children: ReactNode;
}

/**
 * Provides notification state to all descendants and optionally shows
 * toasts for new notifications via Sonner.
 *
 * Place inside `<ClientProvider>` (needs auth + collections).
 *
 * @example
 * ```tsx
 * <ClientProvider client={client}>
 *   <NotificationProvider>
 *     <App />
 *   </NotificationProvider>
 * </ClientProvider>
 * ```
 */
export function NotificationProvider({
  autoToast = true,
  toastDuration = 5000,
  renderToast,
  children,
}: NotificationProviderProps) {
  const result = useNotifications();

  // Auto-toast on new notifications
  // Hook must be called unconditionally (Rules of Hooks) — guard inside the callback
  useOnNewNotification((n: Notification) => {
    if (!autoToast) return;
    if (renderToast) {
      const content = renderToast(n);
      if (content !== null) {
        toast(content as string, { duration: toastDuration });
      }
    } else {
      toast(n.title, {
        description: n.body ?? undefined,
        duration: toastDuration,
      });
    }
  });

  return createElement(
    NotificationContext.Provider,
    { value: result },
    children,
  );
}
