import { describe, expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from './auth-config';
import {
  AuthorizationKernel,
  compileAccessRequirement,
  mergeAccessRequirements,
  validateAuthorizationRegistry,
  type AccessRequirement,
  type AuthorizationScopeSnapshot,
  type AuthorizationSubjectSnapshot,
  type CompiledAccessRequirement,
} from './authorization-kernel';
import { AuthError } from './types';

const permissions = {
  'billing:read': { label: 'Read billing' },
  'patients:read': { label: 'Read patients' },
  'patients:write': { label: 'Write patients' },
  'staff:manage': { label: 'Manage staff' },
};

function kernel(
  tenancy: 'single' | 'multi' = 'single',
  mode: 'simple' | 'advanced' = 'advanced',
) {
  return new AuthorizationKernel(resolveAuthBehaviorConfig({
    tenancy,
    authorization: {
      mode,
      permissions,
      roles: {
        clinician: { permissions: ['patients:read', 'patients:write'] },
        manager: { permissions: ['patients:read', 'staff:manage'] },
        owner: { allPermissions: true, system: true },
      },
    },
    userProperties: {
      department: { editableBy: 'admin', useInPolicies: true },
      selfAssigned: { editableBy: 'user', useInPolicies: false },
    },
  }));
}

function scope(
  overrides: Partial<AuthorizationScopeSnapshot> = {},
): AuthorizationScopeSnapshot {
  return {
    tenancy: 'single',
    mode: 'advanced',
    scopeKind: 'application',
    scopeId: 'app',
    roles: ['clinician'],
    permissions: ['patients:read', 'patients:write'],
    revision: 'revision-1',
    ...overrides,
  };
}

function subject(
  overrides: Partial<AuthorizationSubjectSnapshot> = {},
): AuthorizationSubjectSnapshot {
  return {
    platformRole: 'user',
    authorization: scope(),
    properties: { department: 'clinical' },
    ...overrides,
  };
}

describe('AccessRequirement compilation', () => {
  test('preserves every legacy scalar meaning in a serializable representation', () => {
    expect(compileAccessRequirement(false).user).toBe('optional');
    expect(compileAccessRequirement('optional').user).toBe('optional');
    for (const requirement of [true, 'user', 'required'] as const) {
      expect(compileAccessRequirement(requirement).user).toBe('required');
    }
    expect(compileAccessRequirement('admin')).toMatchObject({
      user: 'required',
      platformRoleGroups: [['admin']],
    });
    expect(JSON.parse(JSON.stringify(compileAccessRequirement('admin'))))
      .toEqual(compileAccessRequirement('admin'));
  });

  test('normalizes structured declarations and implies authenticated identity', () => {
    const compiled = compileAccessRequirement({
      platformRole: ['support', 'admin'],
      scopeRole: ['manager', 'clinician'],
      permission: 'patients:read',
      allPermissions: ['patients:write', 'patients:read'],
      anyPermissions: ['staff:manage', 'billing:read'],
      properties: { department: { in: ['clinical', 'operations'] } },
    });

    expect(compiled).toEqual({
      kind: 'zero.access-requirement',
      version: 1,
      user: 'required',
      tenant: false,
      platformRoleGroups: [['admin', 'support']],
      scopeRoleGroups: [['clinician', 'manager']],
      allPermissions: ['patients:read', 'patients:write'],
      anyPermissionGroups: [['billing:read', 'staff:manage']],
      propertyGroups: [{ department: { in: ['clinical', 'operations'] } }],
    });
  });

  test('defaults existing policies to sessions and makes credential opt-in explicit', () => {
    expect(compileAccessRequirement('required').credentialKinds).toBeUndefined();
    expect(compileAccessRequirement({
      credentials: ['session', 'api-key'],
    })).toMatchObject({
      user: 'required',
      credentialKinds: ['api-key', 'session'],
    });
    expect(compileAccessRequirement({
      user: 'optional',
      credentials: ['session', 'api-key'],
    })).toMatchObject({
      user: 'optional',
      credentialKinds: ['api-key', 'session'],
    });
  });

  test('merges root-to-leaf requirements monotonically without flattening OR groups', () => {
    const parent = compileAccessRequirement({
      platformRole: ['admin', 'support'],
      scopeRole: ['clinician', 'manager'],
      permission: 'patients:read',
      anyPermissions: ['patients:write', 'staff:manage'],
      properties: { department: { exists: true } },
    });
    const merged = mergeAccessRequirements(parent, {
      user: 'optional',
      platformRole: ['admin'],
      scopeRole: ['manager'],
      permission: 'billing:read',
      anyPermissions: ['billing:read', 'staff:manage'],
      properties: { department: { not: 'suspended' } },
    });

    expect(merged.user).toBe('required');
    expect(merged.platformRoleGroups).toEqual([['admin', 'support'], ['admin']]);
    expect(merged.scopeRoleGroups).toEqual([['clinician', 'manager'], ['manager']]);
    expect(merged.allPermissions).toEqual(['billing:read', 'patients:read']);
    expect(merged.anyPermissionGroups).toEqual([
      ['patients:write', 'staff:manage'],
      ['billing:read', 'staff:manage'],
    ]);
    expect(merged.propertyGroups).toEqual([
      { department: { exists: true } },
      { department: { not: 'suspended' } },
    ]);

    const cannotWeaken = mergeAccessRequirements(merged, false);
    expect(cannotWeaken).toEqual(merged);
  });

  test('inherits explicit credential admission and intersects explicit parent constraints', () => {
    const leafOptIn = mergeAccessRequirements('optional', {
      credentials: ['session', 'api-key'],
      permission: 'patients:read',
    });
    expect(leafOptIn.credentialKinds).toEqual(['api-key', 'session']);

    const sessionParent = compileAccessRequirement({
      user: 'optional',
      credentials: ['session'],
    });
    expect(mergeAccessRequirements(sessionParent, {
      credentials: ['session', 'api-key'],
      permission: 'patients:read',
    }).credentialKinds).toEqual(['session']);
    expect(() => mergeAccessRequirements(sessionParent, {
      credentials: ['api-key'],
      permission: 'patients:read',
    })).toThrow('allow no common credential kind');

    const broadParent = compileAccessRequirement({
      user: 'optional',
      credentials: ['session', 'api-key'],
    });
    expect(mergeAccessRequirements(broadParent, {
      credentials: ['api-key'],
      permission: 'patients:read',
    }).credentialKinds).toEqual(['api-key']);

    expect(mergeAccessRequirements('required', {
      credentials: ['session', 'api-key'],
      permission: 'patients:read',
    }).credentialKinds).toEqual(['session']);
    expect(() => mergeAccessRequirements('admin', {
      credentials: ['api-key'],
    })).toThrow('allow no common credential kind');
    expect(() => mergeAccessRequirements({
      permission: 'patients:read',
    }, {
      credentials: ['api-key'],
    })).toThrow('allow no common credential kind');
  });

  test('fails static validation for unsafe or undeclared policy inputs', () => {
    const configured = kernel();
    expect(() => configured.compile({ permission: 'patients:delete' }))
      .toThrow('references undeclared permission "patients:delete"');
    expect(() => configured.compile({ permission: 'read' }))
      .toThrow('Invalid permission key "read"');
    expect(() => configured.compile({ scopeRole: 'unknown' }))
      .toThrow('references undeclared scope role "unknown"');
    expect(() => configured.compile({ properties: { selfAssigned: true } }))
      .toThrow('property "selfAssigned" is not policy-trusted');
    expect(() => configured.compile({ properties: { missing: true } }))
      .toThrow('property "missing" is not policy-trusted');
    expect(() => kernel('single').compile({ tenant: 'required' }))
      .toThrow('require tenancy mode "multi"');
    expect(() => compileAccessRequirement({ anyPermissions: [] }))
      .toThrow('anyPermissions must be a non-empty string array');
    expect(() => compileAccessRequirement({ credentials: [] }))
      .toThrow('credentials must be a non-empty credential-kind array');
    expect(() => compileAccessRequirement({ credentials: ['password'] as never }))
      .toThrow('unsupported credential kind "password"');
    expect(() => compileAccessRequirement({ properties: { department: {} } }))
      .toThrow('matcher may not be empty');
    for (const nonFinite of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => compileAccessRequirement({
        properties: { department: nonFinite },
      })).toThrow('invalid matcher');
      expect(() => compileAccessRequirement({
        properties: { department: { equals: nonFinite } },
      })).toThrow('equals must be a scalar');
      expect(() => compileAccessRequirement({
        properties: { department: { in: ['clinical', nonFinite] } },
      })).toThrow('in must be a non-empty scalar array');
      expect(() => configured.evaluate({
        ...compileAccessRequirement('required'),
        propertyGroups: [{ department: nonFinite }],
      }, subject())).toThrow('invalid matcher');
    }
    expect(() => compileAccessRequirement({ permisssion: 'patients:read' } as never))
      .toThrow('unsupported field "permisssion"');
    const compiledWithoutRegistry = compileAccessRequirement({
      permission: 'patients:delete',
    });
    expect(() => configured.evaluate(compiledWithoutRegistry, subject()))
      .toThrow('references undeclared permission "patients:delete"');
    expect(() => validateAuthorizationRegistry({
      mode: 'advanced',
      registryVersion: 1,
      permissions: {},
      roles: {
        owner: {
          key: 'owner',
          label: 'Owner',
          permissions: ['patients:read'],
          allPermissions: false,
          system: true,
        },
      },
    })).toThrow('references undeclared permission "patients:read"');

    const optionalPermission = {
      ...compileAccessRequirement(false),
      allPermissions: ['patients:read'],
    };
    expect(() => configured.evaluate(optionalPermission, null))
      .toThrow('constraints require an authenticated user');
    expect(() => configured.evaluate({
      ...compileAccessRequirement(false),
      permission: 'patients:read',
    } as never, null)).toThrow('contains unsupported field "permission"');
    expect(() => configured.evaluate({
      ...compileAccessRequirement('required'),
      platformRoleGroups: ['superadmin'],
    } as never, subject({ platformRole: 'admin' })))
      .toThrow('platformRoleGroups must contain role arrays');
  });
});

