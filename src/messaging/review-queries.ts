/** Indexed operator-only review reads. Scope and staff conversation membership precede private drafts or attempt history. */
import type { DatabaseReadQueryContext } from '../databases/database-realm';
import { captureMessagingActor, canReviewMessagingConversation } from './realm-model';
import { readMessagingMembership } from './realm-queries';
import { messagingFail, messagingId, messagingInteger, messagingRecord } from './validation';
import type { MessagingJobRow } from './job-model';
import { projectMessagingReview } from './review-model';
import type { MessagingReviewResolution } from './review-contracts';

export function listMessagingReviews({ database }: DatabaseReadQueryContext, input: unknown): unknown {
  const r = messagingRecord(input, ['actor', 'conversationId', 'query']), actor = captureMessagingActor(r.actor);
  const { conversation, member } = readMessagingMembership(database, actor, messagingId(r.conversationId));
  if (!canReviewMessagingConversation(actor, conversation, member)) messagingFail('MESSAGING_FORBIDDEN', 403);
  const q = messagingRecord(r.query ?? {}, ['after', 'limit']), after = q.after === undefined ? '' : messagingId(q.after), limit = messagingInteger(q.limit ?? 25, 1, 50);
  const rows = database.query<MessagingJobRow>("SELECT j.* FROM messaging_jobs j WHERE j.scope_id=? AND j.conversation_id=? AND j.state='needs-review' AND j.id>? AND NOT EXISTS(SELECT 1 FROM messaging_job_resolutions r WHERE r.job_id=j.id) ORDER BY j.id LIMIT ?").all(actor.scopeId, conversation.id, after, limit + 1);
  const items = rows.slice(0, limit).map(projectMessagingReview);
  return { items, hasMore: rows.length > limit, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
}
export function readMessagingReview({ database }: DatabaseReadQueryContext, input: unknown): unknown {
  const r = messagingRecord(input, ['actor', 'conversationId', 'id']), actor = captureMessagingActor(r.actor);
  const { conversation, member } = readMessagingMembership(database, actor, messagingId(r.conversationId));
  if (!canReviewMessagingConversation(actor, conversation, member)) messagingFail('MESSAGING_FORBIDDEN', 403);
  const job = database.query<MessagingJobRow>("SELECT * FROM messaging_jobs WHERE id=? AND scope_id=? AND conversation_id=? AND state='needs-review'").get(messagingId(r.id), actor.scopeId, conversation.id);
  if (!job) messagingFail('MESSAGING_NOT_FOUND', 404);
  const result = database.query<{ text: string }>('SELECT text FROM messaging_job_results WHERE id=? AND scope_id=?').get(job.id, actor.scopeId);
  const rows = database.query<{ outcome: string; started_at: number; finished_at: number | null; error_code: string | null }>('SELECT outcome,started_at,finished_at,error_code FROM messaging_job_attempts WHERE scope_id=? AND job_id=? ORDER BY started_at DESC,id LIMIT 26').all(actor.scopeId, job.id);
  const resolution = database.query<MessagingReviewResolution>('SELECT id,job_id AS jobId,action,replacement_job_id AS replacementJobId FROM messaging_job_resolutions WHERE job_id=? AND scope_id=?').get(job.id, actor.scopeId);
  return { ...projectMessagingReview(job), draftText: result?.text ?? null, history: rows.slice(0, 25).map(row => ({ outcome: row.outcome, startedAt: row.started_at, finishedAt: row.finished_at, code: row.error_code })), historyTruncated: rows.length > 25, resolution };
}
