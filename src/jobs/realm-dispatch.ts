/** Durable occurrence/claim state only. The broker hands off to Torrent after this writer transaction closes. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import { JobsError, jobCommand } from './error';
import { jobAdmissionId, jobOccurrenceId, type JobOccurrenceRow, type JobScheduleRow } from './model';
import { assertJobOwner, decodeJobAdmission, eq, jobBudget, JOB_LIMITS, jobRevision, jobScope, nextJobInteger, oneOf, readJobAdmission } from './realm-model';
import { selectDueOccurrences } from './schedule-time';
import { jobInteger, jobJson, jobKey, jobRecord, jobText, jobTime } from './validation';

export function materializeJobOccurrences(context: DatabaseWriteCommandContext, input: unknown) {
  return jobCommand(() => {
    const r = jobRecord(input, ['scopeId', 'id', 'expectedRevision', 'now']), scope = jobScope(r.scopeId), now = jobTime(r.now);
    assertJobOwner(context, scope);
    const row = schedule(context, scope, r.id); jobRevision(row, r.expectedRevision);
    if (row.control !== 'active') return { created: 0, skipped: false };
    const cursor = context.db.get('_jobs_cursors', row.id);
    if (!cursor || cursor.scope_id !== scope) throw new JobsError('JOBS_STATE_INVALID');
    if (cursor.blocked_code !== null) return { created: 0, skipped: false };
    const admission = decodeJobAdmission(readJobAdmission(context, row));
    const due = selectDueOccurrences(admission.timing, cursor.next_due_at === null ? null : jobTime(cursor.next_due_at), now);
    if (due.scheduledAt.length) jobBudget(context, 'occurrences', JOB_LIMITS.occurrences, due.scheduledAt.length);
    if (due.scheduledAt.length && admission.overlap === 'queue-one') {
      const previous = context.db.find('_jobs_occurrences', { filters: [eq('scope_id', scope), eq('schedule_id', row.id), eq('generation', row.generation), eq('state', 'pending')], limit: 101 });
      if (previous.length > 100) throw new JobsError('JOBS_STATE_INVALID');
      for (const pending of previous) context.db.update('_jobs_occurrences', String(pending.id), { state: 'terminal', terminal_status: 'superseded', updated_at: now });
    }
    for (const at of due.scheduledAt) {
      const superseded = admission.overlap === 'queue-one' && at !== due.scheduledAt[due.scheduledAt.length - 1];
      const occurrence: JobOccurrenceRow = { id: jobOccurrenceId(row.id, row.generation, at), scope_id: scope,
        schedule_id: row.id, admission_id: jobAdmissionId(row.id, row.generation), generation: row.generation, scheduled_at: at,
        state: superseded ? 'terminal' : 'pending', lease_nonce: null, lease_until: null, lease_generation: 0, workflow_id: null, receipt_json: null,
        terminal_status: superseded ? 'superseded' : null, error_code: null, created_at: now, updated_at: now };
      context.db.createStrict('_jobs_occurrences', occurrence);
    }
    if (cursor.next_due_at !== due.nextDueAt || due.skipped) context.db.update('_jobs_cursors', row.id,
      { next_due_at: due.nextDueAt, skipped: due.skipped || cursor.skipped === 1 ? 1 : 0 });
    return { created: due.scheduledAt.length, skipped: due.skipped };
  });
}

/**
 * A stale claim is NOT evidence that enqueue failed. Reclaim it with the same
 * occurrence identity; the broker must look up the permanent Torrent receipt
 * before attempting handoff, even after pause, cancellation or readmission.
 */
