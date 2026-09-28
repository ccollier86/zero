import type { Statement } from 'bun:sqlite';
import { createOpaqueToken, hashToken } from '../tokens/token-utils';
import type { ReactiveDB } from '../sync/reactive-db';
import type {
  AuthorizationKernel,
  AuthorizationScopeSnapshot,
} from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import type {
  AssertAuthTenantMutationAuthority,
  AuthTenantMutationAuthority,
} from './auth-tenant-mutation-authority';
import { canonicalizeEmail, isValidEmail } from './auth-email-identity';
import type {
  AuthTenantInvitation,
  AuthTenantInvitationCreated,
  AuthTenantInvitationDelivery,
  AuthTenantInvitationInspection,
  AuthTenantInvitationRecord,
  AuthTenantInvitationStatus,
  AuthTenantJoinRequest,
  AuthTenantJoinRequestApprovalPolicy,
  AuthTenantJoinRequestApprovalRole,
  AuthTenantJoinRequestPage,
  AuthTenantJoinRequestRecord,
  AuthTenantJoinRequestStatus,
  AuthTenantRoleGrantCeiling,
  ResolvedAuthTenantOnboardingConfig,
} from './auth-tenant-onboarding-types';
import { defineAuthTenantOnboardingTables } from './auth-tenant-onboarding-schema';
import { AuthError, type PermissionKey, type UserRecord } from './types';
import type { TenancyService } from './tenancy/tenancy-service';
import type { TenantMembershipRecord } from './tenancy/tenancy-types';
import { AuthAuditService, authAuditActorFromContext } from './auth-audit-service';
import type {
  AuthAuditActor,
  AuthAuditRequestContext,
} from './auth-audit-types';
import type { UserPropertyService } from './user-property-service';
import type { UserStore } from './user-store';

interface InvitationRow {
  invitation_id: string;
  tenant_id: string;
  email: string;
  token_hash: string;
  role_keys_json: string;
  status: string;
  issued_by: string;
  accepted_by_user_id: string | null;
  expires_at: number;
  created_at: number;
  updated_at: number;
  accepted_at: number | null;
  revoked_at: number | null;
}

interface JoinRequestRow {
  join_request_id: string;
  tenant_id: string;
  user_id: string;
  email: string;
  status: string;
  request_revision: number;
  requested_at: number;
  created_at: number;
  updated_at: number;
  reviewed_at: number | null;
  reviewed_by: string | null;
  last_decision: string | null;
  approved_membership_id: string | null;
}

interface JoinRequestProjectionRow extends JoinRequestRow {
  username: string;
  first_name: string | null;
  last_name: string | null;
  domain_request_role_key: string | null;
  domain_request_blocked_until: number | null;
  domain_provenance_unbound: number;
}

interface DomainJoinRequestProvenanceRow {
  claim_id: string;
  domain: string;
  request_role_key: string;
  mailbox_proof_id: string | null;
  blocked_until: number | null;
  source: 'verified-domain' | 'legacy-unbound';
  request_revision: number | null;
}

interface Cursor {
  timestamp: number;
  id: string;
}

export interface AcceptedTenantInvitation {
  user: UserRecord;
  membership: TenantMembershipRecord;
  tenant: { tenantId: string; name: string; slug: string };
}

export interface PendingTenantInvitationAccount {
  user: UserRecord;
  invitationAcceptancePending: true;
}

const INVITATION_TOKEN_PREFIX = 'zinv_';
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;
const MAX_CURSOR_LENGTH = 512;
const MAX_ROLE_COUNT = 32;

/**
 * Transport-neutral tenant invitation and join-request control plane.
 *
 * HTTP adapters still prove actor authority. This service repeats tenant and
 * membership relationships, owns every atomic transition, and never accepts
 * a target tenant from an opaque invitation/join-request id.
 */
export class AuthTenantOnboardingService {
  private readonly stmts: {
    expireInvitations: Statement;
    getInvitationByHash: Statement;
    getInvitationById: Statement;
    getInvitationByDeliveryId: Statement;
    insertInvitation: Statement;
    revokePendingForEmail: Statement;
    revokeInvitation: Statement;
    acceptInvitation: Statement;
    lockTenant: Statement;
    getJoinRequestById: Statement;
    getJoinRequestByTenantUser: Statement;
    insertJoinRequest: Statement;
    reopenJoinRequest: Statement;
    supersedePendingJoinRequest: Statement;
    approveJoinRequest: Statement;
    denyJoinRequest: Statement;
  };

