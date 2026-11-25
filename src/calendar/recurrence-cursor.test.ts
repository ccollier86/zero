/** Pure native Temporal diagnostics only: no files, servers, DB fixtures or builds. */
import { expect, test } from 'bun:test';
import { CalendarError, type CalendarErrorCode } from './error';
import { advanceCalendarRecurrenceCursor, continueCalendarRecurrenceNominalWindow, createCalendarRecurrenceCursor,
  inspectCalendarRecurrenceCursor, restoreCalendarRecurrenceCursor,
  type CalendarRecurrenceCursor, type CalendarRecurrenceCursorInput } from './recurrence-cursor';
import { CALENDAR_RECURRENCE_MAX_CANDIDATES, materializeCalendarRecurrence, type CalendarRecurrenceRule,
  type CalendarTimedRecurrenceSource } from './recurrence-engine';
import { calendarHash } from './validation';

function source(patch: Partial<CalendarTimedRecurrenceSource> = {}): CalendarTimedRecurrenceSource {
  return { kind: 'timed-local-v1', localStart: '2026-01-01T09:00:00.000', timeZone: 'UTC', fold: 'earlier', durationMilliseconds: 60_000,
    rule: { frequency: 'daily', interval: 1, end: { kind: 'never' } }, ...patch };
}
function input(patch: Partial<CalendarRecurrenceCursorInput> = {}): CalendarRecurrenceCursorInput {
  return { binding: { scopeId: 'tenant:cursor-test', seriesId: 'series-1', segmentId: 'segment-1', sourceGeneration: 1 }, source: source(),
    range: { from: '2026-01-01', until: '2026-01-05' }, ...patch };
}
function rejects(run: () => unknown, code: CalendarErrorCode = 'CALENDAR_INPUT_INVALID') {
  try { run(); throw new Error('invalid cursor accepted'); }
  catch (error) { expect(error).toBeInstanceOf(CalendarError); expect((error as CalendarError).code).toBe(code); expect((error as Error).message).not.toContain('PRIVATE_DIAGNOSTIC'); }
}
function checkpointDigest(checkpoint: unknown): string { return calendarHash({ domain: 'calendar-recurrence-checkpoint-v1', checkpoint }); }
function dates(occurrences: readonly { localStart: string }[]): string[] { return occurrences.map(value => value.localStart.slice(0, 10)); }
function drain(value: CalendarRecurrenceCursorInput, candidateLimit = 2, occurrenceLimit = 1, initialCursor?: CalendarRecurrenceCursor) {
  let cursor = initialCursor ?? createCalendarRecurrenceCursor(value), total = 0, batches = 0;
  const occurrences: ReturnType<typeof advanceCalendarRecurrenceCursor>['occurrences'][number][] = [];
  for (;;) {
    const batch = advanceCalendarRecurrenceCursor(cursor, { candidateLimit, occurrenceLimit });
    expect(batch.evaluatedCandidates).toBeLessThanOrEqual(candidateLimit); expect(batch.occurrences.length).toBeLessThanOrEqual(occurrenceLimit);
    batches++; total += batch.evaluatedCandidates; occurrences.push(...batch.occurrences);
    if (batch.checkpoint.status !== 'active') return { ...batch, total, batches, occurrences };
    expect(batch.checkpoint.nextCandidate).toBeGreaterThan(inspectCalendarRecurrenceCursor(cursor).checkpoint.nextCandidate);
    if (batches > 10_000) throw new Error('cursor did not progress');
    // Simulate source-owned durable recovery after every bounded batch.
    cursor = restoreCalendarRecurrenceCursor(value, JSON.parse(JSON.stringify(batch.checkpoint)), batch.digest);
  }
}

