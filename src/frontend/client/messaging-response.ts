/** Bounded JSON response assertions shared by normal requests and SSE. This is display validation, never authorization. */
import type { ConversationRecord, DurableMessage, MessagingPage } from '../../messaging/contracts';
import type { MessagingCapabilities, MessagingContact, MessagingDirectoryEntry, MessagingReceipt, MessagingAssistant } from '../../messaging/contracts';
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
  if (!['direct', 'group', 'support', 'assistant'].includes(r.kind) || !['human', 'assistant', 'triage'].includes(r.owner) || typeof r.archived !== 'boolean' || !Array.isArray(r.participants) || r.participants.length > 100) bad();
  if (r.assistantId !== undefined && r.assistantId !== null) text(r.assistantId, 64);
  if (r.managedGroupId !== undefined && r.managedGroupId !== null) text(r.managedGroupId, 64);
  if (r.ownerId !== null) text(r.ownerId);
  r.participants.forEach((item: unknown) => { const member = record(item); text(member.id); integer(member.joinedAt); if (!['user', 'external', 'assistant'].includes(member.kind) || !['owner', 'member', 'staff', 'customer'].includes(member.role)) bad(); });
  if (r.lastMessage !== null) { const preview = r.lastMessage as Record<string, unknown>; assertMessagingMessage(preview); if (typeof (preview as DurableMessage & { truncated?: unknown }).truncated !== 'boolean') bad(); }
}
export function assertMessagingPage<T>(value: unknown, item: (value: unknown) => void, maximum: number): asserts value is MessagingPage<T> {
  const r = record(value); if (!Array.isArray(r.items) || r.items.length > maximum || typeof r.hasMore !== 'boolean' || r.nextCursor !== null && typeof r.nextCursor !== 'string' || r.hasMore && !r.nextCursor || !r.hasMore && r.nextCursor !== null) bad();
  r.items.forEach(item);
}
export function assertMessagingCapabilities(value: unknown): asserts value is MessagingCapabilities {
  const r = record(value);
  if (typeof r.enabled !== 'boolean' || !['everyone', 'contacts'].includes(r.directory) || typeof r.canSupport !== 'boolean') bad();
  for (const key of ['assistant', 'notifications']) if (r[key] !== undefined && typeof r[key] !== 'boolean') bad();
  for (const [key, maximum] of [['maxMessageLength', 20000], ['maxParticipants', 100], ['maxUploadBytes', 256 * 1024 * 1024]] as const) { integer(r[key]); if (r[key] < 1 || r[key] > maximum) bad(); }
}
export function assertMessagingDirectoryEntry(value: unknown): asserts value is MessagingDirectoryEntry {
  const r = record(value); text(r.id); text(r.name, 241);
  if (r.avatarUrl !== null) { text(r.avatarUrl, 2000); if (!/^(?:\/(?!\/)|https?:\/\/)/.test(r.avatarUrl)) bad(); }
}
export function assertMessagingAssistant(value: unknown): asserts value is MessagingAssistant {
  const r = record(value); text(r.id, 64); text(r.name, 120); text(r.description, 500);
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(r.id)) bad();
}
export function assertMessagingContact(value: unknown): asserts value is MessagingContact {
  const r = record(value); text(r.id); text(r.userId); integer(r.revision); integer(r.updatedAt);
  if (!['incoming', 'outgoing'].includes(r.direction) || !['pending', 'accepted', 'declined', 'blocked'].includes(r.state)) bad();
}
export function assertMessagingReceipt(value: unknown): asserts value is MessagingReceipt | null {
  if (value === null) return; const r = record(value);
  if (Object.keys(r).some(key => !['requestId', 'operation', 'resourceId', 'acceptedAt'].includes(key))) bad();
  text(r.requestId); text(r.operation, 100); integer(r.acceptedAt); if (r.resourceId !== null) text(r.resourceId);
}
export function assertMessagingReadPosition(value: unknown): void { const r = record(value); integer(r.throughSequence); integer(r.unreadCount); }
export function assertMessagingRemoved(value: unknown): void { if (record(value).removed !== true) bad(); }
export function assertMessagingUnblocked(value: unknown): void { if (record(value).unblocked !== true) bad(); }
export function assertMessagingSupportQueueItem(value: unknown): void {
  const r = record(value); text(r.id); integer(r.ownerEpoch); integer(r.createdAt); if (!['human', 'assistant', 'triage'].includes(r.owner)) bad();
}
