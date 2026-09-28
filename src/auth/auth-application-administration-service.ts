import type { ReactiveDB } from '../sync/reactive-db';
import type { AuthorizationKernel } from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import { AuthorizationRoleAssignmentError } from './authorization-role-types';
import {
  type AuthApplicationAdministrationConfig,
  type AuthApplicationOwnershipTransferResult,
  type AuthApplicationRoleMutationResult,
  type AuthApplicationUser,
  type AuthApplicationUserListInput,
  type AuthApplicationUserPage,
} from './auth-application-administration-types';
import {
  AuthError,
  type AuthContext,
  type PermissionKey,
  type UserStatus,
} from './types';
import type { UserStore } from './user-store';
import type { AuthAuditRequestContext } from './auth-audit-types';
import { AuthAuditService } from './auth-audit-service';
import {
  staleApplicationAuthority,
  type AssertAuthApplicationMutationAuthority,
} from './auth-application-mutation-authority';

interface ApplicationUserRow {
  user_id: string;
  username: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  status: UserStatus;
  created_at: number;
  updated_at: number | null;
}

interface ApplicationUserCursor {
  createdAt: number;
  userId: string;
}

interface GrantCeiling {
  allPermissions: boolean;
  permissions: readonly PermissionKey[];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_SEARCH_LENGTH = 120;
const MAX_CURSOR_LENGTH = 512;
const MAX_ROLE_SELECTION = 128;
const OWNER_ROLE = 'owner';

/**
 * Headless single-application access control plane.
 *
 * This service is intentionally separate from global account administration:
 * platform roles and account-security state never confer application authority
 * and are never returned by this surface.
 */
export class AuthApplicationAdministrationService {
  constructor(
    private readonly db: ReactiveDB,
    private readonly kernel: AuthorizationKernel,
    private readonly users: UserStore,
    private readonly roles: AuthorizationRoleService,
    private readonly audit: AuthAuditService,
  ) {}

  getConfig(actorUserId: string): AuthApplicationAdministrationConfig {
    return this.db.transaction(() => {
      this.users.assertCurrentProfile();
      const actor = this.requireActorPermission(actorUserId, 'application.roles:read');
      const ceiling = grantCeiling(actor);
      const permissions = Object.freeze([...actor.permissions].sort(compareKeys));
      const descriptors = Object.values(this.kernel.authorization.roles)
        .sort((left, right) => compareKeys(left.key, right.key))
        .map((role) => Object.freeze({
          key: role.key,
          label: role.label,
          ...(role.description ? { description: role.description } : {}),
          permissions: Object.freeze([...role.permissions]),
          allPermissions: role.allPermissions,
          system: role.system,
          assignable: !role.system,
          grantable: !role.system && this.canGrantRole(ceiling, role.key),
        }));

      return Object.freeze({
        authorization: 'advanced' as const,
        actor: Object.freeze({
          userId: actor.userId,
          roles: Object.freeze([...actor.roles]),
          permissions,
          allPermissions: actor.allPermissions,
        }),
        capabilities: Object.freeze({
          canReadUsers: hasPermission(actor, 'application.roles:read'),
          canManageRoles: hasPermission(actor, 'application.roles:manage'),
          canTransferOwnership: actor.roles.includes(OWNER_ROLE),
        }),
        roles: Object.freeze(descriptors),
      });
    });
  }