export function claimJobOccurrence(context: DatabaseWriteCommandContext, input: unknown) {
  return jobCommand(() => {
    const r = jobRecord(input, ['scopeId', 'id', 'nonce', 'leaseMs', 'now']), scope = jobScope(r.scopeId), now = jobTime(r.now);
    assertJobOwner(context, scope);
    const row = occurrence(context, scope, r.id), parent = schedule(context, scope, row.schedule_id);
    const nonce = jobKey(r.nonce), leaseMs = jobInteger(r.leaseMs, 1_000, 300_000), leaseUntil = jobTime(now + leaseMs);
    if (row.state !== 'pending' && row.state !== 'claimed') return { claimed: false, reason: row.state };
    if (row.state === 'claimed' && row.lease_until !== null && row.lease_until > now) return { claimed: false, reason: 'leased' };
    const pinned = context.db.get('_jobs_admissions', row.admission_id);
    if (!pinned) throw new JobsError('JOBS_STATE_INVALID');
    const admission = decodeJobAdmission(pinned as import('./model').JobAdmissionRow);
    const current = parent.control === 'active' && parent.generation === row.generation;
    const allowed = current && now <= row.scheduled_at + admission.timing.maxLatenessMs;
    if (row.state === 'pending' && !allowed) {
      const reason = current ? 'expired' : 'cancelled';
      context.db.update('_jobs_occurrences', row.id, { state: current ? 'terminal' : 'cancelled', terminal_status: current ? 'expired' : 'not-dispatched', updated_at: now });
      return { claimed: false, reason };
    }
    if (row.state === 'pending') {
      // Includes earlier admitted generations: editing a schedule does not make its old running work disappear.
      const active = context.db.find('_jobs_occurrences', { filters: [eq('scope_id', scope), eq('schedule_id', parent.id), oneOf('state', ['claimed', 'dispatched'])], limit: 1 });
      if (active.length && admission.overlap === 'skip') {
        context.db.update('_jobs_occurrences', row.id, { state: 'terminal', terminal_status: 'overlap-skipped', updated_at: now });
        return { claimed: false, reason: 'overlap-skipped' };
      }
      if (admission.overlap === 'queue-one') {
        const latest = context.db.find('_jobs_occurrences', { filters: [eq('scope_id', scope), eq('schedule_id', parent.id), eq('generation', parent.generation), eq('state', 'pending')],
          order: [{ field: 'scheduled_at', direction: 'desc' }, { field: 'id', direction: 'desc' }], limit: 1 })[0];
        if (latest && latest.id !== row.id) {
          context.db.update('_jobs_occurrences', row.id, { state: 'terminal', terminal_status: 'superseded', updated_at: now });
          return { claimed: false, reason: 'superseded' };
        }
        if (active.length) return { claimed: false, reason: 'overlap-wait' };
      }
    }
    const generation = nextJobInteger(row.lease_generation);
    context.db.update('_jobs_occurrences', row.id, { state: 'claimed', lease_nonce: nonce, lease_until: leaseUntil,
      lease_generation: generation, updated_at: now });
    return { claimed: true, id: row.id, nonce, leaseGeneration: generation, dispatchAllowed: allowed };
  });
}

/** Store only a canonical Torrent start receipt; it is not a provider-delivery or workflow-completion claim. */
export function receiveJobDispatch(context: DatabaseWriteCommandContext, input: unknown) {
  return jobCommand(() => {
    const r = jobRecord(input, ['scopeId', 'id', 'nonce', 'leaseGeneration', 'receipt', 'now']), scope = jobScope(r.scopeId), now = jobTime(r.now);
    assertJobOwner(context, scope);
    const row = occurrence(context, scope, r.id), receipt = jobRecord(r.receipt, ['instanceId', 'name', 'createdAt', 'definitionVersion']);
    const pinRow = context.db.get('_jobs_admissions', row.admission_id);
    if (!pinRow) throw new JobsError('JOBS_STATE_INVALID');
    const admission = decodeJobAdmission(pinRow as import('./model').JobAdmissionRow);
    const normalized = { instanceId: jobText(receipt.instanceId, 128), name: jobText(receipt.name, 200), createdAt: jobText(receipt.createdAt, 64), definitionVersion: jobInteger(receipt.definitionVersion, 1) };
    if (!Number.isFinite(Date.parse(normalized.createdAt)) || normalized.name !== admission.workflow.name || normalized.definitionVersion !== admission.workflow.version) throw new JobsError('JOBS_STATE_INVALID');
    const json = jobJson(normalized);
    if (row.state === 'dispatched' || row.state === 'terminal') {
      if (row.workflow_id !== normalized.instanceId || row.receipt_json !== json) throw new JobsError('JOBS_INTENT_CONFLICT');
      return { dispatched: true, instanceId: normalized.instanceId };
    }
    assertClaim(row, r.nonce, r.leaseGeneration, now);
    context.db.update('_jobs_occurrences', row.id, { state: 'dispatched', workflow_id: normalized.instanceId, receipt_json: json,
      lease_nonce: null, lease_until: null, error_code: null, updated_at: now });
    return { dispatched: true, instanceId: normalized.instanceId };
  });
}

