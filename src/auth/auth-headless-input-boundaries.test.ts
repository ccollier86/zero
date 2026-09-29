import { describe, expect, test } from 'bun:test';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { AuthAuditService } from './auth-audit-service';
import { defineAuthTables } from './auth-schema';
import { AuthPlatformTenantAdministrationService } from './auth-platform-tenant-administration-service';
import { loginUser } from './auth-login-service';
import type { AuthSessionPluginConfig } from './auth-session-dependencies';
import { AuthTenantAdministrationService } from './auth-tenant-administration-service';
import { normalizeTenantCreateFields } from './auth-tenant-creation';
import { decodeCursor as decodeOnboardingCursor } from './auth-tenant-onboarding-codec';
import type { AuthorizationKernel } from './authorization-kernel';
import type { TenancyService } from './tenancy/tenancy-service';
import { AuthError } from './types';
import { UserStore } from './user-store';

describe('headless auth input boundaries', () => {
  test('keeps malformed direct login credentials non-enumerating', async () => {
    let lookupCalls = 0;
    const store = {
      getUserByEmail: () => { lookupCalls += 1; return null; },
      getUserByUsername: () => { lookupCalls += 1; return null; },
      verifyPassword: () => {
        throw new Error('Malformed password reached verification');
      },
    };
    const config = {
      getUserStore: () => store,
      getTokenService: () => ({}),
      getPropertyService: () => ({}),
      getActionTokenService: () => ({}),
      getAccountEmailService: () => ({}),
      getMfaChallengeService: () => null,
      getRegistrationIntentStore: () => ({}),
      getAuthTenantSessionService: () => ({}),
    } as unknown as AuthSessionPluginConfig;

    for (const [username, password] of [
      [{}, 'password'],
      [Symbol('username'), 'password'],
      ['valid-looking-user', {}],
      ['valid-looking-user', Symbol('password')],
    ] as const) {
      await expect(loginUser(config, {
        username: username as never,
        password: password as never,
      })).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
        status: 401,
      });
    }
    expect(lookupCalls).toBe(0);
  });

  test('uses one INVALID_EMAIL 422 contract for direct identity creation', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      defineAuthTables(db);
      const users = new UserStore(db);
      for (const email of ['not-an-email', null, {}, Symbol('email')]) {
        await expect(users.createUser({
          username: 'invalid-email-user',
          email: email as never,
          password: 'not-hashed',
        })).rejects.toMatchObject({
          code: 'INVALID_EMAIL',
          status: 422,
        });
      }
    } finally {
      db.dispose();
    }
  });

  test('maps non-string tenant creation fields to stable request errors', () => {
    for (const name of [null, false, 7, {}, Symbol('name')]) {
      expect(() => normalizeTenantCreateFields(name, undefined)).toThrow(
        expect.objectContaining({
          code: 'TENANT_NAME_REQUIRED',
          status: 422,
        }),
      );
    }

    for (const slug of [null, false, 7, {}, Symbol('slug')]) {
      expect(() => normalizeTenantCreateFields('Acme Health', slug)).toThrow(
        expect.objectContaining({
          code: 'TENANT_SLUG_REQUIRED',
          status: 422,
        }),
      );
    }
  });

  test('rejects non-string onboarding cursors with the stable page error', () => {
    expect(decodeOnboardingCursor(undefined)).toBeNull();
    expect(decodeOnboardingCursor('')).toBeNull();
    for (const cursor of [null, false, 0, {}, [], Symbol('cursor')]) {
      expect(() => decodeOnboardingCursor(cursor)).toThrow(
        expect.objectContaining({
          code: 'TENANT_ONBOARDING_PAGE_INVALID',
          status: 422,
        }),
      );
    }
  });

  test('rejects malformed tenant-member search and cursor values before persistence', () => {
    const service = createTenantAdministrationService();
    for (const input of [
      { search: { trim: true } },
      { cursor: { length: 1 } },
      { cursor: Symbol('cursor') },
      { status: Symbol('status') },
      { status: ['active'] },
    ]) {
      expect(() => service.listMembers('organization', input as never)).toThrow(
        expect.objectContaining({
          code: 'TENANT_MEMBER_PAGE_INVALID',
          status: 422,
        }),
      );
    }

    for (const email of [null, {}, Symbol('email')]) {
      expect(() => service.addMember({
        tenantId: 'organization',
        email: email as never,
        assertCurrentAuthority: () => {
          throw new Error('Invalid email reached the authority callback');
        },
      })).toThrow(expect.objectContaining({
        code: 'INVALID_EMAIL',
        status: 422,
      }));
    }
  });

  test('rejects malformed or empty tenant-member updates before persistence', () => {
    const service = createTenantAdministrationService();
    let authorityCalls = 0;
    const assertCurrentAuthority = () => {
      authorityCalls += 1;
      throw new Error('Invalid member update reached the authority callback');
    };

    for (const status of [null, false, 0, '', 'removed', {}, [], Symbol('status')]) {
      expect(() => service.updateMember({
        tenantId: 'organization',
        membershipId: 'member',
        status: status as never,
        assertCurrentAuthority,
      })).toThrow(expect.objectContaining({
        code: 'TENANT_MEMBER_STATUS_INVALID',
        status: 422,
      }));
    }
    expect(() => service.updateMember({
      tenantId: 'organization',
      membershipId: 'member',
      assertCurrentAuthority,
    })).toThrow(expect.objectContaining({
      code: 'TENANT_MEMBER_UPDATE_EMPTY',
      status: 422,
    }));
    expect(authorityCalls).toBe(0);
  });

  test('rejects malformed platform tenant and member page values before persistence', () => {
    const service = createPlatformTenantAdministrationService();
    const assertCurrentAuthority = () => {
      throw new Error('Invalid page input reached the authority callback');
    };

    for (const query of [
      { search: { normalize: true } },
      { cursor: { length: 1 } },
      { cursor: Symbol('cursor') },
      { status: Symbol('status') },
      { status: ['active'] },
    ]) {
      expect(() => service.listTenants({
        administrationTenantId: 'administration',
        query: query as never,
        assertCurrentAuthority,
      })).toThrow(expect.objectContaining({
        code: 'PLATFORM_TENANT_PAGE_INVALID',
        status: 422,
      }));
    }

    expect(() => service.listTenantMembers({
      administrationTenantId: 'administration',
      tenantId: 'organization',
      query: { cursor: 7 } as never,
      assertCurrentAuthority,
    })).toThrow(expect.objectContaining({
      code: 'PLATFORM_TENANT_PAGE_INVALID',
      status: 422,
    }));
    expect(() => service.listTenantMembers({
      administrationTenantId: 'administration',
      tenantId: 'organization',
      query: { status: ['active'] } as never,
      assertCurrentAuthority,
    })).toThrow(expect.objectContaining({
      code: 'PLATFORM_TENANT_PAGE_INVALID',
      status: 422,
    }));

    for (const ownerEmail of [null, {}, Symbol('email')]) {
      expect(() => service.createTenant({
        administrationTenantId: 'administration',
        name: 'Organization',
        ownerEmail: ownerEmail as never,
        assertCurrentAuthority,
      })).toThrow(expect.objectContaining({
        code: 'INVALID_EMAIL',
        status: 422,
      }));
    }

    let authorityCalls = 0;
    const mutationAuthority = () => {
      authorityCalls += 1;
      throw new Error('Invalid tenant update reached the authority callback');
    };
    for (const status of [
      undefined,
      null,
      false,
      0,
      '',
      'archived',
      {},
      [],
      Symbol('status'),
    ]) {
      expect(() => service.updateTenant({
        administrationTenantId: 'administration',
        tenantId: 'organization',
        status: status as never,
        expectedAuthorizationGeneration: 0,
        assertCurrentAuthority: mutationAuthority,
      })).toThrow(expect.objectContaining({
        code: 'PLATFORM_TENANT_STATUS_INVALID',
        status: 422,
      }));
    }
    expect(authorityCalls).toBe(0);
  });

  test('checks platform read authority before tenant discovery or persistence', () => {
    let prepareCalls = 0;
    let tenantLookupCalls = 0;
    const db = {
      prepare: () => {
        prepareCalls += 1;
        throw new Error('Unauthorized read reached persistence');
      },
    } as unknown as ReactiveDB;
    const tenantService = {
      getTenant: () => {
        tenantLookupCalls += 1;
        throw new Error('Unauthorized read reached tenant discovery');
      },
    } as unknown as TenancyService;
    const service = new AuthPlatformTenantAdministrationService(
      db,
      {} as AuthorizationKernel,
      inertUsers(),
      tenantService,
      null,
      {} as AuthAuditService,
      (() => undefined) as never,
    );
    const revokedAuthority = () => {
      throw new AuthError(
        'Authorization changed before the operation could complete',
        'AUTHORIZATION_CHANGED',
        409,
      );
    };

    for (const operation of [
      () => service.listTenants({
        administrationTenantId: 'administration',
        assertCurrentAuthority: revokedAuthority,
      }),
      () => service.listTenantMembers({
        administrationTenantId: 'administration',
        tenantId: 'existing-customer',
        assertCurrentAuthority: revokedAuthority,
      }),
      () => service.listTenantMembers({
        administrationTenantId: 'administration',
        tenantId: 'missing-customer',
        assertCurrentAuthority: revokedAuthority,
      }),
    ]) {
      expect(operation).toThrow(expect.objectContaining({
        code: 'AUTHORIZATION_CHANGED',
        status: 409,
      }));
    }
    expect(tenantLookupCalls).toBe(0);
    expect(prepareCalls).toBe(0);
  });
});

