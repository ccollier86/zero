/** Notification, rooms, presence and ephemeral hooks. Curated client-safe re-exports only; implementation/context ownership stays with the existing modules. */

// ─── Notifications: Hooks ────────────────────────────────────────────────
export {
  useNotifications,
  useUnreadCount,
  useOnNewNotification,
} from '../../client/hooks';
export type {
  Notification,
  NotificationReceipt,
  NotificationWithStatus,
  UseNotificationsResult,
} from '../../client/hooks';

// ─── Rooms: Hooks ───────────────────────────────────────────────────────
export {
  useRoom,
  useRoomMembers,
  useRooms,
  useRoomActions,
  useRoomData,
  usePresence,
  usePresenceList,
  useTypingIndicator,
} from '../../client/hooks';
export type {
  UseRoomResult,
  RoomActions,
  PresenceMember,
  PresenceListMember,
  TypingIndicatorMember,
  UsePresenceResult,
  UsePresenceListOptions,
  UsePresenceListReturn,
  UseTypingIndicatorOptions,
  UseTypingIndicatorReturn,
} from '../../client/hooks';

// ─── Rooms: Config (types only — no bun:sqlite) ────────────────────────
export type {
  RoomRecord,
  RoomMemberRecord,
  RoomRole,
  CreateRoomParams,
} from '../../../rooms/types';

// ─── Ephemeral KV: Hooks ───────────────────────────────────────────────
export {
  useEphemeral,
  useEphemeralErrors,
  useEphemeralTopic,
} from '../../client/hooks';

// ─── Ephemeral KV: Client ──────────────────────────────────────────────
export { EphemeralClient } from '../../../sync/client/ephemeral-client';
export type {
  EphemeralChangeEvent,
  EphemeralErrorListener,
} from '../../../sync/client/ephemeral-client';
export type { EphemeralErrorMessage } from '../../../sync/ephemeral-policy';
export type { EphemeralEntryClient } from '../../../sync/client/ephemeral-store';
