// ─── Server: Room Plugin ─────────────────────────────────────────────────
export { createRoomPlugin, getRoomService } from './room.plugin';
export type { RoomPluginConfig } from './room.plugin';

// ─── Server: Room Service ───────────────────────────────────────────────
export { RoomService } from './room-service';

// ─── Server: Presence Service ───────────────────────────────────────────
export { PresenceService } from './presence-service';
export type { PresenceStatus, PresenceData } from './presence-service';

// ─── Types ──────────────────────────────────────────────────────────────
export type { RoomRecord, RoomMemberRecord, CreateRoomParams, RoomRole } from './types';
export { ROOM_TABLES } from './types';
