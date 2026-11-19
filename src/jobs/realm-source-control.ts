/** Broker-only source commands. Native source ownership is proved outside this synchronous SQL realm. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import { JobsError, jobCommand } from './error';
import { digest, normalizeJobAdmission, type JobAdmission, type JobScheduleRow } from './model';
import { assertJobOwner, decodeJobAdmission, insertJobAdmission, jobBudget, JOB_LIMITS, jobRevision, nextJobInteger, normalizeJobSeal, readJobAdmission } from './realm-model';
import { appendJobSemanticAudit } from './semantic-audit';
import { jobSourceId, normalizeJobSourceContract, normalizeJobSourceIdentity, type JobSourceIdentity } from './source-model';
import { assertSourceAdmission, assertSourceRow, assertSourceSchedule, JOB_SOURCE_LIMITS, sourceIntent, sourcePolicyId,
  sourceRegistration, sourceScheduleReceipt, writeSourcePolicy, type JobSourceRow } from './source-realm-model';
import { jobHash, jobInteger, jobJson, jobRecord, jobText, jobTime } from './validation';

export function registerJobSource(context: DatabaseWriteCommandContext, input: unknown) {
  return jobCommand(() => {
    const r = jobRecord(input, ['contract', 'expectedRevision', 'requestId', 'now']), contract = normalizeJobSourceContract(r.contract);
    const identity = contract.identity, expectedRevision = jobInteger(r.expectedRevision), now = jobTime(r.now);
    const previous = source(context, identity), hash = jobHash(contract);
    return sourceIntent(context, identity, r.requestId, ['register', contract, expectedRevision], now, () => {
      if (!previous) {
        if (expectedRevision !== 0) throw new JobsError('JOBS_REVISION_CONFLICT');
        jobBudget(context, 'sources', JOB_SOURCE_LIMITS.sources); jobBudget(context, 'source-policies', JOB_SOURCE_LIMITS.policies);
        const row: JobSourceRow = { id: jobSourceId(identity), scope_id: identity.scopeId, identity_json: jobJson(identity), identity_hash: jobHash(identity),
          current_generation: 1, revision: 1, state: 'active', created_at: now, updated_at: now };
        context.db.createStrict('_jobs_sources', row);
        const policy = { id: sourcePolicyId(row.id, 1), scope_id: identity.scopeId, source_id: row.id, generation: 1,
          contract_json: jobJson(contract), digest: hash, created_at: now };
        context.db.createStrict('_jobs_source_policies', policy);
        return { value: sourceRegistration(row, policy, identity), policyGeneration: 1 };
      }
      const current = writeSourcePolicy(context, previous), registration = sourceRegistration(previous, current, identity);
      if (previous.revision !== expectedRevision) throw new JobsError('JOBS_REVISION_CONFLICT');
      if (previous.state === 'active' && current.contract_json === jobJson(contract) && current.digest === hash) {
        return { value: registration, policyGeneration: previous.current_generation };
      }
      jobBudget(context, 'source-policies', JOB_SOURCE_LIMITS.policies);
      const next: JobSourceRow = { ...previous, current_generation: nextJobInteger(previous.current_generation), revision: nextJobInteger(previous.revision), state: 'active', updated_at: now };
      const policy = { id: sourcePolicyId(next.id, next.current_generation), scope_id: identity.scopeId, source_id: next.id, generation: next.current_generation,
        contract_json: jobJson(contract), digest: hash, created_at: now };
      context.db.createStrict('_jobs_source_policies', policy); context.db.update('_jobs_sources', next.id, next);
      return { value: sourceRegistration(next, policy, identity), policyGeneration: next.current_generation };
    });
  });
}

export function retireJobSource(context: DatabaseWriteCommandContext, input: unknown) {
  return jobCommand(() => {
    const r = jobRecord(input, ['identity', 'expectedRevision', 'requestId', 'now']), identity = normalizeJobSourceIdentity(r.identity);
    const expectedRevision = jobInteger(r.expectedRevision, 1), now = jobTime(r.now), row = source(context, identity, true)!;
    return sourceIntent(context, identity, r.requestId, ['retire', identity, expectedRevision], now, () => {
      const policy = writeSourcePolicy(context, row), registration = sourceRegistration(row, policy, identity);
      if (row.revision !== expectedRevision) throw new JobsError('JOBS_REVISION_CONFLICT');
      if (row.state === 'retired') return { value: registration, policyGeneration: row.current_generation };
      const next: JobSourceRow = { ...row, revision: nextJobInteger(row.revision), state: 'retired', updated_at: now };
      context.db.update('_jobs_sources', row.id, next);
      return { value: sourceRegistration(next, policy, identity), policyGeneration: row.current_generation };
    }, 'recovery');
  });
}

export function createSourceJobSchedule(context: DatabaseWriteCommandContext, input: unknown) {
  return jobCommand(() => {
    const r = jobRecord(input, ['identity', 'requestId', 'admission', 'seal', 'intentHash', 'now']), identity = normalizeJobSourceIdentity(r.identity);
    const now = jobTime(r.now), admission = normalizeJobAdmission(r.admission), seal = normalizeJobSeal(r.seal), registry = source(context, identity, true)!;
    return sourceIntent(context, identity, r.requestId, ['create', r.intentHash === undefined ? admission : digest(r.intentHash)], now, () => {
      currentAdmission(context, registry, identity, admission);
      if (context.db.get('job_schedules', admission.id)) throw new JobsError('JOBS_INTENT_CONFLICT');
      const due = sourceDue(admission, now);
      jobBudget(context, 'schedules', JOB_LIMITS.schedules);
      jobBudget(context, 'source:' + jobHash(identity), JOB_SOURCE_LIMITS.schedules);
      const row: JobScheduleRow = { id: admission.id, scope_id: identity.scopeId, actor_id: null, principal: null, updated_by: null, source_id: registry.id,
        definition_name: admission.definition, definition_version: admission.definitionVersion, run_as: 'service',
        control: 'active', revision: 1, generation: 1, created_at: now, updated_at: now };
      const change = context.db.createStrict('job_schedules', row);
      insertJobAdmission(context, admission, 1, seal);
      context.db.createStrict('_jobs_cursors', { id: row.id, scope_id: identity.scopeId, next_due_at: due, skipped: 0, blocked_code: null });
      appendJobSemanticAudit(context, 'jobs.schedule.created', change, { revision: 1, generation: 1, control: 'active', ownership: 'service',
        sourceId: registry.id, policyGeneration: admission.source!.generation, ...(admission.initiatedBy === undefined ? {} : { initiatedBy: admission.initiatedBy }) });
      return { value: sourceScheduleReceipt(row, admission), policyGeneration: registry.current_generation };
    });
  });
}

export function changeSourceJobSchedule(context: DatabaseWriteCommandContext, input: unknown) {
  return jobCommand(() => {
    const r = jobRecord(input, ['identity', 'requestId', 'id', 'expectedRevision', 'action', 'admission', 'seal', 'intentHash', 'now']), identity = normalizeJobSourceIdentity(r.identity);
    const now = jobTime(r.now), expectedRevision = jobInteger(r.expectedRevision, 1), registry = source(context, identity, true)!;
    const row = context.db.get('job_schedules', jobText(r.id, 96)) as JobScheduleRow | null;
    if (!row) throw new JobsError('JOBS_NOT_FOUND'); assertSourceSchedule(row, identity);
    if (r.action !== 'cancel' && r.action !== 'readmit') throw new JobsError('JOBS_INPUT_INVALID');
    if (r.action === 'cancel' && (r.admission !== undefined || r.seal !== undefined)) throw new JobsError('JOBS_INPUT_INVALID');
    const admission = r.action === 'readmit' ? normalizeJobAdmission(r.admission) : null, seal = r.action === 'readmit' ? normalizeJobSeal(r.seal) : null;
    return sourceIntent(context, identity, r.requestId, ['change', row.id, expectedRevision, r.action, r.intentHash === undefined ? admission : digest(r.intentHash)], now, () => {
      jobRevision(row, expectedRevision);
      if (row.control === 'cancelled') throw new JobsError('JOBS_STAGE_CONFLICT');
      const next: JobScheduleRow = { ...row, control: r.action === 'cancel' ? 'cancelled' : 'active', revision: nextJobInteger(row.revision), updated_at: now };
      let admitted: JobAdmission;
      if (admission && seal) {
        currentAdmission(context, registry, identity, admission);
        if (admission.id !== row.id) throw new JobsError('JOBS_FORBIDDEN');
        const due = sourceDue(admission, now);
        next.generation = nextJobInteger(row.generation); next.definition_name = admission.definition; next.definition_version = admission.definitionVersion;
        insertJobAdmission(context, admission, next.generation, seal);
        context.db.update('_jobs_cursors', row.id, { next_due_at: due, skipped: 0, blocked_code: null }); admitted = admission;
      } else {
        admitted = decodeJobAdmission(readJobAdmission(context, row));
        if (!admitted.source || admitted.source.id !== registry.id) throw new JobsError('JOBS_STATE_INVALID');
        context.db.update('_jobs_cursors', row.id, { next_due_at: null });
      }
      const change = context.db.update('job_schedules', row.id, next);
      appendJobSemanticAudit(context, admission ? 'jobs.schedule.readmitted' : 'jobs.schedule.cancelled', change,
        { revision: next.revision, generation: next.generation, previousControl: row.control, control: next.control, ownership: 'service',
          sourceId: registry.id, policyGeneration: admitted.source!.generation, ...(admitted.initiatedBy === undefined ? {} : { initiatedBy: admitted.initiatedBy }) });
      return { value: sourceScheduleReceipt(next, admitted), policyGeneration: admitted.source!.generation };
    }, r.action === 'cancel' ? 'recovery' : 'ordinary');
  });
}

function source(context: DatabaseWriteCommandContext, identity: JobSourceIdentity, required = false): JobSourceRow | null {
  assertJobOwner(context, identity.scopeId);
  const row = context.db.get('_jobs_sources', jobSourceId(identity)) as JobSourceRow | null;
  if (!row) { if (required) throw new JobsError('JOBS_NOT_FOUND'); return null; }
  assertSourceRow(row, identity); return row;
}
function currentAdmission(context: DatabaseWriteCommandContext, source: JobSourceRow, identity: JobSourceIdentity, admission: JobAdmission): void {
  if (source.state !== 'active') throw new JobsError('JOBS_AUTHORITY_RETIRED');
  const policy = writeSourcePolicy(context, source);
  assertSourceAdmission(admission, identity, policy);
}
/** Never re-time source work: lateness is checked against its original one-shot instant. */
function sourceDue(admission: JobAdmission, now: number): number {
  if (admission.timing.kind !== 'once') throw new JobsError('JOBS_INPUT_INVALID');
  const due = jobTime(Date.parse(admission.timing.at));
  if (now - due > admission.timing.maxLatenessMs) throw new JobsError('JOBS_INPUT_INVALID');
  return due;
}
