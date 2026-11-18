/** Trusted-broker-only source evidence. None of these private records are HTTP/client projections. */
import type { DatabaseReadQueryContext } from '../databases/database-realm';
import { JobsError } from './error';
import { digest, jobAdmissionId, jobOccurrenceId, type JobAdmission, type JobAdmissionRow, type JobOccurrenceRow, type JobScheduleRow, type JobSeal } from './model';
import { decodeJobAdmission, normalizeJobSeal } from './realm-model';
import { jobSourceId, normalizeJobSourceIdentity, normalizeJobSourceOrigin, type JobSourceIdentity } from './source-model';
import { assertSourceAdmission, assertSourceRow, assertSourceSchedule, decodeSourceIntent, decodeSourcePolicy,
  sourceIntentId, sourcePolicyId, sourceRegistration, sourceScheduleReceipt, type JobSourceIntentRow, type JobSourcePolicyRow, type JobSourceRow } from './source-realm-model';
import { jobInteger, jobRecord, jobScope, jobText, jobTime } from './validation';

/** Broker-only transport. The native facade never returns admission input or a seal to its caller. */
export interface JobSourceExecutionContext {
  readonly scheduleId: string; readonly generation: number; readonly scheduledAt: number; readonly occurrenceId: string;
  readonly admission: JobAdmission; readonly seal: JobSeal;
  readonly recordedInstanceId: string | null; readonly recordedReceipt: unknown;
}

/** One primary-key occurrence lookup; historical source epochs and cancelled schedules remain reconcilable. */
export function readSourceJobExecution(context: DatabaseReadQueryContext, input: unknown): JobSourceExecutionContext | null {
  const r = jobRecord(input, ['identity', 'id', 'generation', 'scheduledAt']), identity = normalizeJobSourceIdentity(r.identity);
  source(context, identity, true);
  const id = jobText(r.id, 96), generation = jobInteger(r.generation, 1), scheduledAt = jobTime(r.scheduledAt);
  const schedule = context.database.query<JobScheduleRow>('SELECT * FROM job_schedules WHERE id=? AND scope_id=?').get(id, identity.scopeId);
  if (!schedule) throw new JobsError('JOBS_NOT_FOUND'); assertSourceSchedule(schedule, identity);
  const occurrenceId = jobOccurrenceId(id, generation, scheduledAt);
  const occurrence = context.database.query<JobOccurrenceRow>('SELECT * FROM _jobs_occurrences WHERE id=? AND scope_id=?').get(occurrenceId, identity.scopeId);
  if (!occurrence) return null;
  const admissionId = jobAdmissionId(id, generation);
  if (occurrence.schedule_id !== id || occurrence.generation !== generation || occurrence.scheduled_at !== scheduledAt
    || occurrence.admission_id !== admissionId || (occurrence.workflow_id === null) !== (occurrence.receipt_json === null)) throw new JobsError('JOBS_STATE_INVALID');
  const row = context.database.query<JobAdmissionRow>('SELECT * FROM _jobs_admissions WHERE id=? AND scope_id=?').get(admissionId, identity.scopeId);
  if (!row || row.schedule_id !== id || row.generation !== generation) throw new JobsError('JOBS_STATE_INVALID');
  const admission = decodeJobAdmission(row);
  if (!admission.source || admission.timing.kind !== 'once' || Date.parse(admission.timing.at) !== scheduledAt) throw new JobsError('JOBS_STATE_INVALID');
  assertSourceAdmission(admission, identity, policy(context, identity, admission.source.generation));
  let recordedReceipt: unknown = null;
  if (occurrence.receipt_json !== null) {
    try { recordedReceipt = JSON.parse(occurrence.receipt_json); } catch { throw new JobsError('JOBS_STATE_INVALID'); }
  }
  return { scheduleId: id, generation, scheduledAt, occurrenceId, admission,
    seal: normalizeJobSeal({ authorityJson: row.authority_json, authorityMac: row.authority_mac }),
    recordedInstanceId: occurrence.workflow_id, recordedReceipt };
}

export function getJobSource(context: DatabaseReadQueryContext, input: unknown) {
  const r = jobRecord(input, ['identity']), identity = normalizeJobSourceIdentity(r.identity), row = source(context, identity);
  return row ? sourceRegistration(row, policy(context, identity, row.current_generation), identity) : null;
}

