/**
 * Pure authorization requirement compiler and evaluator.
 *
 * This module owns no request, persistence, token, Elysia, or tenant lifecycle
 * state. Callers supply an immutable identity/scope snapshot and receive a
 * deterministic decision. Adapters for HTTP, Sync, resources, and background
 * work can therefore share one policy vocabulary without sharing transports.
 */

import {
  AuthError,
  type AuthAuthorizationMode,
  type AuthTenancyMode,
  type NormalizedAuthBehaviorConfig,
  type PermissionKey,
  type ResolvedAuthAuthorizationConfig,
  type ResolvedAuthRoleTemplateConfig,
  type ResolvedAuthTenancyConfig,
  type ResolvedUserPropertyFieldConfig,
} from './types';

export type { PermissionKey } from './types';

export type TrustedPropertyScalar = string | number | boolean;

/** JSON-safe matcher for one server-approved user property. */
export type TrustedPropertyRequirement =
  | TrustedPropertyScalar
  | readonly TrustedPropertyScalar[]
  | {
      equals?: TrustedPropertyScalar;
      in?: readonly TrustedPropertyScalar[];
      not?: TrustedPropertyScalar | readonly TrustedPropertyScalar[];
      exists?: boolean;
    };

export type LegacyAccessRequirement =
  | false
  | true
  | 'optional'
  | 'user'
  | 'required'
  | 'admin';

/** Structured, transport-neutral, and JSON-serializable access declaration. */
export interface StructuredAccessRequirement {
  user?: 'required' | 'optional';
  /** Existing global/platform role. This never means tenant role. */
  platformRole?: string | readonly string[];
  /** Require a validated tenant authorization scope. */
  tenant?: 'required';
  /** Application role in single mode or tenant role in multi mode. */
  scopeRole?: string | readonly string[];
  permission?: PermissionKey;
  allPermissions?: readonly PermissionKey[];
  anyPermissions?: readonly PermissionKey[];
  properties?: Readonly<Record<string, TrustedPropertyRequirement>>;
}

export type AccessRequirement = LegacyAccessRequirement | StructuredAccessRequirement;

/**
 * Canonical conjunctive representation used after root-to-leaf compilation.
 * Every field remains JSON-safe; sets are intentionally represented as arrays.
 */
export interface CompiledAccessRequirement {
  readonly kind: 'zero.access-requirement';
  readonly version: 1;
  readonly user: 'optional' | 'required';
  readonly tenant: boolean;
  /** Each inner group is OR; separate groups are AND. */
  readonly platformRoleGroups: readonly (readonly string[])[];
  /** Each inner group is OR; separate groups are AND. */
  readonly scopeRoleGroups: readonly (readonly string[])[];
  readonly allPermissions: readonly PermissionKey[];
  /** Each inner group is OR; separate groups are AND. */
  readonly anyPermissionGroups: readonly (readonly PermissionKey[])[];
  /** Separate property maps are AND, preserving parent and child constraints. */
  readonly propertyGroups: readonly Readonly<Record<string, TrustedPropertyRequirement>>[];
}

/** Static validation inputs supplied by a configured AuthorizationKernel. */
export interface AccessRequirementCompileOptions {
  tenancy?: AuthTenancyMode;
  declaredPermissions?: readonly PermissionKey[];
  declaredRoles?: readonly string[];
  trustedProperties?: readonly string[];
}

export type AuthorizationScopeKind = 'application' | 'tenant';

/** Live, server-supplied authority inside one application or tenant scope. */
export interface AuthorizationScopeSnapshot {
  readonly tenancy: AuthTenancyMode;
  readonly mode: AuthAuthorizationMode;
  readonly scopeKind: AuthorizationScopeKind;
  readonly scopeId: string;
  readonly roles: readonly string[];
  readonly permissions: readonly PermissionKey[];
  readonly allPermissions?: boolean;
  readonly revision: string;
  /** Present only for a validated multi-tenant membership scope. */
  readonly tenantId?: string;
  readonly membershipId?: string;
}

/** Authenticated identity plus optional live application authorization scope. */
export interface AuthorizationSubjectSnapshot {
  readonly platformRole: string;
  readonly properties?: Readonly<Record<string, string>>;
  /** Active application or tenant scope selected by the session. */
  readonly authorization?: AuthorizationScopeSnapshot | null;
  /**
   * Platform control-plane scope projected only from a live membership in the
   * protected administration organization. In single mode this aliases the
   * active application scope.
   */
  readonly applicationAuthorization?: AuthorizationScopeSnapshot | null;
}

export interface SingleSimpleScopeInput {
  /** Current live `users.role`, retained as the global/platform role. */
  platformRole: string;
  /** Explicit application-role projection. Defaults to platformRole. */
  scopeRole?: string;
  /** Stable application boundary identifier. Default: `application`. */
  scopeId?: string;
  /** Caller-supplied revision when a wider runtime owns revisioning. */
  revision?: string;
}

