/** Transport-neutral exact verified-domain request-onboarding control plane. */

import { timingSafeEqual } from 'node:crypto';
import type { Statement } from 'bun:sqlite';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { ReactiveDB } from '../sync/reactive-db';
import { createOpaqueToken, hashToken } from '../tokens/token-utils';
import type { AuthorizationKernel } from './authorization-kernel';
import type {
  AssertAuthTenantMutationAuthority,
} from './auth-tenant-mutation-authority';
import type { ResolvedAuthTenantOnboardingConfig } from './auth-tenant-onboarding-types';
import type { AuthSessionContinuationRecord } from './auth-session-continuation-store';
import { AuthError, type UserRecord } from './types';
import type { TenancyService } from './tenancy/tenancy-service';
import type { UserStore } from './user-store';
import { canonicalizeEmail } from './auth-email-identity';
import {
  canonicalizeVerifiedDomain,
  verifiedDomainFromEmail,
  VerifiedDomainNameError,
} from './verified-domain-name';
import { resolveBoundedTxt } from './verified-domain-dns';
import {
  defineVerifiedDomainReleaseTables,
  defineVerifiedDomainTables,
} from './verified-domain-schema';
import {
  authAuditActorFromContext,
  type AuthAuditService,
} from './auth-audit-service';
import type { AuthAuditRequestContext } from './auth-audit-types';

export type AuthTenantDomainClaimStatus = 'pending' | 'verified' | 'grace' | 'lost';

export interface AuthTenantDomainClaimProjection {
  claimId: string;
  domain: string;
  status: AuthTenantDomainClaimStatus;
  proofMethod: 'dns-txt';
  verifiedAt: number | null;
  lastCheckedAt: number | null;
  nextCheckAt: number | null;
  validUntil: number | null;
  challengeExpiresAt: number | null;
  policy: {
    enabled: boolean;
    admission: 'request-to-join';
    requestRoleKey: string | null;
    revision: string;
  };
  revision: string;
  createdAt: number;
  updatedAt: number;
}

export interface AuthTenantDomainChallengeResult {
  claim: AuthTenantDomainClaimProjection;
  challenge: {
    recordType: 'TXT';
    name: string;
    value: string;
    expiresAt: number;
  };
}

export interface AuthTenantDomainReleaseResult {
  release: {
    claimId: string;
    domain: string;
    releasedAt: number;
    quarantineUntil: number;
  };
}

export type AuthDomainOnboardingCompletion =
  | {
      option: { action: 'request-to-join'; tenant: { name: string; slug: string } };
      continuation: string;
      expiresAt: number;
    }
  | {
      option: {
        action: 'request-pending';
        tenant: { name: string; slug: string };
        request: { joinRequestId: string; status: 'pending'; createdAt: number };
      };
    }
  | { option: { action: 'unavailable' } };

export interface DomainMailboxJobBinding {
  userId: string;
  email: string;
  emailGeneration: number;
  authGeneration: number;
  identityKind: 'session' | 'continuation';
  identityContinuationId: string | null;
}

export interface DomainAdmissionIdentityBinding {
  userId: string;
  authGeneration: number;
  identityKind: 'session' | 'continuation';
  identityContinuationId: string | null;
}

interface ClaimRow {
  claim_id: string;
  tenant_id: string;
  domain: string;
  status: AuthTenantDomainClaimStatus;
  challenge_digest: string | null;
  challenge_expires_at: number | null;
  verification_digest: string | null;
  verified_at: number | null;
  last_checked_at: number | null;
  next_check_at: number | null;
  valid_until: number | null;
  revision: number;
  lease_owner: string | null;
  lease_expires_at: number | null;
  released_at: number | null;
  released_by: string | null;
  quarantine_until: number | null;
  created_at: number;
  updated_at: number;
}

interface ClaimPolicyRow {
  enabled: number;
  admission: 'request-to-join';
  request_role_key: string | null;
  policy_revision: number;
}

interface MailboxTokenRow {
  token_id: string;
  outbox_job_id: string;
  application_id: string;
  user_id: string;
  email: string;
  email_generation: number;
  auth_generation: number;
  identity_kind: 'session' | 'continuation';
  identity_continuation_id: string | null;
  expires_at: number;
  consumed_at: number | null;
}

interface TransactionRow {
  transaction_id: string;
  application_id: string;
  user_id: string;
  email: string;
  email_generation: number;
  auth_generation: number;
  identity_kind: 'session' | 'continuation';
  identity_continuation_id: string | null;
  mailbox_proof_id: string;
  domain: string;
  claim_id: string;
  claim_revision: number;
  policy_revision: number;
  tenant_id: string;
  request_role_key: string;
  expires_at: number;
  consumed_at: number | null;
}

interface JoinRequestRow {
  join_request_id: string;
  status: 'pending' | 'approved' | 'denied' | 'cancelled';
  request_revision: number;
  created_at: number;
  reviewed_at: number | null;
}

const CLAIM_REVISION_PREFIX = 'vdc_';
const POLICY_REVISION_PREFIX = 'vdp_';
const DNS_RECORD_PREFIX = '_zero-domain-verification';
const DNS_VALUE_PREFIX = 'zero-domain-verification=';
const MAILBOX_TOKEN_PREFIX = 'zdmp_';
const ADMISSION_TOKEN_PREFIX = 'zdoa_';
const REVERIFY_BATCH = 8;
const CLEANUP_BATCH = 100;
const MAX_MAILBOX_TOKENS_PER_JOB = 16;
const WORKER_POLL_MS = 60_000;
export const VERIFIED_DOMAIN_RELEASE_QUARANTINE_MS = 7 * 86_400_000;

export class VerifiedDomainOnboardingService {
  readonly config: ResolvedAuthTenantOnboardingConfig['verifiedDomains'];
  readonly applicationId: string;
  private readonly workerId = `vdw_${crypto.randomUUID()}`;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<number> | null = null;
  private stopped = false;
  private readonly getClaim: Statement;
  private readonly getClaimByDomain: Statement;
  private readonly getTransactionByHash: Statement;

  constructor(
    private readonly db: ReactiveDB,
    config: ResolvedAuthTenantOnboardingConfig['verifiedDomains'],
    private readonly kernel: AuthorizationKernel,
    private readonly users: UserStore,
    private readonly tenancy: TenancyService,
    applicationId: string,
    private readonly now: () => number = Date.now,
    private readonly auditService?: AuthAuditService,
  ) {
    this.config = config;
    this.applicationId = applicationId;
    defineVerifiedDomainTables(db);
    defineVerifiedDomainReleaseTables(db);
    this.assertConfiguredRoles();
    this.getClaim = db.prepare(`SELECT * FROM _auth_tenant_domain_claims
      WHERE tenant_id = ? AND claim_id = ? AND released_at IS NULL`);
    this.getClaimByDomain = db.prepare(`SELECT * FROM _auth_tenant_domain_claims
      WHERE domain = ? AND released_at IS NULL`);
    this.getTransactionByHash = db.prepare(`
      SELECT * FROM _auth_domain_onboarding_transactions
      WHERE application_id = ? AND token_hash = ?
    `);
  }

  start(): void {
    this.users.assertCurrentProfile();
    if (this.timer || this.stopped) return;
    this.cleanupExpiredEvidence();
    if (!this.config.enabled) return;
    this.timer = setInterval(() => this.runWorkerPass(), WORKER_POLL_MS);
    this.timer.unref?.();
    this.runWorkerPass();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running?.catch(() => undefined);
  }

  get requestRoles() {
    this.users.assertCurrentProfile();
    return Object.freeze(this.config.allowedRequestRoles.map((key) => {
      const role = this.kernel.authorization.roles[key]!;
      return Object.freeze({
        key,
        label: role.label,
        ...(role.description ? { description: role.description } : {}),
      });
    }));
  }

