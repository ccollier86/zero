/** Canonical membership, ownership and read-position changes in one short tracked Fabric commit. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import { messagingCommand } from './realm-errors';
import { assertMessagingContact, assertRevision, captureMessagingActor, conversationMember, conversationMembers, memberKey, messagingIntent, staffTimeline, type ConversationRow, type MemberRow } from './realm-model';
import { messagingArray, messagingChoice, messagingFail, messagingId, messagingInteger, messagingRecord, messagingText } from './validation';
import { queueMessagingAssistant } from './message-commands';
import type { JobConversation } from './job-model';

export function createMessagingConversation(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['actor', 'id', 'requestId', 'kind', 'title', 'userIds', 'contactsOnly', 'maxParticipants']);
    const actor = captureMessagingActor(r.actor), kind = messagingChoice(r.kind, ['direct', 'group']), id = messagingId(r.id), title = messagingText(r.title, 200, true);
    const maximum = messagingInteger(r.maxParticipants, 2, 100), users = [...new Set(messagingArray(r.userIds, maximum - 1).map(messagingId))];
    if (actor.kind !== 'user' || users.length < 1 || users.includes(actor.id) || kind === 'direct' && users.length !== 1 || typeof r.contactsOnly !== 'boolean') messagingFail('MESSAGING_INPUT_INVALID', 422);
    for (const other of users) assertMessagingContact(context, actor, other, r.contactsOnly);
    return messagingIntent(context, actor, r.requestId, ['conversation.create', kind, title, users], () => {
      const now = Date.now(), members = [actor.id, ...users];
      const row: ConversationRow = { id, scope_id: actor.scopeId, kind, title, revision: 1, created_at: now, updated_at: now, public_updated_at: now, archived: 0,
        created_by: actor.id, owner: 'human', owner_id: null, owner_epoch: 1, internal_sequence: 0, public_sequence: 0, channel_id: null, members_json: JSON.stringify(members) };
      context.db.createStrict('messaging_conversations', row);
      for (const user of members) context.db.createStrict('messaging_members', { id: memberKey(id, user), scope_id: actor.scopeId, conversation_id: id, participant_id: user, kind: 'user', role: user === actor.id ? 'owner' : 'member', active: 1, joined_at: now, history_from: 1, read_sequence: 0 });
      return { id, revision: 1 };
    });
  });
}
export function changeMessagingConversation(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['actor', 'id', 'requestId', 'expectedRevision', 'action', 'value', 'maxParticipants', 'contactsOnly', 'history']);
    const actor = captureMessagingActor(r.actor), { conversation, member } = conversationMember(context, actor, r.id), action = messagingChoice(r.action, ['rename', 'archive', 'add', 'remove', 'transfer']);
    if (conversation.kind === 'direct' && action === 'add') messagingFail('MESSAGING_FORBIDDEN', 403);
    if (conversation.managed_group_id) messagingFail('MESSAGING_FORBIDDEN', 403);
    const selfLeave = action === 'remove' && r.value === actor.id && member.role !== 'owner';
    if (member.role !== 'owner' && !selfLeave) messagingFail('MESSAGING_FORBIDDEN', 403);
    return messagingIntent(context, actor, r.requestId, [action, conversation.id, r.expectedRevision, r.value], () => {
      assertRevision(conversation, r.expectedRevision);
      const updates: Partial<ConversationRow> = { revision: conversation.revision + 1, updated_at: Date.now(), public_updated_at: Date.now() };
      if (action === 'rename') updates.title = messagingText(r.value, 200, true);
      else if (action === 'archive') { if (typeof r.value !== 'boolean') messagingFail('MESSAGING_INPUT_INVALID', 422); updates.archived = r.value ? 1 : 0; }
      else {
        if (conversation.kind !== 'group') messagingFail('MESSAGING_FORBIDDEN', 403);
        const user = messagingId(r.value), members = conversationMembers(conversation), key = memberKey(conversation.id, user);
        const prior = context.db.get('messaging_members', key) as MemberRow | null;
        if (action === 'transfer') {
          if (!prior || prior.active !== 1 || prior.kind !== 'user' || prior.role !== 'member') messagingFail('MESSAGING_FORBIDDEN', 403);
          context.db.update('messaging_members', member.id, { role: 'member' });
          context.db.update('messaging_members', prior.id, { role: 'owner' });
        } else if (action === 'add') {
          const maximum = messagingInteger(r.maxParticipants, 2, 100);
          if (members.length >= maximum) messagingFail('MESSAGING_CAPACITY', 429);
          if (prior?.active) messagingFail('MESSAGING_REVISION_CONFLICT');
          if (typeof r.contactsOnly !== 'boolean') messagingFail('MESSAGING_INPUT_INVALID', 422);
          const history = messagingChoice(r.history, ['all', 'since-join']);
          assertMessagingContact(context, actor, user, r.contactsOnly);
          const row = { id: key, scope_id: actor.scopeId, conversation_id: conversation.id, participant_id: user, kind: 'user', role: 'member', active: 1,
            joined_at: Date.now(), history_from: history === 'since-join' ? conversation.public_sequence + 1 : 1, read_sequence: conversation.public_sequence };
          if (prior) context.db.update('messaging_members', key, row); else context.db.createStrict('messaging_members', row);
          updates.members_json = JSON.stringify([...members, user]);
        } else {
          if (!prior?.active || prior.role === 'owner') messagingFail('MESSAGING_FORBIDDEN', 403);
          context.db.update('messaging_members', key, { active: 0 }); updates.members_json = JSON.stringify(members.filter(id => id !== user));
        }
      }
      context.db.update('messaging_conversations', conversation.id, updates);
      return action === 'remove' ? { removed: true, id: conversation.id } : { id: conversation.id, revision: updates.revision };
    });
  });
}
export function markMessagingRead(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['actor', 'id', 'requestId', 'throughSequence']), actor = captureMessagingActor(r.actor), { conversation, member } = conversationMember(context, actor, r.id);
    const through = messagingInteger(r.throughSequence, 0, staffTimeline(conversation, member) ? conversation.internal_sequence : conversation.public_sequence);
    return messagingIntent(context, actor, r.requestId, ['read', conversation.id, through], () => {
      const next = Math.max(through, member.read_sequence); context.db.update('messaging_members', member.id, { read_sequence: next }); return { throughSequence: next };
    });
  });
}
export function ownMessagingConversation(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['actor', 'id', 'requestId', 'expectedEpoch', 'owner', 'assistantPolicy', 'assistantId']), actor = captureMessagingActor(r.actor), { conversation, member } = conversationMember(context, actor, r.id);
    const owner = messagingChoice(r.owner, ['human', 'assistant', 'triage']);
    const internal = conversation.kind === 'assistant' && actor.kind === 'user' && member.role === 'owner';
    if (!internal && (!actor.staff || member.role !== 'staff' || conversation.kind !== 'support')) messagingFail('MESSAGING_FORBIDDEN', 403);
    if (internal && owner === 'triage') messagingFail('MESSAGING_INPUT_INVALID', 422);
    return messagingIntent(context, actor, r.requestId, ['ownership', conversation.id, r.expectedEpoch, owner], () => {
      if (conversation.owner_epoch !== messagingInteger(r.expectedEpoch)) messagingFail('MESSAGING_OWNER_CONFLICT');
      if (conversation.owner_epoch >= Number.MAX_SAFE_INTEGER - 2) messagingFail('MESSAGING_CAPACITY', 429);
      const assistantId = internal ? conversation.assistant_id : owner === 'assistant' ? messagingText(r.assistantId ?? 'default', 64) : conversation.assistant_id;
      context.db.update('messaging_conversations', conversation.id, { owner, owner_id: owner === 'human' ? actor.id : null, owner_epoch: conversation.owner_epoch + 1, revision: conversation.revision + 1, assistant_id: assistantId ?? null, updated_at: Date.now(), public_updated_at: Date.now() });
      if (owner === 'assistant') queueMessagingAssistant(context, { ...conversation, owner, assistant_id: assistantId, owner_epoch: conversation.owner_epoch + 1 } as JobConversation, internal ? actor.assistantPolicies?.[assistantId!] : r.assistantPolicy);
      // Old queued work cannot pass the epoch comparison at claim/send/final commit.
      // An already-dispatched provider request remains unknown/accepted, not retroactively unsent.
      return { id: conversation.id, ownerEpoch: conversation.owner_epoch + 1 };
    });
  });
}
