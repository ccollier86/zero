/** Bounded worker-only reads. The execution's sealed scope, not workflow input, selects the private realm. */
import type { DatabaseReadQueryContext } from '../databases/database-realm';
import type { MessageRow } from './realm-model';
import { jobScope, liveAssistantTurn, type JobConversation, type MessagingJobRow } from './job-model';
import { messagingFail, messagingId, messagingInteger, messagingRecord } from './validation';

export function pendingMessagingJobs({ database }: DatabaseReadQueryContext, input: unknown): unknown {
  const r = messagingRecord(input, ['scopeId', 'after', 'limit']), scope = jobScope(r.scopeId), limit = messagingInteger(r.limit ?? 25, 1, 100);
  const after = r.after === undefined ? '' : messagingId(r.after);
  // A bounded index-leading page per state avoids sorting/scanning the full
  // retained accepted history to find a handful of live jobs.
  return ['pending', 'claimed', 'calling', 'received'].flatMap(state => database.query<MessagingJobRow & { workflow_id: string | null }>(
    "SELECT j.*,d.workflow_id FROM messaging_jobs j LEFT JOIN messaging_job_dispatches d ON d.id=j.id || ':' || j.dispatch_generation WHERE j.scope_id=? AND j.state=? AND j.id>? ORDER BY j.id LIMIT ?").all(scope, state, after, limit))
    .sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit);
}
export function readMessagingJobContext({ database }: DatabaseReadQueryContext, input: unknown): unknown {
  const r = messagingRecord(input, ['scopeId', 'id']), scope = jobScope(r.scopeId), id = messagingId(r.id);
  const job = database.query<MessagingJobRow>('SELECT * FROM messaging_jobs WHERE id=? AND scope_id=?').get(id, scope);
  if (!job) messagingFail('MESSAGING_NOT_FOUND', 404);
  const conversation = database.query<JobConversation>('SELECT * FROM messaging_conversations WHERE id=? AND scope_id=?').get(job.conversation_id, scope);
  const turn = database.query<MessageRow>('SELECT * FROM messaging_messages WHERE id=? AND scope_id=?').get(job.message_id, scope);
  const valid = job.kind !== 'assistant' || liveAssistantTurn(job, conversation, turn);
  const result = job.state === 'received' ? database.query<{ text: string; provider_id: string | null }>('SELECT text,provider_id FROM messaging_job_results WHERE id=? AND scope_id=?').get(id, scope) : null;
  // No staff notes, attachments, contact details or provider credentials enter
  // the default assistant context. A bounded recent public window is explicit.
  const rows = valid && job.kind === 'assistant' ? database.query<MessageRow>("SELECT * FROM messaging_messages WHERE conversation_id=? AND scope_id=? AND visibility='conversation' AND deleted=0 ORDER BY public_sequence DESC LIMIT 20").all(job.conversation_id, scope) : [];
  const messages: { role: 'assistant' | 'user'; content: string }[] = []; let bytes = 0;
  for (const row of rows) { const size = new TextEncoder().encode(row.text).byteLength; if (bytes + size > 128 * 1024) break; bytes += size;
    messages.push({ role: row.author_kind === 'assistant' ? 'assistant' : 'user', content: row.text }); }
  const visitor = conversation?.visitor_session_id ? database.query<{ policy_hash: string | null; expires_at: number; revoked: number }>('SELECT policy_hash,expires_at,revoked FROM messaging_sessions WHERE id=? AND scope_id=? AND conversation_id=?').get(conversation.visitor_session_id, scope, conversation.id) : null;
  return { job, valid, conversationKind: conversation?.kind ?? null, assistantId: job.assistant_id ?? 'default', customerId: turn?.author_id ?? null, customerKind: turn?.author_kind ?? null,
    supportEntryId: conversation?.support_entry_id ?? null, visitorPolicyHash: visitor?.policy_hash ?? null, visitorExpiresAt: visitor && !visitor.revoked ? visitor.expires_at : null,
    messages: messages.reverse(), result, attachmentOnly: !!turn && !turn.text.trim() && JSON.parse(turn.attachment_ids).length > 0 };
}