/** A verified no-start/revoked result may block a claim; uncertainty must remain reconcilable instead. */
export function blockJobOccurrence(context: DatabaseWriteCommandContext, input: unknown) {
  return jobCommand(() => {
    const r = jobRecord(input, ['scopeId', 'id', 'nonce', 'leaseGeneration', 'code', 'now']), scope = jobScope(r.scopeId), now = jobTime(r.now);
    assertJobOwner(context, scope);
    const row = occurrence(context, scope, r.id); assertClaim(row, r.nonce, r.leaseGeneration, now);
    const code = jobText(r.code, 64);
    if (!['JOBS_AUTHORITY_RETIRED', 'JOBS_DEFINITION_UNAVAILABLE', 'JOBS_CAPACITY', 'JOBS_NOT_DISPATCHED'].includes(code)) throw new JobsError('JOBS_INPUT_INVALID');
    context.db.update('_jobs_occurrences', row.id, { state: 'blocked', error_code: code, lease_nonce: null, lease_until: null, updated_at: now });
    const parent = schedule(context, scope, row.schedule_id);
    if (parent.generation === row.generation && code !== 'JOBS_NOT_DISPATCHED') context.db.update('_jobs_cursors', parent.id, { blocked_code: code });
    return { blocked: true };
  });
}
export function completeJobOccurrence(context: DatabaseWriteCommandContext, input: unknown) {
  return jobCommand(() => {
    const r = jobRecord(input, ['scopeId', 'id', 'instanceId', 'status', 'now']), scope = jobScope(r.scopeId), now = jobTime(r.now);
    assertJobOwner(context, scope);
    const row = occurrence(context, scope, r.id), id = jobText(r.instanceId, 128);
    if (!['completed', 'failed', 'cancelled'].includes(r.status as string)) throw new JobsError('JOBS_INPUT_INVALID');
    if (row.workflow_id !== id || row.receipt_json === null || !['dispatched', 'terminal'].includes(row.state)) throw new JobsError('JOBS_STAGE_CONFLICT');
    if (row.state === 'terminal' && row.terminal_status !== r.status) throw new JobsError('JOBS_INTENT_CONFLICT');
    if (row.state !== 'terminal') context.db.update('_jobs_occurrences', row.id, { state: 'terminal', terminal_status: r.status, updated_at: now });
    return { completed: true };
  });
}
function schedule(context: DatabaseWriteCommandContext, scope: string, id: unknown): JobScheduleRow {
  const row = context.db.get('job_schedules', jobText(id, 96)) as JobScheduleRow | null;
  if (!row || row.scope_id !== scope) throw new JobsError('JOBS_NOT_FOUND'); return row;
}
function occurrence(context: DatabaseWriteCommandContext, scope: string, id: unknown): JobOccurrenceRow {
  const row = context.db.get('_jobs_occurrences', jobText(id, 128)) as JobOccurrenceRow | null;
  if (!row || row.scope_id !== scope) throw new JobsError('JOBS_NOT_FOUND'); return row;
}
function assertClaim(row: JobOccurrenceRow, nonce: unknown, generation: unknown, now: number): void {
  if (row.state !== 'claimed' || row.lease_nonce !== jobKey(nonce) || row.lease_generation !== jobInteger(generation, 1)
    || row.lease_until === null || row.lease_until <= now) throw new JobsError('JOBS_STAGE_CONFLICT');
}
