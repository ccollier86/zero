import { AuthError } from './types';
import type {
  PermissionKey,
  ResolvedAuthAuthorizationConfig,
  ResolvedAuthTenancyConfig,
} from './types';
import type {
  AccessRequirement,
  AccessRequirementCompileOptions,
  AuthorizationDecision,
  AuthorizationDenialReason,
  AuthorizationScopeSnapshot,
  AuthorizationSubjectSnapshot,
  CompiledAccessRequirement,
  SingleSimpleScopeInput,
} from './authorization-policy-types';
import { matchesTrustedPropertyGroups } from './authorization-property-policy';
import {
  compileAccessRequirement,
  isCompiledAccessRequirement,
  validateCompiledRequirement,
} from './authorization-requirement-compiler';
import {
  authorizationPermissionKeysForScope,
  expandAuthorizationRolesForScope,
  isAuthorizationPermissionKey,
  matchesAuthorizationRoleKeyPattern,
} from './authorization-registry-validation';
import {
  assertNonEmptyAuthorizationString,
  authorizationConfigError,
  isNonEmptyAuthorizationString,
  isUniqueAuthorizationStringArray,
  sameAuthorizationStringSet,
  uniqueSortedAuthorizationValues,
} from './authorization-kernel-utils';

export interface AuthorizationEvaluationContext {
  readonly tenancy: ResolvedAuthTenancyConfig;
  readonly authorization: ResolvedAuthAuthorizationConfig;
  readonly compileOptions: AccessRequirementCompileOptions;
}

/** Project today's live global role into the exact single/simple scope. */
export function synthesizeSingleSimpleAuthorizationScope(
  context: AuthorizationEvaluationContext,
  input: SingleSimpleScopeInput,
): AuthorizationScopeSnapshot {
  if (context.tenancy.mode !== 'single' || context.authorization.mode !== 'simple') {
    throw authorizationConfigError(
      'single/simple scope synthesis requires the single/simple profile.',
    );
  }
  assertNonEmptyAuthorizationString(input.platformRole, 'Single/simple platformRole');
  const role = input.scopeRole ?? input.platformRole;
  assertNonEmptyAuthorizationString(role, 'Single/simple scopeRole');
  const expanded = expandAuthorizationRolesForScope(
    context.authorization,
    [role],
    'application',
  );
  const scopeId = input.scopeId ?? 'application';
  assertNonEmptyAuthorizationString(scopeId, 'Single/simple scopeId');
  const revision = input.revision
    ?? `single/simple:${role}:${expanded.allPermissions
      ? 'all'
      : expanded.permissions.join(',')}`;

  return freezeScope({
    tenancy: 'single',
    mode: 'simple',
    scopeKind: 'application',
    scopeId,
    roles: [role],
    permissions: expanded.permissions,
    ...(expanded.allPermissions ? { allPermissions: true } : {}),
    revision,
  });
}

