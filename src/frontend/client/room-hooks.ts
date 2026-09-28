import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import type { Row, JsonValue } from '../../sync/types';
import { useClient } from './client-context';
import { useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import { useQuery, useRow } from './data-hooks';
import type { InternalClient } from './sdk';
import { unwrap } from './api';
import type { RoomRecord, RoomMemberRecord, RoomRole } from '../../rooms/types';

const NOOP_UNSUBSCRIBE = () => {};

// ─── useRoom ────────────────────────────────────────────────────────────────

export interface UseRoomResult {
  room: RoomRecord | null;
  members: RoomMemberRecord[];
}

/**
 * Live room + members. Re-renders when the room or its members change.
 */
export function useRoom(roomId: string): UseRoomResult {
  const room = useRow<RoomRecord & Row>('rooms', roomId);

  const memberFilter = useCallback(
    (m: RoomMemberRecord & Row) => m.room_id === roomId,
    [roomId]
  );
  const members = useQuery<RoomMemberRecord & Row>('room_members', memberFilter);

  return { room, members };
}

// ─── useRoomMembers ─────────────────────────────────────────────────────────

/**
 * Just the member list for a room. Lighter than useRoom if you don't need room details.
 */
export function useRoomMembers(roomId: string): RoomMemberRecord[] {
  const filter = useCallback(
    (m: RoomMemberRecord & Row) => m.room_id === roomId,
    [roomId]
  );
  return useQuery<RoomMemberRecord & Row>('room_members', filter);
}

// ─── useRooms ───────────────────────────────────────────────────────────────

/**
 * All rooms the current user belongs to.
 */
export function useRooms(userId: string): RoomRecord[] {
  const memberFilter = useCallback(
    (m: RoomMemberRecord & Row) => m.user_id === userId,
    [userId]
  );
  const memberships = useQuery<RoomMemberRecord & Row>('room_members', memberFilter);
  const roomIds = useMemo(() => new Set(memberships.map((m) => m.room_id)), [memberships]);

  const roomFilter = useCallback(
    (r: RoomRecord & Row) => roomIds.has(r.room_id),
    [roomIds]
  );
  return useQuery<RoomRecord & Row>('rooms', roomFilter);
}

// ─── useRoomActions ─────────────────────────────────────────────────────────

export interface RoomActions {
  create: (name: string, type?: string, maxMembers?: number) => Promise<RoomRecord>;
  /**
   * Confirm and return an existing membership. Zero's default HTTP policy does
   * not self-admit arbitrary users; admission is an app-owned server action.
   */
  join: (roomId: string) => Promise<RoomMemberRecord>;
  leave: (roomId: string) => Promise<void>;
  deleteRoom: (roomId: string) => Promise<void>;
}

/**
 * Room CRUD actions via Eden Treaty API.
 */
export function useRoomActions(): RoomActions {
  const client = useClient();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;

  const runAction = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    if (!boundaryReadyRef.current
      || boundaryKeyRef.current !== callbackBoundaryKey) {
      throw new Error('Room actions are unavailable during an authorization scope transition.');
    }
    const result = await operation();
    if (!boundaryReadyRef.current
      || boundaryKeyRef.current !== callbackBoundaryKey) {
      throw new Error('The authorization scope changed before the room action completed.');
    }
    return result;
  }, [callbackBoundaryKey]);

  const create = useCallback(
    (name: string, type?: string, maxMembers?: number) => runAction(async () => {
      const res = unwrap(await client.api.rooms.post({ name, type, maxMembers }));
      return (res as { room: RoomRecord }).room;
    }),
    [client, runAction]
  );

  const join = useCallback(
    (roomId: string) => runAction(async () => {
      const res = unwrap(await client.api.rooms[roomId].join.post());
      return (res as { member: RoomMemberRecord }).member;
    }),
    [client, runAction]
  );

  const leave = useCallback(
    (roomId: string) => runAction(async () => {
      unwrap(await client.api.rooms[roomId].leave.post());
    }),
    [client, runAction]
  );

  const deleteRoom = useCallback(
    (roomId: string) => runAction(async () => {
      unwrap(await client.api.rooms[roomId].delete());
    }),
    [client, runAction]
  );

  return { create, join, leave, deleteRoom };
}

// ─── useRoomData ────────────────────────────────────────────────────────────

/**
 * Live-updating query of any table filtered by `room_id`.
 * This is the key hook — makes any table with a `room_id` column collaborative.
 *
 * @example
 * ```tsx
 * const moves = useRoomData<GameMove>(roomId, 'game_moves');
 * ```
 */
export function useRoomData<T extends Row & { room_id: string }>(
  roomId: string,
  tableName: string
): T[] {
  const filter = useCallback(
    (row: T) => row.room_id === roomId,
    [roomId]
  );
  return useQuery<T>(tableName, filter);
}

// ─── usePresence ────────────────────────────────────────────────────────────

