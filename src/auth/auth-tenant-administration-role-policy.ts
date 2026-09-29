import type { AuthorizationKernel, AuthorizationScopeSnapshot } from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import {
  canGrantAuthorizationRole,
  roleGrantCeilingFromAuthority,
} from './authorization-role-grant';
import { isRoleAssignableToTenantKind } from './authorization-registry';
import {
  normalizeAuthTenantMemberCreateRoleKeys,
  normalizeAuthTenantMemberReplacementRoleKeys,
} from './auth-tenant-member-role-selection';
import type { AuthTenantMutationAuthority } from './auth-tenant-mutation-authority';
import {
  administrationRoleRequired,
  administrationRoleScopeRequired,
  protectedOwnerLifecycle,
  retiredRoleCleanupRequired,
  roleEscalationForbidden,
  roleRevisionConflict,
  roleRevisionRequired,
  tenantMemberNotFound,
} from './auth-tenant-administration-errors';
import { AuthError } from './types';
import type { TenancyService } from './tenancy/tenancy-service';
import {
  TENANT_OWNER_ROLE_KEY,
  type TenantMembershipRecord,
} from './tenancy/tenancy-types';
import type { AuthTenantAdministrationAuthority } from './auth-tenant-administration-authority';

export type MemberCreateRoleSelection =
  | Readonly<{ kind: 'omitted' }>
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'selected'; roleKeys: readonly string[] }>;

/** Role selection, revision, scope, and grant-ceiling policy for tenant administration. */
export class AuthTenantAdministrationRolePolicy {
  constructor(
    private readonly kernel: AuthorizationKernel,
    private readonly tenancy: TenancyService,
    private readonly roles: AuthorizationRoleService | null,
    private readonly authority: AuthTenantAdministrationAuthority,
  ) {}

  prepareReplacement(input: {
    tenantId: string;
    membership: TenantMembershipRecord;
    roleKeys: readonly string[];
    expectedRevision?: string;
    authority: AuthTenantMutationAuthority;
  }): { roleKeys: readonly string[]; changed: boolean } {
    if (!input.expectedRevision) throw roleRevisionRequired();
    const currentAuthority = this.kernel.authorization.mode === 'advanced'
      ? this.requireAdvancedRoles().getRetainedTenantRoleSet({
          tenantId: input.tenantId,
          membershipId: input.membership.membershipId,
          userId: input.membership.userId,
        })
      : {
          roles: Object.freeze(input.membership.roleKey
            ? [input.membership.roleKey]
            : []),
          revision: tenantRoleRevision(input.membership),
        };
    if (input.expectedRevision !== currentAuthority.revision) {
      throw roleRevisionConflict();
    }
    const roleKeys = this.normalizeDesiredRoleKeys(
      input.tenantId,
      input.roleKeys,
      currentAuthority.roles,
    );
    if (this.kernel.authorization.mode === 'simple' && roleKeys.length !== 1) {
      throw new AuthError(
        'Simple authorization requires exactly one role',
        'TENANT_ROLE_SELECTION_INVALID',
        422,
      );
    }
    const currentMutable = currentAuthority.roles.filter(
      (roleKey) => this.kernel.authorization.roles[roleKey]?.system !== true,
    );
    const currentSet = new Set(currentMutable);
    const desiredSet = new Set(roleKeys);
    const changedKeys = new Set([
      ...roleKeys.filter((roleKey) => !currentSet.has(roleKey)),
      ...currentMutable.filter((roleKey) => !desiredSet.has(roleKey)),
    ]);
    if (changedKeys.size === 0) return { roleKeys, changed: false };

    const actor = this.authority.requireActorMembership(
      input.tenantId,
      input.authority.scope.membershipId,
      input.authority.auth.userId,
    );
    for (const roleKey of changedKeys) {
      if (!this.kernel.authorization.roles[roleKey]) {
        // Removed templates are inert. Only the live tenant owner may remove
        // their retained audit assignment; they can never be newly granted.
        if (actor.roleKey !== TENANT_OWNER_ROLE_KEY) throw roleEscalationForbidden();
        continue;
      }
      if (!this.canGrantRole(input.tenantId, input.authority, roleKey)) {
        throw roleEscalationForbidden();
      }
    }
    if (roleKeys.some((roleKey) => !this.kernel.authorization.roles[roleKey])) {
      throw retiredRoleCleanupRequired();
    }
    return { roleKeys, changed: true };
  }

