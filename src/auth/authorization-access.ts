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
  expandAuthorizationRolesForScope,
  isCompiledAccessRequirement,
  mergeAccessRequirements,
  type AccessRequirement,
  type AuthorizationCredentialKind,
  type AuthorizationKernel,
  type AuthorizationScopeSnapshot,
  type AuthorizationSubjectSnapshot,
  type CompiledAccessRequirement,
} from './authorization-kernel';
import { AuthError, type AuthContext, type PermissionKey } from './types';
import type { AuthorizationRoleSet } from './authorization-role-types';
import { isAdministrationOnlyRole } from './authorization-registry';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';

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
  /** Live application authority; multi mode exposes it only in the administration organization. */
  readonly applicationAuthorization: AuthorizationScopeSnapshot | null;
  /** Enforce any shared Zero access declaration. */
  authorize(
    requirement: AccessRequirement | CompiledAccessRequirement,
  ): AuthorizationScopeSnapshot | null;
  /** Require a current authenticated identity. */
  requireUser(): AuthContext;
  /**
   * Require the legacy global `users.role === 'admin'` authority in every
   * profile. Packaged multi-tenant control planes use explicit application
   * permissions instead; tenant roles never satisfy `access: 'admin'`.
   */
  requirePlatformAdmin(): AuthContext;
  /** Require a valid application or tenant authorization scope. */
  requireAuthorizationScope(): AuthorizationScopeSnapshot;
  /** Require a live application control-plane scope. */
  requireApplicationAuthorization(): AuthorizationScopeSnapshot & {
    readonly scopeKind: 'application';
  };
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
  /** App-local observability boundary for an invalid asynchronous profile fence. */
  emitCode?: AuthPlatformCodeEmitter;
}

