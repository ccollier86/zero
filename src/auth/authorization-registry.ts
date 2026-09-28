import type {
  AuthAuthorizationMode,
  AuthPermissionConfig,
  AuthRoleTemplateConfig,
  AuthTenantTerminologyConfig,
  AuthTenancyMode,
} from './types';

/**
 * Framework-owned permissions that Zero's packaged tenant control plane uses.
 *
 * The namespace before `:` identifies the protected framework surface. Apps
 * may reference these keys from their own role templates, but cannot redefine
 * their metadata or semantics.
 */
export const FRAMEWORK_APPLICATION_AUTHORIZATION_PERMISSIONS = Object.freeze({
  'application.roles:read': Object.freeze({
    label: 'View application access',
    description: 'View application role templates and user assignments.',
  }),
  'application.roles:manage': Object.freeze({
    label: 'Manage application access',
    description: 'Change assignable application role assignments.',
  }),
} satisfies Record<string, AuthPermissionConfig>);

export const FRAMEWORK_TENANT_AUTHORIZATION_PERMISSIONS = Object.freeze({
  'tenant:read': Object.freeze({
    label: 'View organization',
    description: 'View the active organization and its safe settings.',
  }),
  'tenant:manage': Object.freeze({
    label: 'Manage organization',
    description: 'Change the active organization settings.',
  }),
  'tenant.members:read': Object.freeze({
    label: 'View members',
    description: 'View safe member profiles in the active organization.',
  }),
  'tenant.members:manage': Object.freeze({
    label: 'Manage members',
    description: 'Add, suspend, reactivate, and remove organization members.',
  }),
  'tenant.roles:read': Object.freeze({
    label: 'View roles',
    description: 'View configured organization role templates and assignments.',
  }),
  'tenant.roles:manage': Object.freeze({
    label: 'Manage roles',
    description: 'Change assignable organization role assignments.',
  }),
  'tenant.invitations:read': Object.freeze({
    label: 'View invitations',
    description: 'View invitations issued by the active organization.',
  }),
  'tenant.invitations:manage': Object.freeze({
    label: 'Manage invitations',
    description: 'Issue and revoke invitations for the active organization.',
  }),
  'tenant.domains:read': Object.freeze({
    label: 'View organization domains',
    description: 'View safe domain-claim state for the active organization.',
  }),
  'tenant.domains:verify': Object.freeze({
    label: 'Verify organization domains',
    description: 'Create and verify exact organization domain claims.',
  }),
  'tenant.domains:release': Object.freeze({
    label: 'Release organization domains',
    description: 'Release an exact domain claim into the protected quarantine lifecycle.',
  }),
  'tenant.onboarding:manage': Object.freeze({
    label: 'Manage onboarding',
    description: 'Configure bounded organization onboarding behavior.',
  }),
  'tenant.join-requests:review': Object.freeze({
    label: 'Review join requests',
    description: 'Approve or deny organization join requests.',
  }),
  'tenant.audit:read': Object.freeze({
    label: 'View organization security audit',
    description: 'View and export control-plane audit events for the active organization.',
  }),
  'workflows:manage': Object.freeze({
    label: 'Manage workflows',
    description: 'View and control every workflow in the active organization.',
  }),
  'notifications:manage': Object.freeze({
    label: 'Manage notifications',
    description: 'Send, audit, and remove notifications in the active organization.',
  }),
  'rooms:manage': Object.freeze({
    label: 'Manage rooms',
    description: 'Remove any room in the active organization.',
  }),
} satisfies Record<string, AuthPermissionConfig>);

const TENANT_MEMBER_PERMISSIONS = Object.freeze([
  'tenant:read',
  'tenant.members:read',
  'tenant.roles:read',
]);

const TENANT_MANAGER_PERMISSIONS = Object.freeze([
  ...TENANT_MEMBER_PERMISSIONS,
  'tenant.members:manage',
  'tenant.invitations:read',
  'tenant.invitations:manage',
  'tenant.domains:read',
  'tenant.domains:verify',
  'tenant.onboarding:manage',
  'tenant.join-requests:review',
]);

/**
 * Stable framework role templates. `owner` is the only protected system role;
 * assigning or removing it requires the dedicated ownership lifecycle rather
 * than the generic role-assignment API.
 */
export const FRAMEWORK_APPLICATION_AUTHORIZATION_ROLES = Object.freeze({
  'access-manager': Object.freeze({
    label: 'Access manager',
    description: 'Manages assignable application access without ownership authority.',
    permissions: Object.freeze([
      'application.roles:read',
      'application.roles:manage',
    ]),
  }),
  owner: Object.freeze({
    label: 'Owner',
    description: 'Protected application owner with every declared permission.',
    allPermissions: true,
    system: true,
  }),
} satisfies Record<string, AuthRoleTemplateConfig>);

export const FRAMEWORK_TENANT_AUTHORIZATION_ROLES = Object.freeze({
  member: Object.freeze({
    label: 'Member',
    description: 'Standard organization membership.',
    permissions: TENANT_MEMBER_PERMISSIONS,
  }),
  manager: Object.freeze({
    label: 'Manager',
    description: 'Manages members and ordinary onboarding without ownership authority.',
    permissions: TENANT_MANAGER_PERMISSIONS,
  }),
  owner: Object.freeze({
    label: 'Owner',
    description: 'Protected organization owner with every declared permission.',
    allPermissions: true,
    system: true,
  }),
} satisfies Record<string, AuthRoleTemplateConfig>);

