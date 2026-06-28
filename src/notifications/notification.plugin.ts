/**
 * notification.plugin.ts
 *
 * Elysia controller for notification HTTP routes. This plugin owns route
 * validation, auth dependency declaration, and lifecycle setup; notification
 * targeting and receipt mutations live in NotificationService.
 */

import { Elysia, t } from 'elysia';
import { NotificationService } from './notification-service';
import type { ReactiveDB } from '../sync/reactive-db';
import { AuthError } from '../auth/types';
import { createAuthMiddleware } from '../auth/auth.middleware';
import { getTokenService } from '../auth/auth.plugin';
import { getScheduler } from '../scheduler';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';

// ─── Module-Level Singleton ──────────────────────────────────────────────────

let _notificationService: NotificationService | null = null;

/**
 * Get the NotificationService instance. Returns null if the plugin hasn't started.
 * Use this for cross-plugin access (e.g., sending notifications from any route).
 */
export function getNotificationService(): NotificationService | null {
  return _notificationService;
}

// ─── Table Definitions ───────────────────────────────────────────────────────

function defineNotificationTables(db: ReactiveDB): void {
  db.defineTable('notifications', {
    notification_id: 'text primary key',
    type: "text not null default 'info'",
    priority: "text not null default 'normal'",
    title: 'text not null',
    body: 'text',
    target_type: "text not null default 'all'",
    target_value: 'text',
    sender_id: 'text',
    action_url: 'text',
    metadata: 'text',
    created_at: 'integer not null',
    expires_at: 'integer',
  });

  db.defineTable('notification_receipts', {
    receipt_id: 'text primary key',
    notification_id: 'text not null',
    user_id: 'text not null',
    seen_at: 'integer',
    read_at: 'integer',
    dismissed_at: 'integer',
  });

  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_notif_user ON notification_receipts(notification_id, user_id)'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_receipt_user ON notification_receipts(user_id)'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_receipt_notif ON notification_receipts(notification_id)'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notif_target ON notifications(target_type)'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(created_at)'
  );
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface NotificationPluginConfig {
  db: ReactiveDB;
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

/**
 * Create the notification Elysia plugin.
 *
 * Uses auth middleware (resolve-based) — requireAuth/requireAdmin are
 * typed and available directly from context. No casts needed.
 *
 * Mount AFTER auth plugin:
 * ```ts
 * app
 *   .use(createAuthPlugin({ db }))
 *   .use(createAuthMiddleware(getTokenService))
 *   .use(createNotificationPlugin({ db }));
 * ```
 */
export function createNotificationPlugin(config: NotificationPluginConfig) {
  return new Elysia({ name: 'notifications', prefix: '/notifications' })

    .use(createAuthMiddleware(getTokenService))

    // ─── Lifecycle ─────────────────────────────────────
    .onStart(() => {
      defineNotificationTables(config.db);
      _notificationService = new NotificationService(config.db);

      // Register cleanup job if scheduler is available
      const scheduler = getScheduler();
      if (scheduler && !scheduler.has('notification-cleanup')) {
        scheduler.register({
          name: 'notification-cleanup',
          pattern: '0 0 * * * *', // every hour
          run: () => {
            const deleted = _notificationService?.deleteExpired() ?? 0;
            if (deleted > 0) {
              emitPlatformCode(OBS_CODES.NOTIFICATIONS_CLEANUP, {
                metadata: { deleted },
              });
            }
          },
        });
      }

      emitPlatformCode(OBS_CODES.NOTIFICATIONS_STARTED, {
        metadata: { tablesDefined: true },
      });
    })

    .onStop(() => {
      _notificationService = null;
      emitPlatformCode(OBS_CODES.NOTIFICATIONS_STOPPED);
    })

    // ─── Derive: expose service globally ──────────────
    .derive({ as: 'global' }, () => ({
      notificationService: _notificationService,
    }))

    // ─── Error handler ────────────────────────────────
    .onError(({ error, set }) => {
      if (error instanceof AuthError) {
        set.status = error.status;
        return { error: error.message, code: error.code };
      }
    })

    // ─── GET / — List notifications for current user ──
    .get('/', ({ requireAuth }) => {
      const svc = _notificationService!;
      const auth = requireAuth();
      return { notifications: svc.getForUser(auth.userId, auth.role) };
    })

    // ─── GET /unread-count ────────────────────────────
    .get('/unread-count', ({ requireAuth }) => {
      const svc = _notificationService!;
      const auth = requireAuth();
      return { count: svc.getUnreadCount(auth.userId, auth.role) };
    })

    // ─── POST / — Create notification (admin) ─────────
    .post(
      '/',
      ({ requireAdmin, body }) => {
        const svc = _notificationService!;
        const auth = requireAdmin();

        const params = {
          type: body.type as any,
          priority: body.priority as any,
          title: body.title,
          body: body.body,
          actionUrl: body.actionUrl,
          metadata: body.metadata ? JSON.parse(body.metadata) : undefined,
          expiresAt: body.expiresAt,
        };

        let notification;
        switch (body.targetType) {
          case 'user':
            if (!body.targetValue) throw new AuthError('targetValue required', 'BAD_REQUEST', 400);
            notification = svc.notify(body.targetValue, params, auth.userId);
            break;
          case 'users':
            if (!body.targetValue) throw new AuthError('targetValue required', 'BAD_REQUEST', 400);
            notification = svc.notifyUsers(JSON.parse(body.targetValue), params, auth.userId);
            break;
          case 'role':
            if (!body.targetValue) throw new AuthError('targetValue required', 'BAD_REQUEST', 400);
            notification = svc.notifyRole(body.targetValue, params, auth.userId);
            break;
          default:
            notification = svc.broadcast(params, auth.userId);
        }

        return { notification };
      },
      {
        body: t.Object({
          title: t.String({ minLength: 1 }),
          body: t.Optional(t.String()),
          type: t.Optional(t.String()),
          priority: t.Optional(t.String()),
          targetType: t.Optional(t.String()),
          targetValue: t.Optional(t.String()),
          actionUrl: t.Optional(t.String()),
          metadata: t.Optional(t.String()),
          expiresAt: t.Optional(t.Number()),
        }),
      }
    )

    // ─── POST /broadcast — Shorthand (admin) ──────────
    .post(
      '/broadcast',
      ({ requireAdmin, body }) => {
        const svc = _notificationService!;
        const auth = requireAdmin();
        const notification = svc.broadcast(
          { title: body.title, body: body.body, type: body.type as any, priority: body.priority as any },
          auth.userId,
        );
        return { notification };
      },
      {
        body: t.Object({
          title: t.String({ minLength: 1 }),
          body: t.Optional(t.String()),
          type: t.Optional(t.String()),
          priority: t.Optional(t.String()),
        }),
      }
    )

    // ─── POST /notify/:userId — Single user (admin) ───
    .post(
      '/notify/:userId',
      ({ requireAdmin, params, body }) => {
        const svc = _notificationService!;
        const auth = requireAdmin();
        const notification = svc.notify(
          params.userId,
          { title: body.title, body: body.body, type: body.type as any, priority: body.priority as any },
          auth.userId,
        );
        return { notification };
      },
      {
        params: t.Object({ userId: t.String({ minLength: 1 }) }),
        body: t.Object({
          title: t.String({ minLength: 1 }),
          body: t.Optional(t.String()),
          type: t.Optional(t.String()),
          priority: t.Optional(t.String()),
        }),
      }
    )

    // ─── POST /notify-role/:role — By role (admin) ────
    .post(
      '/notify-role/:role',
      ({ requireAdmin, params, body }) => {
        const svc = _notificationService!;
        const auth = requireAdmin();
        const notification = svc.notifyRole(
          params.role,
          { title: body.title, body: body.body, type: body.type as any, priority: body.priority as any },
          auth.userId,
        );
        return { notification };
      },
      {
        params: t.Object({ role: t.String({ minLength: 1 }) }),
        body: t.Object({
          title: t.String({ minLength: 1 }),
          body: t.Optional(t.String()),
          type: t.Optional(t.String()),
          priority: t.Optional(t.String()),
        }),
      }
    )

    // ─── GET /:id — Single notification ───────────────
    .get(
      '/:id',
      ({ requireAuth, params }) => {
        const svc = _notificationService!;
        requireAuth();
        const notification = svc.getById(params.id);
        if (!notification) throw new AuthError('Not found', 'NOT_FOUND', 404);
        return { notification };
      },
      { params: t.Object({ id: t.String({ minLength: 1 }) }) }
    )

    // ─── POST /:id/seen ──────────────────────────────
    .post(
      '/:id/seen',
      ({ requireAuth, params }) => {
        const svc = _notificationService!;
        const auth = requireAuth();
        svc.markSeen(params.id, auth.userId);
        return { ok: true };
      },
      { params: t.Object({ id: t.String({ minLength: 1 }) }) }
    )

    // ─── POST /:id/read ──────────────────────────────
    .post(
      '/:id/read',
      ({ requireAuth, params }) => {
        const svc = _notificationService!;
        const auth = requireAuth();
        svc.markRead(params.id, auth.userId);
        return { ok: true };
      },
      { params: t.Object({ id: t.String({ minLength: 1 }) }) }
    )

    // ─── POST /:id/dismiss ───────────────────────────
    .post(
      '/:id/dismiss',
      ({ requireAuth, params }) => {
        const svc = _notificationService!;
        const auth = requireAuth();
        svc.dismiss(params.id, auth.userId);
        return { ok: true };
      },
      { params: t.Object({ id: t.String({ minLength: 1 }) }) }
    )

    // ─── POST /read-all ──────────────────────────────
    .post('/read-all', ({ requireAuth }) => {
      const svc = _notificationService!;
      const auth = requireAuth();
      svc.markAllRead(auth.userId, auth.role);
      return { ok: true };
    })

    // ─── POST /seen-all ──────────────────────────────
    .post('/seen-all', ({ requireAuth }) => {
      const svc = _notificationService!;
      const auth = requireAuth();
      svc.markAllSeen(auth.userId, auth.role);
      return { ok: true };
    })

    // ─── GET /:id/receipts — Audit trail (admin) ─────
    .get(
      '/:id/receipts',
      ({ requireAdmin, params }) => {
        const svc = _notificationService!;
        requireAdmin();
        return { receipts: svc.getReceipts(params.id) };
      },
      { params: t.Object({ id: t.String({ minLength: 1 }) }) }
    )

    // ─── DELETE /:id — Delete (admin) ─────────────────
    .delete(
      '/:id',
      ({ requireAdmin, params }) => {
        const svc = _notificationService!;
        requireAdmin();
        const deleted = svc.deleteNotification(params.id);
        if (!deleted) throw new AuthError('Not found', 'NOT_FOUND', 404);
        return { ok: true };
      },
      { params: t.Object({ id: t.String({ minLength: 1 }) }) }
    );
}