  listClaims(tenantId: string): readonly AuthTenantDomainClaimProjection[] {
    this.users.assertCurrentProfile();
    this.requireEnabled();
    this.requireActiveTenant(tenantId);
    this.reconcileClaimStatuses();
    const rows = this.db.prepare(`
      SELECT claim.*, policy.enabled, policy.admission,
        policy.request_role_key, policy.revision AS policy_revision
      FROM _auth_tenant_domain_claims claim
      INNER JOIN _auth_tenant_domain_policies policy ON policy.claim_id = claim.claim_id
      WHERE claim.tenant_id = ? AND claim.released_at IS NULL
      ORDER BY claim.created_at ASC, claim.claim_id ASC
    `).all(tenantId) as Array<ClaimRow & ClaimPolicyRow>;
    return Object.freeze(rows.map(projectClaim));
  }

  createClaim(input: {
    tenantId: string;
    domain: string;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): AuthTenantDomainChallengeResult {
    this.users.assertCurrentProfile();
    this.requireEnabled();
    const domain = this.canonicalizeDomain(input.domain);
    const challenge = createDnsChallenge(domain, this.config.challengeTTLms, this.now());
    const claimId = `vdc_${crypto.randomUUID()}`;
    const now = this.now();
    try {
      this.db.transaction(() => {
        this.users.assertCurrentProfile();
        this.lockTenant(input.tenantId);
        const authority = this.requireAuthority(
          input.tenantId,
          input.assertCurrentAuthority,
          ['tenant.domains:verify'],
        );
        if (this.getClaimByDomain.get(domain)) throw domainUnavailable();
        const quarantine = this.db.prepare(`SELECT tenant_id, quarantine_until
          FROM _auth_tenant_domain_claims
          WHERE domain = ? AND released_at IS NOT NULL
          ORDER BY released_at DESC, claim_id DESC
          LIMIT 1`).get(domain) as {
            tenant_id: string;
            quarantine_until: number;
          } | null;
        if (quarantine && quarantine.tenant_id !== input.tenantId
          && quarantine.quarantine_until > now) {
          throw domainUnavailable();
        }
        const retained = this.db.prepare(`SELECT COUNT(*) AS count
          FROM _auth_tenant_domain_claims WHERE tenant_id = ?`).get(
          input.tenantId,
        ) as { count: number };
        if (retained.count >= this.config.maxClaimsPerTenant) {
          throw new AuthError(
            'Verified-domain claim limit reached',
            'AUTH_DOMAIN_CLAIM_LIMIT_REACHED',
            409,
          );
        }
        this.db.prepare(`
          INSERT INTO _auth_tenant_domain_claims (
            claim_id, tenant_id, domain, status, proof_method,
            challenge_digest, challenge_expires_at, verification_digest,
            verified_at, last_checked_at, next_check_at, valid_until,
            revision, lease_owner, lease_expires_at, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, 'pending', 'dns-txt', ?, ?, NULL,
            NULL, NULL, NULL, NULL, 1, NULL, NULL, ?, ?, ?)
        `).run(
          claimId,
          input.tenantId,
          domain,
          challenge.digest,
          challenge.expiresAt,
          authority.auth.userId,
          now,
          now,
        );
        this.db.prepare(`
          INSERT INTO _auth_tenant_domain_policies (
            claim_id, enabled, admission, request_role_key, revision,
            updated_by, created_at, updated_at
          ) VALUES (?, 0, 'request-to-join', NULL, 1, ?, ?, ?)
        `).run(claimId, authority.auth.userId, now, now);
        this.auditService?.append({
          action: 'tenant.domain-claim-created',
          outcome: 'succeeded',
          scope: { kind: 'tenant', tenantId: input.tenantId },
          actor: authAuditActorFromContext(authority.auth),
          request: input.auditRequest,
          target: { type: 'tenant-domain-claim', id: claimId },
        });
      });
    } catch (error) {
      if (isUniqueConstraint(error)) throw domainUnavailable();
      throw error;
    }
    emitPlatformCode(OBS_CODES.AUTH_DOMAIN_CLAIM_CREATED, {
      userId: undefined,
      metadata: { claimId, tenantId: input.tenantId },
    });
    return {
      claim: this.requireProjectedClaim(input.tenantId, claimId),
      challenge: challenge.public,
    };
  }

  issueChallenge(input: {
    tenantId: string;
    claimId: string;
    expectedRevision: string;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): AuthTenantDomainChallengeResult {
    this.users.assertCurrentProfile();
    this.requireEnabled();
    const current = this.requireClaim(input.tenantId, input.claimId);
    const challenge = createDnsChallenge(
      current.domain,
      this.config.challengeTTLms,
      this.now(),
    );
    const now = this.now();
    this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.lockTenant(input.tenantId);
      const authority = this.requireAuthority(
        input.tenantId,
        input.assertCurrentAuthority,
        ['tenant.domains:verify'],
      );
      const claim = this.requireClaim(input.tenantId, input.claimId);
      this.assertClaimRevision(claim, input.expectedRevision);
      if (claim.challenge_expires_at
        && now - claim.updated_at < this.config.dnsCheckCooldownMs) {
        throw rateLimited();
      }
      const changed = this.db.prepare(`
        UPDATE _auth_tenant_domain_claims
        SET challenge_digest = ?, challenge_expires_at = ?, revision = revision + 1,
            updated_at = ?
        WHERE tenant_id = ? AND claim_id = ? AND revision = ?
          AND released_at IS NULL
      `).run(
        challenge.digest,
        challenge.expiresAt,
        now,
        input.tenantId,
        input.claimId,
        claim.revision,
      );
      if (changed.changes !== 1) throw claimRevisionConflict();
      this.auditService?.append({
        action: 'tenant.domain-challenge-issued',
        outcome: 'succeeded',
        scope: { kind: 'tenant', tenantId: input.tenantId },
        actor: authAuditActorFromContext(authority.auth),
        request: input.auditRequest,
        target: { type: 'tenant-domain-claim', id: input.claimId },
      });
    });
    emitPlatformCode(OBS_CODES.AUTH_DOMAIN_CHALLENGE_ISSUED, {
      metadata: { claimId: input.claimId, tenantId: input.tenantId },
    });
    return {
      claim: this.requireProjectedClaim(input.tenantId, input.claimId),
      challenge: challenge.public,
    };
  }

  async verifyClaim(input: {
    tenantId: string;
    claimId: string;
    expectedRevision: string;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): Promise<AuthTenantDomainClaimProjection> {
    this.users.assertCurrentProfile();
    this.requireEnabled();
    const lease = this.acquireManualLease(input);
    let answers: readonly string[];
    try {
      answers = await this.resolveAnswers(lease.domain);
    } catch {
      this.releaseUnavailableLease({
        tenantId: input.tenantId,
        claimId: input.claimId,
        revision: lease.revision,
        leaseOwner: lease.leaseOwner,
        scheduleRetry: false,
      });
      emitPlatformCode(OBS_CODES.AUTH_DOMAIN_DNS_UNAVAILABLE, {
        metadata: { claimId: input.claimId, tenantId: input.tenantId },
      });
      throw dnsUnavailable();
    }
    const matched = answers.some((answer) => digestMatches(lease.digest, answer));
    const claim = this.finalizeLease({
      tenantId: input.tenantId,
      claimId: input.claimId,
      leaseOwner: lease.leaseOwner,
      expectedRevision: lease.revision,
      matched,
      assertCurrentAuthority: input.assertCurrentAuthority,
      auditRequest: input.auditRequest,
    });
    emitPlatformCode(
      matched ? OBS_CODES.AUTH_DOMAIN_VERIFIED : OBS_CODES.AUTH_DOMAIN_VERIFICATION_FAILED,
      { metadata: { claimId: input.claimId, tenantId: input.tenantId } },
    );
    return claim;
  }

  updatePolicy(input: {
    tenantId: string;
    claimId: string;
    enabled: boolean;
    requestRoleKey: string | null;
    expectedRevision: string;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): AuthTenantDomainClaimProjection {
    this.users.assertCurrentProfile();
    this.requireEnabled();
    const role = input.requestRoleKey === null
      ? null
      : this.requireConfiguredRole(input.requestRoleKey);
    if (input.enabled && !role) {
      throw new AuthError(
        'An enabled domain policy requires a configured request role',
        'AUTH_DOMAIN_POLICY_INVALID',
        422,
      );
    }
    const now = this.now();
    this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.lockTenant(input.tenantId);
      const authority = this.requireAuthority(
        input.tenantId,
        input.assertCurrentAuthority,
        ['tenant.onboarding:manage'],
      );
      this.requireClaim(input.tenantId, input.claimId);
      const policy = this.getPolicy(input.claimId);
      if (policyRevision(policy.policy_revision) !== input.expectedRevision) {
        throw policyRevisionConflict();
      }
      const changed = this.db.prepare(`
        UPDATE _auth_tenant_domain_policies
        SET enabled = ?, request_role_key = ?, revision = revision + 1,
            updated_by = ?, updated_at = ?
        WHERE claim_id = ? AND revision = ?
      `).run(
        input.enabled ? 1 : 0,
        role,
        authority.auth.userId,
        now,
        input.claimId,
        policy.policy_revision,
      );
      if (changed.changes !== 1) throw policyRevisionConflict();
      this.auditService?.append({
        action: 'tenant.domain-policy-updated',
        outcome: 'succeeded',
        scope: { kind: 'tenant', tenantId: input.tenantId },
        actor: authAuditActorFromContext(authority.auth),
        request: input.auditRequest,
        target: { type: 'tenant-domain-claim', id: input.claimId },
        metadata: { enabled: input.enabled },
      });
    });
    emitPlatformCode(OBS_CODES.AUTH_DOMAIN_POLICY_UPDATED, {
      metadata: { claimId: input.claimId, tenantId: input.tenantId },
    });
    return this.requireProjectedClaim(input.tenantId, input.claimId);
  }

