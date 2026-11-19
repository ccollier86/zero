/** Real Guardian kernel/access and synthetic in-memory lifecycle only; no files, actors or runtime mounting. */
import { expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { createRequestAuthorizationAccess } from '../auth/authorization-access';
import { createAuthorizationKernel } from '../auth/authorization-kernel';
import { applicationServiceDataScope, requireRequestServiceDataScope, trustedSystemServiceDataScope } from '../auth/service-data-scope';
import { AuthError, type AuthContext } from '../auth/types';
import { admitCalendarRequest, type CalendarAuthority } from './authority';
import { resolveCalendarConfig, type CalendarConfig } from './config';

function fixture(tenancy: 'single' | 'multi' = 'single', mode: 'simple' | 'advanced' = 'simple', options: CalendarConfig = {}) {
  const auth = resolveAuthBehaviorConfig({ tenancy, authorization: {
    mode, permissions: { 'calendar:manage': { label: 'Manage calendars' } },
    roles: { scheduler: { permissions: ['calendar:manage'] } },
  }, userProperties: { department: { editableBy: 'admin', useInPolicies: true } } });
  const kernel = createAuthorizationKernel(auth), closing = new AbortController();
  const state = {
    context: { userId: 'synthetic-user', email: 'synthetic@example.test', role: 'user',
      sessionKind: 'web', sessionId: 'synthetic-session', sessionGeneration: 1, authGeneration: 1,
      sessionScopeKind: tenancy === 'multi' ? 'tenant' : 'application', sessionScopeId: tenancy === 'multi' ? 'synthetic-tenant' : 'application',
      ...(tenancy === 'multi' ? { tenantId: 'synthetic-tenant', membershipId: 'synthetic-membership', tenantKind: 'organization',
        tenantRole: 'member', tenantAuthorizationGeneration: 1, membershipAuthorizationGeneration: 1 } : {}),
    } as AuthContext | null,
    roles: ['scheduler'] as string[] | null, revision: 'assignment:1', properties: { department: 'scheduling' },
    valid: true, profileValid: true, onSync: () => {}, onAsync: async () => {},
    scope: applicationServiceDataScope(),
  };
  const access = () => createRequestAuthorizationAccess({ kernel, authContext: state.context,
    assertCurrentProfile() { if (!state.profileValid) throw new AuthError('Retired synthetic profile', 'AUTH_STATE_CHANGED', 409); },
    propertyStore: { getProperties: () => state.properties },
    roleAssignments: {
      resolveApplicationRoles: userId => state.roles === null ? null : ({ scopeKind: 'application', scopeId: 'application', userId, roles: state.roles, revision: state.revision }),
      resolveTenantRoles: input => state.roles === null ? null : ({ ...input, scopeKind: 'tenant', scopeId: input.tenantId, roles: state.roles, revision: state.revision }),
    },
  });
  state.scope = requireRequestServiceDataScope(access(), () => kernel);
  const request: CalendarAuthority = {
    get access() { return access(); }, get scope() { return state.scope; },
    assertCurrentAuthoritySync() { state.onSync(); if (!state.valid) throw new AuthError('Retired synthetic authority', 'AUTH_STATE_CHANGED', 409); },
    async assertCurrentAuthority() { await state.onAsync(); if (!state.valid) throw new AuthError('Retired synthetic authority', 'AUTH_STATE_CHANGED', 409); },
  };
  const config = resolveCalendarConfig(options, '/synthetic-calendar-project', auth);
  if (config === false) throw new Error('Synthetic calendar configuration missing.');
  return { state, request, config, closing, admit: () => admitCalendarRequest(request, config, closing.signal) };
}

test('browser and admitted legacy-web requests derive immutable actors from their native Guardian scopes', async () => {
  for (const tenancy of ['single', 'multi'] as const) for (const legacy of [false, true]) {
    const f = fixture(tenancy);
    if (legacy) { delete f.state.context!.sessionKind; delete f.state.context!.sessionId; }
    const admitted = await f.admit();
    expect(admitted.actor).toMatchObject({ scopeId: tenancy === 'multi' ? 'tenant:synthetic-tenant' : 'application',
      userId: 'synthetic-user', manageAll: false, createOwn: true });
    expect(admitted.actor.principal).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(admitted)).toBe(true);
    expect(Object.isFrozen(admitted.actor)).toBe(true);
    admitted.guard(); await admitted.confirm();
  }
});

