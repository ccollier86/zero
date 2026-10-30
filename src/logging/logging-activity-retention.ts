/** Retention dependencies and bounded derived cleanup. Original proofs/custody remain intact. */
import type { DatabaseWriteCommandContext, DatabaseReadQueryContext } from '../databases/database-realm';
import type { DatabaseWriteCommandCapability } from '../databases/database-write-command-capability';
import { DatabaseError } from '../databases/database-error';
import { loggingDigest } from './logging-hash';
import { captureLoggingEvent, loggingRecord } from './logging-validation';

type Row = Record<string, unknown>;
const eq = (field: string, value: string | number | null) => ({ type: 'field' as const, field, operator: 'eq' as const, value });
export function heldLoggingInterval(db: DatabaseWriteCommandCapability, row: Row, since = Number(row.occurred_at), until = since): boolean {
  return db.find('logging_holds', { filters: [eq('active', 1), eq('scope_kind', String(row.scope_kind)), eq('tenant_id', row.tenant_id as string | null),
    { type: 'field', field: 'since', operator: 'lte', value: until }, { type: 'field', field: 'until', operator: 'gt', value: since }], select: ['id'], limit: 1 }).length > 0;
}
/** Returns null when any dependent activity is fresh/held. The writer repeats this under its own transaction. */
export function pruneLoggingDependencies(db: DatabaseWriteCommandCapability, row: Row, before: number): readonly Row[] | null {
  if (heldLoggingInterval(db, row)) return null;
  if (!db.hasTable('logging_activity_evidence')) return [];
  const mappings = db.find('logging_activity_evidence', { filters: [eq('event_ref', String(row.id))], limit: 101 });
  if (mappings.length > 100) throw new DatabaseError('DATABASE_CAPACITY_EXHAUSTED', 'Retention dependency budget exceeded; narrow the batch.');
  const activities = mappings.flatMap(mapping => { const activity = db.get('logging_activities', String(mapping.activity_id)); return activity ? [activity] : []; });
  for (const activity of activities) {
    const latest = db.get('logging_events', String(activity.event_ref));
    if (!latest || Number(latest.ingested_at) >= before || heldLoggingInterval(db, activity, Number(activity.evidence_since), Number(activity.evidence_until))) return null;
  }
  return activities;
}

export function retireLoggingActivities(context: DatabaseWriteCommandContext, activities: readonly Row[], removedRows: readonly Row[], before: number,
  append: (context: DatabaseWriteCommandContext, input: unknown) => unknown): void {
  const db = context.db;
  if (!removedRows.length || !db.hasTable('logging_activity_retirements')) return;
  const through = Number(db.get('logging_state', 'head')!.ordinal), unique = [...new Map(activities.map(activity => [String(activity.id), activity])).values()];
  // At most 100 expired source events and 100 dependents each; retain backpressure rather than hiding an unbounded writer transaction.
  if (unique.length > 100) throw new DatabaseError('DATABASE_CAPACITY_EXHAUSTED', 'Retention activity budget exceeded; narrow the batch.');
  const owners = unique.length ? unique : [{ ...removedRows[0]!, id: 'unprojected' }];
  const events = owners.map(owner => captureLoggingEvent({ sourceId: 'logging:retention', origin: 'system',
    actor: { kind: 'system', id: 'logging.retention', sessionId: null, initiatorId: null }, scope: owner.scope_kind === 'tenant' ? { kind: 'tenant', tenantId: String(owner.tenant_id) } : { kind: 'application', tenantId: null },
    policyVersion: 'logging-retention-v1', requestId: null, correlationId: null },
  { id: 'retention:' + loggingDigest([before, removedRows.map(row => row.id), owner.id]), family: owner.stream === 'operational' ? 'operational' : 'investigations', action: 'logging.retention.applied',
    outcome: 'succeeded', evidence: 'server-confirmed', occurredAt: Date.now(), target: { type: 'logging.retention', id: String(owner.id) }, metadata: { count: removedRows.length } }, ['count']));
  const appended = append(context, { stream: removedRows[0]!.stream, events }) as { status: string; receipts: { ordinal: number }[] };
  if (appended.status !== 'stored') throw new DatabaseError('DATABASE_PROTOCOL_ERROR', 'Retention evidence could not be committed.');
  for (const [index, activity] of unique.entries()) {
    const id = String(activity.id), columns = { through, revision: appended.receipts[index]!.ordinal, stream: activity.stream, scope_kind: activity.scope_kind, tenant_id: activity.tenant_id };
    if (db.get('logging_activity_retirements', id)) db.update('logging_activity_retirements', id, columns); else db.createStrict('logging_activity_retirements', { id, ...columns });
    db.delete('logging_activities', id);
    if (db.get('logging_result_views', id)) db.delete('logging_result_views', id);
    const old = db.get('logging_activity_cleanup', id);
    if (old) db.update('logging_activity_cleanup', id, { through, stage: 0, generation: Number(old.generation) + 1 });
    else db.createStrict('logging_activity_cleanup', { id, through, stage: 0, generation: 0 });
  }
}

/** <=100 derived rows per transaction. Durable progress and generation-specific receipts survive worker death/restart. */
export function cleanupLoggingActivities({ db }: DatabaseWriteCommandContext, raw: unknown) {
  const r = loggingRecord(raw, ['id', 'generation']);
  if (typeof r.id !== 'string' || !/^[a-f0-9]{64}$/.test(r.id) || !Number.isSafeInteger(r.generation)) throw new DatabaseError('DATABASE_PAYLOAD_INVALID', 'Invalid activity cleanup request.');
  const job = db.get('logging_activity_cleanup', r.id);
  if (!job || job.generation !== r.generation) return { removed: 0 };
  const stages = [{ table: 'logging_activity_revisions', field: 'activity_id', cutoff: 'ordinal' },
    { table: 'logging_activity_evidence', field: 'activity_id', cutoff: 'linked_at' }, { table: 'logging_result_view_versions', field: 'view_ref', cutoff: null }];
  let removed = 0, stage = Number(job.stage);
  while (stage < stages.length && removed < 100) {
    const task = stages[stage]!, filters = [eq(task.field, r.id)];
    const current = db.get('logging_activities', r.id);
    if (task.cutoff === null && current && Number(current.ordinal) > Number(job.through)) { stage++; continue; }
    const capacity = 100 - removed;
    const rows = db.find(task.table, { filters: [...filters, ...(task.cutoff ? [{ type: 'field' as const, field: task.cutoff, operator: 'lte' as const, value: Number(job.through) }] : [])], select: ['id'], limit: capacity });
    for (const row of rows) db.delete(task.table, String(row.id));
    removed += rows.length;
    if (rows.length < capacity) stage++;
  }
  if (stage === stages.length) db.delete('logging_activity_cleanup', r.id);
  else db.update('logging_activity_cleanup', r.id, { stage, generation: Number(job.generation) + 1 });
  return { removed };
}
export function pendingLoggingActivityCleanup({ database }: DatabaseReadQueryContext) {
  return database.query<{ id: string; generation: number }>('SELECT id,generation FROM logging_activity_cleanup ORDER BY id LIMIT 1').get();
}