test('cursor checkpoints are deterministic frozen source/identity/generation/engine facts, not JSON capabilities', () => {
  const value = input(), cursor = createCalendarRecurrenceCursor(value), first = inspectCalendarRecurrenceCursor(cursor);
  expect(first.checkpoint.binding).toEqual(value.binding); expect(first.checkpoint.sourceDigest).toBe(calendarHash(value.source));
  expect(first.checkpoint.engine.name).toBe('temporal-recurrence-v1'); expect(first.checkpoint.engine.runtime).toBe('bun:' + Bun.version);
  expect(first.checkpoint.engine.implementation).toContain(Bun.revision);
  expect(first.checkpoint.engine.compilerSemantics).toBe('timed-local-recurrence-v2');
  expect(first.checkpoint).not.toHaveProperty('coverage'); expect(first.checkpoint).not.toHaveProperty('grant');
  for (const object of [cursor, first, first.checkpoint, first.checkpoint.binding, first.checkpoint.engine, first.checkpoint.range, first.checkpoint.skipped]) expect(Object.isFrozen(object)).toBe(true);
  const batch = advanceCalendarRecurrenceCursor(cursor, { candidateLimit: 2, occurrenceLimit: 1 });
  expect(advanceCalendarRecurrenceCursor(cursor, { candidateLimit: 2, occurrenceLimit: 1 })).toEqual(batch);
  expect(inspectCalendarRecurrenceCursor(cursor)).toEqual(first);
  expect(inspectCalendarRecurrenceCursor(createCalendarRecurrenceCursor(value))).toEqual(first);
  for (const forged of [{}, { ...cursor }, JSON.parse(JSON.stringify(cursor)), first.checkpoint]) rejects(() => advanceCalendarRecurrenceCursor(forged as CalendarRecurrenceCursor), 'CALENDAR_FORBIDDEN');
  const restored = restoreCalendarRecurrenceCursor(value, JSON.parse(JSON.stringify(first.checkpoint)), first.digest);
  expect(advanceCalendarRecurrenceCursor(restored, { candidateLimit: 2, occurrenceLimit: 1 })).toEqual(batch);
});

