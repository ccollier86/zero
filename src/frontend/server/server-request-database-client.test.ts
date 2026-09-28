import { describe, expect, test } from 'bun:test';

import { resolveAuthBehaviorConfig } from '../../auth/auth-config';
import { createRequestAuthorizationAccess } from '../../auth/authorization-access';
import { createAuthorizationKernel } from '../../auth/authorization-kernel';
import { trustedSystemServiceDataScope } from '../../auth/service-data-scope';
import type { TokenService } from '../../auth/token-service';
import type { AuthContext } from '../../auth/types';
import type {
  BindTenantDatabaseOptions,
  DatabaseManager,
  TenantDatabaseBinding,
} from '../../databases/database-manager';
import type { AsyncDatabaseClient } from '../../databases/database-operations';
import {
  createAuthorityScopedServerServices,
  createServerRequestServices,
} from './server-request-services';
import type { ServerRouteServices } from './server-services';

describe('request tenant-database projection', () => {
  test('projects zero.data from committed request authority and hides infrastructure', async () => {
    const fixture = createFixture();
    const zero = createServerRequestServices({
      request: new Request('http://zero.test/api', {
        headers: { Authorization: 'Bearer tenant-session' },
      }),
      access: fixture.tenantAccess,
      services: fixture.services,
    });

    expect(zero.data).not.toBeNull();
    expect('data' in zero).toBeTrue();
    expect(Object.keys(zero)).toContain('data');
    expect(Object.getOwnPropertyDescriptor(zero, 'data')?.value).toBe(zero.data);
    expect('databases' in zero).toBeFalse();
    expect(Reflect.ownKeys(zero)).not.toContain('databases');
    expect(Object.getOwnPropertyDescriptor(zero, 'databases')).toBeUndefined();
    expect(() => zero.databases).toThrow('zero.unsafe.databases');

    await expect(zero.data!.get('todos', 'a')).resolves.toMatchObject({
      value: { id: 'a' },
    });
    expect(fixture.binds).toHaveLength(1);
    expect(fixture.binds[0]!.tenantId).toBe(TENANT_ID);
    expect(fixture.binds[0]!.releaseCount).toBe(1);
  });

  test('projects explicit null for an uncommitted tenant-selection request', () => {
    const fixture = createFixture();
    const zero = createServerRequestServices({
      request: new Request('http://zero.test/api'),
      access: fixture.selectionAccess,
      services: fixture.services,
    });

    expect(zero.scope).toBeNull();
    expect(zero.data).toBeNull();
    expect('data' in zero).toBeTrue();
    expect(Object.keys(zero)).toContain('data');
    expect(Object.getOwnPropertyDescriptor(zero, 'data')?.value).toBeNull();
    expect('databases' in zero).toBeFalse();
    expect(Reflect.ownKeys(zero)).not.toContain('databases');
    expect(fixture.binds).toHaveLength(0);
  });

  test('keeps zero.data in strict background scopes without exposing the manager', async () => {
    const fixture = createFixture();
    const zero = createAuthorityScopedServerServices({
      access: fixture.tenantAccess,
      services: fixture.services,
      scope: trustedSystemServiceDataScope({
        scopeKind: 'tenant',
        tenantId: TENANT_ID,
      }),
      assertCurrentAuthority: async () => {},
      assertCurrentAuthoritySync: () => {},
      strict: true,
    });

    expect(zero.data).not.toBeNull();
    expect('data' in zero).toBeTrue();
    expect(Object.keys(zero)).toContain('data');
    expect('databases' in zero).toBeFalse();
    expect(() => zero.databases).toThrow('zero.databases');

    await zero.data!.get('todos', 'background');
    expect(fixture.binds).toEqual([{
      tenantId: TENANT_ID,
      releaseCount: 1,
    }]);
  });

  test('does not mint background tenant data authority without an explicit sync fence', () => {
    const fixture = createFixture();
    const zero = createAuthorityScopedServerServices({
      access: fixture.tenantAccess,
      services: fixture.services,
      scope: trustedSystemServiceDataScope({
        scopeKind: 'tenant',
        tenantId: TENANT_ID,
      }),
      assertCurrentAuthority: async () => {},
      strict: true,
    });

    expect(zero.data).toBeNull();
    expect(fixture.binds).toHaveLength(0);
  });
});

const TENANT_ID = 'ten_request_data';

function createFixture() {
  const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({
    tenancy: 'multi',
  }));
  const tenantContext = authContext({
    sessionScopeKind: 'tenant',
    sessionScopeId: TENANT_ID,
    tenantId: TENANT_ID,
    membershipId: 'mem_request_data',
    tenantRole: 'owner',
    tenantAuthorizationGeneration: 0,
    membershipAuthorizationGeneration: 0,
  });
  const selectionContext = authContext({
    sessionScopeKind: 'application',
    sessionScopeId: 'application',
  });
  const store = { getProperties: () => ({}) };
  const tenantAccess = createRequestAuthorizationAccess({
    authContext: tenantContext,
    kernel,
    propertyStore: store,
  });
  const selectionAccess = createRequestAuthorizationAccess({
    authContext: selectionContext,
    kernel,
    propertyStore: store,
  });
  const binds: Array<{ tenantId: string; releaseCount: number }> = [];
  const manager = {
    diagnostics: () => ({ tenantDatabasesEnabled: true }),
    async bindTenant(options: BindTenantDatabaseOptions) {
      const record = { tenantId: options.tenantId, releaseCount: 0 };
      binds.push(record);
      const client = {
        async get(_table: string, id: string) {
          options.assertCurrentReadAuthority?.();
          return { value: { id }, sequence: { seq: 0 } };
        },
      } as unknown as AsyncDatabaseClient;
      return {
        client,
        get released() { return record.releaseCount > 0; },
        release() { record.releaseCount += 1; },
        async [Symbol.asyncDispose]() { record.releaseCount += 1; },
      } satisfies TenantDatabaseBinding;
    },
  } as unknown as DatabaseManager;
  const tokens = {
    captureAuthContextAuthority(context: AuthContext) {
      return { sessionId: context.sessionId };
    },
    resolveAuthContextAuthority(reference: { sessionId: string }) {
      return reference.sessionId === tenantContext.sessionId ? tenantContext : null;
    },
  } as unknown as TokenService;
  const services = {
    databases: manager,
    auth: {
      authorization: kernel,
      authorizationKernel: kernel,
      store,
      userStore: store,
      tokens,
      tokenService: tokens,
    },
    storage: null,
    notifications: null,
    rooms: null,
    workflows: null,
    pdf: null,
    observability: observabilityFixture(),
  } as unknown as ServerRouteServices;

  return { binds, selectionAccess, services, tenantAccess };
}

function authContext(scope: Partial<AuthContext>): AuthContext {
  return {
    userId: 'usr_request_data',
    email: 'request-data@example.test',
    role: 'user',
    sessionKind: 'web',
    sessionId: scope.sessionScopeKind === 'tenant'
      ? 'ses_tenant_request_data'
      : 'ses_selection_request_data',
    sessionGeneration: 0,
    ...scope,
  };
}

function observabilityFixture() {
  const noop = () => undefined;
  return {
    runtime: {},
    sink: {},
    store: null,
    getRuntime: () => ({}),
    getSink: () => ({}),
    getStore: () => null,
    emitCode: noop,
    emitEvent: noop,
    error: noop,
    info: noop,
    warn: noop,
  };
}
