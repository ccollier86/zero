/** Safe operator projections. Nothing here admits work, reads a payload or exposes a claim/authority handle. */
import type { JobBlockedCode, JobOccurrenceView, JobScheduleDetail, JobScheduleSummary } from './contracts';
import { JobsError } from './error';
import type { JobOccurrenceRow } from './model';

/** Private actor reads are decorated with live request-owned action policy only in the admitted broker. */
export type JobScheduleReadSummary = Omit<JobScheduleSummary, 'actions'>;
export type JobScheduleReadDetail = Omit<JobScheduleDetail, 'actions'>;
export type JobOccurrenceProjectionRow = Pick<JobOccurrenceRow,
  'id' | 'generation' | 'scheduled_at' | 'state' | 'workflow_id' | 'terminal_status' | 'error_code' | 'created_at' | 'updated_at'>;
export const JOB_OCCURRENCE_VIEW_COLUMNS = 'id,generation,scheduled_at,state,workflow_id,terminal_status,error_code,created_at,updated_at';

export function jobBlockedCode(value: string | null): JobBlockedCode | null {
  if (value === null || value === 'JOBS_CAPACITY' || value === 'JOBS_AUTHORITY_RETIRED' || value === 'JOBS_DEFINITION_UNAVAILABLE') return value;
  throw new JobsError('JOBS_STATE_INVALID');
}
export function jobOccurrenceView(row: JobOccurrenceProjectionRow): JobOccurrenceView {
  if (row.error_code !== null && !['JOBS_NOT_DISPATCHED', 'JOBS_CAPACITY', 'JOBS_AUTHORITY_RETIRED', 'JOBS_DEFINITION_UNAVAILABLE'].includes(row.error_code)
    || row.terminal_status !== null && !['superseded', 'expired', 'overlap-skipped', 'not-dispatched', 'completed', 'failed', 'cancelled'].includes(row.terminal_status)) throw new JobsError('JOBS_STATE_INVALID');
  return { id: row.id, generation: row.generation, scheduledAt: row.scheduled_at, state: row.state,
    workflowId: row.workflow_id, terminalStatus: row.terminal_status, errorCode: row.error_code, createdAt: row.created_at, updatedAt: row.updated_at };
}
/** Two indexed per-state candidates avoid sorting/scanning every active occurrence. Older generations remain visible. */
export function activeJobOccurrence(claimed: JobOccurrenceView | null, dispatched: JobOccurrenceView | null): JobOccurrenceView | null {
  if (!claimed) return dispatched;
  if (!dispatched) return claimed;
  if (claimed.generation !== dispatched.generation) return claimed.generation < dispatched.generation ? claimed : dispatched;
  if (claimed.scheduledAt !== dispatched.scheduledAt) return claimed.scheduledAt > dispatched.scheduledAt ? claimed : dispatched;
  return claimed.id < dispatched.id ? claimed : dispatched;
}
