/** Bounded actor-local ownership and replay helpers; no network calls or parent-process credentials. */
import type { Row } from '../sync/types';
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import type { ConversationKind, ConversationOwner, ConversationRole, DurableMessage } from './contracts';
import { messagingArray, messagingChoice, messagingFail, messagingHash, messagingId, messagingInteger, messagingRecord, messagingText } from './validation';
export interface MessagingActor { scopeId: string; id: string; kind: 'user' | 'external' | 'assistant'; staff: boolean }
export type ConversationRow = Row & { id: string; scope_id: string; kind: ConversationKind; title: string; revision: number; created_at: number; updated_at: number; public_updated_at: number; archived: number;
  created_by: string; owner: ConversationOwner; owner_id: string | null; owner_epoch: number; internal_sequence: number; public_sequence: number; channel_id: string | null; members_json: string };
export type MemberRow = Row & { id: string; scope_id: string; conversation_id: string; participant_id: string; kind: 'user' | 'external'; role: ConversationRole; active: number; joined_at: number; history_from: number; read_sequence: number };
export type MessageRow = Row & { id: string; scope_id: string; conversation_id: string; sequence: number; public_sequence: number | null; revision: number; author_id: string; author_kind: MessagingActor['kind']; visibility: 'conversation' | 'staff'; text: string; created_at: number; edited_at: number | null; deleted: number; attachment_ids: string };

/** Minted by the service, not forwarded from an HTTP body. Actor validation repeats inside the worker. */
export function captureMessagingActor(input: unknown): MessagingActor {
  const r = messagingRecord(input, ['scopeId', 'id', 'kind', 'staff']);
  const scopeId = messagingText(r.scopeId, 256);
  if (!/^(?:application|tenant:[A-Za-z0-9][A-Za-z0-9_.:-]{0,199})$/.test(scopeId) || typeof r.staff !== 'boolean') messagingFail('MESSAGING_FORBIDDEN', 403);
  return { scopeId, id: messagingId(r.id), kind: messagingChoice(r.kind, ['user', 'external', 'assistant']), staff: r.staff };
}
export function memberKey(conversationId: string, participantId: string): string { return messagingHash([conversationId, participantId]); }
export function contactKey(scopeId: string, first: string, second: string): string { return messagingHash([scopeId, ...[first, second].sort()]); }
export function blockKey(scopeId: string, first: string, second: string): string { return messagingHash([scopeId, first, second]); }
export function conversationMember(context: DatabaseWriteCommandContext, actor: MessagingActor, id: unknown): { conversation: ConversationRow; member: MemberRow } {
  const conversation = context.db.get('messaging_conversations', messagingId(id)) as ConversationRow | null;
  const member = conversation && context.db.get('messaging_members', memberKey(conversation.id, actor.id)) as MemberRow | null;
  assertMessagingMember(actor, conversation, member);
  return { conversation: conversation!, member: member! };
}
/** The same closed admission is used by read and write handlers; global staff is not conversation membership. */
export function assertMessagingMember(actor: MessagingActor, conversation: ConversationRow | null, member: MemberRow | null): void {
  if (!conversation || conversation.scope_id !== actor.scopeId || !member || member.scope_id !== actor.scopeId || member.active !== 1 || member.participant_id !== actor.id || member.kind !== actor.kind || member.role === 'staff' && (!actor.staff || conversation.kind !== 'support')) messagingFail('MESSAGING_NOT_FOUND', 404);
}
export function staffTimeline(conversation: ConversationRow, member: MemberRow): boolean { return conversation.kind === 'support' && member.role === 'staff'; }
export function assertRevision(row: { revision: number }, expected: unknown): void {
  if (row.revision !== messagingInteger(expected)) messagingFail('MESSAGING_REVISION_CONFLICT');
  if (row.revision >= Number.MAX_SAFE_INTEGER - 2) messagingFail('MESSAGING_CAPACITY', 429);
}
/** A bounded canonical directory avoids whole-table scans inside tracked writer commands. */
export function conversationMembers(row: ConversationRow): string[] { return messagingArray(JSON.parse(row.members_json), 100).map(messagingId); }
export function projectMessage(row: MessageRow, staff: boolean, reactions: DurableMessage['reactions'] = []): DurableMessage {
  if (!staff && row.visibility === 'staff') messagingFail('MESSAGING_NOT_FOUND', 404);
  return { id: row.id, conversationId: row.conversation_id, sequence: staff ? row.sequence : row.public_sequence!, revision: row.revision,
    authorId: row.author_id, authorKind: row.author_kind, visibility: row.visibility, text: row.deleted ? '' : row.text, createdAt: row.created_at,
    editedAt: row.edited_at, deleted: row.deleted === 1, attachmentIds: row.deleted ? [] : JSON.parse(row.attachment_ids), reactions };
}
/** Durable intent receipts outlive Fabric's transport receipt retention; current admission must run before this helper. */
export function messagingIntent<T>(context: DatabaseWriteCommandContext, actor: MessagingActor, requestId: unknown, intent: unknown, run: () => T): T {
  const id = messagingHash([actor.scopeId, actor.kind, actor.id, messagingId(requestId)]), digest = messagingHash(intent);
  const prior = context.db.get('messaging_intents', id);
  if (prior) { if (prior.digest !== digest) messagingFail('MESSAGING_INTENT_CONFLICT'); return JSON.parse(String(prior.result_json)) as T; }
  const result = run(), now = Date.now(), value = result as Record<string, unknown> | null;
  const receipt = { requestId: messagingId(requestId), operation: Array.isArray(intent) && typeof intent[0] === 'string' ? intent[0] : 'messaging.command',
    resourceId: value && typeof value.id === 'string' ? value.id : null, acceptedAt: now };
  context.db.createStrict('messaging_intents', { id, scope_id: actor.scopeId, participant_id: actor.id, digest, result_json: JSON.stringify(result), receipt_json: JSON.stringify(receipt), created_at: now });
  return result;
}
/** Contact blocking is symmetric; only accepted requests allow a contacts-only new conversation. */
export function assertMessagingContact(context: DatabaseWriteCommandContext, actor: MessagingActor, userId: string, required: boolean): void {
  const relation = context.db.get('messaging_contacts', contactKey(actor.scopeId, actor.id, userId));
  if (context.db.get('messaging_blocks', blockKey(actor.scopeId, actor.id, userId)) || context.db.get('messaging_blocks', blockKey(actor.scopeId, userId, actor.id))) messagingFail('MESSAGING_BLOCKED');
  if (required && relation?.state !== 'accepted') messagingFail('MESSAGING_CONTACT_REQUIRED');
}
