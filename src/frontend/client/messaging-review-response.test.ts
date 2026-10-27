/** Closed review transport validation; no real drafts, identities or provider data. */
import { expect, test } from 'bun:test';
import { assertMessagingReviewDetail, assertMessagingReviewItem, assertMessagingReviewResolution } from './messaging-review-response';
const item = { id: 'job-one', conversationId: 'thread-one', kind: 'assistant', attempts: 1, reason: 'INVOCATION_UNKNOWN', createdAt: 1, updatedAt: 2 };
test('review accepts bounded known facts and rejects invented replacement outcomes or malformed attempt history', () => {
  expect(() => assertMessagingReviewItem(item)).not.toThrow();
  const resolution = { id: 'resolution-one', jobId: item.id, action: 'retry', replacementJobId: 'job-two' };
  expect(() => assertMessagingReviewResolution(resolution)).not.toThrow();
  expect(() => assertMessagingReviewResolution({ ...resolution, replacementJobId: null })).toThrow();
  expect(() => assertMessagingReviewResolution({ ...resolution, action: 'dismiss' })).toThrow();
  const detail = { ...item, draftText: 'Synthetic retained draft', history: [{ outcome: 'unknown', startedAt: 1, finishedAt: 2, code: 'INTERRUPTED' }], historyTruncated: false, resolution };
  expect(() => assertMessagingReviewDetail(detail)).not.toThrow();
  for (const value of [{ ...detail, draftText: 'x'.repeat(20001) }, { ...detail, history: Array(26).fill(detail.history[0]) }, { ...detail, historyTruncated: 'false' }, { ...detail, reason: 'private arbitrary text' }]) expect(() => assertMessagingReviewDetail(value)).toThrow();
});
