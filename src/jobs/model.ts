/** Private admission/dispatch records. Public job views never contain these inputs or authority seals. */
import type { ScheduleTiming } from './schedule-time';
import { normalizeScheduleTiming } from './schedule-time';
import { jobDigest, jobHash, jobInput, jobInteger, jobRecord, jobScope, jobText, type JobValue } from './validation';
import { JobsError } from './error';
import type { Row } from '../sync/types';
import { normalizeJobSourceInitiator, normalizeJobSourceOrigin, type JobSourceOrigin } from './source-model';

export interface JobWorkflowPin { readonly name: string; readonly version: number; readonly definitionId: string; readonly versionId: string; readonly fingerprint: string }
export interface JobAdmissionBase {
  readonly id: string; readonly scopeId: string;
  readonly definition: string; readonly definitionVersion: string; readonly definitionHash: string;
  readonly workflow: JobWorkflowPin; readonly input: JobValue; readonly timing: ScheduleTiming;
  readonly overlap: 'skip' | 'allow' | 'queue-one';
}
export type JobAdmission = JobAdmissionBase & (
  { readonly actorId: string; readonly principal: string; readonly runAs: 'actor' | 'service'; readonly source?: never; readonly initiatedBy?: never }
  | { readonly actorId: null; readonly principal: null; readonly runAs: 'service'; readonly source: JobSourceOrigin; readonly initiatedBy?: string });
export interface JobSeal { readonly authorityJson: string; readonly authorityMac: string }
export type JobScheduleRow = Row & {
  id: string; scope_id: string; actor_id: string | null; principal: string | null; definition_name: string; definition_version: string;
  run_as: 'actor' | 'service'; updated_by: string | null; source_id?: string | null;
  control: 'active' | 'paused' | 'cancelled'; revision: number; generation: number; created_at: number; updated_at: number;
}
export type JobAdmissionRow = Row & { id: string; scope_id: string; schedule_id: string; generation: number; command_json: string; digest: string; authority_json: string; authority_mac: string };
export type JobCursorRow = Row & { id: string; scope_id: string; next_due_at: number | null; skipped: number; blocked_code: string | null };
export type JobOccurrenceRow = Row & {
  id: string; scope_id: string; schedule_id: string; admission_id: string; generation: number; scheduled_at: number;
  state: 'pending' | 'claimed' | 'dispatched' | 'terminal' | 'blocked' | 'cancelled'; lease_nonce: string | null; lease_until: number | null;
  lease_generation: number; workflow_id: string | null; receipt_json: string | null; terminal_status: string | null;
  error_code: string | null; created_at: number; updated_at: number;
}
export function normalizeJobAdmission(input: unknown): JobAdmission {
  const r = jobRecord(input, ['id', 'scopeId', 'actorId', 'principal', 'definition', 'definitionVersion', 'definitionHash', 'workflow', 'input', 'timing', 'overlap', 'runAs', 'source', 'initiatedBy']);
  const pin = jobRecord(r.workflow, ['name', 'version', 'definitionId', 'versionId', 'fingerprint']);
  if (!['skip', 'allow', 'queue-one'].includes(r.overlap as string) || !['actor', 'service'].includes(r.runAs as string)) throw new JobsError('JOBS_INPUT_INVALID');
  const scopeId = jobScope(r.scopeId);
  let timing: ScheduleTiming; try { timing = normalizeScheduleTiming(r.timing); } catch { throw new JobsError('JOBS_INPUT_INVALID'); }
  const source = r.source === undefined ? undefined : normalizeJobSourceOrigin(r.source);
  if (source ? r.actorId !== null || r.principal !== null || r.runAs !== 'service' : r.initiatedBy !== undefined) throw new JobsError('JOBS_INPUT_INVALID');
  const origin = source ? { actorId: null, principal: null, runAs: 'service' as const, source,
    ...(r.initiatedBy === undefined ? {} : { initiatedBy: normalizeJobSourceInitiator(r.initiatedBy) }) }
    : { actorId: jobText(r.actorId, 128), principal: jobText(r.principal, 256), runAs: r.runAs as 'actor' | 'service' };
  return Object.freeze({ id: jobText(r.id, 96), scopeId, ...origin,
    definition: jobText(r.definition, 96), definitionVersion: jobText(r.definitionVersion, 64), definitionHash: digest(r.definitionHash),
    workflow: Object.freeze({ name: jobText(pin.name, 200), version: jobInteger(pin.version, 1), definitionId: jobText(pin.definitionId, 128), versionId: jobText(pin.versionId, 128), fingerprint: digest(pin.fingerprint) }),
    input: jobInput(r.input), timing, overlap: r.overlap as JobAdmission['overlap'] }) as JobAdmission;
}
export function jobAdmissionDigest(admission: JobAdmission): string { return jobHash(admission); }
export function jobAdmissionId(id: string, generation: number): string { return id + ':' + generation; }
export function jobOccurrenceId(id: string, generation: number, scheduledAt: number): string { return 'occ_' + jobHash([id, generation, scheduledAt]); }
export function digest(value: unknown): string { return jobDigest(value); }
