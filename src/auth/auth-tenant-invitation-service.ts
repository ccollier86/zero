/** Atomic tenant-invitation lifecycle, bearer validation, and membership admission. */

import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';
import { hashToken } from '../tokens/token-utils';
import {
  AuthAuditService,
  authAuditActorFromContext,
  captureAuthAuditActor,
  captureAuthAuditRequestContext,
} from './auth-audit-service';
import type { AuthAuditActor, AuthAuditRequestContext } from './auth-audit-types';
import { canonicalizeEmail, isValidEmail } from './auth-email-identity';
import {
  createInvitationGrantSnapshot,
  invitationGrantRemainsWithinSnapshot,
} from './auth-tenant-invitation-grant';
import type {
  AssertAuthTenantMutationAuthority,
  AuthTenantMutationAuthority,
} from './auth-tenant-mutation-authority';
import {
  createInvitationToken,
  decodeCursor,
  encodeCursor,
  isInvitationToken,
  mapInvitation,
  maskEmail,
  normalizeLimit,
  normalizeInvitationPageStatus,
  toInvitation,
  type InvitationRow,
} from './auth-tenant-onboarding-codec';
import {
  isDefaultTenantMemberRole,
  normalizeAuthTenantOnboardingRoleKeys,
  snapshotAuthTenantOnboardingRoleKeys,
} from './auth-tenant-onboarding-role-policy';
import type {
  AuthTenantInvitation,
  AuthTenantInvitationCreated,
  AuthTenantInvitationDelivery,
  AuthTenantInvitationInspection,
  AuthTenantInvitationRecord,
  AuthTenantInvitationStatus,
  AuthTenantJoinRequestPage,
  ResolvedAuthTenantOnboardingConfig,
} from './auth-tenant-onboarding-types';
import type { AuthorizationKernel } from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import { roleGrantCeilingFromAuthority } from './authorization-role-grant';
import type { TenancyService } from './tenancy/tenancy-service';
import type { TenantKind, TenantMembershipRecord } from './tenancy/tenancy-types';
import { AuthError, type PermissionKey, type UserRecord } from './types';
import type { UserPropertyService } from './user-property-service';
import type { UserStore } from './user-store';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';

export interface AcceptedTenantInvitation {
  user: UserRecord;
  /** Security generation committed by the invitation-admission transaction. */
  authGeneration: number;
  membership: TenantMembershipRecord;
  tenant: { tenantId: string; name: string; slug: string; kind: TenantKind };
}

export interface PendingTenantInvitationAccount {
  user: UserRecord;
  /** Security generation committed by invitation-bound account creation. */
  authGeneration: number;
  invitationAcceptancePending: true;
}

/**
 * Owns invitation persistence and the one-time bearer-to-membership ceremony.
 * Join-request orchestration remains in AuthTenantOnboardingService.
 */
export class AuthTenantInvitationService {
  private readonly stmts: {
    expireInvitations: Statement;
    expireTenantInvitations: Statement;
    getInvitationByHash: Statement;
    getInvitationById: Statement;
    getInvitationByDeliveryId: Statement;
    insertInvitation: Statement;
    revokePendingForEmail: Statement;
    revokeInvitation: Statement;
    acceptInvitation: Statement;
    lockTenant: Statement;
  };

