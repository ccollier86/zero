/** Closed browser review projections. This is wire validation, not membership, ownership or duplicate-risk approval. */
const invalid = () => { throw new Error('Invalid messaging review response.'); };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
const id = (value: unknown) => { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value)) invalid(); };
const number = (value: unknown) => { if (!Number.isSafeInteger(value) || (value as number) < 0) invalid(); };
const code = (value: unknown) => { if (value !== null && (typeof value !== 'string' || !/^[A-Z][A-Z0-9_]{0,79}$/.test(value))) invalid(); };
export function assertMessagingReviewItem(value: unknown): void {
  const r = object(value); id(r.id); id(r.conversationId); number(r.attempts); number(r.createdAt); number(r.updatedAt); code(r.reason);
  if (!['assistant', 'delivery', 'notification'].includes(String(r.kind))) invalid();
}
export function assertMessagingReviewResolution(value: unknown): void {
  const r = object(value); id(r.id); id(r.jobId);
  if (!['retry', 'dismiss'].includes(String(r.action))) invalid();
  if (r.replacementJobId !== null) id(r.replacementJobId);
  if ((r.action === 'retry') !== (r.replacementJobId !== null)) invalid();
}
export function assertMessagingReviewDetail(value: unknown): void {
  assertMessagingReviewItem(value); const r = object(value);
  if (r.draftText !== null && (typeof r.draftText !== 'string' || r.draftText.length > 20000) || !Array.isArray(r.history) || r.history.length > 25 || typeof r.historyTruncated !== 'boolean') invalid();
  for (const item of r.history as unknown[]) {
    const entry = object(item); number(entry.startedAt); if (entry.finishedAt !== null) number(entry.finishedAt); code(entry.code);
    if (!['calling', 'completed', 'unknown', 'cancelled'].includes(String(entry.outcome))) invalid();
  }
  if (r.resolution !== null) assertMessagingReviewResolution(r.resolution);
}
