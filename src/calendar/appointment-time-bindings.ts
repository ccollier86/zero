/** Private 017 stored facts, not a public all-day capability. No repair or current-tzdb read.
 * Call resolve only AFTER original receipt/CAS admission. Omitted intervals use
 * the retained fact directly; identical authored all-day tuples reuse it too.
 */
import type { CalendarReadContext } from './calendar-read-store';
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext } from '../databases/database-realm';
import type { Row } from '../sync/types';
import { normalizeCalendarAllDayInterval, type CalendarAllDayInterval } from './all-day-time';
import { normalizeCalendarAppointmentTimeIntent, type CalendarAppointmentTimeIntent } from './appointment-time-input';
import { CalendarError } from './error';
import { normalizeCalendarInstant, normalizeCalendarTimedInterval, type CalendarTimedInterval } from './time';
import { calendarHash, calendarInteger, calendarJson, calendarKey, calendarRecord, calendarScope, calendarText } from './validation';
import { calendarWorkingHoursDateOrdinal } from './working-hours-model';

export const CALENDAR_APPOINTMENT_TIME_STATE = '_calendar_appointment_time_state';
export const CALENDAR_APPOINTMENT_TIME_HISTORY = '_calendar_appointment_time_history';
export const CALENDAR_APPOINTMENT_TIME_CURRENT = '_calendar_appointment_time_current';
export const CALENDAR_APPOINTMENT_TIME_HISTORY_LIMIT = 100_000;
export type CalendarAppointmentTimeFact = {
  readonly kind: 'timed-v1'; readonly interval: CalendarTimedInterval;
  readonly intent?: Extract<CalendarAppointmentTimeIntent, { kind: 'timed-v1' }>;
} | {
  readonly kind: 'all-day-local-v1'; readonly interval: CalendarAllDayInterval;
  readonly intent: Extract<CalendarAppointmentTimeIntent, { kind: 'all-day-local-v1' }>;
};
function invalid(): never { throw new CalendarError('CALENDAR_STATE_INVALID'); }
const pointerId = (scopeId: string, id: string) => calendarHash(['appointment.time', scopeId, id]);
const eq = (field: string, value: string | number) => ({ type: 'field' as const, field, operator: 'eq' as const, value });

