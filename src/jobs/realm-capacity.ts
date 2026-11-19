/** Transactional working occupancy, independent of permanent Jobs history. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import type { Row } from '../sync/types';
import { JobsError } from './error';
import type { JobOccurrenceRow, JobScheduleRow } from './model';
import { jobInteger } from './validation';
import { initializeJobScheduleSettlement, refreshJobScheduleSettlement, initializeJobOccurrenceSettlement, refreshJobOccurrenceSettlement } from './settlement-model';

export const JOB_WORK_LIMITS = Object.freeze({ schedules: 10_000, schedulesPerSource: 1_000, occurrences: 100_000 });
export const jobWorkSourceKey = (sourceId: string): string => 'source:' + sourceId;
type WorkRow = Row & { id: string; scope_id: string; source_id: string | null; open_occurrences: number; occupied: number };
const open = (state: JobOccurrenceRow['state']) => state === 'pending' || state === 'claimed' || state === 'dispatched' || state === 'blocked';

function integer(input: unknown): number { try { return jobInteger(input); } catch { throw new JobsError('JOBS_STATE_INVALID'); } }
function usage(context: DatabaseWriteCommandContext, id: string, delta: number, limit: number): void {
  const row = context.db.get('_jobs_work_usage', id);
  if (!row) throw new JobsError('JOBS_STATE_INVALID');
  const count = integer(row.count), next = count + delta;
  if (!Number.isSafeInteger(next) || next < 0) throw new JobsError('JOBS_STATE_INVALID');
  if (delta > 0 && next > limit) throw new JobsError('JOBS_CAPACITY');
  if (delta) context.db.update('_jobs_work_usage', id, { count: next });
}
/** Only a newly registered source may establish its zero working bucket. */
export function initializeJobSourceWork(context: DatabaseWriteCommandContext, sourceId: string): void {
  const id = jobWorkSourceKey(sourceId);
  if (context.db.get('_jobs_work_usage', id)) throw new JobsError('JOBS_STATE_INVALID');
  context.db.createStrict('_jobs_work_usage', { id, count: 0 });
}
/** Called after the new schedule/admission/cursor exist in the same transaction. */
export function initializeJobScheduleWork(context: DatabaseWriteCommandContext, schedule: JobScheduleRow): void {
  if (context.db.get('_jobs_schedule_work', schedule.id)) throw new JobsError('JOBS_STATE_INVALID');
  const cursor = context.db.get('_jobs_cursors', schedule.id);
  if (!cursor || cursor.scope_id !== schedule.scope_id || cursor.next_due_at === null) throw new JobsError('JOBS_STATE_INVALID');
  usage(context, 'schedules', 1, JOB_WORK_LIMITS.schedules);
  if (schedule.source_id) usage(context, jobWorkSourceKey(schedule.source_id), 1, JOB_WORK_LIMITS.schedulesPerSource);
  context.db.createStrict('_jobs_schedule_work', { id: schedule.id, scope_id: schedule.scope_id,
    source_id: schedule.source_id ?? null, open_occurrences: 0, occupied: 1 });
  initializeJobScheduleSettlement(context, schedule.id);
}
/** No retained-history scan: the aggregate includes unresolved occurrences from
 * ALL generations. Closure never asserts physical/provider completion.
 */
export function refreshJobScheduleWork(context: DatabaseWriteCommandContext, scheduleId: string, occurrenceDelta = 0): void {
  const schedule = context.db.get('job_schedules', scheduleId) as JobScheduleRow | null;
  const cursor = context.db.get('_jobs_cursors', scheduleId);
  const row = context.db.get('_jobs_schedule_work', scheduleId) as WorkRow | null;
  if (!schedule || !cursor || !row || cursor.scope_id !== schedule.scope_id || row.scope_id !== schedule.scope_id
    || row.source_id !== (schedule.source_id ?? null) || row.occupied !== 0 && row.occupied !== 1) throw new JobsError('JOBS_STATE_INVALID');
  const previous = integer(row.open_occurrences), count = previous + occurrenceDelta;
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(occurrenceDelta)) throw new JobsError('JOBS_STATE_INVALID');
  // A closed membership with unresolved work is corrupt, not free capacity.
  if (!row.occupied && previous > 0) throw new JobsError('JOBS_STATE_INVALID');
  const occupied = cursor.next_due_at !== null || count > 0 ? 1 : 0, delta = occupied - row.occupied;
  usage(context, 'occurrences', occurrenceDelta, JOB_WORK_LIMITS.occurrences);
  usage(context, 'schedules', delta, JOB_WORK_LIMITS.schedules);
  if (row.source_id) usage(context, jobWorkSourceKey(row.source_id), delta, JOB_WORK_LIMITS.schedulesPerSource);
  if (count !== previous || occupied !== row.occupied) context.db.update('_jobs_schedule_work', row.id, { open_occurrences: count, occupied });
  refreshJobScheduleSettlement(context, scheduleId);
}
/** Charge only newly materialized unresolved work; known superseded history is retained but not live. */
export function recordJobOccurrenceWork(context: DatabaseWriteCommandContext, occurrence: JobOccurrenceRow): void {
  refreshJobScheduleWork(context, occurrence.schedule_id, open(occurrence.state) ? 1 : 0);
  initializeJobOccurrenceSettlement(context, occurrence.id);
}
/** Call only after the canonical transition accepted. Replays that did not
 * update an occurrence must not repeat this state delta.
 */
export function changeJobOccurrenceWork(context: DatabaseWriteCommandContext, previous: JobOccurrenceRow, state: JobOccurrenceRow['state']): void {
  refreshJobScheduleWork(context, previous.schedule_id, Number(open(state)) - Number(open(previous.state)));
  refreshJobOccurrenceSettlement(context, previous.id);
}
