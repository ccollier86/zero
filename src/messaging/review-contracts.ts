/** Browser-safe operator-review records. Reading a record still requires current canonical staff membership. */
import type { MessagingMutationOptions, MessagingPage, MessagingReadOptions } from './contracts';
export interface MessagingReviewItem {
  readonly id: string; readonly conversationId: string; readonly kind: 'assistant' | 'delivery' | 'notification';
  readonly attempts: number; readonly reason: string | null; readonly createdAt: number; readonly updatedAt: number;
}
export interface MessagingReviewResolution {
  readonly id: string; readonly jobId: string; readonly action: 'dismiss' | 'retry'; readonly replacementJobId: string | null;
}
export interface MessagingReviewDetail extends MessagingReviewItem {
  readonly draftText: string | null;
  readonly history: readonly { readonly outcome: string; readonly startedAt: number; readonly finishedAt: number | null; readonly code: string | null }[];
  readonly historyTruncated: boolean;
  readonly resolution: MessagingReviewResolution | null;
}
export interface MessagingReviewApi {
  list(conversationId: string, query?: { readonly after?: string; readonly limit?: number }, options?: MessagingReadOptions): Promise<MessagingPage<MessagingReviewItem>>;
  get(conversationId: string, jobId: string, options?: MessagingReadOptions): Promise<MessagingReviewDetail>;
  /** Requires the current human owner and explicit acknowledgment; creates new work without rewriting the old failure/attempt. */
  retry(conversationId: string, jobId: string, expectedOwnerEpoch: number, acknowledgePossibleDuplicate: true, options: MessagingMutationOptions): Promise<MessagingReviewResolution>;
  dismiss(conversationId: string, jobId: string, expectedOwnerEpoch: number, options: MessagingMutationOptions): Promise<MessagingReviewResolution>;
}