/** Retired sources may still read and reconcile their immutable historical ownership. */
export function readSourceJobSchedule(context: DatabaseReadQueryContext, input: unknown) {
  const r = jobRecord(input, ['identity', 'id']), identity = normalizeJobSourceIdentity(r.identity);
  source(context, identity, true);
  const schedule = context.database.query<JobScheduleRow>('SELECT * FROM job_schedules WHERE id=? AND scope_id=?').get(jobText(r.id, 96), identity.scopeId);
  if (!schedule) throw new JobsError('JOBS_NOT_FOUND'); assertSourceSchedule(schedule, identity);
  const row = context.database.query<JobAdmissionRow>('SELECT * FROM _jobs_admissions WHERE id=? AND scope_id=?')
    .get(jobAdmissionId(schedule.id, schedule.generation), identity.scopeId);
  if (!row || row.schedule_id !== schedule.id || row.generation !== schedule.generation) throw new JobsError('JOBS_STATE_INVALID');
  const admission = decodeJobAdmission(row);
  if (!admission.source) throw new JobsError('JOBS_STATE_INVALID');
  assertSourceAdmission(admission, identity, policy(context, identity, admission.source.generation));
  return { schedule, admission, receipt: sourceScheduleReceipt(schedule, admission) };
}

/** The original permanent result is returned even after retirement, readmission or cancellation. */
export function readSourceJobIntent(context: DatabaseReadQueryContext, input: unknown) {
  const r = jobRecord(input, ['identity', 'requestId', 'intentDigest']), identity = normalizeJobSourceIdentity(r.identity);
  const id = sourceIntentId(identity, r.requestId);
  if (!source(context, identity)) return null;
  const row = context.database.query<JobSourceIntentRow>('SELECT * FROM _jobs_source_intents WHERE id=? AND scope_id=? AND source_id=?')
    .get(id, identity.scopeId, jobSourceId(identity));
  if (!row) return null;
  if (r.intentDigest !== undefined && row.digest !== digest(r.intentDigest)) throw new JobsError('JOBS_INTENT_CONFLICT');
  decodeSourcePolicy(policy(context, identity, row.policy_generation), identity, row.policy_generation);
  return decodeSourceIntent(row, identity);
}

/** A registry check is only an epoch fence; the broker independently proves physical native ownership. */
export function readJobSourceDispatch(context: DatabaseReadQueryContext, input: unknown): boolean {
  const r = jobRecord(input, ['scopeId', 'source']), scopeId = jobScope(r.scopeId), origin = normalizeJobSourceOrigin(r.source);
  owner(context, scopeId);
  const row = context.database.query<JobSourceRow>('SELECT * FROM _jobs_sources WHERE id=? AND scope_id=?').get(origin.id, scopeId);
  if (!row) throw new JobsError('JOBS_AUTHORITY_RETIRED');
  let identity: JobSourceIdentity;
  try { identity = normalizeJobSourceIdentity(JSON.parse(row.identity_json)); }
  catch { throw new JobsError('JOBS_STATE_INVALID'); }
  assertSourceRow(row, identity);
  const registration = sourceRegistration(row, policy(context, identity, row.current_generation), identity);
  if (registration.state !== 'active' || registration.generation !== origin.generation || registration.policyHash !== origin.policyHash) throw new JobsError('JOBS_AUTHORITY_RETIRED');
  return true;
}

function owner(context: DatabaseReadQueryContext, scopeId: string): void {
  const row = context.database.query<{ scope_id: string }>("SELECT scope_id FROM _jobs_owner WHERE id='application'").get();
  if (!row || row.scope_id !== scopeId) throw new JobsError('JOBS_STATE_INVALID');
}
function source(context: DatabaseReadQueryContext, identity: JobSourceIdentity, required = false): JobSourceRow | null {
  owner(context, identity.scopeId);
  const row = context.database.query<JobSourceRow>('SELECT * FROM _jobs_sources WHERE id=? AND scope_id=?').get(jobSourceId(identity), identity.scopeId);
  if (!row) { if (required) throw new JobsError('JOBS_NOT_FOUND'); return null; }
  assertSourceRow(row, identity); return row;
}
function policy(context: DatabaseReadQueryContext, identity: JobSourceIdentity, generation: number): JobSourcePolicyRow {
  const value = jobInteger(generation, 1), id = jobSourceId(identity);
  const row = context.database.query<JobSourcePolicyRow>('SELECT * FROM _jobs_source_policies WHERE id=? AND scope_id=? AND source_id=?')
    .get(sourcePolicyId(id, value), identity.scopeId, id);
  if (!row) throw new JobsError('JOBS_STATE_INVALID'); return row;
}
