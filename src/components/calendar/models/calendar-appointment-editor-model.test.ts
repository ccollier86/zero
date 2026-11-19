import { expect, test } from 'bun:test';
import type { CalendarAppointmentView } from '../../../calendar/contracts';
import { calendarAppointmentDraftChanged, calendarAppointmentDraftInput, calendarAppointmentDraftResourcesChanged,
  type CalendarAppointmentDraft } from './calendar-appointment-editor-model';

const participant = { kind: 'guardian-user' as const, userId: 'accepted-unavailable' };
const type = { id: 'type-a', revision: 2, label: 'Current synthetic type', durationMinutes: 60, bufferBeforeMinutes: 3, bufferAfterMinutes: 7, colorKey: null };
const record: CalendarAppointmentView = { id: 'appointment', revision: 4, title: 'Accepted', resourceIds: ['a', 'b'], startAt: '2026-11-18T10:07:00.000Z',
  endAt: '2026-11-18T11:07:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 3, bufferAfterMinutes: 7,
  status: 'confirmed', createdBy: 'synthetic', appointmentType: type, visit: { mode: 'phone' } };
const initial: CalendarAppointmentDraft = { resourceIds: ['a', 'b'], title: 'Accepted', date: '2026-11-18', start: 607, end: 667,
  visitMode: 'phone', participants: [participant] };
const page = { items: [{ ...type, active: true }], nextAfter: null, truncated: false };
const shape = (draft: CalendarAppointmentDraft, options: Partial<Parameters<typeof calendarAppointmentDraftInput>[0]> = {}) =>
  calendarAppointmentDraftInput({ draft, record, timeZone: 'UTC', types: page, participantsEnabled: true, initialParticipants: [participant], ...options });

test('all supported scheduling fields and participant replacement form ONE detached full-resource patch', () => {
  const draft = { ...initial, title: 'Changed', resourceIds: ['c', 'b', 'a'], start: 608, end: 668, visitMode: 'video' as const,
    participants: [{ kind: 'guardian-user' as const, userId: 'new-target' }], notes: 'NEVER_WIRE', recurrence: 'NEVER_WIRE' };
  const result = shape(draft);
  expect(result).toEqual({ kind: 'update', input: { title: 'Changed', resourceIds: ['a', 'b', 'c'], startAt: '2026-11-18T10:08:00.000Z',
    endAt: '2026-11-18T11:08:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 3, bufferAfterMinutes: 7,
    appointmentType: { id: type.id, revision: type.revision }, visit: { mode: 'video' }, participants: [{ kind: 'guardian-user', userId: 'new-target' }] } });
  draft.resourceIds.push('later'); draft.participants[0]!.userId = 'later';
  if ('input' in result) { expect(result.input.resourceIds).toEqual(['a', 'b', 'c']); expect(result.input.participants?.[0]?.userId).toBe('new-target'); }
});

test('omission preserves participants, an unchanged set is absent, and [] explicitly clears a loaded base', () => {
  for (const draft of [{ ...initial, participants: undefined }, initial]) {
    const result = shape({ ...draft, title: 'Changed' }); expect(result).toHaveProperty('kind', 'update');
    if ('input' in result) expect(result.input).not.toHaveProperty('participants');
  }
  const clear = shape({ ...initial, participants: [] }); expect(clear).toHaveProperty('input.participants', []);
  expect(shape({ ...initial, participants: [] }, { initialParticipants: null })).toHaveProperty('error');
  expect(shape(initial, { participantsEnabled: false })).toHaveProperty('error');
  const omitted = shape({ ...initial, participants: undefined }, { participantsEnabled: false });
  if ('input' in omitted) expect(omitted.input).not.toHaveProperty('participants');
});

test('historical type acceptance survives only the same resource set; transfers require a current ref or explicit clear', () => {
  expect(shape({ ...initial, title: 'Changed', resourceIds: ['b', 'a'] }, { types: null })).toHaveProperty('kind', 'update');
  const transferred = { ...initial, resourceIds: ['a', 'c'] };
  expect(calendarAppointmentDraftResourcesChanged(transferred, record)).toBe(true);
  expect(shape(transferred, { types: null })).toHaveProperty('error');
  expect(shape(transferred)).toHaveProperty('input.appointmentType', { id: type.id, revision: type.revision });
  expect(shape({ ...transferred, appointmentType: null }, { types: null })).toHaveProperty('input.appointmentType', null);
});

test('sets cannot collapse implicitly, exceed configured caps, duplicate ids or contain invalid ids', () => {
  for (const resourceIds of [[], ['a', 'a'], ['../path'], ['a', 'b', 'c']]) expect(shape({ ...initial, resourceIds }, { maxResources: 2 })).toHaveProperty('error');
  const unchanged = shape({ ...initial, title: 'Changed' });
  if ('input' in unchanged) expect(unchanged.input).not.toHaveProperty('resourceIds');
  expect(shape(initial, { maxResources: 17 })).toHaveProperty('error');
  expect(shape({ ...initial, participants: [participant, { kind: 'guardian-user', userId: 'second' }] }, { maxParticipants: 1 })).toHaveProperty('error');
});

test('meaningful dirty state includes complete resource/participant sets and reverts cleanly without label dirtiness', () => {
  expect(calendarAppointmentDraftChanged(initial, initial, record)).toBe(false);
  expect(calendarAppointmentDraftChanged({ ...initial, resourceIds: ['b', 'a'] }, initial, record)).toBe(false);
  expect(calendarAppointmentDraftChanged({ ...initial, resourceIds: ['a'] }, initial, record)).toBe(true);
  expect(calendarAppointmentDraftChanged({ ...initial, participants: [] }, initial, record)).toBe(true);
  expect(calendarAppointmentDraftChanged({ ...initial, appointmentType: { ...type, label: 'Not an edit' } }, initial, record)).toBe(false);
  expect(calendarAppointmentDraftChanged({ ...initial, title: ' Accepted ' }, initial, record)).toBe(false);
});

test('creation keeps all explicit resources, exact type buffers and native references; invalid time never clips', () => {
  const result = shape({ ...initial, resourceIds: ['b', 'a'], appointmentType: type }, { record: undefined });
  expect(result).toHaveProperty('kind', 'create'); expect(result).toHaveProperty('input.resourceIds', ['a', 'b']);
  expect(result).toHaveProperty('input.participants', [participant]);
  expect(shape(initial, { timeZone: 'Invalid/Zone' })).toHaveProperty('error');
  expect(shape({ ...initial, end: initial.start })).toHaveProperty('error');
});
