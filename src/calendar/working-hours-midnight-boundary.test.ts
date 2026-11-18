/** Native Guardian/service/realm memory regressions. No listener, actor or disk fixture is allocated. */
import { expect, test } from 'bun:test';
import type { CalendarWeeklyAvailabilityPolicyInput } from './contracts';
import { memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

const policy = (until: string, closedDate = false): CalendarWeeklyAvailabilityPolicyInput => ({
  kind: 'weekly-local-v1', coverage: { from: '2026-10-24', until }, fold: 'later',
  weekly: [{ day: 6, windows: [{ startMinute: 0, endMinute: 1440 }] }, { day: 7, windows: [{ startMinute: 0, endMinute: 1440 }] }],
  overrides: closedDate ? [{ date: '2026-10-25', windows: [] }] : [],
});

test('full-day policy publishes at a repeated exclusive-coverage midnight without violating SQL containment', async () => {
  const f = memoryCalendarServiceFixture(), owner = f.session('owner');
  try {
    const resource = await owner.api.resources.create({ label: 'Synthetic midnight coverage', kind: 'person', timeZone: 'Atlantic/Azores' }, { idempotencyKey: 'resource' });
    const receipt = await owner.api.availability.policy.replace(resource.id, policy('2026-10-25'), { idempotencyKey: 'policy', expectedRevision: 1 });
    expect(receipt).toMatchObject({ changed: true, revision: 2 });
    expect((await owner.api.availability.policy.get(resource.id)).materialization).toMatchObject({
      coverage: { startAt: '2026-10-24T00:00:00.000Z', endAt: '2026-10-25T00:00:00.000Z' }, windowCount: 1,
    });
    expect(f.sourceRows(owner.scope, '_calendar_availability_policy_windows')).toMatchObject([
      { start_ms: Date.parse('2026-10-24T00:00:00.000Z'), end_ms: Date.parse('2026-10-25T00:00:00.000Z') },
    ]);
    expect((await owner.api.appointments.create({ resourceIds: [resource.id], title: 'Ends at exclusive midnight', timeZone: 'Atlantic/Azores',
      startAt: '2026-10-24T23:30:00.000Z', endAt: '2026-10-25T00:00:00.000Z' }, { idempotencyKey: 'inside' })).changed).toBe(true);
    await expect(owner.api.appointments.create({ resourceIds: [resource.id], title: 'Outside qualified date', timeZone: 'Atlantic/Azores',
      startAt: '2026-10-25T00:00:00.000Z', endAt: '2026-10-25T00:30:00.000Z' }, { idempotencyKey: 'outside' }))
      .rejects.toMatchObject({ code: 'CALENDAR_AVAILABILITY_COVERAGE_REQUIRED' });
    expect(await owner.api.receipts.get('outside')).toBeNull(); expect(f.stats().activeLeases).toBe(0);
  } finally { await f.close(); }
});

test('whole-date override closes both repeated midnight hours and rejects buffered spillover from yesterday', async () => {
  const f = memoryCalendarServiceFixture(), owner = f.session('owner');
  try {
    const resource = await owner.api.resources.create({ label: 'Synthetic closed fold date', kind: 'person', timeZone: 'Atlantic/Azores' }, { idempotencyKey: 'resource' });
    await owner.api.availability.policy.replace(resource.id, policy('2026-10-26', true), { idempotencyKey: 'policy', expectedRevision: 1 });
    expect((await owner.api.appointments.create({ resourceIds: [resource.id], title: 'Previous date remains open', timeZone: 'Atlantic/Azores',
      startAt: '2026-10-24T22:00:00.000Z', endAt: '2026-10-24T22:30:00.000Z' }, { idempotencyKey: 'inside' })).changed).toBe(true);
    const sequence = f.sourceSequence(owner.scope);
    for (const [key, startAt, endAt, bufferAfterMinutes] of [
      ['earlier-midnight', '2026-10-25T00:15:00.000Z', '2026-10-25T00:30:00.000Z', 0],
      ['later-midnight', '2026-10-25T01:15:00.000Z', '2026-10-25T01:30:00.000Z', 0],
      ['buffered-spillover', '2026-10-24T23:30:00.000Z', '2026-10-25T00:00:00.000Z', 1],
    ] as const) {
      await expect(owner.api.appointments.create({ resourceIds: [resource.id], title: 'Closed civil date', timeZone: 'Atlantic/Azores',
        startAt, endAt, bufferAfterMinutes }, { idempotencyKey: key })).rejects.toMatchObject({ code: 'CALENDAR_AVAILABILITY_CONFLICT' });
      expect(await owner.api.receipts.get(key)).toBeNull(); expect(f.sourceSequence(owner.scope)).toBe(sequence);
    }
    expect(f.sourceRows(owner.scope, 'calendar_appointments')).toHaveLength(1); expect(f.stats().activeLeases).toBe(0);
  } finally { await f.close(); }
});
