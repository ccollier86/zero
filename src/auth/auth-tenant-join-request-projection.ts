import type {
  AuthorizationKernel,
  AuthorizationScopeSnapshot,
} from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import { isRoleAssignableToTenantKind } from './authorization-registry';
import { canGrantAuthorizationRole } from './authorization-role-grant';
import type {
  AuthTenantJoinRequestProjectionRow,
  AuthTenantJoinRequestProvenanceRow,
} from './auth-tenant-join-request-store';
import { mapJoinRequest } from './auth-tenant-onboarding-codec';
import {
  AUTH_TENANT_MAX_ROLE_COUNT,
  isDefaultTenantMemberRole,
} from './auth-tenant-onboarding-role-policy';
import type {
  AuthTenantJoinRequest,
  AuthTenantJoinRequestApprovalPolicy,
  AuthTenantJoinRequestApprovalRole,
  AuthTenantJoinRequestRecord,
} from './auth-tenant-onboarding-types';
import type { TenancyService } from './tenancy/tenancy-service';
import type { TenantKind } from './tenancy/tenancy-types';
import { AuthError, type PermissionKey } from './types';

/** Read-only reviewer projection for a retained tenant join request. */
export class AuthTenantJoinRequestProjection {
  constructor(
    private readonly kernel: AuthorizationKernel,
    private readonly tenancy: TenancyService,
    private readonly roles: AuthorizationRoleService | null,
    private readonly now: () => number = Date.now,
  ) {}

  project(
    row: AuthTenantJoinRequestProjectionRow,
    approvalScope?: AuthorizationScopeSnapshot,
    approvalApplicationScope?: AuthorizationScopeSnapshot | null,
  ): AuthTenantJoinRequest {
    const membership = this.tenancy.getMembership(row.tenant_id, row.user_id);
    const roleKeys = membership
      ? this.kernel.authorization.mode === 'advanced'
        ? this.requireAdvancedRoles().getRetainedTenantRoleKeys({
            tenantId: row.tenant_id,
            membershipId: membership.membershipId,
            userId: row.user_id,
          })
        : Object.freeze(membership.roleKey ? [membership.roleKey] : [])
      : Object.freeze([] as string[]);
    const record = mapJoinRequest(row);
    const scope = this.resolveApprovalScope(row.tenant_id, approvalScope);
    const applicationScope = approvalApplicationScope?.scopeKind === 'application'
      ? approvalApplicationScope
      : null;
    const tenantKind = this.tenancy.getTenant(row.tenant_id)?.kind ?? 'organization';

    return Object.freeze({
      joinRequestId: record.joinRequestId,
      applicant: Object.freeze({
        userId: record.userId,
        username: row.username,
        email: record.email,
        firstName: row.first_name,
        lastName: row.last_name,
      }),
      status: record.status,
      requestRevision: record.requestRevision,
      requestedAt: record.requestedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      reviewedAt: record.reviewedAt,
      lastDecision: record.lastDecision,
      membership: membership ? Object.freeze({
        membershipId: membership.membershipId,
        status: membership.status,
        roles: Object.freeze([...roleKeys]),
      }) : null,
      reactivationRequired: Boolean(membership && membership.status !== 'active'),
      approvalPolicy: projectApprovalPolicy({
        row,
        kernel: this.kernel,
        scope,
        applicationScope,
        tenantKind,
        // Preserve the legacy clock boundary: generic requests never consult
        // the clock while verified-domain policy is projected at read time.
        now: row.domain_request_role_key ? this.now() : 0,
      }),
    });
  }

  private resolveApprovalScope(
    tenantId: string,
    scope: AuthorizationScopeSnapshot | undefined,
  ): AuthorizationScopeSnapshot | null {
    if (!scope || scope.scopeKind !== 'tenant' || scope.tenantId !== tenantId
      || !scope.membershipId) return null;
    const membership = this.tenancy.getMembershipById(scope.membershipId);
    return membership?.tenantId === tenantId && membership.status === 'active'
      ? scope
      : null;
  }

