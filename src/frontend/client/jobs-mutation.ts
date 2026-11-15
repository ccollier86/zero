/** Static browser mutation failures. Preserve the original logical key, never provider messages/bodies or automatic retries. */
import { isJobsErrorCode, type JobOperationOutcome } from '../../jobs/failure-contract';

export class JobsMutationError extends Error {
  readonly requiresReconciliation: boolean;
  readonly requiresSameIdempotencyKey: boolean;
  constructor(
    readonly idempotencyKey: string,
    readonly outcome: JobOperationOutcome,
    readonly code: string | null,
    readonly status: number | null,
    readonly cancelled = false,
  ) {
    super(outcome === 'unknown' ? 'The job operation may have been accepted. Reconcile using the original request identity.' : 'The job operation was not accepted.');
    // Existing scope-aware consumers retire AbortErrors. Preserve that signal
    // while retaining the mutation's uncertainty for explicit reconciliation.
    this.name = cancelled ? 'AbortError' : 'JobsMutationError';
    this.requiresReconciliation = outcome === 'unknown';
    this.requiresSameIdempotencyKey = this.requiresReconciliation;
  }
}

export function jobMutationFailure(cause: unknown, key: string): JobsMutationError {
  const statusValue = own(cause, 'status');
  const status = Number.isInteger(statusValue) && Number(statusValue) >= 400 && Number(statusValue) <= 599 ? Number(statusValue) : null;
  const body = own(cause, 'body'), suppliedCode = own(body, 'code'), suppliedOutcome = own(body, 'outcome');
  const authRejection = status === 401 && (suppliedCode === 'UNAUTHORIZED' || suppliedCode === 'AUTH_UNAUTHORIZED')
    || status === 403 && (suppliedCode === 'FORBIDDEN' || suppliedCode === 'AUTH_FORBIDDEN');
  const admissionRejection = status === 428 && suppliedCode === 'LOGGING_ADMISSION_REQUIRED';
  const native = isJobsErrorCode(suppliedCode);
  const code = native || authRejection || admissionRejection ? String(suppliedCode) : null;
  const explicitlyUnknown = suppliedOutcome === 'unknown' || typeof suppliedCode === 'string' && /(?:OUTCOME_UNKNOWN|UNCERTAIN)$/.test(suppliedCode);
  const outcome: JobOperationOutcome = explicitlyUnknown ? 'unknown' : status !== null && native && suppliedCode !== 'JOBS_OUTCOME_UNKNOWN'
    && (suppliedOutcome === 'not-started' || suppliedOutcome === 'not-committed') ? suppliedOutcome
    : authRejection || admissionRejection ? 'not-started' : 'unknown';
  return new JobsMutationError(key, outcome, code, status, isCancellation(cause));
}
function isCancellation(value: unknown): boolean {
  try { return typeof DOMException !== 'undefined' && value instanceof DOMException && value.name === 'AbortError'; } catch { return false; }
}
function own(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; }
}
