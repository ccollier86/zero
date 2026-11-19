/** Short, synchronous control commands. Actor transactions own rollback; no provider or queue is awaited here. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import { JobsError, jobCommand } from './error';
import { digest, normalizeJobAdmission, type JobScheduleRow } from './model';
import { initialScheduleDue } from './schedule-time';
import { assertJobOwner, insertJobAdmission, jobActor, jobBudget, jobIntent, JOB_LIMITS, jobRevision, jobScope, nextJobInteger, normalizeJobSeal, ownedJob, scheduleView } from './realm-model';
import { jobHash, jobRecord, jobText, jobTime } from './validation';
import { appendJobSemanticAudit } from './semantic-audit';
import { initializeJobScheduleWork, refreshJobScheduleWork } from './realm-capacity';

export function bindJobOwner(context: DatabaseWriteCommandContext, input: unknown) {
  return jobCommand(() => {
    const r = jobRecord(input, ['ownerId', 'scopeId']), ownerId = jobText(r.ownerId, 128), scopeId = jobScope(r.scopeId);
    const prior = context.db.get('_jobs_owner', 'application');
    if (prior && (prior.owner_id !== ownerId || prior.scope_id !== scopeId)) throw new JobsError('JOBS_STATE_INVALID');
    if (!prior) context.db.createStrict('_jobs_owner', { id: 'application', owner_id: ownerId, scope_id: scopeId });
    return { bound: true };
  });
}
export function createJobSchedule(context: DatabaseWriteCommandContext, input: unknown) {
  return jobCommand(() => {
    const r = jobRecord(input, ['actor', 'requestId', 'admission', 'seal', 'intentHash', 'now']), actor = jobActor(r.actor), now = jobTime(r.now);
    assertJobOwner(context, actor.scopeId);
    const admission = normalizeJobAdmission(r.admission), seal = normalizeJobSeal(r.seal);
    if (admission.source || admission.scopeId !== actor.scopeId || admission.actorId !== actor.userId || admission.principal !== actor.principal) throw new JobsError('JOBS_FORBIDDEN');
    return jobIntent(context, actor, r.requestId, ['create', r.intentHash === undefined ? admission : digest(r.intentHash)], now, () => {
      if (context.db.get('job_schedules', admission.id)) throw new JobsError('JOBS_INTENT_CONFLICT');
      const next = initialScheduleDue(admission.timing, now);
      if (next === null || next < now) throw new JobsError('JOBS_INPUT_INVALID');
      jobBudget(context, 'schedules', JOB_LIMITS.schedules);
      jobBudget(context, 'owner:' + jobHash([actor.scopeId, actor.userId]), JOB_LIMITS.schedulesPerOwner);
      const row: JobScheduleRow = { id: admission.id, scope_id: actor.scopeId, actor_id: actor.userId, principal: actor.principal,
        definition_name: admission.definition, definition_version: admission.definitionVersion, run_as: admission.runAs,
        updated_by: actor.userId, control: 'active', revision: 1, generation: 1, created_at: now, updated_at: now };
      const change = context.db.createStrict('job_schedules', row);
      insertJobAdmission(context, admission, 1, seal);
      context.db.createStrict('_jobs_cursors', { id: row.id, scope_id: actor.scopeId, next_due_at: next, skipped: 0, blocked_code: null });
      initializeJobScheduleWork(context, row);
      appendJobSemanticAudit(context, 'jobs.schedule.created', change, { revision: row.revision, generation: row.generation, control: row.control, ownership: row.run_as });
      return scheduleView(row);
    });
  });
}
export function changeJobSchedule(context: DatabaseWriteCommandContext, input: unknown) {
  return jobCommand(() => {
    const r = jobRecord(input, ['actor', 'requestId', 'id', 'expectedRevision', 'action', 'admission', 'seal', 'intentHash', 'now']);
    const actor = jobActor(r.actor), row = ownedJob(context, actor, r.id), now = jobTime(r.now);
    if (!['pause', 'cancel', 'readmit'].includes(r.action as string)) throw new JobsError('JOBS_INPUT_INVALID');
    if (r.action !== 'readmit' && (r.admission !== undefined || r.seal !== undefined)) throw new JobsError('JOBS_INPUT_INVALID');
    const admission = r.action === 'readmit' ? normalizeJobAdmission(r.admission) : null;
    const seal = r.action === 'readmit' ? normalizeJobSeal(r.seal) : null;
    return jobIntent(context, actor, r.requestId, ['change', row.id, r.expectedRevision, r.action, r.intentHash === undefined ? admission : digest(r.intentHash)], now, () => {
      jobRevision(row, r.expectedRevision);
      if (row.control === 'cancelled') throw new JobsError('JOBS_STAGE_CONFLICT');
      const control = r.action === 'pause' ? 'paused' : r.action === 'cancel' ? 'cancelled' : 'active';
      if (control === row.control && !admission) return scheduleView(row);
      const next = { ...row, control, revision: nextJobInteger(row.revision), updated_by: actor.userId, updated_at: now } as JobScheduleRow;
      if (admission && seal) {
        // An administrator may stop another actor's work, not impersonate that actor on readmission.
        if (admission.source || admission.id !== row.id || admission.scopeId !== row.scope_id || admission.actorId !== row.actor_id || admission.runAs !== row.run_as
          || row.run_as === 'actor' && (actor.userId !== row.actor_id || admission.principal !== actor.principal)) throw new JobsError('JOBS_FORBIDDEN');
        const due = initialScheduleDue(admission.timing, now);
        if (due === null || due < now) throw new JobsError('JOBS_INPUT_INVALID');
        next.generation = nextJobInteger(row.generation); next.definition_name = admission.definition; next.definition_version = admission.definitionVersion;
        insertJobAdmission(context, admission, next.generation, seal);
        context.db.update('_jobs_cursors', row.id, { next_due_at: due, skipped: 0, blocked_code: null });
      } else context.db.update('_jobs_cursors', row.id, { next_due_at: null });
      const change = context.db.update('job_schedules', row.id, next);
      refreshJobScheduleWork(context, row.id);
      // Already admitted Torrent work is not claimed to have been undone. Old generations cannot acquire new dispatch claims.
      appendJobSemanticAudit(context, admission ? 'jobs.schedule.readmitted' : r.action === 'pause' ? 'jobs.schedule.paused' : 'jobs.schedule.cancelled', change,
        { revision: next.revision, generation: next.generation, previousControl: row.control, control: next.control, ownership: row.run_as });
      return scheduleView(next);
    }, r.action === 'pause' || r.action === 'cancel');
  });
}
