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
import type { CalendarActor, CalendarCommandReceipt } from './contracts';
import { CalendarError } from './error';
import { CalendarService, type CalendarServiceBroker } from './service';
import { calendarHash } from './validation';

type WriteCall = { scope: ServiceDataScope; name: string; input: Record<string, unknown>; requestId: string; guard: () => void };
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
  let readCalls = 0;
  const receipt = (call: WriteCall): CalendarCommandReceipt => ({ requestId: call.requestId,
    operation: call.name === 'calendar.resource.create' ? 'resource.created' : 'appointment.created',
    id: call.input.id as string, revision: 1, changed: true });
  const broker: CalendarServiceBroker = {
    async read<T>() { readCalls++; throw new Error('Boundary fixture must never read or reconcile automatically.'); },
    async write<T>(scope, name, input, requestId, guard): Promise<T> {
      const call = { scope, name, input: input as Record<string, unknown>, requestId, guard };
      calls.push(call);
      guard();
      return (onWrite ? await onWrite(call) : receipt(call)) as T;
    },
  };
  const service = new CalendarService(broker, config, closing.signal);
  return { request, config, closing, calls, service, receipt, get readCalls() { return readCalls; },
    get syncChecks() { return syncChecks; }, get asyncChecks() { return asyncChecks; },
    setBeforeCurrent(callback: () => Promise<void>) { beforeCurrent = callback; },
    setOnWrite(callback: (call: WriteCall) => Promise<CalendarCommandReceipt>) { onWrite = callback; },
    revoke() { live = null; },
  };
}

describe('calendar internal service boundary (in-memory broker, not Fabric)', () => {
  test('only fixed commands are exposed, and reserved authority/routing/identity fields cannot be client-selected', async () => {
    const f = fixture(), api = f.service.forAuthority(f.request);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.keys(api).sort()).toEqual(['createAppointment', 'createResource']);
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
});