describe('AuthorizationKernel scope synthesis and evaluation', () => {
  test('keeps facade compile and scope-validation extension points in the evaluation path', () => {
    class InstrumentedAuthorizationKernel extends AuthorizationKernel {
      compileCalls = 0;
      scopeValidationCalls = 0;

      override compile(
        requirement: AccessRequirement,
        parent?: AccessRequirement | CompiledAccessRequirement,
      ): CompiledAccessRequirement {
        this.compileCalls += 1;
        return super.compile(requirement, parent);
      }

      override isValidScopeSnapshot(candidate: AuthorizationScopeSnapshot): boolean {
        this.scopeValidationCalls += 1;
        return super.isValidScopeSnapshot(candidate);
      }
    }

    const base = kernel();
    const configured = new InstrumentedAuthorizationKernel({
      tenancy: base.tenancy,
      authorization: base.authorization,
    });

    expect(configured.evaluate({ permission: 'patients:read' }, subject()).allowed).toBe(true);
    expect(configured.compileCalls).toBe(1);
    expect(configured.scopeValidationCalls).toBe(1);
  });

  test('synthesizes the exact single/simple compatibility scope from live role state', () => {
    const configured = kernel('single', 'simple');
    const clinician = configured.synthesizeSingleSimpleScope({
      platformRole: 'clinician',
      scopeId: 'zero-app',
    });
    expect(clinician).toEqual({
      tenancy: 'single',
      mode: 'simple',
      scopeKind: 'application',
      scopeId: 'zero-app',
      roles: ['clinician'],
      permissions: ['patients:read', 'patients:write'],
      revision: 'single/simple:clinician:patients:read,patients:write',
    });

    const owner = configured.synthesizeSingleSimpleScope({ platformRole: 'owner' });
    expect(owner.allPermissions).toBe(true);
    expect(owner.permissions).toEqual(Object.keys(permissions).sort());
    expect(() => kernel('single', 'advanced').synthesizeSingleSimpleScope({
      platformRole: 'owner',
    })).toThrow('requires the single/simple profile');
  });

  test('allows optional anonymous access and returns stable authentication errors', () => {
    const configured = kernel();
    expect(configured.evaluate('optional', null)).toMatchObject({ allowed: true, scope: null });
    const denied = configured.evaluate('required', null);
    expect(denied).toMatchObject({
      allowed: false,
      reason: 'authentication-required',
      error: { code: 'UNAUTHORIZED', status: 401, message: 'Unauthorized' },
    });
    expect(() => configured.authorize('required', null)).toThrow(AuthError);
    try {
      configured.authorize('required', null);
    } catch (error) {
      expect(error).toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
    }
  });

  test('admits API-key subjects only through an explicit credential policy', () => {
    const configured = kernel();
    const apiKeySubject = subject({ credentialKind: 'api-key' });

    expect(configured.evaluate('required', apiKeySubject)).toMatchObject({
      allowed: false,
      reason: 'credential-kind',
      error: { code: 'FORBIDDEN', status: 403 },
    });
    expect(configured.evaluate({
      credentials: ['session', 'api-key'],
      permission: 'patients:read',
    }, apiKeySubject).allowed).toBe(true);
    expect(configured.evaluate({
      credentials: ['api-key'],
      permission: 'patients:read',
    }, subject())).toMatchObject({ allowed: false, reason: 'credential-kind' });
    expect(configured.evaluate({
      user: 'optional',
      credentials: ['api-key'],
    }, null)).toMatchObject({ allowed: true, scope: null });
  });

  test('keeps platform roles separate from scoped application roles', () => {
    const configured = kernel();
    expect(configured.evaluate('admin', subject({ platformRole: 'admin' })).allowed).toBe(true);
    expect(configured.evaluate('admin', subject({
      platformRole: 'user',
      authorization: scope({ roles: ['owner'], allPermissions: true }),
    }))).toMatchObject({ allowed: false, reason: 'platform-role' });
    expect(configured.evaluate({ scopeRole: 'clinician' }, subject()).allowed).toBe(true);
    expect(configured.evaluate({ scopeRole: 'manager' }, subject()))
      .toMatchObject({ allowed: false, reason: 'scope-role' });
  });

  test('requires every permission and keeps each any-permission group conjunctive', () => {
    const configured = kernel();
    const requirement = configured.merge(
      {
        allPermissions: ['patients:read', 'patients:write'],
        anyPermissions: ['billing:read', 'staff:manage'],
      },
      { anyPermissions: ['patients:write', 'staff:manage'] },
    );
    expect(configured.evaluate(requirement, subject()))
      .toMatchObject({ allowed: false, reason: 'permission' });
    expect(configured.evaluate(requirement, subject({
      authorization: scope({
        roles: ['clinician', 'manager'],
        permissions: ['patients:read', 'patients:write', 'staff:manage'],
      }),
    })).allowed).toBe(true);
    expect(configured.evaluate(requirement, subject({
      authorization: scope({
        roles: ['owner'],
        permissions: Object.keys(configured.authorization.permissions).sort(),
        allPermissions: true,
      }),
    })).allowed).toBe(true);
    expect(configured.evaluate(requirement, subject({
      authorization: scope({ allPermissions: true }),
    }))).toMatchObject({ allowed: false, reason: 'scope-invalid' });
  });

  test('evaluates every trusted-property matcher and every inherited group', () => {
    const configured = kernel();
    expect(configured.isPolicyTrustedProperty('department')).toBe(true);
    expect(configured.isPolicyTrustedProperty('selfAssigned')).toBe(false);
    const requirement = configured.merge(
      { properties: { department: ['clinical', 'operations'] } },
      {
        properties: {
          department: { exists: true, not: ['suspended'], in: ['clinical'] },
        },
      },
    );
    expect(configured.evaluate(requirement, subject()).allowed).toBe(true);
    expect(configured.evaluate(requirement, subject({
      properties: { department: 'operations' },
    }))).toMatchObject({ allowed: false, reason: 'property' });
    expect(configured.evaluate(requirement, subject({ properties: {} })))
      .toMatchObject({ allowed: false, reason: 'property' });
  });

  test('validates supplied application and tenant scope snapshots against the profile', () => {
    const single = kernel('single', 'advanced');
    expect(single.evaluate({ permission: 'patients:read' }, subject()).allowed).toBe(true);
    expect(single.evaluate({ permission: 'patients:read' }, subject({
      authorization: scope({ mode: 'simple' }),
    }))).toMatchObject({ allowed: false, reason: 'scope-invalid' });
    expect(single.evaluate({ permission: 'patients:read' }, subject({
      authorization: scope({ permissions: ['patients:delete'] }),
    }))).toMatchObject({ allowed: false, reason: 'scope-invalid' });

    const multi = kernel('multi', 'advanced');
    const tenantScope = scope({
      tenancy: 'multi',
      scopeKind: 'tenant',
      scopeId: 'tenant-a',
      tenantId: 'tenant-a',
      membershipId: 'membership-a',
    });
    expect(multi.evaluate(
      { tenant: 'required', permission: 'patients:read' },
      subject({ authorization: tenantScope }),
    ).allowed).toBe(true);
    expect(multi.evaluate(
      { tenant: 'required' },
      subject({ authorization: { ...tenantScope, membershipId: undefined } }),
    )).toMatchObject({ allowed: false, reason: 'scope-invalid' });

    const unknownScopeKind = {
      ...scope({
        tenancy: 'multi',
        scopeId: 'application',
        roles: [],
        permissions: [],
      }),
      scopeKind: 'workspace',
    } as unknown as AuthorizationScopeSnapshot;
    expect(multi.isValidScopeSnapshot(unknownScopeKind)).toBe(false);
    expect(multi.evaluate(
      'required',
      subject({ authorization: unknownScopeKind }),
    )).toMatchObject({ allowed: false, reason: 'scope-invalid' });
  });

  test('uses one evaluator for supplied snapshots in all four profiles', () => {
    for (const tenancy of ['single', 'multi'] as const) {
      for (const mode of ['simple', 'advanced'] as const) {
        const configured = kernel(tenancy, mode);
        const supplied = scope({
          tenancy,
          mode,
          scopeKind: tenancy === 'multi' ? 'tenant' : 'application',
          scopeId: tenancy === 'multi' ? 'tenant-a' : 'app',
          ...(tenancy === 'multi'
            ? { tenantId: 'tenant-a', membershipId: 'membership-a' }
            : {}),
        });
        expect(configured.evaluate(
          { permission: 'patients:read' },
          subject({ authorization: supplied }),
        ).allowed).toBe(true);
      }
    }
  });

  test('returns stable forbidden AuthErrors for every authorization denial', () => {
    const configured = kernel();
    for (const [requirement, actor] of [
      ['admin', subject()] as const,
      [{ scopeRole: 'manager' }, subject()] as const,
      [{ permission: 'staff:manage' }, subject()] as const,
      [{ properties: { department: 'operations' } }, subject()] as const,
      [{ permission: 'patients:read' }, subject({ authorization: null })] as const,
    ]) {
      const decision = configured.evaluate(requirement, actor);
      expect(decision).toMatchObject({
        allowed: false,
        error: { code: 'FORBIDDEN', status: 403, message: 'Forbidden' },
      });
    }
  });
});
