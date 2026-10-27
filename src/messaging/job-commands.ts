/** Short tracked job transitions. Provider/network work never runs in a command or held SQLite/auth lease. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import { messagingCommand } from './realm-errors';
import { currentAssistantTurn, finishJobAttempt, jobAttemptId, jobInScope, terminalJob, TERMINAL_MESSAGING_JOBS, type JobConversation } from './job-model';
import { messagingFail, messagingHash, messagingId, messagingInteger, messagingRecord, messagingText } from './validation';
import type { MessageRow } from './realm-model';
import { appendMessagingJob } from './message-commands';

export function claimMessagingJob(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['scopeId', 'id', 'nonce', 'policyHash', 'leaseMs']), job = jobInScope(context, r.id, r.scopeId), nonce = messagingId(r.nonce);
    if (TERMINAL_MESSAGING_JOBS.has(job.state)) return { state: job.state };
    if (job.kind === 'assistant' && job.policy_hash !== r.policyHash) return terminalJob(context, job, 'needs-review', 'POLICY_CHANGED');
    if (job.kind === 'assistant' && !currentAssistantTurn(context, job)) return terminalJob(context, job, 'cancelled', 'TURN_SUPERSEDED');
    // A crash after invocation admission is an uncertain call, never a license
    // to issue another one. A received result can resume publication only.
    if (job.state === 'calling') return terminalJob(context, job, 'needs-review', 'INVOCATION_UNKNOWN');
    const state = job.state === 'received' ? 'received' : 'claimed', now = Date.now();
    context.db.update('messaging_jobs', job.id, { state, lease_nonce: nonce, lease_expires: now + messagingInteger(r.leaseMs, 1000, 600000), updated_at: now });
    return { state };
  });
}
export function beginMessagingJobCall(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['scopeId', 'id', 'nonce']), job = jobInScope(context, r.id, r.scopeId), nonce = messagingId(r.nonce);
    if (job.state !== 'claimed' || job.lease_nonce !== nonce || !job.lease_expires || job.lease_expires <= Date.now()) messagingFail('MESSAGING_JOB_CONFLICT');
    if (job.kind === 'assistant' && !currentAssistantTurn(context, job)) return terminalJob(context, job, 'cancelled', 'TURN_SUPERSEDED');
    if (job.attempts >= Number.MAX_SAFE_INTEGER - 2) messagingFail('MESSAGING_CAPACITY', 429);
    const now = Date.now(); context.db.update('messaging_jobs', job.id, { state: 'calling', attempts: job.attempts + 1, updated_at: now });
    context.db.createStrict('messaging_job_attempts', { id: jobAttemptId(job, nonce), scope_id: job.scope_id, job_id: job.id, nonce, outcome: 'calling', started_at: now, finished_at: null, error_code: null, provider_id: null });
    return { state: 'calling' };
  });
}
export function receiveMessagingJobResult(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['scopeId', 'id', 'nonce', 'text', 'providerId', 'maxMessageLength']), job = jobInScope(context, r.id, r.scopeId);
    if (job.kind !== 'assistant' || job.state !== 'calling' || job.lease_nonce !== messagingId(r.nonce) || !job.lease_expires || job.lease_expires <= Date.now()) messagingFail('MESSAGING_JOB_CONFLICT');
    const text = messagingText(r.text, messagingInteger(r.maxMessageLength, 1, 20000)), providerId = r.providerId === null ? null : messagingText(r.providerId, 200);
    finishJobAttempt(context, job, 'completed', null, providerId);
    if (!currentAssistantTurn(context, job)) return terminalJob(context, job, 'cancelled', 'TURN_SUPERSEDED');
    context.db.createStrict('messaging_job_results', { id: job.id, scope_id: job.scope_id, text, provider_id: providerId, received_at: Date.now() });
    context.db.update('messaging_jobs', job.id, { state: 'received', provider_id: providerId, updated_at: Date.now() });
    return { state: 'received' };
  });
}
export function publishMessagingJobResult(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['scopeId', 'id', 'nonce', 'notificationsEnabled']), job = jobInScope(context, r.id, r.scopeId);
    if (job.state === 'accepted') return { state: 'accepted' };
    if (job.kind !== 'assistant' || job.state !== 'received' || job.lease_nonce !== messagingId(r.nonce) || !job.lease_expires || job.lease_expires <= Date.now()) messagingFail('MESSAGING_JOB_CONFLICT');
    if (!currentAssistantTurn(context, job)) return terminalJob(context, job, 'cancelled', 'TURN_SUPERSEDED');
    const conversation = context.db.get('messaging_conversations', job.conversation_id) as JobConversation, result = context.db.get('messaging_job_results', job.id);
    if (!result || result.scope_id !== job.scope_id || typeof result.text !== 'string') messagingFail('MESSAGING_JOB_CONFLICT');
    if (conversation.internal_sequence >= Number.MAX_SAFE_INTEGER - 2 || conversation.public_sequence >= Number.MAX_SAFE_INTEGER - 2 || conversation.context_revision >= Number.MAX_SAFE_INTEGER - 2) messagingFail('MESSAGING_CAPACITY', 429);
    const id = 'message_' + messagingHash(['assistant', job.id]).slice(0, 40), now = Date.now();
    const row: MessageRow = { id, scope_id: job.scope_id, conversation_id: conversation.id, sequence: conversation.internal_sequence + 1, public_sequence: conversation.public_sequence + 1,
      revision: 1, author_id: 'assistant:default', author_kind: 'assistant', visibility: 'conversation', text: result.text, created_at: now, edited_at: null, deleted: 0, attachment_ids: '[]' };
    context.db.createStrict('messaging_messages', row);
    context.db.update('messaging_conversations', conversation.id, { internal_sequence: row.sequence, public_sequence: row.public_sequence, updated_at: now, public_updated_at: now, customer_turn_id: null, context_revision: conversation.context_revision + 1 });
    if (conversation.channel_id) appendMessagingJob(context, conversation, id, 'delivery', now);
    if (r.notificationsEnabled === true) appendMessagingJob(context, conversation, id, 'notification', now);
    context.db.update('messaging_jobs', job.id, { state: 'accepted', lease_nonce: null, lease_expires: null, updated_at: now });
    return { state: 'accepted' };
  });
}
export function reviewMessagingJob(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['scopeId', 'id', 'nonce', 'code']), job = jobInScope(context, r.id, r.scopeId);
    if (TERMINAL_MESSAGING_JOBS.has(job.state)) return { state: job.state };
    if (job.lease_nonce !== messagingId(r.nonce)) messagingFail('MESSAGING_JOB_CONFLICT');
    if (job.kind === 'assistant' && !currentAssistantTurn(context, job)) return terminalJob(context, job, 'cancelled', 'TURN_SUPERSEDED');
    // A known received result remains recoverable. A failed final write must
    // never silently turn it into a fresh generation.
    const code = messagingText(r.code, 80); if (!/^[A-Z][A-Z0-9_]{0,79}$/.test(code)) messagingFail('MESSAGING_INPUT_INVALID', 422);
    return terminalJob(context, job, 'needs-review', code);
  });
}
export function bindMessagingJobDispatch(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['scopeId', 'id', 'generation', 'workflowId']), job = jobInScope(context, r.id, r.scopeId), generation = messagingInteger(r.generation, 0), workflowId = messagingId(r.workflowId);
    if (generation !== job.dispatch_generation) messagingFail('MESSAGING_JOB_CONFLICT');
    const id = job.id + ':' + generation, prior = context.db.get('messaging_job_dispatches', id);
    if (prior && prior.workflow_id !== workflowId) messagingFail('MESSAGING_JOB_CONFLICT');
    if (!prior) context.db.createStrict('messaging_job_dispatches', { id, scope_id: job.scope_id, job_id: job.id, generation, workflow_id: workflowId, created_at: Date.now() });
    return { bound: true };
  });
}
