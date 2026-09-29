/** Protected application control plane for customer-organization lifecycles. */

import type { ReactiveDB } from '../sync/reactive-db';
import { OBS_CODES } from '../observability/codes';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import type { AuthorizationKernel } from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import {
  type AssertAuthApplicationMutationAuthority,
  type AuthApplicationMutationAuthority,
} from './auth-application-mutation-authority';
import {
  authAuditActorFromContext,
  captureAuthAuditRequestContext,
} from './auth-audit-service';
import type { AuthAuditService } from './auth-audit-service';
import type { AuthAuditRequestContext } from './auth-audit-types';
import { canonicalizeEmail, isValidEmail } from './auth-email-identity';
import type {
  AuthPlatformTenant,
  AuthPlatformTenantCreateResult,
  AuthPlatformTenantListInput,
  AuthPlatformTenantPage,
  AuthPlatformTenantUpdateResult,
} from './auth-platform-administration-types';
import type {
  AuthTenantMember,
  AuthTenantMemberListInput,
  AuthTenantMemberPage,
} from './auth-tenant-administration-types';
import { normalizeTenantCreateFields, mapTenantCreationError } from './auth-tenant-creation';
import type { TenancyService } from './tenancy/tenancy-service';
import {
  TenancyError,
  type TenantMembershipStatus,
  type TenantRecord,
  type TenantStatus,
} from './tenancy/tenancy-types';
import { AuthError } from './types';
import type { UserStore } from './user-store';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';

interface TenantDirectoryRow {
  tenant_id: string;
  kind: 'organization';
  slug: string;
  name: string;
  status: TenantStatus;
  authorization_generation: number;
  created_at: number;
  updated_at: number;
  suspended_at: number | null;
  member_count: number;
  active_member_count: number;
}

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

interface TenantCursor { createdAt: number; tenantId: string }
interface MemberCursor { joinedAt: number; membershipId: string }

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_SEARCH_LENGTH = 120;
const MAX_CURSOR_LENGTH = 512;

/**
 * Customer-organization directory and lifecycle service.
 *
 * The caller must derive the administration tenant from a live bearer. Every
 * write re-resolves application authority after the SQLite lock and before the
 * first domain mutation. Reads validate query shape first, then require live
 * application authority before resolving targets or materializing projections.
 */
export class AuthPlatformTenantAdministrationService {
  constructor(
    private readonly db: ReactiveDB,
    private readonly kernel: AuthorizationKernel,
    private readonly users: UserStore,
    private readonly tenancy: TenancyService,
    private readonly roles: AuthorizationRoleService | null,
    private readonly audit: AuthAuditService,
    private readonly emitCode: AuthPlatformCodeEmitter,
  ) {}

