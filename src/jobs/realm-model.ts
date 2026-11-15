/** Actor-local admission helpers. Inputs here come from the admitted server broker, never directly from HTTP. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import type { DatabaseFindFilter } from '../databases/database-operations';
import { JobsError } from './error';
import { jobAdmissionDigest, jobAdmissionId, normalizeJobAdmission, type JobAdmission, type JobAdmissionRow, type JobScheduleRow, type JobSeal } from './model';
import { jobHash, jobInteger, jobJson, jobKey, jobRecord, jobScope, jobText } from './validation';
export { jobScope } from './validation';

export interface JobActor { readonly scopeId: string; readonly userId: string; readonly principal: string; readonly manageAll: boolean }
export interface JobScheduleView {
  readonly id: string; readonly definition: string; readonly definitionVersion: string; readonly ownerId: string;
  readonly runAs: 'actor' | 'service'; readonly control: JobScheduleRow['control']; readonly revision: number;
  readonly generation: number; readonly createdAt: number; readonly updatedAt: number;
}
// Permanent receipts are capacity bounded, not silently expired/recycled. Exhaustion stops new admission.
export const JOB_LIMITS = Object.freeze({ schedules: 10_000, schedulesPerOwner: 1_000, intents: 100_000, occurrences: 100_000 });
export const eq = (field: string, value: string | number): DatabaseFindFilter => ({ type: 'field', field, operator: 'eq', value });
export const oneOf = (field: string, value: string[]): DatabaseFindFilter => ({ type: 'field', field, operator: 'in', value });

export function jobActor(input: unknown): JobActor {
  const r = jobRecord(input, ['scopeId', 'userId', 'principal', 'manageAll']);
  if (typeof r.manageAll !== 'boolean') throw new JobsError('JOBS_INPUT_INVALID');
  return Object.freeze({ scopeId: jobScope(r.scopeId), userId: jobText(r.userId, 128), principal: jobText(r.principal, 256), manageAll: r.manageAll });
}
export function assertJobOwner(context: DatabaseWriteCommandContext, scopeId: string): void {
  const owner = context.db.get('_jobs_owner', 'application');
  if (!owner || owner.scope_id !== scopeId) throw new JobsError('JOBS_STATE_INVALID');
}
export function ownedJob(context: DatabaseWriteCommandContext, actor: JobActor, id: unknown): JobScheduleRow {
  assertJobOwner(context, actor.scopeId);
  const row = context.db.get('job_schedules', jobText(id, 96)) as JobScheduleRow | null;
  // Do not disclose another scope/owner's existence.
  if (!row || row.scope_id !== actor.scopeId || !actor.manageAll && row.actor_id !== actor.userId) throw new JobsError('JOBS_NOT_FOUND');
  return row;
}
export function readJobAdmission(context: DatabaseWriteCommandContext, row: JobScheduleRow): JobAdmissionRow {
  const admission = context.db.get('_jobs_admissions', jobAdmissionId(row.id, row.generation)) as JobAdmissionRow | null;
  if (!admission || admission.scope_id !== row.scope_id || admission.schedule_id !== row.id || admission.generation !== row.generation) throw new JobsError('JOBS_STATE_INVALID');
  return admission;
}
export function decodeJobAdmission(row: JobAdmissionRow): JobAdmission {
  let value: JobAdmission;
  try { value = normalizeJobAdmission(JSON.parse(row.command_json)); } catch { throw new JobsError('JOBS_STATE_INVALID'); }
  if (jobAdmissionDigest(value) !== row.digest || value.id !== row.schedule_id || value.scopeId !== row.scope_id) throw new JobsError('JOBS_STATE_INVALID');
  return value;
}
export function normalizeJobSeal(input: unknown): JobSeal {
  const r = jobRecord(input, ['authorityJson', 'authorityMac']);
  // Cryptographic verification belongs to the existing trusted Torrent authority store, not this SQL actor.
  return Object.freeze({ authorityJson: jobText(r.authorityJson, 32 * 1024), authorityMac: jobText(r.authorityMac, 256) });
}
export function insertJobAdmission(context: DatabaseWriteCommandContext, admission: JobAdmission, generation: number, seal: JobSeal): void {
  context.db.createStrict('_jobs_admissions', { id: jobAdmissionId(admission.id, generation), scope_id: admission.scopeId,
    schedule_id: admission.id, generation, command_json: jobJson(admission), digest: jobAdmissionDigest(admission),
    authority_json: seal.authorityJson, authority_mac: seal.authorityMac });
}
export function scheduleView(row: JobScheduleRow): JobScheduleView {
  return { id: row.id, definition: row.definition_name, definitionVersion: row.definition_version, ownerId: row.actor_id,
    runAs: row.run_as, control: row.control, revision: row.revision, generation: row.generation, createdAt: row.created_at, updatedAt: row.updated_at };
}
export function jobBudget(context: DatabaseWriteCommandContext, id: string, limit: number, amount = 1): void {
  const row = context.db.get('_jobs_usage', id);
  const count = row ? jobInteger(row.count) : 0;
  if (count > limit - amount) throw new JobsError('JOBS_CAPACITY');
  if (row) context.db.update('_jobs_usage', id, { count: count + amount });
  else context.db.createStrict('_jobs_usage', { id, count: amount });
}
export function jobIntent<T>(context: DatabaseWriteCommandContext, actor: JobActor, requestId: unknown, intent: unknown, now: number, run: () => T): T {
  const id = jobHash([actor.scopeId, actor.principal, jobKey(requestId)]), digest = jobHash(intent), prior = context.db.get('_jobs_intents', id);
  if (prior) {
    if (prior.scope_id !== actor.scopeId || prior.principal !== actor.principal || prior.digest !== digest) throw new JobsError('JOBS_INTENT_CONFLICT');
    try { return JSON.parse(String(prior.result_json)) as T; } catch { throw new JobsError('JOBS_STATE_INVALID'); }
  }
  jobBudget(context, 'intents', JOB_LIMITS.intents);
  const value = run(), json = jobJson(value);
  context.db.createStrict('_jobs_intents', { id, scope_id: actor.scopeId, principal: actor.principal, digest, result_json: json, created_at: now });
  return JSON.parse(json) as T;
}
export function jobRevision(row: JobScheduleRow, expected: unknown): void {
  if (row.revision !== jobInteger(expected, 1)) throw new JobsError('JOBS_REVISION_CONFLICT');
}
export function nextJobInteger(value: number): number { return jobInteger(value, 0, Number.MAX_SAFE_INTEGER - 1) + 1; }