function projection(row: Row, kind: CalendarAppointmentTimeFact['kind']): CalendarTimedInterval {
  const startAt = normalizeCalendarInstant(row.start_at), endAt = normalizeCalendarInstant(row.end_at);
  const startMs = calendarInteger(row.start_ms, -8_640_000_000_000_000, 8_640_000_000_000_000);
  const endMs = calendarInteger(row.end_ms, -8_640_000_000_000_000, 8_640_000_000_000_000);
  const bufferBeforeMinutes = calendarInteger(row.buffer_before, 0, kind === 'timed-v1' ? 1440 : 0);
  const bufferAfterMinutes = calendarInteger(row.buffer_after, 0, kind === 'timed-v1' ? 1440 : 0);
  calendarInteger(endMs - startMs, 1, (kind === 'timed-v1' ? 31 : 33) * 86_400_000);
  const occupiedStartMs = calendarInteger(row.occupied_start_ms, -8_640_000_000_000_000, 8_640_000_000_000_000);
  const occupiedEndMs = calendarInteger(row.occupied_end_ms, -8_640_000_000_000_000, 8_640_000_000_000_000);
  if (Date.parse(startAt) !== startMs || Date.parse(endAt) !== endMs
    || occupiedStartMs !== startMs - bufferBeforeMinutes * 60_000 || occupiedEndMs !== endMs + bufferAfterMinutes * 60_000) invalid();
  calendarInteger(occupiedEndMs - occupiedStartMs, 1, 33 * 86_400_000);
  return Object.freeze({ startAt, endAt, startMs, endMs, timeZone: calendarText(row.time_zone, 128),
    bufferBeforeMinutes, bufferAfterMinutes, occupiedStartMs, occupiedEndMs });
}
function historyFact(row: Row): CalendarAppointmentTimeFact {
  if (row.kind !== 'timed-v1' && row.kind !== 'all-day-local-v1') invalid();
  const interval = projection(row, row.kind);
  if (row.kind === 'timed-v1') {
    if (['start_date', 'end_date', 'day_count', 'authored_time_zone', 'engine_json'].some(field => row[field] !== null)) invalid();
    return Object.freeze({ kind: 'timed-v1', interval });
  }
  const intent = normalizeCalendarAppointmentTimeIntent({ kind: row.kind, startDate: row.start_date, endDate: row.end_date, timeZone: row.authored_time_zone });
  if (intent.kind !== 'all-day-local-v1') invalid();
  const dayCount = calendarInteger(row.day_count, 1, 31);
  if (dayCount !== calendarWorkingHoursDateOrdinal(intent.endDate) - calendarWorkingHoursDateOrdinal(intent.startDate)) invalid();
  const engine = calendarRecord(JSON.parse(calendarText(row.engine_json, 2048)), ['name', 'runtime', 'icu']);
  if (engine.name !== 'temporal-all-day-v1') invalid();
  const provenance = Object.freeze({ name: 'temporal-all-day-v1' as const, runtime: calendarText(engine.runtime, 256), icu: calendarText(engine.icu, 256) });
  return Object.freeze({ kind: 'all-day-local-v1', intent, interval: Object.freeze({ ...interval, kind: 'all-day-local-v1',
    startDate: intent.startDate, endDate: intent.endDate, dayCount, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, engine: provenance }) });
}
function stored(parent: Row, pointer: Row | null, history: Row | null, latest: Row | null): CalendarAppointmentTimeFact {
  try {
    const kind = parent.time_kind;
    if (kind !== 'timed-v1' && kind !== 'all-day-local-v1') invalid();
    calendarInteger(parent.revision, 1);
    if (!pointer && !history && !latest && kind === 'timed-v1') return Object.freeze({ kind, interval: projection(parent, kind) });
    if (!pointer || !history || !latest || pointer.id !== pointerId(String(parent.scope_id), String(parent.id))
      || pointer.scope_id !== parent.scope_id || pointer.appointment_id !== parent.id || pointer.binding_id !== history.id
      || history.scope_id !== parent.scope_id || history.appointment_id !== parent.id || latest.id !== history.id
      || calendarInteger(history.appointment_revision, 1) > Number(parent.revision)) invalid();
    const fact = historyFact(history);
    if (fact.kind !== kind || pointer.kind !== history.kind || pointer.start_date !== history.start_date || pointer.end_date !== history.end_date
      || Object.entries(calendarAppointmentTimeFields(fact)).some(([field, value]) => parent[field] !== value)) invalid();
    return fact;
  } catch { return invalid(); }
}
/** Current017 only: absence is corruption, never a fallback to an old timed schema. */
export function calendarAppointmentTime(context: CalendarReadContext, parent: Row): CalendarAppointmentTimeFact {
  try {
    if (context.db.get(CALENDAR_APPOINTMENT_TIME_STATE, 'application')?.version !== 17) invalid();
    const pointer = context.db.get(CALENDAR_APPOINTMENT_TIME_CURRENT, pointerId(String(parent.scope_id), String(parent.id)));
    const history = pointer ? context.db.get(CALENDAR_APPOINTMENT_TIME_HISTORY, String(pointer.binding_id)) : null;
    const latest = context.db.find(CALENDAR_APPOINTMENT_TIME_HISTORY, { filters: [eq('scope_id', String(parent.scope_id)), eq('appointment_id', String(parent.id))],
      order: [{ field: 'appointment_revision', direction: 'desc' }], limit: 1 })[0] ?? null;
    return stored(parent, pointer, history, latest);
  } catch { return invalid(); }
}
/** Precise pre017 compatibility for original timed command paths. A retained
 * kind or any017 table makes missing metadata corruption, never timed fallback. */
