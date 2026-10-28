import { useCallback, useMemo, useRef, useEffect } from 'react';
import { useAuth } from './auth-hooks';
import { useClientMaybe } from './client-context';
import { useCollection } from './data-hooks';
import type { Row } from '../../sync/types';
import { OBS_CODES } from '../../observability/codes';
import { emitFrontendCode } from './observability';
import { readAuthorizationScopeBoundaryKey, useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import type { InternalClient } from './sdk';

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
 * Only accepted live Sync INSERTs trigger this callback. Initial snapshots,
 * reconnect catchup/history, local cache loads and receipt updates never alert.
 * No browser/server clock comparison is needed to identify a new arrival.
 */
export function useOnNewNotification(
  callback: (n: Notification) => void,
): void {
  const { user } = useAuth();
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const userId = authorizationBoundary.ready ? user?.userId ?? '' : '';
  const callbackRef = useRef(callback);
  const latest = useRef(authorizationBoundary); latest.current = authorizationBoundary;
  callbackRef.current = callback;
  useEffect(() => {
    const sync = (client as InternalClient | null)?._syncClient;
    if (!authorizationBoundary.ready || !userId || !sync) return;
    const key = authorizationBoundary.key, seen = new Set<string>();
    return sync.onMessage(message => {
      if (!latest.current.ready || latest.current.key !== key
        || readAuthorizationScopeBoundaryKey((client as InternalClient | null)?.auth ?? null, (client as InternalClient | null)?._authorizationDataBoundary?.revision ?? 0) !== key) return;
      const n = liveNotificationInsert(message);
      if (!n || seen.has(n.notification_id) || !isForUser(n, userId)) return;
      seen.add(n.notification_id);
      if (seen.size > 2048) seen.delete(seen.values().next().value!);
      callbackRef.current(n);
    });
  }, [authorizationBoundary.key, authorizationBoundary.ready, client, userId]);
}

/** The Sync transport has already validated/admitted this envelope and applied the canonical row. */
export function liveNotificationInsert(message: { type: string; [key: string]: unknown }): Notification | null {
  if (message.type !== 'sync.change' || message.table !== 'notifications' || message.op !== 'INSERT'
    || !message.row || typeof message.row !== 'object') return null;
  const row = message.row as Notification;
  return typeof row.notification_id === 'string' && typeof row.title === 'string' && typeof row.target_type === 'string'
    && (row.metadata === null || typeof row.metadata === 'string') && (row.expires_at === null || typeof row.expires_at === 'number') ? row : null;
}
