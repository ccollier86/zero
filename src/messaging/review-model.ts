/** Private resolution schema and safe metadata projection. Prior job and attempt outcomes are never overwritten. */
import type { TableSchema } from '../sync/types';
import type { MessagingJobRow } from './job-model';
import type { MessagingReviewItem } from './review-contracts';
import type { ConversationRow, MemberRow, MessageRow, MessagingActor } from './realm-model';
export const MESSAGING_REVIEW_TABLES: Record<string, TableSchema> = {
  messaging_job_resolutions: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', conversation_id: 'TEXT NOT NULL', job_id: 'TEXT NOT NULL',
    actor_id: 'TEXT NOT NULL', action: 'TEXT NOT NULL', replacement_job_id: 'TEXT', created_at: 'INTEGER NOT NULL' },
};
export function projectMessagingReview(job: MessagingJobRow): MessagingReviewItem {
  return { id: job.id, conversationId: job.conversation_id, kind: job.kind, attempts: job.attempts, reason: job.error_code, createdAt: job.created_at, updatedAt: job.updated_at };
}
export const peerMessagingReview = (conversation: ConversationRow): boolean => conversation.kind === 'direct' || conversation.kind === 'group';
/** Shared count/list/point-read predicate. A group owner is not every sender's operator. */
export function messagingReviewAudience(actor: MessagingActor, conversation: ConversationRow, member: MemberRow): { sql: string; values: (string | number)[] } {
  return peerMessagingReview(conversation) ? {
    sql: " AND j.kind='notification' AND EXISTS(SELECT 1 FROM messaging_messages m WHERE m.id=j.message_id AND m.scope_id=j.scope_id AND m.conversation_id=j.conversation_id AND m.author_id=? AND m.author_kind='user' AND m.visibility='conversation' AND m.public_sequence>=?)",
    values: [actor.id, member.history_from],
  } : { sql: '', values: [] };
}
/** The same sender/history boundary is repeated inside the canonical write transaction. */
export function canReviewMessagingPeerJob(actor: MessagingActor, conversation: ConversationRow, member: MemberRow, job: MessagingJobRow, source: MessageRow | null): boolean {
  return actor.kind === 'user' && peerMessagingReview(conversation) && job.kind === 'notification' && job.scope_id === actor.scopeId && job.conversation_id === conversation.id
    && !!source && source.id === job.message_id && source.scope_id === actor.scopeId && source.conversation_id === conversation.id && source.author_id === actor.id
    && source.author_kind === 'user' && source.visibility === 'conversation' && source.public_sequence !== null && source.public_sequence >= member.history_from;
}