export type AuthorizationDenialReason =
  | 'authentication-required'
  | 'platform-role'
  | 'scope-required'
  | 'scope-invalid'
  | 'tenant-required'
  | 'scope-role'
  | 'permission'
  | 'property';

export type AuthorizationDecision =
  | {
      readonly allowed: true;
      readonly scope: AuthorizationScopeSnapshot | null;
      readonly requirement: CompiledAccessRequirement;
    }
  | {
      readonly allowed: false;
      readonly scope: AuthorizationScopeSnapshot | null;
      readonly requirement: CompiledAccessRequirement;
      readonly reason: AuthorizationDenialReason;
      readonly error: AuthError;
    };

export interface AuthorizationKernelConfig {
  tenancy: ResolvedAuthTenancyConfig;
  authorization: ResolvedAuthAuthorizationConfig;
  userProperties?: Readonly<Record<string, ResolvedUserPropertyFieldConfig>>;
}

const STRUCTURED_FIELDS = new Set([
  'user',
  'platformRole',
  'tenant',
  'scopeRole',
  'permission',
  'allPermissions',
  'anyPermissions',
  'properties',
]);
const COMPILED_FIELDS = new Set([
  'kind',
  'version',
  'user',
  'tenant',
  'platformRoleGroups',
  'scopeRoleGroups',
  'allPermissions',
  'anyPermissionGroups',
  'propertyGroups',
]);
const PROPERTY_FIELDS = new Set(['equals', 'in', 'not', 'exists']);
const PERMISSION_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*(?::[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*)+$/;
const ROLE_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

/** Validate one canonical namespaced permission key. */
export function validatePermissionKey(key: string): asserts key is PermissionKey {
  if (!isPermissionKey(key)) {
    throw configError(
      `Invalid permission key "${key}". Use a lowercase namespaced key such as "patients:read".`,
    );
  }
}

/** Validate one stable application/scope role-template key. */
export function validateRoleKey(key: string): void {
  if (key.length > 64 || !ROLE_KEY_PATTERN.test(key)) {
    throw configError(
      `Invalid role key "${key}". Use a lowercase stable key such as "member".`,
    );
  }
}

/**
 * Validate the normalized static permission ceiling and role-template graph.
 * This is exported so config loaders and build/Doctor tooling share one rule.
 */
export function validateAuthorizationRegistry(
  config: ResolvedAuthAuthorizationConfig,
): void {
  if (config.mode !== 'simple' && config.mode !== 'advanced') {
    throw configError(`Unsupported authorization mode: "${String(config.mode)}".`);
  }
  if (!isPlainRecord(config.permissions) || !isPlainRecord(config.roles)) {
    throw configError('Authorization permissions and roles must be objects.');
  }
  if (!Number.isSafeInteger(config.registryVersion)
    || config.registryVersion < 1
    || config.registryVersion > 2_147_483_647) {
    throw configError('Authorization registryVersion must be a positive 32-bit integer.');
  }
  if (Object.keys(config.permissions).length > 512 || Object.keys(config.roles).length > 128) {
    throw configError('Authorization permission or role registry exceeds its static limit.');
  }

  for (const [key, permission] of Object.entries(config.permissions)) {
    validatePermissionKey(key);
    if (!isPlainRecord(permission) || permission.key !== key) {
      throw configError(`Authorization permission "${key}" has inconsistent normalized metadata.`);
    }
    if (!isBoundedDisplayText(permission.label, 120)) {
      throw configError(`Authorization label for "${key}" must be a non-empty string.`);
    }
    if (permission.description !== undefined
      && !isBoundedDisplayText(permission.description, 500)) {
      throw configError(`Authorization description for "${key}" is invalid.`);
    }
    if (permission.scope !== 'application' && permission.scope !== 'tenant') {
      throw configError(`Authorization permission "${key}" has an invalid scope.`);
    }
  }

  for (const [key, role] of Object.entries(config.roles)) {
    validateRoleKey(key);
    validateResolvedRoleTemplate(key, role, config.permissions);
  }
}

/** Compile one declaration without inheriting from a parent. */
export function compileAccessRequirement(
  requirement: AccessRequirement,
  options: AccessRequirementCompileOptions = {},
): CompiledAccessRequirement {
  if (requirement === false || requirement === 'optional') return emptyRequirement();
  if (requirement === true || requirement === 'user' || requirement === 'required') {
    return freezeCompiled({ ...mutableEmpty(), user: 'required' });
  }
  if (requirement === 'admin') {
    return freezeCompiled({
      ...mutableEmpty(),
      user: 'required',
      platformRoleGroups: [['admin']],
    });
  }
  if (!isPlainRecord(requirement)) {
    throw configError('Access requirement must be a supported scalar or an object.');
  }
  const structured = requirement as unknown as StructuredAccessRequirement;

  const unknownField = Object.keys(requirement)
    .filter((key) => !STRUCTURED_FIELDS.has(key))
    .sort(compareKeys)[0];
  if (unknownField) {
    throw configError(`Access requirement contains unsupported field "${unknownField}".`);
  }

  if (structured.user !== undefined && structured.user !== 'required'
    && structured.user !== 'optional') {
    throw configError('Access requirement user must be "required" or "optional".');
  }
  if (structured.tenant !== undefined && structured.tenant !== 'required') {
    throw configError('Access requirement tenant must be "required".');
  }
  if (structured.tenant === 'required' && options.tenancy === 'single') {
    throw configError('Tenant access requirements require tenancy mode "multi".');
  }

  const platformRoleGroups = structured.platformRole === undefined
    ? []
    : [normalizeRoleGroup(structured.platformRole, 'platformRole', undefined)];
  const declaredRoles = options.declaredRoles === undefined
    ? undefined
    : new Set(options.declaredRoles);
  const scopeRoleGroups = structured.scopeRole === undefined
    ? []
    : [normalizeRoleGroup(structured.scopeRole, 'scopeRole', declaredRoles)];
  const declaredPermissions = options.declaredPermissions === undefined
    ? undefined
    : new Set(options.declaredPermissions);
  const allPermissions = [
    ...(structured.permission === undefined ? [] : [structured.permission]),
    ...normalizeOptionalStringArray(structured.allPermissions, 'allPermissions'),
  ];
  const normalizedAllPermissions = normalizePermissionList(
    allPermissions,
    'allPermissions',
    declaredPermissions,
  );
  const anyPermissionGroups = structured.anyPermissions === undefined
    ? []
    : [normalizePermissionList(
        normalizeRequiredStringArray(structured.anyPermissions, 'anyPermissions'),
        'anyPermissions',
        declaredPermissions,
      )];
  const propertyGroups = structured.properties === undefined
    ? []
    : [normalizePropertyGroup(structured.properties, options.trustedProperties)];

  const impliedUser = Boolean(
    platformRoleGroups.length
    || structured.tenant === 'required'
    || scopeRoleGroups.length
    || normalizedAllPermissions.length
    || anyPermissionGroups.length
    || propertyGroups.length,
  );

  return freezeCompiled({
    ...mutableEmpty(),
    user: structured.user === 'required' || impliedUser ? 'required' : 'optional',
    tenant: structured.tenant === 'required',
    platformRoleGroups,
    scopeRoleGroups,
    allPermissions: normalizedAllPermissions,
    anyPermissionGroups,
    propertyGroups,
  });
}

/**
 * Compile and monotonically combine parent and child declarations.
 *
 * A child can add constraints but cannot remove authentication, tenant, role,
 * permission, or trusted-property requirements inherited from its parent.
 */
export function mergeAccessRequirements(
  parent: AccessRequirement | CompiledAccessRequirement,
  child: AccessRequirement | CompiledAccessRequirement,
  options: AccessRequirementCompileOptions = {},
): CompiledAccessRequirement {
  const parentCompiled = isCompiledAccessRequirement(parent)
    ? parent
    : compileAccessRequirement(parent, options);
  const childCompiled = isCompiledAccessRequirement(child)
    ? child
    : compileAccessRequirement(child, options);
  validateCompiledRequirement(parentCompiled, options);
  validateCompiledRequirement(childCompiled, options);

  return freezeCompiled({
    ...mutableEmpty(),
    user: parentCompiled.user === 'required' || childCompiled.user === 'required'
      ? 'required'
      : 'optional',
    tenant: parentCompiled.tenant || childCompiled.tenant,
    platformRoleGroups: mergeGroups(
      parentCompiled.platformRoleGroups,
      childCompiled.platformRoleGroups,
    ),
    scopeRoleGroups: mergeGroups(
      parentCompiled.scopeRoleGroups,
      childCompiled.scopeRoleGroups,
    ),
    allPermissions: uniqueSorted([
      ...parentCompiled.allPermissions,
      ...childCompiled.allPermissions,
    ]),
    anyPermissionGroups: mergeGroups(
      parentCompiled.anyPermissionGroups,
      childCompiled.anyPermissionGroups,
    ),
    propertyGroups: mergePropertyGroups(
      parentCompiled.propertyGroups,
      childCompiled.propertyGroups,
    ),
  });
}

export function isCompiledAccessRequirement(
  value: unknown,
): value is CompiledAccessRequirement {
  return isPlainRecord(value)
    && value.kind === 'zero.access-requirement'
    && value.version === 1;
}

/** Pure evaluator/factory bound only to immutable normalized application config. */
export class AuthorizationKernel {
  readonly tenancy: ResolvedAuthTenancyConfig;
  readonly authorization: ResolvedAuthAuthorizationConfig;
  private readonly compileOptions: AccessRequirementCompileOptions;
  private readonly trustedProperties: ReadonlySet<string>;

  constructor(config: AuthorizationKernelConfig | NormalizedAuthBehaviorConfig) {
    if (config.tenancy.mode !== 'single' && config.tenancy.mode !== 'multi') {
      throw configError(`Unsupported tenancy mode: "${String(config.tenancy.mode)}".`);
    }
    validateAuthorizationRegistry(config.authorization);
    this.tenancy = Object.freeze({
      mode: config.tenancy.mode,
      terminology: Object.freeze({ ...config.tenancy.terminology }),
      creation: Object.freeze({ ...config.tenancy.creation }),
    });
    this.authorization = freezeAuthorizationConfig(config.authorization);
    const trustedProperties = Object.entries(config.userProperties ?? {})
      .filter(([, field]) => field.useInPolicies)
      .map(([key]) => key)
      .sort(compareKeys);
    this.trustedProperties = new Set(trustedProperties);
    this.compileOptions = Object.freeze({
      tenancy: config.tenancy.mode,
      declaredPermissions: Object.freeze(
        Object.keys(this.authorization.permissions).sort(compareKeys),
      ),
      declaredRoles: Object.freeze(Object.keys(this.authorization.roles).sort(compareKeys)),
      trustedProperties: Object.freeze(trustedProperties),
    });
  }

  compile(
    requirement: AccessRequirement,
    parent?: AccessRequirement | CompiledAccessRequirement,
  ): CompiledAccessRequirement {
    if (parent === undefined) return compileAccessRequirement(requirement, this.compileOptions);
    return mergeAccessRequirements(parent, requirement, this.compileOptions);
  }

  merge(
    parent: AccessRequirement | CompiledAccessRequirement,
    child: AccessRequirement | CompiledAccessRequirement,
  ): CompiledAccessRequirement {
    return mergeAccessRequirements(parent, child, this.compileOptions);
  }

  /** Whether a server-owned user property is allowed in authorization policy. */
  isPolicyTrustedProperty(key: string): boolean {
    return this.trustedProperties.has(key);
  }

  /**
   * Project today's live global role into the application scope for the exact
   * single/simple compatibility profile.
   */
  synthesizeSingleSimpleScope(input: SingleSimpleScopeInput): AuthorizationScopeSnapshot {
    if (this.tenancy.mode !== 'single' || this.authorization.mode !== 'simple') {
      throw configError('single/simple scope synthesis requires the single/simple profile.');
    }
    assertNonEmptyString(input.platformRole, 'Single/simple platformRole');
    const role = input.scopeRole ?? input.platformRole;
    assertNonEmptyString(role, 'Single/simple scopeRole');
    const expanded = expandAuthorizationRolesForScope(
      this.authorization,
      [role],
      'application',
    );
    const scopeId = input.scopeId ?? 'application';
    assertNonEmptyString(scopeId, 'Single/simple scopeId');
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

  evaluate(
    requirement: AccessRequirement | CompiledAccessRequirement,
    subject: AuthorizationSubjectSnapshot | null,
  ): AuthorizationDecision {
    const compiled = isCompiledAccessRequirement(requirement)
      ? requirement
      : this.compile(requirement);
    validateCompiledRequirement(compiled, this.compileOptions);

    if (compiled.user === 'required' && !subject) {
      return denied(compiled, null, 'authentication-required', true);
    }
    if (!subject) return allowed(compiled, null);
    if (!isNonEmptyString(subject.platformRole)) {
      return denied(compiled, null, 'scope-invalid');
    }
    if (!matchesEveryGroup(subject.platformRole, compiled.platformRoleGroups)) {
      return denied(compiled, subject.authorization ?? null, 'platform-role');
    }
    if (!matchesEveryPropertyGroup(subject.properties ?? {}, compiled.propertyGroups)) {
      return denied(compiled, subject.authorization ?? null, 'property');
    }

    const activeScope = subject.authorization ?? null;
    const suppliedApplicationScope = subject.applicationAuthorization ?? null;
    if (activeScope && !this.isValidScopeSnapshot(activeScope)) {
      return denied(compiled, activeScope, 'scope-invalid');
    }
    if (suppliedApplicationScope
      && suppliedApplicationScope !== activeScope
      && !this.isValidScopeSnapshot(suppliedApplicationScope)) {
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
      this.authorization.permissions[permission]?.scope === 'application'
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
      this.authorization.permissions[permission]?.scope === 'application'
    ));
    const hasTenantPermission = permissionKeys.some((permission) => (
      this.authorization.permissions[permission]?.scope === 'tenant'
    ));
    const decisionScope = !compiled.tenant
      && compiled.scopeRoleGroups.length === 0
      && hasApplicationPermission
      && !hasTenantPermission
      ? applicationScope
      : resultScope;

    return allowed(compiled, decisionScope);
  }

  /** Evaluate and throw the stable AuthError contract when access is denied. */
  authorize(
    requirement: AccessRequirement | CompiledAccessRequirement,
    subject: AuthorizationSubjectSnapshot | null,
  ): AuthorizationScopeSnapshot | null {
    const decision = this.evaluate(requirement, subject);
    if (!decision.allowed) throw decision.error;
    return decision.scope;
  }

  /** Validate a live scope supplied by a future persistence/session adapter. */
  isValidScopeSnapshot(scope: AuthorizationScopeSnapshot): boolean {
    if (scope.tenancy !== this.tenancy.mode || scope.mode !== this.authorization.mode) return false;
    if (scope.scopeKind !== 'application' && scope.scopeKind !== 'tenant') return false;
    if (!isNonEmptyString(scope.scopeId) || !isNonEmptyString(scope.revision)) return false;
    if (scope.tenancy === 'single' && scope.scopeKind !== 'application') return false;
    if (scope.scopeKind === 'tenant') {
      if (scope.tenancy !== 'multi') return false;
      if (!isNonEmptyString(scope.tenantId) || !isNonEmptyString(scope.membershipId)) return false;
      if (scope.scopeId !== scope.tenantId) return false;
    } else if (scope.tenantId !== undefined || scope.membershipId !== undefined
      || (scope.tenancy === 'multi' && scope.scopeId !== 'application')) {
      return false;
    }
    if (!isUniqueStringArray(scope.roles) || !isUniqueStringArray(scope.permissions)) return false;
    if (scope.roles.some((role) => !ROLE_KEY_PATTERN.test(role))) return false;
    if (scope.mode === 'simple' && scope.roles.length !== 1) return false;
    if (scope.allPermissions !== undefined && typeof scope.allPermissions !== 'boolean') return false;
    const declaredPermissions = new Set(Object.keys(this.authorization.permissions));
    if (scope.permissions.some((permission) => (
      !isPermissionKey(permission) || !declaredPermissions.has(permission)
    ))) return false;
    const declaredRoles = new Set(Object.keys(this.authorization.roles));
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
      const templates = scope.roles.map((role) => this.authorization.roles[role]!);
      const expectedAllPermissions = templates.some((template) => template.allPermissions);
      if (Boolean(scope.allPermissions) !== expectedAllPermissions) return false;
      const expectedPermissions = expectedAllPermissions
        ? authorizationPermissionKeysForScope(this.authorization, scope.scopeKind)
        : uniqueSorted(templates.flatMap((template) => template.permissions)
          .filter((permission) => (
            this.authorization.permissions[permission]?.scope === scope.scopeKind
          )));
      if (!sameStringSet(scope.permissions, expectedPermissions)) return false;
    } else if (scope.allPermissions) {
      return false;
    }
    return true;
  }
}

