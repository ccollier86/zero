/** Shared fresh one-off preparation. Read facts only; neither a scope nor a candidate grants authority. */
import type { CalendarReadContext } from './calendar-read-store';
import type { CalendarActor, CalendarAppointmentTypeReference, CalendarAppointmentTypeSnapshot, CalendarAppointmentUpdateInput, CalendarVisitInput } from './contracts';
import type { CalendarBookingCandidate, CalendarBookingRevalidation } from './booking-admission';
import { CalendarError } from './error';
import { calendarHash, calendarInteger, calendarJson, calendarKey, calendarRecord, calendarText, calendarValue } from './validation';
import { assertCalendarOwner, calendarAppointment, calendarResource, calendarRevision, calendarSelection, requireCalendarRight, type CalendarAppointmentRow } from './realm-model';
import { normalizeCalendarTimedInterval, type CalendarTimedInterval } from './time';
import { calendarAppointmentTypeReference, assertCalendarTypePolicy, normalizeCalendarTypedBooking, normalizeCalendarTypedIntentInterval,
  calendarCurrentAppointmentType, sameCalendarAppointmentType } from './appointment-type-bindings';
import { calendarVisitInput, assertCalendarVisitPolicy, calendarCurrentAppointmentVisit, sameCalendarVisit } from './visit-bindings';
import { calendarParticipantReferences, calendarCurrentAppointmentParticipants, requireCalendarParticipantManager } from './participant-bindings';
import { calendarCurrentResourceMembership } from './appointment-resource-bindings';
import { effectiveCalendarAppointmentStatus, isCalendarLifecycleTerminal } from './lifecycle-model';
import { normalizeCalendarAppointmentTimeIntent, type CalendarAppointmentTimeIntent } from './appointment-time-input';
import { calendarCurrentAppointmentTime, calendarAppointmentTimeHistoryFields, requireCalendarAppointmentTimeStorage, resolveCalendarAppointmentTimeIntent,
  type CalendarAppointmentTimeFact } from './appointment-time-bindings';

