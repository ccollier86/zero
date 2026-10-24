/** Pure presentation model over server-attributed ephemeral entries. */
import type { EphemeralEntryClient } from '../../sync/client/ephemeral-store';
import type { JsonValue } from '../../sync/types';

export interface TypingIndicatorMember {
  userId: string;
  label: string;
  since: number;
  updatedAt: number;
  metadata?: Record<string, JsonValue>;
}

/** Payload userId is untrusted; identity always comes from the Sync envelope. */
export function typingIndicatorMembers(entries: Readonly<Record<string, EphemeralEntryClient>>, options: {
  now: number; idleMs: number; actorId?: string; includeSelf?: boolean;
}): TypingIndicatorMember[] {
  const members = new Map<string, TypingIndicatorMember>();
  for (const [key, entry] of Object.entries(entries)) {
    const userId = entry.userId;
    if (!userId || key !== `user:${userId}` && !key.startsWith(`user:${userId}:session:`)) continue;
    const value = entry.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const updatedAt = value.updatedAt, since = value.since;
    if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt < options.now - options.idleMs || updatedAt > options.now + 2000) continue;
    if (!options.includeSelf && userId === options.actorId) continue;
    const member: TypingIndicatorMember = {
      userId, label: typeof value.label === 'string' && value.label.trim() ? value.label.slice(0, 160) : userId,
      since: typeof since === 'number' && Number.isFinite(since) && since > 0 ? Math.min(since, updatedAt) : updatedAt,
      updatedAt,
      ...(value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata) ? { metadata: value.metadata } : {}),
    };
    const previous = members.get(userId);
    if (!previous || previous.updatedAt < updatedAt) members.set(userId, member);
  }
  return [...members.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.userId.localeCompare(b.userId));
}
