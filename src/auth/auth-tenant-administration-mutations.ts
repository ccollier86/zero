import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';
import type { AuthorizationKernel } from './authorization-kernel';
import {
  AuthAuditService,
  authAuditActorFromContext,
  captureAuthAuditRequestContext,
} from './auth-audit-service';
import type { AuthAuditRequestContext } from './auth-audit-types';
import { canonicalizeEmail, isValidEmail } from './auth-email-identity';
import type { AuthTenantAdministrationAuthority } from './auth-tenant-administration-authority';
import {
  mapTenantAdministrationError,
  protectedOwnerLifecycle,
  roleEscalationForbidden,
  tenantAdministrationForbidden,
  tenantMemberNotFound,
} from './auth-tenant-administration-errors';
import type { AuthTenantAdministrationReadModel } from './auth-tenant-administration-read-model';
import {
  AuthTenantAdministrationRolePolicy,
  isDefaultMemberRole,
  snapshotMemberCreateRoleSelection,
} from './auth-tenant-administration-role-policy';
import type {
  AuthTenantMemberMutationResult,
  AuthTenantOwnershipTransferResult,
} from './auth-tenant-administration-types';
import type { AssertAuthTenantMutationAuthority } from './auth-tenant-mutation-authority';
import { normalizeAuthTenantMemberReplacementRoleKeys } from './auth-tenant-member-role-selection';
import { AuthError } from './types';
import type { UserStore } from './user-store';
import type { TenancyService } from './tenancy/tenancy-service';
import {
  TENANT_OWNER_ROLE_KEY,
  type TenantMembershipStatus,
} from './tenancy/tenancy-types';

/** Transactional tenant-member and ownership mutation orchestration. */
export class AuthTenantAdministrationMutations {
  private readonly lockTenant: Statement;

  constructor(
    private readonly db: ReactiveDB,
    private readonly kernel: AuthorizationKernel,
    private readonly users: UserStore,
    private readonly tenancy: TenancyService,
    private readonly audit: AuthAuditService,
    private readonly authority: AuthTenantAdministrationAuthority,
    private readonly rolePolicy: AuthTenantAdministrationRolePolicy,
    private readonly readModel: AuthTenantAdministrationReadModel,
  ) {
    this.lockTenant = db.prepare(
      'UPDATE _auth_tenants SET updated_at = updated_at WHERE tenant_id = ?',
    );
  }

