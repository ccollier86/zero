import type { ReactiveDB } from '../sync/reactive-db';
import type { AuthorizationKernel, AuthorizationScopeSnapshot } from './authorization-kernel';
import {
  canGrantAuthorizationRole,
  roleGrantCeilingFromAuthority,
} from './authorization-role-grant';
import { isAdministrationOnlyRole, isRoleAssignableToTenantKind } from './authorization-registry';
import type { AuthTenantAdministrationAuthority } from './auth-tenant-administration-authority';
import { tenantAdministrationForbidden } from './auth-tenant-administration-errors';
import type { AuthTenantAdministrationRolePolicy } from './auth-tenant-administration-role-policy';
import { tenantRoleRevision } from './auth-tenant-administration-role-policy';
import type {
  AuthTenantAdministrationConfig,
  AuthTenantMember,
  AuthTenantMemberListInput,
  AuthTenantMemberPage,
} from './auth-tenant-administration-types';
import type { AssertAuthTenantMutationAuthority } from './auth-tenant-mutation-authority';
import { AuthError, type PermissionKey } from './types';
import type { TenancyService } from './tenancy/tenancy-service';
import { TENANT_OWNER_ROLE_KEY, type TenantMembershipStatus } from './tenancy/tenancy-types';

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

/** Read-only member projections and actor-specific tenant-control configuration. */
export class AuthTenantAdministrationReadModel {
  constructor(
    private readonly db: ReactiveDB,
    private readonly kernel: AuthorizationKernel,
    private readonly tenancy: TenancyService,
    private readonly authority: AuthTenantAdministrationAuthority,
    private readonly rolePolicy: AuthTenantAdministrationRolePolicy,
  ) {}

  getConfig(input: {
    tenantId: string;
    membershipId: string;
    scope: AuthorizationScopeSnapshot;
    applicationScope?: AuthorizationScopeSnapshot | null;
    assertCurrentAuthority?: AssertAuthTenantMutationAuthority;
  }): AuthTenantAdministrationConfig {
    this.authority.assertCurrentProfile();
    if (input.scope.scopeKind !== 'tenant'
      || input.scope.tenantId !== input.tenantId
      || input.scope.membershipId !== input.membershipId) {
      throw tenantAdministrationForbidden();
    }
    const tenant = this.tenancy.getTenant(input.tenantId);
    const membership = this.authority.requireTenantMembership(
      input.tenantId,
      input.membershipId,
    );
    if (!tenant || tenant.status !== 'active' || membership.status !== 'active') {
      throw tenantAdministrationForbidden();
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

    const result: AuthTenantAdministrationConfig = Object.freeze({
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
      this.authority.invoke(input.assertCurrentAuthority, []);
    }
    return result;
  }

  listMembers(
    tenantId: string,
    input: AuthTenantMemberListInput = {},
    assertCurrentAuthority?: AssertAuthTenantMutationAuthority,
  ): AuthTenantMemberPage {
    this.authority.assertCurrentProfile();
    this.authority.requireActiveTenant(tenantId);
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
      this.authority.invoke(assertCurrentAuthority, ['tenant.members:read']);
    }
    return result;
  }

  getMember(tenantId: string, membershipId: string): AuthTenantMember {
    this.authority.assertCurrentProfile();
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
    if (!row) throw new AuthError(
      'Tenant member not found',
      'TENANT_MEMBER_NOT_FOUND',
      404,
    );
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

  private requireAdvancedRoles() {
    return this.rolePolicy.requireAdvancedRoles();
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

function invalidCursor(): AuthError {
  return new AuthError('Member page cursor is invalid', 'TENANT_MEMBER_PAGE_INVALID', 422);
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
