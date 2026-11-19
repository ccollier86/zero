/** Private source-only F5 foundation. Pure/cache-off tests create no database, actor or generated output. */
import { expect, test } from 'bun:test';
import { CalendarError, type CalendarErrorCode } from './error';
import { calendarRealm } from './realm';
import { calendarRealm016 } from './test-support/calendar-realm-016';
import { calendarJson } from './validation';
import { admitCalendarTimedSeriesAuthoring, normalizeCalendarTimedSeriesAuthoring, type CalendarTimedSeriesAuthoring } from './series-authoring';

const limits = { maxResources: 16, maxParticipants: 100 };
function input(): CalendarTimedSeriesAuthoring {
  return { kind: 'timed-series-v1', recurrence: { kind: 'timed-local-v1', localStart: '2026-01-01T09:07:03.125', timeZone: 'UTC', fold: 'earlier',
    durationMilliseconds: 37 * 60_000, rule: { frequency: 'daily', interval: 1, end: { kind: 'never' } } },
    template: { resourceIds: ['b', 'a'], title: 'PRIVATE_TITLE', bufferBeforeMinutes: 2, bufferAfterMinutes: 3,
      appointmentType: null, visit: null, participants: [{ kind: 'guardian-user', userId: 'b' }, { kind: 'guardian-user', userId: 'a' }] } };
}
function rejects(run: () => unknown, code: CalendarErrorCode = 'CALENDAR_INPUT_INVALID') {
  try { run(); throw new Error('invalid series authoring accepted'); }
  catch (error) { expect(error).toBeInstanceOf(CalendarError); expect((error as CalendarError).code).toBe(code); expect((error as Error).message).not.toContain('PRIVATE_DIAGNOSTIC'); }
}

test('complete source/template is canonical, detached, deeply frozen and contains only authored facts', () => {
  const raw = input(), normalized = normalizeCalendarTimedSeriesAuthoring(raw, limits);
  expect(normalized).toEqual({ ...raw, template: { ...raw.template, resourceIds: ['a', 'b'], participants: [raw.template.participants[1]!, raw.template.participants[0]!] } });
  expect(calendarJson(normalized)).toBe(calendarJson(normalizeCalendarTimedSeriesAuthoring(JSON.parse(calendarJson(normalized)), limits)));
  for (const value of [normalized, normalized.recurrence, normalized.recurrence.rule, normalized.recurrence.rule.end, normalized.template,
    normalized.template.resourceIds, normalized.template.participants, ...normalized.template.participants]) expect(Object.isFrozen(value)).toBe(true);
  (raw.template.resourceIds as string[]).push('later'); (raw.template.participants[0] as { userId: string }).userId = 'later';
  expect(normalized.template.resourceIds).toEqual(['a', 'b']); expect(normalized.template.participants.map(ref => ref.userId)).toEqual(['a', 'b']);
  expect(Object.keys(normalized).sort()).toEqual(['kind', 'recurrence', 'template']);
  for (const key of ['range', 'limit', 'original', 'actor', 'grant', 'generation', 'publication', 'coverage']) expect(normalized).not.toHaveProperty(key);
});

test('every full-template field is explicit: omission never becomes null, zero buffers or an empty participant fact', () => {
  const raw = input();
  for (const field of Object.keys(raw.template)) {
    const template: Record<string, unknown> = { ...raw.template }; delete template[field];
    rejects(() => normalizeCalendarTimedSeriesAuthoring({ ...raw, template }, limits));
  }
  for (const field of Object.keys(raw)) {
    const partial: Record<string, unknown> = { ...raw }; delete partial[field];
    rejects(() => normalizeCalendarTimedSeriesAuthoring(partial, limits));
  }
  const clear = normalizeCalendarTimedSeriesAuthoring({ ...raw, template: { ...raw.template, participants: [], appointmentType: null, visit: null } }, limits);
  expect(clear.template).toMatchObject({ participants: [], appointmentType: null, visit: null });
  rejects(() => normalizeCalendarTimedSeriesAuthoring({ ...raw, template: { ...raw.template, participants: undefined } }, limits));
});

