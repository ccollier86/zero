import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import type { Row, JsonValue } from '../../sync/types';
import { useClient, useQuery, useRow } from './hooks';
import type { InternalClient } from './sdk';
import { unwrap } from './api';
import type { RoomRecord, RoomMemberRecord, RoomRole } from '../../rooms/types';

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
  join: (roomId: string) => Promise<RoomMemberRecord>;
  leave: (roomId: string) => Promise<void>;
  deleteRoom: (roomId: string) => Promise<void>;
}

/**
 * Room CRUD actions via Eden Treaty API.
 */
export function useRoomActions(): RoomActions {
  const client = useClient();

  const create = useCallback(
    async (name: string, type?: string, maxMembers?: number) => {
      const res = unwrap(await client.api.rooms.post({ name, type, maxMembers }));
      return (res as { room: RoomRecord }).room;
    },
    [client]
  );

  const join = useCallback(
    async (roomId: string) => {
      const res = unwrap(await client.api.rooms[roomId].join.post());
      return (res as { member: RoomMemberRecord }).member;
    },
    [client]
  );

  const leave = useCallback(
    async (roomId: string) => {
      unwrap(await client.api.rooms[roomId].leave.post());
    },
    [client]
  );

  const deleteRoom = useCallback(
    async (roomId: string) => {
      unwrap(await client.api.rooms[roomId].delete());
    },
    [client]
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
  const ephemeral = client.ephemeral;
  const userId = client.user?.userId ?? client.user?.username ?? 'anonymous';

  const topic = `presence:${roomId}`;
  const key = `user:${userId}`;

  const myDataRef = useRef(myData);
  myDataRef.current = myData;

  // Subscribe to presence topic and set initial presence
  useEffect(() => {
    function buildPresenceValue(): JsonValue {
      const val: Record<string, JsonValue> = {
        status: 'online',
        lastSeen: Date.now(),
      };
      if (myDataRef.current) val.custom = myDataRef.current as JsonValue;
      return val;
    }

    // Set initial presence
    ephemeral.set(topic, key, buildPresenceValue(), 30_000);

    // Heartbeat every 10s
    const heartbeat = setInterval(() => {
      ephemeral.set(topic, key, buildPresenceValue(), 30_000);
    }, 10_000);

    return () => {
      clearInterval(heartbeat);
      ephemeral.delete(topic, key);
    };
  }, [ephemeral, topic, key]);

  // Subscribe to the topic for live updates
  const subscribe = useCallback(
    (cb: () => void) => ephemeral.subscribe(topic, () => cb()),
    [ephemeral, topic]
  );

  const prevSnapshotRef = useRef<PresenceMember[]>([]);

  const getSnapshot = useCallback(() => {
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

    // Return stable reference if data hasn't changed (useSyncExternalStore uses Object.is)
    const prev = prevSnapshotRef.current;
    if (
      prev.length === members.length &&
      prev.every((m, i) => m.userId === members[i].userId && m.status === members[i].status && m.lastSeen === members[i].lastSeen)
    ) {
      return prev;
    }
    prevSnapshotRef.current = members;
    return members;
  }, [ephemeral, topic]);

  const emptyMembers: PresenceMember[] = useMemo(() => [], []);
  const members = useSyncExternalStore(subscribe, getSnapshot, () => emptyMembers);

  const update = useCallback(
    (data: Record<string, unknown>) => {
      const val: Record<string, JsonValue> = {
        status: 'online',
        lastSeen: Date.now(),
        custom: data as JsonValue,
      };
      ephemeral.set(topic, key, val, 30_000);
    },
    [ephemeral, topic, key]
  );

  return { members, update };
}
