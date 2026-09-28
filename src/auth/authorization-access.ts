/**
 * Request-local authorization facade backed by one app-local kernel.
 *
 * Authentication is hydrated by TokenService before this adapter runs. The
 * adapter only projects that live identity, its server-bound session scope,
 * and current server-owned user properties into the pure authorization
 * kernel. It never accepts a tenant or role from request input.
 */

import {
  compileAccessRequirement,
  isCompiledAccessRequirement,
  mergeAccessRequirements,
  type AccessRequirement,
  type AuthorizationKernel,
  type AuthorizationScopeSnapshot,
  type AuthorizationSubjectSnapshot,
  type CompiledAccessRequirement,
} from './authorization-kernel';
import { AuthError, type AuthContext, type PermissionKey } from './types';
import type { AuthorizationRoleSet } from './authorization-role-types';

/** Narrow property-store contract needed by request authorization. */
export interface AuthorizationPropertyStore {
  getProperties(userId: string): Record<string, string>;
}

/** App-local live assignment resolver used only by advanced profiles. */
export interface AuthorizationRoleAssignmentResolver {
  resolveApplicationRoles(userId: string): AuthorizationRoleSet | null;
  resolveTenantRoles(input: {
    tenantId: string;
    membershipId: string;
    userId: string;
  }): AuthorizationRoleSet | null;
}

/** A validated tenant scope returned by requireTenant(). */
export type TenantAuthorizationScope = AuthorizationScopeSnapshot & {
  readonly scopeKind: 'tenant';
  readonly tenantId: string;
  readonly membershipId: string;
};

/** Canonical request authorization API exposed as `context.access`. */
export interface RequestAuthorizationAccess {
  /** Current live authenticated identity, or null for an anonymous request. */
  readonly context: AuthContext | null;
  /** Current valid application/tenant scope, if this profile can project one. */
  readonly authorization: AuthorizationScopeSnapshot | null;
  /** Enforce any shared Zero access declaration. */
  authorize(
    requirement: AccessRequirement | CompiledAccessRequirement,
  ): AuthorizationScopeSnapshot | null;
  /** Require a current authenticated identity. */
  requireUser(): AuthContext;
  /** Require the existing global/platform administrator role. */
  requirePlatformAdmin(): AuthContext;
  /** Require a valid application or tenant authorization scope. */
  requireAuthorizationScope(): AuthorizationScopeSnapshot;
  /** Require a valid tenant-bound session scope. */
  requireTenant(): TenantAuthorizationScope;
  /** Test one statically declared permission without throwing for denial. */
  hasPermission(permission: PermissionKey): boolean;
  /** Require one statically declared permission. */
  requirePermission(permission: PermissionKey): AuthorizationScopeSnapshot;
  /** Require at least one permission from a non-empty list. */
  requireAnyPermission(
    permissions: readonly PermissionKey[],
  ): AuthorizationScopeSnapshot;
}

export interface CreateRequestAuthorizationAccessOptions {
  authContext: AuthContext | null;
  kernel: AuthorizationKernel | null;
  propertyStore?: AuthorizationPropertyStore | null;
  roleAssignments?: AuthorizationRoleAssignmentResolver | null;
  /** Recheck the owning runtime before consuming this cached authority facade. */
  assertCurrentProfile?: () => void;
}

