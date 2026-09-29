/** Transport-neutral exact verified-domain request-onboarding control plane. */

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
import {
  canonicalizeVerifiedDomain,
  VerifiedDomainNameError,
} from './verified-domain-name';
import {
  VERIFIED_DOMAIN_DNS_RECORD_PREFIX,
  VERIFIED_DOMAIN_REVERIFY_BATCH,
  VerifiedDomainDnsCoordinator,
} from './verified-domain-dns-coordinator';
import {
  defineVerifiedDomainReleaseTables,
  defineVerifiedDomainTables,
} from './verified-domain-schema';
import {
  authAuditActorFromContext,
  captureAuthAuditRequestContext,
  type AuthAuditService,
} from './auth-audit-service';
import type { AuthAuditRequestContext } from './auth-audit-types';
import { isAdministrationOnlyRole } from './authorization-registry';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { cleanupVerifiedDomainEvidence } from './verified-domain-evidence-cleanup';
import { VerifiedDomainAdmissionService } from './verified-domain-admission-service';
import type {
  AuthDomainOnboardingCompletion,
  AuthTenantDomainChallengeResult,
  AuthTenantDomainClaimProjection,
  AuthTenantDomainClaimStatus,
  AuthTenantDomainReleaseResult,
  DomainAdmissionIdentityBinding,
  DomainMailboxJobBinding,
} from './verified-domain-contracts';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';

export type {
  AuthDomainOnboardingCompletion,
  AuthTenantDomainChallengeResult,
  AuthTenantDomainClaimProjection,
  AuthTenantDomainClaimStatus,
  AuthTenantDomainReleaseResult,
  DomainAdmissionIdentityBinding,
  DomainMailboxJobBinding,
} from './verified-domain-contracts';

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

const CLAIM_REVISION_PREFIX = 'vdc_';
const POLICY_REVISION_PREFIX = 'vdp_';
const DNS_VALUE_PREFIX = 'zero-domain-verification=';
const CLEANUP_BATCH = 100;
export const VERIFIED_DOMAIN_RELEASE_QUARANTINE_MS = 7 * 86_400_000;

export class VerifiedDomainOnboardingService {
  readonly config: ResolvedAuthTenantOnboardingConfig['verifiedDomains'];
  readonly applicationId: string;
  private readonly getClaim: Statement;
  private readonly getClaimByDomain: Statement;
  private readonly dns: VerifiedDomainDnsCoordinator;
  private readonly admission: VerifiedDomainAdmissionService;

  constructor(
    private readonly db: ReactiveDB,
    config: ResolvedAuthTenantOnboardingConfig['verifiedDomains'],
    private readonly kernel: AuthorizationKernel,
    private readonly users: UserStore,
    private readonly tenancy: TenancyService,
    applicationId: string,
    private readonly now: () => number = Date.now,
    private readonly auditService?: AuthAuditService,
    private readonly emitCode: AuthPlatformCodeEmitter = emitPlatformCode,
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
    this.dns = new VerifiedDomainDnsCoordinator({
      db,
      config,
      users,
      now,
      auditService,
      emitCode,
      cleanupExpiredEvidence: () => this.cleanupExpiredEvidence(),
      reconcileClaimStatuses: (tenantId) => this.reconcileClaimStatuses(tenantId),
      requireClaim: (tenantId, claimId) => this.requireClaim(tenantId, claimId),
      requireProjectedClaim: (tenantId, claimId) => (
        this.requireProjectedClaim(tenantId, claimId)
      ),
      lockTenant: (tenantId) => this.lockTenant(tenantId),
      requireAuthority: (tenantId, assertion) => (
        this.requireAuthority(tenantId, assertion, ['tenant.domains:verify'])
      ),
    });
    this.admission = new VerifiedDomainAdmissionService({
      db,
      config,
      users,
      tenancy,
      applicationId,
      now,
      emitCode,
      reconcileClaimStatuses: (tenantId) => this.reconcileClaimStatuses(tenantId),
      requireClaim: (tenantId, claimId) => this.requireClaim(tenantId, claimId),
      getPolicy: (claimId) => this.getPolicy(claimId),
      requireConfiguredRole: (key) => this.requireConfiguredRole(key),
      isConfiguredRoleSafe: (key) => this.isConfiguredRoleSafe(key),
      requireActiveTenant: (tenantId) => this.requireActiveTenant(tenantId),
    });
  }

