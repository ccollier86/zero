import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';
import type { AuthorizationKernel, AuthorizationScopeSnapshot } from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import { AuthorizationRoleAssignmentError } from './authorization-role-types';
import { canonicalizeEmail, isValidEmail } from './auth-email-identity';
import {
  type AuthTenantAdministrationConfig,
  type AuthTenantMember,
  type AuthTenantMemberListInput,
  type AuthTenantMemberMutationResult,
  type AuthTenantMemberPage,
  type AuthTenantOwnershipTransferResult,
} from './auth-tenant-administration-types';
import type {
  AssertAuthTenantMutationAuthority,
  AuthTenantMutationAuthority,
} from './auth-tenant-mutation-authority';
import { AuthError, type PermissionKey } from './types';
import type { UserStore } from './user-store';
import {
  AuthAuditService,
  authAuditActorFromContext,
  captureAuthAuditRequestContext,
} from './auth-audit-service';
import type { AuthAuditRequestContext } from './auth-audit-types';
import type { TenancyService } from './tenancy/tenancy-service';
import {
  TENANT_OWNER_ROLE_KEY,
  TenancyError,
  type TenantMembershipRecord,
  type TenantMembershipStatus,
} from './tenancy/tenancy-types';
import {
  isAdministrationOnlyRole,
  isRoleAssignableToTenantKind,
} from './authorization-registry';
import {
  canGrantAuthorizationRole,
  roleGrantCeilingFromAuthority,
} from './authorization-role-grant';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';
import {
  normalizeAuthTenantMemberCreateRoleKeys,
  normalizeAuthTenantMemberReplacementRoleKeys,
} from './auth-tenant-member-role-selection';

interface MemberRow {
  membership_id: string;
  tenant_id: string;
  user_id: string;
  membership_status: TenantMembershipStatus;
  role_key: string | null;
  authorization_generation: number;
  joined_at: number;
  updated_at: number;
  username: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

interface MemberCursor {
  joinedAt: number;
  membershipId: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_SEARCH_LENGTH = 120;
const MAX_CURSOR_LENGTH = 512;

type MemberCreateRoleSelection =
  | Readonly<{ kind: 'omitted' }>
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'selected'; roleKeys: readonly string[] }>;

/**
 * Headless tenant-member control plane.
 *
 * HTTP adapters must supply the tenant from a live request scope. This service
 * nevertheless checks every membership relationship again so another
 * adapter cannot turn an opaque membership id into cross-tenant authority.
 */
export class AuthTenantAdministrationService {
  private readonly lockTenant: Statement;

  constructor(
    private readonly db: ReactiveDB,
    private readonly kernel: AuthorizationKernel,
    private readonly users: UserStore,
    private readonly tenancy: TenancyService,
    private readonly roles: AuthorizationRoleService | null,
    private readonly audit: AuthAuditService,
    private readonly emitCode?: AuthPlatformCodeEmitter,
  ) {
    this.lockTenant = db.prepare(
      'UPDATE _auth_tenants SET updated_at = updated_at WHERE tenant_id = ?',
    );
  }