export const CALENDAR_APPOINTMENT_UPDATE_FIELDS = Object.freeze([
  'title', 'resourceIds', 'startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'appointmentType', 'visit', 'participants', 'interval',
] as const);
export const CALENDAR_APPOINTMENT_CREATE_FIELDS = Object.freeze(['resourceIds', 'title', 'startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'appointmentType', 'visit', 'participants', 'interval'] as const);
const INTERVAL_FIELDS = ['startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes'] as const;
export type CalendarNormalizedAppointmentUpdate = Readonly<CalendarAppointmentUpdateInput & { readonly interval?: CalendarAppointmentTimeIntent }>;
export function normalizeCalendarAppointmentUpdate(input: unknown): CalendarNormalizedAppointmentUpdate {
  const r = calendarRecord(calendarValue(input), CALENDAR_APPOINTMENT_UPDATE_FIELDS);
  if (!Object.keys(r).length) throw new CalendarError('CALENDAR_INPUT_INVALID');
  const normalized: Record<string, unknown> = {};
  if (Object.hasOwn(r, 'title')) normalized.title = calendarText(r.title, 512);
  if (Object.hasOwn(r, 'resourceIds')) {
    if (!Array.isArray(r.resourceIds) || !r.resourceIds.length || r.resourceIds.length > 16) throw new CalendarError('CALENDAR_INPUT_INVALID');
    const ids = r.resourceIds.map(value => calendarKey(value));
    if (new Set(ids).size !== ids.length) throw new CalendarError('CALENDAR_INPUT_INVALID');
    normalized.resourceIds = Object.freeze(ids.sort());
  }
  if (Object.hasOwn(r, 'interval')) {
    if (INTERVAL_FIELDS.some(field => Object.hasOwn(r, field))) throw new CalendarError('CALENDAR_INPUT_INVALID');
    normalized.interval = normalizeCalendarAppointmentTimeIntent(r.interval);
  } else if (INTERVAL_FIELDS.some(field => Object.hasOwn(r, field))) {
    if (!INTERVAL_FIELDS.every(field => Object.hasOwn(r, field))) throw new CalendarError('CALENDAR_INPUT_INVALID');
    calendarInteger(r.bufferBeforeMinutes, 0, 1440); calendarInteger(r.bufferAfterMinutes, 0, 1440);
    const interval = normalizeCalendarTimedInterval(Object.fromEntries(INTERVAL_FIELDS.map(field => [field, r[field]])));
    for (const field of INTERVAL_FIELDS) normalized[field] = interval[field];
  }
  if (Object.hasOwn(r, 'appointmentType')) normalized.appointmentType = r.appointmentType === null ? null : calendarAppointmentTypeReference(r.appointmentType);
  if (Object.hasOwn(r, 'visit')) normalized.visit = r.visit === null ? null : calendarVisitInput(r.visit);
  if (Object.hasOwn(r, 'participants')) normalized.participants = Object.freeze(calendarParticipantReferences(r.participants).map(ref => Object.freeze(ref)));
  return Object.freeze(normalized) as CalendarNormalizedAppointmentUpdate;
}
export interface CalendarNormalizedAppointmentCreate {
  readonly id: string; readonly title: string; readonly resourceIds: readonly string[];
  readonly input: Readonly<Record<string, unknown>>; readonly intent: readonly unknown[];
  readonly source?: CalendarAppointmentTimeIntent; readonly interval?: CalendarTimedInterval;
  readonly appointmentType?: CalendarAppointmentTypeReference; readonly visit?: CalendarVisitInput;
  readonly participants?: ReturnType<typeof calendarParticipantReferences>;
}
/** Exactly the historical create digest/error order; no fresh selected catalog/default or local-day compilation. */
export function normalizeCalendarAppointmentCreate(context: CalendarReadContext, actor: CalendarActor, idInput: unknown, input: unknown): CalendarNormalizedAppointmentCreate {
  const r = calendarRecord(calendarValue(input), CALENDAR_APPOINTMENT_CREATE_FIELDS), id = calendarKey(idInput);
  assertCalendarOwner(context, actor.scopeId);
  const explicit = Object.hasOwn(r, 'interval');
  if (explicit && INTERVAL_FIELDS.some(field => Object.hasOwn(r, field))) throw new CalendarError('CALENDAR_INPUT_INVALID');
  const title = calendarText(r.title, 512), resourceIds = calendarSelection(r.resourceIds);
  if (!resourceIds.length) throw new CalendarError('CALENDAR_INPUT_INVALID');
  for (const resourceId of resourceIds) {
    const resource = calendarResource(context, actor, resourceId); requireCalendarRight(context, actor, resource, 'book');
    if (!explicit && !resource.active) throw new CalendarError('CALENDAR_FORBIDDEN');
  }
  const appointmentType = calendarAppointmentTypeReference(r.appointmentType), visit = calendarVisitInput(r.visit);
  const participants = Object.hasOwn(r, 'participants') ? calendarParticipantReferences(r.participants) : undefined;
  if (participants !== undefined) requireCalendarParticipantManager(actor);
  const source = explicit ? normalizeCalendarAppointmentTimeIntent(r.interval) : undefined;
  const interval = explicit || appointmentType ? undefined : normalizeCalendarTimedInterval(Object.fromEntries(INTERVAL_FIELDS.map(field => [field, r[field]])));
  const intent: unknown[] = explicit ? ['appointment.create.interval.v1', id, resourceIds, title, source, appointmentType ?? null, visit ?? null, ...(participants === undefined ? [] : [participants])]
    : participants !== undefined ? ['appointment.create.participants.v1', id, resourceIds, title, normalizeCalendarTypedIntentInterval(r), appointmentType ?? null, visit ?? null, participants]
    : visit ? ['appointment.create.visit.v1', id, resourceIds, title, normalizeCalendarTypedIntentInterval(r), appointmentType ?? null, visit]
    : appointmentType ? ['appointment.create.typed.v1', id, resourceIds, title, normalizeCalendarTypedIntentInterval(r), appointmentType]
    : ['appointment.create', id, resourceIds, title, interval];
  return { id, title, resourceIds, input: r, intent, source, interval, appointmentType, visit, participants };
}
export interface CalendarPreparedAppointment extends CalendarBookingCandidate {
  readonly id: string; readonly title: string; readonly action: 'create' | 'update'; readonly expectedRevision: number;
  readonly inputHash: string; readonly fact: CalendarAppointmentTimeFact;
  readonly participants?: ReturnType<typeof calendarParticipantReferences>;
  readonly checks: CalendarBookingRevalidation;
}
export interface CalendarPreparedAppointmentCreate extends CalendarPreparedAppointment { readonly appointmentType?: CalendarAppointmentTypeSnapshot }
export function prepareNormalizedCalendarAppointmentCreate(context: CalendarReadContext, actor: CalendarActor, value: CalendarNormalizedAppointmentCreate): CalendarPreparedAppointmentCreate {
  const { id, title, resourceIds, source, appointmentType, visit, participants } = value;
  if (context.db.get('calendar_appointments', id)) { calendarAppointment(context, actor, id, 'book'); throw new CalendarError('CALENDAR_INTENT_CONFLICT'); }
  for (const resourceId of resourceIds) if (!calendarResource(context, actor, resourceId).active) throw new CalendarError('CALENDAR_FORBIDDEN');
  if (source) requireCalendarAppointmentTimeStorage(context);
  if (source?.kind === 'all-day-local-v1' && appointmentType) throw new CalendarError('CALENDAR_TYPE_CONFLICT');
  assertCalendarTypePolicy(context, actor, resourceIds, appointmentType); assertCalendarVisitPolicy(context, actor, resourceIds, visit);
  const fact = source ? resolveCalendarAppointmentTimeIntent(source) : undefined;
  const booking = appointmentType ? normalizeCalendarTypedBooking(context, actor, resourceIds, fact ? { ...fact.interval } : value.input, appointmentType) : undefined;
  const interval = fact?.interval ?? booking?.interval ?? value.interval!;
  return { id, title, resourceIds, action: 'create', expectedRevision: 0, inputHash: calendarHash(value.intent), interval,
    appointmentType: booking?.appointmentType, visit, participants, fact: fact ?? { kind: 'timed-v1', interval },
    checks: { type: true, visit: true, availabilityResourceIds: resourceIds, occupancy: {} } };
}
export function prepareCalendarAppointmentCreate(context: CalendarReadContext, actor: CalendarActor, id: unknown, input: unknown): CalendarPreparedAppointment {
  return prepareNormalizedCalendarAppointmentCreate(context, actor, normalizeCalendarAppointmentCreate(context, actor, id, input));
}
export interface CalendarPreparedAppointmentUpdate extends CalendarPreparedAppointment {
  readonly action: 'update'; readonly row: CalendarAppointmentRow; readonly oldResources: readonly string[];
  readonly patch: CalendarNormalizedAppointmentUpdate; readonly priorFact: CalendarAppointmentTimeFact;
  readonly currentType: ReturnType<typeof calendarCurrentAppointmentType>; readonly currentVisit: ReturnType<typeof calendarCurrentAppointmentVisit>;
  readonly currentParticipants: ReturnType<typeof calendarCurrentAppointmentParticipants>;
  readonly added: readonly string[]; readonly titleChanged: boolean; readonly resourcesChanged: boolean; readonly occupancyChanged: boolean;
  readonly timeZoneChanged: boolean; readonly typeChanged: boolean; readonly visitChanged: boolean; readonly participantsChanged: boolean;
  readonly kindChanged: boolean; readonly authoredChanged: boolean; readonly changed: boolean;
}
export function prepareCalendarAppointmentUpdate(context: CalendarReadContext, actor: CalendarActor, id: unknown, expected: unknown, input: unknown): CalendarPreparedAppointmentUpdate {
  assertCalendarOwner(context, actor.scopeId);
  const { row, resourceIds: oldResources } = calendarAppointment(context, actor, id, 'manage'), expectedRevision = calendarInteger(expected, 1);
  const patch = normalizeCalendarAppointmentUpdate(input);
  if (Object.hasOwn(patch, 'participants')) requireCalendarParticipantManager(actor);
  if (!calendarCurrentResourceMembership(context)) throw new CalendarError('CALENDAR_NOT_READY');
  calendarRevision(row, expectedRevision);
  if (isCalendarLifecycleTerminal(effectiveCalendarAppointmentStatus(context, row))) throw new CalendarError('CALENDAR_TRANSITION_INVALID');
  const currentType = calendarCurrentAppointmentType(context, actor.scopeId, row.id), currentVisit = calendarCurrentAppointmentVisit(context, actor.scopeId, row.id);
  const currentParticipants = calendarCurrentAppointmentParticipants(context, actor.scopeId, row.id), priorFact = calendarCurrentAppointmentTime(context, row);
  if (Object.hasOwn(patch, 'interval')) requireCalendarAppointmentTimeStorage(context);
  if (priorFact.kind === 'all-day-local-v1' && Object.hasOwn(patch, 'startAt')) throw new CalendarError('CALENDAR_INPUT_INVALID');
  const fact: CalendarAppointmentTimeFact = Object.hasOwn(patch, 'interval') ? resolveCalendarAppointmentTimeIntent(patch.interval, priorFact)
    : Object.hasOwn(patch, 'startAt') ? { kind: 'timed-v1', interval: normalizeCalendarTimedInterval({ startAt: patch.startAt, endAt: patch.endAt, timeZone: patch.timeZone,
      bufferBeforeMinutes: patch.bufferBeforeMinutes, bufferAfterMinutes: patch.bufferAfterMinutes }) } : priorFact;
  const interval = fact.interval, resourceIds = patch.resourceIds ? [...patch.resourceIds] : oldResources, added = resourceIds.filter(id => !oldResources.includes(id));
  const title = patch.title ?? row.title, type = Object.hasOwn(patch, 'appointmentType') ? patch.appointmentType ?? undefined : currentType;
  if (fact.kind === 'all-day-local-v1' && (type || currentType && priorFact.kind !== fact.kind && patch.appointmentType !== null)) throw new CalendarError('CALENDAR_TYPE_CONFLICT');
  const visit = Object.hasOwn(patch, 'visit') ? patch.visit ?? undefined : currentVisit, participants = Object.hasOwn(patch, 'participants') ? [...patch.participants!] : currentParticipants;
  const titleChanged = title !== row.title, resourcesChanged = calendarJson(resourceIds) !== calendarJson(oldResources);
  const occupancyChanged = interval.startMs !== row.start_ms || interval.endMs !== row.end_ms || interval.bufferBeforeMinutes !== row.buffer_before || interval.bufferAfterMinutes !== row.buffer_after;
  const timeZoneChanged = interval.timeZone !== row.time_zone, typeChanged = !sameCalendarAppointmentType(currentType, type), visitChanged = !sameCalendarVisit(currentVisit, visit);
  const kindChanged = priorFact.kind !== fact.kind, authoredChanged = kindChanged || fact.kind === 'all-day-local-v1' && calendarJson(priorFact.intent) !== calendarJson(fact.intent);
  const participantsChanged = calendarJson(currentParticipants) !== calendarJson(participants), changed = titleChanged || resourcesChanged || occupancyChanged || timeZoneChanged || typeChanged || visitChanged || participantsChanged || authoredChanged;
  // Historical no-op does not acquire fresh resulting-book or eligibility requirements.
  if (changed) for (const resourceId of resourceIds) {
    const resource = calendarResource(context, actor, resourceId); requireCalendarRight(context, actor, resource, 'book');
    if ((occupancyChanged || kindChanged || typeChanged || visitChanged || added.includes(resourceId)) && !resource.active) throw new CalendarError('CALENDAR_FORBIDDEN');
  }
  return { id: row.id, title, action: 'update', expectedRevision, inputHash: calendarHash(patch), row, oldResources, patch, priorFact, fact, interval,
    resourceIds, added, appointmentType: type, visit, participants, currentType, currentVisit, currentParticipants,
    titleChanged, resourcesChanged, occupancyChanged, timeZoneChanged, typeChanged, visitChanged, participantsChanged, kindChanged, authoredChanged, changed,
    checks: { type: occupancyChanged || kindChanged || typeChanged || added.length > 0, visit: occupancyChanged || kindChanged || visitChanged || added.length > 0,
      availabilityResourceIds: occupancyChanged || kindChanged ? resourceIds : added,
      occupancy: occupancyChanged || kindChanged || added.length ? { except: { kind: 'appointment', id: row.id } } : false } };
}
export function calendarPreparedAppointmentHash(value: CalendarPreparedAppointment): string {
  return calendarHash(['calendar.prepared.v1', value.action, value.id, value.expectedRevision, value.inputHash, value.title, value.resourceIds,
    value.interval, calendarAppointmentTimeHistoryFields(value.fact), value.appointmentType ?? null, value.visit ?? null,
    value.participants === undefined ? 'omitted' : value.participants]);
}
