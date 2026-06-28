import type { EphemeralStateManager } from '../sync/ephemeral-manager';
import type { JsonValue } from '../sync/types';

// ─── Types ─────────────────────────────────────────────────────────────────

export type PresenceStatus = 'online' | 'idle' | 'away';

export interface PresenceData {
  status: PresenceStatus;
  lastSeen: number;
  custom?: Record<string, unknown>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default presence TTL: 30 seconds. Clients heartbeat every 10s. */
const PRESENCE_TTL = 30_000;

/** Presence topic prefix. Full topic: `presence:{roomId}` */
const PRESENCE_PREFIX = 'presence:';

/** Presence key prefix. Full key: `user:{userId}` */
const USER_PREFIX = 'user:';

// ─── PresenceService ────────────────────────────────────────────────────────

/**
 * Room-scoped presence built on top of EphemeralStateManager.
 *
 * Convention:
 * - Topic: `presence:{roomId}`
 * - Key: `user:{userId}`
 * - Value: `{ status, lastSeen, custom? }`
 *
 * Auto-expires via TTL (30s). Clients heartbeat every 10s.
 * On WS disconnect, the ephemeral manager's cleanup removes subscriptions,
 * and the TTL sweep handles stale presence entries.
 */
export class PresenceService {
  constructor(private ephemeral: EphemeralStateManager) {}

  /** Set/update presence for a user in a room. */
  setPresence(
    roomId: string,
    userId: string,
    status: PresenceStatus = 'online',
    custom?: Record<string, unknown>
  ): void {
    const topic = PRESENCE_PREFIX + roomId;
    const key = USER_PREFIX + userId;
    const data: PresenceData = {
      status,
      lastSeen: Date.now(),
      custom,
    };
    this.ephemeral.set(topic, key, data as unknown as JsonValue, userId, PRESENCE_TTL);
  }

  /** Remove a user's presence from a room. */
  removePresence(roomId: string, userId: string): void {
    const topic = PRESENCE_PREFIX + roomId;
    const key = USER_PREFIX + userId;
    this.ephemeral.delete(topic, key);
  }

  /** Remove a user's presence from ALL rooms (on disconnect). */
  removeAllPresence(userId: string): void {
    const topics = this.ephemeral.getTopicsByPrefix(PRESENCE_PREFIX);
    for (const topic of topics) {
      this.ephemeral.deleteByUser(topic, userId);
    }
  }

  /** Get all online members in a room. */
  getPresence(roomId: string): Array<{ userId: string; data: PresenceData }> {
    const topic = PRESENCE_PREFIX + roomId;
    const entries = this.ephemeral.getSnapshot(topic);
    const members: Array<{ userId: string; data: PresenceData }> = [];

    for (const [key, entry] of Object.entries(entries)) {
      if (key.startsWith(USER_PREFIX)) {
        const userId = key.slice(USER_PREFIX.length);
        members.push({ userId, data: entry.value as unknown as PresenceData });
      }
    }

    return members;
  }

  /** Get presence topic name for a room. */
  static topicFor(roomId: string): string {
    return PRESENCE_PREFIX + roomId;
  }

  /** Get presence key for a user. */
  static keyFor(userId: string): string {
    return USER_PREFIX + userId;
  }

}