  addMember(input: {
    tenantId: string;
    email: string;
    roleKeys?: readonly string[];
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): AuthTenantMemberMutationResult {
    const tenantId = input.tenantId;
    const assertCurrentAuthority = input.assertCurrentAuthority;
    const auditRequest = captureAuthAuditRequestContext(input.auditRequest);
    const suppliedRoleKeys: unknown = input.roleKeys;
    const email = canonicalizeEmail(input.email);
    if (!isValidEmail(email)) {
      throw new AuthError('Invalid email address', 'INVALID_EMAIL', 422);
    }
    const roleSelection = snapshotMemberCreateRoleSelection(
      suppliedRoleKeys,
      this.kernel.authorization.mode,
    );

    try {
      const membership = this.db.transaction(() => {
        this.users.assertCurrentProfile();
        this.lockTenant.run(tenantId);
        const authority = this.authority.requireMutationAuthority(
          tenantId,
          assertCurrentAuthority,
          roleSelection.kind !== 'selected'
            || isDefaultMemberRole(roleSelection.roleKeys)
            ? ['tenant.members:manage']
            : ['tenant.members:manage', 'tenant.roles:manage'],
        );
        const selectedRoleKeys = this.rolePolicy.normalizeCreateRoleKeys(
          tenantId,
          roleSelection,
        );
        const roleKeys = this.rolePolicy.normalizeDesiredRoleKeys(
          tenantId,
          selectedRoleKeys,
          [],
        );
        for (const roleKey of roleKeys) {
          if (!this.rolePolicy.canGrantRole(tenantId, authority, roleKey)) {
            throw roleEscalationForbidden();
          }
        }
        const user = this.users.getUserByEmail(email);
        if (!user) {
          throw new AuthError(
            'No existing account matches that exact email address',
            'TENANT_MEMBER_SUBJECT_NOT_FOUND',
            404,
          );
        }
        if (user.status !== 'active') {
          throw new AuthError(
            'The account is not available for tenant membership',
            'TENANT_MEMBER_SUBJECT_INACTIVE',
            409,
          );
        }
        const created = this.tenancy.addMembership({
          tenantId,
          userId: user.userId,
          roleKey: roleKeys[0]!,
          createdBy: authority.auth.userId,
        });
        if (this.kernel.authorization.mode === 'advanced') {
          this.rolePolicy.requireAdvancedRoles().replaceTenantRoles({
            tenantId,
            membershipId: created.membershipId,
            roleKeys,
            changedBy: authority.auth.userId,
          });
        } else {
          const roleKey = roleKeys[0] ?? 'member';
          if (roleKey !== created.roleKey) {
            this.tenancy.updateMembershipRole(created.membershipId, roleKey);
          }
        }
        const persisted = this.tenancy.getMembershipById(created.membershipId)!;
        this.audit.append({
          action: 'tenant.member-added',
          outcome: 'succeeded',
          scope: { kind: 'tenant', tenantId },
          actor: authAuditActorFromContext(authority.auth),
          request: auditRequest,
          target: { type: 'tenant-membership', id: persisted.membershipId },
          metadata: { 'role-count': roleKeys.length },
        });
        return persisted;
      });
      return {
        member: this.readModel.getMember(tenantId, membership.membershipId),
        actorSessionInvalidated: false,
      };
    } catch (error) {
      throw mapTenantAdministrationError(error);
    }
  }

  updateMember(input: {
    tenantId: string;
    membershipId: string;
    status?: Extract<TenantMembershipStatus, 'active' | 'suspended'>;
    roleKeys?: readonly string[];
    expectedRoleRevision?: string;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): AuthTenantMemberMutationResult {
    const tenantId = input.tenantId;
    const membershipId = input.membershipId;
    const expectedRoleRevision = input.expectedRoleRevision;
    const assertCurrentAuthority = input.assertCurrentAuthority;
    const auditRequest = captureAuthAuditRequestContext(input.auditRequest);
    const suppliedRoleKeys: unknown = input.roleKeys;
    const replacementRoleKeys = suppliedRoleKeys === undefined
      ? undefined
      : normalizeAuthTenantMemberReplacementRoleKeys(
          suppliedRoleKeys as readonly string[],
        );
    const status = normalizeMembershipUpdateStatus(input.status);
    if (status === undefined && replacementRoleKeys === undefined) {
      throw new AuthError(
        'Provide a membership status or role change',
        'TENANT_MEMBER_UPDATE_EMPTY',
        422,
      );
    }
    try {
      const result = this.db.transaction(() => {
        this.users.assertCurrentProfile();
        this.lockTenant.run(tenantId);
        const authority = this.authority.requireMutationAuthority(
          tenantId,
          assertCurrentAuthority,
          replacementRoleKeys === undefined
            ? ['tenant.members:manage']
            : ['tenant.members:manage', 'tenant.roles:manage'],
        );
        const current = this.authority.requireTenantMembership(tenantId, membershipId);
        if (current.roleKey === TENANT_OWNER_ROLE_KEY) throw protectedOwnerLifecycle();
        if (current.status === 'removed') {
          throw new AuthError(
            'Removed memberships require a separate re-admission flow',
            'TENANT_MEMBERSHIP_STATUS_CONFLICT',
            409,
          );
        }
        const replacement = replacementRoleKeys === undefined
          ? null
          : this.rolePolicy.prepareReplacement({
              tenantId,
              membership: current,
              roleKeys: replacementRoleKeys,
              expectedRevision: expectedRoleRevision,
              authority,
            });
        const roleKeys = replacement?.roleKeys;
        if ((status === 'active' || roleKeys !== undefined)
          && this.users.getUserById(current.userId)?.status !== 'active') {
          throw new AuthError(
            'The account is not available for active tenant authority',
            'TENANT_MEMBER_SUBJECT_INACTIVE',
            409,
          );
        }
        if (this.kernel.authorization.mode === 'simple' && roleKeys !== undefined
          && roleKeys.length !== 1) {
          throw new AuthError(
            'Simple authorization requires exactly one role',
            'TENANT_ROLE_SELECTION_INVALID',
            422,
          );
        }
        let membership = current;
        if (status !== undefined && membership.status !== status) {
          membership = status === 'active'
            ? this.tenancy.reactivateMembership(membership.membershipId)
            : this.tenancy.suspendMembership(membership.membershipId);
        }
        if (roleKeys !== undefined) {
          if (membership.status !== 'active') {
            throw new AuthError(
              'Role assignments can only change for an active membership',
              'TENANT_MEMBER_SUBJECT_INACTIVE',
              409,
            );
          }
          if (this.kernel.authorization.mode === 'advanced') {
            this.rolePolicy.requireAdvancedRoles().replaceTenantRoles({
              tenantId,
              membershipId: membership.membershipId,
              roleKeys,
              changedBy: authority.auth.userId,
            });
          } else if (membership.roleKey !== roleKeys[0]) {
            membership = this.tenancy.updateMembershipRole(
              membership.membershipId,
              roleKeys[0]!,
            );
          }
        }
        const changed = this.tenancy.getMembershipById(membership.membershipId)!;
        this.audit.append({
          action: 'tenant.member-updated',
          outcome: 'succeeded',
          scope: { kind: 'tenant', tenantId },
          actor: authAuditActorFromContext(authority.auth),
          request: auditRequest,
          target: { type: 'tenant-membership', id: changed.membershipId },
          metadata: {
            status: changed.status,
            'status-changed': changed.status !== current.status,
            'roles-requested': replacementRoleKeys !== undefined,
          },
        });
        return {
          changed,
          current,
          actorMembershipId: authority.scope.membershipId,
        };
      });
      return {
        member: this.readModel.getMember(tenantId, result.changed.membershipId),
        actorSessionInvalidated: result.changed.membershipId === result.actorMembershipId
          && result.changed.authorizationGeneration
            !== result.current.authorizationGeneration,
      };
    } catch (error) {
      throw mapTenantAdministrationError(error);
    }
  }

  removeMember(input: {
    tenantId: string;
    membershipId: string;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): AuthTenantMemberMutationResult {
    const tenantId = input.tenantId;
    const membershipId = input.membershipId;
    const assertCurrentAuthority = input.assertCurrentAuthority;
    const auditRequest = captureAuthAuditRequestContext(input.auditRequest);
    try {
      const result = this.db.transaction(() => {
        this.users.assertCurrentProfile();
        this.lockTenant.run(tenantId);
        const authority = this.authority.requireMutationAuthority(
          tenantId,
          assertCurrentAuthority,
          ['tenant.members:manage'],
        );
        const current = this.authority.requireTenantMembership(tenantId, membershipId);
        if (current.roleKey === TENANT_OWNER_ROLE_KEY) throw protectedOwnerLifecycle();
        const removed = this.tenancy.removeMembership(current.membershipId);
        this.audit.append({
          action: 'tenant.member-removed',
          outcome: 'succeeded',
          scope: { kind: 'tenant', tenantId },
          actor: authAuditActorFromContext(authority.auth),
          request: auditRequest,
          target: { type: 'tenant-membership', id: removed.membershipId },
        });
        return {
          removed,
          current,
          actorMembershipId: authority.scope.membershipId,
        };
      });
      return {
        member: this.readModel.getMember(tenantId, result.removed.membershipId),
        actorSessionInvalidated: result.removed.membershipId === result.actorMembershipId
          && result.removed.authorizationGeneration
            !== result.current.authorizationGeneration,
      };
    } catch (error) {
      throw mapTenantAdministrationError(error);
    }
  }

  transferOwnership(input: {
    tenantId: string;
    targetMembershipId: string;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): AuthTenantOwnershipTransferResult {
    const tenantId = input.tenantId;
    const targetMembershipId = input.targetMembershipId;
    const assertCurrentAuthority = input.assertCurrentAuthority;
    const auditRequest = captureAuthAuditRequestContext(input.auditRequest);
    try {
      const transferred = this.db.transaction(() => {
        this.users.assertCurrentProfile();
        this.lockTenant.run(tenantId);
        const authority = this.authority.requireMutationAuthority(
          tenantId,
          assertCurrentAuthority,
          ['tenant.roles:manage'],
        );
        const actor = this.authority.requireActorMembership(
          tenantId,
          authority.scope.membershipId,
          authority.auth.userId,
        );
        if (actor.roleKey !== TENANT_OWNER_ROLE_KEY) {
          throw tenantAdministrationForbidden();
        }
        this.authority.requireTenantMembership(tenantId, targetMembershipId);
        const tenant = this.tenancy.getTenant(tenantId);
        if (!tenant) throw tenantMemberNotFound();
        const demotedRoleKey = tenant.kind === 'administration'
          ? 'administrator'
          : 'member';
        const result = this.tenancy.transferOwnership(
          actor.membershipId,
          targetMembershipId,
          demotedRoleKey,
        );
        if (this.kernel.authorization.mode === 'advanced') {
          // The protected owner assignment follows the store marker through
          // its atomic owner hook. Also ensure the former owner retains Zero's
          // ordinary member role; keep any other assignable roles intact.
          this.rolePolicy.requireAdvancedRoles().assignTenantRole({
            tenantId,
            membershipId: result.previousOwnerMembership.membershipId,
            roleKey: demotedRoleKey,
            createdBy: authority.auth.userId,
            sourceId: 'tenant-ownership-transfer',
          });
        }
        this.audit.append({
          action: 'tenant.ownership-transferred',
          outcome: 'succeeded',
          scope: { kind: 'tenant', tenantId },
          actor: authAuditActorFromContext(authority.auth),
          request: auditRequest,
          target: {
            type: 'tenant-membership',
            id: result.ownerMembership.membershipId,
          },
        });
        return result;
      });
      return {
        owner: this.readModel.getMember(
          tenantId,
          transferred.ownerMembership.membershipId,
        ),
        previousOwner: this.readModel.getMember(
          tenantId,
          transferred.previousOwnerMembership.membershipId,
        ),
        actorSessionInvalidated: true,
      };
    } catch (error) {
      throw mapTenantAdministrationError(error);
    }
  }
}

function normalizeMembershipUpdateStatus(
  value: unknown,
): Extract<TenantMembershipStatus, 'active' | 'suspended'> | undefined {
  if (value === undefined) return undefined;
  if (value === 'active' || value === 'suspended') return value;
  throw new AuthError(
    'Membership status must be active or suspended',
    'TENANT_MEMBER_STATUS_INVALID',
    422,
  );
}
