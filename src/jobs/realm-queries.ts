/** Read-only projections. Private dispatch queries are broker-only and must never be published as general client data. */
import type { DatabaseReadQueryContext } from '../databases/database-realm';
import { JobsError } from './error';
import type { JobAdmissionRow, JobOccurrenceRow, JobScheduleRow } from './model';
import { digest, jobAdmissionId } from './model';
import { decodeJobAdmission, isActorJobSchedule, jobActor, jobScope, scheduleView, type JobActor, type ActorJobScheduleRow } from './realm-model';
import { activeJobOccurrence, jobBlockedCode, jobOccurrenceView, JOB_OCCURRENCE_VIEW_COLUMNS, type JobOccurrenceProjectionRow, type JobScheduleReadSummary } from './operator-views';
import { jobHash, jobInteger, jobKey, jobRecord, jobText, jobTime } from './validation';

function owner(context: DatabaseReadQueryContext, scope: string): void {
  const row = context.database.query<{ scope_id: string }>("SELECT scope_id FROM _jobs_owner WHERE id='application'").get();
  if (!row || row.scope_id !== scope) throw new JobsError('JOBS_STATE_INVALID');
}
function readSchedule(context: DatabaseReadQueryContext, actor: JobActor, id: unknown): ActorJobScheduleRow {
  owner(context, actor.scopeId);
  const row = context.database.query<JobScheduleRow>('SELECT * FROM job_schedules WHERE id=? AND scope_id=?').get(jobText(id, 96), actor.scopeId);
  if (!row || !isActorJobSchedule(row) || !actor.manageAll && row.actor_id !== actor.userId) throw new JobsError('JOBS_NOT_FOUND');
  return row;
}
export function readJobSchedule(context: DatabaseReadQueryContext, input: unknown) {
  const r = jobRecord(input, ['actor', 'id']), actor = jobActor(r.actor), row = readSchedule(context, actor, r.id);
  const admission = context.database.query<JobAdmissionRow>('SELECT * FROM _jobs_admissions WHERE id=? AND scope_id=?').get(jobAdmissionId(row.id, row.generation), actor.scopeId);
  if (!admission) throw new JobsError('JOBS_STATE_INVALID');
  const admitted = decodeJobAdmission(admission);
  return { ...readJobScheduleSummary(context, row), timing: admitted.timing, overlap: admitted.overlap };
}
export function listJobSchedules(context: DatabaseReadQueryContext, input: unknown) {
  const r = jobRecord(input, ['actor', 'limit', 'offset', 'control']), actor = jobActor(r.actor), limit = jobInteger(r.limit ?? 25, 1, 100), offset = jobInteger(r.offset ?? 0, 0, 10_000);
  owner(context, actor.scopeId);
  if (r.control !== undefined && !['active', 'paused', 'cancelled'].includes(r.control as string)) throw new JobsError('JOBS_INPUT_INVALID');
  const where = 'scope_id=? AND actor_id IS NOT NULL' + (actor.manageAll ? '' : ' AND actor_id=?') + (r.control === undefined ? '' : ' AND control=?');
  const params = [actor.scopeId, ...(actor.manageAll ? [] : [actor.userId]), ...(r.control === undefined ? [] : [String(r.control)])];
  const total = context.database.query<{ n: number }>('SELECT count(*) AS n FROM job_schedules WHERE ' + where).get(...params)!.n;
  const rows = context.database.query<JobScheduleRow>('SELECT * FROM job_schedules WHERE ' + where + ' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').all(...params, limit, offset);
  return { items: rows.map(row => readJobScheduleSummary(context, row)), total };
}
/** One native query request, at most four indexed point/range probes per bounded page row. No occurrence history count. */
function readJobScheduleSummary(context: DatabaseReadQueryContext, row: JobScheduleRow): JobScheduleReadSummary {
  const cursor = context.database.query<{ next_due_at: number | null; skipped: number; blocked_code: string | null }>(
    'SELECT next_due_at,skipped,blocked_code FROM _jobs_cursors WHERE id=? AND scope_id=?').get(row.id, row.scope_id);
  if (!cursor) throw new JobsError('JOBS_STATE_INVALID');
  const latest = context.database.query<JobOccurrenceProjectionRow>('SELECT ' + JOB_OCCURRENCE_VIEW_COLUMNS +
    ' FROM _jobs_occurrences WHERE scope_id=? AND schedule_id=? ORDER BY scheduled_at DESC,id DESC LIMIT 1').get(row.scope_id, row.id);
  const active = (state: 'claimed' | 'dispatched') => {
    // jobs_occurrence_overlap indexes (scope,schedule,state,generation,scheduled_at DESC).
    // Prefer an older active generation even when a newer generation has already queued work.
    const occurrence = context.database.query<JobOccurrenceProjectionRow>('SELECT ' + JOB_OCCURRENCE_VIEW_COLUMNS +
      ' FROM _jobs_occurrences WHERE scope_id=? AND schedule_id=? AND state=? ORDER BY generation,scheduled_at DESC LIMIT 1').get(row.scope_id, row.id, state);
    return occurrence ? jobOccurrenceView(occurrence) : null;
  };
  return { ...scheduleView(row), nextDueAt: cursor.next_due_at, skipped: cursor.skipped === 1, blockedCode: jobBlockedCode(cursor.blocked_code),
    latestOccurrence: latest ? jobOccurrenceView(latest) : null, activeOccurrence: activeJobOccurrence(active('claimed'), active('dispatched')) };
}
export function readJobIntent(context: DatabaseReadQueryContext, input: unknown) {
  const r = jobRecord(input, ['actor', 'requestId', 'intentDigest']), actor = jobActor(r.actor); owner(context, actor.scopeId);
  const id = jobHash([actor.scopeId, actor.principal, jobKey(r.requestId)]);
  const row = context.database.query<{ result_json: string; digest: string }>('SELECT result_json,digest FROM _jobs_intents WHERE id=? AND scope_id=? AND principal=?').get(id, actor.scopeId, actor.principal);
  if (!row) return null;
  if (r.intentDigest !== undefined && row.digest !== digest(r.intentDigest)) throw new JobsError('JOBS_INTENT_CONFLICT');
  let value: { id?: unknown }; try { value = JSON.parse(row.result_json); } catch { throw new JobsError('JOBS_STATE_INVALID'); }
  readSchedule(context, actor, value.id); return value;
}
/** Broker-only current admission needed for resume/edit/run-now; never public row data. */
export function readJobScheduleContext(context: DatabaseReadQueryContext, input: unknown) {
  const r = jobRecord(input, ['actor', 'id']), actor = jobActor(r.actor), row = readSchedule(context, actor, r.id);
  const admission = context.database.query<JobAdmissionRow>('SELECT * FROM _jobs_admissions WHERE id=? AND scope_id=?').get(jobAdmissionId(row.id, row.generation), actor.scopeId);
  if (!admission) throw new JobsError('JOBS_STATE_INVALID');
  return { schedule: row, admission: decodeJobAdmission(admission) };
}
export function dispatchedJobOccurrences(context: DatabaseReadQueryContext, input: unknown) {
  const r = jobRecord(input, ['scopeId', 'limit', 'after']), scope = jobScope(r.scopeId), limit = jobInteger(r.limit ?? 32, 1, 100); owner(context, scope);
  const after = r.after === undefined ? '' : jobText(r.after, 128);
  // Seek the live state even before SQLite has statistics. The existing index
  // still sorts live dispatched rows for this id cursor, but never scans retained terminal history.
  return context.database.query<{ id: string; schedule_id: string }>("SELECT id,schedule_id FROM _jobs_occurrences INDEXED BY jobs_occurrence_pending WHERE scope_id=? AND state='dispatched' AND id>? ORDER BY id LIMIT ?").all(scope, after, limit);
}
/** Conservative earliest wake; NULL means no future timer/pending/claim/run needs polling in this scope. */
export function readJobWake(context: DatabaseReadQueryContext, input: unknown) {
  const r = jobRecord(input, ['scopeId', 'now']), scope = jobScope(r.scopeId), now = jobTime(r.now); owner(context, scope);
  const due = context.database.query<{ at: number | null }>(`SELECT min(c.next_due_at) AS at FROM _jobs_cursors c JOIN job_schedules s ON s.id=c.id AND s.scope_id=c.scope_id
    WHERE c.scope_id=? AND c.blocked_code IS NULL AND s.control='active'`).get(scope)?.at ?? null;
  const claim = context.database.query<{ at: number | null }>("SELECT min(lease_until) AS at FROM _jobs_occurrences WHERE scope_id=? AND state='claimed'").get(scope)?.at ?? null;
  const dispatched = context.database.query<{ id: string }>("SELECT id FROM _jobs_occurrences WHERE scope_id=? AND state='dispatched' LIMIT 1").get(scope);
  // Unclaimed work from a stopped/replaced generation still needs a bounded
  // retirement pass. Otherwise it remains misleadingly pending forever.
  const pending = context.database.query<{ id: string }>("SELECT id FROM _jobs_occurrences WHERE scope_id=? AND state='pending' LIMIT 1").get(scope);
  const candidates = [due, claim, dispatched || pending ? now + 1000 : null].filter((at): at is number => at !== null);
  return candidates.length ? Math.min(...candidates) : null;
}
export function listJobOccurrences(context: DatabaseReadQueryContext, input: unknown) {
  const r = jobRecord(input, ['actor', 'id', 'limit', 'offset']), actor = jobActor(r.actor), row = readSchedule(context, actor, r.id);
  const limit = jobInteger(r.limit ?? 25, 1, 100), offset = jobInteger(r.offset ?? 0, 0, 100_000);
  const total = context.database.query<{ n: number }>('SELECT count(*) AS n FROM _jobs_occurrences WHERE scope_id=? AND schedule_id=?').get(actor.scopeId, row.id)!.n;
  const rows = context.database.query<JobOccurrenceProjectionRow>('SELECT ' + JOB_OCCURRENCE_VIEW_COLUMNS +
    ' FROM _jobs_occurrences WHERE scope_id=? AND schedule_id=? ORDER BY scheduled_at DESC,id DESC LIMIT ? OFFSET ?').all(actor.scopeId, row.id, limit, offset);
  return { items: rows.map(jobOccurrenceView), total };
}
export function dueJobSchedules(context: DatabaseReadQueryContext, input: unknown) {
  const r = jobRecord(input, ['scopeId', 'now', 'limit']), scope = jobScope(r.scopeId), now = jobTime(r.now), limit = jobInteger(r.limit ?? 32, 1, 100); owner(context, scope);
  return context.database.query<{ id: string; revision: number }>(`SELECT c.id,s.revision FROM _jobs_cursors c JOIN job_schedules s ON s.id=c.id AND s.scope_id=c.scope_id
    WHERE c.scope_id=? AND c.next_due_at<=? AND c.blocked_code IS NULL AND s.control='active' ORDER BY c.next_due_at,c.id LIMIT ?`).all(scope, now, limit);
}
export function pendingJobOccurrences(context: DatabaseReadQueryContext, input: unknown) {
  const r = jobRecord(input, ['scopeId', 'now', 'limit']), scope = jobScope(r.scopeId), now = jobTime(r.now), limit = jobInteger(r.limit ?? 32, 1, 100); owner(context, scope);
  // Claims whose handoff might have committed must be reconciled even when the
  // schedule is now paused/cancelled. Never-started stale pending rows are also
  // selected so the claim command can retire them without any Torrent handoff.
  // Separate indexed probes avoid the OR/CASE plan's scope-wide history scan
  // without relying on ANALYZE. Keep claimed-first scheduled_at/id fairness;
  // only expired claims need sorting, never future leases or terminal history.
  const claimed = context.database.query<{ id: string; schedule_id: string }>(`SELECT o.id,o.schedule_id FROM _jobs_occurrences o INDEXED BY jobs_occurrence_claims JOIN job_schedules s ON s.id=o.schedule_id AND s.scope_id=o.scope_id
    JOIN _jobs_admissions a ON a.id=o.admission_id AND a.scope_id=o.scope_id
    WHERE o.scope_id=? AND o.state='claimed' AND o.lease_until<=?
    ORDER BY o.scheduled_at,o.id LIMIT ?`).all(scope, now, limit);
  if (claimed.length === limit) return claimed;
  const pending = context.database.query<{ id: string; schedule_id: string }>(`SELECT o.id,o.schedule_id FROM _jobs_occurrences o INDEXED BY jobs_occurrence_pending JOIN job_schedules s ON s.id=o.schedule_id AND s.scope_id=o.scope_id
    JOIN _jobs_admissions a ON a.id=o.admission_id AND a.scope_id=o.scope_id
    WHERE o.scope_id=? AND o.state='pending' AND
      (s.control<>'active' OR s.generation<>o.generation OR
      json_extract(a.command_json,'$.overlap')<>'queue-one' OR NOT EXISTS(SELECT 1 FROM _jobs_occurrences active WHERE active.scope_id=o.scope_id AND active.schedule_id=o.schedule_id AND active.state IN ('claimed','dispatched')))
    ORDER BY o.scheduled_at,o.id LIMIT ?`).all(scope, limit - claimed.length);
  return claimed.concat(pending);
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
    dispatchAllowed: parent.control === 'active' && parent.generation === row.generation && now >= row.scheduled_at
      && now <= row.scheduled_at + admitted.timing.maxLatenessMs };
}
