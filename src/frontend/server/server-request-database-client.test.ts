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
import { OBS_CODES } from '../../observability/codes';
import {
  createAuthorityScopedServerServices,
  createServerRequestServices,
} from './server-request-services';
import type {
  AuthorityScopedServerServices,
  CreateAuthorityScopedServerServicesOptions,
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
    });

    expect(zero.data).not.toBeNull();
    expect('data' in zero).toBeTrue();
    expect(Object.keys(zero)).toContain('data');
    expect('databases' in zero).toBeFalse();
    expect(() => Reflect.get(zero, 'databases')).toThrow('zero.databases');

    await zero.data!.get('todos', 'background');
    expect(fixture.binds).toEqual([{
      tenantId: TENANT_ID,
      releaseCount: 1,
    }]);
  });

  test('keeps verified-machine projections exact and fences every access decision', () => {
    const fixture = createFixture();
    const rawServices = fixture.services as ServerRouteServices & {
      futurePrivilegedService: { readonly secret: string };
    };
    Object.assign(rawServices, {
      futurePrivilegedService: { secret: 'must-not-project' },
    });
    Object.assign(rawServices.auth, {
      futureAuthSecret: 'must-not-project',
    });
    Object.assign(rawServices.observability, {
      futureObservabilitySink: 'must-not-project',
    });
    let revoked = false;
    const assertCurrent = () => {
      if (revoked) throw new Error('machine authority revoked');
    };
    const zero = createAuthorityScopedServerServices({
      access: fixture.tenantAccess,
      services: rawServices,
      scope: trustedSystemServiceDataScope({
        scopeKind: 'tenant',
        tenantId: TENANT_ID,
      }),
      assertCurrentAuthority: async () => assertCurrent(),
      assertCurrentAuthoritySync: assertCurrent,
    });

    expect(new Set(Object.keys(zero))).toEqual(new Set([
      'access',
      'scope',
      'data',
      'auth',
      'observability',
      'storage',
      'notifications',
      'rooms',
      'workflows',
      'pdf',
    ]));
    expect('futurePrivilegedService' in zero).toBeFalse();
    expect(Object.getOwnPropertyDescriptor(zero, 'futurePrivilegedService')).toBeUndefined();
    expect(() => Reflect.get(zero, 'futurePrivilegedService')).toThrow(
      'zero.futurePrivilegedService',
    );
    expect('futureAuthSecret' in zero.auth).toBeFalse();
    expect(Reflect.ownKeys(zero.auth)).not.toContain('futureAuthSecret');
    expect(() => Reflect.get(zero.auth, 'futureAuthSecret')).toThrow(
      'zero.auth.futureAuthSecret',
    );
    expect('futureObservabilitySink' in zero.observability).toBeFalse();
    expect(Reflect.ownKeys(zero.observability)).not.toContain('futureObservabilitySink');
    expect(() => Reflect.get(zero.observability, 'futureObservabilitySink')).toThrow(
      'zero.observability.futureObservabilitySink',
    );

    const descriptorEmitter = Object.getOwnPropertyDescriptor(
      zero.observability,
      'info',
    )?.value as typeof zero.observability.info;
    revoked = true;
    expect(() => zero.access.requireUser()).toThrow('machine authority revoked');
    expect(() => zero.access.hasPermission('future:permission')).toThrow(
      'machine authority revoked',
    );
    expect(() => zero.access.context).toThrow('machine authority revoked');
    expect(() => descriptorEmitter(OBS_CODES.STORAGE_STARTED)).toThrow(
      'machine authority revoked',
    );
  });

  test('rejects authority-scoped services without an explicit synchronous fence', () => {
    const fixture = createFixture();
    expect(() => createAuthorityScopedServerServices({
      access: fixture.tenantAccess,
      services: fixture.services,
      scope: trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: TENANT_ID }),
      assertCurrentAuthority: async () => {},
    } as Parameters<typeof createAuthorityScopedServerServices>[0])).toThrow(
      'require live asynchronous and synchronous authority fences',
    );
    expect(fixture.binds).toHaveLength(0);
  });
});

function assertAuthorityScopedPublicType(zero: AuthorityScopedServerServices): void {
  void zero.access;
  void zero.storage;
  void zero.observability.info;
  // @ts-expect-error Raw database managers are not authority-scoped services.
  void zero.databases;
  // @ts-expect-error Global KV is unavailable without an audited scoped facade.
  void zero.kv;
  // @ts-expect-error Verified machine authority never receives zero.unsafe.
  void zero.unsafe;
  // @ts-expect-error Guardian stores and token services are not scope-safe.
  void zero.auth.store;
  // @ts-expect-error Observability sinks are not scope-safe.
  void zero.observability.sink;
  // @ts-expect-error Global notification retention is outside actor scope.
  void zero.notifications?.deleteExpired;
  // @ts-expect-error Authority-scoped PDF callers cannot stop the shared renderer.
  void zero.pdf?.close;
  void zero.pdf?.renderToStorage(
    { html: '<p>unsafe</p>' },
    // @ts-expect-error Scoped PDF storage derives createdBy from Guardian authority.
    { driveId: 'drive', path: '/unsafe.pdf', createdBy: 'spoofed-user' },
  );
  // @ts-expect-error Scoped Storage callers cannot stop the shared service.
  void zero.storage?.stop;
  // @ts-expect-error Raw drive-record mutation is a trusted composition seam.
  void zero.storage?.createDriveRecord;
  // @ts-expect-error Scoped drive creation derives its owner from Guardian.
  void zero.storage?.createDrive('spoofed-user', { name: 'unsafe' });
  // @ts-expect-error Scoped uploads do not accept a caller-selected actor.
  void zero.storage?.upload('drive', '/file', new Uint8Array(), 'file', 'spoofed-user');
  // @ts-expect-error Scoped ACL checks derive roles/properties/scope from Guardian.
  void zero.storage?.checkAccess('drive', null, 'spoofed-user', [], {}, 'read');
  // @ts-expect-error Scoped notifications derive the sender from Guardian.
  void zero.notifications?.create({ title: 'unsafe' }, 'spoofed-user');
  // @ts-expect-error Scoped rooms derive their creator from Guardian.
  void zero.rooms?.create('spoofed-user', { name: 'unsafe' });
  // @ts-expect-error Room membership insertion is not a scoped caller capability.
  void zero.rooms?.join;
}
void assertAuthorityScopedPublicType;

function assertAuthorityScopedPublicOptions(
  options: CreateAuthorityScopedServerServicesOptions,
): void {
  // @ts-expect-error Public machine projections are always strict.
  void options.strict;
  // @ts-expect-error Public machine projections never expose zero.unsafe.
  void options.allowUnsafe;
  // @ts-expect-error ACL bypass is reserved for internal system continuations.
  void options.privilegedSystem;
}
void assertAuthorityScopedPublicOptions;

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
        trustedWriter: {
          async findReceipt() { return { status: 'miss' } as const; },
          async executeWrite() { throw new Error('not expected'); },
        },
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
