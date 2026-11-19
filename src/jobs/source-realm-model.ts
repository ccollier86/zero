/** Private source registry/evidence helpers. These never confer physical source ownership. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import type { Row } from '../sync/types';
import { JobsError } from './error';
import { digest, type JobAdmission, type JobScheduleRow } from './model';
import { jobBudget, JOB_LIMITS } from './realm-model';
import { readJobSettlementSnapshot } from './settlement-model';
import { jobSourceId, normalizeJobSourceContract, type JobSourceContract, type JobSourceIdentity, type JobSourceRegistration, type JobSourceScheduleReceipt } from './source-model';
import { jobHash, jobInteger, jobJson, jobKey, jobRecord, jobText, jobTime, jobValue, type JobValue } from './validation';

export type JobSourceRow = Row & {
  id: string; scope_id: string; identity_json: string; identity_hash: string;
  current_generation: number; revision: number; state: 'active' | 'retired'; created_at: number; updated_at: number;
};
export type JobSourcePolicyRow = Row & {
  id: string; scope_id: string; source_id: string; generation: number; contract_json: string; digest: string; created_at: number;
};
export type JobSourceIntentRow = Row & {
  id: string; scope_id: string; source_id: string; policy_generation: number; digest: string; result_json: string; created_at: number;
};
export const JOB_SOURCE_LIMITS = Object.freeze({ sources: 1_024, policies: 10_000, schedules: 1_000 });
/** Reserved finite recovery receipts: one cancellation/schedule plus retirement headroom
 * for retained policy generations and source identities. No history is reclaimed. */
export const JOB_SOURCE_RECOVERY_INTENTS_LIMIT = JOB_LIMITS.schedules + JOB_SOURCE_LIMITS.policies + JOB_SOURCE_LIMITS.sources;
export function sourcePolicyId(id: string, generation: number): string { return id + ':' + generation; }
export function sourceIntentId(identity: JobSourceIdentity, requestId: unknown): string { return jobHash(['source', jobSourceId(identity), jobKey(requestId)]); }

