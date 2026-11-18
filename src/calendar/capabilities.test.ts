/** Current Guardian discovery over the real service and native memory realm; no files/actors or new data plane. */
import { expect, test } from 'bun:test';
import type { CalendarCapabilities } from './contracts';
import type { CalendarParticipantDirectory } from './participants-directory';
import { eventuallyCalendar, memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

const unusedDirectory: CalendarParticipantDirectory = {
  list() { throw new Error('Capability discovery must not enumerate accounts.'); },
  resolve() { throw new Error('Capability discovery must not resolve accounts.'); },
  assertBindable() { throw new Error('Capability discovery must not bind accounts.'); },
  subscribe() { throw new Error('Capability discovery must not subscribe to the people directory.'); },
};
test('scope capabilities discover current policies/limits without owner files, actors, records or subject reads', async () => {
  for (const tenancy of ['single', 'multi'] as const) {
    const f = memoryCalendarServiceFixture({ tenancy, config: { participants: { userEligibility: 'user' }, maxParticipants: 7,
      maxResources: 3, maxPageSize: 12, maxRangeDays: 5 }, participantDirectory: unusedDirectory });
    try {
      const manager = f.session('manager', { manager: true }), member = f.session('member');
      expect(await manager.api.capabilities.get()).toEqual({ timeZone: 'UTC', createOwn: true, manage: true, participants: true,
        limits: { maxRangeDays: 5, maxPageSize: 12, maxResources: 3, maxParticipants: 7 } });
      const limited = await member.api.capabilities.get(); expect(limited).toMatchObject({ manage: false, participants: false });
      expect(Object.isFrozen(limited)).toBe(true); expect(Object.isFrozen(limited.limits)).toBe(true);
      expect(JSON.stringify(limited)).not.toContain('manager'); expect(JSON.stringify(limited)).not.toContain('rootDirectory');
      expect(f.stats()).toMatchObject({ planes: 0, ownerRows: 0, acquisitions: 0, activeLeases: 0, subscriptions: 0 });
      member.revoke(); await expect(member.api.capabilities.get()).rejects.toBeDefined();
      expect(f.stats().acquisitions).toBe(0);
    } finally { await f.close(); }
  }
});
test('explicit feature disablement and unavailable native dependencies cannot masquerade as participant readiness', async () => {
  for (const enabled of [false, true]) {
    const f = memoryCalendarServiceFixture({ config: enabled ? { participants: { userEligibility: 'user' } } : {} });
    try {
      const session = f.session('manager', { manager: true });
      if (enabled) await expect(session.api.capabilities.get()).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
      else expect((await session.api.capabilities.get()).participants).toBe(false);
      expect(f.stats().planes).toBe(0);
    } finally { await f.close(); }
  }
});
test('capability watches use existing current-authority retirement and release their one scoped subscription', async () => {
  const f = memoryCalendarServiceFixture(), session = f.session('manager', { manager: true }), values: CalendarCapabilities[] = [];
  const stop = session.api.capabilities.watch(value => values.push(value));
  try {
    await eventuallyCalendar(() => values.length === 1);
    expect(values[0]!.manage).toBe(true); expect(f.stats()).toMatchObject({ planes: 0, acquisitions: 0, subscriptions: 1 });
    stop(); expect(f.stats().subscriptions).toBe(0); expect(f.stats().planes).toBe(0);
  } finally { stop(); await f.close(); }
});
