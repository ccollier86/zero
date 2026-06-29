/**
 * notification-service.ts
 *
 * Owns notification domain behavior and receipt persistence. This service is
 * framework-independent: routes authorize users and pass concrete IDs, while
 * this file mutates ReactiveDB so notification state stays realtime.
 */

import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';
import type { Row } from '../sync/types';
import type {
  NotificationRecord,
  NotificationReceiptRecord,
  CreateNotificationParams,
  NotificationTarget,
} from './types';

// ─── SQL Row Types ───────────────────────────────────────────────────────────

interface NotificationRow {
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

interface ReceiptRow {
  receipt_id: string;
  notification_id: string;
  user_id: string;
  seen_at: number | null;
  read_at: number | null;
  dismissed_at: number | null;
}

interface CountRow {
  count: number;
}

// ─── NotificationService ─────────────────────────────────────────────────────

/**
 * Core notification CRUD + targeting + receipts.
 *
 * Write paths:
 * - notifications table → ReactiveDB insert/delete (broadcast to all sync clients)
 * - notification_receipts table → ReactiveDB insert (broadcast for real-time receipt tracking)
 *
 * Read paths use prepared statements for performance.
 */
export class NotificationService {
  private stmts: {
    getById: Statement;
    getAll: Statement;
    getByTargetAll: Statement;
    getByTargetUser: Statement;
    getByTargetRole: Statement;
    getReceiptsByNotification: Statement;
    getReceiptsByUser: Statement;
    getReceipt: Statement;
    getUnreadCountAll: Statement;
    getUnreadCountUser: Statement;
    getUnreadCountRole: Statement;
    getUnreadIdsForUser: Statement;
    deleteExpired: Statement;
  };

  constructor(private db: ReactiveDB) {
    this.stmts = {
      getById: db.prepare(
        'SELECT * FROM notifications WHERE notification_id = ?'
      ),
      getAll: db.prepare(
        'SELECT * FROM notifications ORDER BY created_at DESC'
      ),
      getByTargetAll: db.prepare(
        `SELECT * FROM notifications WHERE target_type = 'all' ORDER BY created_at DESC`
      ),
      getByTargetUser: db.prepare(
        `SELECT * FROM notifications WHERE target_type = 'user' AND target_value = ? ORDER BY created_at DESC`
      ),
      getByTargetRole: db.prepare(
        `SELECT * FROM notifications WHERE target_type = 'role' AND target_value = ? ORDER BY created_at DESC`
      ),
      getReceiptsByNotification: db.prepare(
        'SELECT * FROM notification_receipts WHERE notification_id = ?'
      ),
      getReceiptsByUser: db.prepare(
        'SELECT * FROM notification_receipts WHERE user_id = ?'
      ),
      getReceipt: db.prepare(
        'SELECT * FROM notification_receipts WHERE notification_id = ? AND user_id = ?'
      ),
      getUnreadCountAll: db.prepare(
        `SELECT COUNT(*) as count FROM notifications n
         WHERE target_type = 'all'
         AND NOT EXISTS (
           SELECT 1 FROM notification_receipts r
           WHERE r.notification_id = n.notification_id AND r.user_id = ?
           AND (r.read_at IS NOT NULL OR r.dismissed_at IS NOT NULL)
         )`
      ),
      getUnreadCountUser: db.prepare(
        `SELECT COUNT(*) as count FROM notifications n
         WHERE target_type = 'user' AND target_value = ?
         AND NOT EXISTS (
           SELECT 1 FROM notification_receipts r
           WHERE r.notification_id = n.notification_id AND r.user_id = ?
           AND (r.read_at IS NOT NULL OR r.dismissed_at IS NOT NULL)
         )`
      ),
      getUnreadCountRole: db.prepare(
        `SELECT COUNT(*) as count FROM notifications n
         WHERE target_type = 'role' AND target_value = ?
         AND NOT EXISTS (
           SELECT 1 FROM notification_receipts r
           WHERE r.notification_id = n.notification_id AND r.user_id = ?
           AND (r.read_at IS NOT NULL OR r.dismissed_at IS NOT NULL)
         )`
      ),
      getUnreadIdsForUser: db.prepare(
        `SELECT n.notification_id FROM notifications n
         WHERE NOT EXISTS (
           SELECT 1 FROM notification_receipts r
           WHERE r.notification_id = n.notification_id AND r.user_id = ? AND r.read_at IS NOT NULL
         )`
      ),
      deleteExpired: db.prepare(
        'DELETE FROM notifications WHERE expires_at IS NOT NULL AND expires_at < ?'
      ),
    };
  }

  // ─── Targeting API ──────────────────────────────────────────────────────

  /**
   * Canonical create alias for broadcast().
   *
   * Use notify()/notifyUsers()/notifyRole() when targeting should be explicit.
   */
  create(params: CreateNotificationParams, senderId?: string): NotificationRecord {
    return this.broadcast(params, senderId);
  }