  constructor(
    private readonly db: ReactiveDB,
    private readonly config: ResolvedAuthTenantOnboardingConfig,
    private readonly kernel: AuthorizationKernel,
    private readonly users: UserStore,
    private readonly properties: UserPropertyService,
    private readonly tenancy: TenancyService,
    private readonly roles: AuthorizationRoleService | null,
    private readonly audit: AuthAuditService,
    private readonly now: () => number,
    private readonly emitCode?: AuthPlatformCodeEmitter,
  ) {
    this.stmts = {
      expireInvitations: db.prepare(`
        UPDATE _auth_tenant_invitations
        SET status = 'expired', updated_at = ?
        WHERE invitation_id IN (
          SELECT invitation_id FROM _auth_tenant_invitations
          WHERE status = 'pending' AND expires_at <= ?
          ORDER BY expires_at ASC, invitation_id ASC
          LIMIT 100
        )
      `),
      expireTenantInvitations: db.prepare(`
        UPDATE _auth_tenant_invitations
        SET status = 'expired', updated_at = ?
        WHERE invitation_id IN (
          SELECT invitation_id FROM _auth_tenant_invitations
          WHERE tenant_id = ? AND status = 'pending' AND expires_at <= ?
          ORDER BY expires_at ASC, invitation_id ASC
          LIMIT 100
        )
      `),
      getInvitationByHash: db.prepare(
        'SELECT * FROM _auth_tenant_invitations WHERE token_hash = ?',
      ),
      getInvitationById: db.prepare(`
        SELECT * FROM _auth_tenant_invitations
        WHERE tenant_id = ? AND invitation_id = ?
      `),
      getInvitationByDeliveryId: db.prepare(
        'SELECT * FROM _auth_tenant_invitations WHERE invitation_id = ?',
      ),
      insertInvitation: db.prepare(`
        INSERT INTO _auth_tenant_invitations (
          invitation_id, tenant_id, email, token_hash, role_keys_json,
          grant_snapshot_json, grant_snapshot_fingerprint, status, issued_by,
          accepted_by_user_id, expires_at, created_at, updated_at,
          accepted_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, ?, ?, ?, NULL, NULL)
      `),
      revokePendingForEmail: db.prepare(`
        UPDATE _auth_tenant_invitations
        SET status = 'revoked', updated_at = ?, revoked_at = ?
        WHERE tenant_id = ? AND email = ? COLLATE NOCASE AND status = 'pending'
      `),
      revokeInvitation: db.prepare(`
        UPDATE _auth_tenant_invitations
        SET status = 'revoked', updated_at = ?, revoked_at = ?
        WHERE tenant_id = ? AND invitation_id = ? AND status = 'pending'
      `),
      acceptInvitation: db.prepare(`
        UPDATE _auth_tenant_invitations
        SET status = 'accepted', accepted_by_user_id = ?, accepted_at = ?, updated_at = ?
        WHERE invitation_id = ? AND token_hash = ? AND status = 'pending'
          AND tenant_id = ? AND email = ? COLLATE NOCASE AND expires_at > ?
      `),
      lockTenant: db.prepare(
        'UPDATE _auth_tenants SET updated_at = updated_at WHERE tenant_id = ?',
      ),
    };
  }