/** Build one immutable facade/snapshot for one already-hydrated request. */
export function createRequestAuthorizationAccess(
  options: CreateRequestAuthorizationAccessOptions,
): RequestAuthorizationAccess {
  const { authContext, kernel } = options;
  const profileGuard = options.assertCurrentProfile;
  const assertCurrentProfile = profileGuard
    ? () => invokeSynchronousAuthCallback(profileGuard, {
        component: 'request-authorization-access',
        invariant: 'runtime-profile-guard-async',
        message: '[auth] Request authorization profile guard must be synchronous.',
        emitCode: options.emitCode,
      })
    : () => {};
  let baseSubject: AuthorizationSubjectSnapshot | null | undefined;
  let propertySubject: AuthorizationSubjectSnapshot | null | undefined;
  let apiKeyAdmitted = false;
  const isApiKeyRequest = authContext?.credentialKind === 'api-key';
  const visibleContext = (): AuthContext | null => (
    isApiKeyRequest && !apiKeyAdmitted ? null : authContext
  );
  const assertCredentialAdmitted = (): void => {
    if (isApiKeyRequest && !apiKeyAdmitted) throw forbidden();
  };
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
      const properties = options.propertyStore
        ? invokeSynchronousAuthCallback(
          () => options.propertyStore!.getProperties(authContext.userId),
          {
            component: 'request-authorization-access',
            invariant: 'property-resolver-async',
            message: '[auth] Authorization property resolution must be synchronous.',
            emitCode: options.emitCode,
          },
        )
        : {};
      propertySubject = Object.freeze({
        ...base,
        properties: Object.freeze({ ...properties }),
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
      options.emitCode,
    );
    return baseSubject;
  };

  const resolveAuthorization = (): AuthorizationScopeSnapshot | null => (
    visibleContext() ? resolveSubject()?.authorization ?? null : null
  );
  const resolveApplicationAuthorization = (): AuthorizationScopeSnapshot | null => (
    visibleContext() ? resolveSubject()?.applicationAuthorization ?? null : null
  );
  const requireCurrentUser = (): AuthContext => {
    if (!authContext) throw unauthorized();
    assertCredentialAdmitted();
    return authContext;
  };
  const authorizeRequirement = (
    requirement: AccessRequirement | CompiledAccessRequirement,
  ): AuthorizationScopeSnapshot | null => {
    const compiled = isCompiledAccessRequirement(requirement)
      ? requirement
      : kernel?.compile(requirement) ?? compileAccessRequirement(requirement);
    // Credential visibility belongs to the policy currently being evaluated,
    // never to an earlier middleware/guard on the same request. Conceal first
    // so a denied policy cannot leave a previously admitted key visible.
    if (isApiKeyRequest) apiKeyAdmitted = false;
    let authorized: AuthorizationScopeSnapshot | null;
    if (kernel) {
      const requiresProperties = Array.isArray(compiled.propertyGroups)
        && compiled.propertyGroups.length > 0;
      if (requiresProperties && !options.propertyStore) {
        throw new AuthError(
          'Auth policy services are unavailable',
          'AUTH_POLICY_UNAVAILABLE',
          503,
        );
      }
      authorized = kernel.authorize(
        compiled,
        isApiKeyRequest
          && compiled.user === 'optional'
          && !compiled.credentialKinds?.includes('api-key')
          ? null
          : resolveSubject(requiresProperties),
      );
    } else {
      authorized = authorizeWithoutKernel(
        compiled,
        isApiKeyRequest
          && compiled.user === 'optional'
          && !compiled.credentialKinds?.includes('api-key')
          ? null
          : authContext,
      );
    }
    if (isApiKeyRequest) {
      apiKeyAdmitted = compiled.credentialKinds?.includes('api-key') === true;
    }
    return authorized;
  };

  const access: RequestAuthorizationAccess = {
    get context() {
      assertCurrentProfile();
      return visibleContext();
    },
    get authorization() {
      assertCurrentProfile();
      return resolveAuthorization();
    },
    get applicationAuthorization() {
      assertCurrentProfile();
      return resolveApplicationAuthorization();
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
    requireApplicationAuthorization() {
      assertCurrentProfile();
      requireCurrentUser();
      const authorization = resolveApplicationAuthorization();
      if (!authorization || authorization.scopeKind !== 'application') throw forbidden();
      return authorization as AuthorizationScopeSnapshot & { scopeKind: 'application' };
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
      if (!kernel || (isApiKeyRequest && !apiKeyAdmitted)) return false;
      return kernel.evaluate(
        isApiKeyRequest
          ? { credentials: ['api-key'], permission }
          : { permission },
        resolveSubject(),
      ).allowed;
    },
    requirePermission(permission) {
      assertCurrentProfile();
      requireCurrentUser();
      const scope = authorizeRequirement(isApiKeyRequest
        ? { credentials: ['api-key'], permission }
        : { permission });
      if (!scope) throw forbidden();
      return scope;
    },
    requireAnyPermission(permissions) {
      assertCurrentProfile();
      requireCurrentUser();
      const scope = authorizeRequirement(isApiKeyRequest
        ? { credentials: ['api-key'], anyPermissions: permissions }
        : { anyPermissions: permissions });
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
  emitCode?: AuthPlatformCodeEmitter,
): AuthorizationSubjectSnapshot {
  const candidate = projectAuthorizationScope(
    kernel,
    authContext,
    roleAssignments,
    emitCode,
  );
  const authorization = candidate && kernel.isValidScopeSnapshot(candidate)
    ? candidate
    : null;
  const applicationCandidate = authorization?.scopeKind === 'application'
    ? authorization
    : authorization?.scopeKind === 'tenant'
      ? projectAdministrationApplicationScope(
        kernel,
        authContext,
        roleAssignments,
        emitCode,
      )
      : null;
  const applicationAuthorization = applicationCandidate
    && kernel.isValidScopeSnapshot(applicationCandidate)
    ? applicationCandidate
    : null;

  return Object.freeze({
    platformRole: authContext.role,
    credentialKind: authContext.credentialKind ?? 'session',
    properties: Object.freeze({ ...properties }),
    authorization,
    applicationAuthorization,
  });
}

function projectAuthorizationScope(
  kernel: AuthorizationKernel,
  auth: AuthContext,
  roleAssignments?: AuthorizationRoleAssignmentResolver | null,
  emitCode?: AuthPlatformCodeEmitter,
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

    const assignment = resolveApplicationRoleAssignment(
      roleAssignments,
      auth.userId,
      emitCode,
    );
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

  // These framework roles are control-plane roles. A retained simple-mode
  // assignment in an ordinary customer organization is invalid authority,
  // even though its tenant-only permission subset would otherwise look safe.
  if (auth.tenantKind !== 'administration'
    && auth.tenantRole
    && isAdministrationOnlyRole(kernel.authorization, auth.tenantRole)) return null;

  if (kernel.authorization.mode === 'advanced') {
    const assignment = resolveTenantRoleAssignment(roleAssignments, {
      tenantId: auth.tenantId,
      membershipId: auth.membershipId,
      userId: auth.userId,
    }, emitCode);
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
  const expanded = expandAuthorizationRolesForScope(
    kernel.authorization,
    [auth.tenantRole],
    'tenant',
  );

  return freezeScope({
    tenancy: 'multi',
    mode: 'simple',
    scopeKind: 'tenant',
    scopeId: auth.tenantId,
    tenantId: auth.tenantId,
    membershipId: auth.membershipId,
    roles: [auth.tenantRole],
    permissions: expanded.permissions,
    ...(expanded.allPermissions ? { allPermissions: true } : {}),
    revision: tenantRevision(auth, `simple:${auth.tenantRole}`),
  });
}

/**
 * Project platform authority only while the same live session is bound to the
 * protected administration organization. `tenantKind` is server-derived by
 * the durable web/native session resolver; it is never accepted from request
 * input or an unverified token claim.
 */
function projectAdministrationApplicationScope(
  kernel: AuthorizationKernel,
  auth: AuthContext,
  roleAssignments?: AuthorizationRoleAssignmentResolver | null,
  emitCode?: AuthPlatformCodeEmitter,
): AuthorizationScopeSnapshot | null {
  if (kernel.tenancy.mode !== 'multi'
    || auth.tenantKind !== 'administration'
    || auth.sessionScopeKind !== 'tenant'
    || !auth.tenantId
    || auth.sessionScopeId !== auth.tenantId
    || !auth.membershipId) return null;

  if (kernel.authorization.mode === 'advanced') {
    const assignment = resolveTenantRoleAssignment(roleAssignments, {
      tenantId: auth.tenantId,
      membershipId: auth.membershipId,
      userId: auth.userId,
    }, emitCode);
    if (!assignment) return null;
    return expandAdvancedScope(kernel, assignment, {
      tenancy: 'multi',
      mode: 'advanced',
      scopeKind: 'application',
      scopeId: 'application',
      revision: tenantRevision(auth, `administration:${assignment.revision}`),
    });
  }

  if (!auth.tenantRole) return null;
  const expanded = expandAuthorizationRolesForScope(
    kernel.authorization,
    [auth.tenantRole],
    'application',
  );
  return freezeScope({
    tenancy: 'multi',
    mode: 'simple',
    scopeKind: 'application',
    scopeId: 'application',
    roles: [auth.tenantRole],
    permissions: expanded.permissions,
    ...(expanded.allPermissions ? { allPermissions: true } : {}),
    revision: tenantRevision(auth, `administration:simple:${auth.tenantRole}`),
  });
}

function resolveApplicationRoleAssignment(
  resolver: AuthorizationRoleAssignmentResolver | null | undefined,
  userId: string,
  emitCode?: AuthPlatformCodeEmitter,
): AuthorizationRoleSet | null {
  if (!resolver) return null;
  return invokeSynchronousAuthCallback(
    () => resolver.resolveApplicationRoles(userId),
    {
      component: 'request-authorization-access',
      invariant: 'application-role-resolver-async',
      message: '[auth] Application role resolution must be synchronous.',
      emitCode,
    },
  );
}

function resolveTenantRoleAssignment(
  resolver: AuthorizationRoleAssignmentResolver | null | undefined,
  input: Parameters<AuthorizationRoleAssignmentResolver['resolveTenantRoles']>[0],
  emitCode?: AuthPlatformCodeEmitter,
): AuthorizationRoleSet | null {
  if (!resolver) return null;
  return invokeSynchronousAuthCallback(
    () => resolver.resolveTenantRoles(input),
    {
      component: 'request-authorization-access',
      invariant: 'tenant-role-resolver-async',
      message: '[auth] Tenant role resolution must be synchronous.',
      emitCode,
    },
  );
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
  const expanded = expandAuthorizationRolesForScope(
    kernel.authorization,
    assignment?.roles ?? [],
    base.scopeKind,
  );
  return freezeScope({
    ...base,
    roles: expanded.roles,
    permissions: expanded.permissions,
    ...(expanded.allPermissions ? { allPermissions: true } : {}),
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
  compiled: CompiledAccessRequirement,
  authContext: AuthContext | null,
): AuthorizationScopeSnapshot | null {
  // Validate an externally supplied compiled policy before using it in the
  // standalone compatibility path.
  compiled = mergeAccessRequirements(compiled, false);
  if (compiled.user === 'required' && !authContext) throw unauthorized();
  if (!authContext) return null;

  const credentialKind: AuthorizationCredentialKind = authContext.credentialKind ?? 'session';
  if (!(compiled.credentialKinds ?? ['session']).includes(credentialKind)) {
    throw forbidden();
  }

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
