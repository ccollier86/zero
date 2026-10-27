/** Message mutations and their durable jobs share one canonical commit. Network execution belongs elsewhere. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import { messagingCommand } from './realm-errors';
import { assertMessagingContact, assertRevision, captureMessagingActor, conversationMember, conversationMembers, messagingIntent, projectMessage, staffTimeline, type ConversationRow, type MessageRow } from './realm-model';
import { messagingArray, messagingChoice, messagingFail, messagingHash, messagingId, messagingInteger, messagingRecord, messagingText } from './validation';
import { MESSAGING_REACTIONS } from './contracts';
import { releaseAttachmentReservation, type AttachmentRow } from './attachment-model';
import type { JobConversation } from './job-model';

export function sendMessagingMessage(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['actor', 'id', 'requestId', 'conversationId', 'text', 'attachmentIds', 'visibility', 'expectedOwnerEpoch', 'maxMessageLength', 'assistantEnabled', 'assistantPolicy', 'notificationsEnabled']);
    const actor = captureMessagingActor(r.actor), { conversation, member } = conversationMember(context, actor, r.conversationId), staff = staffTimeline(conversation, member);
    const text = messagingText(r.text, messagingInteger(r.maxMessageLength, 1, 20000), true), id = messagingId(r.id), visibility = messagingChoice(r.visibility ?? 'conversation', ['conversation', 'staff']);
    const attachments = [...new Set(messagingArray(r.attachmentIds ?? [], 10).map(messagingId))];
    if (!text.trim() && !attachments.length || visibility === 'staff' && !staff) messagingFail('MESSAGING_INPUT_INVALID', 422);
    if (conversation.kind !== 'support') for (const other of conversationMembers(conversation)) if (other !== actor.id) assertMessagingContact(context, actor, other, false);
    return messagingIntent(context, actor, r.requestId, ['message.send', conversation.id, text, attachments, visibility, r.expectedOwnerEpoch ?? null], () => {
      if (conversation.archived) messagingFail('MESSAGING_ARCHIVED');
      if (staff && visibility === 'conversation' && (conversation.owner !== 'human' || conversation.owner_id !== actor.id || conversation.owner_epoch !== messagingInteger(r.expectedOwnerEpoch))) messagingFail('MESSAGING_OWNER_CONFLICT');
      if (conversation.internal_sequence >= Number.MAX_SAFE_INTEGER - 2 || conversation.public_sequence >= Number.MAX_SAFE_INTEGER - 2) messagingFail('MESSAGING_CAPACITY', 429);
      for (const attachmentId of attachments) {
        const asset = context.db.get('messaging_attachments', attachmentId) as AttachmentRow | null;
        if (!asset || asset.scope_id !== actor.scopeId || asset.conversation_id !== conversation.id || asset.owner_id !== actor.id || asset.owner_kind !== actor.kind || asset.visibility !== visibility || asset.state !== 'ready' || asset.message_id !== null || asset.expires_at <= Date.now()) messagingFail('MESSAGING_ATTACHMENT_UNAVAILABLE', 422);
        context.db.update('messaging_attachments', attachmentId, { message_id: id });
        releaseAttachmentReservation(context, asset);
      }
      const now = Date.now(), sequence = conversation.internal_sequence + 1, publicSequence = visibility === 'conversation' ? conversation.public_sequence + 1 : null;
      const row: MessageRow = { id, scope_id: actor.scopeId, conversation_id: conversation.id, sequence, public_sequence: publicSequence, revision: 1, author_id: actor.id,
        author_kind: actor.kind, visibility, text, created_at: now, edited_at: null, deleted: 0, attachment_ids: JSON.stringify(attachments) };
      context.db.createStrict('messaging_messages', row);
      const prior = conversation as JobConversation;
      if (visibility === 'conversation' && prior.context_revision >= Number.MAX_SAFE_INTEGER - 2) messagingFail('MESSAGING_CAPACITY', 429);
      const next: JobConversation = { ...prior, internal_sequence: sequence, public_sequence: publicSequence ?? conversation.public_sequence,
        updated_at: now, ...(visibility === 'conversation' ? { public_updated_at: now, context_revision: prior.context_revision + 1, customer_turn_id: member.role === 'customer' ? id : null } : {}) };
      context.db.update('messaging_conversations', conversation.id, next);
      if (visibility === 'conversation') {
        if (conversation.channel_id && actor.kind !== 'external') appendMessagingJob(context, conversation, id, 'delivery', now);
        if (r.assistantEnabled === true) queueMessagingAssistant(context, next, r.assistantPolicy);
        if (r.notificationsEnabled === true) appendMessagingJob(context, conversation, id, 'notification', now);
      }
      return projectMessage(row, staff);
    });
  });
}
/** Job identity binds the accepted message and ownership epoch; one queued start does not run a provider inline. */
export function appendMessagingJob(context: DatabaseWriteCommandContext, conversation: ConversationRow, messageId: string, kind: 'assistant' | 'delivery' | 'notification', now: number, policyHash: string | null = null): void {
  const revision = (conversation as JobConversation).context_revision ?? 0, id = messagingHash(kind === 'assistant' ? [messageId, kind, conversation.owner_epoch, revision] : [messageId, kind]);
  if (context.db.get('messaging_jobs', id)) return;
  context.db.createStrict('messaging_jobs', { id, scope_id: conversation.scope_id, conversation_id: conversation.id, message_id: messageId,
    kind, owner_epoch: conversation.owner_epoch, context_revision: revision, policy_hash: policyHash, dispatch_generation: 0, state: 'pending', lease_nonce: null, lease_expires: null, attempts: 0, provider_id: null, error_code: null, created_at: now, updated_at: now });
}
export function queueMessagingAssistant(context: DatabaseWriteCommandContext, conversation: JobConversation, policy: unknown): void {
  if (!conversation.customer_turn_id || conversation.owner !== 'assistant' || conversation.archived) return;
  if (typeof policy !== 'string' || !/^[a-f0-9]{64}$/.test(policy)) messagingFail('MESSAGING_INPUT_INVALID', 422);
  appendMessagingJob(context, conversation, conversation.customer_turn_id, 'assistant', Date.now(), policy);
}
export function changeMessagingMessage(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['actor', 'conversationId', 'id', 'requestId', 'expectedRevision', 'text', 'action', 'maxMessageLength', 'assistantPolicy']);
    const actor = captureMessagingActor(r.actor), { conversation, member } = conversationMember(context, actor, r.conversationId), staff = staffTimeline(conversation, member);
    const row = context.db.get('messaging_messages', messagingId(r.id)) as MessageRow | null;
    if (!row || row.conversation_id !== conversation.id || row.scope_id !== actor.scopeId || row.visibility === 'staff' && !staff || (staff ? row.sequence : row.public_sequence!) < member.history_from) messagingFail('MESSAGING_NOT_FOUND', 404);
    if (row.author_id !== actor.id || row.author_kind !== actor.kind) messagingFail('MESSAGING_FORBIDDEN', 403);
    const action = messagingChoice(r.action, ['edit', 'remove']), text = action === 'edit' ? messagingText(r.text, messagingInteger(r.maxMessageLength, 1, 20000)) : '';
    return messagingIntent(context, actor, r.requestId, [action, row.id, r.expectedRevision, text], () => {
      assertRevision(row, r.expectedRevision);
      if (row.deleted || conversation.archived) messagingFail('MESSAGING_STAGE_CONFLICT');
      // Delivery adapters must explicitly qualify edits; never label a web-only edit as a provider update.
      if (conversation.channel_id && row.visibility === 'conversation') messagingFail('MESSAGING_STAGE_CONFLICT');
      const next: MessageRow = { ...row, revision: row.revision + 1, text, edited_at: Date.now(), deleted: action === 'remove' ? 1 : 0 };
      context.db.update('messaging_messages', row.id, next);
      const prior = conversation as JobConversation;
      if (row.visibility === 'conversation' && prior.context_revision >= Number.MAX_SAFE_INTEGER - 2) messagingFail('MESSAGING_CAPACITY', 429);
      const changed: JobConversation = { ...prior, updated_at: next.edited_at!, ...(row.visibility === 'conversation' ? { public_updated_at: next.edited_at!, context_revision: prior.context_revision + 1,
        ...(action === 'remove' && prior.customer_turn_id === row.id ? { customer_turn_id: null } : {}) } : {}) };
      context.db.update('messaging_conversations', conversation.id, changed);
      if (row.visibility === 'conversation' && r.assistantPolicy) queueMessagingAssistant(context, changed, r.assistantPolicy);
      return projectMessage(next, staff);
    });
  });
}
export function reactMessagingMessage(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['actor', 'conversationId', 'id', 'requestId', 'emoji', 'selected']), actor = captureMessagingActor(r.actor), { conversation, member } = conversationMember(context, actor, r.conversationId);
    const row = context.db.get('messaging_messages', messagingId(r.id)) as MessageRow | null;
    const staff = staffTimeline(conversation, member), emoji = messagingText(r.emoji, 32);
    if (typeof r.selected !== 'boolean') messagingFail('MESSAGING_INPUT_INVALID', 422);
    messagingChoice(emoji, MESSAGING_REACTIONS);
    if (!row || row.scope_id !== actor.scopeId || row.conversation_id !== conversation.id || row.visibility === 'staff' && !staff || (staff ? row.sequence : row.public_sequence!) < member.history_from) messagingFail('MESSAGING_NOT_FOUND', 404);
    return messagingIntent(context, actor, r.requestId, ['reaction', row.id, emoji, r.selected], () => {
      if (row.deleted || conversation.archived || conversation.channel_id) messagingFail('MESSAGING_STAGE_CONFLICT');
      const id = messagingHash([row.id, actor.id, emoji]), prior = context.db.get('messaging_reactions', id);
      if (r.selected && !prior) context.db.createStrict('messaging_reactions', { id, conversation_id: conversation.id, message_id: row.id, participant_id: actor.id, emoji });
      else if (!r.selected && prior) context.db.delete('messaging_reactions', id);
      return { id: row.id, selected: r.selected };
    });
  });
}
