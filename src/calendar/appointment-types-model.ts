/** Immutable appointment-type facts and current resource admission policy. */
import type { CalendarReadContext } from './calendar-read-store';
import type { Row } from '../sync/types';
import type { CalendarActor, CalendarAppointmentTypeReplacement, CalendarAppointmentTypeView, CalendarResourceTypesInput } from './contracts';
import { CalendarError } from './error';
import { calendarSelection, eq } from './realm-model';
import { calendarInteger, calendarJson, calendarKey, calendarRecord, calendarText } from './validation';

export interface CalendarTypePointer extends Row { id: string; scope_id: string; revision: number }
export interface CalendarTypeRow extends CalendarTypePointer {
  type_id: string; type_revision: number; label: string; duration_minutes: number; buffer_before: number; buffer_after: number; color_key: string | null; active: number;
}
export interface CalendarTypePolicy { mode: CalendarResourceTypesInput['mode']; typeIds: string[] }
export const CALENDAR_TYPE_JOIN = 'calendar_types t JOIN _calendar_type_history h ON h.scope_id=t.scope_id AND h.type_id=t.id AND h.type_revision=t.revision';

export function requireCalendarTypeManager(actor: CalendarActor): void {
  if (!actor.manageAll) throw new CalendarError('CALENDAR_FORBIDDEN');
}
export function calendarTypeColor(input: unknown): string | null {
  if (input === null) return null;
  if (typeof input !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(input)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return input;
}
export function calendarTypeFields(input: unknown, defaults = false): CalendarAppointmentTypeReplacement {
  const r = calendarRecord(input, ['label', 'durationMinutes', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'colorKey', 'active']);
  const active = defaults && r.active === undefined ? true : r.active;
  if (typeof active !== 'boolean') throw new CalendarError('CALENDAR_INPUT_INVALID');
  return { label: calendarText(r.label), durationMinutes: calendarInteger(r.durationMinutes, 1, 44_640),
    bufferBeforeMinutes: calendarInteger(defaults && r.bufferBeforeMinutes === undefined ? 0 : r.bufferBeforeMinutes, 0, 1_440),
    bufferAfterMinutes: calendarInteger(defaults && r.bufferAfterMinutes === undefined ? 0 : r.bufferAfterMinutes, 0, 1_440),
    colorKey: calendarTypeColor(defaults && r.colorKey === undefined ? null : r.colorKey), active };
}
export function calendarTypePolicy(input: unknown): CalendarTypePolicy {
  const r = calendarRecord(input, ['mode', 'typeIds']), typeIds = calendarSelection(r.typeIds);
  if (!['unrestricted', 'optional', 'required'].includes(r.mode as string) || r.mode === 'unrestricted' && typeIds.length) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return { mode: r.mode as CalendarTypePolicy['mode'], typeIds };
}
export function calendarType(context: CalendarReadContext, actor: CalendarActor, input: unknown): CalendarTypeRow {
  const id = calendarKey(input), pointer = context.db.get('calendar_types', id) as CalendarTypePointer | null;
  if (!pointer || pointer.scope_id !== actor.scopeId) throw new CalendarError('CALENDAR_NOT_FOUND');
  return calendarTypeRevision(context, actor.scopeId, id, pointer.revision);
}
/** Historical snapshots deliberately do not consult the current active flag. */
export function calendarTypeRevision(context: CalendarReadContext, scopeId: string, input: unknown, revisionInput: unknown): CalendarTypeRow {
  const id = calendarKey(input), revision = calendarInteger(revisionInput, 1);
  const history = context.db.find('_calendar_type_history', { filters: [eq('scope_id', scopeId), eq('type_id', id), eq('type_revision', revision)], limit: 2 });
  if (history.length !== 1) throw new CalendarError('CALENDAR_STATE_INVALID');
  const h = history[0]!;
  return { id, scope_id: scopeId, revision, type_id: id, type_revision: revision, label: String(h.label), duration_minutes: Number(h.duration_minutes), buffer_before: Number(h.buffer_before),
    buffer_after: Number(h.buffer_after), color_key: h.color_key as string | null, active: Number(h.active) };
}
export function calendarTypeView(row: CalendarTypeRow): CalendarAppointmentTypeView {
  return { id: row.id, revision: row.revision, label: row.label, durationMinutes: row.duration_minutes,
    bufferBeforeMinutes: row.buffer_before, bufferAfterMinutes: row.buffer_after, colorKey: row.color_key, active: row.active === 1 };
}
export function parseCalendarTypePolicy(mode: unknown, idsJson: unknown): CalendarTypePolicy {
  try {
    if (typeof idsJson !== 'string') throw new Error();
    const policy = calendarTypePolicy({ mode, typeIds: JSON.parse(idsJson) });
    if (calendarJson(policy.typeIds) !== idsJson) throw new Error();
    return policy;
  } catch { throw new CalendarError('CALENDAR_STATE_INVALID'); }
}
export function currentCalendarResourceTypes(context: CalendarReadContext, scopeId: string, resourceId: string): CalendarTypePolicy {
  const pointer = context.db.get('_calendar_resource_types', resourceId);
  if (!pointer) return { mode: 'unrestricted', typeIds: [] };
  if (pointer.scope_id !== scopeId || pointer.resource_id !== resourceId) throw new CalendarError('CALENDAR_STATE_INVALID');
  const history = context.db.find('_calendar_resource_type_history', { filters: [eq('scope_id', scopeId), eq('resource_id', resourceId), eq('resource_revision', calendarInteger(pointer.resource_revision, 2))], limit: 2 });
  if (history.length !== 1) throw new CalendarError('CALENDAR_STATE_INVALID');
  return parseCalendarTypePolicy(history[0]!.mode, history[0]!.type_ids_json);
}
