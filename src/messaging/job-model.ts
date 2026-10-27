/** Private durable job facts. These rows and result bodies are never exposed through general Sync/workflow input/output. */
import type { Row, TableSchema } from '../sync/types';
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import { messagingFail, messagingHash, messagingId, messagingText } from './validation';
import type { ConversationRow, MessageRow } from './realm-model';

export type MessagingJobState = 'pending' | 'claimed' | 'calling' | 'received' | 'accepted' | 'cancelled' | 'needs-review';
export type MessagingJobKind = 'assistant' | 'delivery' | 'notification';
export type MessagingJobRow = Row & { id: string; scope_id: string; conversation_id: string; message_id: string; kind: MessagingJobKind;
  owner_epoch: number; context_revision: number; policy_hash: string | null; assistant_id?: string | null; dispatch_generation: number; state: MessagingJobState;
  lease_nonce: string | null; lease_expires: number | null; attempts: number; provider_id: string | null; error_code: string | null; created_at: number; updated_at: number };
export type JobConversation = ConversationRow & { customer_turn_id: string | null; context_revision: number };
export const MESSAGING_JOB_TABLES: Record<string, TableSchema> = {
  messaging_job_results: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', text: 'TEXT NOT NULL', provider_id: 'TEXT', received_at: 'INTEGER NOT NULL' },
  messaging_job_attempts: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', job_id: 'TEXT NOT NULL', nonce: 'TEXT NOT NULL', outcome: 'TEXT NOT NULL', started_at: 'INTEGER NOT NULL', finished_at: 'INTEGER', error_code: 'TEXT', provider_id: 'TEXT' },
  messaging_job_dispatches: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', job_id: 'TEXT NOT NULL', generation: 'INTEGER NOT NULL', workflow_id: 'TEXT NOT NULL', created_at: 'INTEGER NOT NULL' },
};
export const TERMINAL_MESSAGING_JOBS = new Set<MessagingJobState>(['accepted', 'cancelled', 'needs-review']);
export function jobScope(value: unknown): string {
  const scope = messagingText(value, 263), tenant = scope.startsWith('tenant:') ? scope.slice(7) : '';
  if (scope !== 'application' && (!tenant || tenant.length > 256 || tenant.trim() !== tenant || /\p{Cc}/u.test(tenant))) messagingFail('MESSAGING_FORBIDDEN', 403);
  return scope;
}
export function jobInScope({ db }: DatabaseWriteCommandContext, id: unknown, scope: unknown): MessagingJobRow {
  const row = db.get('messaging_jobs', messagingId(id)) as MessagingJobRow | null;
  if (!row || row.scope_id !== jobScope(scope)) messagingFail('MESSAGING_NOT_FOUND', 404);
  return row;
}
export function liveAssistantTurn(job: MessagingJobRow, conversation: JobConversation | null, message: MessageRow | null): boolean {
  return !!conversation && conversation.scope_id === job.scope_id && ['support', 'assistant'].includes(conversation.kind) && !conversation.archived && conversation.owner === 'assistant'
    && (conversation.assistant_id ?? 'default') === (job.assistant_id ?? 'default')
    && conversation.owner_epoch === job.owner_epoch && conversation.context_revision === job.context_revision && conversation.customer_turn_id === job.message_id
    && !!message && message.scope_id === job.scope_id && message.conversation_id === conversation.id && message.visibility === 'conversation' && !message.deleted;
}
export function currentAssistantTurn(context: DatabaseWriteCommandContext, job: MessagingJobRow): boolean {
  return liveAssistantTurn(job, context.db.get('messaging_conversations', job.conversation_id) as JobConversation | null, context.db.get('messaging_messages', job.message_id) as MessageRow | null);
}
export function jobAttemptId(job: MessagingJobRow, nonce: string): string { return messagingHash([job.id, nonce]); }
/** Terminal attempt facts are not rewritten when an operator elects to create a later attempt. */
export function finishJobAttempt(context: DatabaseWriteCommandContext, job: MessagingJobRow, outcome: 'completed' | 'unknown' | 'cancelled', code: string | null, providerId: string | null = null): void {
  if (!job.lease_nonce) return;
  const id = jobAttemptId(job, job.lease_nonce), row = context.db.get('messaging_job_attempts', id);
  if (row && row.finished_at === null) context.db.update('messaging_job_attempts', id, { outcome, error_code: code, provider_id: providerId, finished_at: Date.now() });
}
export function terminalJob(context: DatabaseWriteCommandContext, job: MessagingJobRow, state: 'cancelled' | 'needs-review', code: string): { state: MessagingJobState } {
  finishJobAttempt(context, job, job.state === 'calling' ? 'unknown' : 'cancelled', code);
  context.db.update('messaging_jobs', job.id, { state, error_code: code, lease_nonce: null, lease_expires: null, updated_at: Date.now() });
  if (state === 'needs-review' && job.kind === 'assistant' && currentAssistantTurn(context, job)) {
    const conversation = context.db.get('messaging_conversations', job.conversation_id) as JobConversation;
    if (conversation.owner_epoch < Number.MAX_SAFE_INTEGER - 2 && conversation.revision < Number.MAX_SAFE_INTEGER - 2) context.db.update('messaging_conversations', conversation.id,
      { owner: conversation.kind === 'assistant' ? 'assistant' : 'triage', owner_id: null, owner_epoch: conversation.owner_epoch + 1, revision: conversation.revision + 1, updated_at: Date.now(), public_updated_at: Date.now() });
  }
  return { state };
}
