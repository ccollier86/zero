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
  now: number; idleMs: number; actorId?: string; includeSelf?: boolean; monotonicNow?: number;
  /** Custom app policies may own user-prefixed keys with a different display ID. */
  customKeys?: boolean;
}): TypingIndicatorMember[] {
  const members = new Map<string, TypingIndicatorMember>();
  for (const [key, entry] of Object.entries(entries)) {
    const userId = entry?.userId;
    if (typeof userId !== 'string' || !userId || (options.customKeys ? !key.startsWith('user:') : key !== `user:${userId}` && !key.startsWith(`user:${userId}:session:`))) continue;
    const value = entry.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    let updatedAt: number;
    if (entry.freshness !== undefined) {
      const freshness = entry.freshness, observedAt = entry.observedAt;
      if (!freshness || !Number.isFinite(freshness.ageMs) || freshness.ageMs < 0
        || !Number.isFinite(freshness.ttlMs) || freshness.ttlMs <= 0
        || observedAt === undefined || !Number.isFinite(observedAt)) continue;
      const elapsed = (options.monotonicNow ?? performance.now()) - observedAt + freshness.ageMs;
      if (elapsed < 0 || elapsed >= Math.min(options.idleMs, freshness.ttlMs)) continue;
      updatedAt = options.now - elapsed;
    } else {
      if (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)
        || value.updatedAt < options.now - options.idleMs || value.updatedAt > options.now + 2000) continue;
      updatedAt = value.updatedAt;
    }
    if (!options.includeSelf && (userId === options.actorId || options.customKeys && value.userId === options.actorId)) continue;
    const duration = typeof value.since === 'number' && Number.isFinite(value.since)
      && typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
      ? Math.max(0, value.updatedAt - value.since) : 0;
    const member: TypingIndicatorMember = {
      userId, label: typeof value.label === 'string' && value.label.trim() ? value.label.slice(0, 160) : userId,
      since: updatedAt - Math.min(duration, 86_400_000),
      updatedAt,
      ...(value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata) ? { metadata: value.metadata } : {}),
    };
    const previous = members.get(userId);
    if (!previous || previous.updatedAt < updatedAt) members.set(userId, member);
  }
  return [...members.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.userId.localeCompare(b.userId));
}
