import type { ClientTableDef } from '../schema/define-schema';

// ─── Notification Types ──────────────────────────────────────────────────────

export type NotificationType = 'info' | 'warning' | 'success' | 'error' | 'system';
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';
export type NotificationTarget = 'all' | 'user' | 'users' | 'role';

// ─── Records (match SQLite columns, snake_case) ─────────────────────────────

export interface NotificationRecord {
  notification_id: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  body: string | null;
  target_type: NotificationTarget;
  target_value: string | null;
  sender_id: string | null;
  action_url: string | null;
  metadata: string | null;
  created_at: number;
  expires_at: number | null;
}

export interface NotificationReceiptRecord {
  receipt_id: string;
  notification_id: string;
  user_id: string;
  seen_at: number | null;
  read_at: number | null;
  dismissed_at: number | null;
}

// ─── Params ──────────────────────────────────────────────────────────────────

export interface CreateNotificationParams {
  type?: NotificationType;
  priority?: NotificationPriority;
  title: string;
  body?: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
  expiresAt?: number;
}

// ─── Client Table Definitions ────────────────────────────────────────────────

/**
 * Spread into your client's `tables` config to enable notification sync.
 *
 * @example
 * ```ts
 * createClient({
 *   url: 'http://localhost:3000',
 *   tables: { ...NOTIFICATION_TABLES, ...myTables },
 * });
 * ```
 */
export const NOTIFICATION_TABLES: Record<string, ClientTableDef> = {
  notifications: {
    _pk: 'notification_id',
    notification_id: 'text',
    type: 'text',
    priority: 'text',
    title: 'text',
    body: 'text',
    target_type: 'text',
    target_value: 'text',
    sender_id: 'text',
    action_url: 'text',
    metadata: 'text',
    created_at: 'integer',
    expires_at: 'integer',
  },
  notification_receipts: {
    _pk: 'receipt_id',
    receipt_id: 'text',
    notification_id: 'text',
    user_id: 'text',
    seen_at: 'integer',
    read_at: 'integer',
    dismissed_at: 'integer',
  },
};
