import { expect, test } from 'bun:test';
import type { CalendarVisitSnapshot } from '../../../calendar/contracts';
import { calendarLocationVersion, calendarVisitDraft, calendarVisitDraftInput, calendarVisitLabel, calendarVisitSelectionCurrent } from './calendar-visit-model';
const source: CalendarVisitSnapshot = { mode: 'in-person', location: { id: 'location', revision: 2, label: 'Synthetic place', region: 'US-IN' } };
test('untouched visit drafting omits the wire field; explicit unspecified clears a retained binding', () => {
  expect(calendarVisitDraftInput({})).toEqual({});
  expect(calendarVisitDraftInput(calendarVisitDraft(source), source)).toEqual({});
  expect(calendarVisitDraftInput({ visitMode: 'unspecified' }, source)).toEqual({ visit: null });
  expect(calendarVisitDraftInput(calendarVisitDraft({ mode: 'phone' }), { mode: 'phone' })).toEqual({});
});
test('in-person sends only the selected historical identity/version, never a label, region or invented manual address', () => {
  expect(calendarVisitDraftInput(calendarVisitDraft(source))).toEqual({ visit: { mode: 'in-person', location: { id: 'location', revision: 2 } } });
  for (const draft of [{ visitMode: 'in-person' as const }, { visitMode: 'in-person' as const, visitLocation: { ...source.location, revision: 0 } },
    { visitMode: 'in-person' as const, visitLocation: { ...source.location, id: '../private' } }]) expect(calendarVisitDraftInput(draft)).toHaveProperty('error');
  expect(calendarLocationVersion(source.location)).not.toBe(calendarLocationVersion({ ...source.location, revision: 3 }));
});
test('phone/video discard stale location presentation without enabling a telehealth provider', () => {
  expect(calendarVisitDraftInput({ visitMode: 'video', visitLocation: source.location }, source)).toEqual({ visit: { mode: 'video' } });
  expect(calendarVisitDraftInput({ visitMode: 'phone', visitLocation: source.location })).toEqual({ visit: { mode: 'phone' } });
  expect(calendarVisitLabel(source)).toBe('In-person · Synthetic place');
  expect(calendarVisitLabel({ mode: 'video' })).toBe('Video visit');
  expect(calendarVisitLabel()).toBe('Visit mode unspecified');
});
test('only accepted history may remain named when a new selection is absent from the current authorized page', () => {
  const draft = calendarVisitDraft(source), empty = { items: [], truncated: false, nextAfter: null };
  expect(calendarVisitSelectionCurrent(draft, empty)).toBe(false);
  expect(calendarVisitSelectionCurrent(draft, empty, source.location)).toBe(true);
  expect(calendarVisitSelectionCurrent(draft, { ...empty, items: [{ ...source.location, active: true }] })).toBe(true);
  expect(calendarVisitSelectionCurrent(draft, empty, { ...source.location, revision: 3 })).toBe(false);
  expect(calendarVisitSelectionCurrent({ visitMode: 'phone' }, empty)).toBe(true);
  expect(calendarVisitSelectionCurrent({ visitMode: 'in-person' }, empty)).toBe(false);
});
