/** Trusted support admission and atomic staff claim. Customer IDs/connections are established by the server transport. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import { messagingCommand } from './realm-errors';
import { captureMessagingActor, conversationMember, conversationMembers, memberKey, messagingIntent, type ConversationRow, type MemberRow } from './realm-model';
import { messagingChoice, messagingFail, messagingId, messagingInteger, messagingRecord, messagingText } from './validation';

export function openMessagingSupport(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['actor', 'id', 'requestId', 'title', 'owner', 'channelId', 'assistantId', 'entryId', 'visitorSessionId']), actor = captureMessagingActor(r.actor), id = messagingId(r.id), title = messagingText(r.title, 200, true);
    const owner = messagingChoice(r.owner, ['triage', 'assistant']), channelId = r.channelId === null ? null : messagingId(r.channelId);
    if (actor.kind === 'assistant') messagingFail('MESSAGING_FORBIDDEN', 403);
    return messagingIntent(context, actor, r.requestId, ['support.open', title, owner, channelId], () => {
      const now = Date.now();
      context.db.createStrict('messaging_conversations', { id, scope_id: actor.scopeId, kind: 'support', title, revision: 1, created_at: now, updated_at: now, public_updated_at: now, archived: 0,
        created_by: actor.id, owner, owner_id: null, owner_epoch: 1, internal_sequence: 0, public_sequence: 0, channel_id: channelId,
        assistant_id: r.assistantId === undefined ? 'default' : r.assistantId === null ? null : messagingText(r.assistantId, 64), support_entry_id: r.entryId === undefined ? null : messagingId(r.entryId), visitor_session_id: r.visitorSessionId === undefined ? null : messagingId(r.visitorSessionId), members_json: JSON.stringify([actor.id]) });
      context.db.createStrict('messaging_members', { id: memberKey(id, actor.id), scope_id: actor.scopeId, conversation_id: id, participant_id: actor.id, kind: actor.kind, role: 'customer', active: 1, joined_at: now, history_from: 1, read_sequence: 0 });
      return { id, revision: 1 };
    });
  });
}
export function claimMessagingSupport(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['actor', 'id', 'requestId', 'expectedEpoch', 'maxParticipants']), actor = captureMessagingActor(r.actor);
    const row = context.db.get('messaging_conversations', messagingId(r.id)) as ConversationRow | null;
    if (actor.kind !== 'user' || !actor.staff || !row || row.scope_id !== actor.scopeId || row.kind !== 'support' || row.support_entry_id && !actor.supportPolicies?.[row.support_entry_id]) messagingFail('MESSAGING_NOT_FOUND', 404);
    const conversation = row!;
    return messagingIntent(context, actor, r.requestId, ['support.claim', conversation.id, r.expectedEpoch], () => {
      if (conversation.owner_epoch !== messagingInteger(r.expectedEpoch)) messagingFail('MESSAGING_OWNER_CONFLICT');
      if (conversation.archived) messagingFail('MESSAGING_ARCHIVED');
      if (conversation.owner_epoch >= Number.MAX_SAFE_INTEGER - 2 || conversation.revision >= Number.MAX_SAFE_INTEGER - 2) messagingFail('MESSAGING_CAPACITY', 429);
      const members = conversationMembers(conversation), key = memberKey(conversation.id, actor.id), prior = context.db.get('messaging_members', key) as MemberRow | null;
      if (prior?.active && prior.role !== 'staff') messagingFail('MESSAGING_FORBIDDEN', 403);
      if (!prior?.active) {
        if (members.length >= messagingInteger(r.maxParticipants, 2, 100)) messagingFail('MESSAGING_CAPACITY', 429);
        const member = { id: key, scope_id: actor.scopeId, conversation_id: conversation.id, participant_id: actor.id, kind: 'user', role: 'staff', active: 1, joined_at: Date.now(), history_from: 1, read_sequence: 0 };
        if (prior) context.db.update('messaging_members', key, member); else context.db.createStrict('messaging_members', member);
        members.push(actor.id);
      }
      context.db.update('messaging_conversations', conversation.id, { owner: 'human', owner_id: actor.id, owner_epoch: conversation.owner_epoch + 1, revision: conversation.revision + 1,
        updated_at: Date.now(), public_updated_at: Date.now(), members_json: JSON.stringify(members) });
      return { id: conversation.id, ownerEpoch: conversation.owner_epoch + 1 };
    });
  });
}

/** The customer can stop automatic replies, never choose staff or displace a human owner. */
export function requestMessagingHuman(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['actor', 'id', 'requestId', 'expectedEpoch']), actor = captureMessagingActor(r.actor);
    const { conversation, member } = conversationMember(context, actor, r.id), epoch = messagingInteger(r.expectedEpoch);
    if (conversation.kind !== 'support' || member.role !== 'customer' || actor.kind === 'assistant') messagingFail('MESSAGING_FORBIDDEN', 403);
    return messagingIntent(context, actor, r.requestId, ['support.request-human', conversation.id, epoch], () => {
      if (conversation.owner_epoch !== epoch) messagingFail('MESSAGING_OWNER_CONFLICT');
      if (conversation.archived) messagingFail('MESSAGING_ARCHIVED');
      if (conversation.owner !== 'assistant') return { id: conversation.id, ownerEpoch: epoch };
      if (epoch >= Number.MAX_SAFE_INTEGER - 2 || conversation.revision >= Number.MAX_SAFE_INTEGER - 2) messagingFail('MESSAGING_CAPACITY', 429);
      context.db.update('messaging_conversations', conversation.id, { owner: 'triage', owner_id: null, owner_epoch: epoch + 1,
        revision: conversation.revision + 1, updated_at: Date.now(), public_updated_at: Date.now() });
      // The old provider call may finish, but its epoch can no longer publish.
      return { id: conversation.id, ownerEpoch: epoch + 1 };
    });
  });
}