export interface PresenceMember {
  userId: string;
  status: 'online' | 'idle' | 'away';
  lastSeen: number;
  custom?: Record<string, unknown>;
}

const EMPTY_PRESENCE_MEMBERS: PresenceMember[] = [];

export interface UsePresenceResult {
  members: PresenceMember[];
  update: (data: Record<string, unknown>) => void;
}

/**
 * Presence hook — who's online in a room + their metadata.
 *
 * Auto-heartbeats every 10s. Publishes `myData` changes.
 * Members auto-expire after 30s without heartbeat.
 *
 * @example
 * ```tsx
 * const presence = usePresence(roomId, { cursor: { x: 0, y: 0 } });
 * // Update cursor on mouse move
 * presence.update({ cursor: { x: e.clientX, y: e.clientY } });
 * // See who's online
 * presence.members.map(m => m.userId);
 * ```
 */
export function usePresence(roomId: string, myData?: Record<string, unknown>): UsePresenceResult {
  const client = useClient() as InternalClient;
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const ephemeral = client.ephemeral;
  const userId = client.user?.userId ?? client.user?.username ?? 'anonymous';

  const topic = `presence:${roomId}`;
  const key = `user:${userId}`;

  const myDataRef = useRef(myData);
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  myDataRef.current = myData;
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;

  // Subscribe to presence topic and set initial presence
  useEffect(() => {
    if (!authorizationBoundary.ready) return;
    const effectBoundaryKey = authorizationBoundary.key;

    const scopeIsCurrent = () => boundaryReadyRef.current
      && boundaryKeyRef.current === effectBoundaryKey;

    function buildPresenceValue(): JsonValue {
      const val: Record<string, JsonValue> = {
        status: 'online',
        lastSeen: Date.now(),
      };
      if (myDataRef.current) val.custom = myDataRef.current as JsonValue;
      return val;
    }

    // Set initial presence
    if (!scopeIsCurrent()) return;
    ephemeral.set(topic, key, buildPresenceValue(), 30_000);

    // Heartbeat every 10s
    const heartbeat = setInterval(() => {
      if (scopeIsCurrent()) {
        ephemeral.set(topic, key, buildPresenceValue(), 30_000);
      }
    }, 10_000);

    return () => {
      clearInterval(heartbeat);
      if (scopeIsCurrent()) {
        ephemeral.delete(topic, key);
      }
    };
  }, [authorizationBoundary.key, authorizationBoundary.ready, ephemeral, topic, key]);

  // Subscribe to the topic for live updates
  const subscribe = useCallback(
    (cb: () => void) => authorizationBoundary.ready
      ? ephemeral.subscribe(topic, () => cb())
      : NOOP_UNSUBSCRIBE,
    [authorizationBoundary.key, authorizationBoundary.ready, ephemeral, topic]
  );

  const prevSnapshotRef = useRef<PresenceMember[]>([]);
  const prevBoundaryKeyRef = useRef<string | null>(null);

  const getSnapshot = useCallback(() => {
    if (!authorizationBoundary.ready) {
      prevBoundaryKeyRef.current = authorizationBoundary.key;
      prevSnapshotRef.current = EMPTY_PRESENCE_MEMBERS;
      return EMPTY_PRESENCE_MEMBERS;
    }
    const entries = ephemeral.getEntries(topic);
    const members: PresenceMember[] = [];

    for (const [k, entry] of Object.entries(entries)) {
      if (!k.startsWith('user:')) continue;
      const uid = k.slice(5);
      const data = entry.value as Record<string, unknown>;
      members.push({
        userId: uid,
        status: (data.status as PresenceMember['status']) ?? 'online',
        lastSeen: (data.lastSeen as number) ?? 0,
        custom: data.custom as Record<string, unknown> | undefined,
      });
    }

    const previous = prevSnapshotRef.current;
    if (prevBoundaryKeyRef.current === authorizationBoundary.key
      && previous.length === members.length
      && previous.every((member, index) => {
        const next = members[index];
        return member.userId === next.userId
          && member.status === next.status
          && member.lastSeen === next.lastSeen
          && member.custom === next.custom;
      })) {
      return previous;
    }
    prevBoundaryKeyRef.current = authorizationBoundary.key;
    prevSnapshotRef.current = members;
    return members;
  }, [authorizationBoundary.key, authorizationBoundary.ready, ephemeral, topic]);

  const emptyMembers: PresenceMember[] = useMemo(() => [], []);
  const members = useSyncExternalStore(subscribe, getSnapshot, () => emptyMembers);

  const update = useCallback(
    (data: Record<string, unknown>) => {
      if (!boundaryReadyRef.current
        || boundaryKeyRef.current !== callbackBoundaryKey) return;
      const val: Record<string, JsonValue> = {
        status: 'online',
        lastSeen: Date.now(),
        custom: data as JsonValue,
      };
      ephemeral.set(topic, key, val, 30_000);
    },
    [callbackBoundaryKey, ephemeral, topic, key]
  );

  return { members, update };
}