/** Build one immutable facade/snapshot for one already-hydrated request. */
export function createRequestAuthorizationAccess(
  options: CreateRequestAuthorizationAccessOptions,
): RequestAuthorizationAccess {
  const { authContext, kernel } = options;
  const assertCurrentProfile = options.assertCurrentProfile ?? (() => {});
  let baseSubject: AuthorizationSubjectSnapshot | null | undefined;
  let propertySubject: AuthorizationSubjectSnapshot | null | undefined;
  const resolveSubject = (
    includeProperties = false,
  ): AuthorizationSubjectSnapshot | null => {
    if (includeProperties) {
      if (propertySubject !== undefined) return propertySubject;
      const base = resolveSubject(false);
      if (!base || !authContext) {
        propertySubject = null;
        return null;
      }
      propertySubject = Object.freeze({
        ...base,
        properties: Object.freeze({
          ...(options.propertyStore?.getProperties(authContext.userId) ?? {}),
        }),
      });
      return propertySubject;
    }
    if (baseSubject !== undefined) return baseSubject;
    if (!kernel || !authContext) {
      baseSubject = null;
      return null;
    }

    baseSubject = createAuthorizationSubjectSnapshot(
      kernel,
      authContext,
      {},
      options.roleAssignments,
    );
    return baseSubject;
  };

  const resolveAuthorization = (): AuthorizationScopeSnapshot | null => (
    resolveSubject()?.authorization ?? null
  );
  const requireCurrentUser = (): AuthContext => {
    if (!authContext) throw unauthorized();
    return authContext;
  };
  const authorizeRequirement = (
    requirement: AccessRequirement | CompiledAccessRequirement,
  ): AuthorizationScopeSnapshot | null => {
    if (kernel) {
      const compiled = isCompiledAccessRequirement(requirement)
        ? requirement
        : kernel.compile(requirement);
      const requiresProperties = Array.isArray(compiled.propertyGroups)
        && compiled.propertyGroups.length > 0;
      if (requiresProperties && !options.propertyStore) {
        throw new AuthError(
          'Auth policy services are unavailable',
          'AUTH_POLICY_UNAVAILABLE',
          503,
        );
      }
      return kernel.authorize(
        compiled,
        resolveSubject(requiresProperties),
      );
    }
    return authorizeWithoutKernel(requirement, authContext);
  };

  const access: RequestAuthorizationAccess = {
    get context() {
      assertCurrentProfile();
      return authContext;
    },
    get authorization() {
      assertCurrentProfile();
      return resolveAuthorization();
    },
    authorize(requirement) {
      assertCurrentProfile();
      return authorizeRequirement(requirement);
    },
    requireUser() {
      assertCurrentProfile();
      return requireCurrentUser();
    },
    requirePlatformAdmin() {
      assertCurrentProfile();
      const current = requireCurrentUser();
      if (current.role !== 'admin') throw forbidden();
      return current;
    },
    requireAuthorizationScope() {
      assertCurrentProfile();
      requireCurrentUser();
      const authorization = resolveAuthorization();
      if (!authorization) throw forbidden();
      return authorization;
    },
    requireTenant() {
      assertCurrentProfile();
      requireCurrentUser();
      const scope = resolveAuthorization();
      if (!scope) throw forbidden();
      if (scope.scopeKind !== 'tenant' || !scope.tenantId || !scope.membershipId) {
        throw forbidden();
      }
      return scope as TenantAuthorizationScope;
    },
    hasPermission(permission) {
      assertCurrentProfile();
      if (!kernel) return false;
      return kernel.evaluate({ permission }, resolveSubject()).allowed;
    },
    requirePermission(permission) {
      assertCurrentProfile();
      const scope = authorizeRequirement({ permission });
      if (!scope) throw forbidden();
      return scope;
    },
    requireAnyPermission(permissions) {
      assertCurrentProfile();
      const scope = authorizeRequirement({ anyPermissions: permissions });
      if (!scope) throw forbidden();
      return scope;
    },
  };

  return Object.freeze(access);
}

/**
 * Project live request state into the kernel's transport-neutral subject.
 *
 * Advanced profiles resolve retained assignments from the app-local service.
 * Missing/inactive subjects deliberately project an empty scope, never a role
 * supplied by request input or token claims.
 */
export function createAuthorizationSubjectSnapshot(
  kernel: AuthorizationKernel,
  authContext: AuthContext,
  properties: Readonly<Record<string, string>> = {},
  roleAssignments?: AuthorizationRoleAssignmentResolver | null,
): AuthorizationSubjectSnapshot {
  const candidate = projectAuthorizationScope(kernel, authContext, roleAssignments);
  const authorization = candidate && kernel.isValidScopeSnapshot(candidate)
    ? candidate
    : null;

  return Object.freeze({
    platformRole: authContext.role,
    properties: Object.freeze({ ...properties }),
    authorization,
  });
}

