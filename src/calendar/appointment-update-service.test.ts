/** Real Guardian -> service -> runtime -> realm, MEMORY only; no physical/process/fence qualification. */
import { expect, test } from 'bun:test';
import type { CalendarParticipantReference } from './contracts';
import { CalendarError } from './error';
import type { CalendarParticipantDirectory } from './participants-directory';
import { memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

const timed = { startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC' };
const later = { startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z', timeZone: 'UTC',
  bufferBeforeMinutes: 5, bufferAfterMinutes: 10 };
const ref = (userId: string): CalendarParticipantReference => ({ kind: 'guardian-user', userId });

function directoryFixture() {
  const available = new Set(['target-a', 'target-b']);
  const checks: string[][] = [];
  const directory: CalendarParticipantDirectory = {
    list() { return { items: [], truncated: false, nextAfter: null }; },
    resolve(_scope, references) { return references.map(reference => available.has(reference.userId)
      ? { ref: reference, availability: 'available' as const, name: 'PRIVATE_TARGET_NAME' }
      : { ref: reference, availability: 'unavailable' as const }); },
    assertBindable(_scope, references) {
      checks.push(references.map(reference => reference.userId));
      for (const reference of references) if (!available.has(reference.userId)) throw new CalendarError('CALENDAR_NOT_FOUND');
    },
    subscribe() { return () => {}; },
  };
  return { available, checks, directory };
}

test('actual atomic update changes title/resources/interval/visit once and preserves omitted facts', async () => {
  const f = memoryCalendarServiceFixture(), manager = f.session('manager', { manager: true });
  try {
    const a = await manager.api.resources.create({ label: 'A', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'a' });
    const b = await manager.api.resources.create({ label: 'B', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'b' });
    const made = await manager.api.appointments.create({ ...timed, resourceIds: [a.id], title: 'Initial' }, { idempotencyKey: 'create' });
    const effects = f.sourceRows(manager.scope, '_calendar_effect_intents').length;
    const patch = { title: 'PRIVATE_ATOMIC_UPDATE', resourceIds: [b.id, a.id], ...later, visit: { mode: 'video' as const } };
    const accepted = await manager.api.appointments.update(made.id, patch, { idempotencyKey: 'update', expectedRevision: 1 });
    expect(accepted).toMatchObject({ operation: 'appointment.updated', id: made.id, revision: 2, changed: true });
    expect(await manager.api.appointments.get(made.id)).toMatchObject({ ...patch, resourceIds: [a.id, b.id].sort(), revision: 2 });
    expect(f.sourceRows(manager.scope, '_calendar_effect_intents')).toHaveLength(effects + 1);
    const seq = f.sourceSequence(manager.scope);
    expect(await manager.api.appointments.update(made.id, patch, { idempotencyKey: 'update', expectedRevision: 1 })).toEqual(accepted);
    expect(f.sourceSequence(manager.scope)).toBe(seq);
    await expect(manager.api.appointments.update(made.id, { ...patch, title: 'different' }, { idempotencyKey: 'update', expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'CALENDAR_INTENT_CONFLICT' });
    const before = await manager.api.appointments.get(made.id);
    await manager.api.appointments.update(made.id, { title: 'title-only' }, { idempotencyKey: 'title', expectedRevision: 2 });
    expect(await manager.api.appointments.get(made.id)).toEqual({ ...before, title: 'title-only', revision: 3 });
    const unchanged = await manager.api.appointments.update(made.id, { title: 'title-only' }, { idempotencyKey: 'noop', expectedRevision: 3 });
    expect(unchanged).toMatchObject({ revision: 3, changed: false });
    await manager.api.appointments.update(made.id, { appointmentType: null, visit: null }, { idempotencyKey: 'clear', expectedRevision: 3 });
    const cleared = await manager.api.appointments.get(made.id);
    expect(cleared).not.toHaveProperty('appointmentType'); expect(cleared).not.toHaveProperty('visit');
    expect(cleared.revision).toBe(4);
    expect(f.stats().activeLeases).toBe(0);
  } finally { await f.close(); }
});

test('rejected atomic occupancy/resource/CAS changes roll back title, binding rows, receipts and effects together', async () => {
  const f = memoryCalendarServiceFixture(), manager = f.session('manager', { manager: true });
  try {
    const a = await manager.api.resources.create({ label: 'A', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'a' });
    const b = await manager.api.resources.create({ label: 'B', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'b' });
    const made = await manager.api.appointments.create({ ...timed, resourceIds: [a.id], title: 'Preserved' }, { idempotencyKey: 'create' });
    await manager.api.appointments.create({ ...timed, resourceIds: [b.id], title: 'Conflicting' }, { idempotencyKey: 'other' });
    const before = await manager.api.appointments.get(made.id), seq = f.sourceSequence(manager.scope);
    const snapshot = ['calendar_appointments', '_calendar_reservations', '_calendar_receipts', '_calendar_effect_intents']
      .map(table => f.sourceRows(manager.scope, table));
    await expect(manager.api.appointments.update(made.id, { title: 'Must rollback', resourceIds: [b.id] }, { idempotencyKey: 'conflict', expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'CALENDAR_BOOKING_CONFLICT', outcome: 'not-committed' });
    await expect(manager.api.appointments.update(made.id, { title: 'Must rollback', resourceIds: ['missing'] }, { idempotencyKey: 'missing', expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await expect(manager.api.appointments.update(made.id, { title: 'Must rollback' }, { idempotencyKey: 'stale', expectedRevision: 2 }))
      .rejects.toMatchObject({ code: 'CALENDAR_REVISION_CONFLICT' });
    expect(await manager.api.appointments.get(made.id)).toEqual(before); expect(f.sourceSequence(manager.scope)).toBe(seq);
    expect(['calendar_appointments', '_calendar_reservations', '_calendar_receipts', '_calendar_effect_intents']
      .map(table => f.sourceRows(manager.scope, table))).toEqual(snapshot);
    expect(await manager.api.receipts.get('conflict')).toBeNull();
  } finally { await f.close(); }
});

test('atomic participant replacement admits new targets only, preserves unavailable existing refs, and replays under current authority', async () => {
  const targets = directoryFixture(), f = memoryCalendarServiceFixture({ config: { participants: { userEligibility: 'user' } }, participantDirectory: targets.directory });
  const manager = f.session('manager', { manager: true }), delegate = f.session('delegate');
  try {
    const resource = await manager.api.resources.create({ label: 'Room', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const made = await manager.api.appointments.create({ ...timed, resourceIds: [resource.id], title: 'Initial', participants: [ref('target-a')] }, { idempotencyKey: 'create' });
    targets.available.delete('target-a'); const start = targets.checks.length;
    const patch = { title: 'PRIVATE_PARTICIPANT_UPDATE', participants: [ref('target-b'), ref('target-a')] };
    const accepted = await manager.api.appointments.update(made.id, patch, { idempotencyKey: 'add', expectedRevision: 1 });
    expect(accepted).toMatchObject({ revision: 2, operation: 'appointment.updated' });
    expect(targets.checks.length).toBeGreaterThan(start);
    expect(targets.checks.slice(start).every(check => JSON.stringify(check) === JSON.stringify(['target-b']))).toBe(true);
    targets.available.delete('target-b'); const checked = targets.checks.length, seq = f.sourceSequence(manager.scope);
    expect(await manager.api.appointments.update(made.id, patch, { idempotencyKey: 'add', expectedRevision: 1 })).toEqual(accepted);
    expect(targets.checks.length).toBe(checked); expect(f.sourceSequence(manager.scope)).toBe(seq);
    await manager.api.resources.setGrants(resource.id, delegate.userId, ['manage'], { idempotencyKey: 'grant', expectedRevision: 1 });
    await delegate.api.appointments.update(made.id, { title: 'Delegated title only' }, { idempotencyKey: 'delegate', expectedRevision: 2 });
    await expect(delegate.api.appointments.update(made.id, { participants: [] }, { idempotencyKey: 'denied', expectedRevision: 3 }))
      .rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    const privatePage = await manager.api.participants.forAppointment(made.id);
    expect(privatePage.participants.map(item => item.ref)).toEqual([ref('target-a'), ref('target-b')]);
    expect(JSON.stringify(await delegate.api.appointments.get(made.id))).not.toContain('target-');
    await manager.api.appointments.update(made.id, { participants: [] }, { idempotencyKey: 'clear', expectedRevision: 3 });
    expect((await manager.api.participants.forAppointment(made.id)).participants).toEqual([]);
    await expect(manager.api.appointments.update(made.id, { participants: [ref('target-a')] }, { idempotencyKey: 'readd', expectedRevision: 4 }))
      .rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
  } finally { await f.close(); }
});

test('participant target loss at the opaque native dispatch fence refuses every field before mutation', async () => {
  const targets = directoryFixture(); let revoke = false;
  const f = memoryCalendarServiceFixture({ config: { participants: { userEligibility: 'user' } }, participantDirectory: targets.directory,
    beforeDispatch(operation) { if (revoke && operation.type === 'command' && operation.name === 'calendar.appointment.update') {
      targets.available.delete('target-b'); revoke = false;
    } } });
  const manager = f.session('manager', { manager: true });
  try {
    const resource = await manager.api.resources.create({ label: 'Room', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const made = await manager.api.appointments.create({ ...timed, resourceIds: [resource.id], title: 'Preserved' }, { idempotencyKey: 'create' });
    const seq = f.sourceSequence(manager.scope), effects = f.sourceRows(manager.scope, '_calendar_effect_intents'); revoke = true;
    await expect(manager.api.appointments.update(made.id, { title: 'Must rollback', participants: [ref('target-b')] }, { idempotencyKey: 'race', expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN', outcome: 'not-started' });
    expect(f.sourceSequence(manager.scope)).toBe(seq); expect(f.sourceRows(manager.scope, '_calendar_effect_intents')).toEqual(effects);
    expect(await manager.api.appointments.get(made.id)).toMatchObject({ title: 'Preserved', revision: 1 });
    expect(await manager.api.receipts.get('race')).toBeNull();
  } finally { await f.close(); }
});

test('service update detaches patch and control values before authority awaits and rejects malformed patches without dispatch', async () => {
  const f = memoryCalendarServiceFixture({ config: { maxResources: 1, maxParticipants: 1 } }), manager = f.session('manager', { manager: true });
  let release!: () => void, enter!: () => void;
  const gate = new Promise<void>(done => { release = done; }), entered = new Promise<void>(done => { enter = done; });
  try {
    const resource = await manager.api.resources.create({ label: 'Room', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const made = await manager.api.appointments.create({ ...timed, resourceIds: [resource.id], title: 'Initial' }, { idempotencyKey: 'create' });
    let first = true;
    const api = f.service.forAuthority({ ...manager.authority, async assertCurrentAuthority() {
      if (first) { first = false; enter(); await gate; }
      await manager.authority.assertCurrentAuthority();
    } });
    const patch = { title: 'Detached', resourceIds: [resource.id], visit: { mode: 'video' as const } }, options = { idempotencyKey: 'detached', expectedRevision: 1 };
    const pending = api.appointments.update(made.id, patch, options); await entered;
    patch.title = 'MUTATED'; patch.resourceIds[0] = 'missing'; patch.visit.mode = 'phone' as never;
    options.idempotencyKey = 'MUTATED'; options.expectedRevision = 99; release();
    expect(await pending).toMatchObject({ requestId: 'detached', revision: 2 });
    expect(await manager.api.appointments.get(made.id)).toMatchObject({ title: 'Detached', resourceIds: [resource.id], visit: { mode: 'video' } });
    const acquisitions = f.stats().acquisitions;
    for (const value of [{}, { title: undefined }, { startAt: timed.startAt }, { resourceIds: ['one', 'two'] },
      { title: 'x', actor: {} }, { participants: [ref('target-a'), ref('target-b')] }]) {
      await expect(manager.api.appointments.update(made.id, value as never, { idempotencyKey: 'invalid', expectedRevision: 2 }))
        .rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    }
    expect(f.stats().acquisitions).toBe(acquisitions);
  } finally { release(); await f.close(); }
});