  start(): void {
    this.dns.start();
  }

  async stop(): Promise<void> {
    await this.dns.stop();
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

  listClaims(
    tenantId: string,
    assertCurrentAuthority?: AssertAuthTenantMutationAuthority,
  ): readonly AuthTenantDomainClaimProjection[] {
    this.users.assertCurrentProfile();
    this.requireEnabled();
    this.requireActiveTenant(tenantId);
    this.reconcileClaimStatuses(tenantId);
    const rows = this.db.prepare(`
      SELECT claim.*, policy.enabled, policy.admission,
        policy.request_role_key, policy.revision AS policy_revision
      FROM _auth_tenant_domain_claims claim
      INNER JOIN _auth_tenant_domain_policies policy ON policy.claim_id = claim.claim_id
      WHERE claim.tenant_id = ? AND claim.released_at IS NULL
      ORDER BY claim.created_at ASC, claim.claim_id ASC
    `).all(tenantId) as Array<ClaimRow & ClaimPolicyRow>;
    const claims = Object.freeze(rows.map(projectClaim));
    if (assertCurrentAuthority) {
      this.invokeAuthority(assertCurrentAuthority, ['tenant.domains:read']);
    }
    return claims;
  }

  createClaim(input: {
    tenantId: string;
    domain: string;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): AuthTenantDomainChallengeResult {
    this.users.assertCurrentProfile();
    this.requireEnabled();
    const tenantId = input.tenantId;
    const assertCurrentAuthority = input.assertCurrentAuthority;
    const auditRequest = captureAuthAuditRequestContext(input.auditRequest);
    const domain = this.canonicalizeDomain(input.domain);
    const challenge = createDnsChallenge(domain, this.config.challengeTTLms, this.now());
    const claimId = `vdc_${crypto.randomUUID()}`;
    const now = this.now();
    try {
      this.db.transaction(() => {
        this.users.assertCurrentProfile();
        this.lockTenant(tenantId);
        const authority = this.requireAuthority(
          tenantId,
          assertCurrentAuthority,
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
        if (quarantine && quarantine.tenant_id !== tenantId
          && quarantine.quarantine_until > now) {
          throw domainUnavailable();
        }
        const retained = this.db.prepare(`SELECT COUNT(*) AS count
          FROM _auth_tenant_domain_claims
          WHERE tenant_id = ? AND released_at IS NULL`).get(
          tenantId,
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
          tenantId,
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
          scope: { kind: 'tenant', tenantId },
          actor: authAuditActorFromContext(authority.auth),
          request: auditRequest,
          target: { type: 'tenant-domain-claim', id: claimId },
        });
        const code = OBS_CODES.AUTH_DOMAIN_CLAIM_CREATED;
        this.db.afterCommit(() => this.emitCode(code, {
          userId: undefined,
          metadata: { claimId, tenantId },
        }));
      });
    } catch (error) {
      if (isUniqueConstraint(error)) throw domainUnavailable();
      throw error;
    }
    return {
      claim: this.requireProjectedClaim(tenantId, claimId),
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
    const tenantId = input.tenantId;
    const claimId = input.claimId;
    const expectedRevision = input.expectedRevision;
    const assertCurrentAuthority = input.assertCurrentAuthority;
    const auditRequest = captureAuthAuditRequestContext(input.auditRequest);
    const challenge = this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.lockTenant(tenantId);
      const authority = this.requireAuthority(
        tenantId,
        assertCurrentAuthority,
        ['tenant.domains:verify'],
      );
      const claim = this.requireClaim(tenantId, claimId);
      this.assertClaimRevision(claim, expectedRevision);
      const now = this.now();
      if (claim.challenge_expires_at
        && now - claim.updated_at < this.config.dnsCheckCooldownMs) {
        throw rateLimited();
      }
      const generated = createDnsChallenge(
        claim.domain,
        this.config.challengeTTLms,
        now,
      );
      const changed = this.db.prepare(`
        UPDATE _auth_tenant_domain_claims
        SET challenge_digest = ?, challenge_expires_at = ?, revision = revision + 1,
            updated_at = ?
        WHERE tenant_id = ? AND claim_id = ? AND revision = ?
          AND released_at IS NULL
      `).run(
        generated.digest,
        generated.expiresAt,
        now,
        tenantId,
        claimId,
        claim.revision,
      );
      if (changed.changes !== 1) throw claimRevisionConflict();
      this.auditService?.append({
        action: 'tenant.domain-challenge-issued',
        outcome: 'succeeded',
        scope: { kind: 'tenant', tenantId },
        actor: authAuditActorFromContext(authority.auth),
        request: auditRequest,
        target: { type: 'tenant-domain-claim', id: claimId },
      });
      const code = OBS_CODES.AUTH_DOMAIN_CHALLENGE_ISSUED;
      this.db.afterCommit(() => this.emitCode(code, {
        metadata: { claimId, tenantId },
      }));
      return generated.public;
    });
    return {
      claim: this.requireProjectedClaim(tenantId, claimId),
      challenge,
    };
  }

  async verifyClaim(input: {
    tenantId: string;
    claimId: string;
    expectedRevision: string;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): Promise<AuthTenantDomainClaimProjection> {
    return this.dns.verifyClaim(input);
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
    const enabled: unknown = input.enabled;
    const requestRoleKey: unknown = input.requestRoleKey;
    if (typeof enabled !== 'boolean'
      || (requestRoleKey !== null && typeof requestRoleKey !== 'string')) {
      throw domainPolicyInvalid();
    }
    const tenantId = input.tenantId;
    const claimId = input.claimId;
    const expectedRevision = input.expectedRevision;
    const assertCurrentAuthority = input.assertCurrentAuthority;
    const auditRequest = captureAuthAuditRequestContext(input.auditRequest);
    const role = requestRoleKey === null
      ? null
      : this.requireConfiguredRole(requestRoleKey);
    if (enabled && !role) {
      throw new AuthError(
        'An enabled domain policy requires a configured request role',
        'AUTH_DOMAIN_POLICY_INVALID',
        422,
      );
    }
    const now = this.now();
    this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.lockTenant(tenantId);
      const authority = this.requireAuthority(
        tenantId,
        assertCurrentAuthority,
        ['tenant.onboarding:manage'],
      );
      this.requireClaim(tenantId, claimId);
      const policy = this.getPolicy(claimId);
      if (policyRevision(policy.policy_revision) !== expectedRevision) {
        throw policyRevisionConflict();
      }
      const changed = this.db.prepare(`
        UPDATE _auth_tenant_domain_policies
        SET enabled = ?, request_role_key = ?, revision = revision + 1,
            updated_by = ?, updated_at = ?
        WHERE claim_id = ? AND revision = ?
      `).run(
        enabled ? 1 : 0,
        role,
        authority.auth.userId,
        now,
        claimId,
        policy.policy_revision,
      );
      if (changed.changes !== 1) throw policyRevisionConflict();
      this.auditService?.append({
        action: 'tenant.domain-policy-updated',
        outcome: 'succeeded',
        scope: { kind: 'tenant', tenantId },
        actor: authAuditActorFromContext(authority.auth),
        request: auditRequest,
        target: { type: 'tenant-domain-claim', id: claimId },
        metadata: { enabled },
      });
      const code = OBS_CODES.AUTH_DOMAIN_POLICY_UPDATED;
      this.db.afterCommit(() => this.emitCode(code, {
        metadata: { claimId, tenantId },
      }));
    });
    return this.requireProjectedClaim(tenantId, claimId);
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
    const tenantId = input.tenantId;
    const claimId = input.claimId;
    const expectedRevision = input.expectedRevision;
    const expectedPolicyRevision = input.expectedPolicyRevision;
    const confirmDomain = input.confirmDomain;
    const assertCurrentAuthority = input.assertCurrentAuthority;
    const auditRequest = captureAuthAuditRequestContext(input.auditRequest);
    const result = this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.lockTenant(tenantId);
      const authority = this.requireAuthority(
        tenantId,
        assertCurrentAuthority,
        ['tenant.domains:release'],
      );
      const claim = this.requireClaim(tenantId, claimId);
      this.assertClaimRevision(claim, expectedRevision);
      const policy = this.getPolicy(claimId);
      if (policyRevision(policy.policy_revision) !== expectedPolicyRevision) {
        throw policyRevisionConflict();
      }
      if (confirmDomain !== claim.domain) throw releaseConfirmationMismatch();

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
        throw this.stateInvariant(
          'release-provenance-snapshot-count',
          '[auth] Domain release provenance snapshot invariant failed.',
        );
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
        tenantId,
        claim.claim_id,
        claim.revision,
      );
      if (released.changes !== 1) throw claimRevisionConflict();

