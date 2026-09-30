import type { PermissionKey } from './types';
import type {
  AccessRequirement,
  AccessRequirementCompileOptions,
  AuthorizationCredentialKind,
  CompiledAccessRequirement,
  StructuredAccessRequirement,
  TrustedPropertyRequirement,
} from './authorization-policy-types';
import {
  cloneTrustedPropertyRequirement,
  normalizeTrustedPropertyGroup,
} from './authorization-property-policy';
import {
  isAuthorizationPermissionKey,
  matchesAuthorizationRoleKeyPattern,
} from './authorization-registry-validation';
import {
  assertNonEmptyAuthorizationString,
  authorizationConfigError,
  compareAuthorizationKeys,
  isPlainAuthorizationRecord,
  uniqueSortedAuthorizationValues,
} from './authorization-kernel-utils';

const STRUCTURED_FIELDS = new Set([
  'user',
  'credentials',
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
  'credentialKinds',
  'tenant',
  'platformRoleGroups',
  'scopeRoleGroups',
  'allPermissions',
  'anyPermissionGroups',
  'propertyGroups',
]);

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
  if (!isPlainAuthorizationRecord(requirement)) {
    throw authorizationConfigError('Access requirement must be a supported scalar or an object.');
  }
  const structured = requirement as unknown as StructuredAccessRequirement;

  const unknownField = Object.keys(requirement)
    .filter((key) => !STRUCTURED_FIELDS.has(key))
    .sort(compareAuthorizationKeys)[0];
  if (unknownField) {
    throw authorizationConfigError(
      `Access requirement contains unsupported field "${unknownField}".`,
    );
  }

  if (structured.user !== undefined
    && structured.user !== 'required'
    && structured.user !== 'optional') {
    throw authorizationConfigError(
      'Access requirement user must be "required" or "optional".',
    );
  }
  if (structured.tenant !== undefined && structured.tenant !== 'required') {
    throw authorizationConfigError('Access requirement tenant must be "required".');
  }
  if (structured.tenant === 'required' && options.tenancy === 'single') {
    throw authorizationConfigError(
      'Tenant access requirements require tenancy mode "multi".',
    );
  }

  const credentialKinds = structured.credentials === undefined
    ? undefined
    : normalizeCredentialKinds(structured.credentials, 'credentials');

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
    : [normalizeTrustedPropertyGroup(structured.properties, options.trustedProperties)];

  const authorityImpliesUser = Boolean(
    platformRoleGroups.length
    || structured.tenant === 'required'
    || scopeRoleGroups.length
    || normalizedAllPermissions.length
    || anyPermissionGroups.length
    || propertyGroups.length,
  );
  const credentialImpliesUser = credentialKinds !== undefined
    && structured.user !== 'optional';

  return freezeCompiled({
    ...mutableEmpty(),
    user: structured.user === 'required' || authorityImpliesUser || credentialImpliesUser
      ? 'required'
      : 'optional',
    credentialKinds,
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
    credentialKinds: mergeCredentialKinds(
      credentialConstraint(parentCompiled),
      credentialConstraint(childCompiled),
    ),
    tenant: parentCompiled.tenant || childCompiled.tenant,
    platformRoleGroups: mergeGroups(
      parentCompiled.platformRoleGroups,
      childCompiled.platformRoleGroups,
    ),
    scopeRoleGroups: mergeGroups(
      parentCompiled.scopeRoleGroups,
      childCompiled.scopeRoleGroups,
    ),
    allPermissions: uniqueSortedAuthorizationValues([
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
  return isPlainAuthorizationRecord(value)
    && value.kind === 'zero.access-requirement'
    && value.version === 1;
}

/** Validate serialized compiled policy received across a framework boundary. */
export function validateCompiledRequirement(
  requirement: CompiledAccessRequirement,
  options: AccessRequirementCompileOptions,
): void {
  const unknownField = Object.keys(requirement)
    .filter((key) => !COMPILED_FIELDS.has(key))
    .sort(compareAuthorizationKeys)[0];
  if (unknownField) {
    throw authorizationConfigError(
      `Compiled access requirement contains unsupported field "${unknownField}".`,
    );
  }
  if (requirement.user !== 'optional' && requirement.user !== 'required') {
    throw authorizationConfigError('Compiled access requirement has an invalid user mode.');
  }
  if (requirement.credentialKinds !== undefined) {
    normalizeCredentialKinds(requirement.credentialKinds, 'credentialKinds');
  }
  if (typeof requirement.tenant !== 'boolean') {
    throw authorizationConfigError('Compiled access requirement has an invalid tenant flag.');
  }
  if (requirement.tenant && options.tenancy === 'single') {
    throw authorizationConfigError(
      'Tenant access requirements require tenancy mode "multi".',
    );
  }
  if (!Array.isArray(requirement.platformRoleGroups)
    || !Array.isArray(requirement.scopeRoleGroups)
    || !Array.isArray(requirement.allPermissions)
    || !Array.isArray(requirement.anyPermissionGroups)
    || !Array.isArray(requirement.propertyGroups)) {
    throw authorizationConfigError(
      'Compiled access requirement has an invalid serialized shape.',
    );
  }

  const impliesUser = requirement.tenant
    || requirement.platformRoleGroups.length > 0
    || requirement.scopeRoleGroups.length > 0
    || requirement.allPermissions.length > 0
    || requirement.anyPermissionGroups.length > 0
    || requirement.propertyGroups.length > 0;
  if (impliesUser && requirement.user !== 'required') {
    throw authorizationConfigError(
      'Compiled access requirement constraints require an authenticated user.',
    );
  }

  const declaredRoles = options.declaredRoles === undefined
    ? undefined
    : new Set(options.declaredRoles);
  for (const group of requirement.platformRoleGroups) {
    if (!Array.isArray(group)) {
      throw authorizationConfigError(
        'Compiled access requirement platformRoleGroups must contain role arrays.',
      );
    }
    normalizeRoleGroup(group, 'platformRole', undefined);
  }
  for (const group of requirement.scopeRoleGroups) {
    if (!Array.isArray(group)) {
      throw authorizationConfigError(
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
    normalizeTrustedPropertyGroup(group, options.trustedProperties);
  }
}

function mutableEmpty() {
  return {
    kind: 'zero.access-requirement' as const,
    version: 1 as const,
    user: 'optional' as 'optional' | 'required',
    credentialKinds: undefined as AuthorizationCredentialKind[] | undefined,
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
  const { credentialKinds, ...rest } = value;
  return Object.freeze({
    ...rest,
    ...(credentialKinds === undefined
      ? {}
      : { credentialKinds: Object.freeze([...credentialKinds]) }),
    platformRoleGroups: freezeGroups(value.platformRoleGroups),
    scopeRoleGroups: freezeGroups(value.scopeRoleGroups),
    allPermissions: Object.freeze(uniqueSortedAuthorizationValues(value.allPermissions)),
    anyPermissionGroups: freezeGroups(value.anyPermissionGroups),
    propertyGroups: Object.freeze(value.propertyGroups.map((group) => Object.freeze(
      Object.fromEntries(Object.entries(group).map(
        ([key, requirement]) => [key, cloneTrustedPropertyRequirement(requirement)],
      )),
    ))),
  });
}

function normalizeCredentialKinds(
  value: unknown,
  field: string,
): AuthorizationCredentialKind[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw authorizationConfigError(
      `Access requirement ${field} must be a non-empty credential-kind array.`,
    );
  }
  const normalized = uniqueSortedAuthorizationValues(value as readonly string[]);
  for (const kind of normalized) {
    if (kind !== 'session' && kind !== 'api-key') {
      throw authorizationConfigError(
        `Access requirement ${field} contains unsupported credential kind "${String(kind)}".`,
      );
    }
  }
  return normalized as AuthorizationCredentialKind[];
}

function mergeCredentialKinds(
  parent: readonly AuthorizationCredentialKind[] | undefined,
  child: readonly AuthorizationCredentialKind[] | undefined,
): AuthorizationCredentialKind[] | undefined {
  if (parent === undefined) return child === undefined ? undefined : [...child];
  if (child === undefined) return [...parent];
  const childKinds = new Set(child);
  const intersection = parent.filter((kind) => childKinds.has(kind));
  if (intersection.length === 0) {
    throw authorizationConfigError(
      'Inherited and child access requirements allow no common credential kind.',
    );
  }
  return uniqueSortedAuthorizationValues(intersection) as AuthorizationCredentialKind[];
}

/**
 * Omitted credentials are unconstrained only for a genuinely anonymous,
 * optional policy branch. Once a branch requires a user (directly or through
 * an authority constraint), the legacy omission is the session-only default.
 * Materializing that default before an inheritance intersection prevents an
 * API-key leaf from widening an established authenticated router.
 */
function credentialConstraint(
  requirement: CompiledAccessRequirement,
): readonly AuthorizationCredentialKind[] | undefined {
  if (requirement.credentialKinds !== undefined) {
    return requirement.credentialKinds;
  }
  return requirement.user === 'required' ? ['session'] : undefined;
}

function freezeGroups(
  groups: readonly (readonly string[])[],
): readonly (readonly string[])[] {
  return Object.freeze(groups.map(
    (group) => Object.freeze(uniqueSortedAuthorizationValues(group)),
  ));
}

function mergeGroups(
  parent: readonly (readonly string[])[],
  child: readonly (readonly string[])[],
): string[][] {
  const result: string[][] = [];
  const seen = new Set<string>();
  for (const group of [...parent, ...child]) {
    const normalized = uniqueSortedAuthorizationValues(group);
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
      Object.entries(group).sort(([a], [b]) => compareAuthorizationKeys(a, b)),
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
  const normalized = uniqueSortedAuthorizationValues(roles);
  for (const role of normalized) {
    assertNonEmptyAuthorizationString(role, `Access requirement ${field}`);
    if (field === 'scopeRole' && !matchesAuthorizationRoleKeyPattern(role)) {
      throw authorizationConfigError(`Invalid scope role key "${role}".`);
    }
    // `undefined` means the transport-neutral compiler has no application
    // registry to validate against. A configured kernel always supplies its
    // registry, including an intentionally empty one; in that case no scoped
    // role requirement is valid. This keeps an unmapped legacy platform role
    // from becoming an implicit application role in single/simple mode.
    if (declaredRoles && !declaredRoles.has(role)) {
      throw authorizationConfigError(
        `Access requirement references undeclared scope role "${role}".`,
      );
    }
  }
  return normalized;
}

function normalizeOptionalStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  return normalizeRequiredStringArray(value, field);
}

function normalizeRequiredOrEmptyStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw authorizationConfigError(
      `Access requirement ${field} must be a string array.`,
    );
  }
  return [...value];
}

function normalizeRequiredStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)
    || value.length === 0
    || value.some((entry) => typeof entry !== 'string')) {
    throw authorizationConfigError(
      `Access requirement ${field} must be a non-empty string array.`,
    );
  }
  return [...value];
}

function normalizePermissionList(
  permissions: readonly string[],
  field: string,
  declaredPermissions: ReadonlySet<string> | undefined,
): PermissionKey[] {
  const normalized = uniqueSortedAuthorizationValues(permissions);
  for (const permission of normalized) {
    if (!isAuthorizationPermissionKey(permission)) {
      throw authorizationConfigError(
        `Invalid permission key "${permission}" in ${field}; use a lowercase namespaced key.`,
      );
    }
    if (declaredPermissions && !declaredPermissions.has(permission)) {
      throw authorizationConfigError(
        `Access requirement references undeclared permission "${permission}".`,
      );
    }
  }
  return normalized;
}