test('management uses configured Guardian permission/role/property policies, including non-admin advanced schedulers', async () => {
  for (const tenancy of ['single', 'multi'] as const) {
    const f = fixture(tenancy, 'advanced', { manage: { permission: 'calendar:manage' } });
    expect((await f.admit()).actor.manageAll).toBe(true);
    f.state.roles = [];
    f.state.context!.role = 'admin';
    if (tenancy === 'multi') f.state.context!.tenantRole = 'owner';
    expect((await f.admit()).actor.manageAll).toBe(false);
    f.state.roles = null;
    await expect(f.admit()).rejects.toBeInstanceOf(AuthError);
    const property = fixture(tenancy, 'advanced', { manage: { properties: { department: 'scheduling' } } });
    expect((await property.admit()).actor.manageAll).toBe(true);
    property.state.properties.department = 'other';
    expect((await property.admit()).actor.manageAll).toBe(false);
    const role = fixture(tenancy, 'advanced', { manage: { scopeRole: 'scheduler' } });
    expect((await role.admit()).actor.manageAll).toBe(true);
  }
});

test('createOwn false is a deny sentinel, not Guardian public access, and is independent of management', async () => {
  const f = fixture('single', 'advanced', { createOwn: false, manage: { permission: 'calendar:manage' } });
  expect((await f.admit()).actor).toMatchObject({ createOwn: false, manageAll: true });
  f.state.roles = [];
  expect((await f.admit()).actor).toMatchObject({ createOwn: false, manageAll: false });
  const restricted = fixture('multi', 'advanced', { createOwn: { scopeRole: 'scheduler' } });
  expect((await restricted.admit()).actor.createOwn).toBe(true);
  restricted.state.roles = [];
  expect((await restricted.admit()).actor.createOwn).toBe(false);
});

test('native, previously admitted API-key and anonymous contexts cannot become calendar actors', async () => {
  const f = fixture();
  f.state.context!.sessionKind = 'native'; f.state.context!.scope = ['profile', 'profile:write'];
  await expect(f.admit()).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
  f.state.context!.sessionKind = 'web'; f.state.context!.credentialKind = 'api-key';
  const key = f.request.access; key.authorize({ user: 'required', credentials: ['api-key'] });
  expect(key.requireUser().credentialKind).toBe('api-key');
  await expect(admitCalendarRequest({ ...f.request, access: key }, f.config, f.closing.signal)).rejects.toBeInstanceOf(AuthError);
  expect(key.context).toBeNull();
  f.state.context = null;
  await expect(f.admit()).rejects.toBeInstanceOf(AuthError);
});

test('scope admission checks the actual Guardian scope, not just an unchanged supplied discriminator', async () => {
  const tenant = fixture('multi');
  tenant.state.scope = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'another-tenant' });
  await expect(tenant.admit()).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
  tenant.state.scope = applicationServiceDataScope();
  await expect(tenant.admit()).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
  delete tenant.state.context!.membershipId;
  await expect(tenant.admit()).rejects.toBeInstanceOf(AuthError);
  const application = fixture();
  application.state.context!.sessionScopeId = 'another-application';
  await expect(application.admit()).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
});

test('pre-await capture prevents account, session, scope and policy replacement from retargeting admission', async () => {
  for (const replace of [
    (f: ReturnType<typeof fixture>) => { f.state.context!.userId = 'another-user'; },
    (f: ReturnType<typeof fixture>) => { f.state.context!.sessionId = 'another-session'; },
    (f: ReturnType<typeof fixture>) => { f.state.scope = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'another-tenant' }); },
    (f: ReturnType<typeof fixture>) => { f.state.roles = []; },
  ]) {
    const f = fixture('multi', 'advanced', { manage: { permission: 'calendar:manage' } });
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    f.state.onAsync = () => waiting;
    const pending = f.admit(); replace(f); release();
    await expect(pending).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
  }
});