  normalizeDesiredRoleKeys(
    tenantId: string,
    input: readonly string[],
    current: readonly string[],
  ): readonly string[] {
    const keys = normalizeAuthTenantMemberReplacementRoleKeys(input);
    const currentSet = new Set(current);
    const tenant = this.tenancy.getTenant(tenantId);
    if (!tenant) throw tenantMemberNotFound();
    if (tenant.kind === 'administration' && keys.length < 1) {
      throw administrationRoleRequired();
    }
    for (const roleKey of keys) {
      const role = this.kernel.authorization.roles[roleKey];
      if (!role) {
        if (currentSet.has(roleKey)) continue;
        throw new AuthError(
          `Role is not declared: ${roleKey}`,
          'AUTHORIZATION_ROLE_UNDECLARED',
          422,
        );
      }
      if (role.system || roleKey === TENANT_OWNER_ROLE_KEY) {
        throw protectedOwnerLifecycle();
      }
      if (!isRoleAssignableToTenantKind(
        roleKey,
        tenant.kind,
        this.kernel.authorization,
      )) {
        throw tenant.kind === 'administration'
          ? administrationRoleRequired(roleKey)
          : administrationRoleScopeRequired(roleKey);
      }
    }
    return Object.freeze(keys);
  }

  normalizeCreateRoleKeys(
    tenantId: string,
    selection: MemberCreateRoleSelection,
  ): readonly string[] {
    const tenant = this.tenancy.getTenant(tenantId);
    if (!tenant) throw tenantMemberNotFound();
    if (tenant.kind === 'administration' && selection.kind !== 'selected') {
      throw administrationRoleRequired();
    }
    if (selection.kind === 'selected') return selection.roleKeys;
    return normalizeAuthTenantMemberCreateRoleKeys(
      selection.kind === 'omitted' ? undefined : [],
      this.kernel.authorization.mode,
    );
  }

  canGrantRole(
    tenantId: string,
    authority: {
      scope: Pick<AuthorizationScopeSnapshot, 'allPermissions' | 'permissions'>;
      applicationScope?: Pick<
        AuthorizationScopeSnapshot,
        'allPermissions' | 'permissions'
      > | null;
    },
    roleKey: string,
  ): boolean {
    const role = this.kernel.authorization.roles[roleKey];
    if (!role || role.system) return false;
    const tenant = this.tenancy.getTenant(tenantId);
    if (!tenant) return false;
    return canGrantAuthorizationRole({
      kernel: this.kernel,
      tenantKind: tenant.kind,
      role,
      ceiling: roleGrantCeilingFromAuthority(authority),
    });
  }

  requireAdvancedRoles(): AuthorizationRoleService {
    if (!this.roles) {
      throw new AuthError(
        'Advanced authorization services are unavailable',
        'AUTH_POLICY_UNAVAILABLE',
        503,
      );
    }
    return this.roles;
  }
}

export function snapshotMemberCreateRoleSelection(
  input: unknown,
  mode: Parameters<typeof normalizeAuthTenantMemberCreateRoleKeys>[1],
): MemberCreateRoleSelection {
  // Absence and a literal empty selection have tenant-kind-specific meaning.
  // Defer those cases until live authority has been proven for the target.
  if (input === undefined) return Object.freeze({ kind: 'omitted' });
  if (Array.isArray(input) && input.length === 0) {
    return Object.freeze({ kind: 'empty' });
  }
  return Object.freeze({
    kind: 'selected',
    roleKeys: normalizeAuthTenantMemberCreateRoleKeys(
      input as readonly string[],
      mode,
    ),
  });
}

export function isDefaultMemberRole(roles: readonly string[]): boolean {
  return roles.length === 1 && roles[0] === 'member';
}

export function tenantRoleRevision(input: {
  tenantId: string;
  membershipId: string;
  authorizationGeneration: number;
}): string {
  return `tenant:${input.tenantId}:${input.membershipId}:${input.authorizationGeneration}`;
}
