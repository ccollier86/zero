/** Private attachment admission repeats canonical membership/history checks. Unattached stages are never another member's file library. */
import type { DatabaseReadQueryContext } from '../databases/database-realm';
import { captureMessagingActor, staffTimeline, type MessageRow } from './realm-model';
import { readMessagingMembership } from './realm-queries';
import { messagingFail, messagingId, messagingRecord, messagingText } from './validation';
import { projectMessagingAttachment, type AttachmentRow } from './attachment-model';
export function readMessagingAttachment({ database }: DatabaseReadQueryContext, input: unknown): unknown {
  const r = messagingRecord(input, ['actor', 'conversationId', 'id', 'upload']), actor = captureMessagingActor(r.actor);
  const { conversation, member } = readMessagingMembership(database, actor, messagingId(r.conversationId));
  const row = database.query<AttachmentRow>('SELECT * FROM messaging_attachments WHERE id=? AND scope_id=? AND conversation_id=?').get(messagingId(r.id), actor.scopeId, conversation.id);
  const staff = staffTimeline(conversation, member);
  if (!row || row.visibility === 'staff' && !staff) messagingFail('MESSAGING_NOT_FOUND', 404);
  if (r.upload === true) {
    if (row.owner_id !== actor.id || row.owner_kind !== actor.kind || conversation.archived) messagingFail('MESSAGING_NOT_FOUND', 404);
    if (row.state !== 'ready' && (row.state !== 'allocated' || row.expires_at <= Date.now())) messagingFail('MESSAGING_ATTACHMENT_UNAVAILABLE', 422);
  } else if (row.message_id) {
    const message = database.query<MessageRow>('SELECT * FROM messaging_messages WHERE id=? AND scope_id=? AND conversation_id=?').get(row.message_id, actor.scopeId, conversation.id);
    if (!message || message.deleted || message.visibility !== row.visibility || (staff ? message.sequence : message.public_sequence!) < member.history_from) messagingFail('MESSAGING_NOT_FOUND', 404);
  } else if (row.owner_id !== actor.id || row.owner_kind !== actor.kind) messagingFail('MESSAGING_NOT_FOUND', 404);
  return projectMessagingAttachment(row);
}
/** Infrastructure-only bounded recovery query, not reachable through the browser facade. */
export function pendingMessagingAttachments({ database }: DatabaseReadQueryContext, input: unknown): unknown {
  const r = messagingRecord(input, ['scopeId']), scopeId = messagingText(r.scopeId, 263);
  const rows = database.query<AttachmentRow>("SELECT * FROM messaging_attachments WHERE scope_id=? AND message_id IS NULL AND (state='removing' OR (state IN ('allocated','ready') AND expires_at<=?)) ORDER BY expires_at,id LIMIT 25").all(scopeId, Date.now());
  const next = database.query<{ expiresAt: number }>("SELECT min(expires_at) AS expiresAt FROM messaging_attachments WHERE scope_id=? AND message_id IS NULL AND state IN ('allocated','ready') AND expires_at>?").get(scopeId, Date.now());
  return { items: rows, nextExpiry: next?.expiresAt ?? null };
}
