/** Pure memory-only drafting checks. No runtime store, server, browser or generated output. */
import { expect, test } from 'bun:test';
import type { CalendarAppointmentTypePage, CalendarAppointmentTypeSnapshot, CalendarAppointmentView, CalendarCommandReceipt } from '../../../calendar/contracts';
import type { CalendarCoreDraft } from './calendar-workspace-model';
import { calendarCoreDraftChanged, calendarCoreDraftInput, calendarCoreReceiptRevisionCurrent, calendarCoreTypeDefaults,
  calendarCoreTypeSelection, calendarCoreTypeSnapshot, calendarCoreTypeVersion } from './calendar-core-type-model';

const type: CalendarAppointmentTypeSnapshot = Object.freeze({ id: 'type-a', revision: 3, label: 'PRIVATE_OLD_TYPE', durationMinutes: 45,
  bufferBeforeMinutes: 5, bufferAfterMinutes: 10, colorKey: 'type:blue' });
const page: CalendarAppointmentTypePage = { items: [{ ...type, active: true }], truncated: false, nextAfter: null };
const empty: CalendarAppointmentTypePage = { items: [], truncated: false, nextAfter: null };
const initial: CalendarCoreDraft = { resourceId: 'resource-a', title: 'Synthetic title', date: '2026-11-18', start: 600, end: 630 };
const selected: CalendarCoreDraft = { ...initial, appointmentType: type, end: 645, bufferBeforeMinutes: 5, bufferAfterMinutes: 10 };
const record: CalendarAppointmentView = { id: 'appointment-a', revision: 7, resourceIds: ['resource-a', 'room-b'], title: initial.title,
  startAt: '2026-11-18T15:00:00.000Z', endAt: '2026-11-18T15:45:00.000Z', timeZone: 'America/New_York', bufferBeforeMinutes: 5,
  bufferAfterMinutes: 10, status: 'confirmed', createdBy: 'synthetic-user', appointmentType: type };