  listTenants(input: {
    administrationTenantId: string;
    query?: AuthPlatformTenantListInput;
    assertCurrentAuthority: AssertAuthApplicationMutationAuthority;
  }): AuthPlatformTenantPage {
    const administrationTenantId = input.administrationTenantId;
    const assertCurrentAuthority = input.assertCurrentAuthority;
    const query = input.query ?? {};
    const limit = normalizeLimit(query.limit, 'tenant');
    const cursor = decodeTenantCursor(query.cursor);
    const search = normalizeSearch(query.search, 'tenant');
    const status = normalizeTenantPageStatus(query.status);
    this.users.assertCurrentProfile();
    this.requireApplicationAuthority(
      administrationTenantId,
      assertCurrentAuthority,
      ['application.tenants:read'],
    );
    const clauses = ["tenant.kind = 'organization'"];
    const args: Array<string | number> = [];
    if (status) {
      clauses.push('tenant.status = ?');
      args.push(status);
    }
    if (search) {
      clauses.push(`(
        lower(tenant.slug) LIKE ? ESCAPE '\\'
        OR lower(tenant.name) LIKE ? ESCAPE '\\'
      )`);
      const pattern = `%${escapeLike(search)}%`;
      args.push(pattern, pattern);
    }
    if (cursor) {
      clauses.push(`(
        tenant.created_at > ?
        OR (tenant.created_at = ? AND tenant.tenant_id > ?)
      )`);
      args.push(cursor.createdAt, cursor.createdAt, cursor.tenantId);
    }
    const rows = this.db.prepare(`
      SELECT tenant.tenant_id, tenant.kind, tenant.slug, tenant.name,
        tenant.status, tenant.authorization_generation, tenant.created_at,
        tenant.updated_at, tenant.suspended_at,
        COUNT(membership.membership_id) AS member_count,
        COALESCE(SUM(CASE WHEN membership.status = 'active' THEN 1 ELSE 0 END), 0)
          AS active_member_count
      FROM _auth_tenants tenant
      LEFT JOIN _auth_tenant_memberships membership
        ON membership.tenant_id = tenant.tenant_id
      WHERE ${clauses.join(' AND ')}
      GROUP BY tenant.tenant_id
      ORDER BY tenant.created_at ASC, tenant.tenant_id ASC
      LIMIT ?
    `).all(...args, limit + 1) as TenantDirectoryRow[];
    const hasMore = rows.length > limit;
    const selected = hasMore ? rows.slice(0, limit) : rows;
    const tenants = selected.map(mapTenantDirectoryRow);
    const last = selected.at(-1);
    return Object.freeze({
      tenants: Object.freeze(tenants),
      page: Object.freeze({
        limit,
        count: tenants.length,
        hasMore,
        nextCursor: hasMore && last
          ? encodeCursor({ createdAt: last.created_at, tenantId: last.tenant_id })
          : null,
      }),
    });
  }