function createTenantAdministrationService(): AuthTenantAdministrationService {
  return new AuthTenantAdministrationService(
    inertDb(),
    {} as AuthorizationKernel,
    inertUsers(),
    tenancy(),
    null,
    {} as AuthAuditService,
  );
}

function createPlatformTenantAdministrationService(): AuthPlatformTenantAdministrationService {
  return new AuthPlatformTenantAdministrationService(
    inertDb(),
    {} as AuthorizationKernel,
    inertUsers(),
    tenancy(),
    null,
    {} as AuthAuditService,
    () => {
      throw new Error('Invalid page input reached observability');
    },
  );
}

function inertDb(): ReactiveDB {
  return {
    prepare: () => ({}),
  } as unknown as ReactiveDB;
}

function inertUsers(): UserStore {
  return {
    assertCurrentProfile: () => undefined,
  } as unknown as UserStore;
}

function tenancy(): TenancyService {
  return {
    getTenant: (tenantId: string) => ({
      tenantId,
      kind: tenantId === 'administration' ? 'administration' : 'organization',
      slug: tenantId,
      name: tenantId,
      status: 'active',
      authorizationGeneration: 0,
      createdBy: 'test',
      createdAt: 1,
      updatedAt: 1,
      suspendedAt: null,
    }),
  } as unknown as TenancyService;
}