  constructor(
    private readonly db: ReactiveDB,
    readonly config: ResolvedAuthTenantOnboardingConfig,
    private readonly kernel: AuthorizationKernel,
    private readonly users: UserStore,
    private readonly properties: UserPropertyService,
    private readonly tenancy: TenancyService,
    private readonly roles: AuthorizationRoleService | null,
    private readonly audit: AuthAuditService,
    private readonly now: () => number = Date.now,
  ) {
    defineAuthTenantOnboardingTables(db);
    this.stmts = {
      expireInvitations: db.prepare(`
        UPDATE _auth_tenant_invitations
        SET status = 'expired', updated_at = ?
        WHERE status = 'pending' AND expires_at <= ?
      `),
      getInvitationByHash: db.prepare(`
        SELECT * FROM _auth_tenant_invitations WHERE token_hash = ?
      `),
      getInvitationById: db.prepare(`
        SELECT * FROM _auth_tenant_invitations
        WHERE tenant_id = ? AND invitation_id = ?
      `),
      getInvitationByDeliveryId: db.prepare(`
        SELECT * FROM _auth_tenant_invitations WHERE invitation_id = ?
      `),
      insertInvitation: db.prepare(`
        INSERT INTO _auth_tenant_invitations (
          invitation_id, tenant_id, email, token_hash, role_keys_json,
          status, issued_by, accepted_by_user_id, expires_at, created_at,
          updated_at, accepted_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL, ?, ?, ?, NULL, NULL)
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
      lockTenant: db.prepare(`
        UPDATE _auth_tenants SET updated_at = updated_at WHERE tenant_id = ?
      `),
      getJoinRequestById: db.prepare(`
        SELECT * FROM _auth_tenant_join_requests
        WHERE tenant_id = ? AND join_request_id = ?
      `),
      getJoinRequestByTenantUser: db.prepare(`
        SELECT * FROM _auth_tenant_join_requests
        WHERE tenant_id = ? AND user_id = ?
      `),
      insertJoinRequest: db.prepare(`
        INSERT INTO _auth_tenant_join_requests (
          join_request_id, tenant_id, user_id, email, status,
          request_revision, requested_at, created_at, updated_at,
          reviewed_at, reviewed_by, last_decision, approved_membership_id
        ) VALUES (?, ?, ?, ?, 'pending', 1, ?, ?, ?, NULL, NULL, NULL, NULL)
      `),
      reopenJoinRequest: db.prepare(`
        UPDATE _auth_tenant_join_requests
        SET status = 'pending', request_revision = request_revision + 1,
            requested_at = ?, updated_at = ?, reviewed_at = NULL,
            reviewed_by = NULL, approved_membership_id = NULL
        WHERE join_request_id = ? AND tenant_id = ? AND user_id = ?
          AND status IN ('approved', 'denied', 'cancelled')
          AND request_revision = ?
      `),
      supersedePendingJoinRequest: db.prepare(`
        UPDATE _auth_tenant_join_requests
        SET request_revision = request_revision + 1,
            requested_at = ?, updated_at = ?, reviewed_at = NULL,
            reviewed_by = NULL, approved_membership_id = NULL
        WHERE join_request_id = ? AND tenant_id = ? AND user_id = ?
          AND status = 'pending' AND request_revision = ?
      `),
      approveJoinRequest: db.prepare(`
        UPDATE _auth_tenant_join_requests
        SET status = 'approved', updated_at = ?, reviewed_at = ?,
            reviewed_by = ?, last_decision = 'approved', approved_membership_id = ?
        WHERE join_request_id = ? AND tenant_id = ? AND status = 'pending'
          AND request_revision = ?
      `),
      denyJoinRequest: db.prepare(`
        UPDATE _auth_tenant_join_requests
        SET status = 'denied', updated_at = ?, reviewed_at = ?,
            reviewed_by = ?, last_decision = 'denied', approved_membership_id = NULL
        WHERE join_request_id = ? AND tenant_id = ? AND status = 'pending'
          AND request_revision = ?
      `),
    };
  }

  /** Current tenant generation used for a freshly admitted session binding. */
  getTenantAuthorizationGeneration(tenantId: string): number {
    this.users.assertCurrentProfile();
    return this.requireActiveTenant(tenantId).authorizationGeneration;
  }

  issueInvitation(input: {
    tenantId: string;
    email: string;
    roleKeys?: readonly string[];
    ttlMs?: number;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
    /** Runs inside the invitation transaction; throwing rolls issuance back. */
    afterPersist?: (created: {
      invitationId: string;
      recipient: string;
      rawToken: string;
    }) => void;
  }): AuthTenantInvitationCreated {
    this.users.assertCurrentProfile();
    this.requireInvitationsEnabled();
    const email = canonicalizeEmail(input.email);
    if (!isValidEmail(email)) {
      throw new AuthError('Invalid email address', 'INVALID_EMAIL', 422);
    }
    const requestedRoleKeys = input.roleKeys ?? ['member'];
    const ttlMs = input.ttlMs ?? this.config.invitations.defaultTTLms;
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0
      || ttlMs > this.config.invitations.maxTTLms) {
      throw new AuthError(
        'Invitation lifetime exceeds the configured ceiling',
        'TENANT_INVITATION_TTL_INVALID',
        422,
      );
    }
    const rawToken = `${INVITATION_TOKEN_PREFIX}${createOpaqueToken(32)}`;
    const tokenHash = hashToken(rawToken);
    const invitationId = `tinv_${crypto.randomUUID()}`;
    const now = this.now();
    const expiresAt = now + ttlMs;
    this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.stmts.lockTenant.run(input.tenantId);
      const authority = this.requireMutationAuthority(
        input.tenantId,
        input.assertCurrentAuthority,
        isDefaultMemberRole(requestedRoleKeys)
          ? ['tenant.invitations:manage']
          : ['tenant.invitations:manage', 'tenant.roles:manage'],
      );
      const roleKeys = this.normalizeRoleKeys(requestedRoleKeys, {
        allPermissions: authority.scope.allPermissions === true,
        permissions: authority.scope.permissions,
      });
      const existingMembership = this.tenancy.getMembership(
        input.tenantId,
        this.users.getUserByEmail(email)?.userId ?? '',
      );
      if (existingMembership) {
        throw new AuthError(
          'That identity already has a retained tenant membership',
          'TENANT_MEMBERSHIP_EXISTS',
          409,
        );
      }
      this.expirePendingInvitations(now);
      this.stmts.revokePendingForEmail.run(now, now, input.tenantId, email);
      this.stmts.insertInvitation.run(
        invitationId,
        input.tenantId,
        email,
        tokenHash,
        JSON.stringify(roleKeys),
        authority.auth.userId,
        expiresAt,
        now,
        now,
      );
      input.afterPersist?.({
        invitationId,
        recipient: email,
        rawToken,
      });
      this.audit.append({
        action: 'tenant.invitation-issued',
        outcome: 'succeeded',
        scope: { kind: 'tenant', tenantId: input.tenantId },
        actor: authAuditActorFromContext(authority.auth),
        request: input.auditRequest,
        target: { type: 'tenant-invitation', id: invitationId },
        metadata: { 'role-count': roleKeys.length },
      });
    });
    return {
      invitation: toInvitation(this.requireInvitation(input.tenantId, invitationId)),
      token: rawToken,
    };
  }

  /** Resolve an outbox envelope against the live immutable invitation binding. */
  resolveInvitationDelivery(input: {
    invitationId: string;
    recipient: string;
    rawToken: string;
  }): AuthTenantInvitationDelivery | null {
    this.users.assertCurrentProfile();
    const now = this.now();
    this.expirePendingInvitations(now);
    const row = this.stmts.getInvitationByDeliveryId.get(
      input.invitationId,
    ) as InvitationRow | null;
    if (!row || row.status !== 'pending' || row.expires_at <= now) return null;
    const recipient = canonicalizeEmail(input.recipient);
    if (row.email !== recipient || row.token_hash !== hashToken(input.rawToken)) return null;
    const tenant = this.tenancy.getTenant(row.tenant_id);
    if (!tenant || tenant.status !== 'active') return null;
    const invitation = mapInvitation(row);
    return {
      invitationId: invitation.invitationId,
      recipient: invitation.email,
      roles: invitation.roleKeys,
      expiresAt: invitation.expiresAt,
      tenant: {
        tenantId: tenant.tenantId,
        name: tenant.name,
        slug: tenant.slug,
      },
    };
  }

  listInvitations(input: {
    tenantId: string;
    status?: AuthTenantInvitationStatus;
    limit?: number;
    cursor?: string;
  }): { invitations: AuthTenantInvitation[]; page: AuthTenantJoinRequestPage['page'] } {
    this.users.assertCurrentProfile();
    this.requireInvitationsEnabled();
    this.requireActiveTenant(input.tenantId);
    this.expirePendingInvitations(this.now());
    const limit = normalizeLimit(input.limit);
    const cursor = decodeCursor(input.cursor);
    const clauses = ['tenant_id = ?'];
    const args: Array<string | number> = [input.tenantId];
    if (input.status) {
      clauses.push('status = ?');
      args.push(input.status);
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
    return {
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
  }

  revokeInvitation(input: {
    tenantId: string;
    invitationId: string;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): AuthTenantInvitation {
    this.users.assertCurrentProfile();
    this.requireInvitationsEnabled();
    const now = this.now();
    return this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.stmts.lockTenant.run(input.tenantId);
      const authority = this.requireMutationAuthority(
        input.tenantId,
        input.assertCurrentAuthority,
        ['tenant.invitations:manage'],
      );
      this.expirePendingInvitations(now);
      const current = this.requireInvitation(input.tenantId, input.invitationId);
      if (current.status === 'revoked') return toInvitation(current);
      if (current.status !== 'pending') {
        throw new AuthError(
          'Invitation can no longer be revoked',
          'TENANT_INVITATION_STATUS_CONFLICT',
          409,
        );
      }
      if (this.stmts.revokeInvitation.run(
        now, now, input.tenantId, input.invitationId,
      ).changes !== 1) throw invitationConflict();
      this.audit.append({
        action: 'tenant.invitation-revoked',
        outcome: 'succeeded',
        scope: { kind: 'tenant', tenantId: input.tenantId },
        actor: authAuditActorFromContext(authority.auth),
        request: input.auditRequest,
        target: { type: 'tenant-invitation', id: input.invitationId },
      });
      return toInvitation(this.requireInvitation(input.tenantId, input.invitationId));
    });
  }

  inspectInvitation(rawToken: string): AuthTenantInvitationInspection {
    this.users.assertCurrentProfile();
    if (!this.config.invitations.enabled) return { available: false };
    const invitation = this.getUsableInvitation(rawToken);
    if (!invitation) return { available: false };
    const tenant = this.tenancy.getTenant(invitation.tenantId);
    if (!tenant || tenant.status !== 'active') return { available: false };
    return {
      available: true,
      tenant: { name: tenant.name, slug: tenant.slug },
      emailHint: maskEmail(invitation.email),
      expiresAt: invitation.expiresAt,
      account: this.users.getUserByEmail(invitation.email) ? 'sign-in' : 'create',
    };
  }

  /** Consume one exact invite and establish authority in the same transaction. */
  acceptInvitationForUser(
    rawToken: string,
    userId: string,
    admitIdentityProof?: () => boolean,
    auditContext?: {
      actor?: AuthAuditActor;
      request?: AuthAuditRequestContext;
    },
  ): AcceptedTenantInvitation {
    this.users.assertCurrentProfile();
    this.requireInvitationsEnabled();
    return this.db.transaction(() => {
      this.users.assertCurrentProfile();
      const user = this.requireEligibleUser(userId);
      const invitation = this.requireUsableInvitation(rawToken);
      if (canonicalizeEmail(user.email) !== invitation.email) throw invitationUnavailable();
      const tenant = this.requireActiveTenant(invitation.tenantId);
      this.stmts.lockTenant.run(tenant.tenantId);

      // Claim first. Every following failure rolls this update back, so a
      // blocked membership or role drift never burns the bearer grant.
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
      if (admitIdentityProof && !admitIdentityProof()) throw invitationUnavailable();

      const membership = this.admitInvitationMembership(
        tenant.tenantId,
        user.userId,
        invitation.roleKeys,
        invitation.issuedBy,
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
        actor: auditContext?.actor ?? {
          userId: current.userId,
          provenance: 'registration',
        },
        request: auditContext?.request,
        target: { type: 'tenant-membership', id: membership.membershipId },
        metadata: { 'invitation-id': invitation.invitationId },
      });
      return {
        user: this.users.getUserById(current.userId)!,
        membership,
        tenant: { tenantId: tenant.tenantId, name: tenant.name, slug: tenant.slug },
      };
    });
  }

  /**
   * Create a non-bootstrap identity only when the unconsumed invitation binds
   * the same canonical email. Ordinary registration policy is intentionally
   * not consulted or widened.
   */
  async createInvitationAccount(input: {
    token: string;
    username: string;
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    mfaRequired: boolean;
    properties: Record<string, string>;
    auditRequest?: AuthAuditRequestContext;
    /** Keep the invite unconsumed until the new identity completes MFA. */
    deferAcceptance?: boolean;
  }): Promise<AcceptedTenantInvitation | PendingTenantInvitationAccount> {
    this.users.assertCurrentProfile();
    this.requireInvitationsEnabled();
    if (!this.config.invitations.accountCreation) {
      throw new AuthError(
        'Invitation-bound account creation is disabled',
        'TENANT_INVITATION_ACCOUNT_CREATION_DISABLED',
        403,
      );
    }
    const invitation = this.requireUsableInvitation(input.token);
    const email = canonicalizeEmail(input.email);
    if (email !== invitation.email || !isValidEmail(email)) {
      throw invitationUnavailable();
    }
    if (this.users.getUserByEmail(email)) throw invitationAccountAuthRequired();

    const result: { accepted: AcceptedTenantInvitation | null } = { accepted: null };
    try {
      const created = await this.users.createRegistrationUser({
        username: input.username,
        email,
        password: input.password,
        firstName: input.firstName,
        lastName: input.lastName,
        properties: input.properties,
      }, (isBootstrap) => {
        if (isBootstrap) throw invitationUnavailable();
        return {
          role: 'user' as const,
          requireEmailVerification: false,
          mfaRequired: input.mfaRequired,
        };
      }, (user) => {
        if (input.deferAcceptance) {
          const current = this.requireUsableInvitation(input.token);
          if (current.email !== canonicalizeEmail(user.email)) {
            throw invitationUnavailable();
          }
          return;
        }
        result.accepted = this.acceptInvitationForUser(
          input.token,
          user.userId,
          undefined,
          {
            actor: { userId: user.userId, provenance: 'registration' },
            request: input.auditRequest,
          },
        );
      }, { auditRequest: input.auditRequest });
      const accepted = result.accepted;
      if (input.deferAcceptance) {
        return {
          user: this.users.getUserById(created.user.userId)!,
          invitationAcceptancePending: true,
        };
      }
      if (!accepted) throw invitationUnavailable();
      return {
        ...accepted,
        user: this.users.getUserById(created.user.userId)!,
      };
    } catch (error) {
      if (error instanceof AuthError
        && (error.code === 'DUPLICATE_EMAIL' || error.code === 'DUPLICATE_USERNAME')) {
        // Token holders may resolve an account collision only through the
        // existing identity's authentication ceremony.
        throw invitationAccountAuthRequired();
      }
      throw error;
    }
  }

  /** Submit/re-submit without exposing whether a guessed tenant slug exists. */
  submitJoinRequest(input: {
    userId: string;
    tenantSlug: string;
    admitIdentityProof?: () => boolean;
    auditActor?: AuthAuditActor;
    auditRequest?: AuthAuditRequestContext;
  }): { submitted: true } {
    this.users.assertCurrentProfile();
    this.requireJoinRequestsEnabled();
    const user = this.requireJoinRequestEligibleUser(input.userId);
    const tenant = safelyResolveTenant(this.tenancy, input.tenantSlug);
    if (!tenant || tenant.status !== 'active') return { submitted: true };

    this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.stmts.lockTenant.run(tenant.tenantId);
      if (input.admitIdentityProof && !input.admitIdentityProof()) {
        throw new AuthError(
          'Onboarding proof is unavailable',
          'TENANT_ONBOARDING_PROOF_INVALID',
          400,
        );
      }
      const membership = this.tenancy.getMembership(tenant.tenantId, user.userId);
      const current = this.getJoinRequestForUser(tenant.tenantId, user.userId);
      if (membership?.status === 'active') return;
      if (!current) {
        const now = this.now();
        const joinRequestId = `tjoin_${crypto.randomUUID()}`;
        this.stmts.insertJoinRequest.run(
          joinRequestId,
          tenant.tenantId,
          user.userId,
          canonicalizeEmail(user.email),
          now,
          now,
          now,
        );
        this.audit.append({
          action: 'tenant.join-request-submitted',
          outcome: 'succeeded',
          scope: { kind: 'tenant', tenantId: tenant.tenantId },
          actor: input.auditActor ?? {
            userId: user.userId,
            provenance: 'authenticated-request',
          },
          request: input.auditRequest,
          target: { type: 'tenant-join-request', id: joinRequestId },
        });
        return;
      }
      const now = this.now();
      const provenance = this.getAnyDomainJoinRequestProvenance(
        tenant.tenantId,
        current.joinRequestId,
      );
      if (current.status === 'pending') {
        // A pre-fence row cannot be guessed current. This explicit generic
        // submission retires it onto the old revision before creating a clean
        // generic revision. Current verified-domain submissions remain
        // idempotent and keep their server-fixed policy.
        if (provenance?.source !== 'legacy-unbound'
          || (provenance.request_revision !== null
            && provenance.request_revision !== current.requestRevision)) return;
        if (!this.canSubmitGenericJoinRequest(current, provenance, now)) return;
        this.bindLegacyProvenanceToRevision(current, provenance);
        if (this.stmts.supersedePendingJoinRequest.run(
          now,
          now,
          current.joinRequestId,
          tenant.tenantId,
          user.userId,
          current.requestRevision,
        ).changes !== 1) throw joinRequestConflict();
      } else {
        if (!this.canSubmitGenericJoinRequest(current, provenance, now)) return;
        this.bindLegacyProvenanceToRevision(current, provenance);
        if (this.stmts.reopenJoinRequest.run(
          now,
          now,
          current.joinRequestId,
          tenant.tenantId,
          user.userId,
          current.requestRevision,
        ).changes !== 1) throw joinRequestConflict();
      }
      this.audit.append({
        action: 'tenant.join-request-submitted',
        outcome: 'succeeded',
        scope: { kind: 'tenant', tenantId: tenant.tenantId },
        actor: input.auditActor ?? {
          userId: user.userId,
          provenance: 'authenticated-request',
        },
        request: input.auditRequest,
        target: { type: 'tenant-join-request', id: current.joinRequestId },
        metadata: { reopened: true },
      });
    });
    return { submitted: true };
  }

  listJoinRequests(input: {
    tenantId: string;
    status?: AuthTenantJoinRequestStatus;
    limit?: number;
    cursor?: string;
    /** Live request scope used only for the reviewer-safe approval projection. */
    approvalScope?: AuthorizationScopeSnapshot;
  }): AuthTenantJoinRequestPage {
    this.users.assertCurrentProfile();
    this.requireJoinRequestsEnabled();
    this.requireActiveTenant(input.tenantId);
    const limit = normalizeLimit(input.limit);
    const cursor = decodeCursor(input.cursor);
    const clauses = ['request.tenant_id = ?'];
    const args: Array<string | number> = [input.tenantId];
    if (input.status) {
      clauses.push('request.status = ?');
      args.push(input.status);
    }
    if (cursor) {
      clauses.push(`(
        request.requested_at > ?
        OR (request.requested_at = ? AND request.join_request_id > ?)
      )`);
      args.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
    const domainProjection = this.domainJoinRequestProjectionSql();
    const rows = this.db.prepare(`
      SELECT request.*, identity.username, identity.first_name, identity.last_name,
        ${domainProjection.column}
      FROM _auth_tenant_join_requests request
      INNER JOIN users identity ON identity.user_id = request.user_id
      ${domainProjection.join}
      WHERE ${clauses.join(' AND ')}
      ORDER BY request.requested_at ASC, request.join_request_id ASC
      LIMIT ?
    `).all(...args, limit + 1) as JoinRequestProjectionRow[];
    const hasMore = rows.length > limit;
    const selected = hasMore ? rows.slice(0, limit) : rows;
    const requests = selected.map((row) => this.projectJoinRequest(
      row,
      input.approvalScope,
    ));
    const last = selected.at(-1);
    return {
      requests,
      page: {
        limit,
        count: requests.length,
        hasMore,
        nextCursor: hasMore && last
          ? encodeCursor({ timestamp: last.requested_at, id: last.join_request_id })
          : null,
      },
    };
  }

  approveJoinRequest(input: {
    tenantId: string;
    joinRequestId: string;
    expectedRequestRevision: number;
    roleKeys?: readonly string[];
    reactivateMembership?: boolean;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): AuthTenantJoinRequest {
    this.users.assertCurrentProfile();
    this.requireJoinRequestsEnabled();
    return this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.stmts.lockTenant.run(input.tenantId);
      const request = this.requireJoinRequest(input.tenantId, input.joinRequestId);
      this.assertExpectedRequestRevision(request, input.expectedRequestRevision);
      const anyDomainProvenance = this.getAnyDomainJoinRequestProvenance(
        input.tenantId,
        request.joinRequestId,
      );
      if (anyDomainProvenance?.source === 'legacy-unbound'
        && (anyDomainProvenance.request_revision === null
          || anyDomainProvenance.request_revision === request.requestRevision)) {
        throw joinRequestProvenanceUnbound();
      }
      const domainProvenance = this.getDomainJoinRequestProvenance(
        input.tenantId,
        request.joinRequestId,
        request.requestRevision,
      );
      if (domainProvenance && domainProvenance.blocked_until !== null
        && domainProvenance.blocked_until > this.now()) throw joinRequestBlocked();
      const authority = this.requireMutationAuthority(
        input.tenantId,
        input.assertCurrentAuthority,
        ['tenant.join-requests:review'],
      );
      const approvalPolicy = this.getJoinRequestProjection(
        input.tenantId,
        input.joinRequestId,
        authority.scope,
      ).approvalPolicy;
      if (!approvalPolicy.canApprove) throw forbidden();
      if (input.roleKeys !== undefined
        && approvalPolicy.roleSelection.mode !== 'selectable') {
        throw serverOwnedJoinRequestRoles(approvalPolicy.roleSelection.mode);
      }
      const requestedRoleKeys = approvalPolicy.roleSelection.mode === 'selectable'
        ? input.roleKeys ?? approvalPolicy.roleSelection.defaultRoleKeys
        : approvalPolicy.roleSelection.roles.map((role) => role.key);
      const roleKeys = this.normalizeRoleKeys(requestedRoleKeys, {
        allPermissions: authority.scope.allPermissions === true,
        permissions: authority.scope.permissions,
      });
      if (request.status === 'approved') {
        if (domainProvenance && request.approvedMembershipId) {
          this.recordDomainMembershipProvenance(
            request.approvedMembershipId,
            request.joinRequestId,
            domainProvenance,
          );
        }
        return this.getJoinRequestProjection(
          input.tenantId,
          input.joinRequestId,
          authority.scope,
        );
      }
      if (request.status !== 'pending') throw joinRequestConflict();
      const user = this.requireEligibleUser(request.userId);
      let membership = this.tenancy.getMembership(input.tenantId, user.userId);
      if (!membership) {
        membership = this.tenancy.addMembership({
          tenantId: input.tenantId,
          userId: user.userId,
          roleKey: this.kernel.authorization.mode === 'simple' ? roleKeys[0]! : 'member',
          createdBy: authority.auth.userId,
        });
        if (this.kernel.authorization.mode === 'advanced') {
          this.requireAdvancedRoles().replaceTenantRoles({
            tenantId: input.tenantId,
            membershipId: membership.membershipId,
            roleKeys,
            changedBy: authority.auth.userId,
          });
          membership = this.tenancy.getMembershipById(membership.membershipId)!;
        }
      } else if (membership.status !== 'active') {
        if (input.reactivateMembership !== true) {
          throw new AuthError(
            'Explicit retained-membership reactivation is required',
            'TENANT_JOIN_REACTIVATION_REQUIRED',
            409,
          );
        }
        membership = this.readmitMembership(
          membership,
          roleKeys,
          authority.auth.userId,
        );
      }
      const now = this.now();
      if (this.stmts.approveJoinRequest.run(
        now,
        now,
        authority.auth.userId,
        membership.membershipId,
        request.joinRequestId,
        input.tenantId,
        input.expectedRequestRevision,
      ).changes !== 1) throw joinRequestConflict();
      if (domainProvenance) {
        this.recordDomainMembershipProvenance(
          membership.membershipId,
          request.joinRequestId,
          domainProvenance,
        );
      }
      this.audit.append({
        action: 'tenant.join-request-approved',
        outcome: 'succeeded',
        scope: { kind: 'tenant', tenantId: input.tenantId },
        actor: authAuditActorFromContext(authority.auth),
        request: input.auditRequest,
        target: { type: 'tenant-join-request', id: request.joinRequestId },
        metadata: {
          'membership-id': membership.membershipId,
          'role-count': roleKeys.length,
        },
      });
      return this.getJoinRequestProjection(
        input.tenantId,
        input.joinRequestId,
        authority.scope,
      );
    });
  }

  denyJoinRequest(input: {
    tenantId: string;
    joinRequestId: string;
    expectedRequestRevision: number;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): AuthTenantJoinRequest {
    this.users.assertCurrentProfile();
    this.requireJoinRequestsEnabled();
    return this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.stmts.lockTenant.run(input.tenantId);
      const authority = this.requireMutationAuthority(
        input.tenantId,
        input.assertCurrentAuthority,
        ['tenant.join-requests:review'],
      );
      const request = this.requireJoinRequest(input.tenantId, input.joinRequestId);
      this.assertExpectedRequestRevision(request, input.expectedRequestRevision);
      if (request.status === 'denied') {
        return this.getJoinRequestProjection(
          input.tenantId,
          input.joinRequestId,
          authority.scope,
        );
      }
      if (request.status !== 'pending') throw joinRequestConflict();
      const now = this.now();
      if (this.stmts.denyJoinRequest.run(
        now,
        now,
        authority.auth.userId,
        request.joinRequestId,
        input.tenantId,
        input.expectedRequestRevision,
      ).changes !== 1) throw joinRequestConflict();
      if (this.hasPrivateTable('_auth_domain_join_request_provenance')) {
        this.db.prepare(`UPDATE _auth_domain_join_request_provenance
          SET blocked_until = ?, updated_at = ?
          WHERE join_request_id = ? AND tenant_id = ?
            AND source = 'verified-domain' AND request_revision = ?`).run(
          now + this.config.verifiedDomains.deniedRetryCooldownMs,
          now,
          request.joinRequestId,
          input.tenantId,
          input.expectedRequestRevision,
        );
      }
      this.audit.append({
        action: 'tenant.join-request-denied',
        outcome: 'succeeded',
        scope: { kind: 'tenant', tenantId: input.tenantId },
        actor: authAuditActorFromContext(authority.auth),
        request: input.auditRequest,
        target: { type: 'tenant-join-request', id: request.joinRequestId },
      });
      return this.getJoinRequestProjection(
        input.tenantId,
        input.joinRequestId,
        authority.scope,
      );
    });
  }

  private admitInvitationMembership(
    tenantId: string,
    userId: string,
    roleKeys: readonly string[],
    issuedBy: string,
  ): TenantMembershipRecord {
    // Re-validate persisted roles against the current application registry.
    const normalized = this.normalizeRoleKeys(roleKeys);
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
      roleKey: this.kernel.authorization.mode === 'simple' ? normalized[0]! : 'member',
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

  private readmitMembership(
    membership: TenantMembershipRecord,
    roleKeys: readonly string[],
    changedBy: string,
  ): TenantMembershipRecord {
    let admitted = this.tenancy.readmitMembership(
      membership.membershipId,
      this.kernel.authorization.mode === 'simple' ? roleKeys[0]! : 'member',
    );
    if (this.kernel.authorization.mode === 'advanced') {
      this.requireAdvancedRoles().replaceTenantRoles({
        tenantId: membership.tenantId,
        membershipId: membership.membershipId,
        roleKeys,
        changedBy,
      });
      admitted = this.tenancy.getMembershipById(membership.membershipId)!;
    }
    return admitted;
  }

  private normalizeRoleKeys(
    input: readonly string[],
    ceiling?: AuthTenantRoleGrantCeiling,
  ): readonly string[] {
    if (!Array.isArray(input) || input.length < 1 || input.length > MAX_ROLE_COUNT) {
      throw invalidRoleSelection();
    }
    const keys = [...new Set(input.map((key) => (
      typeof key === 'string' ? key.trim() : ''
    )).filter(Boolean))].sort(compareKeys);
    if (keys.length < 1 || keys.length > MAX_ROLE_COUNT) throw invalidRoleSelection();
    if (this.kernel.authorization.mode === 'simple' && keys.length !== 1) {
      throw invalidRoleSelection();
    }
    for (const key of keys) {
      const role = this.kernel.authorization.roles[key];
      if (!role) {
        throw new AuthError(
          `Authorization role is not declared: ${key}`,
          'AUTHORIZATION_ROLE_UNDECLARED',
          422,
        );
      }
      if (role.system || key === 'owner') {
        throw new AuthError(
          'Protected roles cannot be granted through onboarding',
          'TENANT_OWNER_ROLE_PROTECTED',
          409,
        );
      }
      if (ceiling && !canGrantRole(role, ceiling)) {
        throw new AuthError(
          'An onboarding role exceeds the acting member authority',
          'TENANT_ROLE_ESCALATION_FORBIDDEN',
          403,
        );
      }
    }
    return Object.freeze(keys);
  }

  private requireActor(
    tenantId: string,
    membershipId: string,
    userId: string,
  ): TenantMembershipRecord {
    const membership = this.tenancy.getMembershipById(membershipId);
    if (!membership || membership.tenantId !== tenantId
      || membership.userId !== userId || membership.status !== 'active') {
      throw forbidden();
    }
    return membership;
  }

  private requireMutationAuthority(
    tenantId: string,
    assertCurrentAuthority: AssertAuthTenantMutationAuthority,
    permissions: readonly import('./types').PermissionKey[],
  ): AuthTenantMutationAuthority {
    const authority = assertCurrentAuthority(permissions);
    if (authority.scope.tenantId !== tenantId) throw forbidden();
    this.requireActiveTenant(tenantId);
    this.requireActor(
      tenantId,
      authority.scope.membershipId,
      authority.auth.userId,
    );
    return authority;
  }

  private requireActiveTenant(tenantId: string) {
    const tenant = this.tenancy.getTenant(tenantId);
    if (!tenant || tenant.status !== 'active') throw forbidden();
    return tenant;
  }

  private requireEligibleUser(userId: string): UserRecord {
    const user = this.users.getUserById(userId);
    if (!user || user.status !== 'active') throw invitationUnavailable();
    if (user.passwordChangeRequired) {
      throw new AuthError('Password change required', 'PASSWORD_CHANGE_REQUIRED', 403);
    }
    return user;
  }

  private requireJoinRequestEligibleUser(userId: string): UserRecord {
    const user = this.requireEligibleUser(userId);
    if (user.emailVerificationRequired && user.emailVerifiedAt === null) {
      throw new AuthError(
        'Email verification required',
        'EMAIL_VERIFICATION_REQUIRED',
        403,
      );
    }
    return user;
  }

  private expirePendingInvitations(now: number): void {
    this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.stmts.expireInvitations.run(now, now);
    });
  }

  private getUsableInvitation(rawToken: string): AuthTenantInvitationRecord | null {
    if (!isInvitationToken(rawToken)) return null;
    this.expirePendingInvitations(this.now());
    const row = this.stmts.getInvitationByHash.get(hashToken(rawToken)) as InvitationRow | null;
    if (!row) return null;
    const invitation = mapInvitation(row);
    return invitation.status === 'pending' && invitation.expiresAt > this.now()
      ? invitation
      : null;
  }

  private requireUsableInvitation(rawToken: string): AuthTenantInvitationRecord {
    return this.getUsableInvitation(rawToken) ?? (() => { throw invitationUnavailable(); })();
  }

  private requireInvitation(
    tenantId: string,
    invitationId: string,
  ): AuthTenantInvitationRecord {
    const row = this.stmts.getInvitationById.get(
      tenantId,
      invitationId,
    ) as InvitationRow | null;
    if (!row) {
      throw new AuthError('Invitation not found', 'TENANT_INVITATION_NOT_FOUND', 404);
    }
    return mapInvitation(row);
  }

  private getJoinRequestForUser(
    tenantId: string,
    userId: string,
  ): AuthTenantJoinRequestRecord | null {
    const row = this.stmts.getJoinRequestByTenantUser.get(
      tenantId,
      userId,
    ) as JoinRequestRow | null;
    return row ? mapJoinRequest(row) : null;
  }

  private getDomainJoinRequestProvenance(
    tenantId: string,
    joinRequestId: string,
    requestRevision: number,
  ): DomainJoinRequestProvenanceRow | null {
    if (!this.hasPrivateTable('_auth_domain_join_request_provenance')) return null;
    return this.db.prepare(`SELECT claim_id, domain, request_role_key, mailbox_proof_id,
        blocked_until, source, request_revision
      FROM _auth_domain_join_request_provenance
      WHERE tenant_id = ? AND join_request_id = ?
        AND source = 'verified-domain' AND request_revision = ?`).get(
      tenantId,
      joinRequestId,
      requestRevision,
    ) as DomainJoinRequestProvenanceRow | null;
  }

  private getAnyDomainJoinRequestProvenance(
    tenantId: string,
    joinRequestId: string,
  ): DomainJoinRequestProvenanceRow | null {
    if (!this.hasPrivateTable('_auth_domain_join_request_provenance')) return null;
    return this.db.prepare(`SELECT claim_id, domain, request_role_key, mailbox_proof_id,
        blocked_until, source, request_revision
      FROM _auth_domain_join_request_provenance
      WHERE tenant_id = ? AND join_request_id = ?`).get(
      tenantId,
      joinRequestId,
    ) as DomainJoinRequestProvenanceRow | null;
  }

  private bindLegacyProvenanceToRevision(
    request: AuthTenantJoinRequestRecord,
    provenance: DomainJoinRequestProvenanceRow | null,
  ): void {
    if (provenance?.source !== 'legacy-unbound'
      || provenance.request_revision !== null) return;
    this.db.prepare(`UPDATE _auth_domain_join_request_provenance
      SET request_revision = ?, updated_at = ?
      WHERE join_request_id = ? AND tenant_id = ?
        AND source = 'legacy-unbound' AND request_revision IS NULL`).run(
      request.requestRevision,
      this.now(),
      request.joinRequestId,
      request.tenantId,
    );
  }

  private canSubmitGenericJoinRequest(
    request: AuthTenantJoinRequestRecord,
    provenance: DomainJoinRequestProvenanceRow | null,
    now: number,
  ): boolean {
    if (!provenance) return true;
    const provenanceMayBeCurrent = provenance.request_revision === null
      || provenance.request_revision === request.requestRevision;
    if (!provenanceMayBeCurrent) return true;
    if (provenance.blocked_until !== null) return provenance.blocked_until <= now;
    if (request.status === 'denied' || request.status === 'cancelled') {
      // Missing cooldown metadata on a provenance-bearing terminal request is
      // never interpreted as permission to reopen immediately.
      const decisionAt = request.reviewedAt ?? request.requestedAt;
      return decisionAt + this.config.verifiedDomains.deniedRetryCooldownMs <= now;
    }
    return true;
  }

  private assertExpectedRequestRevision(
    request: AuthTenantJoinRequestRecord,
    expected: number,
  ): void {
    if (!Number.isSafeInteger(expected) || expected < 1
      || request.requestRevision !== expected) throw joinRequestRevisionConflict();
  }

  private recordDomainMembershipProvenance(
    membershipId: string,
    joinRequestId: string,
    provenance: DomainJoinRequestProvenanceRow,
  ): void {
    this.db.prepare(`
      INSERT INTO _auth_tenant_membership_provenance (
        membership_id, source, source_id, claim_id, domain, recorded_at
      ) VALUES (?, 'domain-request', ?, ?, ?, ?)
      ON CONFLICT(membership_id) DO NOTHING
    `).run(
      membershipId,
      joinRequestId,
      provenance.claim_id,
      provenance.domain,
      this.now(),
    );
  }

  private hasPrivateTable(name: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = ?`).get(name));
  }

