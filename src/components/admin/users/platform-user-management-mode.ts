/**
 * Resolves the packaged management experience without coupling the decision to
 * rendering. Controlled identity lists intentionally retain the established
 * UserManagement behavior in every auth profile.
 */

export type PlatformUserManagementMode =
  | 'identity'
  | 'single-advanced'
  | 'platform'
  | 'organization'
  | 'loading'
  | 'unavailable';

export interface PlatformManagementNavigationCapabilities {
  canReadIdentities: boolean;
  canOpenWorkspaceControlPlane: boolean;
}

/**
 * Resolve adaptive platform navigation from live UI hints. Creating a customer
 * workspace is intentionally useful without directory-read authority, but it
 * still requires global identity lookup for the initial owner.
 */
export function resolvePlatformManagementNavigation(input: {
  ready: boolean;
  hasPermission(permission: string): boolean;
}): PlatformManagementNavigationCapabilities {
  if (!input.ready) {
    return { canReadIdentities: false, canOpenWorkspaceControlPlane: false };
  }
  const canReadIdentities = input.hasPermission('application.users:read');
  return {
    canReadIdentities,
    canOpenWorkspaceControlPlane: input.hasPermission('application.tenants:read')
      || (input.hasPermission('application.tenants:manage') && canReadIdentities),
  };
}

export function resolvePlatformUserManagementMode(input: {
  controlled: boolean;
  configStatus: 'unknown' | 'loading' | 'ready' | 'error';
  tenancyMode?: 'single' | 'multi';
  authorizationMode?: 'simple' | 'advanced';
  activeTenantKind?: 'administration' | 'organization' | null;
}): PlatformUserManagementMode {
  if (input.controlled) return 'identity';
  if (input.configStatus === 'unknown' || input.configStatus === 'loading') return 'loading';
  if (input.configStatus === 'error') return 'unavailable';

  if ((input.tenancyMode ?? 'single') === 'single') {
    return input.authorizationMode === 'advanced' ? 'single-advanced' : 'identity';
  }

  if (input.activeTenantKind === 'administration') return 'platform';
  if (input.activeTenantKind === 'organization') return 'organization';
  return 'unavailable';
}