/** Evaluate one compiled or declarative requirement against live authority. */
export function evaluateAuthorizationRequirement(
  context: AuthorizationEvaluationContext,
  requirement: AccessRequirement | CompiledAccessRequirement,
  subject: AuthorizationSubjectSnapshot | null,
  validateScope: (scope: AuthorizationScopeSnapshot) => boolean = (scope) => (
    isValidAuthorizationScopeSnapshot(context, scope)
  ),
): AuthorizationDecision {
  const compiled = isCompiledAccessRequirement(requirement)
    ? requirement
    : compileAccessRequirement(requirement, context.compileOptions);
  validateCompiledRequirement(compiled, context.compileOptions);

  if (compiled.user === 'required' && !subject) {
    return denied(compiled, null, 'authentication-required', true);
  }
  if (!subject) return allowed(compiled, null);
  if (!isNonEmptyAuthorizationString(subject.platformRole)) {
    return denied(compiled, null, 'scope-invalid');
  }
  if (!matchesEveryGroup(subject.platformRole, compiled.platformRoleGroups)) {
    return denied(compiled, subject.authorization ?? null, 'platform-role');
  }
  if (!matchesTrustedPropertyGroups(subject.properties ?? {}, compiled.propertyGroups)) {
    return denied(compiled, subject.authorization ?? null, 'property');
  }

  const activeScope = subject.authorization ?? null;
  const suppliedApplicationScope = subject.applicationAuthorization ?? null;
  if (activeScope && !validateScope(activeScope)) {
    return denied(compiled, activeScope, 'scope-invalid');
  }
  if (suppliedApplicationScope
    && suppliedApplicationScope !== activeScope
    && !validateScope(suppliedApplicationScope)) {
    return denied(compiled, suppliedApplicationScope, 'scope-invalid');
  }

  const tenantScope = activeScope?.scopeKind === 'tenant' ? activeScope : null;
  const applicationScope = activeScope?.scopeKind === 'application'
    ? activeScope
    : suppliedApplicationScope?.scopeKind === 'application'
      ? suppliedApplicationScope
      : null;
  const resultScope = activeScope ?? applicationScope;

  if (compiled.tenant && !tenantScope) {
    return denied(compiled, resultScope, activeScope ? 'tenant-required' : 'scope-required');
  }
  if (compiled.scopeRoleGroups.length > 0 && !activeScope) {
    return denied(compiled, null, 'scope-required');
  }
  if (activeScope && !matchesRoleGroups(activeScope.roles, compiled.scopeRoleGroups)) {
    return denied(compiled, activeScope, 'scope-role');
  }

  const permissionScope = (permission: PermissionKey): AuthorizationScopeSnapshot | null => (
    context.authorization.permissions[permission]?.scope === 'application'
      ? applicationScope
      : tenantScope
  );
  const hasPermission = (permission: PermissionKey): boolean => {
    const scope = permissionScope(permission);
    return Boolean(scope && (scope.allPermissions || scope.permissions.includes(permission)));
  };
  for (const permission of compiled.allPermissions) {
    if (!permissionScope(permission)) {
      return denied(compiled, resultScope, 'scope-required');
    }
    if (!hasPermission(permission)) {
      return denied(compiled, resultScope, 'permission');
    }
  }
  for (const group of compiled.anyPermissionGroups) {
    if (!group.some((permission) => permissionScope(permission))) {
      return denied(compiled, resultScope, 'scope-required');
    }
    if (!group.some(hasPermission)) {
      return denied(compiled, resultScope, 'permission');
    }
  }

  const permissionKeys = [
    ...compiled.allPermissions,
    ...compiled.anyPermissionGroups.flat(),
  ];
  const hasApplicationPermission = permissionKeys.some((permission) => (
    context.authorization.permissions[permission]?.scope === 'application'
  ));
  const hasTenantPermission = permissionKeys.some((permission) => (
    context.authorization.permissions[permission]?.scope === 'tenant'
  ));
  const decisionScope = !compiled.tenant
    && compiled.scopeRoleGroups.length === 0
    && hasApplicationPermission
    && !hasTenantPermission
    ? applicationScope
    : resultScope;

  return allowed(compiled, decisionScope);
}