export function createAuthorizationKernel(
  config: AuthorizationKernelConfig | NormalizedAuthBehaviorConfig,
): AuthorizationKernel {
  return new AuthorizationKernel(config);
}

/** Stable permission ceiling for one application or tenant projection. */
export function authorizationPermissionKeysForScope(
  config: ResolvedAuthAuthorizationConfig,
  scopeKind: AuthorizationScopeKind,
): PermissionKey[] {
  return Object.values(config.permissions)
    .filter((permission) => permission.scope === scopeKind)
    .map((permission) => permission.key)
    .sort(compareKeys);
}

/**
 * Expand declared roles inside exactly one authority realm.
 *
 * This scope filter is the hard boundary that keeps a customer-organization
 * owner from inheriting application-control-plane permissions through
 * `allPermissions`. The same role set may be projected into application scope
 * only after the caller proves an active administration-organization session.
 */
export function expandAuthorizationRolesForScope(
  config: ResolvedAuthAuthorizationConfig,
  roles: readonly string[],
  scopeKind: AuthorizationScopeKind,
): Readonly<{
  roles: readonly string[];
  permissions: readonly PermissionKey[];
  allPermissions: boolean;
}> {
  const declaredRoles = uniqueSorted(roles)
    .filter((role) => Object.hasOwn(config.roles, role));
  const templates = declaredRoles.map((role) => config.roles[role]!);
  const allPermissions = templates.some((template) => template.allPermissions);
  const permissions = allPermissions
    ? authorizationPermissionKeysForScope(config, scopeKind)
    : uniqueSorted(templates.flatMap((template) => template.permissions)
      .filter((permission) => config.permissions[permission]?.scope === scopeKind));
  return Object.freeze({
    roles: Object.freeze(declaredRoles),
    permissions: Object.freeze(permissions),
    allPermissions,
  });
}