  private requireAdvancedRoles(): AuthorizationRoleService {
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

/** Pure retry decision for a generic submission replacing domain provenance. */
export function canSubmitGenericJoinRequest(input: {
  request: AuthTenantJoinRequestRecord;
  provenance: AuthTenantJoinRequestProvenanceRow | null;
  now: number;
  deniedRetryCooldownMs: number;
}): boolean {
  const { request, provenance } = input;
  if (!provenance) return true;
  const provenanceMayBeCurrent = provenance.request_revision === null
    || provenance.request_revision === request.requestRevision;
  if (!provenanceMayBeCurrent) return true;
  if (provenance.blocked_until !== null) return provenance.blocked_until <= input.now;
  if (request.status === 'denied' || request.status === 'cancelled') {
    // Missing cooldown metadata on a provenance-bearing terminal request is
    // never interpreted as permission to reopen immediately.
    const decisionAt = request.reviewedAt ?? request.requestedAt;
    return decisionAt + input.deniedRetryCooldownMs <= input.now;
  }
  return true;
}

function projectApprovalPolicy(input: {
  row: AuthTenantJoinRequestProjectionRow;
  kernel: AuthorizationKernel;
  scope: AuthorizationScopeSnapshot | null;
  applicationScope: AuthorizationScopeSnapshot | null;
  tenantKind: TenantKind;
  now: number;
}): AuthTenantJoinRequestApprovalPolicy {
  const { row, kernel, scope, applicationScope, tenantKind } = input;
  const domainRoleKey = row.domain_request_role_key;
  if (domainRoleKey) {
    const roles = Object.freeze([approvalRole(kernel, domainRoleKey)]);
    return Object.freeze({
      canApprove: row.domain_provenance_unbound !== 1
        && (row.domain_request_blocked_until === null
          || row.domain_request_blocked_until <= input.now)
        && canApproveRoleKeys({
          roleKeys: roles.map((role) => role.key),
          kernel,
          scope,
          applicationScope,
          tenantKind,
        }),
      roleSelection: Object.freeze({ mode: 'fixed' as const, roles }),
    });
  }

  const defaultRoles = Object.freeze([approvalRole(kernel, 'member')]);
  if (kernel.authorization.mode === 'advanced'
    && scope
    && hasScopePermission(scope, 'tenant.roles:manage')) {
    const roles = Object.freeze(Object.values(kernel.authorization.roles)
      .filter((role) => role.key !== 'owner'
        && !role.system
        && isRoleAssignableToTenantKind(role.key, tenantKind, kernel.authorization)
        && canGrantAuthorizationRole({
          kernel,
          tenantKind,
          role,
          ceiling: { tenant: scope, application: applicationScope },
        }))
      .sort((left, right) => compareKeys(left.key, right.key))
      .map((role) => Object.freeze({ key: role.key, label: role.label })));
    if (roles.length > 0) {
      const defaultRoleKeys = Object.freeze(roles.some((role) => role.key === 'member')
        ? ['member']
        : [roles[0]!.key]);
      return Object.freeze({
        canApprove: hasScopePermission(scope, 'tenant.join-requests:review'),
        roleSelection: Object.freeze({
          mode: 'selectable' as const,
          defaultRoleKeys,
          maxRoleCount: AUTH_TENANT_MAX_ROLE_COUNT,
          roles,
        }),
      });
    }
  }

  return Object.freeze({
    canApprove: canApproveRoleKeys({
      roleKeys: ['member'],
      kernel,
      scope,
      applicationScope,
      tenantKind,
    }),
    roleSelection: Object.freeze({ mode: 'default' as const, roles: defaultRoles }),
  });
}

function canApproveRoleKeys(input: {
  roleKeys: readonly string[];
  kernel: AuthorizationKernel;
  scope: AuthorizationScopeSnapshot | null;
  applicationScope: AuthorizationScopeSnapshot | null;
  tenantKind: TenantKind;
}): boolean {
  const { roleKeys, kernel, scope, applicationScope, tenantKind } = input;
  if (!scope || !hasScopePermission(scope, 'tenant.join-requests:review')) return false;
  if (!isDefaultTenantMemberRole(roleKeys)
    && !hasScopePermission(scope, 'tenant.roles:manage')) return false;
  return roleKeys.every((roleKey) => {
    const role = kernel.authorization.roles[roleKey];
    return Boolean(role
      && roleKey !== 'owner'
      && !role.system
      && isRoleAssignableToTenantKind(roleKey, tenantKind, kernel.authorization)
      && canGrantAuthorizationRole({
        kernel,
        tenantKind,
        role,
        ceiling: { tenant: scope, application: applicationScope },
      }));
  });
}

function approvalRole(
  kernel: AuthorizationKernel,
  roleKey: string,
): AuthTenantJoinRequestApprovalRole {
  const role = kernel.authorization.roles[roleKey];
  return Object.freeze({ key: roleKey, label: role?.label ?? roleKey });
}

function hasScopePermission(
  scope: Pick<AuthorizationScopeSnapshot, 'allPermissions' | 'permissions'>,
  permission: PermissionKey,
): boolean {
  return scope.allPermissions === true || scope.permissions.includes(permission);
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
