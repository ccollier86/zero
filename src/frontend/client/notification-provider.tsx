'use client';

import {
  createContext,
  useContext,
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
  UseNotificationsResult,
} from './notification-hooks';
import { NotificationFeedbackProvider, useNotificationFeedbackMaybe } from './notification-feedback-provider';

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
export function NotificationProvider(props: NotificationProviderProps) {
  const feedback = useNotificationFeedbackMaybe();
  // Custom ClientProvider hosts get the same policy without another Sync client.
  return feedback
    ? createElement(NotificationStateProvider, props)
    : createElement(NotificationFeedbackProvider, { children: createElement(NotificationStateProvider, props) });
}

function NotificationStateProvider({
  autoToast = true,
  toastDuration = 5000,
  renderToast,
  children,
}: NotificationProviderProps) {
  const result = useNotifications();
  const feedback = useNotificationFeedbackMaybe()!;

  // Auto-toast on new notifications
  // Hook must be called unconditionally (Rules of Hooks) — guard inside the callback
  useOnNewNotification((n: Notification) => {
    feedback.feedback.observe(n);
    if (!autoToast || !feedback.feedback.claimToast(n)) return;
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