function projectAuthorizationScope(
  kernel: AuthorizationKernel,
  auth: AuthContext,
  roleAssignments?: AuthorizationRoleAssignmentResolver | null,
): AuthorizationScopeSnapshot | null {
  if (kernel.tenancy.mode === 'single') {
    if (kernel.authorization.mode === 'simple') {
      return kernel.synthesizeSingleSimpleScope({
        platformRole: auth.role,
        scopeId: auth.sessionScopeKind === 'application' && auth.sessionScopeId
          ? auth.sessionScopeId
          : 'application',
      });
    }

    const assignment = roleAssignments?.resolveApplicationRoles(auth.userId) ?? null;
    if (!assignment) return null;
    return expandAdvancedScope(kernel, assignment, {
      tenancy: 'single',
      mode: 'advanced',
      scopeKind: 'application',
      scopeId: auth.sessionScopeKind === 'application' && auth.sessionScopeId
        ? auth.sessionScopeId
        : 'application',
      revision: assignment.revision,
    });
  }

  if (
    auth.sessionScopeKind !== 'tenant'
    || !auth.sessionScopeId
    || !auth.tenantId
    || auth.sessionScopeId !== auth.tenantId
    || !auth.membershipId
    || !Number.isSafeInteger(auth.tenantAuthorizationGeneration)
    || auth.tenantAuthorizationGeneration! < 0
    || !Number.isSafeInteger(auth.membershipAuthorizationGeneration)
    || auth.membershipAuthorizationGeneration! < 0
  ) {
    return null;
  }

  if (kernel.authorization.mode === 'advanced') {
    const assignment = roleAssignments?.resolveTenantRoles({
      tenantId: auth.tenantId,
      membershipId: auth.membershipId,
      userId: auth.userId,
    }) ?? null;
    if (!assignment) return null;
    return expandAdvancedScope(kernel, assignment, {
      tenancy: 'multi',
      mode: 'advanced',
      scopeKind: 'tenant',
      scopeId: auth.tenantId,
      tenantId: auth.tenantId,
      membershipId: auth.membershipId,
      revision: tenantRevision(
        auth,
        `advanced:${assignment.revision}`,
      ),
    });
  }

  if (!auth.tenantRole) return null;
  const template = kernel.authorization.roles[auth.tenantRole];
  const allPermissions = template?.allPermissions ?? false;
  const permissions = allPermissions
    ? Object.keys(kernel.authorization.permissions).sort(compareKeys)
    : [...(template?.permissions ?? [])].sort(compareKeys);

  return freezeScope({
    tenancy: 'multi',
    mode: 'simple',
    scopeKind: 'tenant',
    scopeId: auth.tenantId,
    tenantId: auth.tenantId,
    membershipId: auth.membershipId,
    roles: [auth.tenantRole],
    permissions,
    ...(allPermissions ? { allPermissions: true } : {}),
    revision: tenantRevision(auth, `simple:${auth.tenantRole}`),
  });
}

function expandAdvancedScope(
  kernel: AuthorizationKernel,
  assignment: AuthorizationRoleSet | null,
  base: Omit<AuthorizationScopeSnapshot, 'roles' | 'permissions' | 'allPermissions'>,
): AuthorizationScopeSnapshot {
  // Retained assignments deliberately outlive their static role templates so
  // an owner can see and remove retired keys through the administration
  // control plane. They are not live authority, though: keep the assignment
  // revision below, but project only currently declared roles into the
  // request snapshot and permission expansion.
  const roles = [...(assignment?.roles ?? [])]
    .filter((roleKey) => Object.hasOwn(kernel.authorization.roles, roleKey))
    .sort(compareKeys);
  const templates = roles.map((role) => kernel.authorization.roles[role]);
  const allPermissions = templates.some((template) => template?.allPermissions === true);
  const permissions = allPermissions
    ? Object.keys(kernel.authorization.permissions).sort(compareKeys)
    : [...new Set(templates.flatMap((template) => template?.permissions ?? []))]
      .sort(compareKeys);
  return freezeScope({
    ...base,
    roles,
    permissions,
    ...(allPermissions ? { allPermissions: true } : {}),
  });
}

function tenantRevision(auth: AuthContext, suffix: string): string {
  return [
    'tenant',
    auth.tenantId,
    auth.tenantAuthorizationGeneration,
    auth.membershipId,
    auth.membershipAuthorizationGeneration,
    suffix,
  ].join(':');
}

function freezeScope(scope: AuthorizationScopeSnapshot): AuthorizationScopeSnapshot {
  return Object.freeze({
    ...scope,
    roles: Object.freeze([...scope.roles]),
    permissions: Object.freeze([...scope.permissions]),
  });
}

/** Legacy-only fallback for standalone middleware that has no auth runtime. */
function authorizeWithoutKernel(
  requirement: AccessRequirement | CompiledAccessRequirement,
  authContext: AuthContext | null,
): AuthorizationScopeSnapshot | null {
  const compiled = isCompiledAccessRequirement(requirement)
    ? mergeAccessRequirements(requirement, false)
    : compileAccessRequirement(requirement);
  if (compiled.user === 'required' && !authContext) throw unauthorized();
  if (!authContext) return null;

  if (!compiled.platformRoleGroups.every((group) => group.includes(authContext.role))) {
    throw forbidden();
  }
  if (
    compiled.tenant
    || compiled.scopeRoleGroups.length > 0
    || compiled.allPermissions.length > 0
    || compiled.anyPermissionGroups.length > 0
    || compiled.propertyGroups.length > 0
  ) {
    throw new AuthError(
      'Auth policy services are unavailable',
      'AUTH_POLICY_UNAVAILABLE',
      503,
    );
  }
  return null;
}

function unauthorized(): AuthError {
  return new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
}

function forbidden(): AuthError {
  return new AuthError('Forbidden', 'FORBIDDEN', 403);
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