function freezeAuthorizationConfig(
  config: ResolvedAuthAuthorizationConfig,
): ResolvedAuthAuthorizationConfig {
  const permissions = Object.freeze(Object.fromEntries(
    Object.entries(config.permissions)
      .sort(([left], [right]) => compareKeys(left, right))
      .map(([key, permission]) => [key, Object.freeze({ ...permission })]),
  ));
  const roles = Object.freeze(Object.fromEntries(
    Object.entries(config.roles)
      .sort(([left], [right]) => compareKeys(left, right))
      .map(([key, role]) => [key, Object.freeze({
        ...role,
        permissions: Object.freeze([...role.permissions]),
      })]),
  ));
  return Object.freeze({
    mode: config.mode,
    registryVersion: config.registryVersion,
    permissions,
    roles,
  });
}

function mutableEmpty() {
  return {
    kind: 'zero.access-requirement' as const,
    version: 1 as const,
    user: 'optional' as 'optional' | 'required',
    tenant: false,
    platformRoleGroups: [] as string[][],
    scopeRoleGroups: [] as string[][],
    allPermissions: [] as string[],
    anyPermissionGroups: [] as string[][],
    propertyGroups: [] as Record<string, TrustedPropertyRequirement>[],
  };
}

function emptyRequirement(): CompiledAccessRequirement {
  return freezeCompiled(mutableEmpty());
}