  private requireJoinRequest(
    tenantId: string,
    joinRequestId: string,
  ): AuthTenantJoinRequestRecord {
    const row = this.stmts.getJoinRequestById.get(
      tenantId,
      joinRequestId,
    ) as JoinRequestRow | null;
    if (!row) {
      throw new AuthError('Join request not found', 'TENANT_JOIN_REQUEST_NOT_FOUND', 404);
    }
    return mapJoinRequest(row);
  }

  private getJoinRequestProjection(
    tenantId: string,
    joinRequestId: string,
    approvalScope?: AuthorizationScopeSnapshot,
  ): AuthTenantJoinRequest {
    const domainProjection = this.domainJoinRequestProjectionSql();
    const row = this.db.prepare(`
      SELECT request.*, identity.username, identity.first_name, identity.last_name,
        ${domainProjection.column}
      FROM _auth_tenant_join_requests request
      INNER JOIN users identity ON identity.user_id = request.user_id
      ${domainProjection.join}
      WHERE request.tenant_id = ? AND request.join_request_id = ?
    `).get(tenantId, joinRequestId) as JoinRequestProjectionRow | null;
    if (!row) {
      throw new AuthError('Join request not found', 'TENANT_JOIN_REQUEST_NOT_FOUND', 404);
    }
    return this.projectJoinRequest(row, approvalScope);
  }

