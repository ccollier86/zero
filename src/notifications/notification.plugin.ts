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
import { getPublicAuthErrorMessage } from '../auth/auth-error-response';
import {
  createAuthMiddleware,
  type AuthMiddlewareAuthorizationOptions,
} from '../auth/auth.middleware';
import {
  requireRequestServiceDataScope,
  type ServiceDataScope,
} from '../auth/service-data-scope';
import {
  getAuthRequestCredentialResolver,
  getTokenService,
} from '../auth/auth.plugin';
import { getScheduler } from '../scheduler';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { TokenService } from '../auth/token-service';
import type { SchedulerService } from '../scheduler/scheduler-service';
import { CompatibilityProviderRegistry } from '../runtime/compatibility-provider-registry';
import {
  ZERO_AUTHORIZATION_KERNEL,
  ZERO_AUTH_REQUEST_CREDENTIAL_RESOLVER,
  ZERO_AUTH_TOKEN_SERVICE,
  ZERO_NOTIFICATION_SERVICE,
  ZERO_SCHEDULER_SERVICE,
} from '../runtime/service-keys';
import type { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { ensureNullableTenantColumn } from '../runtime/tenant-schema';
import type { RequestAuthorizationAccess } from '../auth/authorization-access';
import {
  canManageNotificationScope,
  notificationAudienceRoles,
} from './notification-access';

// ─── Legacy Compatibility Getter ─────────────────────────────────────────────

const notificationProviders = new CompatibilityProviderRegistry<NotificationService>(
  'Notification service',
);

/**
 * Get the NotificationService instance. Returns null if the plugin hasn't started.
 * Use this for cross-plugin access (e.g., sending notifications from any route).
 */
export function getNotificationService(): NotificationService | null {
  return notificationProviders.get();
}

// ─── Table Definitions ───────────────────────────────────────────────────────

export function defineNotificationTables(db: ReactiveDB): void {
  ensureNullableTenantColumn(db, 'notifications');
  ensureNullableTenantColumn(db, 'notification_receipts');
  db.defineTable('notifications', {
    notification_id: 'text primary key',
    tenant_id: 'text',
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
    tenant_id: 'text',
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
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id)'
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_notification_receipts_tenant_user
     ON notification_receipts(tenant_id, user_id)`
  );
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface NotificationPluginConfig {
  db: ReactiveDB;
  runtime?: ZeroAppRuntime;
  getTokenService?: () => TokenService | null;
  /** App-local authorization dependencies for tenant-bound service data. */
  authorization?: AuthMiddlewareAuthorizationOptions;
  getScheduler?: () => SchedulerService | null;
  onServiceCreated?: (service: NotificationService) => void;
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

/**
 * Create the notification Elysia plugin.
 *
 * Uses the resolve-based auth middleware and its live `access` facade. Tenant
 * notification management is evaluated from the active scope, not from the
 * global platform-admin role.
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
  const owner = {};
  let service: NotificationService | null = null;
  let registration: ReturnType<typeof notificationProviders.register> | null = null;
  config.runtime?.addCleanup(() => registration?.unregister());
  const getNotificationTokenService = config.getTokenService
    ?? (config.runtime
      ? () => config.runtime!.get(ZERO_AUTH_TOKEN_SERVICE)
      : getTokenService);
  const getNotificationScheduler = config.getScheduler
    ?? (config.runtime
      ? () => config.runtime!.get(ZERO_SCHEDULER_SERVICE)
      : getScheduler);
  const getAuthorizationKernel = config.authorization?.getAuthorizationKernel
    ?? (() => config.runtime?.get(ZERO_AUTHORIZATION_KERNEL) ?? null);
  const authorization: AuthMiddlewareAuthorizationOptions = {
    ...config.authorization,
    getRequestCredentialResolver:
      config.authorization?.getRequestCredentialResolver
      ?? (config.runtime
        ? () => config.runtime!.get(ZERO_AUTH_REQUEST_CREDENTIAL_RESOLVER)
        : getAuthRequestCredentialResolver),
    getAuthorizationKernel,
  };
  const requestScope = (access: Parameters<typeof requireRequestServiceDataScope>[0]) =>
    requireRequestServiceDataScope(access, getAuthorizationKernel);
  return new Elysia({ name: 'notifications', prefix: '/notifications' })

    .use(createAuthMiddleware(getNotificationTokenService, authorization))

    // ─── Lifecycle ─────────────────────────────────────
    .onStart(() => {
      defineNotificationTables(config.db);
      service = new NotificationService(
        config.db,
        getAuthorizationKernel()?.tenancy.mode ?? 'single',
      );
      registration = notificationProviders.register(owner, () => service);
      config.runtime?.set(ZERO_NOTIFICATION_SERVICE, service);
      config.onServiceCreated?.(service);

      // Register cleanup job if scheduler is available
      const scheduler = getNotificationScheduler();
      if (scheduler && !scheduler.has('notification-cleanup')) {
        scheduler.register({
          name: 'notification-cleanup',
          pattern: '0 0 * * * *', // every hour
          run: () => {
            const deleted = service?.deleteExpired() ?? 0;
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
      if (service) config.runtime?.clear(ZERO_NOTIFICATION_SERVICE, service);
      registration?.unregister();
      registration = null;
      service = null;
      emitPlatformCode(OBS_CODES.NOTIFICATIONS_STOPPED);
    })

    // ─── Derive: expose service globally ──────────────
    .derive({ as: 'global' }, () => ({
      notificationService: service,
    }))

    // ─── Error handler ────────────────────────────────
    .onError(({ error, set }) => {
      if (error instanceof AuthError) {
        set.status = error.status;
        return { error: getPublicAuthErrorMessage(error), code: error.code };
      }
    })

    // ─── GET / — List notifications for current user ──
    .get('/', ({ access }) => {
      const svc = service!;
      const auth = access.requireUser();
      const scope = requestScope(access);
      return {
        notifications: svc.getForUser(
          auth.userId,
          notificationAudienceRoles(access, scope),
          scope,
        ),
      };
    })

    // ─── GET /unread-count ────────────────────────────
    .get('/unread-count', ({ access }) => {
      const svc = service!;
      const auth = access.requireUser();
      const scope = requestScope(access);
      return {
        count: svc.getUnreadCount(
          auth.userId,
          notificationAudienceRoles(access, scope),
          scope,
        ),
      };
    })

    // ─── POST / — Create notification (scope manager) ─
    .post(
      '/',
      ({ access, body }) => {
        const svc = service!;
        const auth = access.requireUser();
        const scope = requestScope(access);
        requireNotificationManager(access, scope);

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
            notification = svc.notify(body.targetValue, params, auth.userId, scope);
            break;
          case 'users':
            if (!body.targetValue) throw new AuthError('targetValue required', 'BAD_REQUEST', 400);
            notification = svc.notifyUsers(JSON.parse(body.targetValue), params, auth.userId, scope);
            break;
          case 'role':
            if (!body.targetValue) throw new AuthError('targetValue required', 'BAD_REQUEST', 400);
            notification = svc.notifyRole(body.targetValue, params, auth.userId, scope);
            break;
          default:
            notification = svc.broadcast(params, auth.userId, scope);
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

    // ─── POST /broadcast — Shorthand (scope manager) ──
    .post(
      '/broadcast',
      ({ access, body }) => {
        const svc = service!;
        const auth = access.requireUser();
        const scope = requestScope(access);
        requireNotificationManager(access, scope);
        const notification = svc.broadcast(
          { title: body.title, body: body.body, type: body.type as any, priority: body.priority as any },
          auth.userId,
          scope,
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

    // ─── POST /notify/:userId — Single user (manager) ─
    .post(
      '/notify/:userId',
      ({ access, params, body }) => {
        const svc = service!;
        const auth = access.requireUser();
        const scope = requestScope(access);
        requireNotificationManager(access, scope);
        const notification = svc.notify(
          params.userId,
          { title: body.title, body: body.body, type: body.type as any, priority: body.priority as any },
          auth.userId,
          scope,
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

    // ─── POST /notify-role/:role — By role (manager) ──
    .post(
      '/notify-role/:role',
      ({ access, params, body }) => {
        const svc = service!;
        const auth = access.requireUser();
        const scope = requestScope(access);
        requireNotificationManager(access, scope);
        const notification = svc.notifyRole(
          params.role,
          { title: body.title, body: body.body, type: body.type as any, priority: body.priority as any },
          auth.userId,
          scope,
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
      ({ access, params }) => {
        const svc = service!;
        const auth = access.requireUser();
        const scope = requestScope(access);
        const notification = svc.getByIdForUser(
          params.id,
          auth.userId,
          notificationAudienceRoles(access, scope),
          scope,
        );
        if (!notification) throw new AuthError('Not found', 'NOT_FOUND', 404);
        return { notification };
      },
      { params: t.Object({ id: t.String({ minLength: 1 }) }) }
    )

    // ─── POST /:id/seen ──────────────────────────────
    .post(
      '/:id/seen',
      ({ access, params }) => {
        const svc = service!;
        const auth = access.requireUser();
        const scope = requestScope(access);
        if (!svc.getByIdForUser(
          params.id,
          auth.userId,
          notificationAudienceRoles(access, scope),
          scope,
        )) {
          throw new AuthError('Not found', 'NOT_FOUND', 404);
        }
        svc.markSeen(params.id, auth.userId, scope);
        return { ok: true };
      },
      { params: t.Object({ id: t.String({ minLength: 1 }) }) }
    )

    // ─── POST /:id/read ──────────────────────────────
    .post(
      '/:id/read',
      ({ access, params }) => {
        const svc = service!;
        const auth = access.requireUser();
        const scope = requestScope(access);
        if (!svc.getByIdForUser(
          params.id,
          auth.userId,
          notificationAudienceRoles(access, scope),
          scope,
        )) {
          throw new AuthError('Not found', 'NOT_FOUND', 404);
        }
        svc.markRead(params.id, auth.userId, scope);
        return { ok: true };
      },
      { params: t.Object({ id: t.String({ minLength: 1 }) }) }
    )

    // ─── POST /:id/dismiss ───────────────────────────
    .post(
      '/:id/dismiss',
      ({ access, params }) => {
        const svc = service!;
        const auth = access.requireUser();
        const scope = requestScope(access);
        if (!svc.getByIdForUser(
          params.id,
          auth.userId,
          notificationAudienceRoles(access, scope),
          scope,
        )) {
          throw new AuthError('Not found', 'NOT_FOUND', 404);
        }
        svc.dismiss(params.id, auth.userId, scope);
        return { ok: true };
      },
      { params: t.Object({ id: t.String({ minLength: 1 }) }) }
    )

    // ─── POST /read-all ──────────────────────────────
    .post('/read-all', ({ access }) => {
      const svc = service!;
      const auth = access.requireUser();
      const scope = requestScope(access);
      svc.markAllRead(
        auth.userId,
        notificationAudienceRoles(access, scope),
        scope,
      );
      return { ok: true };
    })

    // ─── POST /seen-all ──────────────────────────────
    .post('/seen-all', ({ access }) => {
      const svc = service!;
      const auth = access.requireUser();
      const scope = requestScope(access);
      svc.markAllSeen(
        auth.userId,
        notificationAudienceRoles(access, scope),
        scope,
      );
      return { ok: true };
    })

    // ─── GET /:id/receipts — Audit trail (manager) ───
    .get(
      '/:id/receipts',
      ({ access, params }) => {
        const svc = service!;
        access.requireUser();
        const scope = requestScope(access);
        requireNotificationManager(access, scope);
        if (!svc.getById(params.id, scope)) {
          throw new AuthError('Not found', 'NOT_FOUND', 404);
        }
        return { receipts: svc.getReceipts(params.id, scope) };
      },
      { params: t.Object({ id: t.String({ minLength: 1 }) }) }
    )

    // ─── DELETE /:id — Delete (manager) ───────────────
    .delete(
      '/:id',
      ({ access, params }) => {
        const svc = service!;
        access.requireUser();
        const scope = requestScope(access);
        requireNotificationManager(access, scope);
        const deleted = svc.deleteNotification(params.id, scope);
        if (!deleted) throw new AuthError('Not found', 'NOT_FOUND', 404);
        return { ok: true };
      },
      { params: t.Object({ id: t.String({ minLength: 1 }) }) }
    );
}

function requireNotificationManager(
  access: RequestAuthorizationAccess,
  scope: ServiceDataScope,
): void {
  if (!canManageNotificationScope(access, scope)) {
    throw new AuthError('Forbidden', 'FORBIDDEN', 403);
  }
}
