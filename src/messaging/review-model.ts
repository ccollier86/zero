/** Private resolution schema and safe metadata projection. Prior job and attempt outcomes are never overwritten. */
import type { TableSchema } from '../sync/types';
import type { MessagingJobRow } from './job-model';
import type { MessagingReviewItem } from './review-contracts';
export const MESSAGING_REVIEW_TABLES: Record<string, TableSchema> = {
  messaging_job_resolutions: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', conversation_id: 'TEXT NOT NULL', job_id: 'TEXT NOT NULL',
    actor_id: 'TEXT NOT NULL', action: 'TEXT NOT NULL', replacement_job_id: 'TEXT', created_at: 'INTEGER NOT NULL' },
};
export function projectMessagingReview(job: MessagingJobRow): MessagingReviewItem {
  return { id: job.id, conversationId: job.conversation_id, kind: job.kind, attempts: job.attempts, reason: job.error_code, createdAt: job.created_at, updatedAt: job.updated_at };
}
