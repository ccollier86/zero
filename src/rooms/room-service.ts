import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';
import type { Row } from '../sync/types';
import type { RoomRecord, RoomMemberRecord, CreateRoomParams, RoomRole } from './types';
import { RoomInputError } from './room-error';
import {
  applicationServiceDataScope,
  serviceDataTenantId,
  type ServiceDataScope,
} from '../auth/service-data-scope';

// ─── SQL Row Types ──────────────────────────────────────────────────────────

interface RoomRow {
  room_id: string;
  tenant_id: string | null;
  name: string;
  type: string;
  created_by: string;
  metadata: string | null;
  max_members: number;
  created_at: number;
}

interface MemberRow {
  member_id: string;
  tenant_id: string | null;
  room_id: string;
  user_id: string;
  role: string;
  joined_at: number;
  metadata: string | null;
}

interface CountRow {
  count: number;
}

/** Raised when a membership mutation would orphan a room's creator/owner. */
export class RoomOwnerCannotLeaveError extends Error {
  constructor() {
    super('Room owner must delete the room instead of leaving it');
    this.name = 'RoomOwnerCannotLeaveError';
  }
}

/** Synchronous authority check executed while the system DB writer lock is held. */
export type RoomCommitFence = () => void;

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

  constructor(
    private db: ReactiveDB,
    private readonly tenancyMode: 'single' | 'multi' = 'single',
  ) {
    this.stmts = {
      getRoom: db.prepare('SELECT * FROM rooms WHERE room_id = ? AND tenant_id IS ?'),
      getMembersByRoom: db.prepare(
        'SELECT * FROM room_members WHERE room_id = ? AND tenant_id IS ? ORDER BY joined_at',
      ),
      getMember: db.prepare('SELECT * FROM room_members WHERE member_id = ? AND tenant_id IS ?'),
      getMemberCount: db.prepare(
        'SELECT COUNT(*) as count FROM room_members WHERE room_id = ? AND tenant_id IS ?',
      ),
      getRoomsForUser: db.prepare(
        `SELECT r.* FROM rooms r
         INNER JOIN room_members m ON r.room_id = m.room_id
         WHERE m.user_id = ? AND r.tenant_id IS ? AND m.tenant_id IS r.tenant_id
         ORDER BY r.created_at DESC`
      ),
      getMemberByRoomUser: db.prepare(
        'SELECT * FROM room_members WHERE room_id = ? AND user_id = ? AND tenant_id IS ?'
      ),
    };
  }

  /** Create a room. The creator is automatically added as 'owner'. */
  create(
    createdBy: string,
    params: CreateRoomParams,
    scope?: ServiceDataScope,
    commitFence?: RoomCommitFence,
  ): RoomRecord {
    const boundary = this.requireScope(scope);
    if (params.maxMembers !== undefined
      && (!Number.isSafeInteger(params.maxMembers) || params.maxMembers < 1)) {
      throw new RoomInputError('Room capacity must be a positive safe integer');
    }
    const roomId = `room_${crypto.randomUUID()}`;
    const now = Date.now();

    const room: RoomRecord = {
      room_id: roomId,
      tenant_id: serviceDataTenantId(boundary),
      name: params.name,
      type: params.type ?? 'default',
      created_by: createdBy,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      max_members: params.maxMembers ?? 100,
      created_at: now,
    };

    this.db.transaction(() => {
      commitFence?.();
      this.db.insert('rooms', room as unknown as Row);

      // Auto-join creator as owner
      const member: RoomMemberRecord = {
        member_id: `mem_${crypto.randomUUID()}`,
        tenant_id: serviceDataTenantId(boundary),
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
  join(
    roomId: string,
    userId: string,
    role: RoomRole = 'member',
    scope?: ServiceDataScope,
  ): RoomMemberRecord {
    const boundary = this.requireScope(scope);
    const tenantId = serviceDataTenantId(boundary);
    const room = this.stmts.getRoom.get(roomId, tenantId) as RoomRow | null;
    if (!room) throw new Error(`Room not found: ${roomId}`);

    // Check if already a member
    const existing = this.stmts.getMemberByRoomUser.get(
      roomId,
      userId,
      tenantId,
    ) as MemberRow | null;
    if (existing) return existing as unknown as RoomMemberRecord;

    // Check max members
    const { count } = this.stmts.getMemberCount.get(roomId, tenantId) as CountRow;
    if (count >= room.max_members) throw new Error(`Room is full (max: ${room.max_members})`);

    const member: RoomMemberRecord = {
      member_id: `mem_${crypto.randomUUID()}`,
      tenant_id: tenantId,
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
  leave(
    roomId: string,
    userId: string,
    scope?: ServiceDataScope,
    commitFence?: RoomCommitFence,
  ): boolean {
    const boundary = this.requireScope(scope);
    const tenantId = serviceDataTenantId(boundary);
    return this.db.transaction(() => {
      const member = this.stmts.getMemberByRoomUser.get(
        roomId,
        userId,
        tenantId,
      ) as MemberRow | null;
      if (!member) return false;

      const room = this.stmts.getRoom.get(roomId, tenantId) as RoomRow | null;
      if (member.role === 'owner' || room?.created_by === userId) {
        throw new RoomOwnerCannotLeaveError();
      }

      commitFence?.();
      this.db.delete('room_members', member.member_id);
      return true;
    });
  }

  /** Get room by ID. */
  getRoom(roomId: string, scope?: ServiceDataScope): RoomRecord | null {
    const boundary = this.requireScope(scope);
    return this.stmts.getRoom.get(
      roomId,
      serviceDataTenantId(boundary),
    ) as RoomRecord | null;
  }

  /** Get all members of a room. */
  getMembers(roomId: string, scope?: ServiceDataScope): RoomMemberRecord[] {
    const boundary = this.requireScope(scope);
    return this.stmts.getMembersByRoom.all(
      roomId,
      serviceDataTenantId(boundary),
    ) as RoomMemberRecord[];
  }

  /** Get one user's membership in a room. */
  getMember(
    roomId: string,
    userId: string,
    scope?: ServiceDataScope,
  ): RoomMemberRecord | null {
    const boundary = this.requireScope(scope);
    return this.stmts.getMemberByRoomUser.get(
      roomId,
      userId,
      serviceDataTenantId(boundary),
    ) as RoomMemberRecord | null;
  }

  /** Get all rooms a user belongs to. */
  getRoomsForUser(userId: string, scope?: ServiceDataScope): RoomRecord[] {
    const boundary = this.requireScope(scope);
    return this.stmts.getRoomsForUser.all(
      userId,
      serviceDataTenantId(boundary),
    ) as RoomRecord[];
  }

  /** Check if a user is a member of a room. */
  isMember(roomId: string, userId: string, scope?: ServiceDataScope): boolean {
    return this.getMember(roomId, userId, scope) !== null;
  }

  /** Delete a room and all its members. */
  delete(
    roomId: string,
    scope?: ServiceDataScope,
    commitFence?: RoomCommitFence,
  ): boolean {
    const boundary = this.requireScope(scope);
    const tenantId = serviceDataTenantId(boundary);
    return this.db.transaction(() => {
      const room = this.stmts.getRoom.get(roomId, tenantId) as RoomRow | null;
      if (!room) return false;
      const members = this.stmts.getMembersByRoom.all(roomId, tenantId) as MemberRow[];
      commitFence?.();
      for (const m of members) {
        this.db.delete('room_members', m.member_id);
      }
      this.db.delete('rooms', roomId);
      return true;
    });
  }

  private requireScope(scope: ServiceDataScope | undefined): ServiceDataScope {
    if (scope) return scope;
    if (this.tenancyMode === 'multi') {
      throw new Error('A validated tenant data scope is required in multi-tenant mode');
    }
    return applicationServiceDataScope();
  }
}
