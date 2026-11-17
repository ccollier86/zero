/** Boundary unit only: real Guardian admission plus an in-memory broker spy, not Fabric qualification. */
import { describe, expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { authContextAuthorityFingerprint } from '../auth/auth-context-authority';
import { createRequestAuthorizationAccess } from '../auth/authorization-access';
import { createAuthorizationKernel } from '../auth/authorization-kernel';
import { requireRequestServiceDataScope, type ServiceDataScope } from '../auth/service-data-scope';
import { AuthError, type AuthContext } from '../auth/types';
import type { CalendarAuthority } from './authority';
import { resolveCalendarConfig, type ResolvedCalendarConfig } from './config';
import type { CalendarActor, CalendarAppointmentPage, CalendarCommandReceipt } from './contracts';
import { CalendarError } from './error';
import { CalendarService, type CalendarServiceBroker } from './service';
import { calendarHash } from './validation';

type WriteCall = { scope: ServiceDataScope; name: string; input: Record<string, unknown>; requestId: string; guard: () => void; signal?: AbortSignal };
type ReadCall = Omit<WriteCall, 'requestId'>;
const resource = () => ({ label: 'Synthetic person', kind: 'person', ownerId: 'calendar-user', timeZone: 'UTC' });
const appointment = () => ({ resourceIds: ['synthetic-resource'], title: 'Synthetic appointment',
  startAt: '2026-11-16T10:00:00.000Z', endAt: '2026-11-16T11:00:00.000Z', timeZone: 'UTC',
  bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });

/** The callbacks rehydrate a fresh actual Guardian facade, never a permissive access mock. */
function fixture(tenancy: 'single' | 'multi' = 'single', overrides: Partial<AuthContext> = {}) {
  const auth = resolveAuthBehaviorConfig({ tenancy });
  const kernel = createAuthorizationKernel(auth);
  let live: AuthContext | null = {
    userId: 'calendar-user', email: 'calendar@example.test', role: 'user', credentialKind: 'session',
    sessionKind: 'web', sessionId: 'synthetic-session', sessionGeneration: 1, authGeneration: 1,
    ...(tenancy === 'single' ? { sessionScopeKind: 'application' as const, sessionScopeId: 'application' }
      : { sessionScopeKind: 'tenant' as const, sessionScopeId: 'synthetic-tenant', tenantId: 'synthetic-tenant',
        membershipId: 'synthetic-membership', tenantKind: 'organization' as const, tenantRole: 'owner',
        tenantAuthorizationGeneration: 1, membershipAuthorizationGeneration: 1 }),
    ...overrides,
  };
  const captured = authContextAuthorityFingerprint(live);
  let syncChecks = 0, asyncChecks = 0;
  let beforeCurrent: (() => Promise<void>) | undefined;
  const assertCurrentAuthoritySync = () => {
    syncChecks++;
    if (!live || authContextAuthorityFingerprint(live) !== captured) throw new AuthError('Forbidden', 'FORBIDDEN', 403);
  };
  const access = () => createRequestAuthorizationAccess({ kernel, authContext: live, assertCurrentProfile: assertCurrentAuthoritySync });
  const scope = requireRequestServiceDataScope(access(), () => kernel);
  const request: CalendarAuthority = {
    get access() { return access(); }, scope, assertCurrentAuthoritySync,
    async assertCurrentAuthority() { asyncChecks++; await beforeCurrent?.(); assertCurrentAuthoritySync(); },
  };
  const config = resolveCalendarConfig({ timezone: 'UTC' }, '/synthetic-calendar-boundary', auth);
  if (config === false) throw new Error('Synthetic calendar configuration missing.');
  const closing = new AbortController();
  const calls: WriteCall[] = [];
  let onWrite: ((call: WriteCall) => Promise<CalendarCommandReceipt>) | undefined;
  let onRead: ((call: ReadCall) => Promise<unknown>) | undefined;
  let onSubscribe: (() => void) | undefined;
  let readCalls = 0;
  const listeners = new Set<() => void>();
  const receipt = (call: WriteCall): CalendarCommandReceipt => ({ requestId: call.requestId,
    operation: ({ 'calendar.resource.create': 'resource.created', 'calendar.resource.grant': 'resource.grant-changed',
      'calendar.resource.availability': 'resource.availability-changed', 'calendar.block.create': 'block.created',
      'calendar.block.reschedule': 'block.rescheduled', 'calendar.block.cancel': 'block.cancelled',
      'calendar.hold.acquire': 'hold.acquired', 'calendar.hold.release': 'hold.released', 'calendar.hold.confirm': 'appointment.created',
      'calendar.appointment.create': 'appointment.created', 'calendar.appointment.reschedule': 'appointment.rescheduled',
      'calendar.appointment.cancel': 'appointment.cancelled' } as const)[call.name as 'calendar.resource.create'],
    id: (call.name === 'calendar.hold.confirm' ? call.input.appointmentId : call.input.id) as string, revision: 1, changed: true });
  const broker: CalendarServiceBroker = {
    async read<T>(scope: ServiceDataScope, name: string, input: unknown, guard: () => void, signal?: AbortSignal): Promise<T> {
      readCalls++; guard();
      if (!onRead) throw new Error('Boundary fixture must never read or reconcile automatically.');
      return await onRead({ scope, name, input: input as Record<string, unknown>, guard, signal }) as T;
    },
    async write<T>(scope: ServiceDataScope, name: string, input: unknown, requestId: string, guard: () => void, signal?: AbortSignal): Promise<T> {
      const call = { scope, name, input: input as Record<string, unknown>, requestId, guard, signal };
      calls.push(call);
      guard();
      return (onWrite ? await onWrite(call) : receipt(call)) as T;
    },
    subscribe(_scope, listener) { listeners.add(listener); onSubscribe?.(); return () => { listeners.delete(listener); }; },
  };
  const service = new CalendarService(broker, config, closing.signal);
  return { request, config, closing, calls, service, receipt, get readCalls() { return readCalls; },
    get syncChecks() { return syncChecks; }, get asyncChecks() { return asyncChecks; },
    setBeforeCurrent(callback: () => Promise<void>) { beforeCurrent = callback; },
    setOnWrite(callback: (call: WriteCall) => Promise<CalendarCommandReceipt>) { onWrite = callback; },
    setOnRead(callback: (call: ReadCall) => Promise<unknown>) { onRead = callback; },
    setOnSubscribe(callback: () => void) { onSubscribe = callback; },
    get subscriptions() { return listeners.size; },
    revoke() { live = null; },
  };
}

describe('calendar internal service boundary (in-memory broker, not Fabric)', () => {
  for (const kind of ['blocks', 'holds', 'availability'] as const) {
    test(`${kind} watch detaches routing before await and conceals a delayed read after authority retirement`, async () => {
      const f = fixture(), api = f.service.forAuthority(f.request), errors: unknown[] = [];
      let entered!: () => void, release!: () => void, captured!: ReadCall, delivered = 0;
      const reading = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
      f.setOnRead(async call => { captured = call; entered(); await gate; return { private: 'NEVER_DELIVER' }; });
      const query = { resourceIds: ['original'], startAt: '2026-11-16T00:00:00.000Z', endAt: '2026-11-17T00:00:00.000Z' };
      const stop = kind === 'blocks' ? api.blocks.watch(query, () => { delivered++; }, { onError: error => errors.push(error) })
        : kind === 'holds' ? api.holds.watch(query, () => { delivered++; }, { onError: error => errors.push(error) })
        : api.availability.watch('original', () => { delivered++; }, { onError: error => errors.push(error) });
      try {
        query.resourceIds[0] = 'retargeted'; await reading;
        expect(captured.name).toBe(kind === 'availability' ? 'calendar.availability' : 'calendar.' + kind);
        expect(captured.input).toMatchObject(kind === 'availability' ? { id: 'original' } : { resourceIds: ['original'] });
        f.revoke(); release();
        for (let attempt = 0; errors.length === 0 && attempt < 100; attempt++) await new Promise<void>(resolve => setTimeout(resolve, 0));
        expect(errors).toHaveLength(1); expect(errors[0]).toMatchObject({ code: 'FORBIDDEN' }); expect(delivered).toBe(0); expect(f.subscriptions).toBe(0);
      } finally { release(); stop(); await f.service.close(); }
    });
  }
  test('only fixed commands are exposed, and reserved authority/routing/identity fields cannot be client-selected', async () => {
    const f = fixture(), api = f.service.forAuthority(f.request);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.keys(api).sort()).toEqual(['appointments', 'availability', 'blocks', 'busy', 'createAppointment', 'createResource', 'holds', 'locations', 'receipts', 'resources']);
    const baselineChecks = f.syncChecks;
    for (const field of ['actor', 'scope', 'scopeId', 'tenantId', 'userId', 'principal', 'manageAll', 'createOwn',
      'operation', 'name', 'id', 'requestId', 'createdBy', 'revision']) {
      for (const [create, input] of [[api.createResource, resource()], [api.createAppointment, appointment()]] as const) {
        await expect(create({ ...input, [field]: 'client-selected' }, 'synthetic-reserved'))
          .rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
      }
    }
    expect(f.syncChecks).toBe(baselineChecks);
    expect(f.asyncChecks).toBe(0);
    expect(f.calls).toHaveLength(0);
    expect(f.readCalls).toBe(0);
  });

  test('hold facades detach input, reject authored authority and derive a distinct confirmation appointment identity', async () => {
    const f = fixture(), api = f.service.forAuthority(f.request);
    const hold = { resourceIds: ['synthetic-resource'], startAt: appointment().startAt, endAt: appointment().endAt,
      timeZone: 'UTC', ttlSeconds: 120, bufferBeforeMinutes: 5 };
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); f.setBeforeCurrent(() => gate);
    try {
      const acquiring = api.holds.acquire(hold, { idempotencyKey: 'hold-acquire' });
      hold.resourceIds[0] = 'retargeted'; hold.ttlSeconds = 900; release();
      const acquired = await acquiring;
      expect(acquired.operation).toBe('hold.acquired');
      expect(f.calls[0]!.input).toMatchObject({ resourceIds: ['synthetic-resource'], ttlSeconds: 120 });
      const confirmed = await api.holds.confirm(acquired.id, { title: 'Private confirmed title' }, { idempotencyKey: 'hold-confirm', expectedRevision: 1 });
      const actor = f.calls[1]!.input.actor as CalendarActor;
      const appointmentId = calendarHash(['appointment-from-hold', actor.scopeId, actor.principal, 'hold-confirm']);
      expect(confirmed).toMatchObject({ operation: 'appointment.created', id: appointmentId });
      expect(confirmed.id).not.toBe(acquired.id);
      expect(f.calls[1]!.input).toMatchObject({ id: acquired.id, appointmentId, expectedRevision: 1, title: 'Private confirmed title' });
      await api.holds.release(acquired.id, { idempotencyKey: 'hold-release', expectedRevision: 2 });
      expect(f.calls[2]!.input).toMatchObject({ id: acquired.id, expectedRevision: 2, confirmed: true });
      const count = f.calls.length;
      for (const field of ['actor', 'scopeId', 'id', 'appointmentId', 'createdBy', 'now', 'expiresAt', 'requestId']) {
        await expect(api.holds.acquire({ ...hold, [field]: 'forged' }, { idempotencyKey: 'forged' })).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
        await expect(api.holds.confirm(acquired.id, { title: 'Title', [field]: 'forged' } as never,
          { idempotencyKey: 'forged', expectedRevision: 1 })).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
      }
      for (const ttlSeconds of [0, 901, 1.5]) await expect(api.holds.acquire({ ...hold, ttlSeconds }, { idempotencyKey: 'bad-ttl' })).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
      await expect(api.holds.release(acquired.id, { idempotencyKey: 'no-revision' } as never)).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
      expect(f.calls).toHaveLength(count);
      f.setOnWrite(async call => ({ ...f.receipt(call), id: acquired.id }));
      await expect(api.holds.confirm(acquired.id, { title: 'Title' }, { idempotencyKey: 'wrong-confirm-receipt', expectedRevision: 1 }))
        .rejects.toMatchObject({ code: 'CALENDAR_OUTCOME_UNKNOWN' });
    } finally { release(); await f.service.close(); }
  });

  test('block and availability facades preserve canonical routing, IDs, revisions and detached authored input', async () => {
    const f = fixture(), api = f.service.forAuthority(f.request);
    const block = { resourceIds: ['synthetic-resource'], title: 'Synthetic private block', startAt: appointment().startAt,
      endAt: appointment().endAt, timeZone: 'UTC' };
    const availability = { mode: 'windows' as const, windows: [{ startAt: block.startAt, endAt: block.endAt }] };
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); f.setBeforeCurrent(() => gate);
    try {
      const created = api.blocks.create(block, { idempotencyKey: 'block-create' });
      const replaced = api.availability.replace('synthetic-resource', availability, { idempotencyKey: 'availability-replace', expectedRevision: 4 });
      block.resourceIds[0] = 'retargeted'; availability.windows[0]!.endAt = '2026-11-16T12:00:00.000Z';
      release();
      const receipt = await created; await replaced;
      expect(receipt.operation).toBe('block.created');
      expect(f.calls[0]!.input).toMatchObject({ resourceIds: ['synthetic-resource'], id: calendarHash([
        'application', (f.calls[0]!.input.actor as CalendarActor).principal, 'block-create']) });
      expect(f.calls[1]!.input).toMatchObject({ id: 'synthetic-resource', expectedRevision: 4,
        windows: [{ startAt: appointment().startAt, endAt: appointment().endAt }] });
      await api.blocks.reschedule(receipt.id, { startAt: block.startAt, endAt: block.endAt, timeZone: 'UTC' }, { idempotencyKey: 'block-move', expectedRevision: 1 });
      await api.blocks.cancel(receipt.id, { idempotencyKey: 'block-cancel', expectedRevision: 2 });
      expect(f.calls.map(call => call.name)).toEqual(['calendar.block.create', 'calendar.resource.availability', 'calendar.block.reschedule', 'calendar.block.cancel']);
      expect(f.calls[2]!.input).not.toHaveProperty('bufferBeforeMinutes');
      expect(f.calls[3]!.input).toHaveProperty('confirmed', true);
      expect(f.calls[3]!.input).toMatchObject({ id: receipt.id, expectedRevision: 2 });
      const readNames: string[] = [];
      f.setOnRead(async call => { readNames.push(call.name); return {}; });
      await api.blocks.query({ resourceIds: [], startAt: block.startAt, endAt: block.endAt });
      await api.blocks.get(receipt.id); await api.availability.get('synthetic-resource');
      expect(readNames).toEqual(['calendar.blocks', 'calendar.block', 'calendar.availability']);
    } finally { release(); await f.service.close(); }
  });

  test('new facade input cannot choose authority or appointment-only buffers and respects narrowed resource limits', async () => {
    const f = fixture(), api = f.service.forAuthority(f.request), block = { resourceIds: ['resource-a'], title: 'Block',
      startAt: appointment().startAt, endAt: appointment().endAt, timeZone: 'UTC' };
    const narrowService = new CalendarService({} as CalendarServiceBroker, { ...f.config, maxResources: 1 }, f.closing.signal);
    const narrow = narrowService.forAuthority(f.request);
    try {
      for (const input of [{ ...block, actor: {} }, { ...block, id: 'chosen' }, { ...block, bufferBeforeMinutes: 5 }]) {
        await expect(api.blocks.create(input, { idempotencyKey: 'invalid-block' })).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
      }
      await expect(api.availability.replace('resource-a', { mode: 'windows', windows: [], scope: 'other' } as never,
        { idempotencyKey: 'invalid-availability', expectedRevision: 1 })).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
      await expect(narrow.blocks.create({ ...block, resourceIds: ['resource-a', 'resource-b'] }, { idempotencyKey: 'too-many' })).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
      await expect(narrow.blocks.query({ resourceIds: ['resource-a', 'resource-b'], startAt: block.startAt, endAt: block.endAt })).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
      await expect(api.blocks.cancel('block-a', { idempotencyKey: 'missing-revision' } as never)).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
      expect(f.calls).toHaveLength(0); expect(f.readCalls).toBe(0); expect(f.asyncChecks).toBe(0);
    } finally { await narrowService.close(); await f.service.close(); }
  });

  test('scope, actor, operation and stable IDs come from the admitted Guardian authority in both tenancy modes', async () => {
    const ids: string[] = [];
    for (const tenancy of ['single', 'multi'] as const) {
      const f = fixture(tenancy), api = f.service.forAuthority(f.request);
      const first = await api.createResource(resource(), 'synthetic-create');
      await api.createResource(resource(), 'synthetic-create');
      await api.createAppointment(appointment(), 'synthetic-appointment');
      const [call, replay, booking] = f.calls;
      const scopeId = tenancy === 'single' ? 'application' : 'tenant:synthetic-tenant';
      const actor: CalendarActor = { scopeId, userId: 'calendar-user',
        principal: calendarHash(['calendar-user', 'session', null, 'web', null]),
        manageAll: tenancy === 'multi', createOwn: true };
      const expectedId = calendarHash([scopeId, actor.principal, 'synthetic-create']);
      expect(call!.scope).toBe(f.request.scope);
      expect(call!.name).toBe('calendar.resource.create');
      expect(call!.requestId).toBe('synthetic-create');
      expect(call!.input).toEqual({ ...resource(), actor, requestId: 'synthetic-create', id: expectedId });
      expect(Object.isFrozen(call!.input.actor)).toBe(true);
      expect(replay!.input.id).toBe(expectedId);
      expect(booking!.name).toBe('calendar.appointment.create');
      expect(booking!.input).toEqual({ ...appointment(), actor, requestId: 'synthetic-appointment',
        id: calendarHash([scopeId, actor.principal, 'synthetic-appointment']) });
      expect(first).toEqual(f.receipt(call!));
      expect(f.asyncChecks).toBe(6);
      expect(f.readCalls).toBe(0);
      ids.push(expectedId);
    }
    expect(ids[0]).not.toBe(ids[1]);
  });

  test('command input and nested resource selection are detached before the first authority await', async () => {
    const f = fixture(), input = appointment();
    let release!: () => void;
    const pendingAuthority = new Promise<void>(resolve => { release = resolve; });
    f.setBeforeCurrent(() => pendingAuthority);
    const pending = f.service.forAuthority(f.request).createAppointment(input, 'synthetic-detach');
    expect(f.asyncChecks).toBe(1);
    expect(f.calls).toHaveLength(0);
    input.title = 'Changed after admission began';
    input.resourceIds[0] = 'retargeted-resource';
    input.resourceIds.push('another-resource');
    release();
    await pending;
    expect(f.calls[0]!.input.title).toBe('Synthetic appointment');
    expect(f.calls[0]!.input.resourceIds).toEqual(['synthetic-resource']);
    expect(f.calls[0]!.input.resourceIds).not.toBe(input.resourceIds);
  });

  test('revocation during admission prevents dispatch, and a captured broker guard remains live', async () => {
    const f = fixture();
    let release!: () => void;
    const pendingAuthority = new Promise<void>(resolve => { release = resolve; });
    f.setBeforeCurrent(() => pendingAuthority);
    const pending = f.service.forAuthority(f.request).createResource(resource(), 'synthetic-revoked-before');
    f.revoke(); release();
    await expect(pending).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.calls).toHaveLength(0);

    const admitted = fixture();
    await admitted.service.forAuthority(admitted.request).createResource(resource(), 'synthetic-guard');
    admitted.revoke();
    expect(() => admitted.calls[0]!.guard()).toThrow();
  });

  test('revocation after a completed write conceals the receipt as outcome unknown without retry or reconciliation', async () => {
    const f = fixture();
    f.setOnWrite(async call => { const committed = f.receipt(call); f.revoke(); return committed; });
    let failure: unknown;
    try { await f.service.forAuthority(f.request).createAppointment(appointment(), 'synthetic-revoked-after'); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(CalendarError);
    expect(failure).toMatchObject({ code: 'CALENDAR_OUTCOME_UNKNOWN', status: 503, outcome: 'unknown' });
    expect(failure).not.toHaveProperty('id');
    expect(failure).not.toHaveProperty('cause');
    expect(f.calls).toHaveLength(1);
    expect(f.readCalls).toBe(0);
    expect(f.calls[0]!.requestId).toBe('synthetic-revoked-after');
  });

  test('broker failures are not retried or followed by reads', async () => {
    const f = fixture(), failure = new CalendarError('CALENDAR_OUTCOME_UNKNOWN');
    f.setOnWrite(async () => { throw failure; });
    await expect(f.service.forAuthority(f.request).createResource(resource(), 'synthetic-broker-unknown')).rejects.toBe(failure);
    expect(f.calls).toHaveLength(1);
    expect(f.readCalls).toBe(0);
    expect(f.asyncChecks).toBe(1);
  });

  test('missing timezone readiness and malformed request IDs never reach authority admission or the broker', async () => {
    const f = fixture();
    const setup = new CalendarService({} as CalendarServiceBroker,
      { ...f.config, timezone: null, readiness: 'setup-required' } satisfies ResolvedCalendarConfig, f.closing.signal);
    await expect(setup.forAuthority(f.request).createResource(resource(), 'synthetic-setup')).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    for (const requestId of ['', 'request with spaces', 'x'.repeat(129)]) {
      await expect(f.service.forAuthority(f.request).createResource(resource(), requestId)).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    }
    expect(f.asyncChecks).toBe(0);
    expect(f.calls).toHaveLength(0);
  });

  test('all Promise-returning reads reject malformed input/options without synchronous throws', async () => {
    const f = fixture(), api = f.service.forAuthority(f.request);
    try {
      const range = { resourceIds: [], startAt: '2026-11-16T00:00:00.000Z', endAt: '2026-11-17T00:00:00.000Z' };
      for (const run of [
        () => api.resources.list({ limit: 0 }),
        () => api.appointments.query({ ...range, resourceIds: ['duplicate', 'duplicate'] }),
        () => api.appointments.get('bad id'),
        () => api.blocks.query({ ...range, resourceIds: ['duplicate', 'duplicate'] }),
        () => api.blocks.get('bad id'),
        () => api.holds.query({ ...range, resourceIds: ['duplicate', 'duplicate'] }),
        () => api.holds.get('bad id'),
        () => api.availability.get('bad id'),
        () => api.busy.query({ ...range, endAt: range.startAt }),
        () => api.receipts.get('bad key'),
        () => api.resources.list({}, { signal: {} as AbortSignal }),
      ]) {
        let pending: Promise<unknown> | undefined;
        expect(() => { pending = run(); }).not.toThrow();
        expect(pending).toBeInstanceOf(Promise);
        await expect(pending!).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
      }
      expect(f.readCalls).toBe(0); expect(f.calls).toHaveLength(0);
    } finally { await f.service.close(); }
  });

  test('read selection is detached before the first await and its combined cancellation signal reaches the broker', async () => {
    const f = fixture(), cancel = new AbortController();
    let release!: () => void, captured!: ReadCall;
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.setBeforeCurrent(() => gate);
    f.setOnRead(async call => { captured = call; return { items: [], truncated: false }; });
    const query = { resourceIds: ['original'], startAt: '2026-11-16T00:00:00.000Z', endAt: '2026-11-17T00:00:00.000Z' };
    try {
      const pending = f.service.forAuthority(f.request).appointments.query(query, { signal: cancel.signal });
      query.resourceIds[0] = 'retargeted'; release(); await pending;
      expect(captured.input.resourceIds).toEqual(['original']);
      expect(captured.signal).toBeInstanceOf(AbortSignal); expect(captured.signal!.aborted).toBe(false);
      cancel.abort(); expect(captured.signal!.aborted).toBe(true);
    } finally { release(); await f.service.close(); }
  });

  test('queued read/write cancellation reaches the broker and close drains an owned blocked read', async () => {
    for (const kind of ['read', 'write', 'close'] as const) {
      const f = fixture(), cancel = new AbortController(), reason = new Error('Synthetic queued cancellation');
      let entered!: (signal: AbortSignal) => void;
      const admitted = new Promise<AbortSignal>(resolve => { entered = resolve; });
      const queued = (call: ReadCall) => new Promise<never>((_resolve, reject) => {
        const signal = call.signal!;
        const abort = () => { clearTimeout(deadline); signal.removeEventListener('abort', abort); reject(signal.reason); };
        const deadline = setTimeout(() => {
          signal.removeEventListener('abort', abort); reject(new Error('Synthetic queue cancellation deadline exceeded.'));
        }, 1_000);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        entered(signal);
      });
      f.setOnRead(queued); f.setOnWrite(queued);
      try {
        const api = f.service.forAuthority(f.request);
        const pending = kind === 'write' ? api.resources.create(resource() as never, { idempotencyKey: 'queued', signal: cancel.signal })
          : api.resources.list({}, { signal: cancel.signal });
        const signal = await Promise.race([admitted, pending.then(() => { throw new Error('Expected a queued broker operation.'); })]);
        expect(signal).toBeInstanceOf(AbortSignal);
        // Observe with a normal Promise before triggering cancellation. Bun's
        // rejection matcher may wait immediately, before the next statement can
        // release the fixture's deliberately blocked broker operation.
        const settled = pending.then(() => { throw new Error('Expected a cancelled broker operation.'); }, error => error);
        if (kind === 'close') {
          const closing = f.service.close();
          expect(signal.aborted).toBe(true);
          await closing; expect(await settled).toBeDefined();
        } else {
          cancel.abort(reason); expect(await settled).toBe(reason); expect(signal.aborted).toBe(true);
        }
      } finally { cancel.abort(reason); await f.service.close(); }
    }
  });

  test('request abort immediately unsubscribes a direct watch and aborts its owned queued read', async () => {
    const f = fixture(), requestLifetime = new AbortController();
    let entered!: (signal: AbortSignal) => void;
    const reading = new Promise<AbortSignal>(resolve => { entered = resolve; });
    const pages: CalendarAppointmentPage[] = [];
    f.setOnRead(call => new Promise<never>((_resolve, reject) => {
      const signal = call.signal!;
      const abort = () => { clearTimeout(deadline); signal.removeEventListener('abort', abort); reject(signal.reason); };
      const deadline = setTimeout(() => {
        signal.removeEventListener('abort', abort); reject(new Error('Synthetic watch queue cancellation deadline exceeded.'));
      }, 1_000);
      signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
      entered(signal);
    }));
    let stop = () => {};
    try {
      const request = { ...f.request, signal: requestLifetime.signal };
      stop = f.service.forAuthority(request).appointments.watch({ resourceIds: [], startAt: '2026-11-16T00:00:00.000Z', endAt: '2026-11-17T00:00:00.000Z' }, page => pages.push(page));
      const signal = await reading; expect(f.subscriptions).toBe(1);
      requestLifetime.abort(); expect(signal.aborted).toBe(true); expect(f.subscriptions).toBe(0);
      await f.service.close(); expect(pages).toEqual([]); expect(f.readCalls).toBe(1);
    } finally { requestLifetime.abort(); stop(); await f.service.close(); }
  });

  test('request abort during subscription installation still retires the returned subscription', async () => {
    const f = fixture(), requestLifetime = new AbortController();
    let entered!: () => void;
    const subscribed = new Promise<void>(resolve => { entered = resolve; });
    f.setOnSubscribe(() => { requestLifetime.abort(); entered(); });
    let stop = () => {};
    try {
      stop = f.service.forAuthority({ ...f.request, signal: requestLifetime.signal }).appointments.watch({ resourceIds: [],
        startAt: '2026-11-16T00:00:00.000Z', endAt: '2026-11-17T00:00:00.000Z' }, () => { throw new Error('Retired watch must not publish.'); });
      await subscribed; await f.service.close();
      expect(f.subscriptions).toBe(0); expect(f.readCalls).toBe(0);
    } finally { requestLifetime.abort(); stop(); await f.service.close(); }
  });
});
