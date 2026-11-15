/** Closed job failures: static messages only; uncertainty never implies rollback or automatic replay. */
import { AuthError } from '../auth/types';
import { DatabaseError } from '../databases/database-error';

// Append only: the ordinal is the private actor rejection discriminator.
export const JOBS_REJECTIONS = ['JOBS_INPUT_INVALID', 'JOBS_NOT_FOUND', 'JOBS_FORBIDDEN', 'JOBS_REVISION_CONFLICT',
  'JOBS_INTENT_CONFLICT', 'JOBS_CAPACITY', 'JOBS_STAGE_CONFLICT', 'JOBS_STATE_INVALID'] as const;
export type JobsErrorCode = typeof JOBS_REJECTIONS[number] | 'JOBS_NOT_READY' | 'JOBS_CONFIG_INVALID'
  | 'JOBS_DEFINITION_UNAVAILABLE' | 'JOBS_AUTHORITY_RETIRED' | 'JOBS_OUTCOME_UNKNOWN';
export class JobsError extends AuthError {
  readonly outcome: 'not-started' | 'not-committed' | 'unknown';
  constructor(code: JobsErrorCode, outcome: 'not-started' | 'not-committed' | 'unknown' = code === 'JOBS_OUTCOME_UNKNOWN' ? 'unknown' : 'not-started') {
    super(code === 'JOBS_OUTCOME_UNKNOWN'
      ? 'The job operation may have committed; reconcile using the original request identity.'
      : code === 'JOBS_NOT_READY' ? 'Job execution is not ready.' : 'The job request was not accepted.', code, statusFor(code));
    this.name = 'JobsError'; this.outcome = code === 'JOBS_OUTCOME_UNKNOWN' ? 'unknown' : outcome;
  }
}
function statusFor(code: JobsErrorCode): number {
  return code === 'JOBS_INPUT_INVALID' ? 422 : code === 'JOBS_NOT_FOUND' ? 404 : code === 'JOBS_FORBIDDEN' || code === 'JOBS_AUTHORITY_RETIRED' ? 403
    : code === 'JOBS_CAPACITY' ? 429 : code === 'JOBS_STATE_INVALID' || code === 'JOBS_CONFIG_INVALID' ? 500
    : code === 'JOBS_NOT_READY' || code === 'JOBS_OUTCOME_UNKNOWN' ? 503 : 409;
}
/** Throw through the actor transaction: returning an error envelope would commit prior writes. */
export function jobCommand<T>(run: () => T): { ok: true; value: T } {
  try { return { ok: true, value: run() }; }
  catch (error) {
    if (error instanceof JobsError) {
      const index = JOBS_REJECTIONS.indexOf(error.code as typeof JOBS_REJECTIONS[number]);
      if (index >= 0) throw new DatabaseError('DATABASE_CONFLICT', 'The job operation was rejected.',
        { outcome: 'not-committed', retryable: false, details: { domainCode: index + 1 } });
    }
    throw error;
  }
}
export function readJobRejection(error: unknown): JobsError | null {
  if (!(error instanceof DatabaseError) || error.code !== 'DATABASE_CONFLICT' || error.outcome !== 'not-committed') return null;
  const index = error.details.domainCode;
  return typeof index === 'number' && Number.isInteger(index) && index > 0 && index <= JOBS_REJECTIONS.length
    ? new JobsError(JOBS_REJECTIONS[index - 1]!, 'not-committed') : null;
}