test('synchronous and after-await fences retire captured identities, grants, properties and policy generations', async () => {
  for (const retire of [
    (f: ReturnType<typeof fixture>) => { f.state.valid = false; },
    (f: ReturnType<typeof fixture>) => { f.state.profileValid = false; },
    (f: ReturnType<typeof fixture>) => { f.state.context!.sessionGeneration!++; },
    (f: ReturnType<typeof fixture>) => { f.state.context!.membershipAuthorizationGeneration!++; },
    (f: ReturnType<typeof fixture>) => { f.state.roles = []; },
    (f: ReturnType<typeof fixture>) => { f.state.revision = 'assignment:2'; },
    (f: ReturnType<typeof fixture>) => { f.state.properties.department = 'other'; },
  ]) {
    const f = fixture('multi', 'advanced', { manage: { permission: 'calendar:manage', properties: { department: 'scheduling' } } });
    const admitted = await f.admit(); retire(f);
    expect(() => admitted.guard()).toThrow();
    await expect(admitted.confirm()).rejects.toBeInstanceOf(Error);
  }
  const f = fixture(), admitted = await f.admit();
  f.state.onAsync = async () => { f.state.context!.userId = 'late-user'; };
  await expect(admitted.confirm()).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
});

test('synchronous lifecycle guards reject asynchronous implementations and propagate policy infrastructure failures', async () => {
  const f = fixture();
  // The callback return itself must cross the synchronous boundary, not be discarded by a wrapper.
  await expect(admitCalendarRequest({ ...f.request, assertCurrentAuthoritySync: async () => {} }, f.config, f.closing.signal))
    .rejects.toMatchObject({ code: 'AUTH_STATE_INVARIANT_FAILED' });
  const property = fixture('single', 'advanced', { manage: { properties: { department: 'scheduling' } } });
  const access = createRequestAuthorizationAccess({ authContext: property.state.context,
    kernel: createAuthorizationKernel(resolveAuthBehaviorConfig({ userProperties: { department: { editableBy: 'admin', useInPolicies: true } } })) });
  await expect(admitCalendarRequest({ ...property.request, access }, property.config, property.closing.signal))
    .rejects.toMatchObject({ code: 'AUTH_POLICY_UNAVAILABLE', status: 503 });
});

test('owner/request/caller cancellation remains live and receipt principals survive ordinary session renewal', async () => {
  const f = fixture(), first = await f.admit();
  f.state.context!.sessionId = 'renewed-session'; f.state.context!.sessionGeneration!++;
  expect((await f.admit()).actor.principal).toBe(first.actor.principal);
  expect(() => first.guard()).toThrow();
  const supplied = new AbortController(), admitted = await admitCalendarRequest(f.request, f.config, f.closing.signal, supplied.signal);
  supplied.abort(); expect(() => admitted.guard()).toThrow();
  const requestAbort = new AbortController(), fromRequest = await admitCalendarRequest({ ...f.request, signal: requestAbort.signal }, f.config, f.closing.signal);
  requestAbort.abort(); await expect(fromRequest.confirm()).rejects.toBeInstanceOf(Error);
  const current = await f.admit(); f.closing.abort(); expect(() => current.guard()).toThrow();
  await expect(f.admit()).rejects.toBeInstanceOf(Error);
});

test('override capabilities are independent from base management and false remains valid for receipt reconciliation', async () => {
  const f = fixture('single', 'advanced', { manage: { permission: 'calendar:manage' },
    overrides: { kind: 'appointment-overlap-v1', use: { properties: { department: 'exceptions' } }, manageGrants: false } });
  const original = await f.admit();
  expect(original.actor).toMatchObject({ manageAll: true, overrides: { use: false, manageGrants: false, policyVersion: 'appointment-overlap-v1' } });
  original.guard(); await original.confirm();
  f.state.properties.department = 'exceptions';
  expect(() => original.guard()).toThrow();
  const allowed = await f.admit();
  expect(allowed.actor.overrides?.use).toBe(true);
  expect(allowed.actor.overrides?.policyHash).toMatch(/^[a-f0-9]{64}$/);
  expect(allowed.actor.principal).toBe(original.actor.principal);
  f.state.properties.department = 'scheduling';
  expect(() => allowed.guard()).toThrow();
  const revoked = await f.admit();
  expect(revoked.actor.overrides?.use).toBe(false);
  revoked.guard(); await revoked.confirm();
  expect((await fixture().admit()).actor).not.toHaveProperty('overrides');
});

test('ordinary administrator status does not invent independent override powers', async () => {
  const f = fixture('single', 'advanced', { overrides: { kind: 'appointment-overlap-v1', use: false,
    manageGrants: { properties: { department: 'exception-managers' } } } });
  f.state.context!.role = 'admin';
  expect((await f.admit()).actor).toMatchObject({ manageAll: true, overrides: { use: false, manageGrants: false } });
  f.state.properties.department = 'exception-managers';
  expect((await f.admit()).actor.overrides).toMatchObject({ use: false, manageGrants: true });
});
