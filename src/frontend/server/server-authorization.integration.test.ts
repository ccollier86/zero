import { describe, expect, test } from 'bun:test';
import { t } from 'elysia';

import { resolveAuthBehaviorConfig } from '../../auth/auth-config';
import {
  compileAccessRequirement,
  createAuthorizationKernel,
  type CompiledAccessRequirement,
} from '../../auth/authorization-kernel';
import type { TokenService } from '../../auth/token-service';
import type { AuthContext } from '../../auth/types';
import type { UserStore } from '../../auth/user-store';
import {
  ZERO_AUTHORIZATION_KERNEL,
  ZERO_AUTH_STORE,
  ZERO_AUTH_TOKEN_SERVICE,
} from '../../runtime/service-keys';
import { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import {
  applyServerExtension,
  createServerExtensionApp,
  defineEndpoint,
  defineMiddleware,
  defineRouter,
} from './server-extensions';
import { createServerRoute } from './server-route';

describe('server extension authorization kernel integration', () => {
  test('rejects malformed precompiled policy objects at the public route compiler', async () => {
    const runtime = new ZeroAppRuntime('malformed-compiled-no-kernel');
    const endpoint = defineEndpoint({
      method: 'GET',
      path: '/must-not-mount',
      handler: () => ({ unreachable: true }),
    });
    const optionalWithPermission = {
      ...compileAccessRequirement(false),
      allPermissions: ['documents:read'],
    } as CompiledAccessRequirement;
    const unknownAlias = {
      ...compileAccessRequirement(false),
      permission: 'documents:read',
    } as unknown as CompiledAccessRequirement;
    const stringRoleGroup = {
      ...compileAccessRequirement('required'),
      platformRoleGroups: ['superadmin'],
    } as unknown as CompiledAccessRequirement;

    await expect(applyServerExtension(
      createServerRoute({ name: 'test.malformed-optional' }, runtime),
      endpoint,
      optionalWithPermission,
      runtime,
    )).rejects.toThrow('constraints require an authenticated user');
    await expect(applyServerExtension(
      createServerRoute({ name: 'test.malformed-alias' }, runtime),
      endpoint,
      unknownAlias,
      runtime,
    )).rejects.toThrow('unsupported field "permission"');
    await expect(applyServerExtension(
      createServerRoute({ name: 'test.malformed-role-group' }, runtime),
      endpoint,
      stringRoleGroup,
      runtime,
    )).rejects.toThrow('platformRoleGroups must contain role arrays');
  });

  test('projects the validated tenant into request services and keeps raw services explicit', async () => {
    const fixture = createRuntime('request-services', {
      permissions: {},
      roles: { owner: { allPermissions: true } },
      tokenRole: 'owner',
    });
    const app = await createServerExtensionApp({
      runtime: fixture.runtime,
      extensions: [defineEndpoint({
        method: 'GET',
        path: '/scope',
        auth: { tenant: 'required' },
        handler: ({ zero }) => ({
          tenantId: zero.scope?.tenantId ?? null,
          requestBound: zero.access.context?.userId === `u_request-services`,
          rawTokenServiceIsExplicit:
            zero.unsafe.auth.tokenService === fixture.tokenService,
        }),
      })],
    });

    const response = await app.handle(request('/scope', 'valid'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      tenantId: 'ten_request-services',
      requestBound: true,
      rawTokenServiceIsExplicit: true,
    });
  });

  test('keeps configured permissions isolated across two live app runtimes', async () => {
    const documents = createRuntime('documents', {
      permissions: { 'documents:read': { label: 'Read documents' } },
      roles: { clinician: { permissions: ['documents:read'] } },
      tokenRole: 'clinician',
    });
    const billing = createRuntime('billing', {
      permissions: { 'billing:read': { label: 'Read billing' } },
      roles: { accountant: { permissions: ['billing:read'] } },
      tokenRole: 'accountant',
    });

    const documentsApp = await createServerExtensionApp({
      runtime: documents.runtime,
      extensions: [defineEndpoint({
        method: 'GET',
        path: '/documents',
        auth: { tenant: 'required', permission: 'documents:read' },
        handler: ({ access }) => ({ tenantId: access.requireTenant().tenantId }),
      })],
    });
    const billingApp = await createServerExtensionApp({
      runtime: billing.runtime,
      extensions: [defineEndpoint({
        method: 'GET',
        path: '/billing',
        auth: { tenant: 'required', permission: 'billing:read' },
        handler: ({ access }) => ({ allowed: access.hasPermission('billing:read') }),
      })],
    });

    const documentsResponse = await documentsApp.handle(request('/documents', 'valid'));
    const billingResponse = await billingApp.handle(request('/billing', 'valid'));
    expect(documentsResponse.status).toBe(200);
    await expect(documentsResponse.json()).resolves.toEqual({ tenantId: 'ten_documents' });
    expect(billingResponse.status).toBe(200);
    await expect(billingResponse.json()).resolves.toEqual({ allowed: true });

    await expect(createServerExtensionApp({
      runtime: billing.runtime,
      extensions: [defineEndpoint({
        method: 'GET',
        path: '/wrong-app-policy',
        auth: { permission: 'documents:read' },
        handler: () => ({ unreachable: true }),
      })],
    })).rejects.toThrow('undeclared permission "documents:read"');
  });

  test('a nested endpoint cannot weaken tenant and permission requirements', async () => {
    const fixture = createRuntime('nested', {
      permissions: {
        'documents:read': { label: 'Read documents' },
        'documents:write': { label: 'Write documents' },
      },
      roles: {
        clinician: { permissions: ['documents:read'] },
        owner: { allPermissions: true },
      },
      tokenRole: (token) => token === 'owner' ? 'owner' : 'clinician',
    });
    const app = await createServerExtensionApp({
      runtime: fixture.runtime,
      extensions: [defineRouter({
        name: 'protected-documents',
        prefix: '/documents',
        auth: { tenant: 'required', permission: 'documents:write' },
        routes: [defineEndpoint({
          method: 'GET',
          path: '/unsafe-public-child',
          auth: false,
          handler: ({ access }) => ({ userId: access.requireUser().userId }),
        })],
      })],
    });

    const anonymous = await app.handle(request('/documents/unsafe-public-child'));
    const underprivileged = await app.handle(request(
      '/documents/unsafe-public-child',
      'clinician',
    ));
    const allowed = await app.handle(request('/documents/unsafe-public-child', 'owner'));

    expect(anonymous.status).toBe(401);
    expect(underprivileged.status).toBe(403);
    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toEqual({ userId: 'u_nested' });
  });

  test('structured multipart denial happens before parsing the request body', async () => {
    const fixture = createRuntime('multipart', {
      permissions: {
        'documents:read': { label: 'Read documents' },
        'documents:write': { label: 'Write documents' },
      },
      roles: { clinician: { permissions: ['documents:read'] } },
      tokenRole: 'clinician',
    });
    let parserRuns = 0;
    let handlerRuns = 0;
    const app = await createServerExtensionApp({
      runtime: fixture.runtime,
      extensions: [defineEndpoint({
        method: 'POST',
        path: '/documents/import',
        auth: { tenant: 'required', permission: 'documents:write' },
        body: t.Object({ file: t.File() }),
        parse: () => {
          parserRuns += 1;
          return undefined;
        },
        handler: () => {
          handlerRuns += 1;
          return { ok: true };
        },
      })],
    });
    const body = new FormData();
    body.append('file', new File(['pdf'], 'record.pdf', { type: 'application/pdf' }));

    const response = await app.handle(new Request('http://zero.test/documents/import', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid' },
      body,
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'Forbidden',
      code: 'FORBIDDEN',
    });
    expect(parserRuns).toBe(0);
    expect(handlerRuns).toBe(0);
  });

  test('defineMiddleware accepts and enforces the shared access declaration', async () => {
    const fixture = createRuntime('middleware', {
      permissions: {
        'documents:read': { label: 'Read documents' },
        'documents:write': { label: 'Write documents' },
      },
      roles: {
        clinician: { permissions: ['documents:read'] },
        owner: { allPermissions: true },
      },
      tokenRole: (token) => token === 'owner' ? 'owner' : 'clinician',
    });
    const app = await createServerExtensionApp({
      runtime: fixture.runtime,
      extensions: [
        defineMiddleware({
          name: 'document-writer',
          path: '/documents/write',
          auth: { tenant: 'required', permission: 'documents:write' },
          run({ set, access }) {
            (set as { headers: Record<string, string> }).headers['x-tenant-id'] =
              access.requireTenant().tenantId;
          },
        }),
        defineEndpoint({
          method: 'GET',
          path: '/documents/write',
          handler: () => ({ ok: true }),
        }),
      ],
    });

    const denied = await app.handle(request('/documents/write', 'clinician'));
    const allowed = await app.handle(request('/documents/write', 'owner'));

    expect(denied.status).toBe(403);
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('x-tenant-id')).toBe('ten_middleware');
  });
});

