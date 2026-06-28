import { useCallback, useMemo, useRef, useEffect } from 'react';
import { useCollection, useAuth, useClientMaybe } from './hooks';
import type { Row } from '../../sync/types';
import { OBS_CODES } from '../../observability/codes';
import { emitFrontendCode } from './observability';

// ─── Client-Side Types (snake_case — matches SQLite columns) ─────────────────

export interface Notification {
  notification_id: string;
  type: string;
  priority: string;
  title: string;
  body: string | null;
  target_type: string;
  target_value: string | null;
  sender_id: string | null;
  action_url: string | null;
  metadata: string | null;
  created_at: number;
  expires_at: number | null;
}

export interface NotificationReceipt {
  receipt_id: string;
  notification_id: string;
  user_id: string;
  seen_at: number | null;
  read_at: number | null;
  dismissed_at: number | null;
}

export interface NotificationWithStatus extends Notification {
  seen: boolean;
  read: boolean;
  dismissed: boolean;
  receipt: NotificationReceipt | null;
}

// ─── Target Matching ─────────────────────────────────────────────────────────

function isForUser(n: Notification, userId: string, role: string): boolean {
  switch (n.target_type) {
    case 'all':
      return true;
    case 'user':
      return n.target_value === userId;
    case 'users': {
      if (!n.target_value) return false;
      try {
        return (JSON.parse(n.target_value) as string[]).includes(userId);
      } catch {
        return false;
      }
    }
    case 'role':
      return n.target_value === role;
    default:
      return false;
  }
}

// ─── useNotifications ────────────────────────────────────────────────────────

export interface UseNotificationsResult {
  notifications: NotificationWithStatus[];
  unreadCount: number;
  unseenCount: number;
  markSeen: (notificationId: string) => void;
  markRead: (notificationId: string) => void;
  dismiss: (notificationId: string) => void;
  markAllRead: () => void;
  markAllSeen: () => void;
}

/**
 * Full notification state + actions for the current user.
 * Automatically filters by target match (user, role, broadcast).
 * Must be used inside a `<ClientProvider>`.
 */
export function useNotifications(): UseNotificationsResult {
  const { user } = useAuth();
  const client = useClientMaybe();
  const userId = user?.userId ?? '';
  const role = user?.role ?? 'user';

  const notifs = useCollection<Notification & Row>('notifications');
  const receipts = useCollection<NotificationReceipt & Row>('notification_receipts');

  // Build receipt lookup by notification_id for current user
  const receiptMap = useMemo(() => {
    const map = new Map<string, NotificationReceipt>();
    for (const r of receipts.data) {
      if (r.user_id === userId) {
        map.set(r.notification_id, r);
      }
    }
    return map;
  }, [receipts.data, userId]);

  // Filter + enrich notifications for current user
  const notifications = useMemo(() => {
    if (!userId) return [];

    return notifs.data
      .filter((n) => isForUser(n, userId, role))
      .filter((n) => {
        const receipt = receiptMap.get(n.notification_id);
        return !receipt?.dismissed_at;
      })
      .map((n): NotificationWithStatus => {
        const receipt = receiptMap.get(n.notification_id) ?? null;
        return {
          ...n,
          seen: receipt?.seen_at != null,
          read: receipt?.read_at != null,
          dismissed: receipt?.dismissed_at != null,
          receipt,
        };
      })
      .sort((a, b) => b.created_at - a.created_at);
  }, [notifs.data, receiptMap, userId, role]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const unseenCount = useMemo(
    () => notifications.filter((n) => !n.seen).length,
    [notifications],
  );

  // ─── Actions (authorized HTTP writes; ReactiveDB broadcasts receipt changes) ──

  const postReceiptAction = useCallback(
    (path: string) => {
      if (!client || !userId) return;
      void client.post(path).catch((err) => {
        emitFrontendCode(OBS_CODES.FRONTEND_NOTIFICATION_RECEIPT_FAILED, {
          error: err,
          metadata: { path },
        });
      });
    },
    [client, userId],
  );

  const markSeen = useCallback(
    (notificationId: string) => {
      const existing = receiptMap.get(notificationId);
      if (existing?.seen_at) return;
      postReceiptAction(`/notifications/${encodeURIComponent(notificationId)}/seen`);
    },
    [receiptMap, postReceiptAction],
  );

  const markRead = useCallback(
    (notificationId: string) => {
      const existing = receiptMap.get(notificationId);
      if (existing?.read_at) return;
      postReceiptAction(`/notifications/${encodeURIComponent(notificationId)}/read`);
    },
    [receiptMap, postReceiptAction],
  );

  const dismiss = useCallback(
    (notificationId: string) => {
      postReceiptAction(`/notifications/${encodeURIComponent(notificationId)}/dismiss`);
    },
    [postReceiptAction],
  );

  const markAllRead = useCallback(() => {
    if (!notifications.some((n) => !n.read)) return;
    postReceiptAction('/notifications/read-all');
  }, [notifications, postReceiptAction]);

  const markAllSeen = useCallback(() => {
    if (!notifications.some((n) => !n.seen)) return;
    postReceiptAction('/notifications/seen-all');
  }, [notifications, postReceiptAction]);

  return {
    notifications,
    unreadCount,
    unseenCount,
    markSeen,
    markRead,
    dismiss,
    markAllRead,
    markAllSeen,
  };
}

// ─── useUnreadCount ──────────────────────────────────────────────────────────

/** Lightweight hook for badge — just the unread count. */
export function useUnreadCount(): number {
  const { unreadCount } = useNotifications();
  return unreadCount;
}

// ─── useOnNewNotification ────────────────────────────────────────────────────

/**
 * Fires callback when a new notification arrives for this user.
 * Uses a seenIds set to deduplicate — all notifications present at mount
 * are pre-seeded, so only genuinely new arrivals trigger the callback.
 * No timestamp comparison avoids clock-skew issues between server and client.
 */
export function useOnNewNotification(
  callback: (n: Notification) => void,
): void {
  const { user } = useAuth();
  const userId = user?.userId ?? '';
  const role = user?.role ?? 'user';
  const notifs = useCollection<Notification & Row>('notifications');

  const seenIds = useRef(new Set<string>());
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  // Pre-seed with all notifications present at mount (prevents re-firing on load/reconnect)
  const initialized = useRef(false);
  if (!initialized.current) {
    for (const n of notifs.data) {
      seenIds.current.add(n.notification_id);
    }
    initialized.current = true;
  }

  useEffect(() => {
    if (!userId) return;

    for (const n of notifs.data) {
      if (
        !seenIds.current.has(n.notification_id) &&
        isForUser(n, userId, role)
      ) {
        seenIds.current.add(n.notification_id);
        callbackRef.current(n);
      }
    }
  }, [notifs.data, userId, role]);
}