  listUsers(
    actorUserId: string,
    input: AuthApplicationUserListInput = {},
  ): AuthApplicationUserPage {
    return this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.requireActorPermission(actorUserId, 'application.roles:read');
      const limit = normalizeLimit(input.limit);
      const cursor = decodeCursor(input.cursor);
      const search = normalizeSearch(input.search);
      const clauses: string[] = [];
      const args: Array<string | number> = [];
      if (input.status) {
        if (input.status !== 'active' && input.status !== 'suspended') {
          throw new AuthError(
            'Application user status filter is invalid',
            'APPLICATION_USER_PAGE_INVALID',
            422,
          );
        }
        clauses.push('identity.status = ?');
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
          identity.created_at > ?
          OR (identity.created_at = ? AND identity.user_id > ?)
        )`);
        args.push(cursor.createdAt, cursor.createdAt, cursor.userId);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = this.db.prepare(`
        SELECT identity.user_id, identity.username, identity.email,
          identity.first_name, identity.last_name, identity.status,
          identity.created_at, identity.updated_at
        FROM users identity
        ${where}
        ORDER BY identity.created_at ASC, identity.user_id ASC
        LIMIT ?
      `).all(...args, limit + 1) as ApplicationUserRow[];
      const hasMore = rows.length > limit;
      const selected = hasMore ? rows.slice(0, limit) : rows;
      const users = selected.map((row) => this.mapUser(row));
      const last = selected.at(-1);
      return Object.freeze({
        users: Object.freeze(users),
        page: Object.freeze({
          limit,
          count: users.length,
          hasMore,
          nextCursor: hasMore && last
            ? encodeCursor({ createdAt: last.created_at, userId: last.user_id })
            : null,
        }),
      });
    });
  }

  replaceUserRoles(input: {
    actorUserId: string;
    assertCurrentAuthority: AssertAuthApplicationMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
    userId: string;
    roleKeys: readonly string[];
    expectedRevision: string;
  }): AuthApplicationRoleMutationResult {
    return this.db.transaction(() => {
      this.users.assertCurrentProfile();
      // This live authority read and the assignment writes below share one
      // SQLite transaction. A stale request snapshot can never win the race.
      const authority = input.assertCurrentAuthority(['application.roles:manage']);
      if (authority.auth.userId !== input.actorUserId) {
        throw staleApplicationAuthority();
      }
      const actorUserId = authority.auth.userId;
      const actor = this.requireActorPermission(
        actorUserId,
        'application.roles:manage',
      );
      const target = this.requireUser(input.userId);
      const currentAuthority = this.roles.getRetainedApplicationRoleSet(input.userId);
      if (input.expectedRevision !== currentAuthority.revision) {
        throw revisionConflict();
      }
      const current = currentAuthority.roles;
      const desired = this.normalizeDesiredRoles(input.roleKeys, current);
      const currentAssignable = current.filter((roleKey) => (
        this.kernel.authorization.roles[roleKey]?.system !== true
      ));
      const currentSet = new Set(currentAssignable);
      const desiredSet = new Set(desired);
      const changedKeys = new Set([
        ...desired.filter((roleKey) => !currentSet.has(roleKey)),
        ...currentAssignable.filter((roleKey) => !desiredSet.has(roleKey)),
      ]);
      if (changedKeys.size === 0) {
        this.audit.append({
          action: 'application.roles-replaced',
          outcome: 'succeeded',
          scope: { kind: 'application' },
          actor: auditActor(actorUserId, authority.auth),
          request: input.auditRequest,
          target: { type: 'user', id: input.userId },
          metadata: { changed: false, 'role-count': desired.length },
        });
        return Object.freeze({
          user: this.getUser(input.userId),
          actorAuthorizationChanged: false,
        });
      }
      const ceiling = grantCeiling(actor);
      for (const roleKey of changedKeys) {
        if (!this.kernel.authorization.roles[roleKey]) {
          // A removed role is inert and may only be cleaned up by an owner.
          // normalizeDesiredRoles() guarantees it can never be newly granted.
          if (!actor.roles.includes(OWNER_ROLE)) throw escalationForbidden();
          continue;
        }
        if (!this.canGrantRole(ceiling, roleKey)) throw escalationForbidden();
      }
      const retainedRetiredRole = desired.some(
        (roleKey) => !this.kernel.authorization.roles[roleKey],
      );
      if (retainedRetiredRole) throw retiredRoleCleanupRequired();
      const hasGrant = desired.some((roleKey) => !currentSet.has(roleKey));
      if (hasGrant && target.status !== 'active') throw inactiveTarget();

      const beforeRevision = this.roles.resolveApplicationRoles(actorUserId)?.revision;
      this.roles.replaceApplicationRoles({
        userId: input.userId,
        roleKeys: desired,
        changedBy: actorUserId,
      });
      const afterRevision = this.roles.resolveApplicationRoles(actorUserId)?.revision;
      this.audit.append({
        action: 'application.roles-replaced',
        outcome: 'succeeded',
        scope: { kind: 'application' },
        actor: auditActor(actorUserId, authority.auth),
        request: input.auditRequest,
        target: { type: 'user', id: input.userId },
        metadata: { changed: true, 'role-count': desired.length },
      });
      return Object.freeze({
        user: this.getUser(input.userId),
        actorAuthorizationChanged:
          actorUserId === input.userId && beforeRevision !== afterRevision,
      });
    });
  }

  transferOwnership(input: {
    actorUserId: string;
    assertCurrentAuthority: AssertAuthApplicationMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
    targetUserId: string;
  }): AuthApplicationOwnershipTransferResult {
    return this.db.transaction(() => {
      this.users.assertCurrentProfile();
      const authority = input.assertCurrentAuthority(['application.roles:manage']);
      if (authority.auth.userId !== input.actorUserId) {
        throw staleApplicationAuthority();
      }
      const actorUserId = authority.auth.userId;
      const actor = this.requireActorPermission(
        actorUserId,
        'application.roles:manage',
      );
      if (!actor.roles.includes(OWNER_ROLE)) throw forbidden();
      this.requireUser(input.targetUserId);
      try {
        this.roles.transferApplicationOwnership({
          ownerUserId: actorUserId,
          targetUserId: input.targetUserId,
          changedBy: actorUserId,
        });
      } catch (error) {
        throw mapRoleError(error);
      }
      this.audit.append({
        action: 'application.ownership-transferred',
        outcome: 'succeeded',
        scope: { kind: 'application' },
        actor: auditActor(actorUserId, authority.auth),
        request: input.auditRequest,
        target: { type: 'user', id: input.targetUserId },
      });
      return Object.freeze({
        owner: this.getUser(input.targetUserId),
        previousOwner: this.getUser(actorUserId),
        actorAuthorizationChanged: true as const,
      });
    });
  }

  private requireActorPermission(userId: string, permission: PermissionKey) {
    const actor = this.roles.getExpandedApplicationRoles(userId);
    if (!actor || !hasPermission(actor, permission)) throw forbidden();
    return actor;
  }

  private normalizeDesiredRoles(
    input: readonly string[],
    current: readonly string[],
  ): readonly string[] {
    if (!Array.isArray(input) || input.length > MAX_ROLE_SELECTION
      || input.some((value) => typeof value !== 'string')) throw invalidRoles();
    const desired = [...new Set(input.map((value) => value.trim()).filter(Boolean))]
      .sort(compareKeys);
    const currentSet = new Set(current);
    for (const roleKey of desired) {
      const role = this.kernel.authorization.roles[roleKey];
      if (!role) {
        // Retained roles whose templates were removed may be submitted only
        // unchanged. They confer no live permissions and cannot be restored.
        if (currentSet.has(roleKey)) continue;
        throw new AuthError(
          `Role is not declared: ${roleKey}`,
          'AUTHORIZATION_ROLE_UNDECLARED',
          422,
        );
      }
      if (role.system || roleKey === OWNER_ROLE) {
        throw new AuthError(
          'Application ownership can only change through explicit ownership transfer',
          'APPLICATION_OWNER_ROLE_PROTECTED',
          409,
        );
      }
    }
    return Object.freeze(desired);
  }

  private canGrantRole(ceiling: GrantCeiling, roleKey: string): boolean {
    const role = this.kernel.authorization.roles[roleKey];
    if (!role || role.system) return false;
    if (ceiling.allPermissions) return true;
    if (role.allPermissions) return false;
    const permissions = new Set(ceiling.permissions);
    return role.permissions.every((permission) => permissions.has(permission));
  }

  private requireUser(userId: string) {
    const user = this.users.getUserById(userId);
    if (!user) throw userNotFound();
    return user;
  }

  private getUser(userId: string): AuthApplicationUser {
    const row = this.db.prepare(`
      SELECT user_id, username, email, first_name, last_name, status,
        created_at, updated_at
      FROM users
      WHERE user_id = ?
    `).get(userId) as ApplicationUserRow | null;
    if (!row) throw userNotFound();
    return this.mapUser(row);
  }

  private mapUser(row: ApplicationUserRow): AuthApplicationUser {
    const authority = this.roles.getRetainedApplicationRoleSet(row.user_id);
    return Object.freeze({
      identity: Object.freeze({
        userId: row.user_id,
        username: row.username,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
      }),
      status: row.status,
      roles: Object.freeze([...authority.roles]),
      roleRevision: authority.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}

function auditActor(actorUserId: string, auth: AuthContext | undefined) {
  return auth ? Object.freeze({
    userId: actorUserId,
    membershipId: auth.membershipId,
    sessionId: auth.sessionId,
    sessionKind: auth.sessionKind,
    clientId: auth.clientId,
    provenance: 'authenticated-request' as const,
  }) : Object.freeze({
    userId: actorUserId,
    provenance: 'system' as const,
  });
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new AuthError(
      `Application user page limit must be between 1 and ${MAX_LIMIT}`,
      'APPLICATION_USER_PAGE_INVALID',
      422,
    );
  }
  return value;
}

function normalizeSearch(value: string | undefined): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') {
    throw new AuthError(
      'Application user search is invalid',
      'APPLICATION_USER_PAGE_INVALID',
      422,
    );
  }
  const normalized = value.trim().toLocaleLowerCase('en-US');
  if (normalized.length > MAX_SEARCH_LENGTH) {
    throw new AuthError(
      'Application user search is too long',
      'APPLICATION_USER_PAGE_INVALID',
      422,
    );
  }
  return normalized;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function encodeCursor(cursor: ApplicationUserCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string | undefined): ApplicationUserCursor | null {
  if (!value) return null;
  if (value.length > MAX_CURSOR_LENGTH) throw invalidCursor();
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') throw invalidCursor();
    const createdAt = Reflect.get(parsed, 'createdAt');
    const userId = Reflect.get(parsed, 'userId');
    if (!Number.isSafeInteger(createdAt) || createdAt < 0
      || typeof userId !== 'string' || userId.length < 1 || userId.length > 200) {
      throw invalidCursor();
    }
    return { createdAt, userId };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw invalidCursor();
  }
}

function grantCeiling(authority: {
  allPermissions: boolean;
  permissions: readonly PermissionKey[];
}): GrantCeiling {
  return {
    allPermissions: authority.allPermissions,
    permissions: authority.permissions,
  };
}

function hasPermission(
  authority: { allPermissions: boolean; permissions: readonly PermissionKey[] },
  permission: PermissionKey,
): boolean {
  return authority.allPermissions || authority.permissions.includes(permission);
}

function mapRoleError(error: unknown): Error {
  if (!(error instanceof AuthorizationRoleAssignmentError)) {
    return error instanceof Error ? error : new Error('Application access update failed');
  }
  switch (error.code) {
    case 'AUTHORIZATION_SUBJECT_NOT_FOUND':
      return userNotFound();
    case 'AUTHORIZATION_SUBJECT_INACTIVE':
      return inactiveTarget();
    case 'AUTHORIZATION_OWNERSHIP_REQUIRED':
      return forbidden();
    case 'AUTHORIZATION_OWNERSHIP_TARGET_INVALID':
      return new AuthError(error.message, error.code, 409);
    case 'AUTHORIZATION_LAST_OWNER':
      return new AuthError(error.message, error.code, 409);
    default:
      return new AuthError(error.message, error.code, 422);
  }
}

function invalidCursor(): AuthError {
  return new AuthError(
    'Application user page cursor is invalid',
    'APPLICATION_USER_PAGE_INVALID',
    422,
  );
}

function invalidRoles(): AuthError {
  return new AuthError(
    'Application role selection is invalid',
    'APPLICATION_ROLE_SELECTION_INVALID',
    422,
  );
}

function revisionConflict(): AuthError {
  return new AuthError(
    'Application roles changed after this view was loaded; reload and try again',
    'APPLICATION_ROLE_REVISION_CONFLICT',
    409,
  );
}

function retiredRoleCleanupRequired(): AuthError {
  return new AuthError(
    'Retired application roles must be removed by an owner before other roles can change',
    'APPLICATION_RETIRED_ROLE_CLEANUP_REQUIRED',
    409,
  );
}

function escalationForbidden(): AuthError {
  return new AuthError(
    'A role cannot be changed outside the acting user\'s authority ceiling',
    'APPLICATION_ROLE_ESCALATION_FORBIDDEN',
    403,
  );
}

function inactiveTarget(): AuthError {
  return new AuthError(
    'The account is not available for application role grants',
    'APPLICATION_USER_SUBJECT_INACTIVE',
    409,
  );
}

function userNotFound(): AuthError {
  return new AuthError('Application user not found', 'APPLICATION_USER_NOT_FOUND', 404);
}

function forbidden(): AuthError {
  return new AuthError('Forbidden', 'FORBIDDEN', 403);
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