export function calendarCurrentAppointmentTime(context: CalendarReadContext, parent: Row): CalendarAppointmentTimeFact {
  if (parent.time_kind !== undefined || context.db.hasTable(CALENDAR_APPOINTMENT_TIME_STATE)
    || context.db.hasTable(CALENDAR_APPOINTMENT_TIME_CURRENT) || context.db.hasTable(CALENDAR_APPOINTMENT_TIME_HISTORY)) return calendarAppointmentTime(context, parent);
  try { return Object.freeze({ kind: 'timed-v1', interval: projection(parent, 'timed-v1') }); } catch { return invalid(); }
}
export function requireCalendarAppointmentTimeStorage(context: CalendarReadContext): void {
  if (!context.db.hasTable(CALENDAR_APPOINTMENT_TIME_STATE)) throw new CalendarError('CALENDAR_NOT_READY');
  if (context.db.get(CALENDAR_APPOINTMENT_TIME_STATE, 'application')?.version !== 17) invalid();
}
export function readCalendarAppointmentTime(context: DatabaseReadQueryContext, parent: Row): CalendarAppointmentTimeFact {
  try {
    if (context.database.query<{ version: number }>(`SELECT version FROM ${CALENDAR_APPOINTMENT_TIME_STATE} WHERE id='application'`).get()?.version !== 17) invalid();
    const pointer = context.database.query<Row>(`SELECT * FROM ${CALENDAR_APPOINTMENT_TIME_CURRENT} WHERE scope_id=? AND appointment_id=?`).get(String(parent.scope_id), String(parent.id));
    const history = pointer ? context.database.query<Row>(`SELECT * FROM ${CALENDAR_APPOINTMENT_TIME_HISTORY} WHERE id=?`).get(String(pointer.binding_id)) : null;
    const latest = context.database.query<Row>(`SELECT * FROM ${CALENDAR_APPOINTMENT_TIME_HISTORY} WHERE scope_id=? AND appointment_id=? ORDER BY appointment_revision DESC LIMIT 1`).get(String(parent.scope_id), String(parent.id));
    return stored(parent, pointer, history, latest);
  } catch { return invalid(); }
}
/** Genuine pre017 read compatibility only. Current kind/schema or applied017
 * evidence forbids falling back when authoritative metadata is missing. */
export function readCalendarCurrentAppointmentTime(context: DatabaseReadQueryContext, parent: Row): CalendarAppointmentTimeFact {
  if (parent.time_kind !== undefined || context.database.query("SELECT 1 FROM sqlite_schema WHERE name IN (?,?,?) LIMIT 1")
    .get(CALENDAR_APPOINTMENT_TIME_STATE, CALENDAR_APPOINTMENT_TIME_CURRENT, CALENDAR_APPOINTMENT_TIME_HISTORY)) return readCalendarAppointmentTime(context, parent);
  try {
    if (context.database.query("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='_zero_migrations'").get()
      && context.database.query("SELECT 1 FROM _zero_migrations WHERE version='017' AND direction='up' AND status='applied' LIMIT 1").get()) invalid();
    return Object.freeze({ kind: 'timed-v1' as const, interval: projection(parent, 'timed-v1') });
  } catch { return invalid(); }
}
export function resolveCalendarAppointmentTimeIntent(input: unknown, current?: CalendarAppointmentTimeFact): CalendarAppointmentTimeFact {
  const intent = normalizeCalendarAppointmentTimeIntent(input);
  if (intent.kind === 'all-day-local-v1' && current?.kind === intent.kind && current.intent && calendarJson(current.intent) === calendarJson(intent)) return current;
  if (intent.kind === 'all-day-local-v1') return Object.freeze({ kind: intent.kind, intent, interval: normalizeCalendarAllDayInterval(intent) });
  return Object.freeze({ kind: intent.kind, intent, interval: normalizeCalendarTimedInterval({ startAt: intent.startAt, endAt: intent.endAt, timeZone: intent.timeZone,
    bufferBeforeMinutes: intent.bufferBeforeMinutes, bufferAfterMinutes: intent.bufferAfterMinutes }) });
}
export function calendarAppointmentTimeFields(fact: CalendarAppointmentTimeFact): Row {
  const i = fact.interval;
  return { time_kind: fact.kind, start_at: i.startAt, end_at: i.endAt, start_ms: i.startMs, end_ms: i.endMs, time_zone: i.timeZone,
    buffer_before: i.bufferBeforeMinutes, buffer_after: i.bufferAfterMinutes, occupied_start_ms: i.occupiedStartMs, occupied_end_ms: i.occupiedEndMs };
}
/** Add to016 before/after snapshots only for LocalDate facts. Legacy timed JSON is unchanged. */
export function calendarAppointmentTimeHistoryFields(fact: CalendarAppointmentTimeFact): Row {
  if (fact.kind === 'timed-v1') return {};
  if (!fact.intent || fact.intent.kind !== 'all-day-local-v1') return invalid();
  return { interval: fact.intent };
}
/** Parent/reservations/catalog bindings first; receipt/effect last, in the SAME native transaction.
 * No history for ordinary legacy timed appointments, no new row for retained facts.
 */