/** Retained rows are checked against exact canonical identity, not only a guessed stable ID. */
export function assertSourceRow(row: JobSourceRow, identity: JobSourceIdentity): void {
  if (row.id !== jobSourceId(identity) || row.scope_id !== identity.scopeId || row.identity_json !== jobJson(identity)
    || row.identity_hash !== jobHash(identity) || !['active', 'retired'].includes(row.state)) throw new JobsError('JOBS_STATE_INVALID');
  try { jobInteger(row.current_generation, 1); jobInteger(row.revision, 1); jobTime(row.created_at); jobTime(row.updated_at); }
  catch { throw new JobsError('JOBS_STATE_INVALID'); }
}
export function decodeSourcePolicy(row: JobSourcePolicyRow, identity: JobSourceIdentity, generation: number): JobSourceContract {
  const id = jobSourceId(identity);
  if (row.id !== sourcePolicyId(id, generation) || row.scope_id !== identity.scopeId || row.source_id !== id || row.generation !== generation) throw new JobsError('JOBS_STATE_INVALID');
  try {
    const contract = normalizeJobSourceContract(JSON.parse(row.contract_json));
    if (jobJson(contract) !== row.contract_json || jobJson(contract.identity) !== jobJson(identity) || jobHash(contract) !== row.digest) throw new JobsError('JOBS_STATE_INVALID');
    jobTime(row.created_at); return contract;
  } catch { throw new JobsError('JOBS_STATE_INVALID'); }
}
export function sourceRegistration(row: JobSourceRow, policy: JobSourcePolicyRow, identity: JobSourceIdentity): JobSourceRegistration {
  assertSourceRow(row, identity); decodeSourcePolicy(policy, identity, row.current_generation);
  return { id: row.id, generation: row.current_generation, revision: row.revision, state: row.state, policyHash: policy.digest };
}
export function writeSourcePolicy(context: DatabaseWriteCommandContext, source: JobSourceRow): JobSourcePolicyRow {
  const policy = context.db.get('_jobs_source_policies', sourcePolicyId(source.id, source.current_generation)) as JobSourcePolicyRow | null;
  if (!policy) throw new JobsError('JOBS_STATE_INVALID'); return policy;
}
/** Readmission may replace a policy epoch but can never replace the stable source owner. */
export function assertSourceSchedule(row: JobScheduleRow, identity: JobSourceIdentity): void {
  if (row.scope_id !== identity.scopeId || row.source_id !== jobSourceId(identity)) throw new JobsError('JOBS_NOT_FOUND');
  if (row.actor_id !== null || row.principal !== null || row.updated_by !== null || row.run_as !== 'service') throw new JobsError('JOBS_STATE_INVALID');
}
export function assertSourceAdmission(admission: JobAdmission, identity: JobSourceIdentity, policy: JobSourcePolicyRow): void {
  const contract = decodeSourcePolicy(policy, identity, policy.generation);
  if (!admission.source || admission.actorId !== null || admission.principal !== null || admission.runAs !== 'service'
    || admission.scopeId !== identity.scopeId || admission.source.id !== jobSourceId(identity)
    || admission.source.generation !== policy.generation || admission.source.policyHash !== policy.digest
    || admission.definition !== contract.definition.name || admission.definitionVersion !== contract.definition.version
    || admission.definitionHash !== contract.definition.fingerprint || jobJson(admission.workflow) !== jobJson(contract.workflow)) throw new JobsError('JOBS_FORBIDDEN');
}
export function sourceScheduleReceipt(row: JobScheduleRow, admission: JobAdmission): JobSourceScheduleReceipt {
  if (!admission.source || admission.id !== row.id || admission.scopeId !== row.scope_id || admission.source.id !== row.source_id) throw new JobsError('JOBS_STATE_INVALID');
  return { id: row.id, sourceId: admission.source.id, policyGeneration: admission.source.generation, control: row.control,
    revision: row.revision, generation: row.generation, createdAt: row.created_at, updatedAt: row.updated_at };
}
export function decodeSourceIntent(row: JobSourceIntentRow, identity: JobSourceIdentity): JobValue {
  if (row.scope_id !== identity.scopeId || row.source_id !== jobSourceId(identity)) throw new JobsError('JOBS_STATE_INVALID');
  try {
    jobInteger(row.policy_generation, 1); digest(row.digest); jobTime(row.created_at);
    const value = jobValue(JSON.parse(row.result_json));
    if (jobJson(value) !== row.result_json) throw new JobsError('JOBS_STATE_INVALID');
    const result = jobRecord(value);
    if (result.sourceId !== undefined) {
      jobRecord(value, ['id', 'sourceId', 'policyGeneration', 'control', 'revision', 'generation', 'createdAt', 'updatedAt']);
      jobText(result.id, 96); jobInteger(result.revision, 1); jobInteger(result.generation, 1); jobTime(result.createdAt); jobTime(result.updatedAt);
      if (result.sourceId !== row.source_id || result.policyGeneration !== row.policy_generation || !['active', 'paused', 'cancelled'].includes(result.control as string)) throw new JobsError('JOBS_STATE_INVALID');
    } else {
      jobRecord(value, ['id', 'generation', 'revision', 'state', 'policyHash']);
      jobInteger(result.revision, 1); digest(result.policyHash);
      if (result.id !== row.source_id || result.generation !== row.policy_generation || !['active', 'retired'].includes(result.state as string)) throw new JobsError('JOBS_STATE_INVALID');
    }
    return value;
  } catch { throw new JobsError('JOBS_STATE_INVALID'); }
}
/** The semantic hash omits wall clock/proof freshness; permanent results precede policy/CAS checks. */
export function sourceIntent<T>(context: DatabaseWriteCommandContext, identity: JobSourceIdentity, requestId: unknown, intent: unknown,
  now: number, run: () => { value: T; policyGeneration: number }, budget: 'ordinary' | 'recovery' = 'ordinary'): T {
  const id = sourceIntentId(identity, requestId), hash = jobHash(intent), prior = context.db.get('_jobs_source_intents', id) as JobSourceIntentRow | null;
  if (prior) {
    if (prior.digest !== hash) throw new JobsError('JOBS_INTENT_CONFLICT');
    const policy = context.db.get('_jobs_source_policies', sourcePolicyId(jobSourceId(identity), prior.policy_generation)) as JobSourcePolicyRow | null;
    if (!policy) throw new JobsError('JOBS_STATE_INVALID'); decodeSourcePolicy(policy, identity, prior.policy_generation);
    return decodeSourceIntent(prior, identity) as T;
  }
  // The immutable namespace/digest/result and original-key replay remain shared
  // with historical receipts. Only new native cancel/retire commands reserve
  // separate headroom; neither this budget nor ordinary admission is unlimited.
  const ledger = context.db.hasTable('_jobs_settlement_usage');
  const controlBefore = ledger && budget === 'recovery' ? readJobSettlementSnapshot(context.db).sourceControlUnits : 0;
  const result = run(), json = jobJson(result.value);
  const controlAfter = ledger && budget === 'recovery' ? readJobSettlementSnapshot(context.db).sourceControlUnits : 0;
  const reserved = budget === 'recovery' && (!ledger || controlAfter < controlBefore);
  jobBudget(context, reserved ? 'sourceRecoveryIntents' : 'intents', reserved ? JOB_SOURCE_RECOVERY_INTENTS_LIMIT : JOB_LIMITS.intents);
  context.db.createStrict('_jobs_source_intents', { id, scope_id: identity.scopeId, source_id: jobSourceId(identity),
    policy_generation: result.policyGeneration, digest: hash, result_json: json, created_at: now });
  return JSON.parse(json) as T;
}