/** Validate a live scope supplied by a persistence or session adapter. */
export function isValidAuthorizationScopeSnapshot(
  context: AuthorizationEvaluationContext,
  scope: AuthorizationScopeSnapshot,
): boolean {
  if (scope.tenancy !== context.tenancy.mode
    || scope.mode !== context.authorization.mode) return false;
  if (scope.scopeKind !== 'application' && scope.scopeKind !== 'tenant') return false;
  if (!isNonEmptyAuthorizationString(scope.scopeId)
    || !isNonEmptyAuthorizationString(scope.revision)) return false;
  if (scope.tenancy === 'single' && scope.scopeKind !== 'application') return false;
  if (scope.scopeKind === 'tenant') {
    if (scope.tenancy !== 'multi') return false;
    if (!isNonEmptyAuthorizationString(scope.tenantId)
      || !isNonEmptyAuthorizationString(scope.membershipId)) return false;
    if (scope.scopeId !== scope.tenantId) return false;
  } else if (scope.tenantId !== undefined
    || scope.membershipId !== undefined
    || (scope.tenancy === 'multi' && scope.scopeId !== 'application')) {
    return false;
  }
  if (!isUniqueAuthorizationStringArray(scope.roles)
    || !isUniqueAuthorizationStringArray(scope.permissions)) return false;
  if (scope.roles.some((role) => !matchesAuthorizationRoleKeyPattern(role))) return false;
  if (scope.mode === 'simple' && scope.roles.length !== 1) return false;
  if (scope.allPermissions !== undefined && typeof scope.allPermissions !== 'boolean') return false;
  const declaredPermissions = new Set(Object.keys(context.authorization.permissions));
  if (scope.permissions.some((permission) => (
    !isAuthorizationPermissionKey(permission) || !declaredPermissions.has(permission)
  ))) return false;
  const declaredRoles = new Set(Object.keys(context.authorization.roles));
  const unknownRoles = scope.roles.filter((role) => !declaredRoles.has(role));
  if (unknownRoles.length > 0) {
    // The exact single/simple compatibility profile projects the current
    // global role into an application scope. Apps may declare mappings for
    // only some global roles; an unmapped platform role remains a valid,
    // inert scoped role so legacy `admin`/`user` checks keep working without
    // accidentally receiving configured permissions.
    if (scope.tenancy !== 'single'
      || scope.mode !== 'simple'
      || scope.permissions.length > 0
      || scope.allPermissions === true) return false;
  } else if (declaredRoles.size > 0) {
    const templates = scope.roles.map((role) => context.authorization.roles[role]!);
    const expectedAllPermissions = templates.some((template) => template.allPermissions);
    if (Boolean(scope.allPermissions) !== expectedAllPermissions) return false;
    const expectedPermissions = expectedAllPermissions
      ? authorizationPermissionKeysForScope(context.authorization, scope.scopeKind)
      : uniqueSortedAuthorizationValues(templates.flatMap((template) => template.permissions)
        .filter((permission) => (
          context.authorization.permissions[permission]?.scope === scope.scopeKind
        )));
    if (!sameAuthorizationStringSet(scope.permissions, expectedPermissions)) return false;
  } else if (scope.allPermissions) {
    return false;
  }
  return true;
}

function matchesEveryGroup(
  value: string,
  groups: readonly (readonly string[])[],
): boolean {
  return groups.every((group) => group.includes(value));
}

function matchesRoleGroups(
  roles: readonly string[],
  groups: readonly (readonly string[])[],
): boolean {
  const available = new Set(roles);
  return groups.every((group) => group.some((role) => available.has(role)));
}

function allowed(
  requirement: CompiledAccessRequirement,
  scope: AuthorizationScopeSnapshot | null,
): AuthorizationDecision {
  return { allowed: true, scope, requirement };
}

function denied(
  requirement: CompiledAccessRequirement,
  scope: AuthorizationScopeSnapshot | null,
  reason: AuthorizationDenialReason,
  unauthenticated = false,
): AuthorizationDecision {
  return {
    allowed: false,
    scope,
    requirement,
    reason,
    error: unauthenticated
      ? new AuthError('Unauthorized', 'UNAUTHORIZED', 401)
      : new AuthError('Forbidden', 'FORBIDDEN', 403),
  };
}

function freezeScope(scope: AuthorizationScopeSnapshot): AuthorizationScopeSnapshot {
  return Object.freeze({
    ...scope,
    roles: Object.freeze(uniqueSortedAuthorizationValues(scope.roles)),
    permissions: Object.freeze(uniqueSortedAuthorizationValues(scope.permissions)),
  });
}
