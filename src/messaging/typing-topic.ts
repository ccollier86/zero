/** Browser-safe native typing names and display bounds. Parsing never grants membership or accepts a scope/actor claim. */
export type MessagingTypingVisibility = 'conversation' | 'staff';
const validId = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;

/** Explicit visibility precedes the opaque ID, so IDs ending in `:staff` cannot alias private-note activity. */
export function messagingTypingRoom(conversationId: string, visibility: MessagingTypingVisibility = 'conversation'): string {
  if (!validId.test(conversationId) || !['conversation', 'staff'].includes(visibility)) throw new Error('A real messaging conversation id and visibility are required.');
  return 'messaging:' + visibility + ':' + conversationId;
}
export function parseMessagingTypingTopic(topic: string): { conversationId: string; visibility: MessagingTypingVisibility } | null {
  const match = /^typing:messaging:(conversation|staff):([A-Za-z0-9][A-Za-z0-9_.:-]{0,199})$/.exec(topic);
  return match ? { visibility: match[1] as MessagingTypingVisibility, conversationId: match[2]! } : null;
}

/** Native typing never falls back to the private email field; truncation changes a label, never identity or authority. */
export function messagingTypingLabel(profile: { userId: string; username?: string; firstName?: string | null; lastName?: string | null } | null, explicit?: string): string {
  const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim();
  const value = explicit?.trim() || fullName || profile?.username || profile?.userId || 'Someone';
  return value.slice(0, 160).replace(/[\uD800-\uDBFF]$/, '');
}
