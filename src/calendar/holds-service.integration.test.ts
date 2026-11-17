/** Real Guardian/facade/runtime/native-memory realm only. No files, actors, servers or generated fixtures. */
import { expect, spyOn, test } from 'bun:test';
import { trustedSystemServiceDataScope } from '../auth/service-data-scope';
import type { CalendarHoldInput, CalendarHoldPage, CalendarWatchUpdate } from './contracts';
import { CalendarError } from './error';
import type { CalendarServiceBroker } from './service';
import { eventuallyCalendar, memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

const instant = (epoch: number) => new Date(epoch).toISOString();
const holdInput = (resourceIds: readonly string[], now = Date.now()): CalendarHoldInput => ({ resourceIds,
  startAt: instant(now + 3_600_000), endAt: instant(now + 7_200_000), timeZone: 'UTC',
  bufferBeforeMinutes: 5, bufferAfterMinutes: 10, ttlSeconds: 120 });
const rangeFor = (input: CalendarHoldInput) => ({ resourceIds: input.resourceIds, startAt: input.startAt, endAt: input.endAt });

test('fresh browser authority can reconcile and confirm its stable subject hold after session renewal', async () => {
  const f = memoryCalendarServiceFixture(), original = f.session('owner');
  try {
    const resource = await original.api.resources.create({ label: 'Synthetic renewal calendar', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const acquired = await original.api.holds.acquire(holdInput([resource.id]), { idempotencyKey: 'stable-hold' });
    original.revoke();
    await expect(original.api.holds.get(acquired.id)).rejects.toMatchObject({ code: 'AUTH_STATE_CHANGED' });
    const renewed = f.session('owner', { context: { sessionId: 'renewed-session', sessionGeneration: 2 } });
    expect(await renewed.api.receipts.get('stable-hold')).toEqual(acquired);
    expect(await renewed.api.holds.get(acquired.id)).toMatchObject({ id: acquired.id, status: 'held', revision: 1 });
    const confirmed = await renewed.api.holds.confirm(acquired.id, { title: 'Synthetic renewed booking' },
      { idempotencyKey: 'stable-confirm', expectedRevision: 1 });
    expect(confirmed).toMatchObject({ operation: 'appointment.created', changed: true, revision: 1 });
    expect(confirmed.id).not.toBe(acquired.id);
    expect(await renewed.api.receipts.get('stable-confirm')).toEqual(confirmed);
  } finally { await f.close(); }
});

test('hold empty reads never provision, and authored authority plus read-only grants cannot acquire or control holds', async () => {
  const f = memoryCalendarServiceFixture(), owner = f.session('owner'), reader = f.session('reader');
  try {
    const empty = holdInput([]);
    expect(await owner.api.holds.query(rangeFor(empty))).toEqual({ items: [], truncated: false });
    await expect(owner.api.holds.get('missing')).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await expect(owner.api.holds.acquire(holdInput(['missing']), { idempotencyKey: 'missing' })).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    expect(f.stats()).toMatchObject({ planes: 0, ownerRows: 0, acquisitions: 0 });
    const resource = await owner.api.resources.create({ label: 'Private hold resource', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    await owner.api.resources.setGrants(resource.id, reader.userId, ['details'], { idempotencyKey: 'details', expectedRevision: 1 });
    const input = holdInput([resource.id]);
    const acquired = await owner.api.holds.acquire(input, { idempotencyKey: 'hold' });
    await expect(reader.api.holds.acquire(input, { idempotencyKey: 'reader-acquire' })).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await expect(reader.api.holds.get(acquired.id)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    expect(await reader.api.holds.query(rangeFor(input))).toEqual({ items: [], truncated: false });
    await expect(reader.api.holds.release(acquired.id, { idempotencyKey: 'reader-release', expectedRevision: 1 })).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await expect(reader.api.holds.confirm(acquired.id, { title: 'Denied' }, { idempotencyKey: 'reader-confirm', expectedRevision: 1 })).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    for (const field of ['actor', 'scope', 'scopeId', 'appointmentId', 'now', 'expiresAt']) {
      await expect(owner.api.holds.acquire({ ...input, [field]: 'forged' }, { idempotencyKey: 'forged' })).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    }
    const forged = f.service.forAuthority({ ...owner.authority, scope: trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'other' }) });
    await expect(forged.holds.get(acquired.id)).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    const beta = f.session('owner', { tenantId: 'beta' });
    await expect(beta.api.holds.get(acquired.id)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    expect(await beta.api.receipts.get('hold')).toBeNull();
    expect(f.stats().activeLeases).toBe(0);
  } finally { await f.close(); }
});

test('confirmation creates a distinct appointment, preserves original-key reconciliation and cannot consume another subject hold', async () => {
  const f = memoryCalendarServiceFixture(), owner = f.session('owner'), manager = f.session('manager', { manager: true });
  const write = f.runtime.write.bind(f.runtime);
  try {
    const resource = await owner.api.resources.create({ label: 'Hold to appointment', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const input = holdInput([resource.id]);
    const acquired = await owner.api.holds.acquire(input, { idempotencyKey: 'hold' });
    expect(await owner.api.holds.acquire(input, { idempotencyKey: 'hold' })).toEqual(acquired);
    expect((await manager.api.holds.get(acquired.id)).status).toBe('held');
    await expect(manager.api.holds.confirm(acquired.id, { title: 'Manager must not substitute' }, { idempotencyKey: 'manager-confirm', expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    let dropped = false;
    f.runtime.write = async <T>(...args: Parameters<CalendarServiceBroker['write']>): Promise<T> => {
      const accepted = await write<T>(...args);
      if (args[1] === 'calendar.hold.confirm' && !dropped) { dropped = true; throw new CalendarError('CALENDAR_OUTCOME_UNKNOWN'); }
      return accepted;
    };
    const control = { idempotencyKey: 'original-confirm-key', expectedRevision: 1 };
    await expect(owner.api.holds.confirm(acquired.id, { title: 'PRIVATE_CONFIRMED_TITLE' }, control)).rejects.toMatchObject({ code: 'CALENDAR_OUTCOME_UNKNOWN' });
    const receipt = await owner.api.receipts.get(control.idempotencyKey);
    expect(receipt).not.toBeNull();
    if (receipt === null) throw new Error('Accepted hold confirmation must retain its original receipt.');
    expect(receipt).toMatchObject({ requestId: control.idempotencyKey, operation: 'appointment.created', revision: 1, changed: true });
    expect(receipt.id).not.toBe(acquired.id);
    expect(await owner.api.holds.confirm(acquired.id, { title: 'PRIVATE_CONFIRMED_TITLE' }, control)).toEqual(receipt);
    expect(await owner.api.holds.get(acquired.id)).toMatchObject({ status: 'confirmed', revision: 2, appointmentId: receipt.id });
    expect(await owner.api.appointments.get(receipt.id)).toMatchObject({ title: 'PRIVATE_CONFIRMED_TITLE', resourceIds: input.resourceIds,
      startAt: input.startAt, endAt: input.endAt, bufferBeforeMinutes: 5, bufferAfterMinutes: 10 });
    expect(await owner.api.holds.query(rangeFor(input))).toEqual({ items: [], truncated: false });
    expect(JSON.stringify(receipt)).not.toContain('PRIVATE');
    expect(f.stats().activeLeases).toBe(0);
  } finally { f.runtime.write = write; await f.close(); }
});

test('quiet hold expiry refreshes the watch without a command, audit-producing write or source invalidation', async () => {
  const now = Date.now(), f = memoryCalendarServiceFixture(), owner = f.session('owner');
  const clock = spyOn(Date, 'now').mockReturnValue(now);
  const write = f.runtime.write.bind(f.runtime); let stop = () => {}, writes = 0;
  f.runtime.write = <T>(...args: Parameters<CalendarServiceBroker['write']>): Promise<T> => { writes++; return write<T>(...args); };
  try {
    const resource = await owner.api.resources.create({ label: 'Quiet expiry', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const input = { ...holdInput([resource.id], now), ttlSeconds: 1 };
    const acquired = await owner.api.holds.acquire(input, { idempotencyKey: 'hold' });
    const pages: CalendarHoldPage[] = [], updates: (CalendarWatchUpdate | undefined)[] = [], errors: unknown[] = [];
    stop = owner.api.holds.watch(rangeFor(input), (page, update) => { pages.push(page); updates.push(update); }, { onError: error => errors.push(error) });
    await eventuallyCalendar(() => pages.length === 1);
    expect(pages[0]!.items.map(item => item.id)).toEqual([acquired.id]);
    const acceptedWrites = writes; clock.mockReturnValue(now + 1_000);
    await eventuallyCalendar(() => pages.length === 2, 7_000);
    expect(pages[1]).toEqual({ items: [], truncated: false }); expect(updates[1]).toEqual({ invalidated: false });
    expect(writes).toBe(acceptedWrites); expect(errors).toEqual([]);
    expect(await owner.api.holds.get(acquired.id)).toMatchObject({ status: 'expired', revision: 1, appointmentId: null });
    expect(await owner.api.busy.query(rangeFor(input))).toEqual({ items: [], truncated: false });
    await expect(owner.api.holds.confirm(acquired.id, { title: 'Too late' }, { idempotencyKey: 'expired-confirm', expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'CALENDAR_HOLD_EXPIRED', outcome: 'not-committed' });
    expect(await owner.api.receipts.get('expired-confirm')).toBeNull();
    expect(await owner.api.receipts.get('hold')).toEqual(acquired);
  } finally { stop(); f.runtime.write = write; try { await f.close(); } finally { clock.mockRestore(); } }
}, 12_000);

test('hold watches remove private rows on current grant revocation and retire on account/scope replacement', async () => {
  const f = memoryCalendarServiceFixture(), owner = f.session('owner'), delegate = f.session('delegate');
  let stop = () => {}, otherStop = () => {};
  try {
    const resource = await owner.api.resources.create({ label: 'Delegated holds', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    await owner.api.resources.setGrants(resource.id, delegate.userId, ['details', 'book'], { idempotencyKey: 'grant', expectedRevision: 1 });
    const input = holdInput([resource.id]), acquired = await delegate.api.holds.acquire(input, { idempotencyKey: 'delegate-hold' });
    const pages: CalendarHoldPage[] = [], errors: unknown[] = [];
    stop = delegate.api.holds.watch(rangeFor(input), page => pages.push(page), { onError: error => errors.push(error) });
    await eventuallyCalendar(() => pages.length === 1); expect(pages[0]!.items[0]!.id).toBe(acquired.id);
    await owner.api.resources.setGrants(resource.id, delegate.userId, ['details'], { idempotencyKey: 'revoke-book', expectedRevision: 2 });
    await eventuallyCalendar(() => pages.length === 2); expect(pages[1]!.items).toEqual([]);
    await expect(delegate.api.receipts.get('delegate-hold')).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await owner.api.resources.setGrants(resource.id, delegate.userId, [], { idempotencyKey: 'revoke-details', expectedRevision: 3 });
    await eventuallyCalendar(() => errors.length === 1 && f.stats().subscriptions === 0);
    expect(errors[0]).toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    const ownerPages: CalendarHoldPage[] = [], ownerErrors: unknown[] = [];
    otherStop = owner.api.holds.watch(rangeFor(input), page => ownerPages.push(page), { onError: error => ownerErrors.push(error) });
    await eventuallyCalendar(() => ownerPages.length === 1); owner.replaceScope('other');
    // Force the same payload-free commit hint used by the actual runtime, then fence the retired authority.
    await f.session('manager', { manager: true }).api.holds.release(acquired.id, { idempotencyKey: 'manager-release', expectedRevision: 1 });
    await eventuallyCalendar(() => ownerErrors.length === 1 && f.stats().subscriptions === 0);
    expect(ownerPages).toHaveLength(1); expect(ownerErrors[0]).toMatchObject({ code: 'AUTH_STATE_CHANGED' });
  } finally { stop(); otherStop(); await f.close(); }
});
