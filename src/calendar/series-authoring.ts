/** Private F5 authoring foundation only. Not a series store, grant, coverage proof, command or enabled API. */
import type { ResolvedCalendarConfig } from './config';
import type { CalendarAppointmentTypeReference, CalendarParticipantReference, CalendarVisitInput } from './contracts';
import { calendarAppointmentTypeReference } from './appointment-type-bindings';
import { calendarVisitInput } from './visit-bindings';
import { calendarParticipantReferences } from './participants-validation';
import { admitCalendarTimedRecurrenceSource, normalizeCalendarTimedRecurrenceSource,
  type CalendarRecurrenceOccurrence, type CalendarTimedRecurrenceSource } from './recurrence-engine';
import { CalendarError } from './error';
import { normalizeCalendarTimedInterval, type CalendarTimedInterval } from './time';
import { calendarInteger, calendarKey, calendarRecord, calendarText, calendarValue } from './validation';

/** Complete authored facts. Omission never silently becomes an empty binding or later catalog default. */
export interface CalendarTimedSeriesTemplate {
  readonly resourceIds: readonly string[];
  readonly title: string;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
  readonly appointmentType: CalendarAppointmentTypeReference | null;
  readonly visit: CalendarVisitInput | null;
  readonly participants: readonly CalendarParticipantReference[];
}
export interface CalendarTimedSeriesAuthoring {
  readonly kind: 'timed-series-v1';
  readonly recurrence: Readonly<CalendarTimedRecurrenceSource>;
  readonly template: CalendarTimedSeriesTemplate;
}
export interface CalendarTimedSeriesAuthoringAdmission {
  readonly authoring: CalendarTimedSeriesAuthoring;
  /** The original NOMINAL key remains separate from its engine-qualified effective UTC interval. */
  readonly original: CalendarRecurrenceOccurrence;
  readonly interval: Readonly<CalendarTimedInterval>;
}
export type CalendarSeriesAuthoringLimits = Pick<ResolvedCalendarConfig, 'maxResources' | 'maxParticipants'>;
const TEMPLATE_FIELDS = ['resourceIds', 'title', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'appointmentType', 'visit', 'participants'] as const;
function invalid(): never { throw new CalendarError('CALENDAR_INPUT_INVALID'); }
function limits(input: CalendarSeriesAuthoringLimits): CalendarSeriesAuthoringLimits {
  try {
    const r = calendarRecord(calendarValue(input), ['maxResources', 'maxParticipants']);
    return { maxResources: calendarInteger(r.maxResources, 1, 16), maxParticipants: calendarInteger(r.maxParticipants, 1, 100) };
  } catch { throw new CalendarError('CALENDAR_CONFIG_INVALID'); }
}
/** Only normalized/cloned values reach this traversal. Authored accessors/proxies were rejected before inspection. */
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

/** No Temporal, storage, catalog lookup or authority check. Explicit complete source/template, detached and deeply frozen. */
export function normalizeCalendarTimedSeriesAuthoring(input: unknown, config: CalendarSeriesAuthoringLimits): CalendarTimedSeriesAuthoring {
  const r = calendarRecord(calendarValue(input), ['kind', 'recurrence', 'template']);
  if (r.kind !== 'timed-series-v1') return invalid();
  const t = calendarRecord(r.template, TEMPLATE_FIELDS), cap = limits(config);
  if (TEMPLATE_FIELDS.some(field => !Object.hasOwn(t, field))) return invalid();
  const recurrence = normalizeCalendarTimedRecurrenceSource(r.recurrence);
  if (!Array.isArray(t.resourceIds) || !t.resourceIds.length || t.resourceIds.length > cap.maxResources) return invalid();
  const resourceIds = t.resourceIds.map(id => calendarKey(id)).sort();
  if (new Set(resourceIds).size !== resourceIds.length) return invalid();
  const appointmentType = t.appointmentType === null ? null : calendarAppointmentTypeReference(t.appointmentType);
  const visit = t.visit === null ? null : calendarVisitInput(t.visit);
  if (appointmentType === undefined || visit === undefined) return invalid();
  const participants = calendarParticipantReferences(t.participants);
  if (participants.length > cap.maxParticipants) return invalid();
  return freeze({ kind: r.kind, recurrence, template: { resourceIds, title: calendarText(t.title, 512),
    bufferBeforeMinutes: calendarInteger(t.bufferBeforeMinutes, 0, 1440), bufferAfterMinutes: calendarInteger(t.bufferAfterMinutes, 0, 1440),
    appointmentType, visit, participants } });
}

/** Strict DTSTART/rule/fold roundtrip and existing elapsed/buffer interval bounds only.
 * Type/visit policy, all-resource rights and participant eligibility still require canonical commit admission.
 */
export function admitCalendarTimedSeriesAuthoring(input: unknown, config: CalendarSeriesAuthoringLimits): CalendarTimedSeriesAuthoringAdmission {
  const authoring = normalizeCalendarTimedSeriesAuthoring(input, config), { original } = admitCalendarTimedRecurrenceSource(authoring.recurrence);
  const interval = normalizeCalendarTimedInterval({ startAt: original.startAt, endAt: original.endAt, timeZone: original.timeZone,
    bufferBeforeMinutes: authoring.template.bufferBeforeMinutes, bufferAfterMinutes: authoring.template.bufferAfterMinutes });
  return Object.freeze({ authoring, original, interval: Object.freeze(interval) });
}
