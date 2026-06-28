import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';
import type { Row } from '../sync/types';
import type { RoomRecord, RoomMemberRecord, CreateRoomParams, RoomRole } from './types';

// ─── SQL Row Types ──────────────────────────────────────────────────────────

interface RoomRow {
  room_id: string;
  name: string;
  type: string;
  created_by: string;
  metadata: string | null;
  max_members: number;
  created_at: number;
}

interface MemberRow {
  member_id: string;
  room_id: string;
  user_id: string;
  role: string;
  joined_at: number;
  metadata: string | null;
}

interface CountRow {
  count: number;
}

// ─── RoomService ────────────────────────────────────────────────────────────

export class RoomService {
  private stmts: {
    getRoom: Statement;
    getMembersByRoom: Statement;
    getMember: Statement;
    getMemberCount: Statement;
    getRoomsForUser: Statement;
    getMemberByRoomUser: Statement;
  };

  constructor(private db: ReactiveDB) {
    this.stmts = {
      getRoom: db.prepare('SELECT * FROM rooms WHERE room_id = ?'),
      getMembersByRoom: db.prepare('SELECT * FROM room_members WHERE room_id = ? ORDER BY joined_at'),
      getMember: db.prepare('SELECT * FROM room_members WHERE member_id = ?'),
      getMemberCount: db.prepare('SELECT COUNT(*) as count FROM room_members WHERE room_id = ?'),
      getRoomsForUser: db.prepare(
        `SELECT r.* FROM rooms r
         INNER JOIN room_members m ON r.room_id = m.room_id
         WHERE m.user_id = ?
         ORDER BY r.created_at DESC`
      ),
      getMemberByRoomUser: db.prepare(
        'SELECT * FROM room_members WHERE room_id = ? AND user_id = ?'
      ),
    };
  }

  /** Create a room. The creator is automatically added as 'owner'. */
  create(createdBy: string, params: CreateRoomParams): RoomRecord {
    const roomId = `room_${crypto.randomUUID()}`;
    const now = Date.now();

    const room: RoomRecord = {
      room_id: roomId,
      name: params.name,
      type: params.type ?? 'default',
      created_by: createdBy,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      max_members: params.maxMembers ?? 100,
      created_at: now,
    };

    this.db.transaction(() => {
      this.db.insert('rooms', room as unknown as Row);

      // Auto-join creator as owner
      const member: RoomMemberRecord = {
        member_id: `mem_${crypto.randomUUID()}`,
        room_id: roomId,
        user_id: createdBy,
        role: 'owner',
        joined_at: now,
        metadata: null,
      };
      this.db.insert('room_members', member as unknown as Row);
    });

    return room;
  }

  /** Join a room. Validates max_members. */
  join(roomId: string, userId: string, role: RoomRole = 'member'): RoomMemberRecord {
    const room = this.stmts.getRoom.get(roomId) as RoomRow | null;
    if (!room) throw new Error(`Room not found: ${roomId}`);

    // Check if already a member
    const existing = this.stmts.getMemberByRoomUser.get(roomId, userId) as MemberRow | null;
    if (existing) return existing as unknown as RoomMemberRecord;

    // Check max members
    const { count } = this.stmts.getMemberCount.get(roomId) as CountRow;
    if (count >= room.max_members) throw new Error(`Room is full (max: ${room.max_members})`);

    const member: RoomMemberRecord = {
      member_id: `mem_${crypto.randomUUID()}`,
      room_id: roomId,
      user_id: userId,
      role,
      joined_at: Date.now(),
      metadata: null,
    };

    this.db.insert('room_members', member as unknown as Row);
    return member;
  }

  /** Leave a room. Returns true if the user was a member. */
  leave(roomId: string, userId: string): boolean {
    const member = this.stmts.getMemberByRoomUser.get(roomId, userId) as MemberRow | null;
    if (!member) return false;

    this.db.delete('room_members', member.member_id);
    return true;
  }

  /** Get room by ID. */
  getRoom(roomId: string): RoomRecord | null {
    return this.stmts.getRoom.get(roomId) as RoomRecord | null;
  }

  /** Get all members of a room. */
  getMembers(roomId: string): RoomMemberRecord[] {
    return this.stmts.getMembersByRoom.all(roomId) as RoomMemberRecord[];
  }

  /** Get all rooms a user belongs to. */
  getRoomsForUser(userId: string): RoomRecord[] {
    return this.stmts.getRoomsForUser.all(userId) as RoomRecord[];
  }

  /** Check if a user is a member of a room. */
  isMember(roomId: string, userId: string): boolean {
    return this.stmts.getMemberByRoomUser.get(roomId, userId) !== null;
  }

  /** Delete a room and all its members. */
  delete(roomId: string): boolean {
    const room = this.stmts.getRoom.get(roomId) as RoomRow | null;
    if (!room) return false;

    const members = this.stmts.getMembersByRoom.all(roomId) as MemberRow[];

    this.db.transaction(() => {
      for (const m of members) {
        this.db.delete('room_members', m.member_id);
      }
      this.db.delete('rooms', roomId);
    });

    return true;
  }
}