  /** Broadcast to all users. */
  broadcast(params: CreateNotificationParams, senderId?: string): NotificationRecord {
    return this.createNotification('all', null, params, senderId);
  }

  /** Notify a single user. */
  notify(userId: string, params: CreateNotificationParams, senderId?: string): NotificationRecord {
    return this.createNotification('user', userId, params, senderId);
  }

  /** Notify multiple specific users. */
  notifyUsers(userIds: string[], params: CreateNotificationParams, senderId?: string): NotificationRecord {
    return this.createNotification('users', JSON.stringify(userIds), params, senderId);
  }

  /** Notify all users with a specific role. */
  notifyRole(role: string, params: CreateNotificationParams, senderId?: string): NotificationRecord {
    return this.createNotification('role', role, params, senderId);
  }

  // ─── Reads ──────────────────────────────────────────────────────────────

  /** Get a single notification by ID. */
  getById(notificationId: string): NotificationRecord | null {
    const row = this.stmts.getById.get(notificationId) as NotificationRow | null;
    return row as NotificationRecord | null;
  }

  /** Canonical get alias for getById(). */
  get(notificationId: string): NotificationRecord | null {
    return this.getById(notificationId);
  }

  /**
   * Get all notifications visible to a user (filtered by target match).
   * Joins with receipts to determine seen/read/dismissed state.
   */
  getForUser(userId: string, userRole: string): Array<NotificationRecord & {
    receipt: NotificationReceiptRecord | null;
  }> {
    const all = this.stmts.getAll.all() as NotificationRow[];
    const userReceipts = this.stmts.getReceiptsByUser.all(userId) as ReceiptRow[];
    const receiptMap = new Map(userReceipts.map((r) => [r.notification_id, r]));

    return all
      .filter((n) => isForUser(n, userId, userRole))
      .map((n) => ({
        ...(n as unknown as NotificationRecord),
        receipt: (receiptMap.get(n.notification_id) as NotificationReceiptRecord) ?? null,
      }));
  }

  /** Canonical list alias for getForUser(). */
  list(userId: string, userRole: string): Array<NotificationRecord & {
    receipt: NotificationReceiptRecord | null;
  }> {
    return this.getForUser(userId, userRole);
  }

  /** Get unread count for a user (accounts for target filtering). */
  getUnreadCount(userId: string, userRole: string): number {
    let count = 0;

    // All broadcasts
    const allCount = this.stmts.getUnreadCountAll.get(userId) as CountRow;
    count += allCount.count;

    // Direct user targets
    const userCount = this.stmts.getUnreadCountUser.get(userId, userId) as CountRow;
    count += userCount.count;

    // Role-based targets
    const roleCount = this.stmts.getUnreadCountRole.get(userRole, userId) as CountRow;
    count += roleCount.count;

    // Multi-user targets require scanning — handled via getForUser filter
    const all = this.stmts.getAll.all() as NotificationRow[];
    const multiUserNotifs = all.filter(
      (n) => n.target_type === 'users' && isInUserList(n.target_value, userId)
    );
    for (const n of multiUserNotifs) {
      const receipt = this.stmts.getReceipt.get(n.notification_id, userId) as ReceiptRow | null;
      if (!receipt?.read_at && !receipt?.dismissed_at) count++;
    }

    return count;
  }

  /** Get all receipts for a notification (admin: who read what). */
  getReceipts(notificationId: string): NotificationReceiptRecord[] {
    return this.stmts.getReceiptsByNotification.all(notificationId) as NotificationReceiptRecord[];
  }

  // ─── Receipt Writes ─────────────────────────────────────────────────────

  /** Mark a notification as seen for a user. */
  markSeen(notificationId: string, userId: string): void {
    const receiptId = `r_${notificationId}_${userId}`;
    const existing = this.stmts.getReceipt.get(notificationId, userId) as ReceiptRow | null;

    if (existing) {
      if (!existing.seen_at) {
        this.db.update('notification_receipts', receiptId, { seen_at: Date.now() });
      }
    } else {
      this.insertReceipt({
        receipt_id: receiptId,
        notification_id: notificationId,
        user_id: userId,
        seen_at: Date.now(),
        read_at: null,
        dismissed_at: null,
      });
    }
  }

  /** Mark a notification as read for a user. */
  markRead(notificationId: string, userId: string): void {
    const receiptId = `r_${notificationId}_${userId}`;
    const now = Date.now();
    const existing = this.stmts.getReceipt.get(notificationId, userId) as ReceiptRow | null;

    if (existing) {
      if (!existing.read_at) {
        this.db.update('notification_receipts', receiptId, {
          seen_at: existing.seen_at ?? now,
          read_at: now,
        });
      }
    } else {
      this.insertReceipt({
        receipt_id: receiptId,
        notification_id: notificationId,
        user_id: userId,
        seen_at: now,
        read_at: now,
        dismissed_at: null,
      });
    }
  }

