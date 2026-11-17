/** Synthetic JSON/SSE only; no listener, fixture directories, actors or file-backed databases. */
import { expect, test } from 'bun:test';
import { createCalendarClient } from './calendar-client';
import type { FetchInit } from './sdk';

const policy = { revision: 1, extended: false, cancellationReason: 'optional' as const, noShowReason: 'optional' as const };
const { revision: _revision, ...replacement } = policy;
const transitions = { id: 'appointment', revision: 3, policyRevision: 1, status: 'confirmed' as const, allowed: [{ status: 'cancelled' as const, requiresReason: false }] };
const control = { idempotencyKey: 'original', expectedRevision: 3 };
const receipt = (operation: string, id = transitions.id, revision = 4) => ({ requestId: control.idempotencyKey, operation, id, revision, changed: true });
const appointment = { id: 'appointment', revision: 3, resourceIds: ['resource'], title: 'Private',
  startAt: '2026-12-01T10:00:00.000Z', endAt: '2026-12-01T11:00:00.000Z', timeZone: 'UTC',
  bufferBeforeMinutes: 0, bufferAfterMinutes: 0, status: 'confirmed', createdBy: 'owner' };

test('lifecycle paths and mutation envelopes detach input and keep legacy cancellation JSON byte-shape', async () => {
  const calls: { path: string; init?: FetchInit }[] = [];
  const client = createCalendarClient(async <T>(path: string, init?: FetchInit) => {
    calls.push({ path, init });
    return (init?.method === 'PUT' ? receipt('lifecycle.policy-changed', 'policy', 2)
      : path.endsWith('/transition') ? receipt('appointment.transitioned') : path.endsWith('/cancel') ? receipt('appointment.cancelled')
      : path.endsWith('/transitions') ? transitions : policy) as T;
  });
  try {
    expect(await client.lifecycle.get()).toEqual(policy);
    const input = { ...replacement, extended: true }, supplied = { idempotencyKey: 'original', expectedRevision: 1 };
    const replacing = client.lifecycle.replace(input, supplied); input.extended = false; supplied.idempotencyKey = 'changed'; await replacing;
    expect(await client.appointments.transitions('appointment')).toEqual(transitions);
    const transition = { status: 'cancelled' as const, policyRevision: 1, reason: '  Private reason  ' };
    const moving = client.appointments.transition('appointment', transition, control); transition.reason = 'changed'; await moving;
    await client.appointments.cancel('appointment', control);
    await client.appointments.cancel('appointment', { ...control, reason: '  Private reason  ' });
    expect(calls.map(call => call.path)).toEqual(['/api/calendar/lifecycle', '/api/calendar/lifecycle',
      '/api/calendar/appointments/appointment/transitions', '/api/calendar/appointments/appointment/transition',
      '/api/calendar/appointments/appointment/cancel', '/api/calendar/appointments/appointment/cancel']);
    expect(calls[1]!.init).toMatchObject({ method: 'PUT', body: { policy: { ...replacement, extended: true }, options: { idempotencyKey: 'original', expectedRevision: 1 } } });
    expect(calls[3]!.init!.body).toEqual({ transition: { status: 'cancelled', policyRevision: 1, reason: 'Private reason' }, options: control });
    expect(calls[4]!.init!.body).toEqual({ options: control });
    expect(calls[5]!.init!.body).toEqual({ options: control, reason: 'Private reason' });
  } finally { client.clear(); }
});

test('lifecycle admission rejects incomplete policy, authored authority, reason bounds and getters without dispatch', () => {
  let calls = 0, getters = 0;
  const client = createCalendarClient(async <T>() => { calls++; return null as T; });
  try {
    for (const value of [{ ...replacement, revision: 1 }, { ...replacement, extended: 'true' }, { extended: true }, { ...replacement, actor: {} }]) {
      expect(() => client.lifecycle.replace(value as never, control)).toThrow();
    }
    for (const value of [{ status: 'confirmed', policyRevision: 0 }, { status: 'other', policyRevision: 1 },
      { status: 'completed', policyRevision: 1, reason: 'Private reason' },
      { status: 'cancelled', policyRevision: 1, reason: ' ' }, { status: 'cancelled', policyRevision: 1, reason: 'x'.repeat(1025) },
      { status: 'cancelled', policyRevision: 1, reason: 'private\nreason' }, { status: 'cancelled', policyRevision: 1, id: 'forged' },
      { get status() { getters++; return 'cancelled'; }, policyRevision: 1 }]) {
      expect(() => client.appointments.transition('appointment', value as never, control)).toThrow();
    }
    expect(() => client.appointments.cancel('appointment', { ...control, reason: undefined } as never)).toThrow();
    expect(calls).toBe(0); expect(getters).toBe(0);
  } finally { client.clear(); }
});

