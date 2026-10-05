/**
 * room.plugin.test.ts
 *
 * Exercises the room HTTP authorization boundary through a real Elysia app.
 * Direct RoomService membership writes stand in for an app-owned, explicit
 * admission policy; the public self-join endpoint must not create membership
 * for an arbitrary authenticated user.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createAuthPlugin, getAuthStore, getTokenService } from '../auth/auth.plugin';
import type { UserRecord } from '../auth/types';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { createRoomPlugin, getRoomService } from './room.plugin';
import type { RoomMemberRecord, RoomRecord } from './types';

let db: ReactiveDB;
let app: ReturnType<typeof createApp> | null = null;
let baseUrl = '';

function createApp(database: ReactiveDB) {
  return new Elysia()
    .use(createAuthPlugin({ db: database, bootstrap: 'public' }))
    .use(createRoomPlugin({ db: database }))
    .listen(0);
}

async function waitForPlugins(): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (getAuthStore() && getTokenService() && getRoomService()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Plugins did not start');
}

async function createUser(role = 'user'): Promise<{
  user: UserRecord;
  token: string;
}> {
  const suffix = crypto.randomUUID();
  const user = await getAuthStore()!.createUser({
    username: `${role}_${suffix}`,
    email: `${role}_${suffix}@test.local`,
    password: 'password123',
    role,
  });
  const tokens = await getTokenService()!.issueTokenPair(user);
  return { user, token: tokens.accessToken };
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<{ status: number; data: T }> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data: data as T };
}

async function createRoom(token: string, name: string): Promise<RoomRecord> {
  const result = await requestJson<{ room: RoomRecord }>('/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  }, token);
  expect(result.status).toBe(200);
  return result.data.room;
}

beforeAll(async () => {
  db = createReactiveDB({ mode: 'memory' });
  app = createApp(db);
  baseUrl = `http://localhost:${app.server!.port}`;
  await waitForPlugins();
});

afterAll(async () => {
  await app?.stop();
  app = null;
  db.dispose();
});

describe('room route authorization', () => {
  test('rejects malformed room metadata without creating room or owner membership', async () => {
    const owner = await createUser();
    const roomsBefore = db.query('rooms').length;
    const membersBefore = db.query('room_members').length;
    for (const metadata of ['{', '[]', 'null', '"not-an-object"']) {
      const result = await requestJson<{ code: string }>('/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Invalid metadata', metadata }),
      }, owner.token);
      expect(result.status).toBe(400);
      expect(result.data.code).toBe('BAD_REQUEST');
    }
    expect(db.query('rooms').length).toBe(roomsBefore);
    expect(db.query('room_members').length).toBe(membersBefore);
  });

  test('retains valid JSON-object room metadata and automatic owner membership', async () => {
    const owner = await createUser();
    const result = await requestJson<{ room: RoomRecord }>('/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Valid metadata', metadata: '{"kind":"synthetic"}' }),
    }, owner.token);
    expect(result.status).toBe(200);
    expect(JSON.parse(result.data.room.metadata!)).toEqual({ kind: 'synthetic' });
    expect(getRoomService()!.getMember(result.data.room.room_id, owner.user.userId)?.role).toBe('owner');
  });

  test('rejects room capacity that cannot contain its required owner', async () => {
    const owner = await createUser();
    const roomsBefore = db.query('rooms').length;
    for (const maxMembers of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const result = await requestJson('/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Invalid capacity', maxMembers }),
      }, owner.token);
      expect(result.status).toBe(422);
      expect(() => getRoomService()!.create(owner.user.userId, {
        name: 'Invalid direct capacity', maxMembers,
      })).toThrow('Room capacity must be a positive safe integer');
    }
    expect(db.query('rooms').length).toBe(roomsBefore);
  });

  test('requires authentication for room detail, members, and join', async () => {
    const owner = await createUser();
    const room = await createRoom(owner.token, 'Authenticated room');

    for (const [path, method] of [
      [`/rooms/${room.room_id}`, 'GET'],
      [`/rooms/${room.room_id}/members`, 'GET'],
      [`/rooms/${room.room_id}/join`, 'POST'],
    ] as const) {
      const result = await requestJson<{ code: string }>(path, { method });
      expect(result.status).toBe(401);
      expect(result.data.code).toBe('UNAUTHORIZED');
    }
  });

  test('does not disclose room detail or members to an authenticated non-member', async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const room = await createRoom(owner.token, 'Private room');

    const detail = await requestJson<{ code: string; error: string }>(
      `/rooms/${room.room_id}`,
      {},
      outsider.token,
    );
    const members = await requestJson<{ code: string; error: string }>(
      `/rooms/${room.room_id}/members`,
      {},
      outsider.token,
    );

    expect(detail).toEqual({ status: 404, data: { error: 'Room not found', code: 'NOT_FOUND' } });
    expect(members).toEqual({ status: 404, data: { error: 'Room not found', code: 'NOT_FOUND' } });
  });

  test('prevents arbitrary authenticated users from joining by guessed room id', async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const room = await createRoom(owner.token, 'Closed room');

    const joined = await requestJson<{ code: string; error: string }>(
      `/rooms/${room.room_id}/join`,
      { method: 'POST' },
      outsider.token,
    );

    expect(joined).toEqual({ status: 404, data: { error: 'Room not found', code: 'NOT_FOUND' } });
    expect(getRoomService()!.isMember(room.room_id, outsider.user.userId)).toBe(false);
  });

  test('returns the same not-found result for missing and unauthorized room ids', async () => {
    const outsider = await createUser();
    const missingId = `room_${crypto.randomUUID()}`;

    for (const [path, method] of [
      [`/rooms/${missingId}`, 'GET'],
      [`/rooms/${missingId}/members`, 'GET'],
      [`/rooms/${missingId}/join`, 'POST'],
    ] as const) {
      const result = await requestJson<{ code: string }>(path, { method }, outsider.token);
      expect(result.status).toBe(404);
      expect(result.data.code).toBe('NOT_FOUND');
    }
  });

  test('allows owners and explicitly admitted members to read and idempotently join', async () => {
    const owner = await createUser();
    const member = await createUser();
    const roomAdmin = await createUser();
    const room = await createRoom(owner.token, 'Member room');
    const admitted = getRoomService()!.join(room.room_id, member.user.userId);
    const admittedAdmin = getRoomService()!.join(room.room_id, roomAdmin.user.userId, 'admin');

    for (const actor of [owner, member, roomAdmin]) {
      const detail = await requestJson<{ room: RoomRecord }>(
        `/rooms/${room.room_id}`,
        {},
        actor.token,
      );
      const members = await requestJson<{ members: RoomMemberRecord[] }>(
        `/rooms/${room.room_id}/members`,
        {},
        actor.token,
      );
      const joined = await requestJson<{ member: RoomMemberRecord }>(
        `/rooms/${room.room_id}/join`,
        { method: 'POST' },
        actor.token,
      );

      expect(detail.status).toBe(200);
      expect(detail.data.room.room_id).toBe(room.room_id);
      expect(members.status).toBe(200);
      expect(members.data.members).toHaveLength(3);
      expect(joined.status).toBe(200);
      expect(joined.data.member.user_id).toBe(actor.user.userId);
    }

    expect(getRoomService()!.getMembers(room.room_id)).toHaveLength(3);
    expect(admitted.role).toBe('member');
    expect(admittedAdmin.role).toBe('admin');
  });

  test('prevents the owner from orphaning a room while allowing members to leave', async () => {
    const owner = await createUser();
    const member = await createUser();
    const room = await createRoom(owner.token, 'Leave invariants');
    getRoomService()!.join(room.room_id, member.user.userId);

    expect(() => getRoomService()!.leave(room.room_id, owner.user.userId)).toThrow(
      'Room owner must delete the room instead of leaving it'
    );
    expect(getRoomService()!.isMember(room.room_id, owner.user.userId)).toBe(true);

    const ownerLeave = await requestJson<{ code: string; error: string }>(
      `/rooms/${room.room_id}/leave`,
      { method: 'POST' },
      owner.token,
    );
    expect(ownerLeave).toEqual({
      status: 409,
      data: {
        error: 'Room owner must delete the room instead of leaving it',
        code: 'ROOM_OWNER_CANNOT_LEAVE',
      },
    });
    expect(getRoomService()!.isMember(room.room_id, owner.user.userId)).toBe(true);

    const memberLeave = await requestJson<{ ok: boolean }>(
      `/rooms/${room.room_id}/leave`,
      { method: 'POST' },
      member.token,
    );
    expect(memberLeave).toEqual({ status: 200, data: { ok: true } });
    expect(getRoomService()!.isMember(room.room_id, member.user.userId)).toBe(false);
  });

  test('returns the same result when a non-owner deletes an existing or missing room', async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const room = await createRoom(owner.token, 'Delete privacy');

    for (const roomId of [room.room_id, `room_${crypto.randomUUID()}`]) {
      const result = await requestJson<{ code: string; error: string }>(
        `/rooms/${roomId}`,
        { method: 'DELETE' },
        outsider.token,
      );
      expect(result).toEqual({
        status: 404,
        data: { error: 'Room not found', code: 'NOT_FOUND' },
      });
    }
    expect(getRoomService()!.getRoom(room.room_id)).not.toBeNull();
  });

  test('keeps platform administration separate from room data access', async () => {
    const owner = await createUser();
    const admin = await createUser('admin');
    const room = await createRoom(owner.token, 'Admin room');

    const detail = await requestJson<{ room: RoomRecord }>(
      `/rooms/${room.room_id}`,
      {},
      admin.token,
    );
    const members = await requestJson<{ members: RoomMemberRecord[] }>(
      `/rooms/${room.room_id}/members`,
      {},
      admin.token,
    );
    const joined = await requestJson<{ member: RoomMemberRecord }>(
      `/rooms/${room.room_id}/join`,
      { method: 'POST' },
      admin.token,
    );

    expect(detail.status).toBe(404);
    expect(members.status).toBe(404);
    expect(joined.status).toBe(404);
    expect(getRoomService()!.isMember(room.room_id, admin.user.userId)).toBe(false);

    const deleted = await requestJson<{ ok: boolean }>(
      `/rooms/${room.room_id}`,
      { method: 'DELETE' },
      admin.token,
    );
    expect(deleted).toEqual({ status: 200, data: { ok: true } });
    expect(getRoomService()!.getRoom(room.room_id)).toBeNull();
  });
});