  private projectJoinRequest(
    row: JoinRequestProjectionRow,
    approvalScope?: AuthorizationScopeSnapshot,
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
      approvalPolicy: this.projectJoinRequestApprovalPolicy(row, approvalScope),
    });
  }

  private projectJoinRequestApprovalPolicy(
    row: JoinRequestProjectionRow,
    approvalScope?: AuthorizationScopeSnapshot,
  ): AuthTenantJoinRequestApprovalPolicy {
    const scope = this.resolveApprovalProjectionScope(row.tenant_id, approvalScope);
    const domainRoleKey = row.domain_request_role_key;
    if (domainRoleKey) {
      const roles = Object.freeze([this.approvalRole(domainRoleKey)]);
      return Object.freeze({
        canApprove: row.domain_provenance_unbound !== 1
          && (row.domain_request_blocked_until === null
            || row.domain_request_blocked_until <= this.now())
          && this.canApproveRoleKeys(roles.map((role) => role.key), scope),
        roleSelection: Object.freeze({ mode: 'fixed' as const, roles }),
      });
    }

    const defaultRoles = Object.freeze([this.approvalRole('member')]);
    if (this.kernel.authorization.mode === 'advanced'
      && scope
      && hasScopePermission(scope, 'tenant.roles:manage')) {
      const roles = Object.freeze(Object.values(this.kernel.authorization.roles)
        .filter((role) => role.key !== 'owner'
          && !role.system
          && canGrantRole(role, {
            allPermissions: scope.allPermissions === true,
            permissions: scope.permissions,
          }))
        .sort((left, right) => compareKeys(left.key, right.key))
        .map((role) => Object.freeze({
          key: role.key,
          label: role.label,
        })));
      if (roles.length > 0) {
        const defaultRoleKeys = Object.freeze(roles.some((role) => role.key === 'member')
          ? ['member']
          : [roles[0]!.key]);
        return Object.freeze({
          canApprove: hasScopePermission(scope, 'tenant.join-requests:review'),
          roleSelection: Object.freeze({
            mode: 'selectable' as const,
            defaultRoleKeys,
            maxRoleCount: MAX_ROLE_COUNT,
            roles,
          }),
        });
      }
    }

    return Object.freeze({
      canApprove: this.canApproveRoleKeys(['member'], scope),
      roleSelection: Object.freeze({ mode: 'default' as const, roles: defaultRoles }),
    });
  }

  private approvalRole(roleKey: string): AuthTenantJoinRequestApprovalRole {
    const role = this.kernel.authorization.roles[roleKey];
    return Object.freeze({
      key: roleKey,
      label: role?.label ?? roleKey,
    });
  }

  private resolveApprovalProjectionScope(
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

  private domainJoinRequestProjectionSql(): { column: string; join: string } {
    if (!this.hasPrivateTable('_auth_domain_join_request_provenance')) {
      return {
        column: `NULL AS domain_request_role_key,
          NULL AS domain_request_blocked_until,
          0 AS domain_provenance_unbound`,
        join: '',
      };
    }
    return {
      column: `CASE
          WHEN (domain_provenance.source = 'verified-domain'
              AND domain_provenance.request_revision = request.request_revision)
            OR (domain_provenance.source = 'legacy-unbound'
              AND (domain_provenance.request_revision IS NULL
                OR domain_provenance.request_revision = request.request_revision))
          THEN domain_provenance.request_role_key ELSE NULL
        END AS domain_request_role_key,
        CASE
          WHEN domain_provenance.source = 'verified-domain'
            AND domain_provenance.request_revision = request.request_revision
          THEN domain_provenance.blocked_until ELSE NULL
        END AS domain_request_blocked_until,
        CASE
          WHEN domain_provenance.source = 'legacy-unbound'
            AND (domain_provenance.request_revision IS NULL
              OR domain_provenance.request_revision = request.request_revision)
          THEN 1 ELSE 0
        END AS domain_provenance_unbound`,
      join: `LEFT JOIN _auth_domain_join_request_provenance domain_provenance
        ON domain_provenance.tenant_id = request.tenant_id
        AND domain_provenance.join_request_id = request.join_request_id`,
    };
  }

  private canApproveRoleKeys(
    roleKeys: readonly string[],
    scope: AuthorizationScopeSnapshot | null,
  ): boolean {
    if (!scope || !hasScopePermission(scope, 'tenant.join-requests:review')) return false;
    if (!isDefaultMemberRole(roleKeys)
      && !hasScopePermission(scope, 'tenant.roles:manage')) return false;
    return roleKeys.every((roleKey) => {
      const role = this.kernel.authorization.roles[roleKey];
      return Boolean(role && roleKey !== 'owner' && !role.system && canGrantRole(role, {
        allPermissions: scope.allPermissions === true,
        permissions: scope.permissions,
      }));
    });
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

  private requireInvitationsEnabled(): void {
    if (!this.config.invitations.enabled) {
      throw new AuthError(
        'Tenant invitations are unavailable',
        'TENANT_INVITATIONS_UNAVAILABLE',
        404,
      );
    }
  }

  private requireJoinRequestsEnabled(): void {
    if (!this.config.joinRequests.enabled) {
      throw new AuthError(
        'Tenant join requests are unavailable',
        'TENANT_JOIN_REQUESTS_UNAVAILABLE',
        404,
      );
    }
  }
}

function mapInvitation(row: InvitationRow): AuthTenantInvitationRecord {
  const roles = parseRoleKeys(row.role_keys_json);
  return {
    invitationId: row.invitation_id,
    tenantId: row.tenant_id,
    email: canonicalizeEmail(row.email),
    roleKeys: roles,
    status: row.status as AuthTenantInvitationStatus,
    issuedBy: row.issued_by,
    acceptedByUserId: row.accepted_by_user_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
  };
}

function toInvitation(record: AuthTenantInvitationRecord): AuthTenantInvitation {
  return Object.freeze({
    invitationId: record.invitationId,
    email: record.email,
    roles: Object.freeze([...record.roleKeys]),
    status: record.status,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    acceptedAt: record.acceptedAt,
    revokedAt: record.revokedAt,
  });
}

function mapJoinRequest(row: JoinRequestRow): AuthTenantJoinRequestRecord {
  return {
    joinRequestId: row.join_request_id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    email: canonicalizeEmail(row.email),
    status: row.status as AuthTenantJoinRequestStatus,
    requestRevision: row.request_revision,
    requestedAt: row.requested_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    lastDecision: row.last_decision as 'approved' | 'denied' | null,
    approvedMembershipId: row.approved_membership_id,
  };
}

function parseRoleKeys(value: string): readonly string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)
      || parsed.length < 1
      || parsed.length > MAX_ROLE_COUNT
      || parsed.some((key) => typeof key !== 'string')) {
      throw new Error('invalid');
    }
    return Object.freeze([...parsed]);
  } catch {
    throw new AuthError(
      'Stored invitation role binding is invalid',
      'AUTH_POLICY_UNAVAILABLE',
      503,
    );
  }
}

