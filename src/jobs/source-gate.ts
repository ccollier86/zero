/** Private source/request mutation admission over the shared pool. Cancellation never proves a started writer rolled back. */
import type { WorkPool } from '../workers/work-pool';
import { JobsError } from './error';
import { DatabaseError } from '../databases/database-error';

interface SourceGateContext {
  readonly signal: AbortSignal;
  /** Call immediately before invoking the separate-file writer, not before read-only preparation. */
  markWriteAttempted(): void;
}
interface SourceGateOptions { readonly key: string; readonly signal: AbortSignal }

/** Only native typed errors can prove non-acceptance; an authored outcome property cannot. */
export function isKnownJobMutationRejection(error: unknown): boolean {
  return error instanceof JobsError && error.outcome !== 'unknown'
    || error instanceof DatabaseError && (error.outcome === 'not-started' || error.outcome === 'not-committed');
}

export async function sourceGateMutation<T>(pool: WorkPool, work: (context: SourceGateContext) => T | PromiseLike<T>, options: SourceGateOptions): Promise<T> {
  let attempted = false, completed = false, executionSignal: AbortSignal | undefined;
  try {
    return await pool.run(async signal => {
      executionSignal = signal;
      const context = Object.freeze({ signal, markWriteAttempted() {
        // An active caller may already have observed cancellation while trusted
        // preparation was awaiting. It must not subsequently start a writer.
        signal.throwIfAborted(); attempted = true;
      } });
      try { return await work(context); }
      finally { completed = true; }
    }, options);
  } catch (error) {
    if (!attempted) throw error;
    // WorkPool rejects callers immediately on cancellation but retains the slot
    // until the physical callback settles. Its outer rejection is not a writer
    // result, even if the abort reason happens to be a known domain error.
    if (!completed || executionSignal?.aborted || options.signal.aborted) throw new JobsError('JOBS_OUTCOME_UNKNOWN');
    if (error instanceof JobsError || isKnownJobMutationRejection(error)) throw error;
    // A completed, unclassified throw after writer admission is not evidence of
    // rollback. Typed Jobs failures above retain their explicit outcome.
    throw new JobsError('JOBS_OUTCOME_UNKNOWN');
  }
}
