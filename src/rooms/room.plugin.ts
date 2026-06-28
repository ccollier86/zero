import { Elysia, t } from 'elysia';
import { RoomService } from './room-service';
import type { ReactiveDB } from '../sync/reactive-db';
import { AuthError } from '../auth/types';
import { createAuthMiddleware } from '../auth/auth.middleware';
import { getTokenService } from '../auth/auth.plugin';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';

// ─── Module-Level Singleton ─────────────────────────────────────────────────

let _roomService: RoomService | null = null;

/**
 * Get the RoomService instance. Returns null if the plugin hasn't started.
 */
export function getRoomService(): RoomService | null {
  return _roomService;
}

// ─── Table Definitions ──────────────────────────────────────────────────────

function defineRoomTables(db: ReactiveDB): void {
  db.defineTable('rooms', {
    room_id: 'text primary key',
    name: 'text not null',
    type: "text not null default 'default'",
    created_by: 'text not null',
    metadata: 'text',
    max_members: 'integer not null default 100',
    created_at: 'integer not null',
  });

  db.defineTable('room_members', {
    member_id: 'text primary key',
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
}

// ─── Config ─────────────────────────────────────────────────────────────────

export interface RoomPluginConfig {
  db: ReactiveDB;
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

/**
 * Create the rooms Elysia plugin.
 *
 * Follows the notification plugin pattern:
 * - Tables defined in onStart
 * - Module-level singleton service
 * - Auth middleware for typed auth context
 * - REST routes under /rooms
 *
 * Mount AFTER auth plugin.
 */
export function createRoomPlugin(config: RoomPluginConfig) {
  return new Elysia({ name: 'rooms', prefix: '/rooms' })

    .use(createAuthMiddleware(getTokenService))

    // ─── Lifecycle ─────────────────────────────────────
    .onStart(() => {
      defineRoomTables(config.db);
      _roomService = new RoomService(config.db);
      emitPlatformCode(OBS_CODES.ROOMS_STARTED, {
        metadata: { tablesDefined: true },
      });
    })

    .onStop(() => {
      _roomService = null;
      emitPlatformCode(OBS_CODES.ROOMS_STOPPED);
    })

    // ─── Derive: expose service globally ──────────────
    .derive({ as: 'global' }, () => ({
      roomService: _roomService,
    }))

    // ─── Error handler ────────────────────────────────
    .onError(({ error, set }) => {
      if (error instanceof AuthError) {
        set.status = error.status;
        return { error: error.message, code: error.code };
      }
    })

    // ─── GET / — List rooms for current user ──────────
    .get('/', ({ requireAuth }) => {
      const svc = _roomService!;
      const auth = requireAuth();
      return { rooms: svc.getRoomsForUser(auth.userId) };
    })

    // ─── POST / — Create room ─────────────────────────
    .post(
      '/',
      ({ requireAuth, body }) => {
        const svc = _roomService!;
        const auth = requireAuth();
        const room = svc.create(auth.userId, {
          name: body.name,
          type: body.type,
          metadata: body.metadata ? JSON.parse(body.metadata) : undefined,
          maxMembers: body.maxMembers,
        });
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
      ({ requireAuth, params }) => {
        const svc = _roomService!;
        requireAuth();
        const room = svc.getRoom(params.id);
        if (!room) throw new AuthError('Room not found', 'NOT_FOUND', 404);
        return { room };
      },
      { params: t.Object({ id: t.String({ minLength: 1 }) }) }
    )

    // ─── GET /:id/members — Get room members ─────────
    .get(
      '/:id/members',
      ({ requireAuth, params }) => {
        const svc = _roomService!;
        requireAuth();
        return { members: svc.getMembers(params.id) };
      },
      { params: t.Object({ id: t.String({ minLength: 1 }) }) }
    )

    // ─── POST /:id/join — Join room ──────────────────
    .post(
      '/:id/join',
      ({ requireAuth, params }) => {
        const svc = _roomService!;
        const auth = requireAuth();
        try {
          const member = svc.join(params.id, auth.userId);
          return { member };
        } catch (err) {
          throw new AuthError(
            err instanceof Error ? err.message : 'Failed to join room',
            'BAD_REQUEST',
            400
          );
        }
      },
      { params: t.Object({ id: t.String({ minLength: 1 }) }) }
    )

    // ─── POST /:id/leave — Leave room ────────────────
    .post(
      '/:id/leave',
      ({ requireAuth, params }) => {
        const svc = _roomService!;
        const auth = requireAuth();
        const left = svc.leave(params.id, auth.userId);
        if (!left) throw new AuthError('Not a member of this room', 'BAD_REQUEST', 400);
        return { ok: true };
      },
      { params: t.Object({ id: t.String({ minLength: 1 }) }) }
    )

    // ─── DELETE /:id — Delete room ───────────────────
    .delete(
      '/:id',
      ({ requireAuth, params }) => {
        const svc = _roomService!;
        const auth = requireAuth();
        const room = svc.getRoom(params.id);
        if (!room) throw new AuthError('Room not found', 'NOT_FOUND', 404);
        if (room.created_by !== auth.userId && auth.role !== 'admin') {
          throw new AuthError('Only room owner or admin can delete', 'FORBIDDEN', 403);
        }
        svc.delete(params.id);
        return { ok: true };
      },
      { params: t.Object({ id: t.String({ minLength: 1 }) }) }
    );
}