test('policy and transition DTOs fail closed on extra private fields, identity/revision errors and terminal transitions', async () => {
  for (const value of [{ ...policy, revision: 0 }, { ...policy, cancellationReason: 'other' }, { ...policy, reason: 'PRIVATE' }, { extended: false }]) {
    const client = createCalendarClient(async <T>() => value as T);
    try { await expect(client.lifecycle.get()).rejects.toThrow('Calendar data could not be loaded'); } finally { client.clear(); }
  }
  for (const value of [{ ...transitions, id: 'other' }, { ...transitions, revision: 0 }, { ...transitions, policyRevision: 0 },
    { ...transitions, reason: 'PRIVATE' }, { ...transitions, allowed: [{ status: 'confirmed', requiresReason: false }] },
    { ...transitions, allowed: [{ status: 'completed', requiresReason: true }] },
    { ...transitions, allowed: [transitions.allowed[0], transitions.allowed[0]] }, { ...transitions, status: 'completed' }]) {
    const client = createCalendarClient(async <T>() => value as T);
    try { await expect(client.appointments.transitions('appointment')).rejects.toThrow('Calendar data could not be loaded'); } finally { client.clear(); }
  }
});

test('optional private lifecycle is exact, frozen and correlated to appointment occupancy and source revision', async () => {
  const lifecycle = { status: 'no-show' as const, revision: 2, policyRevision: 1, reason: 'Private reason' };
  const client = createCalendarClient(async <T>() => ({ ...appointment, lifecycle }) as T);
  try {
    const accepted = await client.appointments.get('appointment'); expect(accepted.lifecycle).toEqual(lifecycle);
    expect(accepted.lifecycle).not.toBe(lifecycle); expect(Object.isFrozen(accepted.lifecycle)).toBe(true);
  } finally { client.clear(); }
  for (const value of [null, undefined, { ...lifecycle, revision: 4 }, { ...lifecycle, policyRevision: 0 },
    { ...lifecycle, status: 'cancelled' }, { ...lifecycle, status: 'confirmed' }, { ...lifecycle, reason: ' Private reason' },
    { ...lifecycle, reason: null, actor: {} }]) {
    const invalid = createCalendarClient(async <T>() => ({ ...appointment, lifecycle: value }) as T);
    try { await expect(invalid.appointments.get('appointment')).rejects.toThrow('Calendar data could not be loaded'); } finally { invalid.clear(); }
  }
  const legacy = createCalendarClient(async <T>() => appointment as T);
  try { expect(await legacy.appointments.get('appointment')).not.toHaveProperty('lifecycle'); } finally { legacy.clear(); }
});

test('new command receipts correlate operation, policy target and revision; rejection codes retain safe known outcomes', async () => {
  for (const value of [receipt('appointment.cancelled'), receipt('appointment.transitioned', 'other'), receipt('appointment.transitioned', 'appointment', 3),
    { ...receipt('appointment.transitioned'), requestId: 'other' }]) {
    const client = createCalendarClient(async <T>() => value as T);
    try { await expect(client.appointments.transition('appointment', { status: 'cancelled', policyRevision: 1 }, control)).rejects.toMatchObject({ outcome: 'unknown', idempotencyKey: 'original' }); }
    finally { client.clear(); }
  }
  const badPolicy = createCalendarClient(async <T>() => receipt('lifecycle.policy-changed', 'other', 2) as T);
  try { await expect(badPolicy.lifecycle.replace(replacement, { ...control, expectedRevision: 1 })).rejects.toMatchObject({ outcome: 'unknown' }); } finally { badPolicy.clear(); }
  for (const code of ['CALENDAR_TRANSITION_INVALID', 'CALENDAR_REASON_REQUIRED', 'CALENDAR_POLICY_STALE']) {
    const client = createCalendarClient(async () => { throw { status: 409, body: { code, outcome: 'not-committed', reason: 'PRIVATE' } }; });
    try { const failure = await client.appointments.transition('appointment', { status: 'cancelled', policyRevision: 1 }, control).catch(error => error);
      expect(failure).toMatchObject({ code, outcome: 'not-committed', requiresReconciliation: false }); expect(JSON.stringify(failure)).not.toContain('PRIVATE'); }
    finally { client.clear(); }
  }
});

test('lifecycle watches terminate malformed projections and release private readers on authority retirement', async () => {
  const paths: string[] = [], signals: AbortSignal[] = [], controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
  const values: unknown[] = [], errors: unknown[] = [], stops: (() => void)[] = [];
  const client = createCalendarClient(async () => { throw new Error('No side reads.'); }, async (path, init) => {
    paths.push(path); signals.push(init.signal as AbortSignal);
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { controllers.push(controller); } }), { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const frame = (value: unknown) => new TextEncoder().encode('data: ' + JSON.stringify({ version: 1, value }) + '\n\n');
  try {
    stops.push(client.lifecycle.watch(value => values.push(value), { onError: error => errors.push(error) }));
    stops.push(client.appointments.watchTransitions('appointment', value => values.push(value), { onError: error => errors.push(error) }));
    expect(paths).toEqual(['/api/calendar/lifecycle/live', '/api/calendar/appointments/appointment/transitions/live']);
    controllers[0]!.enqueue(frame(policy)); controllers[1]!.enqueue(frame(transitions)); await settle(() => values.length === 2);
    controllers[1]!.enqueue(frame({ ...transitions, id: 'other' })); await settle(() => errors.length === 1);
    expect(signals[1]!.aborted).toBe(true); expect(values).toHaveLength(2);
    client.clear(); expect(signals[0]!.aborted).toBe(true);
  } finally { stops.forEach(stop => stop()); client.clear(); }
});

async function settle(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) { if (check()) return; await new Promise<void>(resolve => setTimeout(resolve, 5)); }
  throw new Error('Synthetic lifecycle client fixture timed out.');
}