  /**
   * Retire one active claim without deleting its evidence or provenance.
   * Reuse always requires a new claim id and fresh random DNS challenge.
   */
  releaseClaim(input: {
    tenantId: string;
    claimId: string;
    expectedRevision: string;
    expectedPolicyRevision: string;
    confirmDomain: string;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): AuthTenantDomainReleaseResult {
    this.users.assertCurrentProfile();
    this.requireEnabled();
    const result = this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.lockTenant(input.tenantId);
      const authority = this.requireAuthority(
        input.tenantId,
        input.assertCurrentAuthority,
        ['tenant.domains:release'],
      );
      const claim = this.requireClaim(input.tenantId, input.claimId);
      this.assertClaimRevision(claim, input.expectedRevision);
      const policy = this.getPolicy(input.claimId);
      if (policyRevision(policy.policy_revision) !== input.expectedPolicyRevision) {
        throw policyRevisionConflict();
      }
      if (input.confirmDomain !== claim.domain) throw releaseConfirmationMismatch();

      const releasedAt = this.now();
      const quarantineUntil = releasedAt + VERIFIED_DOMAIN_RELEASE_QUARANTINE_MS;
      const policyChanged = this.db.prepare(`
        UPDATE _auth_tenant_domain_policies
        SET enabled = 0, request_role_key = NULL, revision = revision + 1,
            updated_by = ?, updated_at = ?
        WHERE claim_id = ? AND revision = ?
      `).run(
        authority.auth.userId,
        releasedAt,
        claim.claim_id,
        policy.policy_revision,
      );
      if (policyChanged.changes !== 1) throw policyRevisionConflict();

      const invalidatedTransactions = this.db.prepare(`
        UPDATE _auth_domain_onboarding_transactions
        SET consumed_at = ?
        WHERE claim_id = ? AND consumed_at IS NULL
      `).run(releasedAt, claim.claim_id).changes;

      const snapshottedRequests = this.db.prepare(`
        INSERT INTO _auth_released_domain_join_provenance (
          claim_id, join_request_id, tenant_id, user_id, domain,
          request_role_key, source, request_revision,
          released_at, blocked_until, released_by
        )
        SELECT provenance.claim_id, provenance.join_request_id,
          provenance.tenant_id, provenance.user_id, provenance.domain,
          provenance.request_role_key, provenance.source,
          provenance.request_revision, ?, ?, ?
        FROM _auth_domain_join_request_provenance provenance
        INNER JOIN _auth_tenant_join_requests request
          ON request.join_request_id = provenance.join_request_id
        WHERE provenance.claim_id = ? AND request.status = 'pending'
          AND provenance.source = 'verified-domain'
          AND provenance.request_revision = request.request_revision
      `).run(
        releasedAt,
        quarantineUntil,
        authority.auth.userId,
        claim.claim_id,
      ).changes;
      this.db.prepare(`
        UPDATE _auth_domain_join_request_provenance
        SET blocked_until = CASE
              WHEN blocked_until IS NULL OR blocked_until < ? THEN ?
              ELSE blocked_until
            END,
            request_revision = request_revision + 1,
            updated_at = ?
        WHERE claim_id = ? AND EXISTS (
          SELECT 1 FROM _auth_tenant_join_requests request
          WHERE request.join_request_id = _auth_domain_join_request_provenance.join_request_id
            AND request.status = 'pending'
            AND _auth_domain_join_request_provenance.source = 'verified-domain'
            AND _auth_domain_join_request_provenance.request_revision
              = request.request_revision
        )
      `).run(
        quarantineUntil,
        quarantineUntil,
        releasedAt,
        claim.claim_id,
      );
      const cancelledRequests = this.db.prepare(`
        UPDATE _auth_tenant_join_requests
        SET status = 'cancelled', request_revision = request_revision + 1,
            updated_at = ?, reviewed_at = ?, reviewed_by = ?,
            last_decision = NULL, approved_membership_id = NULL
        WHERE status = 'pending' AND join_request_id IN (
          SELECT join_request_id FROM _auth_domain_join_request_provenance
          WHERE claim_id = ? AND source = 'verified-domain'
            AND request_revision = _auth_tenant_join_requests.request_revision + 1
        )
      `).run(
        releasedAt,
        releasedAt,
        authority.auth.userId,
        claim.claim_id,
      ).changes;
      if (cancelledRequests !== snapshottedRequests) {
        throw new Error('[auth] Domain release provenance snapshot invariant failed.');
      }

      const released = this.db.prepare(`
        UPDATE _auth_tenant_domain_claims
        SET status = 'lost', challenge_digest = NULL,
            challenge_expires_at = NULL, verification_digest = NULL,
            next_check_at = NULL, valid_until = NULL,
            lease_owner = NULL, lease_expires_at = NULL,
            revision = revision + 1, updated_at = ?,
            released_at = ?, released_by = ?, quarantine_until = ?
        WHERE tenant_id = ? AND claim_id = ? AND revision = ?
          AND released_at IS NULL
      `).run(
        releasedAt,
        releasedAt,
        authority.auth.userId,
        quarantineUntil,
        input.tenantId,
        claim.claim_id,
        claim.revision,
      );
      if (released.changes !== 1) throw claimRevisionConflict();

      this.auditService?.append({
        action: 'tenant.domain-claim-released',
        outcome: 'succeeded',
        scope: { kind: 'tenant', tenantId: input.tenantId },
        actor: authAuditActorFromContext(authority.auth),
        request: input.auditRequest,
        target: { type: 'tenant-domain-claim', id: claim.claim_id },
        metadata: {
          'quarantine-until': quarantineUntil,
          'invalidated-transaction-count': invalidatedTransactions,
          'cancelled-request-count': cancelledRequests,
        },
      });
      return Object.freeze({
        release: Object.freeze({
          claimId: claim.claim_id,
          domain: claim.domain,
          releasedAt,
          quarantineUntil,
        }),
      });
    });
    emitPlatformCode(OBS_CODES.AUTH_DOMAIN_CLAIM_RELEASED, {
      metadata: {
        claimId: result.release.claimId,
        tenantId: input.tenantId,
        quarantineUntil: result.release.quarantineUntil,
      },
    });
    return result;
  }

  /** Resolve a live identity to a secret-free durable email-job binding. */
  prepareMailboxRequest(input: {
    userId: string;
    identityKind: 'session' | 'continuation';
    identityContinuation?: AuthSessionContinuationRecord | null;
  }): DomainMailboxJobBinding | null {
    this.users.assertCurrentProfile();
    if (!this.config.enabled) return null;
    const user = this.users.getUserById(input.userId);
    if (!isEligibleUser(user)) return null;
    try {
      verifiedDomainFromEmail(user.email, this.config.sharedMailboxDomains);
    } catch (error) {
      if (error instanceof VerifiedDomainNameError) return null;
      throw error;
    }
    const continuation = input.identityContinuation ?? null;
    if (input.identityKind === 'continuation'
      && (!continuation || continuation.userId !== user.userId
        || continuation.applicationId !== this.applicationId
        || continuation.authGeneration !== this.users.getAuthGeneration(user.userId))) {
      return null;
    }
    return {
      userId: user.userId,
      email: canonicalizeEmail(user.email),
      emailGeneration: this.users.getEmailGeneration(user.userId),
      authGeneration: this.users.getAuthGeneration(user.userId),
      identityKind: input.identityKind,
      identityContinuationId: continuation?.continuationId ?? null,
    };
  }

  /** Create one digest-only mailbox token immediately before outbox delivery. */
  createMailboxDelivery(input: DomainMailboxJobBinding & { jobId: string }): {
    user: UserRecord;
    rawToken: string;
    expiresAt: number;
  } | null {
    this.users.assertCurrentProfile();
    if (!this.config.enabled) return null;
    const user = this.users.getUserById(input.userId);
    if (!isEligibleUser(user)
      || canonicalizeEmail(user.email) !== input.email
      || this.users.getEmailGeneration(user.userId) !== input.emailGeneration
      || this.users.getAuthGeneration(user.userId) !== input.authGeneration) return null;
    if (input.identityKind === 'continuation'
      && !this.isContinuationLive(input.identityContinuationId, input)) return null;
    const rawToken = `${MAILBOX_TOKEN_PREFIX}${createOpaqueToken(32)}`;
    const now = this.now();
    const expiresAt = now + this.config.mailboxLinkTTLms;
    const inserted = this.db.transaction(() => {
      this.users.assertCurrentProfile();
      const consumed = this.db.prepare(`SELECT 1
        FROM _auth_domain_mailbox_tokens
        WHERE outbox_job_id = ? AND consumed_at IS NOT NULL AND expires_at > ?
        LIMIT 1`).get(input.jobId, now);
      if (consumed) return false;
      this.db.prepare(`DELETE FROM _auth_domain_mailbox_tokens
        WHERE outbox_job_id = ? AND expires_at <= ?`).run(input.jobId, now);
      const live = this.db.prepare(`SELECT COUNT(*) AS count
        FROM _auth_domain_mailbox_tokens
        WHERE outbox_job_id = ? AND consumed_at IS NULL AND expires_at > ?`).get(
        input.jobId,
        now,
      ) as { count: number };
      if (live.count >= MAX_MAILBOX_TOKENS_PER_JOB) return false;
      this.db.prepare(`
        INSERT INTO _auth_domain_mailbox_tokens (
          token_id, application_id, user_id, email, email_generation,
          auth_generation, identity_kind, identity_continuation_id,
          token_hash, outbox_job_id, expires_at, consumed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
      `).run(
        `dmt_${crypto.randomUUID()}`,
        this.applicationId,
        user.userId,
        canonicalizeEmail(user.email),
        input.emailGeneration,
        input.authGeneration,
        input.identityKind,
        input.identityContinuationId,
        hashToken(rawToken),
        input.jobId,
        expiresAt,
        now,
      );
      return true;
    });
    if (!inserted) return null;
    return { user, rawToken, expiresAt };
  }

  discardMailboxDelivery(rawToken: string): boolean {
    this.users.assertCurrentProfile();
    return this.db.transaction(() => {
      this.users.assertCurrentProfile();
      return this.db.prepare(`DELETE FROM _auth_domain_mailbox_tokens
        WHERE token_hash = ? AND consumed_at IS NULL`).run(hashToken(rawToken)).changes === 1;
    });
  }

  /** Consume mailbox possession and reveal no tenant until that succeeds. */
  completeMailboxProof(rawToken: string): AuthDomainOnboardingCompletion {
    this.users.assertCurrentProfile();
    if (!this.config.enabled || !rawToken.startsWith(MAILBOX_TOKEN_PREFIX)) {
      return unavailable();
    }
    const now = this.now();
    return this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.reconcileClaimStatuses();
      const token = this.db.prepare(`SELECT * FROM _auth_domain_mailbox_tokens
        WHERE application_id = ? AND token_hash = ?`).get(
        this.applicationId,
        hashToken(rawToken),
      ) as MailboxTokenRow | null;
      if (!token || token.consumed_at !== null || token.expires_at <= now) {
        return unavailable();
      }
      if (this.db.prepare(`UPDATE _auth_domain_mailbox_tokens SET consumed_at = ?
        WHERE outbox_job_id = ? AND consumed_at IS NULL`).run(
        now,
        token.outbox_job_id,
      ).changes < 1) return unavailable();
      const user = this.users.getUserById(token.user_id);
      if (!isEligibleUser(user)
        || canonicalizeEmail(user.email) !== token.email
        || this.users.getEmailGeneration(user.userId) !== token.email_generation
        || this.users.getAuthGeneration(user.userId) !== token.auth_generation
        || (token.identity_kind === 'continuation'
          && !this.isContinuationLive(token.identity_continuation_id, {
            userId: token.user_id,
            authGeneration: token.auth_generation,
          }))) return unavailable();
      let domain: string;
      try {
        domain = verifiedDomainFromEmail(user.email, this.config.sharedMailboxDomains);
      } catch {
        return unavailable();
      }
      const proofId = this.users.recordEmailLinkMailboxProof({
        applicationId: this.applicationId,
        userId: user.userId,
        email: user.email,
        emailGeneration: token.email_generation,
        provedAt: now,
        expiresAt: now + this.config.mailboxProofMaxAgeMs,
      });
      if (!proofId) return unavailable();
      const eligible = this.resolveEligibleClaim(domain, user.userId, now);
      if (!eligible) return unavailable();
      const tenant = this.tenancy.getTenant(eligible.claim.tenant_id)!;
      const pending = this.getJoinRequest(tenant.tenantId, user.userId);
      if (pending?.status === 'pending') {
        return {
          option: {
            action: 'request-pending',
            tenant: { name: tenant.name, slug: tenant.slug },
            request: {
              joinRequestId: pending.join_request_id,
              status: 'pending',
              createdAt: pending.created_at,
            },
          },
        };
      }
      if (pending && !this.canRetryJoinRequest(pending, now)) return unavailable();
      const continuation = `${ADMISSION_TOKEN_PREFIX}${createOpaqueToken(32)}`;
      const expiresAt = Math.min(
        now + this.config.admissionTTLms,
        now + this.config.mailboxProofMaxAgeMs,
      );
      this.db.prepare(`
        INSERT INTO _auth_domain_onboarding_transactions (
          transaction_id, application_id, user_id, email, email_generation,
          auth_generation, identity_kind, identity_continuation_id,
          mailbox_proof_id, domain, claim_id, claim_revision, policy_revision,
          tenant_id, request_role_key, token_hash, expires_at, consumed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
      `).run(
        `dot_${crypto.randomUUID()}`,
        this.applicationId,
        user.userId,
        canonicalizeEmail(user.email),
        token.email_generation,
        token.auth_generation,
        token.identity_kind,
        token.identity_continuation_id,
        proofId,
        domain,
        eligible.claim.claim_id,
        eligible.claim.revision,
        eligible.policy.policy_revision,
        tenant.tenantId,
        eligible.policy.request_role_key,
        hashToken(continuation),
        expiresAt,
        now,
      );
      emitPlatformCode(OBS_CODES.AUTH_DOMAIN_MAILBOX_PROVED, {
        userId: user.userId,
        metadata: { claimId: eligible.claim.claim_id },
      });
      return {
        option: {
          action: 'request-to-join',
          tenant: { name: tenant.name, slug: tenant.slug },
        },
        continuation,
        expiresAt,
      };
    });
  }

  inspectAdmissionIdentity(raw: string): DomainAdmissionIdentityBinding | null {
    this.users.assertCurrentProfile();
    if (!raw.startsWith(ADMISSION_TOKEN_PREFIX)) return null;
    const row = this.getTransactionByHash.get(
      this.applicationId,
      hashToken(raw),
    ) as TransactionRow | null;
    if (!row || row.consumed_at !== null || row.expires_at <= this.now()) return null;
    return {
      userId: row.user_id,
      authGeneration: row.auth_generation,
      identityKind: row.identity_kind,
      identityContinuationId: row.identity_continuation_id,
    };
  }

  admit(input: {
    continuation: string;
    identity: DomainAdmissionIdentityBinding;
    consumeIdentity?: () => boolean;
  }): {
    request: {
      joinRequestId: string;
      status: 'pending';
      createdAt: number;
      tenant: { name: string; slug: string };
    };
  } {
    this.users.assertCurrentProfile();
    this.requireEnabled();
    const now = this.now();
    return this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.reconcileClaimStatuses();
      const transaction = this.getTransactionByHash.get(
        this.applicationId,
        hashToken(input.continuation),
      ) as TransactionRow | null;
      if (!transaction || transaction.consumed_at !== null
        || transaction.expires_at <= now
        || !sameIdentityBinding(transaction, input.identity)) {
        throw invalidAdmission();
      }
      const user = this.users.getUserById(transaction.user_id);
      if (!isEligibleUser(user)
        || canonicalizeEmail(user.email) !== transaction.email
        || this.users.getEmailGeneration(user.userId) !== transaction.email_generation
        || this.users.getAuthGeneration(user.userId) !== transaction.auth_generation) {
        throw invalidAdmission();
      }
      const proof = this.db.prepare(`SELECT * FROM _auth_mailbox_proofs
        WHERE proof_id = ? AND application_id = ? AND user_id = ?
          AND email = ? AND email_generation = ? AND source = 'email-link'
          AND revoked_at IS NULL AND expires_at > ? AND proved_at > ?`).get(
        transaction.mailbox_proof_id,
        this.applicationId,
        user.userId,
        transaction.email,
        transaction.email_generation,
        now,
        now - this.config.mailboxProofMaxAgeMs,
      );
      if (!proof) throw invalidAdmission();
      const claim = this.requireClaim(transaction.tenant_id, transaction.claim_id);
      const policy = this.getPolicy(transaction.claim_id);
      if (claim.domain !== transaction.domain
        || claim.revision !== transaction.claim_revision
        || !isClaimAdmissionEligible(claim, now, this.config.gracePeriodMs)
        || policy.policy_revision !== transaction.policy_revision
        || !policy.enabled
        || policy.request_role_key !== transaction.request_role_key
        || !this.config.allowedRequestRoles.includes(transaction.request_role_key)) {
        throw invalidAdmission();
      }
      this.requireConfiguredRole(transaction.request_role_key);
      const tenant = this.requireActiveTenant(transaction.tenant_id);
      if (this.hasPendingInvitation(tenant.tenantId, user.email, now)
        || this.tenancy.getMembership(tenant.tenantId, user.userId)
        || this.hasAdmissionBlock(tenant.tenantId, user.userId)) {
        throw domainAdmissionBlocked();
      }
      const existing = this.getJoinRequest(tenant.tenantId, user.userId);
      if (existing && existing.status !== 'pending'
        && !this.canRetryJoinRequest(existing, now)) throw domainAdmissionBlocked();
      if (input.consumeIdentity && !input.consumeIdentity()) throw invalidAdmission();
      if (this.db.prepare(`UPDATE _auth_domain_onboarding_transactions
        SET consumed_at = ? WHERE transaction_id = ? AND consumed_at IS NULL
          AND expires_at > ?`).run(
        now,
        transaction.transaction_id,
        now,
      ).changes !== 1) throw invalidAdmission();

      let request = existing;
      if (!request) {
        const joinRequestId = `tjoin_${crypto.randomUUID()}`;
        this.db.prepare(`
          INSERT INTO _auth_tenant_join_requests (
            join_request_id, tenant_id, user_id, email, status,
            request_revision, requested_at, created_at, updated_at,
            reviewed_at, reviewed_by, last_decision, approved_membership_id
          ) VALUES (?, ?, ?, ?, 'pending', 1, ?, ?, ?, NULL, NULL, NULL, NULL)
        `).run(
          joinRequestId,
          tenant.tenantId,
          user.userId,
          canonicalizeEmail(user.email),
          now,
          now,
          now,
        );
        request = this.getJoinRequest(tenant.tenantId, user.userId)!;
      } else if (request.status !== 'pending') {
        const changed = this.db.prepare(`
          UPDATE _auth_tenant_join_requests
          SET status = 'pending', request_revision = request_revision + 1,
              requested_at = ?, updated_at = ?, reviewed_at = NULL,
              reviewed_by = NULL, approved_membership_id = NULL
          WHERE join_request_id = ? AND tenant_id = ? AND user_id = ?
            AND status IN ('denied', 'cancelled')
            AND request_revision = ?
        `).run(
          now,
          now,
          request.join_request_id,
          tenant.tenantId,
          user.userId,
          request.request_revision,
        );
        if (changed.changes !== 1) throw domainAdmissionBlocked();
        request = this.getJoinRequest(tenant.tenantId, user.userId)!;
      } else {
        // A domain proof changes the server-owned approval policy. Advance the
        // revision even when a generic request won the race after proof issue,
        // so a reviewer can never decide against the stale policy projection.
        const changed = this.db.prepare(`
          UPDATE _auth_tenant_join_requests
          SET request_revision = request_revision + 1,
              requested_at = ?, updated_at = ?, reviewed_at = NULL,
              reviewed_by = NULL, approved_membership_id = NULL
          WHERE join_request_id = ? AND tenant_id = ? AND user_id = ?
            AND status = 'pending' AND request_revision = ?
        `).run(
          now,
          now,
          request.join_request_id,
          tenant.tenantId,
          user.userId,
          request.request_revision,
        );
        if (changed.changes !== 1) throw domainAdmissionBlocked();
        request = this.getJoinRequest(tenant.tenantId, user.userId)!;
      }
      this.db.prepare(`
        INSERT INTO _auth_domain_join_request_provenance (
          join_request_id, tenant_id, user_id, claim_id, domain,
          request_role_key, mailbox_proof_id, blocked_until, created_at, updated_at,
          source, request_revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'verified-domain', ?)
        ON CONFLICT(join_request_id) DO UPDATE SET
          claim_id = excluded.claim_id,
          domain = excluded.domain,
          request_role_key = excluded.request_role_key,
          mailbox_proof_id = excluded.mailbox_proof_id,
          blocked_until = NULL,
          updated_at = excluded.updated_at,
          source = excluded.source,
          request_revision = excluded.request_revision
      `).run(
        request.join_request_id,
        tenant.tenantId,
        user.userId,
        claim.claim_id,
        claim.domain,
        transaction.request_role_key,
        transaction.mailbox_proof_id,
        now,
        now,
        request.request_revision,
      );
      emitPlatformCode(OBS_CODES.AUTH_DOMAIN_JOIN_REQUESTED, {
        userId: user.userId,
        metadata: { claimId: claim.claim_id, tenantId: tenant.tenantId },
      });
      return {
        request: {
          joinRequestId: request.join_request_id,
          status: 'pending',
          createdAt: request.created_at,
          tenant: { name: tenant.name, slug: tenant.slug },
        },
      };
    });
  }

  async processDueReverification(limit = REVERIFY_BATCH): Promise<number> {
    this.users.assertCurrentProfile();
    this.cleanupExpiredEvidence();
    if (!this.config.enabled || this.stopped) return 0;
    if (this.running) return this.running;
    const run = this.processDueReverificationInner(limit).finally(() => {
      if (this.running === run) this.running = null;
    });
    this.running = run;
    return run;
  }

  /** Bounded deletion of short-lived PII/proof evidence; provenance is retained. */
  cleanupExpiredEvidence(limit = CLEANUP_BATCH): {
    mailboxTokens: number;
    transactions: number;
    mailboxProofs: number;
  } {
    this.users.assertCurrentProfile();
    const requested = Number.isSafeInteger(limit) ? limit : CLEANUP_BATCH;
    const bounded = Math.max(1, Math.min(requested, 1_000));
    const now = this.now();
    return this.db.transaction(() => {
      this.users.assertCurrentProfile();
      const transactions = this.db.prepare(`
        DELETE FROM _auth_domain_onboarding_transactions
        WHERE transaction_id IN (
          SELECT transaction_id FROM _auth_domain_onboarding_transactions
          WHERE expires_at <= ? OR consumed_at IS NOT NULL
          ORDER BY COALESCE(consumed_at, expires_at) ASC, transaction_id ASC
          LIMIT ?
        )
        RETURNING transaction_id
      `).all(now, bounded).length;
      const mailboxTokens = this.db.prepare(`
        DELETE FROM _auth_domain_mailbox_tokens
        WHERE token_id IN (
          SELECT token_id FROM _auth_domain_mailbox_tokens
          WHERE expires_at <= ? OR (
            consumed_at IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM _auth_email_outbox outbox
              WHERE outbox.job_id = _auth_domain_mailbox_tokens.outbox_job_id
                AND outbox.status IN ('pending', 'processing')
            )
          )
          ORDER BY COALESCE(consumed_at, expires_at) ASC, token_id ASC
          LIMIT ?
        )
        RETURNING token_id
      `).all(now, bounded).length;
      const mailboxProofs = this.db.prepare(`
        DELETE FROM _auth_mailbox_proofs
        WHERE proof_id IN (
          SELECT proof_id FROM _auth_mailbox_proofs
          WHERE expires_at <= ? OR revoked_at IS NOT NULL
          ORDER BY COALESCE(revoked_at, expires_at) ASC, proof_id ASC
          LIMIT ?
        )
        RETURNING proof_id
      `).all(now, bounded).length;
      return { mailboxTokens, transactions, mailboxProofs };
    });
  }

  private async processDueReverificationInner(limit: number): Promise<number> {
    this.reconcileClaimStatuses();
    let processed = 0;
    for (let index = 0; index < Math.max(0, Math.min(limit, 100)); index += 1) {
      const lease = this.acquireDueLease();
      if (!lease) break;
      let answers: readonly string[];
      try {
        answers = await this.resolveAnswers(lease.domain);
      } catch {
        this.releaseUnavailableLease({
          ...lease,
          scheduleRetry: true,
        });
        emitPlatformCode(OBS_CODES.AUTH_DOMAIN_DNS_UNAVAILABLE, {
          metadata: { claimId: lease.claimId, tenantId: lease.tenantId },
        });
        processed += 1;
        continue;
      }
      const matched = answers.some((answer) => digestMatches(lease.digest, answer));
      this.finalizeSystemLease(lease, matched);
      processed += 1;
    }
    return processed;
  }

  private runWorkerPass(): void {
    void this.processDueReverification().catch((error: unknown) => {
      if (error instanceof AuthError && error.code === 'AUTH_PROFILE_CHANGED') {
        this.stopped = true;
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
      }
      emitPlatformCode(OBS_CODES.AUTH_DOMAIN_WORKER_FAILED, {
        metadata: {
          error: error instanceof Error ? error.name : 'UnknownError',
        },
      });
    });
  }

  private acquireManualLease(input: {
    tenantId: string;
    claimId: string;
    expectedRevision: string;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
  }): { domain: string; digest: string; revision: number; leaseOwner: string } {
    const now = this.now();
    return this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.lockTenant(input.tenantId);
      this.requireAuthority(
        input.tenantId,
        input.assertCurrentAuthority,
        ['tenant.domains:verify'],
      );
      const claim = this.requireClaim(input.tenantId, input.claimId);
      this.assertClaimRevision(claim, input.expectedRevision);
      const digest = claim.challenge_digest ?? claim.verification_digest;
      if (!digest || (claim.challenge_digest && claim.challenge_expires_at! <= now)) {
        throw new AuthError(
          'DNS challenge is unavailable or expired',
          'AUTH_DOMAIN_CHALLENGE_EXPIRED',
          409,
        );
      }
      if (claim.last_checked_at !== null
        && now - claim.last_checked_at < this.config.dnsCheckCooldownMs) {
        throw rateLimited();
      }
      const leaseOwner = `vdl_${crypto.randomUUID()}`;
      const changed = this.db.prepare(`
        UPDATE _auth_tenant_domain_claims
        SET lease_owner = ?, lease_expires_at = ?
        WHERE tenant_id = ? AND claim_id = ? AND revision = ?
          AND released_at IS NULL
          AND (lease_owner IS NULL OR lease_expires_at <= ?)
      `).run(
        leaseOwner,
        now + this.config.dnsTimeoutMs + 5_000,
        input.tenantId,
        input.claimId,
        claim.revision,
        now,
      );
      if (changed.changes !== 1) throw rateLimited();
      return { domain: claim.domain, digest, revision: claim.revision, leaseOwner };
    });
  }

  private finalizeLease(input: {
    tenantId: string;
    claimId: string;
    leaseOwner: string;
    expectedRevision: number;
    matched: boolean;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): AuthTenantDomainClaimProjection {
    const now = this.now();
    this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.lockTenant(input.tenantId);
      const authority = this.requireAuthority(
        input.tenantId,
        input.assertCurrentAuthority,
        ['tenant.domains:verify'],
      );
      const claim = this.requireClaim(input.tenantId, input.claimId);
      if (claim.revision !== input.expectedRevision
        || claim.lease_owner !== input.leaseOwner) throw claimRevisionConflict();
      this.persistVerificationResult(claim, input.leaseOwner, input.matched, now);
      this.auditService?.append({
        action: 'tenant.domain-verification-completed',
        outcome: input.matched ? 'succeeded' : 'failed',
        ...(input.matched ? {} : { reason: 'proof-mismatch' }),
        scope: { kind: 'tenant', tenantId: input.tenantId },
        actor: authAuditActorFromContext(authority.auth),
        request: input.auditRequest,
        target: { type: 'tenant-domain-claim', id: input.claimId },
      });
    });
    return this.requireProjectedClaim(input.tenantId, input.claimId);
  }

  private acquireDueLease(): null | {
    tenantId: string;
    claimId: string;
    domain: string;
    digest: string;
    revision: number;
    leaseOwner: string;
  } {
    const now = this.now();
    return this.db.transaction(() => {
      this.users.assertCurrentProfile();
      const claim = this.db.prepare(`
        SELECT * FROM _auth_tenant_domain_claims claim
        WHERE claim.released_at IS NULL
          AND claim.status IN ('verified', 'grace', 'lost')
          AND claim.verification_digest IS NOT NULL
          AND claim.next_check_at IS NOT NULL AND claim.next_check_at <= ?
          AND (claim.lease_owner IS NULL OR claim.lease_expires_at <= ?)
          AND EXISTS (SELECT 1 FROM _auth_tenants tenant
            WHERE tenant.tenant_id = claim.tenant_id AND tenant.status = 'active')
        ORDER BY claim.next_check_at ASC, claim.claim_id ASC
        LIMIT 1
      `).get(now, now) as ClaimRow | null;
      if (!claim?.verification_digest) return null;
      const changed = this.db.prepare(`
        UPDATE _auth_tenant_domain_claims
        SET lease_owner = ?, lease_expires_at = ?
        WHERE claim_id = ? AND revision = ? AND released_at IS NULL
          AND (lease_owner IS NULL OR lease_expires_at <= ?)
      `).run(
        this.workerId,
        now + this.config.dnsTimeoutMs + 5_000,
        claim.claim_id,
        claim.revision,
        now,
      );
      if (changed.changes !== 1) return null;
      return {
        tenantId: claim.tenant_id,
        claimId: claim.claim_id,
        domain: claim.domain,
        digest: claim.verification_digest,
        revision: claim.revision,
        leaseOwner: this.workerId,
      };
    });
  }

  private finalizeSystemLease(
    lease: {
      tenantId: string;
      claimId: string;
      revision: number;
      leaseOwner: string;
    },
    matched: boolean,
  ): void {
    const now = this.now();
    this.db.transaction(() => {
      this.users.assertCurrentProfile();
      const claim = this.requireClaim(lease.tenantId, lease.claimId);
      if (claim.revision !== lease.revision || claim.lease_owner !== lease.leaseOwner) return;
      this.persistVerificationResult(claim, lease.leaseOwner, matched, now);
    });
    emitPlatformCode(
      matched ? OBS_CODES.AUTH_DOMAIN_REVERIFIED : OBS_CODES.AUTH_DOMAIN_REVERIFICATION_FAILED,
      { metadata: { claimId: lease.claimId, tenantId: lease.tenantId } },
    );
  }

  private releaseUnavailableLease(input: {
    tenantId: string;
    claimId: string;
    revision: number;
    leaseOwner: string;
    scheduleRetry: boolean;
  }): void {
    const now = this.now();
    this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.db.prepare(`
        UPDATE _auth_tenant_domain_claims
        SET lease_owner = NULL, lease_expires_at = NULL,
            next_check_at = CASE WHEN ? = 1 THEN ? ELSE next_check_at END
        WHERE tenant_id = ? AND claim_id = ? AND revision = ?
          AND lease_owner = ? AND released_at IS NULL
      `).run(
        input.scheduleRetry ? 1 : 0,
        now + this.config.reverifyRetryIntervalMs,
        input.tenantId,
        input.claimId,
        input.revision,
        input.leaseOwner,
      );
    });
  }

  private persistVerificationResult(
    claim: ClaimRow,
    leaseOwner: string,
    matched: boolean,
    now: number,
  ): void {
    if (matched) {
      const digest = claim.challenge_digest ?? claim.verification_digest;
      const changed = this.db.prepare(`
        UPDATE _auth_tenant_domain_claims
        SET status = 'verified', verification_digest = ?,
            challenge_digest = NULL, challenge_expires_at = NULL,
            verified_at = COALESCE(verified_at, ?), last_checked_at = ?,
            next_check_at = ?, valid_until = ?, revision = revision + 1,
            lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
        WHERE claim_id = ? AND revision = ? AND lease_owner = ?
          AND released_at IS NULL
      `).run(
        digest,
        now,
        now,
        now + this.config.reverifyIntervalMs,
        now + this.config.reverifyIntervalMs,
        now,
        claim.claim_id,
        claim.revision,
        leaseOwner,
      );
      if (changed.changes !== 1) throw claimRevisionConflict();
      return;
    }
    const status = failedClaimStatus(claim, now, this.config.gracePeriodMs);
    const changed = this.db.prepare(`
      UPDATE _auth_tenant_domain_claims
      SET status = ?, last_checked_at = ?, next_check_at = ?,
          revision = revision + 1, lease_owner = NULL, lease_expires_at = NULL,
          updated_at = ?
      WHERE claim_id = ? AND revision = ? AND lease_owner = ?
        AND released_at IS NULL
    `).run(
      status,
      now,
      now + this.config.reverifyRetryIntervalMs,
      now,
      claim.claim_id,
      claim.revision,
      leaseOwner,
    );
    if (changed.changes !== 1) throw claimRevisionConflict();
  }

  private resolveEligibleClaim(domain: string, userId: string, now: number): null | {
    claim: ClaimRow;
    policy: ClaimPolicyRow;
  } {
    const row = this.db.prepare(`
      SELECT claim.*, policy.enabled, policy.admission,
        policy.request_role_key, policy.revision AS policy_revision
      FROM _auth_tenant_domain_claims claim
      INNER JOIN _auth_tenant_domain_policies policy ON policy.claim_id = claim.claim_id
      INNER JOIN _auth_tenants tenant ON tenant.tenant_id = claim.tenant_id
      WHERE claim.domain = ? AND claim.released_at IS NULL
        AND tenant.status = 'active'
        AND policy.enabled = 1 AND policy.admission = 'request-to-join'
    `).get(domain) as (ClaimRow & ClaimPolicyRow) | null;
    if (!row || !row.request_role_key
      || !isClaimAdmissionEligible(row, now, this.config.gracePeriodMs)
      || !this.config.allowedRequestRoles.includes(row.request_role_key)
      || !this.isConfiguredRoleSafe(row.request_role_key)
      || this.tenancy.getMembership(row.tenant_id, userId)
      || this.hasAdmissionBlock(row.tenant_id, userId)
      || this.hasPendingInvitation(row.tenant_id, this.users.getUserById(userId)?.email ?? '', now)) {
      return null;
    }
    return { claim: row, policy: row };
  }

  private async resolveAnswers(domain: string): Promise<readonly string[]> {
    return resolveBoundedTxt(`${DNS_RECORD_PREFIX}.${domain}`, {
      resolveTxt: this.config.resolveTxt,
      timeoutMs: this.config.dnsTimeoutMs,
      maxAnswers: this.config.maxTxtAnswers,
      maxBytes: this.config.maxTxtBytes,
    });
  }

  private reconcileClaimStatuses(): void {
    const now = this.now();
    this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.db.prepare(`
        UPDATE _auth_tenant_domain_claims
        SET status = 'grace', revision = revision + 1, updated_at = ?
        WHERE released_at IS NULL AND status = 'verified'
          AND valid_until IS NOT NULL AND valid_until <= ?
      `).run(now, now);
      this.db.prepare(`
        UPDATE _auth_tenant_domain_claims
        SET status = 'lost', revision = revision + 1, updated_at = ?
        WHERE released_at IS NULL AND status = 'grace'
          AND valid_until IS NOT NULL AND valid_until + ? <= ?
      `).run(now, this.config.gracePeriodMs, now);
    });
  }

  private requireProjectedClaim(
    tenantId: string,
    claimId: string,
  ): AuthTenantDomainClaimProjection {
    this.reconcileClaimStatuses();
    const row = this.db.prepare(`
      SELECT claim.*, policy.enabled, policy.admission,
        policy.request_role_key, policy.revision AS policy_revision
      FROM _auth_tenant_domain_claims claim
      INNER JOIN _auth_tenant_domain_policies policy ON policy.claim_id = claim.claim_id
      WHERE claim.tenant_id = ? AND claim.claim_id = ?
        AND claim.released_at IS NULL
    `).get(tenantId, claimId) as (ClaimRow & ClaimPolicyRow) | null;
    if (!row) throw claimNotFound();
    return projectClaim(row);
  }

  private requireClaim(tenantId: string, claimId: string): ClaimRow {
    const row = this.getClaim.get(tenantId, claimId) as ClaimRow | null;
    if (!row) throw claimNotFound();
    return row;
  }

  private getPolicy(claimId: string): ClaimPolicyRow {
    const row = this.db.prepare(`SELECT enabled, admission, request_role_key,
      revision AS policy_revision FROM _auth_tenant_domain_policies
      WHERE claim_id = ?`).get(claimId) as ClaimPolicyRow | null;
    if (!row) throw claimNotFound();
    return row;
  }

  private getJoinRequest(tenantId: string, userId: string): JoinRequestRow | null {
    return this.db.prepare(`SELECT join_request_id, status, request_revision,
        created_at, reviewed_at
      FROM _auth_tenant_join_requests WHERE tenant_id = ? AND user_id = ?`).get(
      tenantId,
      userId,
    ) as JoinRequestRow | null;
  }

  private canRetryJoinRequest(request: JoinRequestRow, now: number): boolean {
    if (request.status === 'pending') return true;
    if (request.status === 'approved') return false;
    const provenance = this.db.prepare(`SELECT blocked_until, source, request_revision
      FROM _auth_domain_join_request_provenance WHERE join_request_id = ?`).get(
      request.join_request_id,
    ) as {
      blocked_until: number | null;
      source: 'verified-domain' | 'legacy-unbound';
      request_revision: number | null;
    } | null;
    const provenanceMayBeCurrent = provenance
      && (provenance.request_revision === null
        || provenance.request_revision === request.request_revision);
    const blockedUntil = (provenanceMayBeCurrent ? provenance.blocked_until : null)
      ?? ((request.reviewed_at ?? request.created_at) + this.config.deniedRetryCooldownMs);
    return blockedUntil <= now;
  }

  private hasPendingInvitation(tenantId: string, email: string, now: number): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM _auth_tenant_invitations
      WHERE tenant_id = ? AND email = ? COLLATE NOCASE AND status = 'pending'
        AND expires_at > ? LIMIT 1`).get(tenantId, canonicalizeEmail(email), now));
  }

  private hasAdmissionBlock(tenantId: string, userId: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM _auth_tenant_admission_blocks
      WHERE tenant_id = ? AND user_id = ? AND unblocked_at IS NULL LIMIT 1`).get(
      tenantId,
      userId,
    ));
  }

  private isContinuationLive(
    continuationId: string | null,
    expected: { userId: string; authGeneration: number },
  ): boolean {
    if (!continuationId) return false;
    return Boolean(this.db.prepare(`SELECT 1 FROM _auth_session_continuations
      WHERE continuation_id = ? AND application_id = ? AND user_id = ?
        AND purpose = 'tenant_onboarding' AND auth_generation = ?
        AND consumed_at IS NULL AND expires_at > ?`).get(
      continuationId,
      this.applicationId,
      expected.userId,
      expected.authGeneration,
      this.now(),
    ));
  }

  private requireAuthority(
    tenantId: string,
    assertion: AssertAuthTenantMutationAuthority,
    permissions: readonly import('./types').PermissionKey[],
  ) {
    const authority = assertion(permissions);
    if (authority.scope.tenantId !== tenantId) throw forbidden();
    this.requireActiveTenant(tenantId);
    return authority;
  }

  private lockTenant(tenantId: string): void {
    if (this.db.prepare(`UPDATE _auth_tenants SET updated_at = updated_at
      WHERE tenant_id = ? AND status = 'active'`).run(tenantId).changes !== 1) {
      throw forbidden();
    }
  }

  private requireActiveTenant(tenantId: string) {
    const tenant = this.tenancy.getTenant(tenantId);
    if (!tenant || tenant.status !== 'active') throw forbidden();
    return tenant;
  }

  private assertConfiguredRoles(): void {
    for (const key of this.config.allowedRequestRoles) this.requireConfiguredRole(key);
    this.requireConfiguredRole(this.config.defaultRequestRole);
  }

  private isConfiguredRoleSafe(key: string): boolean {
    const role = this.kernel.authorization.roles[key];
    return Boolean(role && !role.system && !role.allPermissions && key !== 'owner');
  }

  private requireConfiguredRole(key: string): string {
    if (!this.config.allowedRequestRoles.includes(key) || !this.isConfiguredRoleSafe(key)) {
      throw new AuthError(
        `Verified-domain request role is not a safe declared role: ${key}`,
        'AUTH_DOMAIN_ROLE_UNAVAILABLE',
        409,
      );
    }
    return key;
  }

  private canonicalizeDomain(domain: string): string {
    try {
      return canonicalizeVerifiedDomain(domain, this.config.sharedMailboxDomains);
    } catch (error) {
      if (error instanceof VerifiedDomainNameError) {
        throw new AuthError(
          'Domain is not eligible for verified-company onboarding',
          'AUTH_DOMAIN_INVALID',
          422,
        );
      }
      throw error;
    }
  }

  private assertClaimRevision(claim: ClaimRow, expected: string): void {
    if (claimRevision(claim.revision) !== expected) throw claimRevisionConflict();
  }

  private requireEnabled(): void {
    if (!this.config.enabled) {
      throw new AuthError(
        'Verified-domain onboarding is unavailable',
        'AUTH_DOMAIN_ONBOARDING_UNAVAILABLE',
        404,
      );
    }
  }
}