function shape(draft: CalendarCoreDraft, source?: CalendarAppointmentView, types = page, participantsEnabled = false) {
  return calendarCoreDraftInput({ draft, timeZone: 'America/New_York', types, record: source, participantsEnabled });
}
test('selecting a type detaches the snapshot and applies exact duration and both buffer defaults without mutating source', () => {
  const result = calendarCoreTypeDefaults(initial, type, 'America/New_York');
  expect(result).toEqual({ change: { appointmentType: type, bufferBeforeMinutes: 5, bufferAfterMinutes: 10, end: 645 } });
  expect(result.change.appointmentType).not.toBe(type); expect(initial.end).toBe(630); expect(type.revision).toBe(3);
  expect(calendarCoreTypeSnapshot(page.items[0]!)).not.toHaveProperty('active');
});
test('manual minute-precise time edits survive and a wrong exact duration or buffers cannot dispatch', () => {
  expect(shape({ ...selected, start: 601, end: 646 })).toMatchObject({ kind: 'create', input: { startAt: '2026-11-18T15:01:00.000Z', endAt: '2026-11-18T15:46:00.000Z' } });
  for (const draft of [{ ...selected, end: 644 }, { ...selected, bufferBeforeMinutes: 4 }, { ...selected, bufferAfterMinutes: 11 }]) {
    expect(shape(draft)).toMatchObject({ error: expect.stringContaining('exact duration') });
  }
  expect(selected.end).toBe(645);
});
test('duration defaults use elapsed instants through spring DST instead of adding wall-clock minutes', () => {
  const spring: CalendarCoreDraft = { ...initial, date: '2026-03-08', start: 90, end: 120 };
  const hour = { ...type, durationMinutes: 60 }, result = calendarCoreTypeDefaults(spring, hour, 'America/New_York');
  expect(result.change.end).toBe(210);
  expect(calendarCoreDraftInput({ draft: { ...spring, ...result.change }, timeZone: 'America/New_York', types: { ...page, items: [{ ...hour, active: true }] } }))
    .toMatchObject({ kind: 'create', input: { startAt: '2026-03-08T06:30:00.000Z', endAt: '2026-03-08T07:30:00.000Z' } });
});
test('nonexistent starts, ambiguous endpoints and end-of-day overflow never clip or guess an offset', () => {
  const hour = { ...type, durationMinutes: 60 };
  for (const draft of [{ ...initial, date: '2026-03-08', start: 150 }, { ...initial, date: '2026-11-01', start: 30 },
    { ...initial, date: '2026-11-01', start: 90 }, { ...initial, start: 1410, end: 1430 }, { ...initial, start: 1380, end: 1410 }]) {
    const result = calendarCoreTypeDefaults(draft, hour, 'America/New_York');
    expect(result.error).toBeString(); expect(result.change).not.toHaveProperty('end'); expect(result.change.appointmentType).toEqual(hour);
  }
  expect(shape({ ...selected, date: '2026-03-08', start: 150, end: 195 })).toHaveProperty('error');
});
test('the source accepted historical generation survives an empty/new current page without following a new label or version', () => {
  const updated = { ...type, revision: 4, label: 'PRIVATE_NEW_TYPE', active: true };
  const current = { ...page, items: [updated] };
  expect(calendarCoreTypeSelection({}, current, type)).toEqual({ current: true, snapshot: type, accepted: true });
  expect(calendarCoreTypeSelection({ appointmentType: type }, empty)).toEqual({ current: false, accepted: false });
  expect(calendarCoreTypeSelection({ appointmentType: type }, empty, type)).toEqual({ current: true, snapshot: type, accepted: true });
  expect(calendarCoreTypeVersion(type)).not.toBe(calendarCoreTypeVersion(updated));
  expect(shape({ ...selected, appointmentType: undefined }, record, current)).toMatchObject({ kind: 'reschedule', input: { bufferBeforeMinutes: 5, bufferAfterMinutes: 10 } });
});
test('unsubmitted selection is unavailable when the current page removes, revises or deactivates that exact generation', () => {
  for (const types of [empty, { ...page, items: [{ ...type, revision: 4, active: true }] }, { ...page, items: [{ ...type, active: false }] }]) {
    expect(calendarCoreTypeSelection(selected, types).current).toBe(false); expect(shape(selected, undefined, types)).toHaveProperty('error');
  }
});
test('preserve, deliberate current-version switch and explicit detach have distinct strict reschedule inputs', () => {
  const preserve = shape({ ...selected, appointmentType: undefined }, record, empty);
  expect(preserve).toMatchObject({ kind: 'reschedule' }); if ('error' in preserve || preserve.kind !== 'reschedule') throw new Error('Expected reschedule.');
  expect(preserve.input).not.toHaveProperty('appointmentType');
  const next = { ...type, revision: 4, label: 'Current label', active: true }, nextPage = { ...page, items: [next] };
  const switched = shape({ ...selected, appointmentType: next }, record, nextPage);
  expect(switched).toMatchObject({ kind: 'reschedule', input: { appointmentType: { id: type.id, revision: 4 } } });
  expect(shape({ ...selected, appointmentType: null }, record, empty)).toMatchObject({ kind: 'reschedule', input: { appointmentType: null, bufferBeforeMinutes: 5, bufferAfterMinutes: 10 } });
  expect(type.label).toBe('PRIVATE_OLD_TYPE'); expect(record.appointmentType).toBe(type);
});
test('strict creation forwards references and supported fields only, with explicit buffers when the user selected defaults', () => {
  const draft = { ...selected, clinical: { state: 'arrived' }, recurrence: { never: true }, visitMode: 'video' as const,
    participants: [{ kind: 'guardian-user' as const, userId: 'native-user', name: 'PRIVATE_NAME', email: 'PRIVATE_CONTACT' }] };
  const result = shape(draft, undefined, page, true); expect(result).toEqual({ kind: 'create', input: { resourceIds: ['resource-a'], title: initial.title,
    startAt: record.startAt, endAt: record.endAt, timeZone: record.timeZone, bufferBeforeMinutes: 5, bufferAfterMinutes: 10,
    appointmentType: { id: type.id, revision: 3 }, visit: { mode: 'video' }, participants: [{ kind: 'guardian-user', userId: 'native-user' }] } });
  const serialized = JSON.stringify(result); for (const privateValue of [type.label, 'colorKey', 'durationMinutes', 'PRIVATE_NAME', 'PRIVATE_CONTACT', 'clinical', 'recurrence']) expect(serialized).not.toContain(privateValue);
});
test('creation preserves omitted buffers/participants, explicit empty participants and disabled UI mode semantics', () => {
  expect(shape(initial)).toEqual({ kind: 'create', input: { resourceIds: ['resource-a'], title: initial.title, startAt: record.startAt,
    endAt: '2026-11-18T15:30:00.000Z', timeZone: record.timeZone } });
  const available = shape(initial, undefined, page, true); expect(available).not.toHaveProperty('input.participants');
  expect(shape({ ...initial, participants: [] }, undefined, page, true)).toHaveProperty('input.participants', []);
  expect(shape({ ...initial, participants: [] })).not.toHaveProperty('input.participants');
  expect(shape({ ...initial, participants: [{ kind: 'guardian-user', userId: '../unsafe' }] }, undefined, page, true)).toHaveProperty('error');
});
test('rescheduling never writes title/resource membership/participants or trusts a replacement fake title', () => {
  const changed = shape({ ...selected, title: '', resourceId: 'wrong-resource', participants: [{ kind: 'guardian-user', userId: 'native-user' }] }, record, page, true);
  expect(changed).toEqual({ kind: 'reschedule', input: { startAt: record.startAt, endAt: record.endAt, timeZone: record.timeZone, bufferBeforeMinutes: 5, bufferAfterMinutes: 10 } });
});
test('buffer input rejects nonfinite, fractional or out-of-policy-range drafts before dispatch', () => {
  for (const value of [NaN, Infinity, -1, 1.5, 1441]) {
    expect(shape({ ...initial, bufferBeforeMinutes: value })).toHaveProperty('error'); expect(shape({ ...initial, bufferAfterMinutes: value })).toHaveProperty('error');
  }
  expect(shape({ ...initial, bufferBeforeMinutes: 1440, bufferAfterMinutes: 0 })).toHaveProperty('kind', 'create');
});
test('dirty state ignores metadata/no-ops, compares meaningful bindings, and returns clean after deliberate reversion', () => {
  expect(calendarCoreDraftChanged({ ...selected }, selected)).toBe(false);
  expect(calendarCoreDraftChanged({ ...selected, appointmentType: { ...type, label: 'Other presentation' } }, selected)).toBe(false);
  expect(calendarCoreDraftChanged({ ...selected, appointmentType: undefined }, selected, record)).toBe(false);
  expect(calendarCoreDraftChanged({ ...selected, appointmentType: null }, selected, record)).toBe(true);
  expect(calendarCoreDraftChanged({ ...initial, bufferBeforeMinutes: 0 }, initial)).toBe(false);
  expect(calendarCoreDraftChanged({ ...initial, participants: [] }, initial)).toBe(true);
  expect(calendarCoreDraftChanged({ ...selected, start: 601 }, selected, record)).toBe(true);
  expect(calendarCoreDraftChanged({ ...selected, title: 'Unsupported edit', participants: [] }, selected, record)).toBe(false);
});
test('receipts must belong to the exact expected source generation, including known no-ops', () => {
  const receipt: CalendarCommandReceipt = { requestId: 'key', operation: 'appointment.rescheduled', id: record.id, revision: 8, changed: true };
  expect(calendarCoreReceiptRevisionCurrent(receipt, record)).toBe(true);
  expect(calendarCoreReceiptRevisionCurrent({ ...receipt, revision: 7 }, record)).toBe(false);
  expect(calendarCoreReceiptRevisionCurrent({ ...receipt, revision: 9 }, record)).toBe(false);
  expect(calendarCoreReceiptRevisionCurrent({ ...receipt, revision: 7, changed: false }, record)).toBe(true);
  expect(calendarCoreReceiptRevisionCurrent({ ...receipt, revision: 1 })).toBe(true);
  expect(calendarCoreReceiptRevisionCurrent({ ...receipt, revision: 2 })).toBe(false);
  expect(calendarCoreReceiptRevisionCurrent({ ...receipt, revision: 1, changed: false })).toBe(false);
});
