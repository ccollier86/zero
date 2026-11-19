/** Selection aid only. Native whole-interval eligibility is rechecked in the final writer. */
import type { CalendarAppointmentTypePage, CalendarAppointmentView } from '../../../calendar/contracts';
import type { CalendarAppointmentDraft } from './calendar-appointment-editor-model';
import { calendarAppointmentDraftResourcesChanged } from './calendar-appointment-editor-model';
import { calendarCoreTypeSelection } from './calendar-core-type-model';
import { calendarCoreDraftInterval } from './calendar-workspace-model';
export interface CalendarVisitIntervalProjection {
  readonly interval?: { readonly startAt: string; readonly endAt: string };
  readonly preservesAcceptedInterval: boolean;
  readonly kind: 'timed' | 'retained-all-day' | 'unprojected-all-day' | 'incomplete';
}
const incomplete: CalendarVisitIntervalProjection = Object.freeze({ kind: 'incomplete', preservesAcceptedInterval: false });
function occupied(startAt: string, endAt: string, before: number, after: number): CalendarVisitIntervalProjection['interval'] {
  const from = Date.parse(startAt) - before * 60_000, until = Date.parse(endAt) + after * 60_000;
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(until) || until <= from || until - from > 33 * 86400_000
    || Math.abs(from) > 8_640_000_000_000_000 || Math.abs(until) > 8_640_000_000_000_000) return undefined;
  return Object.freeze({ startAt: new Date(from).toISOString(), endAt: new Date(until).toISOString() });
}
export function calendarVisitIntervalProjection(draft: CalendarAppointmentDraft, timeZone: string,
  types: CalendarAppointmentTypePage | null, record?: CalendarAppointmentView): CalendarVisitIntervalProjection {
  if (draft.intervalKind === 'all-day-local-v1') {
    const accepted = record?.interval;
    if (accepted && accepted.startDate === draft.date && accepted.endDate === draft.endDate && accepted.timeZone === timeZone
      && record.bufferBeforeMinutes === 0 && record.bufferAfterMinutes === 0
      && (draft.bufferBeforeMinutes ?? 0) === 0 && (draft.bufferAfterMinutes ?? 0) === 0) {
      const interval = occupied(record.startAt, record.endAt, 0, 0);
      return interval ? { kind: 'retained-all-day', interval, preservesAcceptedInterval: true } : incomplete;
    }
    return { kind: 'unprojected-all-day', preservesAcceptedInterval: false };
  }
  try {
    const exact = calendarCoreDraftInterval(record ? { ...draft, resourceId: draft.resourceIds[0] ?? '', title: record.title }
      : { ...draft, resourceId: draft.resourceIds[0] ?? '' }, timeZone);
    if ('error' in exact) return incomplete;
    const selected = calendarCoreTypeSelection(draft, types, calendarAppointmentDraftResourcesChanged(draft, record) ? undefined : record?.appointmentType);
    if (!selected.current) return incomplete;
    const before = draft.bufferBeforeMinutes ?? record?.bufferBeforeMinutes ?? selected.snapshot?.bufferBeforeMinutes ?? 0;
    const after = draft.bufferAfterMinutes ?? record?.bufferAfterMinutes ?? selected.snapshot?.bufferAfterMinutes ?? 0;
    if (![before, after].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 1440)) return incomplete;
    if (selected.snapshot && (Date.parse(exact.endAt) - Date.parse(exact.startAt) !== selected.snapshot.durationMinutes * 60_000
      || before !== selected.snapshot.bufferBeforeMinutes || after !== selected.snapshot.bufferAfterMinutes)) return incomplete;
    const interval = occupied(exact.startAt, exact.endAt, before, after); if (!interval) return incomplete;
    return { kind: 'timed', interval, preservesAcceptedInterval: !!record && !record.interval && record.startAt === exact.startAt
      && record.endAt === exact.endAt && record.timeZone === timeZone && record.bufferBeforeMinutes === before && record.bufferAfterMinutes === after };
  } catch { return incomplete; }
}