function createRuntime(
  label: string,
  options: {
    permissions: Record<string, { label: string }>;
    roles: Record<string, { permissions?: string[]; allPermissions?: boolean }>;
    tokenRole: string | ((token: string) => string);
  },
) {
  const runtime = new ZeroAppRuntime(`authorization-${label}`);
  const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({
    tenancy: 'multi',
    authorization: {
      mode: 'simple',
      permissions: options.permissions,
      roles: options.roles,
    },
    userProperties: {
      department: { editableBy: 'admin', useInPolicies: true },
    },
  }));
  const tokenRole = options.tokenRole;
  const resolveRole = typeof tokenRole === 'function'
    ? tokenRole
    : () => tokenRole;
  const tokenService = {
    async resolveAuthContext(token: string): Promise<AuthContext | null> {
      if (!token || token === 'invalid') return null;
      return {
        userId: `u_${label}`,
        email: `${label}@example.test`,
        role: 'user',
        sessionKind: 'web',
        sessionId: `ses_${label}`,
        sessionGeneration: 0,
        sessionScopeKind: 'tenant',
        sessionScopeId: `ten_${label}`,
        tenantId: `ten_${label}`,
        membershipId: `tmem_${label}`,
        tenantRole: resolveRole(token),
        tenantAuthorizationGeneration: 0,
        membershipAuthorizationGeneration: 0,
      };
    },
  } as TokenService;
  const store = {
    getProperties: () => ({ department: 'clinical' }),
  } as unknown as UserStore;

  runtime.set(ZERO_AUTHORIZATION_KERNEL, kernel);
  runtime.set(ZERO_AUTH_TOKEN_SERVICE, tokenService);
  runtime.set(ZERO_AUTH_STORE, store);
  return { runtime, kernel, tokenService, store };
}

function request(path: string, token?: string): Request {
  return new Request(`http://zero.test${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}
