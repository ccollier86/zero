/** Read-only projections. Private dispatch queries are broker-only and must never be published as general client data. */
import type { DatabaseReadQueryContext } from '../databases/database-realm';
import { JobsError } from './error';
import type { JobAdmissionRow, JobOccurrenceRow, JobScheduleRow } from './model';
import { jobAdmissionId } from './model';
import { decodeJobAdmission, jobActor, jobScope, scheduleView, type JobActor } from './realm-model';
import { jobHash, jobInteger, jobKey, jobRecord, jobText, jobTime } from './validation';

function owner(context: DatabaseReadQueryContext, scope: string): void {
  const row = context.database.query<{ scope_id: string }>("SELECT scope_id FROM _jobs_owner WHERE id='application'").get();
  if (!row || row.scope_id !== scope) throw new JobsError('JOBS_STATE_INVALID');
}
function readSchedule(context: DatabaseReadQueryContext, actor: JobActor, id: unknown): JobScheduleRow {
  owner(context, actor.scopeId);
  const row = context.database.query<JobScheduleRow>('SELECT * FROM job_schedules WHERE id=? AND scope_id=?').get(jobText(id, 96), actor.scopeId);
  if (!row || !actor.manageAll && row.actor_id !== actor.userId) throw new JobsError('JOBS_NOT_FOUND');
  return row;
}
export function readJobSchedule(context: DatabaseReadQueryContext, input: unknown) {
  const r = jobRecord(input, ['actor', 'id']), actor = jobActor(r.actor), row = readSchedule(context, actor, r.id);
  const admission = context.database.query<JobAdmissionRow>('SELECT * FROM _jobs_admissions WHERE id=? AND scope_id=?').get(jobAdmissionId(row.id, row.generation), actor.scopeId);
  const cursor = context.database.query<{ next_due_at: number | null; skipped: number; blocked_code: string | null }>('SELECT next_due_at,skipped,blocked_code FROM _jobs_cursors WHERE id=? AND scope_id=?').get(row.id, actor.scopeId);
  if (!admission || !cursor) throw new JobsError('JOBS_STATE_INVALID');
  const admitted = decodeJobAdmission(admission);
  return { ...scheduleView(row), timing: admitted.timing, overlap: admitted.overlap, nextDueAt: cursor.next_due_at,
    skipped: cursor.skipped === 1, blockedCode: cursor.blocked_code };
}
export function listJobSchedules(context: DatabaseReadQueryContext, input: unknown) {
  const r = jobRecord(input, ['actor', 'limit', 'offset', 'control']), actor = jobActor(r.actor), limit = jobInteger(r.limit ?? 25, 1, 100), offset = jobInteger(r.offset ?? 0, 0, 10_000);
  owner(context, actor.scopeId);
  if (r.control !== undefined && !['active', 'paused', 'cancelled'].includes(r.control as string)) throw new JobsError('JOBS_INPUT_INVALID');
  const where = 'scope_id=?' + (actor.manageAll ? '' : ' AND actor_id=?') + (r.control === undefined ? '' : ' AND control=?');
  const params = [actor.scopeId, ...(actor.manageAll ? [] : [actor.userId]), ...(r.control === undefined ? [] : [String(r.control)])];
  const total = context.database.query<{ n: number }>('SELECT count(*) AS n FROM job_schedules WHERE ' + where).get(...params)!.n;
  const rows = context.database.query<JobScheduleRow>('SELECT * FROM job_schedules WHERE ' + where + ' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').all(...params, limit, offset);
  return { items: rows.map(scheduleView), total };
}
export function readJobIntent(context: DatabaseReadQueryContext, input: unknown) {
  const r = jobRecord(input, ['actor', 'requestId']), actor = jobActor(r.actor); owner(context, actor.scopeId);
  const id = jobHash([actor.scopeId, actor.principal, jobKey(r.requestId)]);
  const row = context.database.query<{ result_json: string }>('SELECT result_json FROM _jobs_intents WHERE id=? AND scope_id=? AND principal=?').get(id, actor.scopeId, actor.principal);
  if (!row) return null;
  try { return JSON.parse(row.result_json); } catch { throw new JobsError('JOBS_STATE_INVALID'); }
}
export function listJobOccurrences(context: DatabaseReadQueryContext, input: unknown) {
  const r = jobRecord(input, ['actor', 'id', 'limit', 'offset']), actor = jobActor(r.actor), row = readSchedule(context, actor, r.id);
  const limit = jobInteger(r.limit ?? 25, 1, 100), offset = jobInteger(r.offset ?? 0, 0, 100_000);
  const total = context.database.query<{ n: number }>('SELECT count(*) AS n FROM _jobs_occurrences WHERE scope_id=? AND schedule_id=?').get(actor.scopeId, row.id)!.n;
  const rows = context.database.query<JobOccurrenceRow>('SELECT * FROM _jobs_occurrences WHERE scope_id=? AND schedule_id=? ORDER BY scheduled_at DESC,id DESC LIMIT ? OFFSET ?').all(actor.scopeId, row.id, limit, offset);
  return { items: rows.map(item => ({ id: item.id, generation: item.generation, scheduledAt: item.scheduled_at, state: item.state,
    workflowId: item.workflow_id, terminalStatus: item.terminal_status, errorCode: item.error_code,
    createdAt: item.created_at, updatedAt: item.updated_at })), total };
}
export function dueJobSchedules(context: DatabaseReadQueryContext, input: unknown) {
  const r = jobRecord(input, ['scopeId', 'now', 'limit']), scope = jobScope(r.scopeId), now = jobTime(r.now), limit = jobInteger(r.limit ?? 32, 1, 100); owner(context, scope);
  return context.database.query<{ id: string; revision: number }>(`SELECT c.id,s.revision FROM _jobs_cursors c JOIN job_schedules s ON s.id=c.id AND s.scope_id=c.scope_id
    WHERE c.scope_id=? AND c.next_due_at<=? AND c.blocked_code IS NULL AND s.control='active' ORDER BY c.next_due_at,c.id LIMIT ?`).all(scope, now, limit);
}
export function pendingJobOccurrences(context: DatabaseReadQueryContext, input: unknown) {
  const r = jobRecord(input, ['scopeId', 'now', 'limit']), scope = jobScope(r.scopeId), now = jobTime(r.now), limit = jobInteger(r.limit ?? 32, 1, 100); owner(context, scope);
  // Claims whose handoff might have committed must be reconciled even when the schedule is now paused/cancelled.
  return context.database.query<{ id: string; schedule_id: string }>(`SELECT o.id,o.schedule_id FROM _jobs_occurrences o JOIN job_schedules s ON s.id=o.schedule_id AND s.scope_id=o.scope_id
    JOIN _jobs_admissions a ON a.id=o.admission_id AND a.scope_id=o.scope_id
    WHERE o.scope_id=? AND ((o.state='claimed' AND o.lease_until<=?) OR (o.state='pending' AND s.control='active' AND s.generation=o.generation
      AND (json_extract(a.command_json,'$.overlap')<>'queue-one' OR NOT EXISTS(SELECT 1 FROM _jobs_occurrences active WHERE active.scope_id=o.scope_id AND active.schedule_id=o.schedule_id AND active.state IN ('claimed','dispatched')))))
    ORDER BY CASE o.state WHEN 'claimed' THEN 0 ELSE 1 END,o.scheduled_at,o.id LIMIT ?`).all(scope, now, limit);
}
export function readJobDispatchContext(context: DatabaseReadQueryContext, input: unknown) {
  const r = jobRecord(input, ['scopeId', 'id', 'now']), scope = jobScope(r.scopeId), now = jobTime(r.now); owner(context, scope);
  const row = context.database.query<JobOccurrenceRow>('SELECT * FROM _jobs_occurrences WHERE id=? AND scope_id=?').get(jobText(r.id, 128), scope);
  if (!row) throw new JobsError('JOBS_NOT_FOUND');
  const admission = context.database.query<JobAdmissionRow>('SELECT * FROM _jobs_admissions WHERE id=? AND scope_id=?').get(row.admission_id, scope);
  const parent = context.database.query<JobScheduleRow>('SELECT * FROM job_schedules WHERE id=? AND scope_id=?').get(row.schedule_id, scope);
  if (!admission || !parent) throw new JobsError('JOBS_STATE_INVALID');
  const admitted = decodeJobAdmission(admission);
  return { occurrence: row, admission: admitted, seal: { authorityJson: admission.authority_json, authorityMac: admission.authority_mac },
    dispatchAllowed: parent.control === 'active' && parent.generation === row.generation && now <= row.scheduled_at + admitted.timing.maxLatenessMs };
}
