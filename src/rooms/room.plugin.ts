import { Elysia, t } from 'elysia';
import { RoomOwnerCannotLeaveError, RoomService } from './room-service';
import type { ReactiveDB } from '../sync/reactive-db';
import { AuthError } from '../auth/types';
import { getPublicAuthErrorMessage } from '../auth/auth-error-response';
import type { AuthContext } from '../auth/types';
import type { RoomRecord } from './types';
import {
  createAuthMiddleware,
  type AuthMiddlewareAuthorizationOptions,
} from '../auth/auth.middleware';
import {
  requireRequestServiceDataScope,
  type ServiceDataScope,
} from '../auth/service-data-scope';
import { getTokenService } from '../auth/auth.plugin';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { TokenService } from '../auth/token-service';
import { CompatibilityProviderRegistry } from '../runtime/compatibility-provider-registry';
import {
  ZERO_AUTHORIZATION_KERNEL,
  ZERO_AUTH_TOKEN_SERVICE,
  ZERO_ROOM_SERVICE,
} from '../runtime/service-keys';
import type { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { ensureNullableTenantColumn } from '../runtime/tenant-schema';
import { canManageRoomScope } from './room-access';

// ─── Legacy Compatibility Getter ────────────────────────────────────────────

const roomProviders = new CompatibilityProviderRegistry<RoomService>('Room service');

/**
 * Get the RoomService instance. Returns null if the plugin hasn't started.
 */
export function getRoomService(): RoomService | null {
  return roomProviders.get();
}

// ─── Table Definitions ──────────────────────────────────────────────────────

export function defineRoomTables(db: ReactiveDB): void {
  ensureNullableTenantColumn(db, 'rooms');
  ensureNullableTenantColumn(db, 'room_members');
  db.defineTable('rooms', {
    room_id: 'text primary key',
    tenant_id: 'text',
    name: 'text not null',
    type: "text not null default 'default'",
    created_by: 'text not null',
    metadata: 'text',
    max_members: 'integer not null default 100',
    created_at: 'integer not null',
  });

  db.defineTable('room_members', {
    member_id: 'text primary key',
    tenant_id: 'text',
    room_id: 'text not null',
    user_id: 'text not null',
    role: "text not null default 'member'",
    joined_at: 'integer not null',
    metadata: 'text',
  });

  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_room_member_unique ON room_members(room_id, user_id)'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_room_members_room ON room_members(room_id)'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id)'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_rooms_tenant ON rooms(tenant_id)'
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_room_members_tenant_user
     ON room_members(tenant_id, user_id)`
  );
}

// ─── Config ─────────────────────────────────────────────────────────────────

export interface RoomPluginConfig {
  db: ReactiveDB;
  runtime?: ZeroAppRuntime;
  getTokenService?: () => TokenService | null;
  /** App-local authorization dependencies for tenant-bound service data. */
  authorization?: AuthMiddlewareAuthorizationOptions;
  onServiceCreated?: (service: RoomService) => void;
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

/**
 * Create the rooms Elysia plugin.
 *
 * Follows the notification plugin pattern:
 * - Tables defined in onStart
 * - App-local service with a safe legacy getter adapter
 * - Auth middleware for typed auth context
 * - REST routes under /rooms
 *
 * Mount AFTER auth plugin.
 */
export function createRoomPlugin(config: RoomPluginConfig) {
  const owner = {};
  let service: RoomService | null = null;
  let registration: ReturnType<typeof roomProviders.register> | null = null;
  config.runtime?.addCleanup(() => registration?.unregister());
  const getRoomTokenService = config.getTokenService
    ?? (config.runtime
      ? () => config.runtime!.get(ZERO_AUTH_TOKEN_SERVICE)
      : getTokenService);
  const getAuthorizationKernel = config.authorization?.getAuthorizationKernel
    ?? (() => config.runtime?.get(ZERO_AUTHORIZATION_KERNEL) ?? null);
  const authorization: AuthMiddlewareAuthorizationOptions = {
    ...config.authorization,
    getAuthorizationKernel,
  };
  const requestScope = (access: Parameters<typeof requireRequestServiceDataScope>[0]) =>
    requireRequestServiceDataScope(access, getAuthorizationKernel);

  return new Elysia({ name: 'rooms', prefix: '/rooms' })

    .use(createAuthMiddleware(getRoomTokenService, authorization))

    // ─── Lifecycle ─────────────────────────────────────
    .onStart(() => {
      defineRoomTables(config.db);
      service = new RoomService(
        config.db,
        getAuthorizationKernel()?.tenancy.mode ?? 'single',
      );
      registration = roomProviders.register(owner, () => service);
      config.runtime?.set(ZERO_ROOM_SERVICE, service);
      config.onServiceCreated?.(service);
      emitPlatformCode(OBS_CODES.ROOMS_STARTED, {
        metadata: { tablesDefined: true },
      });
    })

    .onStop(() => {
      if (service) config.runtime?.clear(ZERO_ROOM_SERVICE, service);
      registration?.unregister();
      registration = null;
      service = null;
      emitPlatformCode(OBS_CODES.ROOMS_STOPPED);
    })

    // ─── Derive: expose service globally ──────────────
    .derive({ as: 'global' }, () => ({
      roomService: service,
    }))

    // ─── Error handler ────────────────────────────────
    .onError(({ error, set }) => {
      if (error instanceof RoomOwnerCannotLeaveError) {
        set.status = 409;
        return {
          error: error.message,
          code: 'ROOM_OWNER_CANNOT_LEAVE',
        };
      }
      if (error instanceof AuthError) {
        set.status = error.status;
        return { error: getPublicAuthErrorMessage(error), code: error.code };
      }
    })

    // ─── GET / — List rooms for current user ──────────
    .get('/', ({ access }) => {
      const svc = service!;
      const auth = access.requireUser();
      const scope = requestScope(access);
      return { rooms: svc.getRoomsForUser(auth.userId, scope) };
    })

    // ─── POST / — Create room ─────────────────────────
    .post(
      '/',
      ({ access, body }) => {
        const svc = service!;
        const auth = access.requireUser();
        const scope = requestScope(access);
        const room = svc.create(auth.userId, {
          name: body.name,
          type: body.type,
          metadata: body.metadata ? JSON.parse(body.metadata) : undefined,
          maxMembers: body.maxMembers,
        }, scope);
        return { room };
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1 }),
          type: t.Optional(t.String()),
          metadata: t.Optional(t.String()),
          maxMembers: t.Optional(t.Number()),
        }),
      }
    )

    // ─── GET /:id — Get room details ──────────────────
    .get(
      '/:id',
      ({ access, params }) => {
        const svc = service!;
        const auth = access.requireUser();
        const scope = requestScope(access);
        const room = requireRoomReadAccess(svc, params.id, auth, scope);
        return { room };
      },
      { params: t.Object({ id: t.String({ minLength: 1 }) }) }
    )

    // ─── GET /:id/members — Get room members ─────────
    .get(
      '/:id/members',
      ({ access, params }) => {
        const svc = service!;
        const auth = access.requireUser();
        const scope = requestScope(access);
        requireRoomReadAccess(svc, params.id, auth, scope);
        return { members: svc.getMembers(params.id, scope) };
      },
      { params: t.Object({ id: t.String({ minLength: 1 }) }) }
    )

    // ─── POST /:id/join — Join room ──────────────────
    .post(
      '/:id/join',
      ({ access, params }) => {
        const svc = service!;
        const auth = access.requireUser();
        const scope = requestScope(access);
        // HTTP self-join is intentionally closed to arbitrary authenticated
        // users. Apps with an explicit admission policy can add memberships
        // through the server-side RoomService, after which this endpoint is
        // idempotent for an already admitted member.
        requireRoomReadAccess(svc, params.id, auth, scope);
        return { member: svc.getMember(params.id, auth.userId, scope)! };
      },
      { params: t.Object({ id: t.String({ minLength: 1 }) }) }
    )

    // ─── POST /:id/leave — Leave room ────────────────
    .post(
      '/:id/leave',
      ({ access, params }) => {
        const svc = service!;
        const auth = access.requireUser();
        const scope = requestScope(access);
        const left = svc.leave(params.id, auth.userId, scope);
        if (!left) throw new AuthError('Not a member of this room', 'BAD_REQUEST', 400);
        return { ok: true };
      },
      { params: t.Object({ id: t.String({ minLength: 1 }) }) }
    )

    // ─── DELETE /:id — Delete room ───────────────────
    .delete(
      '/:id',
      ({ access, params }) => {
        const svc = service!;
        const auth = access.requireUser();
        const scope = requestScope(access);
        const room = svc.getRoom(params.id, scope);
        if (
          !room
          || (
            room.created_by !== auth.userId
            && !canManageRoomScope(access, scope)
          )
        ) {
          throw new AuthError('Room not found', 'NOT_FOUND', 404);
        }
        svc.delete(params.id, scope);
        return { ok: true };
      },
      { params: t.Object({ id: t.String({ minLength: 1 }) }) }
    );
}

/**
 * Resolve a room only when the caller may observe it.
 *
 * Missing and unauthorized rooms intentionally share the same response so a
 * guessed room id cannot be used as a membership oracle. Room creators are
 * members by invariant. Global platform administration grants delete authority
 * only in legacy single mode; multi mode uses the live tenant owner,
 * all-permissions, or rooms:manage authority.
 */
function requireRoomReadAccess(
  service: RoomService,
  roomId: string,
  auth: AuthContext,
  scope: ServiceDataScope,
): RoomRecord {
  const room = service.getRoom(roomId, scope);
  const authorized = service.isMember(roomId, auth.userId, scope);
  if (!room || !authorized) {
    throw new AuthError('Room not found', 'NOT_FOUND', 404);
  }
  return room;
}