  getConfig(input: {
    tenantId: string;
    membershipId: string;
    scope: AuthorizationScopeSnapshot;
    applicationScope?: AuthorizationScopeSnapshot | null;
    assertCurrentAuthority?: AssertAuthTenantMutationAuthority;
  }): AuthTenantAdministrationConfig {
    this.users.assertCurrentProfile();
    if (input.scope.scopeKind !== 'tenant'
      || input.scope.tenantId !== input.tenantId
      || input.scope.membershipId !== input.membershipId) {
      throw forbidden();
    }
    const tenant = this.tenancy.getTenant(input.tenantId);
    const membership = this.requireTenantMembership(input.tenantId, input.membershipId);
    if (!tenant || tenant.status !== 'active' || membership.status !== 'active') {
      throw forbidden();
    }
    const permissions = Object.freeze([...input.scope.permissions].sort(compareKeys));
    const permissionSet = new Set(permissions);
    const can = (permission: PermissionKey) => (
      input.scope.allPermissions === true || permissionSet.has(permission)
    );
    const canManageRoles = can('tenant.roles:manage');
    const ceiling = roleGrantCeilingFromAuthority({
      scope: input.scope,
      applicationScope: input.applicationScope,
    });
    const roleDescriptors = Object.values(this.kernel.authorization.roles)
      .sort((left, right) => compareKeys(left.key, right.key))
      .map((role) => {
        const administrationOnly = isAdministrationOnlyRole(
          this.kernel.authorization,
          role.key,
        );
        const assignable = !role.system
          && isRoleAssignableToTenantKind(
            role.key,
            tenant.kind,
            this.kernel.authorization,
          );
        return Object.freeze({
          key: role.key,
          label: role.label,
          ...(role.description ? { description: role.description } : {}),
          permissions: Object.freeze([...role.permissions]),
          allPermissions: role.allPermissions,
          system: role.system,
          assignable,
          administrationOnly,
          grantable: assignable && canManageRoles && canGrantAuthorizationRole({
            kernel: this.kernel,
            tenantKind: tenant.kind,
            role,
            ceiling,
          }),
        });
      });

    const result = Object.freeze({
      tenancy: 'multi',
      authorization: this.kernel.authorization.mode,
      terminology: this.kernel.tenancy.terminology,
      tenant: Object.freeze({
        tenantId: tenant.tenantId,
        kind: tenant.kind,
        slug: tenant.slug,
        name: tenant.name,
      }),
      actor: Object.freeze({
        membershipId: membership.membershipId,
        roles: Object.freeze([...input.scope.roles]),
        permissions,
        allPermissions: input.scope.allPermissions === true,
      }),
      capabilities: Object.freeze({
        canReadMembers: can('tenant.members:read'),
        canManageMembers: can('tenant.members:manage'),
        canReadRoles: can('tenant.roles:read'),
        canManageRoles,
        canTransferOwnership: input.scope.roles.includes(TENANT_OWNER_ROLE_KEY),
        canReadInvitations: can('tenant.invitations:read'),
        canManageInvitations: can('tenant.invitations:manage'),
        canReviewJoinRequests: tenant.kind === 'organization'
          && can('tenant.join-requests:review'),
      }),
      roles: Object.freeze(roleDescriptors),
    });
    if (input.assertCurrentAuthority) {
      this.invokeAuthority(input.assertCurrentAuthority, []);
    }
    return result;
  }

