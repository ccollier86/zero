/** Pure connected-editor shaping; no browser, server or persistence is opened. */
import { expect, test } from 'bun:test';
import type { CalendarAppointmentView } from '../../../calendar/contracts';
import type { CalendarCoreDraft } from './calendar-workspace-model';
import { calendarCoreEditAssignmentChanged, calendarCoreEditChanged, calendarCoreEditResources, calendarCoreUpdateDraftInput } from './calendar-core-update-model';

const record: CalendarAppointmentView = { id: 'appointment', revision: 4, title: 'Accepted title', resourceIds: ['one'],
  startAt: '2026-11-16T10:00:00.000Z', endAt: '2026-11-16T11:00:00.000Z', timeZone: 'UTC',
  bufferBeforeMinutes: 3, bufferAfterMinutes: 7, status: 'confirmed', createdBy: 'synthetic' };
const initial: CalendarCoreDraft = { resourceId: 'one', title: record.title, date: '2026-11-16', start: 600, end: 660 };
const shape = (draft: CalendarCoreDraft, selected = record) => calendarCoreUpdateDraftInput({ draft, record: selected, timeZone: 'UTC', types: null });

test('the update adapter preserves explicit occupancy and whitelists only changed title/resource fields', () => {
  const shaped = shape({ ...initial, title: 'New title', resourceId: 'two', participants: [{ kind: 'guardian-user', userId: 'not-submitted' }] });
  expect(shaped).toEqual({ kind: 'update', input: { title: 'New title', resourceIds: ['two'], startAt: record.startAt,
    endAt: record.endAt, timeZone: 'UTC', bufferBeforeMinutes: 3, bufferAfterMinutes: 7 } });
  expect(calendarCoreEditAssignmentChanged({ ...initial, resourceId: 'two' }, record)).toBe(true);
});

test('the single-calendar control cannot collapse a multi-resource appointment, including forged callbacks', () => {
  const multi = { ...record, resourceIds: ['one', 'two'] };
  expect(calendarCoreEditResources(initial, multi)).toEqual(['one', 'two']);
  expect(calendarCoreEditResources({ ...initial, resourceId: 'three' }, multi)).toEqual(['one', 'two']);
  expect(shape({ ...initial, resourceId: 'three' }, multi)).toHaveProperty('error');
  const valid = shape({ ...initial, title: 'Changed' }, multi);
  expect(valid).toHaveProperty('kind', 'update');
  if ('input' in valid) expect(valid.input).not.toHaveProperty('resourceIds');
});

test('meaningful edit dirty state includes title/transfer and clears after revert without changing legacy creation', () => {
  expect(calendarCoreEditChanged(initial, initial, record)).toBe(false);
  expect(calendarCoreEditChanged({ ...initial, title: 'Changed' }, initial, record)).toBe(true);
  expect(calendarCoreEditChanged({ ...initial, resourceId: 'two' }, initial, record)).toBe(true);
  expect(calendarCoreEditChanged({ ...initial, title: ' ' + initial.title + ' ' }, initial, record)).toBe(false);
  expect(calendarCoreEditChanged({ ...initial, title: 'Changed' }, initial)).toBe(true);
});

test('invalid title, ambiguous/missing local time and missing resource never become a submit-ready patch', () => {
  for (const draft of [{ ...initial, title: '' }, { ...initial, title: 'unsafe\ntext' }, { ...initial, resourceId: '' }]) {
    expect(shape(draft)).toHaveProperty('error');
  }
  expect(calendarCoreUpdateDraftInput({ draft: { ...initial, date: '2026-11-01', start: 90, end: 150 },
    record, types: null, timeZone: 'America/New_York' })).toHaveProperty('error');
});

test('a transferred accepted type is a visible candidate, not a grandfathered or silently cleared selection', () => {
  const appointmentType = { id: 'type-a', revision: 1, label: 'Synthetic type', durationMinutes: 60,
    bufferBeforeMinutes: 3, bufferAfterMinutes: 7, colorKey: null };
  const typed = { ...record, appointmentType }, draft = { ...initial, resourceId: 'two' };
  expect(shape(draft, typed)).toHaveProperty('error');
  const current = calendarCoreUpdateDraftInput({ draft, record: typed, timeZone: 'UTC',
    types: { items: [{ ...appointmentType, active: true }], nextAfter: null, truncated: false } });
  expect(current).toHaveProperty('kind', 'update');
  if ('input' in current) expect(current.input.appointmentType).toEqual({ id: 'type-a', revision: 1 });
  const clear = shape({ ...draft, appointmentType: null }, typed);
  expect(clear).toHaveProperty('kind', 'update');
  if ('input' in clear) expect(clear.input.appointmentType).toBeNull();
});
