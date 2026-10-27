/** Explicit owner-authorized review resolution. Retry creates a new ownership-bound job; it never edits an old outcome or calls a provider inline. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import { captureMessagingActor, conversationMember, memberKey, messagingIntent, staffTimeline, type MemberRow, type MessageRow } from './realm-model';
import { messagingCommand } from './realm-errors';
import { messagingChoice, messagingFail, messagingHash, messagingInteger, messagingRecord } from './validation';
import { jobInScope, type JobConversation } from './job-model';
import { queueMessagingAssistant } from './message-commands';

export function resolveMessagingReview(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['actor', 'conversationId', 'id', 'requestId', 'expectedOwnerEpoch', 'action', 'acknowledgePossibleDuplicate', 'assistantPolicy']);
    const actor = captureMessagingActor(r.actor), { conversation, member } = conversationMember(context, actor, r.conversationId);
    if (!actor.staff || actor.kind !== 'user' || !staffTimeline(conversation, member)) messagingFail('MESSAGING_FORBIDDEN', 403);
    const job = jobInScope(context, r.id, actor.scopeId), action = messagingChoice(r.action, ['dismiss', 'retry']);
    if (job.conversation_id !== conversation.id || job.state !== 'needs-review') messagingFail('MESSAGING_NOT_FOUND', 404);
    const expected = messagingInteger(r.expectedOwnerEpoch);
    if (action === 'retry' && r.acknowledgePossibleDuplicate !== true) messagingFail('MESSAGING_INPUT_INVALID', 422);
    return messagingIntent(context, actor, r.requestId, ['review.' + action, job.id, expected, r.acknowledgePossibleDuplicate ?? null], () => {
      if (conversation.archived || conversation.owner !== 'human' || conversation.owner_id !== actor.id || conversation.owner_epoch !== expected) messagingFail('MESSAGING_OWNER_CONFLICT');
      const id = 'resolution_' + messagingHash(job.id).slice(0, 40);
      if (context.db.get('messaging_job_resolutions', id)) messagingFail('MESSAGING_STAGE_CONFLICT');
      let replacementJobId: string | null = null;
      if (action === 'retry') {
        const current = conversation as JobConversation, turn = context.db.get('messaging_messages', job.message_id) as MessageRow | null;
        const customer = turn ? context.db.get('messaging_members', memberKey(conversation.id, turn.author_id)) as MemberRow | null : null;
        if (job.kind !== 'assistant' || current.customer_turn_id !== job.message_id || current.context_revision !== job.context_revision || !turn || turn.deleted || turn.scope_id !== actor.scopeId || !customer || customer.active !== 1 || customer.role !== 'customer' || customer.kind !== turn.author_kind) messagingFail('MESSAGING_STAGE_CONFLICT');
        if (current.owner_epoch >= Number.MAX_SAFE_INTEGER - 2 || current.revision >= Number.MAX_SAFE_INTEGER - 2) messagingFail('MESSAGING_CAPACITY', 429);
        const next: JobConversation = { ...current, owner: 'assistant', owner_id: null, owner_epoch: current.owner_epoch + 1, revision: current.revision + 1, updated_at: Date.now(), public_updated_at: Date.now() };
        context.db.update('messaging_conversations', current.id, next);
        replacementJobId = queueMessagingAssistant(context, next, r.assistantPolicy);
        if (!replacementJobId || replacementJobId === job.id) messagingFail('MESSAGING_JOB_CONFLICT');
      }
      context.db.createStrict('messaging_job_resolutions', { id, scope_id: actor.scopeId, conversation_id: conversation.id, job_id: job.id, actor_id: actor.id, action, replacement_job_id: replacementJobId, created_at: Date.now() });
      return { id, jobId: job.id, action, replacementJobId };
    });
  });
}