      this.auditService?.append({
        action: 'tenant.domain-claim-released',
        outcome: 'succeeded',
        scope: { kind: 'tenant', tenantId },
        actor: authAuditActorFromContext(authority.auth),
        request: auditRequest,
        target: { type: 'tenant-domain-claim', id: claim.claim_id },
        metadata: {
          'quarantine-until': quarantineUntil,
          'invalidated-transaction-count': invalidatedTransactions,
          'cancelled-request-count': cancelledRequests,
        },
      });
      const code = OBS_CODES.AUTH_DOMAIN_CLAIM_RELEASED;
      const releasedClaimId = claim.claim_id;
      this.db.afterCommit(() => this.emitCode(code, {
        metadata: {
          claimId: releasedClaimId,
          tenantId,
          quarantineUntil,
        },
      }));
      return Object.freeze({
        release: Object.freeze({
          claimId: claim.claim_id,
          domain: claim.domain,
          releasedAt,
          quarantineUntil,
        }),
      });
    });
    return result;
  }

  /** Resolve a live identity to a secret-free durable email-job binding. */
  prepareMailboxRequest(input: {
    userId: string;
    expectedAuthGeneration: number;
    identityKind: 'session' | 'continuation';
    identityContinuation?: AuthSessionContinuationRecord | null;
  }): DomainMailboxJobBinding | null {
    return this.admission.prepareMailboxRequest(input);
  }

  /** Create one digest-only mailbox token immediately before outbox delivery. */
  createMailboxDelivery(input: DomainMailboxJobBinding & { jobId: string }): {
    user: UserRecord;
    rawToken: string;
    expiresAt: number;
  } | null {
    return this.admission.createMailboxDelivery(input);
  }

  discardMailboxDelivery(rawToken: string): boolean {
    return this.admission.discardMailboxDelivery(rawToken);
  }

  /** Consume mailbox possession and reveal no tenant until that succeeds. */
  completeMailboxProof(rawToken: string): AuthDomainOnboardingCompletion {
    return this.admission.completeMailboxProof(rawToken);
  }

  inspectAdmissionIdentity(raw: string): DomainAdmissionIdentityBinding | null {
    return this.admission.inspectAdmissionIdentity(raw);
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
    return this.admission.admit(input);
  }
  async processDueReverification(limit = VERIFIED_DOMAIN_REVERIFY_BATCH): Promise<number> {
    return this.dns.processDueReverification(limit);
  }

  /** Bounded deletion of short-lived PII/proof evidence; provenance is retained. */
  cleanupExpiredEvidence(limit = CLEANUP_BATCH): {
    mailboxTokens: number;
    transactions: number;
    mailboxProofs: number;
  } {
    this.users.assertCurrentProfile();
    return cleanupVerifiedDomainEvidence({
      db: this.db,
      now: this.now(),
      limit,
      assertCurrentProfile: () => this.users.assertCurrentProfile(),
    });
  }

  private reconcileClaimStatuses(tenantId?: string): void {
    const now = this.now();
    this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.db.prepare(`
        UPDATE _auth_tenant_domain_claims
        SET status = 'grace', revision = revision + 1, updated_at = ?
        WHERE claim_id IN (
          SELECT claim_id FROM _auth_tenant_domain_claims
          WHERE released_at IS NULL AND status = 'verified'
            AND valid_until IS NOT NULL AND valid_until <= ?
            AND (? IS NULL OR tenant_id = ?)
          ORDER BY valid_until ASC, claim_id ASC
          LIMIT ?
        )
      `).run(now, now, tenantId ?? null, tenantId ?? null, CLEANUP_BATCH);
      this.db.prepare(`
        UPDATE _auth_tenant_domain_claims
        SET status = 'lost', revision = revision + 1, updated_at = ?
        WHERE claim_id IN (
          SELECT claim_id FROM _auth_tenant_domain_claims
          WHERE released_at IS NULL AND status = 'grace'
            AND valid_until IS NOT NULL AND valid_until + ? <= ?
            AND (? IS NULL OR tenant_id = ?)
          ORDER BY valid_until ASC, claim_id ASC
          LIMIT ?
        )
      `).run(
        now,
        this.config.gracePeriodMs,
        now,
        tenantId ?? null,
        tenantId ?? null,
        CLEANUP_BATCH,
      );
    });
  }

  private requireProjectedClaim(
    tenantId: string,
    claimId: string,
  ): AuthTenantDomainClaimProjection {
    this.reconcileClaimStatuses(tenantId);
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

  private requireAuthority(
    tenantId: string,
    assertion: AssertAuthTenantMutationAuthority,
    permissions: readonly import('./types').PermissionKey[],
  ) {
    const authority = this.invokeAuthority(assertion, permissions);
    if (authority.scope.tenantId !== tenantId) throw forbidden();
    this.requireActiveTenant(tenantId);
    return authority;
  }

  private invokeAuthority(
    assertion: AssertAuthTenantMutationAuthority,
    permissions: readonly import('./types').PermissionKey[],
  ) {
    return invokeSynchronousAuthCallback(
      () => assertion(permissions),
      {
        component: 'verified-domain-onboarding-service',
        invariant: 'authority-callback-async',
        message: '[auth] Verified-domain authority callback must be synchronous.',
        emitCode: this.emitCode,
      },
    );
  }

  private stateInvariant(invariant: string, message: string): AuthError {
    const error = new AuthError(message, 'AUTH_STATE_INVARIANT_FAILED', 500);
    this.emitCode(OBS_CODES.AUTH_STATE_INVARIANT_FAILED, {
      error,
      metadata: {
        component: 'verified-domain-onboarding-service',
        invariant,
      },
    });
    return error;
  }

  private lockTenant(tenantId: string): void {
    if (this.db.prepare(`UPDATE _auth_tenants SET updated_at = updated_at
      WHERE tenant_id = ? AND status = 'active'`).run(tenantId).changes !== 1) {
      throw forbidden();
    }
  }

  private requireActiveTenant(tenantId: string) {
    const tenant = this.tenancy.getTenant(tenantId);
    if (!tenant || tenant.status !== 'active' || tenant.kind !== 'organization') {
      throw forbidden();
    }
    return tenant;
  }

  private assertConfiguredRoles(): void {
    for (const key of this.config.allowedRequestRoles) this.requireConfiguredRole(key);
    this.requireConfiguredRole(this.config.defaultRequestRole);
  }

  private isConfiguredRoleSafe(key: string): boolean {
    const role = this.kernel.authorization.roles[key];
    return Boolean(role
      && !role.system
      && !role.allPermissions
      && key !== 'owner'
      && !isAdministrationOnlyRole(this.kernel.authorization, key));
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
      name: `${VERIFIED_DOMAIN_DNS_RECORD_PREFIX}.${domain}`,
      value,
      expiresAt,
    }),
  };
}

function claimRevision(revision: number): string {
  return `${CLAIM_REVISION_PREFIX}${revision.toString(36)}`;
}

function policyRevision(revision: number): string {
  return `${POLICY_REVISION_PREFIX}${revision.toString(36)}`;
}

function domainPolicyInvalid(): AuthError {
  return new AuthError(
    'Verified-domain policy input is invalid',
    'AUTH_DOMAIN_POLICY_INVALID',
    422,
  );
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
