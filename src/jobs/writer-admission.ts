/** Fixed actor-imported command classification and transaction conservation. */
import type { DatabaseWriterAdmissionContext, DatabaseWriterAdmissionDefinition } from '../databases/database-writer-admission';
import type { DatabaseSerializableValue, DatabaseWriteOperation } from '../databases/database-operations';
import { JobsError, jobCommand } from './error';
import { jobCapacityPolicyData, normalizeJobsCapacityPolicy, type JobsCapacityPolicy } from './capacity-policy';
import { readJobSettlementSnapshot, type JobSettlementSnapshot } from './settlement-model';
import { jobInteger } from './validation';

const COMMANDS = new Set(['jobs.owner.bind', 'jobs.schedule.create', 'jobs.schedule.change', 'jobs.materialize', 'jobs.claim', 'jobs.claim.defer',
  'jobs.dispatch', 'jobs.dispatch.reconcile', 'jobs.pending.close', 'jobs.block', 'jobs.complete', 'jobs.cursor.block',
  'jobs.source.register', 'jobs.source.retire', 'jobs.source.schedule.create', 'jobs.source.schedule.change']);
type Snapshot = JobSettlementSnapshot & { actorReceipts: number; sourceReceipts: number };
function recovery(operation: DatabaseWriteOperation): boolean {
  if (operation.type !== 'command') return false;
  if (['jobs.dispatch', 'jobs.dispatch.reconcile', 'jobs.pending.close', 'jobs.complete', 'jobs.source.retire'].includes(operation.name)) return true;
  const action = (operation.input as { action?: unknown } | null)?.action;
  return operation.name === 'jobs.source.schedule.change' && action === 'cancel'
    || operation.name === 'jobs.schedule.change' && (action === 'pause' || action === 'cancel');
}
function usage(context: DatabaseWriterAdmissionContext, id: string): number {
  const row = context.get('_jobs_usage', id); return row ? jobInteger(row.count) : 0;
}
function policy(context: DatabaseWriterAdmissionContext): JobsCapacityPolicy { return context.policy as unknown as JobsCapacityPolicy; }
function fail(): never { throw new JobsError('JOBS_CAPACITY'); }
function check(context: DatabaseWriterAdmissionContext, operation: DatabaseWriteOperation, before: Snapshot): undefined {
  jobCommand(() => {
    if (operation.type !== 'command' || !COMMANDS.has(operation.name)) throw new JobsError('JOBS_FORBIDDEN');
    const after = readJobSettlementSnapshot(context), p = policy(context), keysAfter = context.receipts.totalKeys + 1;
    const beforeTotal = context.receipts.totalKeys + before.transportUnits, afterTotal = keysAfter + after.transportUnits;
    // Legacy deficits freeze ordinary work. A genuine settlement may convert an
    // owed unit to a permanent key without increasing that existing deficit.
    if (afterTotal > p.transport.keyLimit && (!recovery(operation) || after.transportUnits >= before.transportUnits
      || afterTotal > beforeTotal)) fail();
    if (!recovery(operation) && beforeTotal >= p.transport.keyLimit) fail();
    const actor = usage(context, 'actorRecoveryIntents') + after.actorControlUnits;
    const source = usage(context, 'sourceRecoveryIntents') + after.sourceControlUnits;
    const beforeActor = before.actorReceipts + before.actorControlUnits;
    const beforeSource = before.sourceReceipts + before.sourceControlUnits;
    const settling = recovery(operation) && after.transportUnits < before.transportUnits;
    if (actor > p.retained.actorRecoveryIntents && (!settling || actor > beforeActor)
      || source > p.retained.sourceRecoveryIntents && (!settling || source > beforeSource)) fail();
  });
  return undefined;
}
export const jobsWriterAdmission: DatabaseWriterAdmissionDefinition = Object.freeze({
  id: 'zero.jobs.capacity.v1',
  normalizeBinding(value: DatabaseSerializableValue | undefined) { return jobCapacityPolicyData(normalizeJobsCapacityPolicy(value)); },
  snapshot(context: DatabaseWriterAdmissionContext) { return { ...readJobSettlementSnapshot(context), actorReceipts: usage(context, 'actorRecoveryIntents'), sourceReceipts: usage(context, 'sourceRecoveryIntents') }; },
  validate(context: DatabaseWriterAdmissionContext, operation: DatabaseWriteOperation, before: DatabaseSerializableValue) { return check(context, operation, before as unknown as Snapshot); },
  project(context: DatabaseWriterAdmissionContext): DatabaseSerializableValue {
    const units = readJobSettlementSnapshot(context), p = policy(context), used = context.receipts.totalKeys;
    return { keyLimit: p.transport.keyLimit, hardKeyLimit: context.receipts.keyLimit, settlementUnits: units.transportUnits,
      ordinaryRemaining: Math.max(0, p.transport.keyLimit - used - units.transportUnits),
      settlementRemaining: Math.max(0, p.transport.keyLimit - used), deficit: Math.max(0, used + units.transportUnits - p.transport.keyLimit),
      actorControlUnits: units.actorControlUnits, sourceControlUnits: units.sourceControlUnits, actorRecoveryUsed: usage(context, 'actorRecoveryIntents'), retained: { ...p.retained } };
  },
});
