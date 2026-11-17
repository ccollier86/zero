/** Real Guardian access and fake inert owners only; no database, files, routes, process or provider work. */
import { expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from '../../auth/auth-config';
import { createRequestAuthorizationAccess } from '../../auth/authorization-access';
import { createAuthorizationKernel } from '../../auth/authorization-kernel';
import { applicationServiceDataScope } from '../../auth/service-data-scope';
import type { AuthContext } from '../../auth/types';
import type { CalendarAuthority } from '../../calendar/authority';
import { ZERO_CALENDAR_SERVICE } from '../../runtime/service-keys';
import { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import { createLazyServerRouteServices, type ServerRouteServices } from './server-services';
import { createAuthorityScopedServerServices, createServerRequestServices } from './server-request-services';

function fixture(tenancy: 'single' | 'multi' = 'single', input: Partial<AuthContext> = {}, anonymous = false) {
  const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({ tenancy }));
  let current: AuthContext | null = anonymous ? null : { userId: 'synthetic-user', email: 'synthetic@example.test', role: 'user',
    sessionKind: 'web', sessionId: 'synthetic-session', sessionGeneration: 1, authGeneration: 1,
    sessionScopeKind: 'application', sessionScopeId: 'application', ...input };
  const access = createRequestAuthorizationAccess({ kernel, authContext: current });
  let authority: CalendarAuthority | null = null;
  let calls = 0;
  const facade = Object.freeze({ synthetic: true });
  const calendar = { forAuthority(request: CalendarAuthority) { authority = request; calls++; return facade; } };
  const services = { calendar, databases: null, auth: { authorizationKernel: kernel, store: null,
    tokens: { captureAuthContextAuthority: () => Object.freeze({ synthetic: true }), resolveAuthContextAuthority: () => current } },
    observability: {},
  } as unknown as ServerRouteServices;
  const controller = new AbortController();
  const request = new Request('https://synthetic.example.test/calendar', { signal: controller.signal });
  return { access, services, calendar, facade, request, controller, get authority() { return authority; }, get calls() { return calls; },
    retire() { current = null; }, project: () => createServerRequestServices({ request, access, services }) };
}

test('trusted setup calendar getter remains lazy and app-local, and standalone defaults to null', () => {
  const first = new ZeroAppRuntime(), second = new ZeroAppRuntime();
  const one = createLazyServerRouteServices(first), two = createLazyServerRouteServices(second);
  expect(one.calendar).toBeNull(); expect(two.calendar).toBeNull();
  const owner = fixture().calendar as unknown as NonNullable<ServerRouteServices['calendar']>;
  first.set(ZERO_CALENDAR_SERVICE, owner);
  expect(one.calendar).toBe(owner); expect(two.calendar).toBeNull();
  first.clear(ZERO_CALENDAR_SERVICE, owner);
  expect(one.calendar).toBeNull(); expect(createLazyServerRouteServices().calendar).toBeNull();
});

test('browser calendar projection forwards only server-derived scope, live fences and cancellation', async () => {
  const f = fixture(), zero = f.project();
  expect(zero.calendar).toBe(f.facade as never);
  expect(zero.unsafe.calendar).toBe(f.calendar as never);
  expect(f.calls).toBe(1);
  expect(f.authority!.scope).toEqual(applicationServiceDataScope());
  expect(f.authority!.access).toBe(f.access);
  f.authority!.assertCurrentAuthoritySync(); await f.authority!.assertCurrentAuthority();
  f.controller.abort(); expect(f.authority!.signal!.aborted).toBe(true);
  f.retire(); expect(() => f.authority!.assertCurrentAuthoritySync()).toThrow();
  await expect(f.authority!.assertCurrentAuthority()).rejects.toBeDefined();
});

test('anonymous, native, admitted API-key and uncommitted tenant sessions receive no calendar facade', () => {
  const anonymous = fixture('single', {}, true);
  const native = fixture('single', { sessionKind: 'native', scope: ['profile', 'profile:write'] });
  const key = fixture('single', { credentialKind: 'api-key' });
  key.access.authorize({ user: 'required', credentials: ['api-key'] });
  const selection = fixture('multi');
  for (const f of [anonymous, native, key, selection]) {
    expect(f.project().calendar).toBeNull(); expect(f.calls).toBe(0);
  }
});

test('sealed machine/background projections cannot manufacture calendar admission from browser-shaped identity', () => {
  const f = fixture();
  const zero = createAuthorityScopedServerServices({ access: f.access, services: f.services, scope: applicationServiceDataScope(),
    assertCurrentAuthority: async () => {}, assertCurrentAuthoritySync: () => {} });
  expect(zero.calendar).toBeNull(); expect(f.calls).toBe(0);
});
