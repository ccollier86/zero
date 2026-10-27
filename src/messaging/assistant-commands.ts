/** Internal bot conversations are independent of customer support and never create Guardian accounts. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import { messagingCommand } from './realm-errors';
import { captureMessagingActor, memberKey, messagingIntent } from './realm-model';
import { messagingFail, messagingId, messagingRecord, messagingText } from './validation';

export function openMessagingAssistant(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['actor', 'id', 'requestId', 'assistantId', 'title']);
    const actor = captureMessagingActor(r.actor), id = messagingId(r.id), assistantId = messagingText(r.assistantId, 64), title = messagingText(r.title, 200, true);
    if (actor.kind !== 'user' || !Object.hasOwn(actor.assistantPolicies ?? {}, assistantId)) messagingFail('MESSAGING_NOT_FOUND', 404);
    return messagingIntent(context, actor, r.requestId, ['assistant.open', assistantId, title], () => {
      const now = Date.now(), bot = 'assistant:' + assistantId;
      context.db.createStrict('messaging_conversations', { id, scope_id: actor.scopeId, kind: 'assistant', title, revision: 1, created_at: now,
        updated_at: now, public_updated_at: now, archived: 0, created_by: actor.id, owner: 'assistant', owner_id: null,
        owner_epoch: 1, internal_sequence: 0, public_sequence: 0, channel_id: null, assistant_id: assistantId, members_json: JSON.stringify([actor.id, bot]) });
      for (const [participant, kind, role] of [[actor.id, 'user', 'owner'], [bot, 'assistant', 'member']] as const) {
        context.db.createStrict('messaging_members', { id: memberKey(id, participant), scope_id: actor.scopeId, conversation_id: id, participant_id: participant,
          kind, role, active: 1, joined_at: now, history_from: 1, read_sequence: 0 });
      }
      return { id, revision: 1 };
    });
  });
}