export function bindCalendarAppointmentTime(context: DatabaseWriteCommandContext, scope: string, id: string, revision: number, fact: CalendarAppointmentTimeFact): void {
  const scopeId = calendarScope(scope), appointmentId = calendarKey(id); calendarInteger(revision, 1);
  if (context.db.get(CALENDAR_APPOINTMENT_TIME_STATE, 'application')?.version !== 17) invalid();
  const parent = context.db.get('calendar_appointments', appointmentId);
  if (!parent || parent.scope_id !== scopeId || parent.revision !== revision
    || Object.entries(calendarAppointmentTimeFields(fact)).some(([field, value]) => parent[field] !== value)) invalid();
  const identity = pointerId(scopeId, appointmentId), pointer = context.db.get(CALENDAR_APPOINTMENT_TIME_CURRENT, identity);
  const previous = pointer ? context.db.get(CALENDAR_APPOINTMENT_TIME_HISTORY, String(pointer.binding_id)) : null;
  const latest = context.db.find(CALENDAR_APPOINTMENT_TIME_HISTORY, {
    filters: [eq('scope_id', scopeId), eq('appointment_id', appointmentId)], order: [{ field: 'appointment_revision', direction: 'desc' }], limit: 1 })[0] ?? null;
  if (pointer && !previous || !pointer && latest) invalid();
  if (previous) {
    let retained: CalendarAppointmentTimeFact;
    try { retained = stored({ ...parent, ...calendarAppointmentTimeFields(historyFact(previous)) }, pointer, previous, latest); }
    catch { return invalid(); }
    if (retained.kind === fact.kind && calendarJson(calendarAppointmentTimeFields(retained)) === calendarJson(calendarAppointmentTimeFields(fact))
      && (fact.kind === 'timed-v1' || calendarJson(retained.intent) === calendarJson(fact.intent))) return;
  } else if (fact.kind === 'timed-v1') return;
  const interval = fact.interval, allDay = fact.kind === 'all-day-local-v1' ? interval as CalendarAllDayInterval : undefined;
  if (allDay && (!fact.intent || fact.intent.kind !== 'all-day-local-v1')) invalid();
  const row: Row = { id: calendarHash(['appointment.time.v1', scopeId, appointmentId, revision]), scope_id: scopeId, appointment_id: appointmentId,
    appointment_revision: revision, kind: fact.kind, start_date: allDay?.startDate ?? null, end_date: allDay?.endDate ?? null,
    day_count: allDay?.dayCount ?? null, authored_time_zone: allDay ? fact.intent!.timeZone : null,
    ...Object.fromEntries(Object.entries(calendarAppointmentTimeFields(fact)).filter(([field]) => field !== 'time_kind')),
    engine_json: allDay ? calendarJson(allDay.engine) : null };
  try { historyFact(row); } catch { return invalid(); }
  const usage = context.db.get('_calendar_usage', 'appointmentTimeHistory'), count = usage ? calendarInteger(usage.count) : 0;
  if (count >= CALENDAR_APPOINTMENT_TIME_HISTORY_LIMIT) throw new CalendarError('CALENDAR_CAPACITY');
  if (usage) context.db.update('_calendar_usage', 'appointmentTimeHistory', { count: count + 1 });
  else context.db.createStrict('_calendar_usage', { id: 'appointmentTimeHistory', count: 1 });
  context.db.createStrict(CALENDAR_APPOINTMENT_TIME_HISTORY, row);
  const selected = { binding_id: row.id, kind: row.kind, start_date: row.start_date, end_date: row.end_date };
  if (pointer) context.db.update(CALENDAR_APPOINTMENT_TIME_CURRENT, identity, selected);
  else context.db.createStrict(CALENDAR_APPOINTMENT_TIME_CURRENT, { id: identity, scope_id: scopeId, appointment_id: appointmentId, ...selected });
}