/** Merge the immutable framework ceiling with app declarations. */
export function mergeAuthorizationPermissionConfigs(
  application: Record<string, AuthPermissionConfig> | undefined,
  tenancy: AuthTenancyMode,
  mode: AuthAuthorizationMode,
  terminology?: AuthTenantTerminologyConfig,
): Record<string, AuthPermissionConfig> {
  const framework = frameworkPermissions(tenancy, mode, terminology);
  const result: Record<string, AuthPermissionConfig> = {
    ...framework,
  };
  for (const [key, definition] of Object.entries(application ?? {})) {
    if (Object.hasOwn(framework, key)) {
      throw new Error(
        `[auth] Authorization permission "${key}" is framework-owned and cannot be redefined.`,
      );
    }
    result[key] = definition;
  }
  return result;
}

/**
 * Merge framework roles with app templates.
 *
 * For compatibility, apps may repeat a framework role to customize only its
 * label/description or to restate the exact protected semantics. Any attempt
 * to widen or narrow the built-in permissions/system flags is rejected.
 */
export function mergeAuthorizationRoleConfigs(
  application: Record<string, AuthRoleTemplateConfig> | undefined,
  tenancy: AuthTenancyMode,
  mode: AuthAuthorizationMode,
  terminology?: AuthTenantTerminologyConfig,
): Record<string, AuthRoleTemplateConfig> {
  const framework = frameworkRoles(tenancy, mode, terminology);
  const result: Record<string, AuthRoleTemplateConfig> = {
    ...framework,
  };
  for (const [key, definition] of Object.entries(application ?? {})) {
    const frameworkRole = framework[key];
    if (!frameworkRole) {
      result[key] = definition;
      continue;
    }
    if (frameworkRole.system) {
      assertCompatibleFrameworkRole(key, frameworkRole, definition);
    }
    result[key] = {
      ...frameworkRole,
      ...definition,
    };
  }
  return result;
}

function frameworkPermissions(
  tenancy: AuthTenancyMode,
  mode: AuthAuthorizationMode,
  terminology?: AuthTenantTerminologyConfig,
): Readonly<Record<string, AuthPermissionConfig>> {
  if (tenancy === 'multi') {
    return localizeFrameworkDefinitions(
      FRAMEWORK_TENANT_AUTHORIZATION_PERMISSIONS,
      terminology,
    );
  }
  return mode === 'advanced'
    ? FRAMEWORK_APPLICATION_AUTHORIZATION_PERMISSIONS
    : Object.freeze({});
}

function frameworkRoles(
  tenancy: AuthTenancyMode,
  mode: AuthAuthorizationMode,
  terminology?: AuthTenantTerminologyConfig,
): Readonly<Record<string, AuthRoleTemplateConfig>> {
  if (tenancy === 'multi') {
    return localizeFrameworkDefinitions(
      FRAMEWORK_TENANT_AUTHORIZATION_ROLES,
      terminology,
    );
  }
  return mode === 'advanced'
    ? FRAMEWORK_APPLICATION_AUTHORIZATION_ROLES
    : Object.freeze({});
}

function localizeFrameworkDefinitions<
  T extends Record<string, AuthPermissionConfig | AuthRoleTemplateConfig>,
>(definitions: T, terminology?: AuthTenantTerminologyConfig): T {
  const singular = terminology?.singular ?? 'organization';
  const plural = terminology?.plural ?? 'organizations';
  if (singular === 'organization' && plural === 'organizations') return definitions;

  return Object.freeze(Object.fromEntries(
    Object.entries(definitions).map(([key, definition]) => [
      key,
      Object.freeze({
        ...definition,
        ...(definition.label
          ? { label: localizeTenantText(definition.label, singular, plural) }
          : {}),
        ...(definition.description
          ? { description: localizeTenantText(definition.description, singular, plural) }
          : {}),
      }),
    ]),
  )) as T;
}

function localizeTenantText(text: string, singular: string, plural: string): string {
  return text.replace(/organizations|organization/g, (match) =>
    match === 'organizations' ? plural : singular);
}

function assertCompatibleFrameworkRole(
  key: string,
  framework: AuthRoleTemplateConfig,
  application: AuthRoleTemplateConfig,
): void {
  if (application.permissions !== undefined
    && !sameStrings(application.permissions, framework.permissions ?? [])) {
    throw frameworkRoleOverrideError(key);
  }
  if (application.allPermissions !== undefined
    && application.allPermissions !== (framework.allPermissions ?? false)) {
    throw frameworkRoleOverrideError(key);
  }
  if (application.system !== undefined
    && application.system !== (framework.system ?? false)) {
    throw frameworkRoleOverrideError(key);
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  const normalize = (values: readonly string[]) => [...new Set(values)].sort(compareKeys);
  const a = normalize(left);
  const b = normalize(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function frameworkRoleOverrideError(key: string): Error {
  return new Error(
    `[auth] Authorization role "${key}" is framework-owned and its permissions/system semantics cannot be overridden.`,
  );
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