  listMembers(
    tenantId: string,
    input: AuthTenantMemberListInput = {},
    assertCurrentAuthority?: AssertAuthTenantMutationAuthority,
  ): AuthTenantMemberPage {
    this.users.assertCurrentProfile();
    this.requireActiveTenant(tenantId);
    const limit = normalizeLimit(input.limit);
    const cursor = decodeCursor(input.cursor);
    const search = normalizeSearch(input.search);
    const status = normalizeMembershipPageStatus(input.status);
    const clauses = ['membership.tenant_id = ?'];
    const args: Array<string | number> = [tenantId];
    if (status) {
      clauses.push('membership.status = ?');
      args.push(status);
    }
    if (search) {
      clauses.push(`(
        lower(identity.email) LIKE ? ESCAPE '\\'
        OR lower(identity.username) LIKE ? ESCAPE '\\'
        OR lower(COALESCE(identity.first_name, '')) LIKE ? ESCAPE '\\'
        OR lower(COALESCE(identity.last_name, '')) LIKE ? ESCAPE '\\'
      )`);
      const pattern = `%${escapeLike(search)}%`;
      args.push(pattern, pattern, pattern, pattern);
    }
    if (cursor) {
      clauses.push(`(
        membership.joined_at > ?
        OR (membership.joined_at = ? AND membership.membership_id > ?)
      )`);
      args.push(cursor.joinedAt, cursor.joinedAt, cursor.membershipId);
    }

    const rows = this.db.prepare(`
      SELECT membership.membership_id, membership.tenant_id,
        membership.user_id, membership.status AS membership_status,
        membership.role_key, membership.authorization_generation,
        membership.joined_at, membership.updated_at,
        identity.username, identity.email, identity.first_name,
        identity.last_name
      FROM _auth_tenant_memberships membership
      INNER JOIN users identity ON identity.user_id = membership.user_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY membership.joined_at ASC, membership.membership_id ASC
      LIMIT ?
    `).all(...args, limit + 1) as MemberRow[];
    const hasMore = rows.length > limit;
    const selected = hasMore ? rows.slice(0, limit) : rows;
    const members = selected.map((row) => this.mapMember(row));
    const last = selected.at(-1);
    const result = {
      members,
      page: {
        limit,
        count: members.length,
        hasMore,
        nextCursor: hasMore && last
          ? encodeCursor({ joinedAt: last.joined_at, membershipId: last.membership_id })
          : null,
      },
    };
    if (assertCurrentAuthority) {
      this.invokeAuthority(assertCurrentAuthority, ['tenant.members:read']);
    }
    return result;
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
        const authority = this.requireMutationAuthority(
          tenantId,
          assertCurrentAuthority,
          roleSelection.kind !== 'selected'
            || isDefaultMemberRole(roleSelection.roleKeys)
            ? ['tenant.members:manage']
            : ['tenant.members:manage', 'tenant.roles:manage'],
        );
        const selectedRoleKeys = this.normalizeCreateRoleKeys(
          tenantId,
          roleSelection,
        );
        const roleKeys = this.normalizeDesiredRoleKeys(
          tenantId,
          selectedRoleKeys,
          [],
        );
        for (const roleKey of roleKeys) {
          if (!this.canGrantRole(tenantId, authority, roleKey)) {
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
          this.requireAdvancedRoles().replaceTenantRoles({
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
        member: this.getMember(tenantId, membership.membershipId),
        actorSessionInvalidated: false,
      };
    } catch (error) {
      throw mapAdministrationError(error);
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
        const authority = this.requireMutationAuthority(
          tenantId,
          assertCurrentAuthority,
          replacementRoleKeys === undefined
            ? ['tenant.members:manage']
            : ['tenant.members:manage', 'tenant.roles:manage'],
        );
        const current = this.requireTenantMembership(tenantId, membershipId);
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
          : this.prepareRoleReplacement({
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
            this.requireAdvancedRoles().replaceTenantRoles({
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
        member: this.getMember(tenantId, result.changed.membershipId),
        actorSessionInvalidated: result.changed.membershipId === result.actorMembershipId
          && result.changed.authorizationGeneration
            !== result.current.authorizationGeneration,
      };
    } catch (error) {
      throw mapAdministrationError(error);
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
        const authority = this.requireMutationAuthority(
          tenantId,
          assertCurrentAuthority,
          ['tenant.members:manage'],
        );
        const current = this.requireTenantMembership(tenantId, membershipId);
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
        member: this.getMember(tenantId, result.removed.membershipId),
        actorSessionInvalidated: result.removed.membershipId === result.actorMembershipId
          && result.removed.authorizationGeneration
            !== result.current.authorizationGeneration,
      };
    } catch (error) {
      throw mapAdministrationError(error);
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
        const authority = this.requireMutationAuthority(
          tenantId,
          assertCurrentAuthority,
          ['tenant.roles:manage'],
        );
        const actor = this.requireActorMembership(
          tenantId,
          authority.scope.membershipId,
          authority.auth.userId,
        );
        if (actor.roleKey !== TENANT_OWNER_ROLE_KEY) throw forbidden();
        this.requireTenantMembership(tenantId, targetMembershipId);
        const tenant = this.tenancy.getTenant(tenantId);
        if (!tenant) throw memberNotFound();
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
          this.requireAdvancedRoles().assignTenantRole({
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
        owner: this.getMember(tenantId, transferred.ownerMembership.membershipId),
        previousOwner: this.getMember(
          tenantId,
          transferred.previousOwnerMembership.membershipId,
        ),
        actorSessionInvalidated: true,
      };
    } catch (error) {
      throw mapAdministrationError(error);
    }
  }

  private prepareRoleReplacement(input: {
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

    const actor = this.requireActorMembership(
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

  private normalizeDesiredRoleKeys(
    tenantId: string,
    input: readonly string[],
    current: readonly string[],
  ): readonly string[] {
    const keys = normalizeAuthTenantMemberReplacementRoleKeys(input);
    const currentSet = new Set(current);
    const tenant = this.tenancy.getTenant(tenantId);
    if (!tenant) throw memberNotFound();
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

  private normalizeCreateRoleKeys(
    tenantId: string,
    selection: MemberCreateRoleSelection,
  ): readonly string[] {
    const tenant = this.tenancy.getTenant(tenantId);
    if (!tenant) throw memberNotFound();
    if (tenant.kind === 'administration'
      && selection.kind !== 'selected') {
      throw administrationRoleRequired();
    }
    if (selection.kind === 'selected') return selection.roleKeys;
    return normalizeAuthTenantMemberCreateRoleKeys(
      selection.kind === 'omitted' ? undefined : [],
      this.kernel.authorization.mode,
    );
  }

  private canGrantRole(
    tenantId: string,
    authority: Pick<AuthTenantMutationAuthority, 'scope' | 'applicationScope'>,
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

  private getMember(tenantId: string, membershipId: string): AuthTenantMember {
    this.users.assertCurrentProfile();
    const row = this.db.prepare(`
      SELECT membership.membership_id, membership.tenant_id,
        membership.user_id, membership.status AS membership_status,
        membership.role_key, membership.authorization_generation,
        membership.joined_at, membership.updated_at,
        identity.username, identity.email, identity.first_name,
        identity.last_name
      FROM _auth_tenant_memberships membership
      INNER JOIN users identity ON identity.user_id = membership.user_id
      WHERE membership.tenant_id = ? AND membership.membership_id = ?
    `).get(tenantId, membershipId) as MemberRow | null;
    if (!row) throw memberNotFound();
    return this.mapMember(row);
  }

  private mapMember(row: MemberRow): AuthTenantMember {
    const authority = this.kernel.authorization.mode === 'advanced'
      ? this.requireAdvancedRoles().getRetainedTenantRoleSet({
          tenantId: row.tenant_id,
          membershipId: row.membership_id,
          userId: row.user_id,
        })
      : {
          roles: Object.freeze(row.role_key ? [row.role_key] : []),
          revision: tenantRoleRevision({
            tenantId: row.tenant_id,
            membershipId: row.membership_id,
            authorizationGeneration: row.authorization_generation,
          }),
        };
    return Object.freeze({
      membershipId: row.membership_id,
      identity: Object.freeze({
        userId: row.user_id,
        username: row.username,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
      }),
      status: row.membership_status,
      roles: Object.freeze([...authority.roles]),
      roleRevision: authority.revision,
      joinedAt: row.joined_at,
      updatedAt: row.updated_at,
    });
  }

  private requireActorMembership(
    tenantId: string,
    membershipId: string,
    userId: string,
  ): TenantMembershipRecord {
    this.requireActiveTenant(tenantId);
    const membership = this.requireTenantMembership(tenantId, membershipId);
    if (membership.userId !== userId || membership.status !== 'active') throw forbidden();
    return membership;
  }

  private requireMutationAuthority(
    tenantId: string,
    assertCurrentAuthority: AssertAuthTenantMutationAuthority,
    permissions: readonly PermissionKey[],
  ): AuthTenantMutationAuthority {
    const authority = this.invokeAuthority(assertCurrentAuthority, permissions);
    if (authority.scope.tenantId !== tenantId) throw forbidden();
    this.requireActorMembership(
      tenantId,
      authority.scope.membershipId,
      authority.auth.userId,
    );
    return authority;
  }

  private invokeAuthority(
    assertion: AssertAuthTenantMutationAuthority,
    permissions: readonly PermissionKey[],
  ): AuthTenantMutationAuthority {
    return invokeSynchronousAuthCallback(
      () => assertion(permissions),
      {
        component: 'auth-tenant-administration-service',
        invariant: 'authority-callback-async',
        message: '[auth] Tenant administration authority callback must be synchronous.',
        emitCode: this.emitCode,
      },
    );
  }

  private requireTenantMembership(
    tenantId: string,
    membershipId: string,
  ): TenantMembershipRecord {
    const membership = this.tenancy.getMembershipById(membershipId);
    if (!membership || membership.tenantId !== tenantId) throw memberNotFound();
    return membership;
  }

  private requireActiveTenant(tenantId: string): void {
    const tenant = this.tenancy.getTenant(tenantId);
    if (!tenant || tenant.status !== 'active') throw forbidden();
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

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new AuthError(
      `Member page limit must be between 1 and ${MAX_LIMIT}`,
      'TENANT_MEMBER_PAGE_INVALID',
      422,
    );
  }
  return value;
}

function isDefaultMemberRole(roles: readonly string[]): boolean {
  return roles.length === 1 && roles[0] === 'member';
}

function snapshotMemberCreateRoleSelection(
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

function normalizeSearch(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') {
    throw new AuthError('Member search is invalid', 'TENANT_MEMBER_PAGE_INVALID', 422);
  }
  const normalized = value.trim().toLocaleLowerCase('en-US');
  if (normalized.length > MAX_SEARCH_LENGTH) {
    throw new AuthError('Member search is too long', 'TENANT_MEMBER_PAGE_INVALID', 422);
  }
  return normalized;
}

function normalizeMembershipPageStatus(
  value: unknown,
): TenantMembershipStatus | undefined {
  if (value === undefined) return undefined;
  if (value === 'active' || value === 'suspended' || value === 'removed') {
    return value;
  }
  throw new AuthError(
    'Member status filter is invalid',
    'TENANT_MEMBER_PAGE_INVALID',
    422,
  );
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

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function encodeCursor(cursor: MemberCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: unknown): MemberCursor | null {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > MAX_CURSOR_LENGTH) {
    throw invalidCursor();
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') throw invalidCursor();
    const joinedAt = Reflect.get(parsed, 'joinedAt');
    const membershipId = Reflect.get(parsed, 'membershipId');
    if (!Number.isSafeInteger(joinedAt) || joinedAt < 0
      || typeof membershipId !== 'string' || membershipId.length < 1
      || membershipId.length > 200
      || !/^[A-Za-z0-9_-]+$/.test(membershipId)) throw invalidCursor();
    return { joinedAt, membershipId };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw invalidCursor();
  }
}

function mapAdministrationError(error: unknown): Error {
  if (error instanceof AuthError) return error;
  if (error instanceof TenancyError) {
    switch (error.code) {
      case 'TENANT_MEMBERSHIP_EXISTS':
        return new AuthError(
          'That account already has a retained membership',
          error.code,
          409,
        );
      case 'TENANT_LAST_OWNER':
      case 'TENANT_MEMBERSHIP_STATUS_CONFLICT':
      case 'TENANT_OWNERSHIP_REQUIRED':
      case 'TENANT_OWNERSHIP_TARGET_INVALID':
        return new AuthError(error.message, error.code, 409);
      case 'TENANT_MEMBERSHIP_NOT_FOUND':
      case 'TENANT_NOT_FOUND':
        return memberNotFound();
      case 'TENANT_USER_NOT_FOUND':
        return new AuthError('Account not found', error.code, 404);
      default:
        return new AuthError(error.message, error.code, 422);
    }
  }
  if (error instanceof AuthorizationRoleAssignmentError) {
    const status = error.code === 'AUTHORIZATION_SCOPE_MISMATCH'
      || error.code === 'AUTHORIZATION_SUBJECT_NOT_FOUND'
      ? 404
      : error.code === 'AUTHORIZATION_SYSTEM_ROLE_PROTECTED'
        || error.code === 'AUTHORIZATION_SUBJECT_INACTIVE'
        ? 409
        : 422;
    return new AuthError(error.message, error.code, status);
  }
  return error instanceof Error ? error : new Error('Tenant administration failed');
}

function administrationRoleScopeRequired(roleKey: string): AuthError {
  return new AuthError(
    `Role requires the administration organization: ${roleKey}`,
    'AUTHORIZATION_ADMINISTRATION_SCOPE_REQUIRED',
    422,
  );
}

function administrationRoleRequired(roleKey?: string): AuthError {
  return new AuthError(
    roleKey
      ? `Role is not assignable to the administration organization: ${roleKey}`
      : 'Administration organization members require a platform administration role',
    'AUTHORIZATION_ADMINISTRATION_ROLE_REQUIRED',
    422,
  );
}

function invalidCursor(): AuthError {
  return new AuthError('Member page cursor is invalid', 'TENANT_MEMBER_PAGE_INVALID', 422);
}

function memberNotFound(): AuthError {
  return new AuthError('Tenant member not found', 'TENANT_MEMBER_NOT_FOUND', 404);
}

function roleRevisionRequired(): AuthError {
  return new AuthError(
    'A current role revision is required to replace tenant roles',
    'TENANT_ROLE_REVISION_REQUIRED',
    422,
  );
}

function roleRevisionConflict(): AuthError {
  return new AuthError(
    'Tenant roles changed after this view was loaded; reload and try again',
    'TENANT_ROLE_REVISION_CONFLICT',
    409,
  );
}

function retiredRoleCleanupRequired(): AuthError {
  return new AuthError(
    'Retired tenant roles must be removed by an owner before other roles can change',
    'TENANT_RETIRED_ROLE_CLEANUP_REQUIRED',
    409,
  );
}

function roleEscalationForbidden(): AuthError {
  return new AuthError(
    'A role cannot be changed outside the acting member\'s authority ceiling',
    'TENANT_ROLE_ESCALATION_FORBIDDEN',
    403,
  );
}

function tenantRoleRevision(input: {
  tenantId: string;
  membershipId: string;
  authorizationGeneration: number;
}): string {
  return `tenant:${input.tenantId}:${input.membershipId}:${input.authorizationGeneration}`;
}

function protectedOwnerLifecycle(): AuthError {
  return new AuthError(
    'The owner role can only change through explicit ownership transfer',
    'TENANT_OWNER_ROLE_PROTECTED',
    409,
  );
}

function forbidden(): AuthError {
  return new AuthError('Forbidden', 'FORBIDDEN', 403);
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
