/** Real Guardian/facade/runtime/realm in native memory only. No listener, actor or disk fixture. */
import { expect, test } from 'bun:test';
import type { CalendarAvailabilityPolicyView, CalendarWeeklyAvailabilityPolicyInput } from './contracts';
import { eventuallyCalendar, memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

const weekly = (startMinute = 540, endMinute = 1020): CalendarWeeklyAvailabilityPolicyInput => ({ kind: 'weekly-local-v1',
  coverage: { from: '2030-01-01', until: '2030-01-08' }, fold: 'earlier', weekly: [{ day: 2, windows: [{ startMinute, endMinute }] }], overrides: [] });
const explicitClosed = { kind: 'explicit-utc-v1' as const, mode: 'windows' as const, windows: [] };
const times = (hour: number, day = '2030-01-01') => ({ startAt: `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`,
  endAt: `${day}T${String(hour + 1).padStart(2, '0')}:00:00.000Z`, timeZone: 'UTC' });

test('weekly policy reads require current book/details/manage and writes/replay require manage in either tenancy mode', async () => {
  for (const tenancy of ['single', 'multi'] as const) {
    const f = memoryCalendarServiceFixture({ tenancy }), owner = f.session('owner'), delegate = f.session('delegate');
    try {
      await expect(owner.api.availability.policy.get('missing')).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
      expect(f.stats()).toMatchObject({ planes: 0, ownerRows: 0 });
      const resource = await owner.api.resources.create({ label: 'Private working hours', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
      await owner.api.resources.setGrants(resource.id, delegate.userId, ['busy'], { idempotencyKey: 'busy', expectedRevision: 1 });
      await expect(delegate.api.availability.policy.get(resource.id)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
      await expect(delegate.api.availability.policy.replace(resource.id, weekly(), { idempotencyKey: 'denied', expectedRevision: 2 })).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
      for (const [right, revision] of [['book', 2], ['details', 3]] as const) {
        await owner.api.resources.setGrants(resource.id, delegate.userId, [right], { idempotencyKey: right, expectedRevision: revision });
        expect(await delegate.api.availability.policy.get(resource.id)).toMatchObject({ resourceId: resource.id,
          resourceRevision: revision + 1, policy: { kind: 'explicit-utc-v1', mode: 'unrestricted', windows: [] }, materialization: null });
        await expect(delegate.api.availability.policy.replace(resource.id, weekly(), { idempotencyKey: 'denied-' + right, expectedRevision: revision + 1 }))
          .rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
      }
      await owner.api.resources.setGrants(resource.id, delegate.userId, ['manage'], { idempotencyKey: 'manage', expectedRevision: 4 });
      const options = { idempotencyKey: 'delegated-policy', expectedRevision: 5 };
      const accepted = await delegate.api.availability.policy.replace(resource.id, weekly(), options);
      expect(accepted).toMatchObject({ operation: 'resource.availability-policy-changed', id: resource.id, revision: 6, changed: true });
      expect(await delegate.api.availability.policy.replace(resource.id, weekly(), options)).toEqual(accepted);
      expect(await delegate.api.receipts.get(options.idempotencyKey)).toEqual(accepted);
      await owner.api.resources.setGrants(resource.id, delegate.userId, [], { idempotencyKey: 'revoke', expectedRevision: 6 });
      const retained = f.sourceRows(owner.scope, '_calendar_availability_policy_history');
      await expect(delegate.api.availability.policy.get(resource.id)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
      // Native transport replay may recover the old commit, but current receipt
      // authorization withholds it. This is uncertainty, not a new grant/write.
      await expect(delegate.api.availability.policy.replace(resource.id, weekly(), options)).rejects.toMatchObject({ code: 'CALENDAR_OUTCOME_UNKNOWN' });
      await expect(delegate.api.receipts.get(options.idempotencyKey)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
      expect(f.sourceRows(owner.scope, '_calendar_availability_policy_history')).toEqual(retained);
      if (tenancy === 'multi') {
        const other = f.session('owner', { tenantId: 'other' });
        await expect(other.api.availability.policy.get(resource.id)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
        expect(await other.api.receipts.get('delegated-policy')).toBeNull();
      }
      expect(f.stats().activeLeases).toBe(0);
    } finally { await f.close(); }
  }
});

test('resource CAS, semantic no-op, original receipts and legacy-format retirement use one request namespace', async () => {
  const f = memoryCalendarServiceFixture(), owner = f.session('owner');
  try {
    const resource = await owner.api.resources.create({ label: 'Unified policy', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const original = { mode: 'windows' as const, windows: [{ startAt: '2030-01-01T00:00:00.000Z', endAt: '2030-01-02T00:00:00.000Z' }] };
    const legacyOptions = { idempotencyKey: 'legacy-policy', expectedRevision: 1 };
    const legacy = await owner.api.availability.replace(resource.id, original, legacyOptions);
    const explicit = { kind: 'explicit-utc-v1' as const, ...original };
    const noOp = await owner.api.availability.policy.replace(resource.id, explicit, { idempotencyKey: 'explicit-no-op', expectedRevision: 2 });
    expect(noOp).toMatchObject({ operation: 'resource.availability-policy-changed', revision: 2, changed: false });
    expect(f.sourceRows(owner.scope, '_calendar_availability_policy_history')).toEqual([]);
    const options = { idempotencyKey: 'weekly-policy', expectedRevision: 2 };
    const accepted = await owner.api.availability.policy.replace(resource.id, weekly(), options), sequence = f.sourceSequence(owner.scope);
    expect(accepted).toMatchObject({ revision: 3, changed: true });
    await expect(owner.api.availability.get(resource.id)).rejects.toMatchObject({ code: 'CALENDAR_AVAILABILITY_FORMAT_UNSUPPORTED' });
    // Historical acceptance precedes the new format gate, but does not switch the current format back.
    expect(await owner.api.availability.replace(resource.id, original, legacyOptions)).toEqual(legacy);
    await expect(owner.api.availability.replace(resource.id, original, { idempotencyKey: 'legacy-new', expectedRevision: 3 }))
      .rejects.toMatchObject({ code: 'CALENDAR_AVAILABILITY_FORMAT_UNSUPPORTED' });
    expect(await owner.api.receipts.get('legacy-new')).toBeNull();
    expect(await owner.api.availability.policy.replace(resource.id, weekly(), options)).toEqual(accepted);
    expect(f.sourceSequence(owner.scope)).toBe(sequence);
    const effects = f.sourceRows(owner.scope, '_calendar_effect_intents');
    expect((await owner.api.availability.policy.replace(resource.id, weekly(), { idempotencyKey: 'weekly-no-op', expectedRevision: 3 }))).toMatchObject({ revision: 3, changed: false });
    // A new no-op request retains its own receipt/usage, not another policy or effect.
    expect(f.sourceRows(owner.scope, '_calendar_effect_intents')).toEqual(effects);
    expect(f.sourceRows(owner.scope, '_calendar_availability_policy_history')).toHaveLength(1);
    await expect(owner.api.availability.policy.replace(resource.id, weekly(), { idempotencyKey: 'stale', expectedRevision: 2 }))
      .rejects.toMatchObject({ code: 'CALENDAR_REVISION_CONFLICT' });
    await expect(owner.api.availability.policy.replace(resource.id, explicitClosed, { idempotencyKey: 'resource', expectedRevision: 3 }))
      .rejects.toMatchObject({ code: 'CALENDAR_INTENT_CONFLICT' });
    await expect(owner.api.appointments.create({ ...times(10), resourceIds: [resource.id], title: 'Wrong family' }, { idempotencyKey: 'weekly-policy' }))
      .rejects.toMatchObject({ code: 'CALENDAR_INTENT_CONFLICT' });
    const switched = await owner.api.availability.policy.replace(resource.id, explicitClosed, { idempotencyKey: 'deliberate-explicit', expectedRevision: 3 });
    expect(switched).toMatchObject({ revision: 4, changed: true });
    expect(await owner.api.availability.get(resource.id)).toMatchObject({ resourceRevision: 4, mode: 'windows', windows: [] });
    expect(await owner.api.availability.policy.replace(resource.id, weekly(), options)).toEqual(accepted);
    expect((await owner.api.availability.policy.get(resource.id)).policy).toEqual(explicitClosed);
    expect(f.sourceRows(owner.scope, '_calendar_availability_history')).toHaveLength(1);
  } finally { await f.close(); }
});

test('restrictive weekly hours preserve retained bookings/replay and unchanged reschedules but fence new or changed occupancy', async () => {
  const f = memoryCalendarServiceFixture(), owner = f.session('owner');
  try {
    const resource = await owner.api.resources.create({ label: 'Retained bookings', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const original = { ...times(8), resourceIds: [resource.id], title: 'Accepted before policy' };
    const accepted = await owner.api.appointments.create(original, { idempotencyKey: 'original' });
    const before = await owner.api.appointments.get(accepted.id);
    await owner.api.availability.policy.replace(resource.id, weekly(), { idempotencyKey: 'restrictive', expectedRevision: 1 });
    expect(await owner.api.appointments.get(accepted.id)).toEqual(before);
    expect(await owner.api.appointments.create(original, { idempotencyKey: 'original' })).toEqual(accepted);
    const unchanged = { ...times(8), bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
    expect(await owner.api.appointments.reschedule(accepted.id, unchanged, { idempotencyKey: 'unchanged', expectedRevision: 1 }))
      .toMatchObject({ changed: false, revision: 1 });
    await expect(owner.api.appointments.reschedule(accepted.id, { ...unchanged, endAt: '2030-01-01T09:00:00.001Z' }, { idempotencyKey: 'changed-time', expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'CALENDAR_AVAILABILITY_CONFLICT' });
    await expect(owner.api.appointments.reschedule(accepted.id, { ...unchanged, bufferBeforeMinutes: 1 }, { idempotencyKey: 'changed-buffer', expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'CALENDAR_AVAILABILITY_CONFLICT' });
    await expect(owner.api.appointments.create({ ...times(7), resourceIds: [resource.id], title: 'Closed' }, { idempotencyKey: 'closed' }))
      .rejects.toMatchObject({ code: 'CALENDAR_AVAILABILITY_CONFLICT' });
    const fits = await owner.api.appointments.create({ ...times(10), resourceIds: [resource.id], title: 'Inside hours' }, { idempotencyKey: 'inside' });
    expect(fits.changed).toBe(true);
    expect((await owner.api.blocks.create({ ...times(18), resourceIds: [resource.id], title: 'Block is not opening-hours admission' }, { idempotencyKey: 'block' })).changed).toBe(true);
    const closed = { ...weekly(), overrides: [{ date: '2030-01-01', windows: [] }] };
    await owner.api.availability.policy.replace(resource.id, closed, { idempotencyKey: 'closed-date', expectedRevision: 2 });
    expect(await owner.api.appointments.get(fits.id)).toMatchObject({ revision: 1, title: 'Inside hours' });
    await expect(owner.api.appointments.create({ ...times(12), resourceIds: [resource.id], title: 'Override closes whole date' }, { idempotencyKey: 'override-closed' }))
      .rejects.toMatchObject({ code: 'CALENDAR_AVAILABILITY_CONFLICT' });
  } finally { await f.close(); }
});

test('finite coverage includes buffers, all co-resources decide atomically, and policy revisions stale captured holds', async () => {
  const f = memoryCalendarServiceFixture(), manager = f.session('manager', { manager: true });
  try {
    const person = await manager.api.resources.create({ label: 'Person', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'person' });
    const room = await manager.api.resources.create({ label: 'Room', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'room' });
    const policy = { ...weekly(), coverage: { from: '2030-01-01', until: '2030-01-02' } };
    await manager.api.availability.policy.replace(person.id, policy, { idempotencyKey: 'person-policy', expectedRevision: 1 });
    await manager.api.availability.policy.replace(room.id, explicitClosed, { idempotencyKey: 'room-policy', expectedRevision: 1 });
    const before = Object.fromEntries(['calendar_appointments', '_calendar_reservations', '_calendar_receipts', '_calendar_usage']
      .map(table => [table, f.sourceRows(manager.scope, table)]));
    const sequence = f.sourceSequence(manager.scope);
    await expect(manager.api.appointments.create({ ...times(10), resourceIds: [person.id, room.id], title: 'One closed co-resource' }, { idempotencyKey: 'atomic-denial' }))
      .rejects.toMatchObject({ code: 'CALENDAR_AVAILABILITY_CONFLICT' });
    for (const [table, rows] of Object.entries(before)) expect(f.sourceRows(manager.scope, table)).toEqual(rows);
    expect(f.sourceSequence(manager.scope)).toBe(sequence); expect(await manager.api.receipts.get('atomic-denial')).toBeNull();
    await expect(manager.api.appointments.create({ ...times(9), resourceIds: [person.id], title: 'Buffered outside opening', bufferBeforeMinutes: 1 }, { idempotencyKey: 'buffer' }))
      .rejects.toMatchObject({ code: 'CALENDAR_AVAILABILITY_CONFLICT' });
    for (const input of [times(10, '2029-12-31'), times(10, '2030-01-02'), { ...times(0), bufferBeforeMinutes: 1 },
      { startAt: '2030-01-01T23:00:00.000Z', endAt: '2030-01-02T00:00:00.000Z', timeZone: 'UTC', bufferAfterMinutes: 1 }]) {
      await expect(manager.api.appointments.create({ ...input, resourceIds: [person.id], title: 'Outside qualified civil coverage' }, { idempotencyKey: 'coverage-' + input.startAt.slice(0, 13).replaceAll(':', '') }))
        .rejects.toMatchObject({ code: 'CALENDAR_AVAILABILITY_COVERAGE_REQUIRED' });
    }
    const held = await manager.api.holds.acquire({ ...times(12), resourceIds: [person.id], ttlSeconds: 300 }, { idempotencyKey: 'hold' });
    await manager.api.availability.policy.replace(person.id, { ...policy, weekly: [{ day: 2, windows: [{ startMinute: 600, endMinute: 960 }] }] },
      { idempotencyKey: 'changed-person-policy', expectedRevision: 2 });
    await expect(manager.api.holds.confirm(held.id, { title: 'Stale policy capture' }, { idempotencyKey: 'confirm-stale', expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'CALENDAR_HOLD_STALE' });
    expect(await manager.api.holds.get(held.id)).toMatchObject({ status: 'held', revision: 1, appointmentId: null });
    expect(f.sourceRows(manager.scope, 'calendar_appointments')).toEqual([]);
    expect(f.sourceRows(manager.scope, '_calendar_reservations')).toEqual([]);
    expect(await manager.api.receipts.get('confirm-stale')).toBeNull(); expect(f.stats().activeLeases).toBe(0);
  } finally { await f.close(); }
});

test('retained UTC snapshots, accepted replay and semantic no-op survive future engine loss without granting a new weekly write', async () => {
  const f = memoryCalendarServiceFixture(), owner = f.session('owner');
  const temporal = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
  try {
    const resource = await owner.api.resources.create({ label: 'Frozen local hours', kind: 'person', timeZone: 'America/New_York' }, { idempotencyKey: 'resource' });
    const options = { idempotencyKey: 'native-policy', expectedRevision: 1 }, policy = weekly();
    const accepted = await owner.api.availability.policy.replace(resource.id, policy, options);
    const snapshot = await owner.api.availability.policy.get(resource.id);
    expect(snapshot).toMatchObject({ resourceRevision: 2, timeZone: 'America/New_York', policy,
      materialization: { coverage: { startAt: '2030-01-01T05:00:00.000Z', endAt: '2030-01-08T05:00:00.000Z' },
        windowCount: 1, engine: { name: 'temporal-working-hours-v1' }, skippedDates: [] } });
    expect(snapshot).not.toHaveProperty('windows'); expect(snapshot.materialization).not.toHaveProperty('windows');
    Object.defineProperty(globalThis, 'Temporal', { configurable: true, writable: true, value: undefined });
    expect(await owner.api.availability.policy.get(resource.id)).toEqual(snapshot);
    expect(await owner.api.availability.policy.replace(resource.id, policy, options)).toEqual(accepted);
    expect(await owner.api.receipts.get(options.idempotencyKey)).toEqual(accepted);
    expect(await owner.api.availability.policy.replace(resource.id, policy, { idempotencyKey: 'native-no-op', expectedRevision: 2 }))
      .toMatchObject({ revision: 2, changed: false });
    const booking = await owner.api.appointments.create({ ...times(15), resourceIds: [resource.id], title: 'Frozen snapshot admission' }, { idempotencyKey: 'snapshot-booking' });
    expect(booking.changed).toBe(true);
    await expect(owner.api.availability.policy.replace(resource.id, weekly(600), options)).rejects.toMatchObject({ code: 'CALENDAR_INTENT_CONFLICT' });
    await expect(owner.api.availability.policy.replace(resource.id, weekly(600), { idempotencyKey: 'stale-engine-write', expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'CALENDAR_REVISION_CONFLICT' });
    await expect(owner.api.availability.policy.replace(resource.id, weekly(600), { idempotencyKey: 'new-engine-write', expectedRevision: 2 }))
      .rejects.toMatchObject({ code: 'CALENDAR_TIME_RULES_UNAVAILABLE' });
    expect(await owner.api.receipts.get('new-engine-write')).toBeNull();
    expect(await owner.api.availability.policy.get(resource.id)).toEqual(snapshot);
    expect(f.sourceRows(owner.scope, '_calendar_availability_policy_history')).toHaveLength(1);
    await owner.api.availability.policy.replace(resource.id, explicitClosed, { idempotencyKey: 'engine-free-explicit', expectedRevision: 2 });
    expect(await owner.api.availability.policy.replace(resource.id, policy, options)).toEqual(accepted);
    expect((await owner.api.availability.policy.get(resource.id)).policy).toEqual(explicitClosed);
  } finally {
    if (temporal) Object.defineProperty(globalThis, 'Temporal', temporal); else Reflect.deleteProperty(globalThis, 'Temporal');
    await f.close();
  }
});

test('native policy watches publish fresh generations and terminally retire on resource or Guardian revocation', async () => {
  const f = memoryCalendarServiceFixture(), owner = f.session('owner'), delegate = f.session('delegate');
  const values: CalendarAvailabilityPolicyView[] = [], errors: unknown[] = [], stops: (() => void)[] = [];
  try {
    const resource = await owner.api.resources.create({ label: 'Watched policy', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    await owner.api.resources.setGrants(resource.id, delegate.userId, ['book'], { idempotencyKey: 'grant', expectedRevision: 1 });
    stops.push(delegate.api.availability.policy.watch(resource.id, value => values.push(value), { onError: error => errors.push(error) }));
    await eventuallyCalendar(() => values.length === 1);
    expect(values[0]).toMatchObject({ resourceRevision: 2, policy: { kind: 'explicit-utc-v1' } });
    await owner.api.availability.policy.replace(resource.id, weekly(), { idempotencyKey: 'policy', expectedRevision: 2 });
    await eventuallyCalendar(() => values.at(-1)?.resourceRevision === 3);
    expect(values.at(-1)?.policy.kind).toBe('weekly-local-v1');
    await owner.api.resources.setGrants(resource.id, delegate.userId, [], { idempotencyKey: 'revoke', expectedRevision: 3 });
    await eventuallyCalendar(() => errors.length === 1 && f.stats().subscriptions === 0);
    expect(errors[0]).toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    const ownerValues: CalendarAvailabilityPolicyView[] = [];
    stops.push(owner.api.availability.policy.watch(resource.id, value => ownerValues.push(value), { onError: error => errors.push(error) }));
    await eventuallyCalendar(() => ownerValues.length === 1);
    owner.revoke();
    const manager = f.session('manager', { manager: true });
    await manager.api.availability.policy.replace(resource.id, explicitClosed, { idempotencyKey: 'hint-retired-owner', expectedRevision: 4 });
    await eventuallyCalendar(() => errors.length === 2 && f.stats().subscriptions === 0);
    expect(ownerValues).toHaveLength(1); expect(errors[1]).toMatchObject({ code: 'AUTH_STATE_CHANGED' });
    expect(f.stats().activeLeases).toBe(0);
  } finally { stops.forEach(stop => stop()); await f.close(); }
});

test('policy and command options detach before an asynchronous Guardian wait', async () => {
  const f = memoryCalendarServiceFixture(), owner = f.session('owner');
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
  try {
    const resource = await owner.api.resources.create({ label: 'Detached source', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const api = f.service.forAuthority({ ...owner.authority, async assertCurrentAuthority() {
      entered(); await gate; owner.authority.assertCurrentAuthoritySync();
    } });
    const source = { kind: 'weekly-local-v1' as const, coverage: { from: '2030-01-01', until: '2030-01-08' }, fold: 'earlier' as const,
      weekly: [{ day: 2, windows: [{ startMinute: 540, endMinute: 1020 }] }], overrides: [] };
    const options = { idempotencyKey: 'original-detached', expectedRevision: 1 };
    const writing = api.availability.policy.replace(resource.id, source, options);
    await ready;
    source.coverage.until = '2030-01-03'; source.weekly[0]!.windows[0]!.startMinute = 1000;
    options.idempotencyKey = 'mutated-key'; options.expectedRevision = 99; release();
    expect(await writing).toMatchObject({ requestId: 'original-detached', revision: 2, changed: true });
    expect((await owner.api.availability.policy.get(resource.id)).policy).toEqual(weekly());
    expect(await owner.api.receipts.get('mutated-key')).toBeNull();
    expect(f.stats().activeLeases).toBe(0);
  } finally { release(); await f.close(); }
});

test('final source authority loss refuses an uncommitted policy while post-commit loss preserves original-key unknown recovery', async () => {
  for (const phase of ['before', 'after'] as const) {
    let retire = false;
    const f = memoryCalendarServiceFixture({ beforeDispatch(operation) {
      if (phase === 'before' && retire && operation.type === 'command' && operation.name === 'calendar.resource.availability-policy') {
        retire = false; owner.revoke();
      }
    }, afterCommand(operation) {
      if (phase === 'after' && retire && operation.type === 'command' && operation.name === 'calendar.resource.availability-policy') {
        retire = false; owner.revoke();
      }
    } }), owner = f.session('owner');
    try {
      const resource = await owner.api.resources.create({ label: 'Final source edge', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
      const options = { idempotencyKey: 'original-policy', expectedRevision: 1 };
      const before = f.sourceRows(owner.scope, '_calendar_effect_intents');
      retire = true;
      await expect(owner.api.availability.policy.replace(resource.id, weekly(), options)).rejects.toMatchObject({
        code: phase === 'before' ? 'CALENDAR_FORBIDDEN' : 'CALENDAR_OUTCOME_UNKNOWN', outcome: phase === 'before' ? 'not-started' : 'unknown',
      });
      const renewed = f.session('owner', { context: { sessionId: 'renewed-session', sessionGeneration: 2 } });
      const receipt = await renewed.api.receipts.get(options.idempotencyKey);
      if (phase === 'before') {
        expect(receipt).toBeNull(); expect(f.sourceRows(renewed.scope, '_calendar_availability_policy_history')).toEqual([]);
        expect(f.sourceRows(renewed.scope, '_calendar_effect_intents')).toEqual(before);
      } else {
        expect(receipt).toMatchObject({ requestId: options.idempotencyKey, revision: 2, changed: true });
        expect(f.sourceRows(renewed.scope, '_calendar_availability_policy_history')).toHaveLength(1);
      }
      const accepted = await renewed.api.availability.policy.replace(resource.id, weekly(), options);
      expect(accepted).toMatchObject({ requestId: options.idempotencyKey, revision: 2, changed: true });
      if (phase === 'after') { expect(receipt).not.toBeNull(); expect(accepted).toEqual(receipt!); }
      expect(await renewed.api.receipts.get(options.idempotencyKey)).toEqual(accepted);
      expect(f.sourceRows(renewed.scope, '_calendar_availability_policy_history')).toHaveLength(1);
      expect(f.stats().activeLeases).toBe(0);
    } finally { await f.close(); }
  }
});
