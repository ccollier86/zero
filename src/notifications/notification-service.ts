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
import {
  applicationServiceDataScope,
  serviceDataTenantId,
  type ServiceDataScope,
} from '../auth/service-data-scope';

// ─── SQL Row Types ───────────────────────────────────────────────────────────

interface NotificationRow {
  notification_id: string;
  tenant_id: string | null;
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
  tenant_id: string | null;
  notification_id: string;
  user_id: string;
  seen_at: number | null;
  read_at: number | null;
  dismissed_at: number | null;
}

/** One legacy role or the complete additive role set projected by RBAC. */
export type NotificationAudienceRoles = string | readonly string[];

/** Synchronous authority check executed while the system DB writer lock is held. */
export type NotificationCommitFence = () => void;

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
    getReceiptsByNotification: Statement;
    getReceiptsByUser: Statement;
    getReceipt: Statement;
  };

  constructor(
    private db: ReactiveDB,
    private readonly tenancyMode: 'single' | 'multi' = 'single',
  ) {
    this.stmts = {
      getById: db.prepare(
        'SELECT * FROM notifications WHERE notification_id = ? AND tenant_id IS ?'
      ),
      getAll: db.prepare(
        'SELECT * FROM notifications WHERE tenant_id IS ? ORDER BY created_at DESC'
      ),
      getReceiptsByNotification: db.prepare(
        'SELECT * FROM notification_receipts WHERE notification_id = ? AND tenant_id IS ?'
      ),
      getReceiptsByUser: db.prepare(
        'SELECT * FROM notification_receipts WHERE user_id = ? AND tenant_id IS ?'
      ),
      getReceipt: db.prepare(
        `SELECT * FROM notification_receipts
         WHERE notification_id = ? AND user_id = ? AND tenant_id IS ?`
      ),
    };
  }

  // ─── Targeting API ──────────────────────────────────────────────────────

  /**
   * Canonical create alias for broadcast().
   *
   * Use notify()/notifyUsers()/notifyRole() when targeting should be explicit.
   */
  create(
    params: CreateNotificationParams,
    senderId?: string,
    scope?: ServiceDataScope,
    commitFence?: NotificationCommitFence,
  ): NotificationRecord {
    return this.broadcast(params, senderId, scope, commitFence);
  }

  /** Broadcast to all users. */
  broadcast(
    params: CreateNotificationParams,
    senderId?: string,
    scope?: ServiceDataScope,
    commitFence?: NotificationCommitFence,
  ): NotificationRecord {
    return this.createNotification('all', null, params, senderId, scope, commitFence);
  }

  /** Notify a single user. */
  notify(
    userId: string,
    params: CreateNotificationParams,
    senderId?: string,
    scope?: ServiceDataScope,
    commitFence?: NotificationCommitFence,
  ): NotificationRecord {
    return this.createNotification('user', userId, params, senderId, scope, commitFence);
  }

  /** Notify multiple specific users. */
  notifyUsers(
    userIds: string[],
    params: CreateNotificationParams,
    senderId?: string,
    scope?: ServiceDataScope,
    commitFence?: NotificationCommitFence,
  ): NotificationRecord {
    return this.createNotification(
      'users',
      JSON.stringify(userIds),
      params,
      senderId,
      scope,
      commitFence,
    );
  }

  /** Notify all users with a specific role. */
  notifyRole(
    role: string,
    params: CreateNotificationParams,
    senderId?: string,
    scope?: ServiceDataScope,
    commitFence?: NotificationCommitFence,
  ): NotificationRecord {
    return this.createNotification('role', role, params, senderId, scope, commitFence);
  }

  // ─── Reads ──────────────────────────────────────────────────────────────

  /** Get a single notification by ID. */
  getById(notificationId: string, scope?: ServiceDataScope): NotificationRecord | null {
    const boundary = this.requireScope(scope);
    const row = this.stmts.getById.get(
      notificationId,
      serviceDataTenantId(boundary),
    ) as NotificationRow | null;
    return row as NotificationRecord | null;
  }

  /**
   * Get a notification only when it is targeted to the supplied user.
   *
   * HTTP receipt routes use this lookup before writing user-owned receipt
   * state. Keeping the target check beside the notification query prevents a
   * guessed notification ID from becoming a receipt-write capability.
   */
  getByIdForUser(
    notificationId: string,
    userId: string,
    userRole: NotificationAudienceRoles,
    scope?: ServiceDataScope,
  ): NotificationRecord | null {
    const boundary = this.requireScope(scope);
    const row = this.stmts.getById.get(
      notificationId,
      serviceDataTenantId(boundary),
    ) as NotificationRow | null;
    if (!row || !isForUser(row, userId, normalizeAudienceRoles(userRole))) return null;
    return row as NotificationRecord;
  }

  /** Canonical get alias for getById(). */
  get(notificationId: string, scope?: ServiceDataScope): NotificationRecord | null {
    return this.getById(notificationId, scope);
  }

  /**
   * Get all notifications visible to a user (filtered by target match).
   * Joins with receipts to determine seen/read/dismissed state.
   */
  getForUser(userId: string, userRole: NotificationAudienceRoles, scope?: ServiceDataScope): Array<NotificationRecord & {
    receipt: NotificationReceiptRecord | null;
  }> {
    const boundary = this.requireScope(scope);
    const tenantId = serviceDataTenantId(boundary);
    const all = this.stmts.getAll.all(tenantId) as NotificationRow[];
    const userReceipts = this.stmts.getReceiptsByUser.all(userId, tenantId) as ReceiptRow[];
    const receiptMap = new Map(userReceipts.map((r) => [r.notification_id, r]));

    const roles = normalizeAudienceRoles(userRole);
    return all
      .filter((n) => isForUser(n, userId, roles))
      .map((n) => ({
        ...(n as unknown as NotificationRecord),
        receipt: (receiptMap.get(n.notification_id) as NotificationReceiptRecord) ?? null,
      }));
  }

  /** Canonical list alias for getForUser(). */
  list(userId: string, userRole: NotificationAudienceRoles, scope?: ServiceDataScope): Array<NotificationRecord & {
    receipt: NotificationReceiptRecord | null;
  }> {
    return this.getForUser(userId, userRole, scope);
  }

  /** Get unread count for a user (accounts for target filtering). */
  getUnreadCount(
    userId: string,
    userRole: NotificationAudienceRoles,
    scope?: ServiceDataScope,
  ): number {
    return this.getForUser(userId, userRole, scope)
      .filter((notification) => !notification.receipt?.read_at
        && !notification.receipt?.dismissed_at)
      .length;
  }

  /** Get all receipts for a notification (admin: who read what). */
  getReceipts(notificationId: string, scope?: ServiceDataScope): NotificationReceiptRecord[] {
    const boundary = this.requireScope(scope);
    return this.stmts.getReceiptsByNotification.all(
      notificationId,
      serviceDataTenantId(boundary),
    ) as NotificationReceiptRecord[];
  }

  // ─── Receipt Writes ─────────────────────────────────────────────────────

  /** Mark a notification as seen for a user. */
  markSeen(
    notificationId: string,
    userId: string,
    scope?: ServiceDataScope,
    commitFence?: NotificationCommitFence,
  ): void {
    const boundary = this.requireScope(scope);
    const tenantId = serviceDataTenantId(boundary);
    const receiptId = `r_${notificationId}_${userId}`;
    this.db.transaction(() => {
      const existing = this.stmts.getReceipt.get(
        notificationId,
        userId,
        tenantId,
      ) as ReceiptRow | null;
      if (existing) {
        if (!existing.seen_at) {
          commitFence?.();
          this.db.update('notification_receipts', receiptId, { seen_at: Date.now() });
        }
      } else {
        commitFence?.();
        this.insertReceipt({
          receipt_id: receiptId,
          tenant_id: tenantId,
          notification_id: notificationId,
          user_id: userId,
          seen_at: Date.now(),
          read_at: null,
          dismissed_at: null,
        });
      }
    });
  }

  /** Mark a notification as read for a user. */
  markRead(
    notificationId: string,
    userId: string,
    scope?: ServiceDataScope,
    commitFence?: NotificationCommitFence,
  ): void {
    const boundary = this.requireScope(scope);
    const tenantId = serviceDataTenantId(boundary);
    const receiptId = `r_${notificationId}_${userId}`;
    const now = Date.now();
    this.db.transaction(() => {
      const existing = this.stmts.getReceipt.get(
        notificationId,
        userId,
        tenantId,
      ) as ReceiptRow | null;
      if (existing) {
        if (!existing.read_at) {
          commitFence?.();
          this.db.update('notification_receipts', receiptId, {
            seen_at: existing.seen_at ?? now,
            read_at: now,
          });
        }
      } else {
        commitFence?.();
        this.insertReceipt({
          receipt_id: receiptId,
          tenant_id: tenantId,
          notification_id: notificationId,
          user_id: userId,
          seen_at: now,
          read_at: now,
          dismissed_at: null,
        });
      }
    });
  }

  /** Dismiss a notification for a user. */
  dismiss(
    notificationId: string,
    userId: string,
    scope?: ServiceDataScope,
    commitFence?: NotificationCommitFence,
  ): void {
    const boundary = this.requireScope(scope);
    const tenantId = serviceDataTenantId(boundary);
    const receiptId = `r_${notificationId}_${userId}`;
    const now = Date.now();
    this.db.transaction(() => {
      const existing = this.stmts.getReceipt.get(
        notificationId,
        userId,
        tenantId,
      ) as ReceiptRow | null;
      commitFence?.();
      if (existing) {
        this.db.update('notification_receipts', receiptId, { dismissed_at: now });
      } else {
        this.insertReceipt({
          receipt_id: receiptId,
          tenant_id: tenantId,
          notification_id: notificationId,
          user_id: userId,
          seen_at: now,
          read_at: null,
          dismissed_at: now,
        });
      }
    });
  }

  /** Mark all notifications as read for a user. */
  markAllRead(
    userId: string,
    userRole: NotificationAudienceRoles,
    scope?: ServiceDataScope,
    commitFence?: NotificationCommitFence,
  ): void {
    const boundary = this.requireScope(scope);
    const tenantId = serviceDataTenantId(boundary);
    const now = Date.now();

    this.db.transaction(() => {
      const notifications = this.getForUser(userId, userRole, boundary);
      if (notifications.some((notification) => !notification.receipt?.read_at)) {
        commitFence?.();
      }
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
            tenant_id: tenantId,
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
  markAllSeen(
    userId: string,
    userRole: NotificationAudienceRoles,
    scope?: ServiceDataScope,
    commitFence?: NotificationCommitFence,
  ): void {
    const boundary = this.requireScope(scope);
    const tenantId = serviceDataTenantId(boundary);
    const now = Date.now();

    this.db.transaction(() => {
      const notifications = this.getForUser(userId, userRole, boundary);
      if (notifications.some((notification) => !notification.receipt?.seen_at)) {
        commitFence?.();
      }
      for (const n of notifications) {
        if (n.receipt?.seen_at) continue;

        const receiptId = `r_${n.notification_id}_${userId}`;
        if (n.receipt) {
          this.db.update('notification_receipts', receiptId, { seen_at: now });
        } else {
          this.insertReceipt({
            receipt_id: receiptId,
            tenant_id: tenantId,
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
  deleteNotification(
    notificationId: string,
    scope?: ServiceDataScope,
    commitFence?: NotificationCommitFence,
  ): boolean {
    const boundary = this.requireScope(scope);
    const tenantId = serviceDataTenantId(boundary);
    return this.db.transaction(() => {
      const existing = this.stmts.getById.get(
        notificationId,
        tenantId,
      ) as NotificationRow | null;
      if (!existing) return false;
      const receipts = this.stmts.getReceiptsByNotification.all(
        notificationId,
        tenantId,
      ) as ReceiptRow[];
      commitFence?.();
      for (const r of receipts) {
        this.db.delete('notification_receipts', r.receipt_id);
      }
      const change = this.db.delete('notifications', notificationId);
      return change !== null;
    });
  }

  /** Canonical delete alias for deleteNotification(). */
  delete(
    notificationId: string,
    scope?: ServiceDataScope,
    commitFence?: NotificationCommitFence,
  ): boolean {
    return this.deleteNotification(notificationId, scope, commitFence);
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
          if (this.deleteExpiredNotification(notification_id)) count++;
        }
      });
    }
    return count;
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private insertReceipt(row: {
    receipt_id: string;
    tenant_id: string | null;
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
    scope?: ServiceDataScope,
    commitFence?: NotificationCommitFence,
  ): NotificationRecord {
    const boundary = this.requireScope(scope);
    const notificationId = `n_${crypto.randomUUID()}`;
    const now = Date.now();

    const row: NotificationRecord = {
      notification_id: notificationId,
      tenant_id: serviceDataTenantId(boundary),
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

    this.db.transaction(() => {
      commitFence?.();
      this.db.insert('notifications', row as unknown as Row);
    });
    return row;
  }

  private deleteExpiredNotification(notificationId: string): boolean {
    const receipts = this.db.prepare(
      'SELECT receipt_id FROM notification_receipts WHERE notification_id = ?',
    ).all(notificationId) as Array<{ receipt_id: string }>;
    for (const receipt of receipts) this.db.delete('notification_receipts', receipt.receipt_id);
    return this.db.delete('notifications', notificationId) !== null;
  }

  private requireScope(scope: ServiceDataScope | undefined): ServiceDataScope {
    if (scope) return scope;
    if (this.tenancyMode === 'multi') {
      throw new Error('A validated tenant data scope is required in multi-tenant mode');
    }
    return applicationServiceDataScope();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Check if a notification is targeted at a specific user. */
function isForUser(
  n: NotificationRow,
  userId: string,
  userRoles: readonly string[],
): boolean {
  switch (n.target_type) {
    case 'all':
      return true;
    case 'user':
      return n.target_value === userId;
    case 'users':
      return isInUserList(n.target_value, userId);
    case 'role':
      return n.target_value !== null && userRoles.includes(n.target_value);
    default:
      return false;
  }
}

function normalizeAudienceRoles(input: NotificationAudienceRoles): readonly string[] {
  const roles = typeof input === 'string' ? [input] : input;
  return [...new Set(roles.filter((role) => role.length > 0))];
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
