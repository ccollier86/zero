import type { ClientTableDef } from '../schema/define-schema';

// ─── Room Types ─────────────────────────────────────────────────────────────

export type RoomRole = 'owner' | 'admin' | 'member';

export interface RoomRecord {
  room_id: string;
  /** Null in single-tenant mode; required for records created in multi mode. */
  tenant_id: string | null;
  name: string;
  type: string;
  created_by: string;
  metadata: string | null;
  max_members: number;
  created_at: number;
}

export interface RoomMemberRecord {
  member_id: string;
  /** Duplicated from the parent room for direct Sync row filtering. */
  tenant_id: string | null;
  room_id: string;
  user_id: string;
  role: RoomRole;
  joined_at: number;
  metadata: string | null;
}

// ─── Params ─────────────────────────────────────────────────────────────────

export interface CreateRoomParams {
  name: string;
  type?: string;
  metadata?: Record<string, unknown>;
  maxMembers?: number;
}

// ─── Client Table Definitions ───────────────────────────────────────────────

/**
 * Spread into your client's `tables` config to enable room sync.
 *
 * @example
 * ```ts
 * createClient({
 *   url: 'http://localhost:3000',
 *   tables: { ...ROOM_TABLES, ...myTables },
 * });
 * ```
 */
export const ROOM_TABLES: Record<string, ClientTableDef> = {
  rooms: {
    _pk: 'room_id',
    room_id: 'text',
    tenant_id: 'text',
    name: 'text',
    type: 'text',
    created_by: 'text',
    metadata: 'text',
    max_members: 'integer',
    created_at: 'integer',
  },
  room_members: {
    _pk: 'member_id',
    member_id: 'text',
    tenant_id: 'text',
    room_id: 'text',
    user_id: 'text',
    role: 'text',
    joined_at: 'integer',
    metadata: 'text',
  },
};