function safelyResolveTenant(tenancy: TenancyService, slug: string) {
  try {
    return tenancy.getTenantBySlug(slug);
  } catch {
    return null;
  }
}

function canGrantRole(
  role: { permissions: readonly string[]; allPermissions: boolean },
  ceiling: AuthTenantRoleGrantCeiling,
): boolean {
  if (ceiling.allPermissions) return true;
  if (role.allPermissions) return false;
  const allowed = new Set(ceiling.permissions);
  return role.permissions.every((permission) => allowed.has(permission));
}

function hasScopePermission(
  scope: Pick<AuthorizationScopeSnapshot, 'allPermissions' | 'permissions'>,
  permission: PermissionKey,
): boolean {
  return scope.allPermissions === true || scope.permissions.includes(permission);
}

function isDefaultMemberRole(roles: readonly string[]): boolean {
  return roles.length === 1 && roles[0] === 'member';
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PAGE_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_LIMIT) {
    throw new AuthError(
      `Page limit must be between 1 and ${MAX_PAGE_LIMIT}`,
      'TENANT_ONBOARDING_PAGE_INVALID',
      422,
    );
  }
  return value;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  if (value.length > MAX_CURSOR_LENGTH) throw invalidCursor();
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') throw invalidCursor();
    const timestamp = Reflect.get(parsed, 'timestamp');
    const id = Reflect.get(parsed, 'id');
    if (!Number.isSafeInteger(timestamp) || timestamp < 0
      || typeof id !== 'string' || id.length < 1 || id.length > 200) {
      throw invalidCursor();
    }
    return { timestamp, id };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw invalidCursor();
  }
}

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}${email.slice(at)}`;
}

function isInvitationToken(value: string): boolean {
  return typeof value === 'string'
    && value.startsWith(INVITATION_TOKEN_PREFIX)
    && value.length >= INVITATION_TOKEN_PREFIX.length + 40
    && value.length <= 200;
}

function invalidCursor(): AuthError {
  return new AuthError('Page cursor is invalid', 'TENANT_ONBOARDING_PAGE_INVALID', 422);
}

function invalidRoleSelection(): AuthError {
  return new AuthError(
    'Onboarding role selection is invalid',
    'TENANT_ROLE_SELECTION_INVALID',
    422,
  );
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

function invitationConflict(): AuthError {
  return new AuthError(
    'Invitation state changed; reload and try again',
    'TENANT_INVITATION_STATUS_CONFLICT',
    409,
  );
}

function joinRequestConflict(): AuthError {
  return new AuthError(
    'Join request state changed; reload and try again',
    'TENANT_JOIN_REQUEST_STATUS_CONFLICT',
    409,
  );
}

function joinRequestRevisionConflict(): AuthError {
  return new AuthError(
    'Join request revision changed; reload and try again',
    'TENANT_JOIN_REQUEST_REVISION_CONFLICT',
    409,
  );
}

function joinRequestBlocked(): AuthError {
  return new AuthError(
    'Join request admission is temporarily blocked',
    'TENANT_JOIN_REQUEST_BLOCKED',
    409,
  );
}

function joinRequestProvenanceUnbound(): AuthError {
  return new AuthError(
    'Join request provenance must be refreshed before approval',
    'TENANT_JOIN_REQUEST_PROVENANCE_UNBOUND',
    409,
  );
}

function serverOwnedJoinRequestRoles(mode: 'fixed' | 'default'): AuthError {
  return new AuthError(
    mode === 'fixed'
      ? 'Verified-domain requests use the role fixed by the tenant policy'
      : 'This join request uses the server-owned default role',
    mode === 'fixed'
      ? 'AUTH_DOMAIN_REQUEST_ROLE_FIXED'
      : 'TENANT_JOIN_REQUEST_ROLE_SERVER_OWNED',
    409,
  );
}

function forbidden(): AuthError {
  return new AuthError('Forbidden', 'FORBIDDEN', 403);
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