  issue(input: {
    tenantId: string;
    email: string;
    roleKeys?: readonly string[];
    ttlMs?: number;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
    afterPersist?: (created: {
      invitationId: string;
      recipient: string;
      rawToken: string;
    }) => void;
  }): AuthTenantInvitationCreated {
    this.users.assertCurrentProfile();
    this.requireEnabled();
    const tenantId = input.tenantId;
    const assertCurrentAuthority = input.assertCurrentAuthority;
    const auditRequest = captureAuthAuditRequestContext(input.auditRequest);
    const afterPersist = input.afterPersist;
    const email = canonicalizeEmail(input.email);
    if (!isValidEmail(email)) {
      throw new AuthError('Invalid email address', 'INVALID_EMAIL', 422);
    }
    const inputRoleKeys: unknown = input.roleKeys;
    const requestedRoleKeys = snapshotAuthTenantOnboardingRoleKeys(
      inputRoleKeys === undefined ? ['member'] : inputRoleKeys,
    );
    const inputTtlMs = input.ttlMs;
    const ttlMs = inputTtlMs ?? this.config.invitations.defaultTTLms;
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0
      || ttlMs > this.config.invitations.maxTTLms) {
      throw new AuthError(
        'Invitation lifetime exceeds the configured ceiling',
        'TENANT_INVITATION_TTL_INVALID',
        422,
      );
    }
    const rawToken = createInvitationToken();
    const invitationId = `tinv_${crypto.randomUUID()}`;
    const now = this.now();
    this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.stmts.lockTenant.run(tenantId);
      const authority = this.requireMutationAuthority(
        tenantId,
        assertCurrentAuthority,
        isDefaultTenantMemberRole(requestedRoleKeys)
          ? ['tenant.invitations:manage']
          : ['tenant.invitations:manage', 'tenant.roles:manage'],
      );
      const tenant = this.requireActiveTenant(tenantId);
      const roleKeys = normalizeAuthTenantOnboardingRoleKeys({
        kernel: this.kernel,
        roleKeys: requestedRoleKeys,
        ceiling: roleGrantCeilingFromAuthority(authority),
        tenantKind: tenant.kind,
      });
      const grantSnapshot = createInvitationGrantSnapshot({
        kernel: this.kernel,
        tenantKind: tenant.kind,
        roleKeys,
      }, this.emitCode);
      const existingUser = this.users.getUserByEmail(email);
      if (existingUser && this.tenancy.getMembership(tenantId, existingUser.userId)) {
        throw new AuthError(
          'That identity already has a retained tenant membership',
          'TENANT_MEMBERSHIP_EXISTS',
          409,
        );
      }
      this.expirePending(now);
      this.stmts.revokePendingForEmail.run(now, now, tenantId, email);
      this.stmts.insertInvitation.run(
        invitationId,
        tenantId,
        email,
        hashToken(rawToken),
        JSON.stringify(roleKeys),
        grantSnapshot.json,
        grantSnapshot.fingerprint,
        authority.auth.userId,
        now + ttlMs,
        now,
        now,
      );
      if (afterPersist) {
        invokeSynchronousAuthCallback(
          () => afterPersist({ invitationId, recipient: email, rawToken }),
          {
            component: 'tenant-invitations',
            invariant: 'after-persist-async',
            message: '[auth] Tenant invitation afterPersist must be synchronous.',
            emitCode: this.emitCode,
          },
        );
      }
      this.audit.append({
        action: 'tenant.invitation-issued',
        outcome: 'succeeded',
        scope: { kind: 'tenant', tenantId },
        actor: authAuditActorFromContext(authority.auth),
        request: auditRequest,
        target: { type: 'tenant-invitation', id: invitationId },
        metadata: { 'role-count': roleKeys.length },
      });
    });
    return {
      invitation: toInvitation(this.requireInvitation(tenantId, invitationId)),
      token: rawToken,
    };
  }

  resolveDelivery(input: {
    invitationId: string;
    recipient: string;
    rawToken: string;
  }): AuthTenantInvitationDelivery | null {
    this.users.assertCurrentProfile();
    const now = this.now();
    this.expirePending(now);
    const row = this.stmts.getInvitationByDeliveryId.get(
      input.invitationId,
    ) as InvitationRow | null;
    if (!row || row.status !== 'pending' || row.expires_at <= now) return null;
    const recipient = canonicalizeEmail(input.recipient);
    if (row.email !== recipient || row.token_hash !== hashToken(input.rawToken)) return null;
    const tenant = this.tenancy.getTenant(row.tenant_id);
    if (!tenant || tenant.status !== 'active') return null;
    const invitation = mapInvitation(row);
    if (!this.grantIsCurrent(invitation, tenant.kind)) return null;
    return {
      invitationId: invitation.invitationId,
      recipient: invitation.email,
      roles: invitation.roleKeys,
      expiresAt: invitation.expiresAt,
      tenant: {
        tenantId: tenant.tenantId,
        name: tenant.name,
        slug: tenant.slug,
        kind: tenant.kind,
      },
    };
  }

  list(input: {
    tenantId: string;
    status?: AuthTenantInvitationStatus;
    limit?: number;
    cursor?: string;
    assertCurrentAuthority?: AssertAuthTenantMutationAuthority;
  }): { invitations: AuthTenantInvitation[]; page: AuthTenantJoinRequestPage['page'] } {
    const tenantId = input.tenantId;
    const assertCurrentAuthority = input.assertCurrentAuthority;
    const status = normalizeInvitationPageStatus(input.status);
    const limit = normalizeLimit(input.limit);
    const cursor = decodeCursor(input.cursor);
    this.users.assertCurrentProfile();
    this.requireEnabled();
    if (assertCurrentAuthority) {
      this.invokeAuthority(assertCurrentAuthority, ['tenant.invitations:read']);
    }
    this.requireActiveTenant(tenantId);
    this.expirePendingForTenant(tenantId, this.now());
    const clauses = ['tenant_id = ?'];
    const args: Array<string | number> = [tenantId];
    if (status !== undefined) {
      clauses.push('status = ?');
      args.push(status);
    }
    if (cursor) {
      clauses.push('(created_at > ? OR (created_at = ? AND invitation_id > ?))');
      args.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
    const rows = this.db.prepare(`
      SELECT * FROM _auth_tenant_invitations
      WHERE ${clauses.join(' AND ')}
      ORDER BY created_at ASC, invitation_id ASC
      LIMIT ?
    `).all(...args, limit + 1) as InvitationRow[];
    const hasMore = rows.length > limit;
    const selected = hasMore ? rows.slice(0, limit) : rows;
    const last = selected.at(-1);
    const result = {
      invitations: selected.map(mapInvitation).map(toInvitation),
      page: {
        limit,
        count: selected.length,
        hasMore,
        nextCursor: hasMore && last
          ? encodeCursor({ timestamp: last.created_at, id: last.invitation_id })
          : null,
      },
    };
    return result;
  }

  revoke(input: {
    tenantId: string;
    invitationId: string;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): AuthTenantInvitation {
    this.users.assertCurrentProfile();
    this.requireEnabled();
    const tenantId = input.tenantId;
    const invitationId = input.invitationId;
    const assertCurrentAuthority = input.assertCurrentAuthority;
    const auditRequest = captureAuthAuditRequestContext(input.auditRequest);
    const now = this.now();
    return this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.stmts.lockTenant.run(tenantId);
      const authority = this.requireMutationAuthority(
        tenantId,
        assertCurrentAuthority,
        ['tenant.invitations:manage'],
      );
      this.expirePending(now);
      const current = this.requireInvitation(tenantId, invitationId);
      if (current.status === 'revoked') return toInvitation(current);
      if (current.status !== 'pending') throw invitationConflict();
      if (this.stmts.revokeInvitation.run(
        now, now, tenantId, invitationId,
      ).changes !== 1) throw invitationConflict();
      this.audit.append({
        action: 'tenant.invitation-revoked',
        outcome: 'succeeded',
        scope: { kind: 'tenant', tenantId },
        actor: authAuditActorFromContext(authority.auth),
        request: auditRequest,
        target: { type: 'tenant-invitation', id: invitationId },
      });
      return toInvitation(this.requireInvitation(tenantId, invitationId));
    });
  }

  inspect(rawToken: string): AuthTenantInvitationInspection {
    this.users.assertCurrentProfile();
    if (!this.config.invitations.enabled) return { available: false };
    const invitation = this.getUsable(rawToken);
    if (!invitation) return { available: false };
    const tenant = this.tenancy.getTenant(invitation.tenantId);
    if (!tenant || tenant.status !== 'active') return { available: false };
    return {
      available: true,
      tenant: { name: tenant.name, slug: tenant.slug, kind: tenant.kind },
      emailHint: maskEmail(invitation.email),
      expiresAt: invitation.expiresAt,
      account: this.users.getUserByEmail(invitation.email) ? 'sign-in' : 'create',
    };
  }

  accept(
    rawToken: string,
    userId: string,
    admitIdentityProof?: () => boolean,
    auditContext?: {
      actor?: AuthAuditActor;
      request?: AuthAuditRequestContext;
    },
    expectedAuthGeneration?: number,
  ): AcceptedTenantInvitation {
    this.users.assertCurrentProfile();
    this.requireEnabled();
    const auditActor = captureAuthAuditActor(auditContext?.actor);
    const auditRequest = captureAuthAuditRequestContext(auditContext?.request);
    return this.db.transaction(() => {
      this.users.assertCurrentProfile();
      const user = this.requireEligibleUser(userId);
      const invitation = this.requireUsable(rawToken);
      if (canonicalizeEmail(user.email) !== invitation.email) throw invitationUnavailable();
      const authGeneration = this.users.getAuthGeneration(user.userId);
      if (expectedAuthGeneration !== undefined
        && authGeneration !== expectedAuthGeneration) {
        throw authenticationStateChanged();
      }
      const tenant = this.requireActiveTenant(invitation.tenantId);
      this.stmts.lockTenant.run(tenant.tenantId);
      const now = this.now();
      if (this.stmts.acceptInvitation.run(
        user.userId,
        now,
        now,
        invitation.invitationId,
        hashToken(rawToken),
        tenant.tenantId,
        invitation.email,
        now,
      ).changes !== 1) throw invitationUnavailable();
      if (admitIdentityProof && !invokeSynchronousAuthCallback(admitIdentityProof, {
        component: 'tenant-invitations',
        invariant: 'identity-proof-admission-async',
        message: '[auth] Invitation identity proof admission must be synchronous.',
        emitCode: this.emitCode,
      })) throw invitationUnavailable();

      const membership = this.admitMembership(
        tenant.tenantId,
        user.userId,
        invitation.roleKeys,
        invitation.issuedBy,
        tenant.kind,
      );
      let current = user;
      if (user.emailVerificationRequired || user.emailVerifiedAt === null) {
        current = this.users.markEmailVerified(user.userId, now) ?? user;
      }
      this.properties.applyMissingDefaults(current.userId, this.users);
      this.audit.append({
        action: 'tenant.invitation-accepted',
        outcome: 'succeeded',
        scope: { kind: 'tenant', tenantId: tenant.tenantId },
        actor: auditActor ?? {
          userId: current.userId,
          provenance: 'registration',
        },
        request: auditRequest,
        target: { type: 'tenant-membership', id: membership.membershipId },
        metadata: { 'invitation-id': invitation.invitationId },
      });
      return {
        user: this.users.getUserById(current.userId)!,
        authGeneration: expectedAuthGeneration ?? authGeneration,
        membership,
        tenant: {
          tenantId: tenant.tenantId,
          name: tenant.name,
          slug: tenant.slug,
          kind: tenant.kind,
        },
      };
    });
  }

  async createAccount(input: {
    token: string;
    username: string;
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    mfaRequired: boolean;
    properties: Record<string, string>;
    auditRequest?: AuthAuditRequestContext;
    deferAcceptance?: boolean;
  }): Promise<AcceptedTenantInvitation | PendingTenantInvitationAccount> {
    this.users.assertCurrentProfile();
    this.requireEnabled();
    if (!this.config.invitations.accountCreation) {
      throw new AuthError(
        'Invitation-bound account creation is disabled',
        'TENANT_INVITATION_ACCOUNT_CREATION_DISABLED',
        403,
      );
    }
    const token = input.token;
    const username = input.username;
    const email = canonicalizeEmail(input.email);
    const password = input.password;
    const firstName = input.firstName;
    const lastName = input.lastName;
    const mfaRequired = input.mfaRequired;
    const properties = Object.freeze({ ...input.properties });
    const auditRequest = captureAuthAuditRequestContext(input.auditRequest);
    const deferAcceptance = input.deferAcceptance === true;
    const invitation = this.requireUsable(token);
    if (email !== invitation.email || !isValidEmail(email)) throw invitationUnavailable();
    if (this.users.getUserByEmail(email)) throw invitationAccountAuthRequired();

    const result: { accepted: AcceptedTenantInvitation | null } = { accepted: null };
    try {
      const created = await this.users.createRegistrationUser({
        username,
        email,
        password,
        firstName,
        lastName,
        properties,
      }, (isBootstrap) => {
        if (isBootstrap) throw invitationUnavailable();
        return {
          role: 'user' as const,
          requireEmailVerification: false,
          mfaRequired,
        };
      }, (user) => {
        if (deferAcceptance) {
          const current = this.requireUsable(token);
          if (current.email !== canonicalizeEmail(user.email)) {
            throw invitationUnavailable();
          }
          return;
        }
        result.accepted = this.accept(token, user.userId, undefined, {
          actor: { userId: user.userId, provenance: 'registration' },
          request: auditRequest,
        });
      }, { auditRequest });
      if (deferAcceptance) {
        return {
          user: this.users.getUserById(created.user.userId)!,
          authGeneration: created.authGeneration,
          invitationAcceptancePending: true,
        };
      }
      if (!result.accepted) throw invitationUnavailable();
      return {
        ...result.accepted,
        user: this.users.getUserById(created.user.userId)!,
      };
    } catch (error) {
      if (error instanceof AuthError
        && (error.code === 'DUPLICATE_EMAIL' || error.code === 'DUPLICATE_USERNAME')) {
        throw invitationAccountAuthRequired();
      }
      throw error;
    }
  }

  private admitMembership(
    tenantId: string,
    userId: string,
    roleKeys: readonly string[],
    issuedBy: string,
    tenantKind: TenantKind,
  ): TenantMembershipRecord {
    const normalized = normalizeAuthTenantOnboardingRoleKeys({
      kernel: this.kernel,
      roleKeys,
      tenantKind,
    });
    const existing = this.tenancy.getMembership(tenantId, userId);
    if (existing) {
      if (existing.status !== 'active') {
        throw new AuthError(
          'A retained membership blocks invitation re-admission',
          'TENANT_INVITATION_MEMBERSHIP_BLOCKED',
          409,
        );
      }
      return existing;
    }
    let membership = this.tenancy.addMembership({
      tenantId,
      userId,
      roleKey: normalized[0]!,
      createdBy: issuedBy,
    });
    if (this.kernel.authorization.mode === 'advanced') {
      this.requireAdvancedRoles().replaceTenantRoles({
        tenantId,
        membershipId: membership.membershipId,
        roleKeys: normalized,
        changedBy: issuedBy,
      });
      membership = this.tenancy.getMembershipById(membership.membershipId)!;
    }
    return membership;
  }

  private expirePending(now: number): void {
    this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.stmts.expireInvitations.run(now, now);
    });
  }

  private expirePendingForTenant(tenantId: string, now: number): void {
    this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.stmts.expireTenantInvitations.run(now, tenantId, now);
    });
  }

  private getUsable(rawToken: string): AuthTenantInvitationRecord | null {
    if (!isInvitationToken(rawToken)) return null;
    const now = this.now();
    this.expirePending(now);
    const row = this.stmts.getInvitationByHash.get(hashToken(rawToken)) as InvitationRow | null;
    if (!row) return null;
    const invitation = mapInvitation(row);
    if (invitation.status !== 'pending' || invitation.expiresAt <= now) return null;
    const tenant = this.tenancy.getTenant(invitation.tenantId);
    if (!tenant || !this.grantIsCurrent(invitation, tenant.kind)) return null;
    return invitation;
  }

  private requireUsable(rawToken: string): AuthTenantInvitationRecord {
    const invitation = this.getUsable(rawToken);
    if (!invitation) throw invitationUnavailable();
    return invitation;
  }

  private grantIsCurrent(
    invitation: AuthTenantInvitationRecord,
    tenantKind: TenantKind,
  ): boolean {
    return invitationGrantRemainsWithinSnapshot({
      kernel: this.kernel,
      tenantKind,
      roleKeys: invitation.roleKeys,
      snapshotJson: invitation.grantSnapshotJson,
      snapshotFingerprint: invitation.grantSnapshotFingerprint,
    });
  }

  private requireInvitation(tenantId: string, invitationId: string) {
    const row = this.stmts.getInvitationById.get(
      tenantId,
      invitationId,
    ) as InvitationRow | null;
    if (!row) {
      throw new AuthError('Invitation not found', 'TENANT_INVITATION_NOT_FOUND', 404);
    }
    return mapInvitation(row);
  }

  private requireEligibleUser(userId: string): UserRecord {
    const user = this.users.getUserById(userId);
    if (!user || user.status !== 'active') throw invitationUnavailable();
    if (user.passwordChangeRequired) {
      throw new AuthError('Password change required', 'PASSWORD_CHANGE_REQUIRED', 403);
    }
    return user;
  }

  private requireMutationAuthority(
    tenantId: string,
    assertion: AssertAuthTenantMutationAuthority,
    permissions: readonly PermissionKey[],
  ): AuthTenantMutationAuthority {
    const authority = this.invokeAuthority(assertion, permissions);
    if (authority.scope.tenantId !== tenantId) throw forbidden();
    this.requireActiveTenant(tenantId);
    const membership = this.tenancy.getMembershipById(authority.scope.membershipId);
    if (!membership || membership.tenantId !== tenantId
      || membership.userId !== authority.auth.userId
      || membership.status !== 'active') throw forbidden();
    return authority;
  }

  private invokeAuthority(
    assertion: AssertAuthTenantMutationAuthority,
    permissions: readonly PermissionKey[],
  ): AuthTenantMutationAuthority {
    return invokeSynchronousAuthCallback(
      () => assertion(permissions),
      {
        component: 'auth-tenant-invitation-service',
        invariant: 'authority-callback-async',
        message: '[auth] Tenant invitation authority callback must be synchronous.',
        emitCode: this.emitCode,
      },
    );
  }

  private requireActiveTenant(tenantId: string) {
    const tenant = this.tenancy.getTenant(tenantId);
    if (!tenant || tenant.status !== 'active') throw forbidden();
    return tenant;
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

  private requireEnabled(): void {
    if (!this.config.invitations.enabled) {
      throw new AuthError(
        'Tenant invitations are unavailable',
        'TENANT_INVITATIONS_UNAVAILABLE',
        404,
      );
    }
  }
}

function invitationUnavailable(): AuthError {
  return new AuthError(
    'Invitation is unavailable',
    'TENANT_INVITATION_UNAVAILABLE',
    400,
  );
}

function invitationAccountAuthRequired(): AuthError {
  return new AuthError(
    'The invitation email belongs to an existing account; authenticate that account to continue',
    'TENANT_INVITATION_ACCOUNT_AUTH_REQUIRED',
    409,
  );
}

function authenticationStateChanged(): AuthError {
  return new AuthError(
    'Authentication state changed; sign in again',
    'AUTH_STATE_CHANGED',
    409,
  );
}

function invitationConflict(): AuthError {
  return new AuthError(
    'Invitation state changed; reload and try again',
    'TENANT_INVITATION_STATUS_CONFLICT',
    409,
  );
}

function forbidden(): AuthError {
  return new AuthError('Forbidden', 'FORBIDDEN', 403);
}