function freezeCompiled(value: ReturnType<typeof mutableEmpty>): CompiledAccessRequirement {
  return Object.freeze({
    ...value,
    platformRoleGroups: freezeGroups(value.platformRoleGroups),
    scopeRoleGroups: freezeGroups(value.scopeRoleGroups),
    allPermissions: Object.freeze(uniqueSorted(value.allPermissions)),
    anyPermissionGroups: freezeGroups(value.anyPermissionGroups),
    propertyGroups: Object.freeze(value.propertyGroups.map((group) => Object.freeze(
      Object.fromEntries(Object.entries(group).map(
        ([key, requirement]) => [key, clonePropertyRequirement(requirement)],
      )),
    ))),
  });
}

function freezeGroups(groups: readonly (readonly string[])[]): readonly (readonly string[])[] {
  return Object.freeze(groups.map((group) => Object.freeze(uniqueSorted(group))));
}

function validateCompiledRequirement(
  requirement: CompiledAccessRequirement,
  options: AccessRequirementCompileOptions,
): void {
  const unknownField = Object.keys(requirement)
    .filter((key) => !COMPILED_FIELDS.has(key))
    .sort(compareKeys)[0];
  if (unknownField) {
    throw configError(
      `Compiled access requirement contains unsupported field "${unknownField}".`,
    );
  }
  if (requirement.user !== 'optional' && requirement.user !== 'required') {
    throw configError('Compiled access requirement has an invalid user mode.');
  }
  if (typeof requirement.tenant !== 'boolean') {
    throw configError('Compiled access requirement has an invalid tenant flag.');
  }
  if (requirement.tenant && options.tenancy === 'single') {
    throw configError('Tenant access requirements require tenancy mode "multi".');
  }
  if (!Array.isArray(requirement.platformRoleGroups)
    || !Array.isArray(requirement.scopeRoleGroups)
    || !Array.isArray(requirement.allPermissions)
    || !Array.isArray(requirement.anyPermissionGroups)
    || !Array.isArray(requirement.propertyGroups)) {
    throw configError('Compiled access requirement has an invalid serialized shape.');
  }

  const impliesUser = requirement.tenant
    || requirement.platformRoleGroups.length > 0
    || requirement.scopeRoleGroups.length > 0
    || requirement.allPermissions.length > 0
    || requirement.anyPermissionGroups.length > 0
    || requirement.propertyGroups.length > 0;
  if (impliesUser && requirement.user !== 'required') {
    throw configError(
      'Compiled access requirement constraints require an authenticated user.',
    );
  }

  const declaredRoles = options.declaredRoles === undefined
    ? undefined
    : new Set(options.declaredRoles);
  for (const group of requirement.platformRoleGroups) {
    if (!Array.isArray(group)) {
      throw configError(
        'Compiled access requirement platformRoleGroups must contain role arrays.',
      );
    }
    normalizeRoleGroup(group, 'platformRole', undefined);
  }
  for (const group of requirement.scopeRoleGroups) {
    if (!Array.isArray(group)) {
      throw configError(
        'Compiled access requirement scopeRoleGroups must contain role arrays.',
      );
    }
    normalizeRoleGroup(group, 'scopeRole', declaredRoles);
  }
  const declaredPermissions = options.declaredPermissions === undefined
    ? undefined
    : new Set(options.declaredPermissions);
  normalizePermissionList(
    normalizeRequiredOrEmptyStringArray(requirement.allPermissions, 'allPermissions'),
    'allPermissions',
    declaredPermissions,
  );
  for (const group of requirement.anyPermissionGroups) {
    normalizePermissionList(
      normalizeRequiredStringArray(group, 'anyPermissions'),
      'anyPermissions',
      declaredPermissions,
    );
  }
  for (const group of requirement.propertyGroups) {
    normalizePropertyGroup(group, options.trustedProperties);
  }
}

