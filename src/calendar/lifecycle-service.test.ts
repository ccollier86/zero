/** Real Guardian/service/runtime/realm in native memory only; no actor, listener or physical fixture. */
import { expect, test } from 'bun:test';
import type { CalendarAppointmentTransitions, CalendarLifecyclePolicy } from './contracts';
import { eventuallyCalendar, memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

const times = { startAt: '2026-12-01T10:00:00.000Z', endAt: '2026-12-01T11:00:00.000Z', timeZone: 'UTC' };
test('memory lifecycle policy/projection authorizes every co-resource, remains tenant-local and scopes private history', async () => {
  const f = memoryCalendarServiceFixture(), manager = f.session('manager', { manager: true }), owner = f.session('owner'), delegate = f.session('delegate');
  const other = f.session('other-manager', { manager: true, tenantId: 'tenant-b' });
  try {
    expect(await manager.api.lifecycle.get()).toEqual({ revision: 1, extended: false, cancellationReason: 'optional', noShowReason: 'optional' });
    await expect(owner.api.lifecycle.get()).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' }); expect(f.stats().planes).toBe(0);
    const one = await owner.api.resources.create({ label: 'First', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'one' });
    const two = await manager.api.resources.create({ label: 'Second', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'two' });
    const booking = await manager.api.appointments.create({ resourceIds: [one.id, two.id], title: 'Private synthetic', ...times }, { idempotencyKey: 'booking' });
    await owner.api.resources.setGrants(one.id, delegate.userId, ['manage'], { idempotencyKey: 'first-manage', expectedRevision: 1 });
    await expect(delegate.api.appointments.transitions(booking.id)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await manager.api.resources.setGrants(two.id, delegate.userId, ['details'], { idempotencyKey: 'second-details', expectedRevision: 1 });
    expect((await delegate.api.appointments.get(booking.id)).id).toBe(booking.id);
    await expect(delegate.api.appointments.transitions(booking.id)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await manager.api.resources.setGrants(two.id, delegate.userId, ['manage'], { idempotencyKey: 'second-manage', expectedRevision: 2 });
    expect(await delegate.api.appointments.transitions(booking.id)).toEqual({ id: booking.id, revision: 1, policyRevision: 1, status: 'confirmed', allowed: [{ status: 'cancelled', requiresReason: false }] });
    const changed = await manager.api.lifecycle.replace({ extended: true, cancellationReason: 'required', noShowReason: 'required' }, { idempotencyKey: 'policy', expectedRevision: 1 });
    expect(changed).toMatchObject({ operation: 'lifecycle.policy-changed', id: 'policy', revision: 2 });
    expect(await other.api.lifecycle.get()).toMatchObject({ revision: 1, extended: false });
    await expect(other.api.appointments.transitions(booking.id)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await expect(delegate.api.appointments.transition(booking.id, { status: 'no-show', policyRevision: 1 }, { idempotencyKey: 'stale', expectedRevision: 1 })).rejects.toMatchObject({ code: 'CALENDAR_POLICY_STALE' });
    const transitioned = await delegate.api.appointments.transition(booking.id, { status: 'no-show', policyRevision: 2, reason: 'PRIVATE_REASON' }, { idempotencyKey: 'no-show', expectedRevision: 1 });
    expect(transitioned).toMatchObject({ operation: 'appointment.transitioned', revision: 2 });
    expect(await delegate.api.receipts.get('no-show')).toEqual(transitioned);
    const projection = await delegate.api.appointments.transitions(booking.id);
    expect(projection).toMatchObject({ status: 'no-show', allowed: [] }); expect(JSON.stringify(projection)).not.toContain('PRIVATE_REASON');
    expect(await delegate.api.appointments.get(booking.id)).toMatchObject({ status: 'confirmed', lifecycle: { status: 'no-show', revision: 2, policyRevision: 2, reason: 'PRIVATE_REASON' } });
    expect(JSON.stringify(await delegate.api.busy.query({ resourceIds: [one.id, two.id], startAt: times.startAt, endAt: times.endAt }))).not.toContain('PRIVATE_REASON');
    expect(f.stats().activeLeases).toBe(0);
  } finally { await f.close(); }
});

test('memory lifecycle watches refresh transition policy and terminally withdraw on co-resource or Guardian retirement', async () => {
  const f = memoryCalendarServiceFixture(), manager = f.session('manager', { manager: true }), owner = f.session('owner');
  const policies: CalendarLifecyclePolicy[] = [], projections: CalendarAppointmentTransitions[] = [], errors: unknown[] = [], stops: (() => void)[] = [];
  try {
    const resource = await owner.api.resources.create({ label: 'Owned', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const booking = await owner.api.appointments.create({ resourceIds: [resource.id], title: 'Private', ...times }, { idempotencyKey: 'booking' });
    stops.push(manager.api.lifecycle.watch(value => policies.push(value), { onError: error => errors.push(error) }));
    stops.push(owner.api.appointments.watchTransitions(booking.id, value => projections.push(value), { onError: error => errors.push(error) }));
    await eventuallyCalendar(() => policies.length === 1 && projections.length === 1);
    await manager.api.lifecycle.replace({ extended: true, cancellationReason: 'required', noShowReason: 'required' }, { idempotencyKey: 'policy', expectedRevision: 1 });
    await eventuallyCalendar(() => policies.at(-1)?.revision === 2 && projections.at(-1)?.policyRevision === 2);
    expect(projections.at(-1)?.allowed).toContainEqual({ status: 'no-show', requiresReason: true });
    // A resource ownership transfer does not exist; use a delegated session so
    // management withdrawal exercises the same all-resource projection guard.
    const delegate = f.session('delegate');
    await owner.api.resources.setGrants(resource.id, delegate.userId, ['manage'], { idempotencyKey: 'grant', expectedRevision: 1 });
    let delegated = 0; stops.push(delegate.api.appointments.watchTransitions(booking.id, () => { delegated++; }, { onError: error => errors.push(error) }));
    await eventuallyCalendar(() => delegated > 0);
    await owner.api.resources.setGrants(resource.id, delegate.userId, [], { idempotencyKey: 'revoke', expectedRevision: 2 });
    await eventuallyCalendar(() => errors.length === 1);
    expect(errors[0]).toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    manager.revoke();
    // A domain commit causes the retained manager watch to recheck Guardian.
    await owner.api.appointments.cancel(booking.id, { idempotencyKey: 'cancel', expectedRevision: 1, reason: 'PRIVATE' });
    await eventuallyCalendar(() => errors.length === 2);
    expect(errors[1]).toMatchObject({ code: 'AUTH_STATE_CHANGED' });
  } finally { stops.forEach(stop => stop()); await f.close(); }
});
