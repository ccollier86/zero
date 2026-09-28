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
  type TenantRoleGrantCeiling,
} from './auth-tenant-administration-types';
import type {
  AssertAuthTenantMutationAuthority,
  AuthTenantMutationAuthority,
} from './auth-tenant-mutation-authority';
import { AuthError, type PermissionKey } from './types';
import type { UserStore } from './user-store';
import { AuthAuditService, authAuditActorFromContext } from './auth-audit-service';
import type { AuthAuditRequestContext } from './auth-audit-types';
import type { TenancyService } from './tenancy/tenancy-service';
import {
  TENANT_OWNER_ROLE_KEY,
  TenancyError,
  type TenantMembershipRecord,
  type TenantMembershipStatus,
} from './tenancy/tenancy-types';

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
  ) {
    this.lockTenant = db.prepare(
      'UPDATE _auth_tenants SET updated_at = updated_at WHERE tenant_id = ?',
    );
  }

  getConfig(input: {
    tenantId: string;
    membershipId: string;
    scope: AuthorizationScopeSnapshot;
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
    const ceiling: TenantRoleGrantCeiling = {
      allPermissions: input.scope.allPermissions === true,
      permissions,
    };
    const roleDescriptors = Object.values(this.kernel.authorization.roles)
      .sort((left, right) => compareKeys(left.key, right.key))
      .map((role) => Object.freeze({
        key: role.key,
        label: role.label,
        ...(role.description ? { description: role.description } : {}),
        permissions: Object.freeze([...role.permissions]),
        allPermissions: role.allPermissions,
        system: role.system,
        assignable: !role.system,
        grantable: !role.system && canManageRoles && this.canGrantRole(ceiling, role.key),
      }));

    return Object.freeze({
      tenancy: 'multi',
      authorization: this.kernel.authorization.mode,
      terminology: this.kernel.tenancy.terminology,
      tenant: Object.freeze({
        tenantId: tenant.tenantId,
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
        canReviewJoinRequests: can('tenant.join-requests:review'),
      }),
      roles: Object.freeze(roleDescriptors),
    });
  }

  listMembers(
    tenantId: string,
    input: AuthTenantMemberListInput = {},
  ): AuthTenantMemberPage {
    this.users.assertCurrentProfile();
    this.requireActiveTenant(tenantId);
    const limit = normalizeLimit(input.limit);
    const cursor = decodeCursor(input.cursor);
    const search = normalizeSearch(input.search);
    const clauses = ['membership.tenant_id = ?'];
    const args: Array<string | number> = [tenantId];
    if (input.status) {
      clauses.push('membership.status = ?');
      args.push(input.status);
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
    return {
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
  }

  addMember(input: {
    tenantId: string;
    email: string;
    roleKeys: readonly string[];
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): AuthTenantMemberMutationResult {
    const email = canonicalizeEmail(input.email);
    if (!isValidEmail(email)) {
      throw new AuthError('Invalid email address', 'INVALID_EMAIL', 422);
    }

    try {
      const membership = this.db.transaction(() => {
        this.users.assertCurrentProfile();
        this.lockTenant.run(input.tenantId);
        const authority = this.requireMutationAuthority(
          input.tenantId,
          input.assertCurrentAuthority,
          isDefaultMemberRole(input.roleKeys)
            ? ['tenant.members:manage']
            : ['tenant.members:manage', 'tenant.roles:manage'],
        );
        const roleKeys = this.normalizeDesiredRoleKeys(input.roleKeys, []);
        for (const roleKey of roleKeys) {
          if (!this.canGrantRole(authority.scope, roleKey)) {
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
          tenantId: input.tenantId,
          userId: user.userId,
          roleKey: 'member',
          createdBy: authority.auth.userId,
        });
        if (this.kernel.authorization.mode === 'advanced') {
          this.requireAdvancedRoles().replaceTenantRoles({
            tenantId: input.tenantId,
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
          scope: { kind: 'tenant', tenantId: input.tenantId },
          actor: authAuditActorFromContext(authority.auth),
          request: input.auditRequest,
          target: { type: 'tenant-membership', id: persisted.membershipId },
          metadata: { 'role-count': roleKeys.length },
        });
        return persisted;
      });
      return {
        member: this.getMember(input.tenantId, membership.membershipId),
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
    try {
      const result = this.db.transaction(() => {
        this.users.assertCurrentProfile();
        this.lockTenant.run(input.tenantId);
        const authority = this.requireMutationAuthority(
          input.tenantId,
          input.assertCurrentAuthority,
          input.roleKeys === undefined
            ? ['tenant.members:manage']
            : ['tenant.members:manage', 'tenant.roles:manage'],
        );
        const current = this.requireTenantMembership(input.tenantId, input.membershipId);
        if (current.roleKey === TENANT_OWNER_ROLE_KEY) throw protectedOwnerLifecycle();
        if (current.status === 'removed') {
          throw new AuthError(
            'Removed memberships require a separate re-admission flow',
            'TENANT_MEMBERSHIP_STATUS_CONFLICT',
            409,
          );
        }
        const replacement = input.roleKeys === undefined
          ? null
          : this.prepareRoleReplacement({
              tenantId: input.tenantId,
              membership: current,
              roleKeys: input.roleKeys,
              expectedRevision: input.expectedRoleRevision,
              authority,
            });
        const roleKeys = replacement?.roleKeys;
        if ((input.status === 'active' || roleKeys !== undefined)
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
        if (input.status && membership.status !== input.status) {
          membership = input.status === 'active'
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
              tenantId: input.tenantId,
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
          scope: { kind: 'tenant', tenantId: input.tenantId },
          actor: authAuditActorFromContext(authority.auth),
          request: input.auditRequest,
          target: { type: 'tenant-membership', id: changed.membershipId },
          metadata: {
            status: changed.status,
            'status-changed': changed.status !== current.status,
            'roles-requested': input.roleKeys !== undefined,
          },
        });
        return {
          changed,
          current,
          actorMembershipId: authority.scope.membershipId,
        };
      });
      return {
        member: this.getMember(input.tenantId, result.changed.membershipId),
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
    try {
      const result = this.db.transaction(() => {
        this.users.assertCurrentProfile();
        this.lockTenant.run(input.tenantId);
        const authority = this.requireMutationAuthority(
          input.tenantId,
          input.assertCurrentAuthority,
          ['tenant.members:manage'],
        );
        const current = this.requireTenantMembership(input.tenantId, input.membershipId);
        if (current.roleKey === TENANT_OWNER_ROLE_KEY) throw protectedOwnerLifecycle();
        const removed = this.tenancy.removeMembership(current.membershipId);
        this.audit.append({
          action: 'tenant.member-removed',
          outcome: 'succeeded',
          scope: { kind: 'tenant', tenantId: input.tenantId },
          actor: authAuditActorFromContext(authority.auth),
          request: input.auditRequest,
          target: { type: 'tenant-membership', id: removed.membershipId },
        });
        return {
          removed,
          current,
          actorMembershipId: authority.scope.membershipId,
        };
      });
      return {
        member: this.getMember(input.tenantId, result.removed.membershipId),
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
    try {
      const transferred = this.db.transaction(() => {
        this.users.assertCurrentProfile();
        this.lockTenant.run(input.tenantId);
        const authority = this.requireMutationAuthority(
          input.tenantId,
          input.assertCurrentAuthority,
          ['tenant.roles:manage'],
        );
        const actor = this.requireActorMembership(
          input.tenantId,
          authority.scope.membershipId,
          authority.auth.userId,
        );
        if (actor.roleKey !== TENANT_OWNER_ROLE_KEY) throw forbidden();
        this.requireTenantMembership(input.tenantId, input.targetMembershipId);
        const result = this.tenancy.transferOwnership(
          actor.membershipId,
          input.targetMembershipId,
        );
        if (this.kernel.authorization.mode === 'advanced') {
          // The protected owner assignment follows the store marker through
          // its atomic owner hook. Also ensure the former owner retains Zero's
          // ordinary member role; keep any other assignable roles intact.
          this.requireAdvancedRoles().assignTenantRole({
            tenantId: input.tenantId,
            membershipId: result.previousOwnerMembership.membershipId,
            roleKey: 'member',
            createdBy: authority.auth.userId,
            sourceId: 'tenant-ownership-transfer',
          });
        }
        this.audit.append({
          action: 'tenant.ownership-transferred',
          outcome: 'succeeded',
          scope: { kind: 'tenant', tenantId: input.tenantId },
          actor: authAuditActorFromContext(authority.auth),
          request: input.auditRequest,
          target: {
            type: 'tenant-membership',
            id: result.ownerMembership.membershipId,
          },
        });
        return result;
      });
      return {
        owner: this.getMember(input.tenantId, transferred.ownerMembership.membershipId),
        previousOwner: this.getMember(
          input.tenantId,
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
      if (!this.canGrantRole(input.authority.scope, roleKey)) {
        throw roleEscalationForbidden();
      }
    }
    if (roleKeys.some((roleKey) => !this.kernel.authorization.roles[roleKey])) {
      throw retiredRoleCleanupRequired();
    }
    return { roleKeys, changed: true };
  }

  private normalizeDesiredRoleKeys(
    input: readonly string[],
    current: readonly string[],
  ): readonly string[] {
    if (!Array.isArray(input) || input.length > 32
      || input.some((value) => typeof value !== 'string')) {
      throw new AuthError('Role selection is invalid', 'TENANT_ROLE_SELECTION_INVALID', 422);
    }
    const keys = [...new Set(input.map((value) => value.trim()).filter(Boolean))]
      .sort(compareKeys);
    const currentSet = new Set(current);
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
    }
    return Object.freeze(keys);
  }

  private canGrantRole(
    ceiling: Pick<AuthorizationScopeSnapshot, 'allPermissions' | 'permissions'>,
    roleKey: string,
  ): boolean {
    const role = this.kernel.authorization.roles[roleKey];
    if (!role || role.system) return false;
    if (ceiling.allPermissions) return true;
    if (role.allPermissions) return false;
    const permissions = new Set(ceiling.permissions);
    return role.permissions.every((permission) => permissions.has(permission));
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
    const authority = assertCurrentAuthority(permissions);
    if (authority.scope.tenantId !== tenantId) throw forbidden();
    this.requireActorMembership(
      tenantId,
      authority.scope.membershipId,
      authority.auth.userId,
    );
    return authority;
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

function normalizeSearch(value: string | undefined): string {
  if (value === undefined) return '';
  const normalized = value.trim().toLocaleLowerCase('en-US');
  if (normalized.length > MAX_SEARCH_LENGTH) {
    throw new AuthError('Member search is too long', 'TENANT_MEMBER_PAGE_INVALID', 422);
  }
  return normalized;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function encodeCursor(cursor: MemberCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string | undefined): MemberCursor | null {
  if (!value) return null;
  if (value.length > MAX_CURSOR_LENGTH) throw invalidCursor();
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') throw invalidCursor();
    const joinedAt = Reflect.get(parsed, 'joinedAt');
    const membershipId = Reflect.get(parsed, 'membershipId');
    if (!Number.isSafeInteger(joinedAt) || joinedAt < 0
      || typeof membershipId !== 'string' || membershipId.length < 1
      || membershipId.length > 200) throw invalidCursor();
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