function mergeGroups(
  parent: readonly (readonly string[])[],
  child: readonly (readonly string[])[],
): string[][] {
  const result: string[][] = [];
  const seen = new Set<string>();
  for (const group of [...parent, ...child]) {
    const normalized = uniqueSorted(group);
    const key = JSON.stringify(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function mergePropertyGroups(
  parent: readonly Readonly<Record<string, TrustedPropertyRequirement>>[],
  child: readonly Readonly<Record<string, TrustedPropertyRequirement>>[],
): Record<string, TrustedPropertyRequirement>[] {
  const result: Record<string, TrustedPropertyRequirement>[] = [];
  const seen = new Set<string>();
  for (const group of [...parent, ...child]) {
    const normalized = Object.fromEntries(
      Object.entries(group).sort(([a], [b]) => compareKeys(a, b)),
    );
    const key = JSON.stringify(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function normalizeRoleGroup(
  value: string | readonly string[],
  field: string,
  declaredRoles: ReadonlySet<string> | undefined,
): string[] {
  const roles = typeof value === 'string'
    ? [value]
    : normalizeRequiredStringArray(value, field);
  const normalized = uniqueSorted(roles);
  for (const role of normalized) {
    assertNonEmptyString(role, `Access requirement ${field}`);
    if (field === 'scopeRole' && !ROLE_KEY_PATTERN.test(role)) {
      throw configError(`Invalid scope role key "${role}".`);
    }
    // `undefined` means the transport-neutral compiler has no application
    // registry to validate against. A configured kernel always supplies its
    // registry, including an intentionally empty one; in that case no scoped
    // role requirement is valid. This keeps an unmapped legacy platform role
    // from becoming an implicit application role in single/simple mode.
    if (declaredRoles && !declaredRoles.has(role)) {
      throw configError(`Access requirement references undeclared scope role "${role}".`);
    }
  }
  return normalized;
}

function validateResolvedRoleTemplate(
  key: string,
  role: ResolvedAuthRoleTemplateConfig,
  permissions: Readonly<Record<string, unknown>>,
): void {
  if (!isPlainRecord(role) || role.key !== key) {
    throw configError(`Authorization role "${key}" has inconsistent normalized metadata.`);
  }
  if (!isBoundedDisplayText(role.label, 120)) {
    throw configError(`Authorization label for "${key}" must be a non-empty string.`);
  }
  if (role.description !== undefined && !isBoundedDisplayText(role.description, 500)) {
    throw configError(`Authorization description for "${key}" is invalid.`);
  }
  if (typeof role.allPermissions !== 'boolean' || typeof role.system !== 'boolean') {
    throw configError(`Authorization role "${key}" has invalid boolean metadata.`);
  }
  if (!isUniqueStringArray(role.permissions)) {
    throw configError(`Authorization role "${key}" permissions must be unique strings.`);
  }
  if (!sameStringArray(role.permissions, uniqueSorted(role.permissions))) {
    throw configError(`Authorization role "${key}" permissions must be sorted deterministically.`);
  }
  if (role.allPermissions && role.permissions.length > 0) {
    throw configError(
      `Authorization role "${key}" cannot combine allPermissions with explicit permissions.`,
    );
  }
  for (const permission of role.permissions) {
    validatePermissionKey(permission);
    if (!Object.hasOwn(permissions, permission)) {
      throw configError(
        `Authorization role "${key}" references undeclared permission "${permission}".`,
      );
    }
  }
}

function normalizeOptionalStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  return normalizeRequiredStringArray(value, field);
}

function normalizeRequiredOrEmptyStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw configError(`Access requirement ${field} must be a string array.`);
  }
  return [...value];
}

function normalizeRequiredStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== 'string')) {
    throw configError(`Access requirement ${field} must be a non-empty string array.`);
  }
  return [...value];
}

