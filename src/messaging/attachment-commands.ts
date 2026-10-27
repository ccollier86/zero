/** Actor-owned stage transitions. Metadata and message association are atomic; no Storage/network I/O runs in these transactions. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import { messagingCommand } from './realm-errors';
import { captureMessagingActor, conversationMember, messagingIntent, staffTimeline } from './realm-model';
import { messagingFail, messagingId, messagingInteger, messagingRecord } from './validation';
import { captureMessagingAttachment } from './attachment-validation';
import { attachmentReservationKey, attachmentReservations, projectMessagingAttachment, releaseAttachmentReservation, type AttachmentRow } from './attachment-model';

export function allocateMessagingAttachment(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['actor', 'conversationId', 'id', 'requestId', 'input', 'maxUploadBytes']), actor = captureMessagingActor(r.actor);
    const { conversation, member } = conversationMember(context, actor, r.conversationId), id = messagingId(r.id);
    const admitted = captureMessagingAttachment(r.input, messagingInteger(r.maxUploadBytes, 1024, 256 * 1024 * 1024));
    if (actor.kind === 'assistant' || conversation.archived || admitted.visibility === 'staff' && !staffTimeline(conversation, member)) messagingFail('MESSAGING_ATTACHMENT_UNAVAILABLE', 422);
    return messagingIntent(context, actor, r.requestId, ['attachment.allocate', conversation.id, admitted], () => {
      const key = attachmentReservationKey(actor), ids = attachmentReservations(context, key);
      if (ids.length >= 10) messagingFail('MESSAGING_CAPACITY', 429);
      const now = Date.now(), row: AttachmentRow = { id, scope_id: actor.scopeId, conversation_id: conversation.id, owner_id: actor.id, owner_kind: actor.kind as 'user' | 'external',
        visibility: admitted.visibility, state: 'allocated', file_name: admitted.fileName, mime_type: admitted.mimeType, size_bytes: admitted.sizeBytes, checksum: admitted.checksum,
        created_at: now, expires_at: now + 30 * 60000, message_id: null };
      context.db.createStrict('messaging_attachments', row);
      const value = { ids_json: JSON.stringify([...ids, id]) };
      if (ids.length) context.db.update('messaging_attachment_reservations', key, value); else context.db.createStrict('messaging_attachment_reservations', { id: key, ...value });
      return projectMessagingAttachment(row);
    });
  });
}
export function acceptMessagingAttachment(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['actor', 'conversationId', 'id', 'requestId', 'checksum', 'sizeBytes', 'mimeType']), actor = captureMessagingActor(r.actor);
    const { conversation, member } = conversationMember(context, actor, r.conversationId), row = context.db.get('messaging_attachments', messagingId(r.id)) as AttachmentRow | null;
    if (!row || row.scope_id !== actor.scopeId || row.conversation_id !== conversation.id || row.owner_id !== actor.id || row.owner_kind !== actor.kind
      || conversation.archived || row.visibility === 'staff' && !staffTimeline(conversation, member)) messagingFail('MESSAGING_NOT_FOUND', 404);
    return messagingIntent(context, actor, r.requestId, ['attachment.accept', row.id, r.checksum, r.sizeBytes, r.mimeType], () => {
      if (row.message_id || !['allocated', 'ready'].includes(row.state) || row.expires_at <= Date.now()
        || row.checksum !== r.checksum || row.size_bytes !== r.sizeBytes || row.mime_type !== r.mimeType) messagingFail('MESSAGING_ATTACHMENT_UNAVAILABLE', 422);
      if (row.state === 'allocated') context.db.update('messaging_attachments', row.id, { state: 'ready' });
      return projectMessagingAttachment({ ...row, state: 'ready' });
    });
  });
}
/** Recovery can retire only expired unattached bytes; an attached message never becomes a cleanup candidate. */
export function retireMessagingAttachment(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['actor', 'scopeId', 'conversationId', 'id', 'requestId', 'finish', 'recovery']);
    if (r.finish !== undefined && r.finish !== true || r.recovery !== undefined && r.recovery !== true) messagingFail('MESSAGING_INPUT_INVALID', 422);
    const row = context.db.get('messaging_attachments', messagingId(r.id)) as AttachmentRow | null;
    if (!row) messagingFail('MESSAGING_NOT_FOUND', 404);
    const actor = r.recovery === true ? null : captureMessagingActor(r.actor);
    if (r.recovery === true) {
      if (row.scope_id !== r.scopeId || row.message_id || row.expires_at > Date.now() && !['removing', 'removed'].includes(row.state)) messagingFail('MESSAGING_ATTACHMENT_UNAVAILABLE', 422);
    } else {
      conversationMember(context, actor!, r.conversationId);
      if (row.scope_id !== actor!.scopeId || row.conversation_id !== r.conversationId || row.owner_id !== actor!.id || row.owner_kind !== actor!.kind) messagingFail('MESSAGING_NOT_FOUND', 404);
    }
    if (row.message_id) messagingFail('MESSAGING_ATTACHMENT_UNAVAILABLE', 422);
    const retire = () => {
      if (row.state === 'removed') return { removed: true };
      if (r.finish === true && row.state !== 'removing') messagingFail('MESSAGING_STAGE_CONFLICT');
      context.db.update('messaging_attachments', row.id, { state: r.finish ? 'removed' : 'removing' });
      if (r.finish) releaseAttachmentReservation(context, row);
      return r.finish ? { removed: true } : { removing: true };
    };
    return actor ? messagingIntent(context, actor, r.requestId, ['attachment.remove', row.id, r.finish === true], retire) : retire();
  });
}
