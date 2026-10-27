/** Indexed keyset reads. Membership/visibility apply before history, search, reactions and unread counts. */
import type { DatabaseReadQueryConnection, DatabaseReadQueryContext } from '../databases/database-realm';
import type { ConversationRecord, DurableMessage, MessagingContact } from './contracts';
import type { Row } from '../sync/types';
import { assertMessagingMember, captureMessagingActor, memberKey, projectMessage, staffTimeline, type ConversationRow, type MemberRow, type MessageRow, type MessagingActor } from './realm-model';
import { messagingFail, messagingHash, messagingId, messagingInteger, messagingRecord, messagingText } from './validation';

export function readMessagingMembership(database: DatabaseReadQueryConnection, actor: MessagingActor, id: string) {
  const conversation = database.query<ConversationRow>('SELECT * FROM messaging_conversations WHERE id=? AND scope_id=?').get(id, actor.scopeId);
  const member = database.query<MemberRow>('SELECT * FROM messaging_members WHERE id=? AND scope_id=?').get(memberKey(id, actor.id), actor.scopeId);
  assertMessagingMember(actor, conversation, member); return { conversation: conversation!, member: member! };
}
function reactions(database: DatabaseReadQueryConnection, actor: MessagingActor, row: MessageRow): DurableMessage['reactions'] {
  return row.deleted ? [] : database.query<{ emoji: string; count: number; selected: number }>('SELECT emoji,count(*) AS count,max(participant_id=?) AS selected FROM messaging_reactions WHERE message_id=? GROUP BY emoji ORDER BY emoji LIMIT 8').all(actor.id, row.id).map(row => ({ ...row, selected: row.selected === 1 }));
}
export function projectMessagingConversation(database: DatabaseReadQueryConnection, actor: MessagingActor, conversation: ConversationRow, member: MemberRow): ConversationRecord {
  const staff = staffTimeline(conversation, member), sequence = staff ? 'sequence' : 'public_sequence', visible = staff ? '' : " AND visibility='conversation'";
  const participants = database.query<MemberRow>('SELECT * FROM messaging_members WHERE conversation_id=? AND scope_id=? AND active=1 ORDER BY joined_at,participant_id LIMIT 100').all(conversation.id, actor.scopeId);
  const last = database.query<MessageRow>(`SELECT * FROM messaging_messages WHERE conversation_id=? AND ${sequence}>=?${visible} ORDER BY ${sequence} DESC LIMIT 1`).get(conversation.id, member.history_from);
  const unread = database.query<{ count: number }>(`SELECT count(*) AS count FROM messaging_messages WHERE conversation_id=? AND ${sequence}>? AND ${sequence}>=? AND author_id!=? AND deleted=0${visible}`).get(conversation.id, member.read_sequence, member.history_from, actor.id)!.count;
  const original = last ? projectMessage(last, staff) : null;
  // A summary is an explicitly bounded preview; full text comes only from paged history.
  const summary = original ? { ...original, text: original.text.length > 240 ? original.text.slice(0, 240) + '…' : original.text, truncated: original.text.length > 240 } : null;
  return { id: conversation.id, kind: conversation.kind, title: conversation.title, revision: conversation.revision, createdAt: conversation.created_at,
    updatedAt: staff ? conversation.updated_at : conversation.public_updated_at, archived: conversation.archived === 1,
    owner: conversation.owner, ownerId: conversation.owner_id, ownerEpoch: conversation.owner_epoch,
    participants: participants.map(row => ({ id: row.participant_id, kind: row.kind, role: row.role, joinedAt: row.joined_at })), lastMessage: summary, unreadCount: unread };
}
export function readMessagingConversation({ database }: DatabaseReadQueryContext, input: unknown): unknown {
  const r = messagingRecord(input, ['actor', 'id']), actor = captureMessagingActor(r.actor), { conversation, member } = readMessagingMembership(database, actor, messagingId(r.id));
  return projectMessagingConversation(database, actor, conversation, member);
}
/** A point lookup is still bounded by current membership, the history boundary and private-note visibility. */
export function readMessagingMessage({ database }: DatabaseReadQueryContext, input: unknown): DurableMessage {
  const r = messagingRecord(input, ['actor', 'conversationId', 'id']), actor = captureMessagingActor(r.actor);
  const { conversation, member } = readMessagingMembership(database, actor, messagingId(r.conversationId)), staff = staffTimeline(conversation, member);
  const row = database.query<MessageRow>('SELECT * FROM messaging_messages WHERE id=? AND scope_id=? AND conversation_id=?').get(messagingId(r.id), actor.scopeId, conversation.id);
  if (!row || row.visibility === 'staff' && !staff || (staff ? row.sequence : row.public_sequence!) < member.history_from) messagingFail('MESSAGING_NOT_FOUND', 404);
  return projectMessage(row, staff, reactions(database, actor, row));
}
/** Small canonical admission query for typing; does not materialize transcript, unread counts or contact details. */
export function readMessagingTypingMembership({ database }: DatabaseReadQueryContext, input: unknown): unknown {
  const r = messagingRecord(input, ['actor', 'id']), actor = captureMessagingActor(r.actor), { conversation, member } = readMessagingMembership(database, actor, messagingId(r.id));
  return { active: conversation.archived === 0, staff: staffTimeline(conversation, member) };
}
export function listMessagingConversations({ database }: DatabaseReadQueryContext, input: unknown): unknown {
  const r = messagingRecord(input, ['actor', 'query']), actor = captureMessagingActor(r.actor), q = messagingRecord(r.query ?? {}, ['after', 'limit', 'archived']);
  const limit = messagingInteger(q.limit ?? 20, 1, 25);
  if (q.archived !== undefined && typeof q.archived !== 'boolean') messagingFail('MESSAGING_INPUT_INVALID', 422);
  const time = "CASE WHEN m.role='staff' THEN c.updated_at ELSE c.public_updated_at END";
  const where = ['m.scope_id=?', 'm.participant_id=?', 'm.active=1', 'c.scope_id=m.scope_id', 'c.archived=?'];
  const values: (string | number)[] = [actor.scopeId, actor.id, q.archived ? 1 : 0];
  if (!actor.staff) where.push("m.role!='staff'");
  if (q.after !== undefined) {
    const cursor = messagingText(q.after, 512);
    let parsed: unknown; try { parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString()); } catch { messagingFail('MESSAGING_INPUT_INVALID', 422); }
    if (!Array.isArray(parsed) || parsed.length !== 2) messagingFail('MESSAGING_INPUT_INVALID', 422);
    const stamp = messagingInteger(parsed[0], 0), id = messagingId(parsed[1]);
    where.push(`(${time}<? OR (${time}=? AND c.id>?))`); values.push(stamp, stamp, id);
  }
  const rows = database.query<ConversationRow>(`SELECT c.* FROM messaging_conversations c JOIN messaging_members m ON m.conversation_id=c.id WHERE ${where.join(' AND ')} ORDER BY ${time} DESC,c.id LIMIT ?`).all(...values, limit + 1);
  const items: ConversationRecord[] = []; let bytes = 0;
  for (const row of rows.slice(0, limit)) {
    const member = database.query<MemberRow>('SELECT * FROM messaging_members WHERE id=?').get(memberKey(row.id, actor.id))!;
    assertMessagingMember(actor, row, member);
    const projected = projectMessagingConversation(database, actor, row, member), size = new TextEncoder().encode(JSON.stringify(projected)).byteLength;
    if (bytes + size > 384 * 1024) break; bytes += size; items.push(projected);
  }
  const last = items.at(-1), hasMore = rows.length > items.length;
  return { items, hasMore, nextCursor: hasMore && last ? Buffer.from(JSON.stringify([last.updatedAt, last.id])).toString('base64url') : null };
}
/** Escape FTS syntax into bounded literal token prefixes; this is not an arbitrary SQL/search-language endpoint. */
export function messagingSearch(value: unknown): string {
  return [...messagingText(value, 200, true).matchAll(/[\p{L}\p{N}_]+/gu)].slice(0, 16).map(match => '"' + match[0] + '"*').join(' AND ');
}
export function listMessagingMessages({ database }: DatabaseReadQueryContext, input: unknown): unknown {
  const r = messagingRecord(input, ['actor', 'conversationId', 'query']), actor = captureMessagingActor(r.actor), { conversation, member } = readMessagingMembership(database, actor, messagingId(r.conversationId));
  const q = messagingRecord(r.query ?? {}, ['before', 'after', 'limit', 'search']), limit = messagingInteger(q.limit ?? 25, 1, 50), staff = staffTimeline(conversation, member), sequence = staff ? 'sequence' : 'public_sequence';
  if (q.before !== undefined && q.after !== undefined) messagingFail('MESSAGING_INPUT_INVALID', 422);
  const where = ['m.conversation_id=?', 'm.scope_id=?', `m.${sequence}>=?`], values: (string | number)[] = [conversation.id, actor.scopeId, member.history_from];
  if (!staff) where.push("m.visibility='conversation'");
  if (q.before !== undefined) { where.push(`m.${sequence}<?`); values.push(messagingInteger(q.before)); }
  if (q.after !== undefined) { where.push(`m.${sequence}>?`); values.push(messagingInteger(q.after, 0)); }
  let join = '';
  if (q.search !== undefined) {
    const expression = messagingSearch(q.search);
    if (!expression) return { items: [], hasMore: false, nextCursor: null };
    const index = staff ? 'messaging_staff_search' : 'messaging_public_search'; join = ` JOIN ${index} ON ${index}.rowid=m.rowid`; where.push(`${index} MATCH ?`); values.push(expression);
  }
  const rows = database.query<MessageRow>(`SELECT m.* FROM messaging_messages m${join} WHERE ${where.join(' AND ')} ORDER BY m.${sequence} ${q.after === undefined ? 'DESC' : 'ASC'} LIMIT ?`).all(...values, limit + 1);
  const items: DurableMessage[] = []; let bytes = 0;
  for (const row of rows.slice(0, limit)) {
    const item = projectMessage(row, staff, reactions(database, actor, row)), size = new TextEncoder().encode(JSON.stringify(item)).byteLength;
    if (bytes + size > 384 * 1024) break; bytes += size; items.push(item);
  }
  const hasMore = rows.length > items.length;
  return { items, hasMore, nextCursor: hasMore && items.length ? String(items.at(-1)!.sequence) : null };
}
export function listMessagingContacts({ database }: DatabaseReadQueryContext, input: unknown): unknown {
  const r = messagingRecord(input, ['actor', 'query']), actor = captureMessagingActor(r.actor), q = messagingRecord(r.query ?? {}, ['after', 'limit']);
  if (actor.kind !== 'user') messagingFail('MESSAGING_FORBIDDEN', 403);
  const limit = messagingInteger(q.limit ?? 25, 1, 50), after = q.after === undefined ? '' : messagingId(q.after);
  const rows = database.query<Row>(`SELECT * FROM (
    SELECT c.id,CASE WHEN c.requester_id=? THEN c.recipient_id ELSE c.requester_id END AS user_id,
      CASE WHEN c.requester_id=? THEN 'outgoing' ELSE 'incoming' END AS direction,
      CASE WHEN b.id IS NOT NULL THEN 'blocked' ELSE c.state END AS state,c.revision,c.updated_at
    FROM messaging_contacts c LEFT JOIN messaging_blocks b ON b.scope_id=c.scope_id AND b.participant_id=? AND b.target_id=CASE WHEN c.requester_id=? THEN c.recipient_id ELSE c.requester_id END
    WHERE c.scope_id=? AND (c.requester_id=? OR c.recipient_id=?)
    UNION ALL
    SELECT b.id,b.target_id AS user_id,'outgoing' AS direction,'blocked' AS state,0 AS revision,b.created_at AS updated_at
    FROM messaging_blocks b WHERE b.scope_id=? AND b.participant_id=? AND NOT EXISTS(SELECT 1 FROM messaging_contacts c WHERE c.scope_id=b.scope_id AND ((c.requester_id=b.participant_id AND c.recipient_id=b.target_id) OR (c.requester_id=b.target_id AND c.recipient_id=b.participant_id)))
  ) WHERE user_id>? ORDER BY user_id LIMIT ?`).all(actor.id, actor.id, actor.id, actor.id, actor.scopeId, actor.id, actor.id, actor.scopeId, actor.id, after, limit + 1);
  const items: MessagingContact[] = rows.slice(0, limit).map(row => ({ id: String(row.id), userId: String(row.user_id), direction: row.direction as MessagingContact['direction'],
    state: row.state as MessagingContact['state'], revision: Number(row.revision), updatedAt: Number(row.updated_at) }));
  return { items, hasMore: rows.length > limit, nextCursor: rows.length > limit ? items.at(-1)!.userId : null };
}
/** Deliberate triage discovery is narrower than reading every private conversation or its transcript. */
export function listMessagingSupportQueue({ database }: DatabaseReadQueryContext, input: unknown): unknown {
  const r = messagingRecord(input, ['actor', 'query']), actor = captureMessagingActor(r.actor), q = messagingRecord(r.query ?? {}, ['after', 'limit']);
  if (!actor.staff || actor.kind !== 'user') messagingFail('MESSAGING_FORBIDDEN', 403);
  const limit = messagingInteger(q.limit ?? 25, 1, 50), after = q.after === undefined ? '' : messagingId(q.after);
  const rows = database.query<ConversationRow>("SELECT id,owner,owner_epoch,created_at FROM messaging_conversations WHERE scope_id=? AND kind='support' AND archived=0 AND id>? ORDER BY id LIMIT ?").all(actor.scopeId, after, limit + 1);
  const items = rows.slice(0, limit).map(row => ({ id: row.id, owner: row.owner, ownerEpoch: row.owner_epoch, createdAt: row.created_at }));
  return { items, hasMore: rows.length > limit, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
}
/** Current identity/scope may read its own content-free acknowledgment, never the retained result payload. */
export function readMessagingReceipt({ database }: DatabaseReadQueryContext, input: unknown): unknown {
  const r = messagingRecord(input, ['actor', 'requestId']), actor = captureMessagingActor(r.actor), requestId = messagingId(r.requestId);
  const row = database.query<{ receipt_json: string }>('SELECT receipt_json FROM messaging_intents WHERE id=? AND scope_id=? AND participant_id=?').get(messagingHash([actor.scopeId, actor.kind, actor.id, requestId]), actor.scopeId, actor.id);
  return row ? JSON.parse(row.receipt_json) : null;
}