function normalizePermissionList(
  permissions: readonly string[],
  field: string,
  declaredPermissions: ReadonlySet<string> | undefined,
): string[] {
  const normalized = uniqueSorted(permissions);
  for (const permission of normalized) {
    if (!isPermissionKey(permission)) {
      throw configError(
        `Invalid permission key "${permission}" in ${field}; use a lowercase namespaced key.`,
      );
    }
    if (declaredPermissions && !declaredPermissions.has(permission)) {
      throw configError(`Access requirement references undeclared permission "${permission}".`);
    }
  }
  return normalized;
}

function normalizePropertyGroup(
  properties: Readonly<Record<string, TrustedPropertyRequirement>>,
  trustedProperties: readonly string[] | undefined,
): Record<string, TrustedPropertyRequirement> {
  if (!isPlainRecord(properties)) {
    throw configError('Access requirement properties must be an object.');
  }
  const trusted = trustedProperties === undefined ? undefined : new Set(trustedProperties);
  const normalized: Record<string, TrustedPropertyRequirement> = {};
  for (const [key, requirement] of Object.entries(properties).sort(
    ([a], [b]) => compareKeys(a, b),
  )) {
    assertNonEmptyString(key, 'Trusted property key');
    if (trusted && !trusted.has(key)) {
      throw configError(`Access requirement property "${key}" is not policy-trusted.`);
    }
    normalized[key] = normalizePropertyRequirement(requirement, key);
  }
  return normalized;
}