test('configured caps constrain the full resource/reference sets and reject duplicates or implicit all-resources selection', () => {
  const raw = input();
  expect(normalizeCalendarTimedSeriesAuthoring(raw, { maxResources: 2, maxParticipants: 2 }).template.resourceIds).toHaveLength(2);
  rejects(() => normalizeCalendarTimedSeriesAuthoring(raw, { maxResources: 1, maxParticipants: 2 }));
  rejects(() => normalizeCalendarTimedSeriesAuthoring(raw, { maxResources: 2, maxParticipants: 1 }));
  for (const resourceIds of [[], ['a', 'a'], ['bad/slash'], Array.from({ length: 17 }, (_, i) => 'r' + i)]) {
    rejects(() => normalizeCalendarTimedSeriesAuthoring({ ...raw, template: { ...raw.template, resourceIds } }, limits));
  }
  for (const participants of [null, [raw.template.participants[0]!, raw.template.participants[0]!], [{ kind: 'contact', userId: 'guest' }],
    Array.from({ length: 101 }, (_, i) => ({ kind: 'guardian-user', userId: 'p' + i }))]) {
    rejects(() => normalizeCalendarTimedSeriesAuthoring({ ...raw, template: { ...raw.template, participants } }, limits));
  }
  for (const cap of [{ maxResources: 17, maxParticipants: 100 }, { maxResources: 16, maxParticipants: 101 }, { maxResources: 0, maxParticipants: 100 }]) {
    rejects(() => normalizeCalendarTimedSeriesAuthoring(raw, cap), 'CALENDAR_CONFIG_INVALID');
  }
  const maximum = normalizeCalendarTimedSeriesAuthoring({ ...raw, template: { ...raw.template,
    resourceIds: Array.from({ length: 16 }, (_, i) => 'r' + i), participants: Array.from({ length: 100 }, (_, i) => ({ kind: 'guardian-user', userId: 'p' + i })) } }, limits);
  expect(maximum.template.resourceIds).toHaveLength(16); expect(maximum.template.participants).toHaveLength(100);
});

test('existing type/visit/reference normalizers preserve exact selected identities but reject copied catalog/profile or provider facts', () => {
  const raw = input(), selected = { ...raw, template: { ...raw.template, appointmentType: { id: 'type', revision: 2 },
    visit: { mode: 'in-person', location: { id: 'office', revision: 3 } } } };
  const normalized = normalizeCalendarTimedSeriesAuthoring(selected, limits);
  expect(normalized.template.appointmentType).toEqual({ id: 'type', revision: 2 });
  expect(normalized.template.visit).toEqual({ mode: 'in-person', location: { id: 'office', revision: 3 } });
  expect(Object.isFrozen(normalized.template.appointmentType)).toBe(true); expect(Object.isFrozen(normalized.template.visit)).toBe(true);
  if (normalized.template.visit?.mode !== 'in-person') throw new Error('expected in-person reference');
  expect(Object.isFrozen(normalized.template.visit.location)).toBe(true);
  for (const patch of [{ appointmentType: { id: 'type', revision: 2, label: 'PRIVATE_LABEL' } }, { appointmentType: { id: 'type', revision: 0 } },
    { visit: { mode: 'video', providerUrl: 'PRIVATE_URL' } }, { visit: { mode: 'in-person', location: { id: 'office', revision: 3, address: 'PRIVATE_ADDRESS' } } },
    { participants: [{ kind: 'guardian-user', userId: 'a', name: 'PRIVATE_PROFILE' }] }]) {
    rejects(() => normalizeCalendarTimedSeriesAuthoring({ ...raw, template: { ...raw.template, ...patch } }, limits));
  }
});

test('strict source admission retains original nominal identity and derives an exact buffered interval without a query or authority', () => {
  const raw = input(), admitted = admitCalendarTimedSeriesAuthoring(raw, limits);
  expect(admitted.authoring).toEqual(normalizeCalendarTimedSeriesAuthoring(raw, limits));
  expect(admitted.original).toMatchObject({ nominalKey: 'timed-v1:' + raw.recurrence.localStart, localStart: raw.recurrence.localStart,
    startAt: '2026-01-01T09:07:03.125Z', endAt: '2026-01-01T09:44:03.125Z' });
  expect(admitted.interval).toMatchObject({ startAt: admitted.original.startAt, endAt: admitted.original.endAt,
    occupiedStartMs: Date.parse(admitted.original.startAt) - 2 * 60_000, occupiedEndMs: Date.parse(admitted.original.endAt) + 3 * 60_000 });
  for (const value of [admitted, admitted.authoring, admitted.original, admitted.interval]) expect(Object.isFrozen(value)).toBe(true);
  // Existing/nonexisting resources and participant eligibility are deliberately not claimed by a pure authoring model.
  const opaque = admitCalendarTimedSeriesAuthoring({ ...raw, template: { ...raw.template, resourceIds: ['NONEXISTENT_RESOURCE'],
    participants: [{ kind: 'guardian-user', userId: 'UNRESOLVED_TARGET' }] } }, limits);
  expect(opaque.authoring.template.resourceIds).toEqual(['NONEXISTENT_RESOURCE']);
  expect(Object.keys(opaque).sort()).toEqual(['authoring', 'interval', 'original']);
});