  createTenant(input: {
    administrationTenantId: string;
    name: string;
    slug?: string;
    ownerEmail: string;
    assertCurrentAuthority: AssertAuthApplicationMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): AuthPlatformTenantCreateResult {
    const administrationTenantId = input.administrationTenantId;
    const assertCurrentAuthority = input.assertCurrentAuthority;
    const auditRequest = captureAuthAuditRequestContext(input.auditRequest);
    const fields = normalizeTenantCreateFields(input.name, input.slug);
    const email = canonicalizeEmail(input.ownerEmail);
    if (!isValidEmail(email)) {
      throw new AuthError('Invalid email address', 'INVALID_EMAIL', 422);
    }
    try {
      const result = this.db.transaction(() => {
        this.users.assertCurrentProfile();
        this.lockTenant(administrationTenantId);
        const authority = this.requireApplicationAuthority(
          administrationTenantId,
          assertCurrentAuthority,
          ['application.tenants:manage', 'application.users:read'],
        );
        const owner = this.users.getUserByEmail(email);
        if (!owner) {
          throw new AuthError(
            'No existing account matches that exact email address',
            'TENANT_OWNER_SUBJECT_NOT_FOUND',
            404,
          );
        }
        const created = this.tenancy.createTenant({
          ...fields,
          kind: 'organization',
          ownerUserId: owner.userId,
          createdBy: authority.auth.userId,
        });
        this.audit.append({
          action: 'application.tenant-created',
          outcome: 'succeeded',
          scope: { kind: 'application' },
          actor: authAuditActorFromContext(authority.auth),
          request: auditRequest,
          target: { type: 'tenant', id: created.tenant.tenantId },
          metadata: { kind: 'organization' },
        });
        const tenantId = created.tenant.tenantId;
        const kind = created.tenant.kind;
        this.db.afterCommit(() => this.emitCode(OBS_CODES.AUTH_TENANT_CREATED, {
          metadata: { tenantId, kind },
        }));
        return created;
      });
      return Object.freeze({
        tenant: this.projectTenant(result.tenant.tenantId),
        owner: this.getMember(result.tenant.tenantId, result.ownerMembership.membershipId),
      });
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw mapTenantCreationError(error);
    }
  }

  updateTenant(input: {
    administrationTenantId: string;
    tenantId: string;
    status: Extract<TenantStatus, 'active' | 'suspended'>;
    expectedAuthorizationGeneration: number;
    assertCurrentAuthority: AssertAuthApplicationMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): AuthPlatformTenantUpdateResult {
    const administrationTenantId = input.administrationTenantId;
    const tenantId = input.tenantId;
    const expectedAuthorizationGeneration = input.expectedAuthorizationGeneration;
    const assertCurrentAuthority = input.assertCurrentAuthority;
    const auditRequest = captureAuthAuditRequestContext(input.auditRequest);
    const status = normalizeTenantUpdateStatus(input.status);
    if (!Number.isSafeInteger(expectedAuthorizationGeneration)
      || expectedAuthorizationGeneration < 0) {
      throw new AuthError(
        'Tenant authorization generation is invalid',
        'TENANT_AUTHORIZATION_GENERATION_INVALID',
        422,
      );
    }
    try {
      this.db.transaction(() => {
        this.users.assertCurrentProfile();
        this.lockTenant(tenantId);
        const authority = this.requireApplicationAuthority(
          administrationTenantId,
          assertCurrentAuthority,
          ['application.tenants:manage'],
        );
        const current = this.requireCustomerTenant(tenantId);
        // A completed retry is idempotent even if it carries the generation
        // observed before the original successful transition.
        if (current.status === status) return;
        if (current.authorizationGeneration !== expectedAuthorizationGeneration) {
          throw new AuthError(
            'Tenant lifecycle changed after this view was loaded; reload and try again',
            'TENANT_AUTHORIZATION_GENERATION_CONFLICT',
            409,
          );
        }
        const updated = status === 'active'
          ? this.tenancy.reactivateTenant(tenantId)
          : this.tenancy.suspendTenant(tenantId);
        this.audit.append({
          action: status === 'active'
            ? 'application.tenant-reactivated'
            : 'application.tenant-suspended',
          outcome: 'succeeded',
          scope: { kind: 'application' },
          actor: authAuditActorFromContext(authority.auth),
          request: auditRequest,
          target: { type: 'tenant', id: updated.tenantId },
          metadata: { status: updated.status },
        });
        const updatedTenantId = updated.tenantId;
        const eventCode = updated.status === 'active'
          ? OBS_CODES.AUTH_TENANT_REACTIVATED
          : OBS_CODES.AUTH_TENANT_SUSPENDED;
        this.db.afterCommit(() => this.emitCode(eventCode, {
          metadata: { tenantId: updatedTenantId },
        }));
      });
      const tenant = this.projectTenant(tenantId);
      return Object.freeze({ tenant });
    } catch (error) {
      throw mapPlatformTenancyError(error);
    }
  }

  listTenantMembers(input: {
    administrationTenantId: string;
    tenantId: string;
    query?: AuthTenantMemberListInput;
    assertCurrentAuthority: AssertAuthApplicationMutationAuthority;
  }): AuthTenantMemberPage {
    const administrationTenantId = input.administrationTenantId;
    const tenantId = input.tenantId;
    const assertCurrentAuthority = input.assertCurrentAuthority;
    const query = input.query ?? {};
    const limit = normalizeLimit(query.limit, 'member');
    const cursor = decodeMemberCursor(query.cursor);
    const search = normalizeSearch(query.search, 'member');
    const status = normalizeMemberPageStatus(query.status);
    this.users.assertCurrentProfile();
    this.requireApplicationAuthority(
      administrationTenantId,
      assertCurrentAuthority,
      ['application.tenants:read', 'application.users:read'],
    );
    this.requireCustomerTenant(tenantId);
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
    return Object.freeze({
      members,
      page: Object.freeze({
        limit,
        count: members.length,
        hasMore,
        nextCursor: hasMore && last
          ? encodeCursor({ joinedAt: last.joined_at, membershipId: last.membership_id })
          : null,
      }),
    });
  }

  private projectTenant(tenantId: string): AuthPlatformTenant {
    const row = this.db.prepare(`
      SELECT tenant.tenant_id, tenant.kind, tenant.slug, tenant.name,
        tenant.status, tenant.authorization_generation, tenant.created_at,
        tenant.updated_at, tenant.suspended_at,
        COUNT(membership.membership_id) AS member_count,
        COALESCE(SUM(CASE WHEN membership.status = 'active' THEN 1 ELSE 0 END), 0)
          AS active_member_count
      FROM _auth_tenants tenant
      LEFT JOIN _auth_tenant_memberships membership
        ON membership.tenant_id = tenant.tenant_id
      WHERE tenant.tenant_id = ? AND tenant.kind = 'organization'
      GROUP BY tenant.tenant_id
    `).get(tenantId) as TenantDirectoryRow | null;
    if (!row) throw tenantNotFound();
    return mapTenantDirectoryRow(row);
  }

  private getMember(tenantId: string, membershipId: string): AuthTenantMember {
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
    if (!row) throw new AuthError('Tenant member not found', 'TENANT_MEMBER_NOT_FOUND', 404);
    return this.mapMember(row);
  }

  private mapMember(row: MemberRow): AuthTenantMember {
    const authority = this.kernel.authorization.mode === 'advanced'
      ? this.requireRoleService().getRetainedTenantRoleSet({
          tenantId: row.tenant_id,
          membershipId: row.membership_id,
          userId: row.user_id,
        })
      : {
          roles: Object.freeze(row.role_key ? [row.role_key] : []),
          revision: `tenant:${row.tenant_id}:${row.membership_id}:${row.authorization_generation}`,
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

  private lockTenant(tenantId: string): void {
    this.db.prepare(
      'UPDATE _auth_tenants SET updated_at = updated_at WHERE tenant_id = ?',
    ).run(tenantId);
  }

  private requireApplicationAuthority(
    administrationTenantId: string,
    assertCurrentAuthority: AssertAuthApplicationMutationAuthority,
    permissions: Parameters<AssertAuthApplicationMutationAuthority>[0],
  ): AuthApplicationMutationAuthority {
    const authority = invokeSynchronousAuthCallback(
      () => assertCurrentAuthority(permissions),
      {
        component: 'auth-platform-tenant-administration-service',
        invariant: 'authority-callback-async',
        message: '[auth] Platform tenant authority callback must be synchronous.',
        emitCode: this.emitCode,
      },
    );
    if (authority.auth.tenantId !== administrationTenantId
      || authority.auth.tenantKind !== 'administration') throw forbidden();
    this.requireAdministrationTenant(administrationTenantId);
    return authority;
  }

  private requireAdministrationTenant(tenantId: string): TenantRecord {
    const tenant = this.tenancy.getTenant(tenantId);
    if (!tenant || tenant.kind !== 'administration' || tenant.status !== 'active') {
      throw forbidden();
    }
    return tenant;
  }

  private requireCustomerTenant(tenantId: string): TenantRecord {
    const tenant = this.tenancy.getTenant(tenantId);
    if (!tenant || tenant.kind !== 'organization') throw tenantNotFound();
    return tenant;
  }

  private requireRoleService(): AuthorizationRoleService {
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

function mapTenantDirectoryRow(row: TenantDirectoryRow): AuthPlatformTenant {
  return Object.freeze({
    tenantId: row.tenant_id,
    kind: 'organization' as const,
    slug: row.slug,
    name: row.name,
    status: row.status,
    authorizationGeneration: row.authorization_generation,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    suspendedAt: row.suspended_at,
    memberCount: row.member_count,
    activeMemberCount: row.active_member_count,
  });
}

function normalizeLimit(value: number | undefined, subject: string): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new AuthError(
      `${capitalize(subject)} page limit must be between 1 and ${MAX_LIMIT}`,
      'PLATFORM_TENANT_PAGE_INVALID',
      422,
    );
  }
  return value;
}

function normalizeSearch(value: unknown, subject: string): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') {
    throw new AuthError(
      `${capitalize(subject)} search is invalid`,
      'PLATFORM_TENANT_PAGE_INVALID',
      422,
    );
  }
  const search = value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  if (search.length > MAX_SEARCH_LENGTH) {
    throw new AuthError(
      `${capitalize(subject)} search is too long`,
      'PLATFORM_TENANT_PAGE_INVALID',
      422,
    );
  }
  return search;
}

function normalizeTenantPageStatus(value: unknown): TenantStatus | undefined {
  if (value === undefined) return undefined;
  if (value === 'active' || value === 'suspended' || value === 'archived') {
    return value;
  }
  throw new AuthError(
    'Tenant status filter is invalid',
    'PLATFORM_TENANT_PAGE_INVALID',
    422,
  );
}

function normalizeTenantUpdateStatus(
  value: unknown,
): Extract<TenantStatus, 'active' | 'suspended'> {
  if (value === 'active' || value === 'suspended') return value;
  throw new AuthError(
    'Tenant status must be active or suspended',
    'PLATFORM_TENANT_STATUS_INVALID',
    422,
  );
}

function normalizeMemberPageStatus(
  value: unknown,
): TenantMembershipStatus | undefined {
  if (value === undefined) return undefined;
  if (value === 'active' || value === 'suspended' || value === 'removed') {
    return value;
  }
  throw new AuthError(
    'Member status filter is invalid',
    'PLATFORM_TENANT_PAGE_INVALID',
    422,
  );
}

function decodeTenantCursor(value: unknown): TenantCursor | null {
  const parsed = decodeCursor(value);
  if (!parsed) return null;
  const createdAt = Reflect.get(parsed, 'createdAt');
  const tenantId = Reflect.get(parsed, 'tenantId');
  if (!Number.isSafeInteger(createdAt) || createdAt < 0
    || !isOpaqueId(tenantId)) throw invalidCursor();
  return { createdAt, tenantId };
}

function decodeMemberCursor(value: unknown): MemberCursor | null {
  const parsed = decodeCursor(value);
  if (!parsed) return null;
  const joinedAt = Reflect.get(parsed, 'joinedAt');
  const membershipId = Reflect.get(parsed, 'membershipId');
  if (!Number.isSafeInteger(joinedAt) || joinedAt < 0
    || !isOpaqueId(membershipId)) throw invalidCursor();
  return { joinedAt, membershipId };
}

function decodeCursor(value: unknown): object | null {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > MAX_CURSOR_LENGTH) {
    throw invalidCursor();
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalidCursor();
    return parsed;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw invalidCursor();
  }
}

function encodeCursor(value: TenantCursor | MemberCursor): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function isOpaqueId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 200
    && /^[A-Za-z0-9_-]+$/.test(value);
}

function mapPlatformTenancyError(error: unknown): Error {
  if (error instanceof AuthError) return error;
  if (error instanceof TenancyError) {
    if (error.code === 'TENANT_NOT_FOUND') return tenantNotFound();
    if (error.code === 'TENANT_ADMINISTRATION_PROTECTED') return forbidden();
    if (error.code === 'TENANT_LAST_OWNER'
      || error.code === 'TENANT_STATUS_CONFLICT'
      || error.code === 'TENANT_USABLE_OWNER_REQUIRED') {
      return new AuthError(error.message, error.code, 409);
    }
    return new AuthError(error.message, error.code, 422);
  }
  return error instanceof Error ? error : new Error('Platform tenant administration failed');
}

function invalidCursor(): AuthError {
  return new AuthError(
    'Platform tenant page cursor is invalid',
    'PLATFORM_TENANT_PAGE_INVALID',
    422,
  );
}

function tenantNotFound(): AuthError {
  return new AuthError('Customer organization not found', 'TENANT_NOT_FOUND', 404);
}

function forbidden(): AuthError {
  return new AuthError('Forbidden', 'FORBIDDEN', 403);
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