function normalizePropertyRequirement(value: unknown, key: string): TrustedPropertyRequirement {
  if (isPropertyScalar(value)) return value;
  if (Array.isArray(value)) {
    if (value.length === 0 || !value.every(isPropertyScalar)) {
      throw configError(`Access requirement property "${key}" has an invalid value list.`);
    }
    return Object.freeze([...value]);
  }
  if (!isPlainRecord(value)) {
    throw configError(`Access requirement property "${key}" has an invalid matcher.`);
  }
  const unknown = Object.keys(value)
    .filter((field) => !PROPERTY_FIELDS.has(field))
    .sort(compareKeys)[0];
  if (unknown) {
    throw configError(`Access requirement property "${key}" has unsupported field "${unknown}".`);
  }
  if (Object.keys(value).length === 0) {
    throw configError(`Access requirement property "${key}" matcher may not be empty.`);
  }
  if (value.exists !== undefined && typeof value.exists !== 'boolean') {
    throw configError(`Access requirement property "${key}" exists must be a boolean.`);
  }
  if (value.equals !== undefined && !isPropertyScalar(value.equals)) {
    throw configError(`Access requirement property "${key}" equals must be a scalar.`);
  }
  if (value.in !== undefined && (
    !Array.isArray(value.in) || value.in.length === 0 || !value.in.every(isPropertyScalar)
  )) {
    throw configError(`Access requirement property "${key}" in must be a non-empty scalar array.`);
  }
  if (value.not !== undefined && !isPropertyScalar(value.not) && !(
    Array.isArray(value.not) && value.not.length > 0 && value.not.every(isPropertyScalar)
  )) {
    throw configError(`Access requirement property "${key}" not must be a scalar or scalar array.`);
  }
  return Object.freeze({
    ...(value.equals !== undefined ? { equals: value.equals } : {}),
    ...(value.in !== undefined ? { in: Object.freeze([...value.in]) } : {}),
    ...(value.not !== undefined
      ? { not: Array.isArray(value.not) ? Object.freeze([...value.not]) : value.not }
      : {}),
    ...(value.exists !== undefined ? { exists: value.exists } : {}),
  });
}

function clonePropertyRequirement(
  requirement: TrustedPropertyRequirement,
): TrustedPropertyRequirement {
  if (isPropertyScalar(requirement)) return requirement;
  if (isPropertyScalarArray(requirement)) return Object.freeze([...requirement]);
  return Object.freeze({
    ...(requirement.equals !== undefined ? { equals: requirement.equals } : {}),
    ...(requirement.in !== undefined ? { in: Object.freeze([...requirement.in]) } : {}),
    ...(requirement.not !== undefined
      ? {
          not: isPropertyScalarArray(requirement.not)
            ? Object.freeze([...requirement.not])
            : requirement.not,
        }
      : {}),
    ...(requirement.exists !== undefined ? { exists: requirement.exists } : {}),
  });
}

function matchesEveryGroup(value: string, groups: readonly (readonly string[])[]): boolean {
  return groups.every((group) => group.includes(value));
}

function matchesRoleGroups(
  roles: readonly string[],
  groups: readonly (readonly string[])[],
): boolean {
  const available = new Set(roles);
  return groups.every((group) => group.some((role) => available.has(role)));
}

function matchesEveryPropertyGroup(
  properties: Readonly<Record<string, string>>,
  groups: readonly Readonly<Record<string, TrustedPropertyRequirement>>[],
): boolean {
  return groups.every((group) => Object.entries(group).every(
    ([key, requirement]) => matchesPropertyRequirement(properties[key] ?? null, requirement),
  ));
}

function matchesPropertyRequirement(
  value: string | null,
  requirement: TrustedPropertyRequirement,
): boolean {
  if (isPropertyScalarArray(requirement)) {
    return value !== null && requirement.map(String).includes(value);
  }
  if (isPropertyScalar(requirement)) return value === String(requirement);
  if (requirement.exists !== undefined && (value !== null) !== requirement.exists) return false;
  if (requirement.equals !== undefined && value !== String(requirement.equals)) return false;
  if (requirement.in !== undefined && (
    value === null || !requirement.in.map(String).includes(value)
  )) return false;
  if (requirement.not !== undefined) {
    const deniedValues = Array.isArray(requirement.not)
      ? requirement.not.map(String)
      : [String(requirement.not)];
    if (value !== null && deniedValues.includes(value)) return false;
  }
  return true;
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
    roles: Object.freeze(uniqueSorted(scope.roles)),
    permissions: Object.freeze(uniqueSorted(scope.permissions)),
  });
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareKeys);
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = uniqueSorted(left);
  const normalizedRight = uniqueSorted(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isUniqueStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value)
    && value.every(isNonEmptyString)
    && new Set(value).size === value.length;
}

function isPermissionKey(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && PERMISSION_KEY_PATTERN.test(value);
}

function isPropertyScalar(value: unknown): value is TrustedPropertyScalar {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isPropertyScalarArray(value: unknown): value is readonly TrustedPropertyScalar[] {
  return Array.isArray(value) && value.every(isPropertyScalar);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (!isNonEmptyString(value)) throw configError(`${label} must be a non-empty string.`);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function isBoundedDisplayText(value: unknown, maxLength: number): value is string {
  return isNonEmptyString(value) && value.length <= maxLength;
}

function configError(message: string): Error {
  return new Error(`[auth] ${message}`);
}