test('elapsed maximum and both maximum buffers remain explicit and unclamped, including UTC boundary years', () => {
  const raw = input(), boundary = { ...raw, recurrence: { ...raw.recurrence, localStart: '9999-12-31T23:30:00.000', durationMilliseconds: 31 * 86_400_000 },
    template: { ...raw.template, bufferBeforeMinutes: 1440, bufferAfterMinutes: 1440 } };
  const admitted = admitCalendarTimedSeriesAuthoring(boundary, limits);
  expect(admitted.interval.endMs - admitted.interval.startMs).toBe(31 * 86_400_000);
  expect(admitted.interval.occupiedEndMs - admitted.interval.occupiedStartMs).toBe(33 * 86_400_000);
  expect(admitted.interval.endAt).toBe('+010000-01-31T23:30:00.000Z');
  rejects(() => admitCalendarTimedSeriesAuthoring({ ...boundary, recurrence: { ...boundary.recurrence, durationMilliseconds: 31 * 86_400_000 + 1 } }, limits));
  for (const buffer of [-1, 1441, 1.5]) for (const field of ['bufferBeforeMinutes', 'bufferAfterMinutes']) {
    rejects(() => admitCalendarTimedSeriesAuthoring({ ...raw, template: { ...raw.template, [field]: buffer } }, limits));
  }
});

test('structural authoring remains Temporal-independent; direct authored gaps/rule mismatches reject only at strict admission', () => {
  const raw = input(), gap = { ...raw, recurrence: { ...raw.recurrence, localStart: '2026-03-08T02:30:00.000', timeZone: 'America/New_York' } };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal'); let touched = 0;
  try {
    Object.defineProperty(globalThis, 'Temporal', { configurable: true, get() { touched++; throw new Error('PRIVATE_DIAGNOSTIC'); } });
    expect(normalizeCalendarTimedSeriesAuthoring(gap, limits).recurrence.localStart).toBe(gap.recurrence.localStart); expect(touched).toBe(0);
    rejects(() => admitCalendarTimedSeriesAuthoring(gap, limits), 'CALENDAR_TIME_RULES_UNAVAILABLE');
  } finally { if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal'); }
  rejects(() => admitCalendarTimedSeriesAuthoring(gap, limits));
  rejects(() => admitCalendarTimedSeriesAuthoring({ ...raw, recurrence: { ...raw.recurrence,
    rule: { frequency: 'weekly', interval: 1, weekdays: [1], end: { kind: 'never' } } } }, limits));
});

test('source/template authority/query fields and hostile descriptors reject without evaluating traps', () => {
  const raw = input(); let touched = 0;
  const getter = { ...raw }; Object.defineProperty(getter, 'template', { enumerable: true, get() { touched++; throw new Error('PRIVATE_DIAGNOSTIC'); } });
  const proxy = new Proxy(raw.template, { getPrototypeOf() { touched++; throw new Error('PRIVATE_DIAGNOSTIC'); }, ownKeys() { touched++; throw new Error('PRIVATE_DIAGNOSTIC'); } });
  for (const bad of [getter, { ...raw, template: proxy }, { ...raw, actor: {} }, { ...raw, grant: {} }, { ...raw, range: {} }, { ...raw, limit: 1 },
    { ...raw, recurrence: { ...raw.recurrence, range: {} } }, { ...raw, template: { ...raw.template, generation: 1 } },
    { ...raw, template: { ...raw.template, timeZone: 'UTC' } }, { ...raw, recurrence: { ...raw.recurrence, kind: 'all-day-v1' } }]) {
    rejects(() => normalizeCalendarTimedSeriesAuthoring(bad, limits)); rejects(() => admitCalendarTimedSeriesAuthoring(bad, limits));
  }
  expect(touched).toBe(0);
  expect(calendarRealm016.version).toBe('16'); expect(calendarRealm016.fingerprint).toBe('sha256:fcfd500b5352a27f6bc43d9122c1af8cdafc85680994f4191ee75903485179f8');
  expect(Object.keys(calendarRealm.commands).some(name => name.includes('series'))).toBe(false);
});
