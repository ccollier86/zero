import { useCallback, useMemo, useRef, useEffect } from 'react';
import { useAuth } from './auth-hooks';
import { useClientMaybe } from './client-context';
import { useCollection } from './data-hooks';
import type { Row } from '../../sync/types';
import { OBS_CODES } from '../../observability/codes';
import { emitFrontendCode } from './observability';
import { useAuthorizationScopeBoundary } from './authorization-scope-hooks';

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

function isForUser(n: Notification, userId: string): boolean {
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
      // Managed Sync has already matched this row against the server-owned,
      // live effective role set. The browser only knows the platform account
      // role here; rechecking that value would incorrectly discard tenant
      // roles and additive advanced-RBAC roles. This is display filtering, not
      // an authorization boundary.
      return true;
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
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const userId = authorizationBoundary.ready ? user?.userId ?? '' : '';
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;

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
      .filter((n) => isForUser(n, userId))
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
  }, [notifs.data, receiptMap, userId]);

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
      if (!client
        || !userId
        || !boundaryReadyRef.current
        || boundaryKeyRef.current !== callbackBoundaryKey) return;
      const requestBoundaryKey = callbackBoundaryKey;
      void client.post(path).catch((err) => {
        if (!boundaryReadyRef.current
          || boundaryKeyRef.current !== requestBoundaryKey) return;
        emitFrontendCode(OBS_CODES.FRONTEND_NOTIFICATION_RECEIPT_FAILED, {
          error: err,
          metadata: { path },
        });
      });
    },
    [callbackBoundaryKey, client, userId],
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
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const userId = authorizationBoundary.ready ? user?.userId ?? '' : '';
  const notifs = useCollection<Notification & Row>('notifications');

  const seenIds = useRef(new Set<string>());
  const callbackRef = useRef(callback);
  const initializedBoundaryKeyRef = useRef<string | null>(null);
  callbackRef.current = callback;

  // Pre-seed each committed scope independently. IDs from one account or
  // tenant must neither suppress callbacks nor be retained in another.
  if (initializedBoundaryKeyRef.current !== authorizationBoundary.key) {
    seenIds.current = new Set<string>();
    initializedBoundaryKeyRef.current = null;
  }
  if (authorizationBoundary.ready && initializedBoundaryKeyRef.current === null) {
    for (const n of notifs.data) {
      seenIds.current.add(n.notification_id);
    }
    initializedBoundaryKeyRef.current = authorizationBoundary.key;
  }

  useEffect(() => {
    if (!authorizationBoundary.ready
      || initializedBoundaryKeyRef.current !== authorizationBoundary.key
      || !userId) return;

    for (const n of notifs.data) {
      if (
        !seenIds.current.has(n.notification_id) &&
        isForUser(n, userId)
      ) {
        seenIds.current.add(n.notification_id);
        callbackRef.current(n);
      }
    }
  }, [authorizationBoundary.key, authorizationBoundary.ready, notifs.data, userId]);
}