function projectClaim(row: ClaimRow & ClaimPolicyRow): AuthTenantDomainClaimProjection {
  return Object.freeze({
    claimId: row.claim_id,
    domain: row.domain,
    status: row.status,
    proofMethod: 'dns-txt' as const,
    verifiedAt: row.verified_at,
    lastCheckedAt: row.last_checked_at,
    nextCheckAt: row.next_check_at,
    validUntil: row.valid_until,
    challengeExpiresAt: row.challenge_expires_at,
    policy: Object.freeze({
      enabled: Boolean(row.enabled),
      admission: 'request-to-join' as const,
      requestRoleKey: row.request_role_key,
      revision: policyRevision(row.policy_revision),
    }),
    revision: claimRevision(row.revision),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function createDnsChallenge(domain: string, ttlMs: number, now: number) {
  const value = `${DNS_VALUE_PREFIX}${createOpaqueToken(32)}`;
  const expiresAt = now + ttlMs;
  return {
    digest: hashToken(value),
    expiresAt,
    public: Object.freeze({
      recordType: 'TXT' as const,
      name: `${DNS_RECORD_PREFIX}.${domain}`,
      value,
      expiresAt,
    }),
  };
}

function digestMatches(expected: string, answer: string): boolean {
  const actual = hashToken(answer.trim());
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(actual, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

function failedClaimStatus(
  claim: ClaimRow,
  now: number,
  gracePeriodMs: number,
): AuthTenantDomainClaimStatus {
  if (!claim.verified_at || !claim.valid_until) return 'pending';
  return now < claim.valid_until
    ? 'verified'
    : now < claim.valid_until + gracePeriodMs ? 'grace' : 'lost';
}

function isClaimAdmissionEligible(
  claim: ClaimRow,
  now: number,
  gracePeriodMs: number,
): boolean {
  if (claim.released_at !== null) return false;
  if (!claim.verification_digest || !claim.valid_until) return false;
  if (claim.status === 'verified') return now < claim.valid_until;
  return claim.status === 'grace' && now < claim.valid_until + gracePeriodMs;
}

function sameIdentityBinding(
  row: TransactionRow,
  identity: DomainAdmissionIdentityBinding,
): boolean {
  return row.user_id === identity.userId
    && row.auth_generation === identity.authGeneration
    && row.identity_kind === identity.identityKind
    && row.identity_continuation_id === identity.identityContinuationId;
}

function isEligibleUser(user: UserRecord | null): user is UserRecord {
  return Boolean(user && user.status === 'active' && !user.passwordChangeRequired
    && (!user.emailVerificationRequired || user.emailVerifiedAt !== null));
}

function claimRevision(revision: number): string {
  return `${CLAIM_REVISION_PREFIX}${revision.toString(36)}`;
}

function policyRevision(revision: number): string {
  return `${POLICY_REVISION_PREFIX}${revision.toString(36)}`;
}

function unavailable(): AuthDomainOnboardingCompletion {
  return Object.freeze({ option: Object.freeze({ action: 'unavailable' as const }) });
}

function claimNotFound(): AuthError {
  return new AuthError('Domain claim not found', 'AUTH_DOMAIN_CLAIM_NOT_FOUND', 404);
}

function domainUnavailable(): AuthError {
  return new AuthError('Domain is unavailable', 'AUTH_DOMAIN_UNAVAILABLE', 409);
}

function claimRevisionConflict(): AuthError {
  return new AuthError(
    'Domain claim changed; reload before retrying',
    'AUTH_DOMAIN_CLAIM_REVISION_CONFLICT',
    409,
  );
}

function policyRevisionConflict(): AuthError {
  return new AuthError(
    'Domain policy changed; reload before retrying',
    'AUTH_DOMAIN_POLICY_REVISION_CONFLICT',
    409,
  );
}

function releaseConfirmationMismatch(): AuthError {
  return new AuthError(
    'Type the exact domain to confirm release',
    'AUTH_DOMAIN_RELEASE_CONFIRMATION_MISMATCH',
    422,
  );
}

function dnsUnavailable(): AuthError {
  return new AuthError(
    'DNS TXT verification is temporarily unavailable',
    'AUTH_DOMAIN_DNS_UNAVAILABLE',
    503,
  );
}

function invalidAdmission(): AuthError {
  return new AuthError(
    'Domain onboarding proof is invalid or expired',
    'AUTH_DOMAIN_ONBOARDING_PROOF_INVALID',
    400,
  );
}

function domainAdmissionBlocked(): AuthError {
  return new AuthError(
    'Domain onboarding is unavailable for this identity',
    'AUTH_DOMAIN_ADMISSION_BLOCKED',
    409,
  );
}

function rateLimited(): AuthError {
  return new AuthError(
    'Domain verification was checked recently; retry later',
    'AUTH_DOMAIN_VERIFY_RATE_LIMITED',
    429,
  );
}

function forbidden(): AuthError {
  return new AuthError('Forbidden', 'FORBIDDEN', 403);
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/.test(error.message);
}