test('candidate and output budgets resume without loss, duplicates or a false exact-cap truncation', () => {
  const value = input({ source: source({ rule: { frequency: 'daily', interval: 1, end: { kind: 'after', count: 4 } } }) });
  const result = drain(value, 1, 1);
  expect(dates(result.occurrences)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
  expect(result.total).toBe(4); expect(result.batches).toBe(4); expect(result.stop).toBe('source-complete'); expect(result.checkpoint.rruleCount).toBe(4);
  const replay = advanceCalendarRecurrenceCursor(result.cursor, { candidateLimit: 1, occurrenceLimit: 1 });
  expect(replay.evaluatedCandidates).toBe(0); expect(replay.occurrences).toEqual([]); expect(replay.digest).toBe(result.digest);
});

test('zero-output invalid-date batches advance and preserve exact COUNT across recovery', () => {
  const value = input({ source: source({ localStart: '2026-01-31T09:00:00.000',
    rule: { frequency: 'monthly', interval: 1, pattern: { kind: 'day', day: 31 }, end: { kind: 'after', count: 3 } } }),
    range: { from: '2026-01-01', until: '2026-06-01' } });
  const first = advanceCalendarRecurrenceCursor(createCalendarRecurrenceCursor(value), { candidateLimit: 1 });
  const gap = advanceCalendarRecurrenceCursor(restoreCalendarRecurrenceCursor(value, first.checkpoint, first.digest), { candidateLimit: 1 });
  expect(gap.occurrences).toEqual([]); expect(gap.skipped.invalidDates).toBe(1); expect(gap.checkpoint.nextCandidate).toBe(2); expect(gap.checkpoint.rruleCount).toBe(1);
  const result = drain(value, 1); expect(dates(result.occurrences)).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
  expect(result.checkpoint.rruleCount).toBe(3); expect(result.checkpoint.skipped.invalidDates).toBe(2); expect(result.total).toBe(5);
});

test('zero-output generated DST gaps and wholly skipped civil dates never consume COUNT', () => {
  for (const [localStart, timeZone, expected] of [
    ['2026-03-07T02:30:00.000', 'America/New_York', ['2026-03-07', '2026-03-09', '2026-03-10']],
    ['2026-10-03T02:15:00.000', 'Australia/Lord_Howe', ['2026-10-03', '2026-10-05', '2026-10-06']],
    ['2011-12-29T09:00:00.000', 'Pacific/Apia', ['2011-12-29', '2011-12-31', '2012-01-01']],
  ] as const) for (const fold of ['earlier', 'later'] as const) {
    const value = input({ source: source({ localStart, timeZone, fold, rule: { frequency: 'daily', interval: 1, end: { kind: 'after', count: 3 } } }),
      range: { from: expected[0], until: expected[2].slice(0, 8) + String(Number(expected[2].slice(8)) + 1).padStart(2, '0') } });
    const first = advanceCalendarRecurrenceCursor(createCalendarRecurrenceCursor(value), { candidateLimit: 1 });
    const gap = advanceCalendarRecurrenceCursor(first.cursor, { candidateLimit: 1 });
    expect(gap.occurrences).toEqual([]); expect(gap.skipped.nonexistentTimes).toBe(1); expect(gap.checkpoint.rruleCount).toBe(1); expect(gap.checkpoint.nextCandidate).toBe(2);
    const result = drain(value, 1); expect(dates(result.occurrences)).toEqual([...expected]); expect(result.checkpoint.rruleCount).toBe(3);
    expect(result.checkpoint.skipped.nonexistentTimes).toBe(1); expect(result.total).toBe(4);
  }
});

test('long sparse counted histories pass the old hard ceiling once, then resume to exhaustion without a forever retry', () => {
  const value = input({ source: source({ localStart: '0000-02-29T09:00:00.000', rule: { frequency: 'yearly', interval: 1, end: { kind: 'after', count: 999 } } }),
    range: { from: '9000-01-01', until: '9000-02-01' } });
  const first = advanceCalendarRecurrenceCursor(createCalendarRecurrenceCursor(value));
  expect(first.stop).toBe('candidate-limit'); expect(first.evaluatedCandidates).toBe(CALENDAR_RECURRENCE_MAX_CANDIDATES); expect(first.occurrences).toEqual([]);
  expect(first.checkpoint.nextCandidate).toBe(4096); expect(first.checkpoint.status).toBe('active');
  const second = advanceCalendarRecurrenceCursor(restoreCalendarRecurrenceCursor(value, JSON.parse(JSON.stringify(first.checkpoint)), first.digest));
  expect(second.stop).toBe('source-complete'); expect(second.occurrences).toEqual([]); expect(second.evaluatedCandidates).toBeLessThan(100);
  expect(second.checkpoint.rruleCount).toBe(999); expect(second.checkpoint.nextCandidate).toBe(first.checkpoint.nextCandidate + second.evaluatedCandidates);
  expect(second.checkpoint.examinedCandidates).toBe(first.evaluatedCandidates + second.evaluatedCandidates);
});

test('uncounted arbitrary sparse dates seek directly, while COUNT never invents an unqualified prefix', () => {
  const value = input({ source: source({ localStart: '0000-01-01T09:00:00.000' }), range: { from: '9999-01-01', until: '9999-01-03' } });
  const current = drain(value, 1); expect(current.total).toBe(2); expect(current.occurrences.length).toBe(2); expect(current.checkpoint.rruleCount).toBeNull();
  expect(inspectCalendarRecurrenceCursor(createCalendarRecurrenceCursor(value)).checkpoint.nextCandidate).toBeGreaterThan(3_000_000);
  const counted = drain({ ...value, source: { ...value.source, rule: { frequency: 'daily', interval: 1, end: { kind: 'after', count: 3 } } } }, 1);
  expect(counted.total).toBe(3); expect(counted.occurrences).toEqual([]); expect(counted.stop).toBe('source-complete');
});

test('COUNT continues across contiguous and disjoint monthly windows without replaying its invalid-date prefix', () => {
  const value = input({ source: source({ localStart: '2026-01-31T09:00:00.000',
    rule: { frequency: 'monthly', interval: 1, pattern: { kind: 'day', day: 31 }, end: { kind: 'after', count: 8 } } }),
    range: { from: '2026-01-01', until: '2026-02-01' } });
  const first = drain(value, 1); expect(first.stop).toBe('range-complete'); expect(first.total).toBe(1);
  const nextRange = { from: '2026-02-01', until: '2026-04-01' }, nextValue = { ...value, range: nextRange };
  const continued = continueCalendarRecurrenceNominalWindow(first.cursor, nextRange), progress = inspectCalendarRecurrenceCursor(continued);
  expect(progress.checkpoint).toEqual({ ...first.checkpoint, range: nextRange, status: 'active' });
  expect(inspectCalendarRecurrenceCursor(first.cursor)).toEqual({ checkpoint: first.checkpoint, digest: first.digest });
  expect(inspectCalendarRecurrenceCursor(continueCalendarRecurrenceNominalWindow(first.cursor, nextRange))).toEqual(progress);
  const recoveredFirst = restoreCalendarRecurrenceCursor(value, JSON.parse(JSON.stringify(first.checkpoint)), first.digest);
  expect(inspectCalendarRecurrenceCursor(continueCalendarRecurrenceNominalWindow(recoveredFirst, nextRange))).toEqual(progress);
  const recoveredNext = restoreCalendarRecurrenceCursor(nextValue, JSON.parse(JSON.stringify(progress.checkpoint)), progress.digest);
  const second = drain(nextValue, 1, 1, recoveredNext);
  expect(dates(second.occurrences)).toEqual(['2026-03-31']); expect(second.total).toBe(2);
  expect(second.checkpoint).toMatchObject({ nextCandidate: 3, examinedCandidates: 3, rruleCount: 2, skipped: { invalidDates: 1, nonexistentTimes: 0 } });
  const laterValue = { ...value, range: { from: '2026-06-01', until: '2026-09-01' } };
  const later = drain(laterValue, 1, 1, continueCalendarRecurrenceNominalWindow(second.cursor, laterValue.range));
  expect(dates(later.occurrences)).toEqual(['2026-07-31', '2026-08-31']); expect(later.total).toBe(5);
  // May is outside the requested window but is still a valid RRULE instance.
  expect(later.checkpoint).toMatchObject({ nextCandidate: 8, examinedCandidates: 8, rruleCount: 5, skipped: { invalidDates: 3, nonexistentTimes: 0 } });
  expect(later.checkpoint.sourceDigest).toBe(first.checkpoint.sourceDigest); expect(later.checkpoint.originalDigest).toBe(first.checkpoint.originalDigest);
  expect(later.checkpoint.binding).toEqual(first.checkpoint.binding); expect(later.checkpoint.engine).toEqual(first.checkpoint.engine);
});

test('yearly invalid-date COUNT and monthly timezone gaps retain zero-output progress across later windows', () => {
  const leap = input({ source: source({ localStart: '2024-02-29T09:00:00.000', rule: { frequency: 'yearly', interval: 1, end: { kind: 'after', count: 5 } } }),
    range: { from: '2024-01-01', until: '2025-01-01' } });
  const first = drain(leap, 1), gapValue = { ...leap, range: { from: '2026-01-01', until: '2027-01-01' } };
  const gaps = drain(gapValue, 1, 1, continueCalendarRecurrenceNominalWindow(first.cursor, gapValue.range));
  expect(gaps.occurrences).toEqual([]); expect(gaps.total).toBe(2);
  expect(gaps.checkpoint).toMatchObject({ nextCandidate: 3, examinedCandidates: 3, rruleCount: 1, skipped: { invalidDates: 2, nonexistentTimes: 0 } });
  const leapValue = { ...leap, range: { from: '2028-01-01', until: '2029-01-01' } };
  const nextLeap = drain(leapValue, 1, 1, continueCalendarRecurrenceNominalWindow(gaps.cursor, leapValue.range));
  expect(dates(nextLeap.occurrences)).toEqual(['2028-02-29']); expect(nextLeap.total).toBe(2);
  expect(nextLeap.checkpoint).toMatchObject({ nextCandidate: 5, examinedCandidates: 5, rruleCount: 2, skipped: { invalidDates: 3, nonexistentTimes: 0 } });

  const monthly = input({ source: source({ localStart: '2026-09-04T02:15:00.000', timeZone: 'Australia/Lord_Howe',
    rule: { frequency: 'monthly', interval: 1, pattern: { kind: 'day', day: 4 }, end: { kind: 'after', count: 3 } } }),
    range: { from: '2026-09-01', until: '2026-10-01' } });
  const september = drain(monthly, 1), octoberValue = { ...monthly, range: { from: '2026-10-01', until: '2026-11-01' } };
  const october = drain(octoberValue, 1, 1, continueCalendarRecurrenceNominalWindow(september.cursor, octoberValue.range));
  expect(october.total).toBe(1); expect(october.occurrences).toEqual([]); expect(october.checkpoint.rruleCount).toBe(1); expect(october.checkpoint.skipped.nonexistentTimes).toBe(1);
  const novemberValue = { ...monthly, range: { from: '2026-11-01', until: '2026-12-01' } };
  const november = drain(novemberValue, 1, 1, continueCalendarRecurrenceNominalWindow(october.cursor, novemberValue.range));
  expect(november.total).toBe(1); expect(dates(november.occurrences)).toEqual(['2026-11-04']);
  expect(november.checkpoint).toMatchObject({ nextCandidate: 3, examinedCandidates: 3, rruleCount: 2, skipped: { invalidDates: 0, nonexistentTimes: 1 } });
});

test('uncounted later windows explicitly create fresh directly sought progress rather than asserting scanned history', () => {
  const value = input({ source: source({ localStart: '0000-01-01T09:00:00.000' }), range: { from: '2026-01-01', until: '2026-01-03' } });
  const first = drain(value, 1), nextValue = { ...value, range: { from: '9999-01-01', until: '9999-01-03' } };
  const continued = continueCalendarRecurrenceNominalWindow(first.cursor, nextValue.range), progress = inspectCalendarRecurrenceCursor(continued);
  expect(progress.checkpoint.examinedCandidates).toBe(0); expect(progress.checkpoint.rruleCount).toBeNull();
  expect(progress.checkpoint.skipped).toEqual({ invalidDates: 0, nonexistentTimes: 0 });
  expect(progress.checkpoint.nextCandidate).toBeGreaterThan(first.checkpoint.nextCandidate);
  const restored = restoreCalendarRecurrenceCursor(nextValue, JSON.parse(JSON.stringify(progress.checkpoint)), progress.digest);
  const next = drain(nextValue, 1, 1, restored); expect(next.total).toBe(2); expect(next.checkpoint.examinedCandidates).toBe(2); expect(next.occurrences.length).toBe(2);
});

test('window transition requires exact completion, rejects same/past/overlap/oversized windows, and cannot replace source progress', () => {
  const value = input({ source: source({ rule: { frequency: 'daily', interval: 1, end: { kind: 'after', count: 10 } } }) });
  const active = createCalendarRecurrenceCursor(value), first = drain(value, 1), nextRange = { from: '2026-01-05', until: '2026-01-07' };
  rejects(() => continueCalendarRecurrenceNominalWindow(active, nextRange), 'CALENDAR_REVISION_CONFLICT');
  const capped = advanceCalendarRecurrenceCursor(active, { candidateLimit: 1 });
  rejects(() => continueCalendarRecurrenceNominalWindow(capped.cursor, nextRange), 'CALENDAR_REVISION_CONFLICT');
  const complete = drain({ ...value, source: { ...value.source, rule: { frequency: 'daily', interval: 1, end: { kind: 'after', count: 1 } } } }, 1);
  rejects(() => continueCalendarRecurrenceNominalWindow(complete.cursor, nextRange), 'CALENDAR_REVISION_CONFLICT');
  for (const range of [value.range, { from: '2025-12-31', until: '2026-01-01' }, { from: '2026-01-04', until: '2026-01-07' },
    { from: '2026-01-05', until: '2027-01-07' }, { ...nextRange, nextCandidate: 100 }, { ...nextRange, source: value.source }]) {
    rejects(() => continueCalendarRecurrenceNominalWindow(first.cursor, range));
    expect(inspectCalendarRecurrenceCursor(first.cursor)).toEqual({ checkpoint: first.checkpoint, digest: first.digest });
  }
  rejects(() => continueCalendarRecurrenceNominalWindow(first.checkpoint as unknown as CalendarRecurrenceCursor, nextRange), 'CALENDAR_FORBIDDEN');
  const transitioned = inspectCalendarRecurrenceCursor(continueCalendarRecurrenceNominalWindow(first.cursor, nextRange));
  rejects(() => restoreCalendarRecurrenceCursor(value, transitioned.checkpoint, transitioned.digest), 'CALENDAR_REVISION_CONFLICT');
  rejects(() => restoreCalendarRecurrenceCursor({ ...value, range: nextRange, source: { ...value.source, durationMilliseconds: 2 } }, transitioned.checkpoint, transitioned.digest), 'CALENDAR_REVISION_CONFLICT');
  rejects(() => restoreCalendarRecurrenceCursor({ ...value, range: nextRange }, { ...transitioned.checkpoint, range: value.range }, transitioned.digest), 'CALENDAR_REVISION_CONFLICT');
  expect(inspectCalendarRecurrenceCursor(first.cursor)).toEqual({ checkpoint: first.checkpoint, digest: first.digest });
});

test('COUNT and inclusive rule ends continue into the final nominal day for every frequency without max-year overflow', () => {
  for (const example of [
    { localStart: '9999-12-30T23:30:00.000', from: '9999-12-30', frequency: 'daily' as const },
    { localStart: '9999-12-24T23:30:00.000', from: '9999-12-24', frequency: 'weekly' as const },
    { localStart: '9999-10-31T23:30:00.000', from: '9999-10-01', frequency: 'monthly' as const },
    { localStart: '9998-12-31T23:30:00.000', from: '9998-12-31', frequency: 'yearly' as const },
  ]) for (const end of [{ kind: 'after' as const, count: 2 }, { kind: 'on' as const, date: '9999-12-31' }]) {
    const frequency = example.frequency, rule: CalendarRecurrenceRule = frequency === 'weekly' ? { frequency, interval: 1, weekdays: [5], end }
      : frequency === 'monthly' ? { frequency, interval: 1, pattern: { kind: 'day', day: 31 }, end } : { frequency, interval: 1, end };
    const value = input({ source: source({ localStart: example.localStart, durationMilliseconds: 2 * 86_400_000, rule }),
      range: { from: example.from, until: '9999-12-31' } });
    const first = drain(value, 1); expect(first.stop).toBe('range-complete'); expect(first.occurrences.length).toBe(1);
    const finalValue = { ...value, range: { from: '9999-12-31', until: '+010000-01-01' } };
    const continued = inspectCalendarRecurrenceCursor(continueCalendarRecurrenceNominalWindow(first.cursor, finalValue.range));
    const restored = restoreCalendarRecurrenceCursor(finalValue, JSON.parse(JSON.stringify(continued.checkpoint)), continued.digest);
    const last = drain(finalValue, 1, 1, restored);
    expect(last.total).toBe(1); expect(last.stop).toBe('source-complete'); expect(dates(last.occurrences)).toEqual(['9999-12-31']);
    expect(last.occurrences[0]!.endAt).toBe('+010000-01-02T23:30:00.000Z');
    expect(last.checkpoint.examinedCandidates).toBe(end.kind === 'after' ? first.checkpoint.examinedCandidates + 1 : 1);
    if (end.kind === 'after') expect(last.checkpoint.rruleCount).toBe(2);
    rejects(() => continueCalendarRecurrenceNominalWindow(last.cursor, finalValue.range), 'CALENDAR_REVISION_CONFLICT');
    // DTSTART itself is valid on the last day, not only a later generated instance.
    const directValue = { ...finalValue, source: { ...finalValue.source, localStart: '9999-12-31T23:30:00.000' } };
    expect(dates(drain(directValue, 1).occurrences)).toEqual(['9999-12-31']);
  }
  const value = input();
  for (const range of [{ from: '+010000-01-01', until: '+010000-01-01' },
    { from: '9999-12-31', until: '+010000-01-02' }, { from: '9998-12-30', until: '+010000-01-01' }]) {
    rejects(() => createCalendarRecurrenceCursor({ ...value, range }));
  }
});

test('shared indexed traversal agrees with reviewed expander across patterns, boundaries and intervals', () => {
  const examples: { start: string; rule: CalendarRecurrenceRule }[] = [
    { start: '2026-01-01', rule: { frequency: 'daily', interval: 7, end: { kind: 'never' } } },
    { start: '0000-01-01', rule: { frequency: 'weekly', interval: 2, weekdays: [6, 1], end: { kind: 'after', count: 4 } } },
    { start: '2026-01-04', rule: { frequency: 'weekly', interval: 2, weekdays: [0, 1, 3], end: { kind: 'never' } } },
    ...[29, 30, 31].map(day => ({ start: `2026-01-${day}`, rule: { frequency: 'monthly' as const, interval: 1, pattern: { kind: 'day' as const, day }, end: { kind: 'never' as const } } })),
    ...[1, 2, 3, 4, 5, -1].map((ordinal, index) => ({ start: ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30', '2026-03-30'][index]!,
      rule: { frequency: 'monthly' as const, interval: 2, pattern: { kind: 'weekday' as const, weekday: 1, ordinal }, end: { kind: 'never' as const } } })),
    { start: '2024-02-29', rule: { frequency: 'yearly', interval: 1, end: { kind: 'after', count: 3 } } },
  ];
  for (const example of examples) {
    const range = example.start.startsWith('0000') ? { from: '0000-01-01', until: '0000-01-25' } : { from: '2026-01-02', until: '2027-01-02' };
    const value = input({ source: source({ localStart: example.start + 'T09:00:00.000', rule: example.rule }), range });
    expect(drain(value, 2, 1).occurrences).toEqual(materializeCalendarRecurrence({ ...value.source, range, limit: 1000 }).occurrences);
  }
});

test('inclusive source end, exclusive nominal range, pre-DTSTART slots and year9999 terminate honestly', () => {
  const ended = input({ source: source({ rule: { frequency: 'daily', interval: 1, end: { kind: 'on', date: '2026-01-03' } } }) });
  expect(dates(drain(ended, 1).occurrences)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
  expect(dates(drain({ ...ended, range: { from: '2026-01-01', until: '2026-01-03' } }, 1).occurrences)).toEqual(['2026-01-01', '2026-01-02']);
  const before = drain(input({ source: source({ localStart: '2027-01-01T09:00:00.000' }) }), 1); expect(before.total).toBe(0); expect(before.occurrences).toEqual([]);
  const upper = input({ source: source({ localStart: '9999-12-30T23:30:00.000', durationMilliseconds: 2 * 86_400_000 }), range: { from: '9999-12-30', until: '9999-12-31' } });
  expect(drain(upper, 1).occurrences[0]!.endAt).toBe('+010000-01-01T23:30:00.000Z');
});

test('persisted evidence rejects tampering, unknown facts, other sources and every identity/generation substitution', () => {
  const value = input(), original = inspectCalendarRecurrenceCursor(createCalendarRecurrenceCursor(value));
  rejects(() => restoreCalendarRecurrenceCursor(value, { ...original.checkpoint, nextCandidate: 1 }, original.digest), 'CALENDAR_REVISION_CONFLICT');
  rejects(() => restoreCalendarRecurrenceCursor(value, { ...original.checkpoint, grant: 'forged' }, original.digest));
  rejects(() => restoreCalendarRecurrenceCursor(value, original.checkpoint, 'caller-digest'));
  for (const patch of [{ scopeId: 'application' }, { seriesId: 'series-2' }, { segmentId: 'segment-2' }, { sourceGeneration: 2 }]) {
    rejects(() => restoreCalendarRecurrenceCursor({ ...value, binding: { ...value.binding, ...patch } }, original.checkpoint, original.digest), 'CALENDAR_REVISION_CONFLICT');
  }
  for (const patch of [{ fold: 'later' as const }, { timeZone: 'America/New_York' }, { localStart: '2026-01-01T10:00:00.000' }, { durationMilliseconds: 2 }]) {
    rejects(() => restoreCalendarRecurrenceCursor({ ...value, source: { ...value.source, ...patch } }, original.checkpoint, original.digest), 'CALENDAR_REVISION_CONFLICT');
  }
  rejects(() => restoreCalendarRecurrenceCursor({ ...value, range: { ...value.range, until: '2026-01-06' } }, original.checkpoint, original.digest), 'CALENDAR_REVISION_CONFLICT');
  for (const patch of [{ nextCandidate: 1 }, { examinedCandidates: 1 }, { rruleCount: 1 }, { status: 'coverage-complete' }, { skipped: { invalidDates: 1, nonexistentTimes: 0 } }]) {
    const malformed = { ...original.checkpoint, ...patch }; rejects(() => restoreCalendarRecurrenceCursor(value, malformed, checkpointDigest(malformed)));
  }
});

test('compiler/runtime/ICU/DTSTART engine replacement fails closed without reinterpreting accepted progress', () => {
  const value = input(), cursor = createCalendarRecurrenceCursor(value), original = inspectCalendarRecurrenceCursor(cursor);
  for (const patch of [{ kind: 'calendar-recurrence-cursor-v2' }, { originalDigest: '0'.repeat(64) },
    ...['name', 'runtime', 'icu', 'compilerSemantics', 'implementation', 'unicode', 'platform', 'architecture'].map(field => ({ engine: { ...original.checkpoint.engine, [field]: 'replacement' } }))]) {
    const replaced = { ...original.checkpoint, ...patch };
    rejects(() => restoreCalendarRecurrenceCursor(value, replaced, checkpointDigest(replaced)), 'kind' in patch ? 'CALENDAR_REVISION_CONFLICT' : 'CALENDAR_TIME_RULES_UNAVAILABLE');
  }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal'), temporal = (globalThis as any).Temporal;
  try {
    Object.defineProperty(globalThis, 'Temporal', { configurable: true, value: { PlainDate: temporal.PlainDate, ZonedDateTime: temporal.ZonedDateTime } });
    rejects(() => advanceCalendarRecurrenceCursor(cursor), 'CALENDAR_TIME_RULES_UNAVAILABLE');
    rejects(() => continueCalendarRecurrenceNominalWindow(cursor, { from: '2026-01-05', until: '2026-01-06' }), 'CALENDAR_TIME_RULES_UNAVAILABLE');
    Object.defineProperty(globalThis, 'Temporal', { configurable: true, get() { throw new Error('PRIVATE_DIAGNOSTIC'); } });
    rejects(() => inspectCalendarRecurrenceCursor(cursor), 'CALENDAR_TIME_RULES_UNAVAILABLE');
    rejects(() => restoreCalendarRecurrenceCursor(value, original.checkpoint, original.digest), 'CALENDAR_TIME_RULES_UNAVAILABLE');
  } finally { if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal'); }
  expect(inspectCalendarRecurrenceCursor(cursor)).toEqual(original);
});

test('missing or malformed actual runtime provenance cannot create, restore or continue a cursor', () => {
  const value = input(), cursor = createCalendarRecurrenceCursor(value), original = inspectCalendarRecurrenceCursor(cursor);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');
  try {
    for (const replacement of [undefined,
      { versions: { bun: '1.4.4', icu: '78.1' }, platform: 'darwin', arch: 'arm64' },
      { versions: { node: '26.3.0', icu: '78.1', unicode: '17.0' }, platform: 'darwin', arch: 'arm64' },
      { versions: { bun: '1.4.4', icu: '78.1', unicode: '17.0', webkit: 'revision' } },
      { versions: { bun: '1.4.4', icu: 'unknown', unicode: '17.0', webkit: 'revision' }, platform: 'darwin', arch: 'arm64' },
      { versions: { bun: '1.4.4', icu: '78.1', unicode: {}, webkit: 'revision' }, platform: 'darwin', arch: 'arm64' },
      { versions: { bun: {}, icu: '78.1', unicode: '17.0', webkit: 'revision' }, platform: 'darwin', arch: 'arm64' },
    ]) {
      Object.defineProperty(globalThis, 'process', { configurable: true, value: replacement });
      rejects(() => createCalendarRecurrenceCursor(value), 'CALENDAR_TIME_RULES_UNAVAILABLE');
      rejects(() => restoreCalendarRecurrenceCursor(value, original.checkpoint, original.digest), 'CALENDAR_TIME_RULES_UNAVAILABLE');
      rejects(() => advanceCalendarRecurrenceCursor(cursor), 'CALENDAR_TIME_RULES_UNAVAILABLE');
      rejects(() => continueCalendarRecurrenceNominalWindow(cursor, { from: '2026-01-05', until: '2026-01-06' }), 'CALENDAR_TIME_RULES_UNAVAILABLE');
    }
    Object.defineProperty(globalThis, 'process', { configurable: true, get() { throw new Error('PRIVATE_DIAGNOSTIC'); } });
    rejects(() => createCalendarRecurrenceCursor(value), 'CALENDAR_TIME_RULES_UNAVAILABLE');
    rejects(() => advanceCalendarRecurrenceCursor(cursor), 'CALENDAR_TIME_RULES_UNAVAILABLE');
  } finally { if (descriptor) Object.defineProperty(globalThis, 'process', descriptor); else Reflect.deleteProperty(globalThis, 'process'); }
  expect(inspectCalendarRecurrenceCursor(cursor)).toEqual(original);
});

test('closed input/budget validation never invokes accessors/proxies or accepts executable checkpoints', () => {
  const value = input(), cursor = createCalendarRecurrenceCursor(value), original = inspectCalendarRecurrenceCursor(cursor);
  for (const budget of [{ candidateLimit: 0 }, { candidateLimit: 4097 }, { occurrenceLimit: 0 }, { occurrenceLimit: 1001 }, { candidateLimit: NaN }, { grant: true }]) rejects(() => advanceCalendarRecurrenceCursor(cursor, budget));
  for (const patch of [{ sourceGeneration: 0 }, { scopeId: 'tenant:' }, { seriesId: 'bad id' }]) rejects(() => createCalendarRecurrenceCursor({ ...value, binding: { ...value.binding, ...patch } }));
  let touched = false;
  const getter = { ...original.checkpoint }; Object.defineProperty(getter, 'rruleCount', { enumerable: true, get() { touched = true; throw new Error('PRIVATE_DIAGNOSTIC'); } });
  const proxy = new Proxy(original.checkpoint, { getPrototypeOf() { touched = true; throw new Error('PRIVATE_DIAGNOSTIC'); } });
  for (const forged of [getter, proxy]) rejects(() => restoreCalendarRecurrenceCursor(value, forged, original.digest));
  expect(touched).toBe(false);
});

test('cursor source-only family rejects nested query facts rather than discarding or overriding them', () => {
  const value = input(), original = inspectCalendarRecurrenceCursor(createCalendarRecurrenceCursor(value));
  for (const patch of [{ limit: 1 }, { limit: undefined }, { range: value.range },
    { range: { from: '2025-01-01', until: '2025-01-02' } }, { range: undefined }]) {
    const malformed = { ...value, source: { ...value.source, ...patch } };
    rejects(() => createCalendarRecurrenceCursor(malformed));
    rejects(() => restoreCalendarRecurrenceCursor(malformed, original.checkpoint, original.digest));
  }
  let touched = false;
  const getter = { ...value.source }; Object.defineProperty(getter, 'range', { enumerable: true, get() { touched = true; throw new Error('PRIVATE_DIAGNOSTIC'); } });
  rejects(() => createCalendarRecurrenceCursor({ ...value, source: getter }));
  rejects(() => restoreCalendarRecurrenceCursor({ ...value, source: getter }, original.checkpoint, original.digest));
  expect(touched).toBe(false);
});