  /** Dismiss a notification for a user. */
  dismiss(notificationId: string, userId: string): void {
    const receiptId = `r_${notificationId}_${userId}`;
    const now = Date.now();
    const existing = this.stmts.getReceipt.get(notificationId, userId) as ReceiptRow | null;

    if (existing) {
      this.db.update('notification_receipts', receiptId, { dismissed_at: now });
    } else {
      this.insertReceipt({
        receipt_id: receiptId,
        notification_id: notificationId,
        user_id: userId,
        seen_at: now,
        read_at: null,
        dismissed_at: now,
      });
    }
  }

  /** Mark all notifications as read for a user. */
  markAllRead(userId: string, userRole: string): void {
    const notifications = this.getForUser(userId, userRole);
    const now = Date.now();

    this.db.transaction(() => {
      for (const n of notifications) {
        if (n.receipt?.read_at) continue;

        const receiptId = `r_${n.notification_id}_${userId}`;
        if (n.receipt) {
          this.db.update('notification_receipts', receiptId, {
            seen_at: n.receipt.seen_at ?? now,
            read_at: now,
          });
        } else {
          this.insertReceipt({
            receipt_id: receiptId,
            notification_id: n.notification_id,
            user_id: userId,
            seen_at: now,
            read_at: now,
            dismissed_at: null,
          });
        }
      }
    });
  }

  /** Mark all visible notifications as seen for a user. */
  markAllSeen(userId: string, userRole: string): void {
    const notifications = this.getForUser(userId, userRole);
    const now = Date.now();

    this.db.transaction(() => {
      for (const n of notifications) {
        if (n.receipt?.seen_at) continue;

        const receiptId = `r_${n.notification_id}_${userId}`;
        if (n.receipt) {
          this.db.update('notification_receipts', receiptId, { seen_at: now });
        } else {
          this.insertReceipt({
            receipt_id: receiptId,
            notification_id: n.notification_id,
            user_id: userId,
            seen_at: now,
            read_at: null,
            dismissed_at: null,
          });
        }
      }
    });
  }

  // ─── Deletes ────────────────────────────────────────────────────────────

  /** Delete a notification and its receipts. */
  deleteNotification(notificationId: string): boolean {
    const receipts = this.stmts.getReceiptsByNotification.all(notificationId) as ReceiptRow[];

    return this.db.transaction(() => {
      for (const r of receipts) {
        this.db.delete('notification_receipts', r.receipt_id);
      }
      const change = this.db.delete('notifications', notificationId);
      return change !== null;
    });
  }

  /** Canonical delete alias for deleteNotification(). */
  delete(notificationId: string): boolean {
    return this.deleteNotification(notificationId);
  }

  /** Delete all expired notifications. Returns number deleted. */
  deleteExpired(): number {
    const now = Date.now();
    // Find expired notification IDs first, then delete via ReactiveDB for broadcast
    const expired = this.db.prepare(
      'SELECT notification_id FROM notifications WHERE expires_at IS NOT NULL AND expires_at < ?'
    ).all(now) as Array<{ notification_id: string }>;

    let count = 0;
    if (expired.length > 0) {
      this.db.transaction(() => {
        for (const { notification_id } of expired) {
          if (this.deleteNotification(notification_id)) count++;
        }
      });
    }
    return count;
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private insertReceipt(row: {
    receipt_id: string;
    notification_id: string;
    user_id: string;
    seen_at: number | null;
    read_at: number | null;
    dismissed_at: number | null;
  }): void {
    this.db.insert('notification_receipts', row as unknown as Row);
  }

  private createNotification(
    targetType: NotificationTarget,
    targetValue: string | null,
    params: CreateNotificationParams,
    senderId?: string,
  ): NotificationRecord {
    const notificationId = `n_${crypto.randomUUID()}`;
    const now = Date.now();

    const row: NotificationRecord = {
      notification_id: notificationId,
      type: params.type ?? 'info',
      priority: params.priority ?? 'normal',
      title: params.title,
      body: params.body ?? null,
      target_type: targetType,
      target_value: targetValue,
      sender_id: senderId ?? null,
      action_url: params.actionUrl ?? null,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      created_at: now,
      expires_at: params.expiresAt ?? null,
    };

    this.db.insert('notifications', row as unknown as Row);
    return row;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Check if a notification is targeted at a specific user. */
function isForUser(n: NotificationRow, userId: string, userRole: string): boolean {
  switch (n.target_type) {
    case 'all':
      return true;
    case 'user':
      return n.target_value === userId;
    case 'users':
      return isInUserList(n.target_value, userId);
    case 'role':
      return n.target_value === userRole;
    default:
      return false;
  }
}

/** Check if userId is in a JSON array string. */
function isInUserList(targetValue: string | null, userId: string): boolean {
  if (!targetValue) return false;
  try {
    const ids = JSON.parse(targetValue) as string[];
    return ids.includes(userId);
  } catch {
    return false;
  }
}
