/** Synthetic SDK transport only: no app listeners, physical files or generated fixtures. */
import { expect, test } from 'bun:test';
import { createCalendarClient } from './calendar-client';
import type { FetchInit } from './sdk';

const control = { idempotencyKey: 'original-update', expectedRevision: 3 };
const interval = { startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z',
  timeZone: 'UTC', bufferBeforeMinutes: 5, bufferAfterMinutes: 10 };
const receipt = (overrides: Record<string, unknown> = {}) => ({ requestId: control.idempotencyKey,
  operation: 'appointment.updated' as const, id: 'appointment', revision: 4, changed: true, ...overrides });

test('atomic update emits one PUT with a detached sorted flat patch and native control options', async () => {
  const calls: { path: string; init?: FetchInit }[] = [];
  let resolve!: (value: unknown) => void;
  const pending = new Promise<unknown>(done => { resolve = done; });
  const client = createCalendarClient(async <T>(path: string, init?: FetchInit) => {
    calls.push({ path, init }); return await pending as T;
  });
  const input = { title: 'PRIVATE_UPDATE_TITLE', resourceIds: ['resource-b', 'resource-a'], ...interval,
    appointmentType: { id: 'type', revision: 2 }, visit: { mode: 'in-person' as const, location: { id: 'location', revision: 4 } },
    participants: [{ kind: 'guardian-user' as const, userId: 'user-b' }, { kind: 'guardian-user' as const, userId: 'user-a' }] };
  const options = { ...control };
  try {
    const update = client.appointments.update('appointment', input, options);
    input.title = 'MUTATED'; input.resourceIds.push('MUTATED'); input.appointmentType.revision = 99;
    input.visit.location.id = 'MUTATED'; input.participants[0]!.userId = 'MUTATED'; options.idempotencyKey = 'MUTATED';
    expect(calls).toHaveLength(1); expect(calls[0]!.path).toBe('/api/calendar/appointments/appointment');
    expect(calls[0]!.init).toMatchObject({ method: 'PUT', body: { appointment: {
      title: 'PRIVATE_UPDATE_TITLE', resourceIds: ['resource-a', 'resource-b'], ...interval,
      appointmentType: { id: 'type', revision: 2 }, visit: { mode: 'in-person', location: { id: 'location', revision: 4 } },
      participants: [{ kind: 'guardian-user', userId: 'user-a' }, { kind: 'guardian-user', userId: 'user-b' }],
    }, options: control } });
    resolve(receipt()); expect(await update).toEqual(receipt());
  } finally { resolve(receipt()); client.clear(); }
});

test('update SDK preserves omission versus explicit clears and accepts exact noop revision', async () => {
  const bodies: unknown[] = [];
  const client = createCalendarClient(async <T>(_path: string, init?: FetchInit) => {
    bodies.push(init?.body); return receipt({ changed: false, revision: 3 }) as T;
  });
  try {
    expect(await client.appointments.update('appointment', { title: 'same' }, control)).toMatchObject({ changed: false, revision: 3 });
    await client.appointments.update('appointment', { appointmentType: null, visit: null, participants: [] }, control);
    expect(bodies).toEqual([{ appointment: { title: 'same' }, options: control },
      { appointment: { appointmentType: null, visit: null, participants: [] }, options: control }]);
  } finally { client.clear(); }
});

test('update SDK rejects empty/partial/oversized/unknown/getter patches and authored controls before dispatch', () => {
  let calls = 0, getters = 0;
  const client = createCalendarClient(async <T>() => { calls++; return receipt() as T; });
  try {
    for (const patch of [{}, { title: undefined }, { title: '' }, { title: 'x', id: 'forged' },
      { startAt: interval.startAt }, { ...interval, bufferAfterMinutes: undefined },
      { resourceIds: [] }, { resourceIds: ['same', 'same'] }, { resourceIds: Array.from({ length: 17 }, (_, n) => 'resource-' + n) },
      { participants: [{ kind: 'guardian-user', userId: 'same' }, { kind: 'guardian-user', userId: 'same' }] },
      { participants: [{ kind: 'guardian-user', userId: 'target', name: 'FORGED' }] },
      { appointmentType: { id: 'type', revision: 1, label: 'FORGED' } }, { visit: { mode: 'video', location: null } },
      { actor: { manageAll: true }, title: 'x' }, { get title() { getters++; return 'x'; } }]) {
      expect(() => client.appointments.update('appointment', patch as never, control)).toThrow();
    }
    for (const options of [{ idempotencyKey: 'key' }, { ...control, expectedRevision: 0 }, { ...control, ownerId: 'forged' }]) {
      expect(() => client.appointments.update('appointment', { title: 'x' }, options as never)).toThrow();
    }
    expect(calls).toBe(0); expect(getters).toBe(0);
  } finally { client.clear(); }
});

test('update acknowledgments correlate original key, operation, target, changed flag and native CAS revision', async () => {
  for (const value of [receipt({ requestId: 'other' }), receipt({ operation: 'appointment.rescheduled' }),
    receipt({ id: 'other' }), receipt({ revision: 3 }), receipt({ changed: false, revision: 4 }), receipt({ private: 'BODY' })]) {
    const client = createCalendarClient(async <T>() => value as T);
    try {
      await expect(client.appointments.update('appointment', { title: 'x' }, control)).rejects.toMatchObject({
        outcome: 'unknown', idempotencyKey: control.idempotencyKey, requiresSameIdempotencyKey: true,
      });
    } finally { client.clear(); }
  }
});

test('update SDK never retries unknown outcomes and preserves bounded native refusal details', async () => {
  for (const cause of [new Error('PRIVATE_NETWORK_BODY'), { status: 409, body: {
    code: 'CALENDAR_REVISION_CONFLICT', outcome: 'not-committed', private: 'PRIVATE_SERVER_BODY',
  } }]) {
    let calls = 0;
    const client = createCalendarClient(async () => { calls++; throw cause; });
    try {
      const failure = await client.appointments.update('appointment', { title: 'x' }, control).catch(error => error);
      expect(failure.idempotencyKey).toBe(control.idempotencyKey); expect(calls).toBe(1);
      expect(failure.outcome).toBe(cause instanceof Error ? 'unknown' : 'not-committed');
      expect(JSON.stringify(failure)).not.toContain('PRIVATE_');
    } finally { client.clear(); }
  }
});

test('authority replacement after update dispatch retires delivery as unknown with the original key', async () => {
  let resolve!: (value: unknown) => void;
  const response = new Promise<unknown>(done => { resolve = done; });
  const client = createCalendarClient(async <T>() => await response as T);
  try {
    const pending = client.appointments.update('appointment', { title: 'x' }, control);
    client.clear(); resolve(receipt());
    await expect(pending).rejects.toMatchObject({ name: 'AbortError', outcome: 'unknown', idempotencyKey: control.idempotencyKey });
  } finally { resolve(receipt()); client.clear(); }
});
