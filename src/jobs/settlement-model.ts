/** Actor-local transactional settlement membership. No request-supplied policy,
 * SQL, effects, timers or original-key mutation occurs in these helpers. */
import type { Database } from 'bun:sqlite';
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import { JobsError } from './error';
import { JOB_SETTLEMENT_KEYS, JOB_SETTLEMENT_SOURCE_TABLE as SOURCES, JOB_SETTLEMENT_SCHEDULE_TABLE as SCHEDULES,
  JOB_SETTLEMENT_OCCURRENCE_TABLE as OCCURRENCES, JOB_SETTLEMENT_USAGE_TABLE as USAGE, JOB_SETTLEMENT_STATE_TABLE as STATE } from './realm-settlement-schema';

type Context = DatabaseWriteCommandContext;
type Getter = Pick<Context['db'], 'get'>;
export interface JobSettlementSnapshot { readonly transportUnits: number; readonly actorControlUnits: number; readonly sourceControlUnits: number }
function invalid(): never { throw new JobsError('JOBS_STATE_INVALID'); }
function number(value: unknown): number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid(); }
function ready(context: Context): boolean {
  const tables = [SOURCES, SCHEDULES, OCCURRENCES, USAGE, STATE], presence = tables.map(table => context.db.hasTable(table));
  // Exact pre-004 compatibility for historical native realm tests/handlers.
  // A current actor's writer policy independently requires the current ledger.
  if (presence.every(present => !present)) return false;
  if (!presence.every(Boolean) || context.db.get(STATE, 'application')?.version !== 4) return invalid();
  return true;
}
function adjust(context: Context, key: string, delta: number): void {
  const retained = context.db.get(USAGE, key); if (!retained) return invalid();
  const next = number(retained.count) + delta;
  if (!Number.isSafeInteger(delta) || !Number.isSafeInteger(next) || next < 0) return invalid();
  if (delta) context.db.update(USAGE, key, { count: next });
}
function control(context: Context, source: boolean, delta: number): void {
  adjust(context, JOB_SETTLEMENT_KEYS.transport, delta);
  adjust(context, source ? JOB_SETTLEMENT_KEYS.sourceControl : JOB_SETTLEMENT_KEYS.actorControl, delta);
}
export function jobOccurrenceSettlementWeight(state: unknown): number {
  if (state === 'pending' || state === 'claimed' || state === 'blocked') return 2;
  if (state === 'dispatched') return 1;
  if (state === 'terminal' || state === 'cancelled') return 0;
  return invalid();
}
export function jobScheduleSettlementWeight(control: unknown, occupied: unknown, source: boolean): number {
  if (!['active', 'paused', 'cancelled'].includes(String(control)) || occupied !== 0 && occupied !== 1 || source && control === 'paused') return invalid();
  if (occupied === 0 || control === 'cancelled') return 0;
  return source || control === 'paused' ? 1 : 2;
}
function sourceValue(context: Context, id: string) {
  const row = context.db.get('_jobs_sources', id);
  if (!row || row.state !== 'active' && row.state !== 'retired' || typeof row.scope_id !== 'string') return invalid();
  return { scope_id: row.scope_id, units: row.state === 'active' ? 1 : 0 };
}
function scheduleValue(context: Context, id: string) {
  const row = context.db.get('job_schedules', id), work = context.db.get('_jobs_schedule_work', id);
  if (!row || !work || row.scope_id !== work.scope_id || work.source_id !== (row.source_id ?? null)
    || !['active', 'paused', 'cancelled'].includes(String(row.control)) || work.occupied !== 0 && work.occupied !== 1) return invalid();
  return { scope_id: String(row.scope_id), source_id: row.source_id === undefined ? null : row.source_id as string | null,
    units: jobScheduleSettlementWeight(row.control, work.occupied, row.source_id !== null && row.source_id !== undefined) };
}
function occurrenceValue(context: Context, id: string) {
  const row = context.db.get('_jobs_occurrences', id);
  if (!row || typeof row.scope_id !== 'string' || typeof row.schedule_id !== 'string') return invalid();
  const parent = context.db.get('job_schedules', row.schedule_id);
  if (!parent || parent.scope_id !== row.scope_id) return invalid();
  return { scope_id: row.scope_id, schedule_id: row.schedule_id, units: jobOccurrenceSettlementWeight(row.state) };
}
export function initializeJobSourceSettlement(context: Context, id: string): void {
  if (!ready(context)) return;
  const value = sourceValue(context, id);
  if (context.db.get(SOURCES, id)) return invalid();
  control(context, true, value.units); context.db.createStrict(SOURCES, { id, ...value });
}
export function refreshJobSourceSettlement(context: Context, id: string): void {
  if (!ready(context)) return;
  const next = sourceValue(context, id), prior = context.db.get(SOURCES, id);
  if (!prior || prior.scope_id !== next.scope_id || number(prior.units) > 1) return invalid();
  const delta = next.units - Number(prior.units);
  control(context, true, delta); if (delta) context.db.update(SOURCES, id, { units: next.units });
}
export function initializeJobScheduleSettlement(context: Context, id: string): void {
  if (!ready(context)) return;
  const value = scheduleValue(context, id);
  if (context.db.get(SCHEDULES, id)) return invalid();
  control(context, value.source_id !== null, value.units); context.db.createStrict(SCHEDULES, { id, ...value });
}
export function refreshJobScheduleSettlement(context: Context, id: string): void {
  if (!ready(context)) return;
  const next = scheduleValue(context, id), prior = context.db.get(SCHEDULES, id);
  if (!prior || prior.scope_id !== next.scope_id || prior.source_id !== next.source_id || number(prior.units) > (next.source_id === null ? 2 : 1)) return invalid();
  const delta = next.units - Number(prior.units);
  control(context, next.source_id !== null, delta); if (delta) context.db.update(SCHEDULES, id, { units: next.units });
}
export function initializeJobOccurrenceSettlement(context: Context, id: string): void {
  if (!ready(context)) return;
  const value = occurrenceValue(context, id);
  if (context.db.get(OCCURRENCES, id)) return invalid();
  adjust(context, JOB_SETTLEMENT_KEYS.transport, value.units); context.db.createStrict(OCCURRENCES, { id, ...value });
}
export function refreshJobOccurrenceSettlement(context: Context, id: string): void {
  if (!ready(context)) return;
  const next = occurrenceValue(context, id), prior = context.db.get(OCCURRENCES, id);
  if (!prior || prior.scope_id !== next.scope_id || prior.schedule_id !== next.schedule_id || number(prior.units) > 2) return invalid();
  const delta = next.units - Number(prior.units);
  adjust(context, JOB_SETTLEMENT_KEYS.transport, delta); if (delta) context.db.update(OCCURRENCES, id, { units: next.units });
}
/** Exactly three PK reads. The native admission hook uses its revocable getter;
 * diagnostics may supply a readonly raw prepared reader. Neither path mutates. */
export function readJobSettlementSnapshot(database: Getter | Pick<Database, 'prepare'>): JobSettlementSnapshot {
  const get = (id: string): number => {
    if ('get' in database) { const row = database.get(USAGE, id); return row ? number(row.count) : invalid(); }
    const statement = database.prepare<{ count: number }, string>('SELECT count FROM ' + USAGE + ' WHERE id=?');
    try { const row = statement.get(id); return row ? number(row.count) : invalid(); }
    finally { statement.finalize(); }
  };
  const transportUnits = get(JOB_SETTLEMENT_KEYS.transport), actorControlUnits = get(JOB_SETTLEMENT_KEYS.actorControl), sourceControlUnits = get(JOB_SETTLEMENT_KEYS.sourceControl);
  if (!Number.isSafeInteger(actorControlUnits + sourceControlUnits) || transportUnits < actorControlUnits + sourceControlUnits) return invalid();
  return Object.freeze({ transportUnits, actorControlUnits, sourceControlUnits });
}
