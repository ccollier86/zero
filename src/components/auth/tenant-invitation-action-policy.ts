import type {
  AuthPublicConfig,
  AuthTenantAdministrationConfig,
  AuthTenantRoleDescriptor,
} from '../../frontend/client/auth-types';
import { rolesForTenantKind } from './tenant-role-scope';
import { resolveInvitationDeliveryMode } from './tenant-onboarding-management-parts';

export type TenantInvitationDeliveryMode = 'email' | 'manual';

export interface TenantInvitationActionPolicy {
  availableModes: TenantInvitationDeliveryMode[];
  canChooseRoles: boolean;
  canIssue: boolean;
  canOpen: boolean;
  canRead: boolean;
  defaultMode: TenantInvitationDeliveryMode;
  roleChoices: AuthTenantRoleDescriptor[];
  simple: boolean;
}

/** Keep the compact dialog's cursor page inside the backend contract. */
export function boundedTenantInvitationPageSize(value = 10): number {
  return Number.isFinite(value)
    ? Math.min(100, Math.max(1, Math.trunc(value)))
    : 10;
}

/**
 * Project the protected invitation capability into a fail-closed UI policy.
 * Role choices are constrained to the active tenant kind and the actor's live
 * grant ceiling; the server remains authoritative when an invitation is sent.
 */
export function resolveTenantInvitationActionPolicy(params: {
  publicConfig: AuthPublicConfig | null;
  administrationConfig: AuthTenantAdministrationConfig | null;
  invitationsEnabled: boolean | null;
  tenantKind: 'administration' | 'organization' | null;
}): TenantInvitationActionPolicy {
  const delivery = params.publicConfig?.tenancy?.onboarding?.invitations.delivery;
  const availableModes = [
    ...(delivery?.email ? ['email' as const] : []),
    ...(delivery?.manual ? ['manual' as const] : []),
  ];
  const roleChoices = rolesForTenantKind(
    params.administrationConfig?.roles ?? [],
    params.tenantKind,
  ).filter((role) => (
    role.assignable
      && role.grantable
      && !role.system
      && role.key !== 'owner'
  ));
  const canChooseRoles =
    params.administrationConfig?.capabilities.canManageRoles === true
      && roleChoices.length > 0;
  const requestedDefault = delivery?.default ?? 'manual';
  const defaultMode = resolveInvitationDeliveryMode(
    requestedDefault,
    requestedDefault,
    availableModes,
  );
  const administrationScope = params.tenantKind === 'administration';
  const enabledInScope = params.tenantKind !== null
    && params.invitationsEnabled === true;
  const canRead = enabledInScope
    && params.administrationConfig?.capabilities.canReadInvitations === true;
  const canIssue = enabledInScope
    && params.administrationConfig?.capabilities.canManageInvitations === true
    && availableModes.length > 0
    && (!administrationScope || canChooseRoles);

  return {
    availableModes,
    canChooseRoles,
    canIssue,
    canOpen: canIssue || canRead,
    canRead,
    defaultMode,
    roleChoices,
    simple: params.administrationConfig?.authorization === 'simple',
  };
}

/** Keep a valid draft selection or choose the declared member role/first role. */
export function projectTenantInvitationRoles(
  current: readonly string[],
  roleChoices: readonly AuthTenantRoleDescriptor[],
  simple: boolean,
): string[] {
  const allowed = new Set(roleChoices.map((role) => role.key));
  const retained = [...new Set(current.filter((role) => allowed.has(role)))];
  if ((simple && retained.length === 1) || (!simple && retained.length > 0)) {
    return retained;
  }
  const defaultRole = roleChoices.find((role) => role.key === 'member')
    ?? roleChoices[0];
  return defaultRole ? [defaultRole.key] : [];
}
