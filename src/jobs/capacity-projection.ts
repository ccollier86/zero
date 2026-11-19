/** Compose the existing owner-proved row projection with the native writer facade. */
import type { DatabaseWriterAdmissionInspection } from '../databases/database-writer-admission';
import { JobsError } from './error';
import { normalizeJobsCapacityPolicy } from './capacity-policy';
import { jobInteger, jobRecord } from './validation';
import type { JobRetainedCapacity, JobSourceCapacity, JobSourceCapacityRows } from './source-model';
import type { DatabaseCoordinatorLease } from '../databases/database-coordinator-contract';

/** Shared native facade path: the caller has already proved the retained owner
 * on this exact acquired lease. Neither inspection nor original evidence reads
 * consume a new transport identity, even when ordinary headroom is exhausted.
 */
export async function inspectJobSourceCapacity(lease: DatabaseCoordinatorLease, rows: JobSourceCapacityRows, expectedPolicyFingerprint: string,
  guard: () => void, signal?: AbortSignal): Promise<JobSourceCapacity> {
  guard(); signal?.throwIfAborted();
  const inspect = lease.trustedWriter.inspectAdmission;
  if (!inspect) throw new JobsError('JOBS_NOT_READY');
  const projection = await inspect.call(lease.trustedWriter, signal ? { signal } : undefined);
  guard(); signal?.throwIfAborted();
  if (projection.policyFingerprint !== expectedPolicyFingerprint) throw new JobsError('JOBS_STATE_INVALID');
  return composeJobSourceCapacity(rows, projection);
}

export function composeJobSourceCapacity(rows: JobSourceCapacityRows, inspection: DatabaseWriterAdmissionInspection): JobSourceCapacity {
  try {
    const a = jobRecord(inspection.admission, ['keyLimit', 'hardKeyLimit', 'settlementUnits', 'ordinaryRemaining', 'settlementRemaining', 'deficit',
      'actorControlUnits', 'sourceControlUnits', 'actorRecoveryUsed', 'retained']);
    const p = normalizeJobsCapacityPolicy({ retained: a.retained, transport: { keyLimit: a.keyLimit } });
    if (!inspection.policyFingerprint || rows.version !== 2) throw new JobsError('JOBS_STATE_INVALID');
    const limit = (value: JobRetainedCapacity, maximum: number): JobRetainedCapacity => ({ used: value.used, limit: maximum, remaining: Math.max(0, maximum - value.used) });
    const file = rows.retained.file, r = p.retained;
    return { ...rows, version: 3, retained: { sourceSchedules: rows.retained.sourceSchedules, file: {
      schedules: limit(file.schedules, r.schedules), intents: limit(file.intents, r.intents), sourceRecoveryIntents: limit(file.sourceRecoveryIntents, r.sourceRecoveryIntents),
      occurrences: limit(file.occurrences, r.occurrences), sources: limit(file.sources, r.sources), sourcePolicies: limit(file.sourcePolicies, r.sourcePolicies),
      actorRecoveryIntents: limit({ used: jobInteger(a.actorRecoveryUsed), limit: 0, remaining: 0 }, r.actorRecoveryIntents),
    } }, transport: { policyFingerprint: inspection.policyFingerprint, permanentKeys: inspection.receipts.totalKeys,
      keyLimit: p.transport.keyLimit, hardKeyLimit: jobInteger(a.hardKeyLimit), settlementUnits: jobInteger(a.settlementUnits),
      ordinaryRemaining: jobInteger(a.ordinaryRemaining), settlementRemaining: jobInteger(a.settlementRemaining), deficit: jobInteger(a.deficit),
      actorControlUnits: jobInteger(a.actorControlUnits), sourceControlUnits: jobInteger(a.sourceControlUnits), retainedResults: inspection.receipts.retainedResults,
      expiredTombstones: inspection.receipts.expiredTombstones, retainedResultBytes: inspection.receipts.retainedResultBytes, retainedByteLimit: inspection.receipts.retainedByteLimit } };
  } catch { throw new JobsError('JOBS_STATE_INVALID'); }
}
