/** Bounded JSON response assertions shared by normal requests and SSE. This is display validation, never authorization. */
import type { ConversationRecord, DurableMessage, MessagingPage } from '../../messaging/contracts';
const bad = () => { throw new Error('Invalid messaging response.'); };
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : bad();
const text = (value: unknown, maximum = 200) => { if (typeof value !== 'string' || value.length > maximum) bad(); };
const integer = (value: unknown) => { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) bad(); };
export function assertMessagingMessage(value: unknown): asserts value is DurableMessage {
  const r = record(value); for (const key of ['id', 'conversationId', 'authorId']) text(r[key]);
  text(r.text, 20000); for (const key of ['sequence', 'revision', 'createdAt']) integer(r[key]);
  if (r.editedAt !== null) integer(r.editedAt);
  if (!['user', 'external', 'assistant'].includes(r.authorKind) || !['conversation', 'staff'].includes(r.visibility) || typeof r.deleted !== 'boolean' || !Array.isArray(r.attachmentIds) || r.attachmentIds.length > 10 || !Array.isArray(r.reactions) || r.reactions.length > 8) bad();
  r.attachmentIds.forEach((id: unknown) => text(id)); r.reactions.forEach((item: unknown) => { const reaction = record(item); text(reaction.emoji, 32); integer(reaction.count); if (typeof reaction.selected !== 'boolean') bad(); });
}
export function assertMessagingConversation(value: unknown): asserts value is ConversationRecord {
  const r = record(value); text(r.id); text(r.title, 200); for (const key of ['revision', 'createdAt', 'updatedAt', 'ownerEpoch', 'unreadCount']) integer(r[key]);
  if (!['direct', 'group', 'support'].includes(r.kind) || !['human', 'assistant', 'triage'].includes(r.owner) || typeof r.archived !== 'boolean' || !Array.isArray(r.participants) || r.participants.length > 100) bad();
  if (r.ownerId !== null) text(r.ownerId);
  r.participants.forEach((item: unknown) => { const member = record(item); text(member.id); integer(member.joinedAt); if (!['user', 'external'].includes(member.kind) || !['owner', 'member', 'staff', 'customer'].includes(member.role)) bad(); });
  if (r.lastMessage !== null) { const preview = r.lastMessage as Record<string, unknown>; assertMessagingMessage(preview); if (typeof (preview as DurableMessage & { truncated?: unknown }).truncated !== 'boolean') bad(); }
}
export function assertMessagingPage<T>(value: unknown, item: (value: unknown) => void, maximum: number): asserts value is MessagingPage<T> {
  const r = record(value); if (!Array.isArray(r.items) || r.items.length > maximum || typeof r.hasMore !== 'boolean' || r.nextCursor !== null && typeof r.nextCursor !== 'string' || r.hasMore && !r.nextCursor || !r.hasMore && r.nextCursor !== null) bad();
  r.items.forEach(item);
}
