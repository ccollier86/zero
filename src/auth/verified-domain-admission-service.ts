/** Mailbox-proof and join-request admission transactions for verified domains. */

import type { Statement } from 'bun:sqlite';
import { OBS_CODES } from '../observability/codes';
import type { ReactiveDB } from '../sync/reactive-db';
import { createOpaqueToken, hashToken } from '../tokens/token-utils';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';
import type { AuthSessionContinuationRecord } from './auth-session-continuation-store';
import type { ResolvedAuthTenantOnboardingConfig } from './auth-tenant-onboarding-types';
import { canonicalizeEmail } from './auth-email-identity';
import type { TenancyService } from './tenancy/tenancy-service';
import { AuthError, type UserRecord } from './types';
import type { UserStore } from './user-store';
import {
  verifiedDomainFromEmail,
  VerifiedDomainNameError,
} from './verified-domain-name';
import type {
  AuthDomainOnboardingCompletion,
  DomainAdmissionIdentityBinding,
  DomainMailboxJobBinding,
} from './verified-domain-contracts';

const MAILBOX_TOKEN_PREFIX = 'zdmp_';
const ADMISSION_TOKEN_PREFIX = 'zdoa_';
const MAX_MAILBOX_TOKENS_PER_JOB = 16;

interface AdmissionClaimRow {
  claim_id: string;
  tenant_id: string;
  domain: string;
  status: 'pending' | 'verified' | 'grace' | 'lost';
  verification_digest: string | null;
  valid_until: number | null;
  revision: number;
  released_at: number | null;
}

interface AdmissionPolicyRow {
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

interface ActiveTenant {
  tenantId: string;
  name: string;
  slug: string;
}

interface VerifiedDomainAdmissionDependencies {
  db: ReactiveDB;
  config: ResolvedAuthTenantOnboardingConfig['verifiedDomains'];
  users: UserStore;
  tenancy: TenancyService;
  applicationId: string;
  now: () => number;
  emitCode: AuthPlatformCodeEmitter;
  reconcileClaimStatuses: (tenantId?: string) => void;
  requireClaim: (tenantId: string, claimId: string) => AdmissionClaimRow;
  getPolicy: (claimId: string) => AdmissionPolicyRow;
  requireConfiguredRole: (key: string) => string;
  isConfiguredRoleSafe: (key: string) => boolean;
  requireActiveTenant: (tenantId: string) => ActiveTenant;
}

/**
 * Owns possession proofs and the atomic conversion of a proof into a tenant
 * join request. It deliberately reveals no tenant before mailbox possession.
 */
export class VerifiedDomainAdmissionService {
  private readonly getTransactionByHash: Statement;

  constructor(private readonly dependencies: VerifiedDomainAdmissionDependencies) {
    this.getTransactionByHash = dependencies.db.prepare(`
      SELECT * FROM _auth_domain_onboarding_transactions
      WHERE application_id = ? AND token_hash = ?
    `);
  }

  /** Resolve a live identity to a secret-free durable email-job binding. */
  prepareMailboxRequest(input: {
    userId: string;
    identityKind: 'session' | 'continuation';
    identityContinuation?: AuthSessionContinuationRecord | null;
  }): DomainMailboxJobBinding | null {
    const { applicationId, config, users } = this.dependencies;
    users.assertCurrentProfile();
    if (!config.enabled) return null;
    const user = users.getUserById(input.userId);
    if (!isEligibleUser(user)) return null;
    try {
      verifiedDomainFromEmail(user.email, config.sharedMailboxDomains);
    } catch (error) {
      if (error instanceof VerifiedDomainNameError) return null;
      throw error;
    }
    const continuation = input.identityContinuation ?? null;
    if (input.identityKind === 'continuation'
      && (!continuation || continuation.userId !== user.userId
        || continuation.applicationId !== applicationId
        || continuation.authGeneration !== users.getAuthGeneration(user.userId))) {
      return null;
    }
    return {
      userId: user.userId,
      email: canonicalizeEmail(user.email),
      emailGeneration: users.getEmailGeneration(user.userId),
      authGeneration: users.getAuthGeneration(user.userId),
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
    const { applicationId, config, db, users } = this.dependencies;
    users.assertCurrentProfile();
    if (!config.enabled) return null;
    const user = users.getUserById(input.userId);
    if (!isEligibleUser(user)
      || canonicalizeEmail(user.email) !== input.email
      || users.getEmailGeneration(user.userId) !== input.emailGeneration
      || users.getAuthGeneration(user.userId) !== input.authGeneration) return null;
    if (input.identityKind === 'continuation'
      && !this.isContinuationLive(input.identityContinuationId, input)) return null;
    const rawToken = `${MAILBOX_TOKEN_PREFIX}${createOpaqueToken(32)}`;
    const now = this.dependencies.now();
    const expiresAt = now + config.mailboxLinkTTLms;
    const inserted = db.transaction(() => {
      users.assertCurrentProfile();
      const consumed = db.prepare(`SELECT 1
        FROM _auth_domain_mailbox_tokens
        WHERE outbox_job_id = ? AND consumed_at IS NOT NULL AND expires_at > ?
        LIMIT 1`).get(input.jobId, now);
      if (consumed) return false;
      db.prepare(`DELETE FROM _auth_domain_mailbox_tokens
        WHERE outbox_job_id = ? AND expires_at <= ?`).run(input.jobId, now);
      const live = db.prepare(`SELECT COUNT(*) AS count
        FROM _auth_domain_mailbox_tokens
        WHERE outbox_job_id = ? AND consumed_at IS NULL AND expires_at > ?`).get(
        input.jobId,
        now,
      ) as { count: number };
      if (live.count >= MAX_MAILBOX_TOKENS_PER_JOB) return false;
      db.prepare(`
        INSERT INTO _auth_domain_mailbox_tokens (
          token_id, application_id, user_id, email, email_generation,
          auth_generation, identity_kind, identity_continuation_id,
          token_hash, outbox_job_id, expires_at, consumed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
      `).run(
        `dmt_${crypto.randomUUID()}`,
        applicationId,
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
    const { db, users } = this.dependencies;
    users.assertCurrentProfile();
    return db.transaction(() => {
      users.assertCurrentProfile();
      return db.prepare(`DELETE FROM _auth_domain_mailbox_tokens
        WHERE token_hash = ? AND consumed_at IS NULL`).run(hashToken(rawToken)).changes === 1;
    });
  }

  /** Consume mailbox possession and reveal no tenant until that succeeds. */
  completeMailboxProof(rawToken: string): AuthDomainOnboardingCompletion {
    const { applicationId, config, db, tenancy, users } = this.dependencies;
    users.assertCurrentProfile();
    if (!config.enabled || !rawToken.startsWith(MAILBOX_TOKEN_PREFIX)) return unavailable();
    const now = this.dependencies.now();
    return db.transaction(() => {
      users.assertCurrentProfile();
      this.dependencies.reconcileClaimStatuses();
      const token = db.prepare(`SELECT * FROM _auth_domain_mailbox_tokens
        WHERE application_id = ? AND token_hash = ?`).get(
        applicationId,
        hashToken(rawToken),
      ) as MailboxTokenRow | null;
      if (!token || token.consumed_at !== null || token.expires_at <= now) {
        return unavailable();
      }
      if (db.prepare(`UPDATE _auth_domain_mailbox_tokens SET consumed_at = ?
        WHERE outbox_job_id = ? AND consumed_at IS NULL`).run(
        now,
        token.outbox_job_id,
      ).changes < 1) return unavailable();
      const user = users.getUserById(token.user_id);
      if (!isEligibleUser(user)
        || canonicalizeEmail(user.email) !== token.email
        || users.getEmailGeneration(user.userId) !== token.email_generation
        || users.getAuthGeneration(user.userId) !== token.auth_generation
        || (token.identity_kind === 'continuation'
          && !this.isContinuationLive(token.identity_continuation_id, {
            userId: token.user_id,
            authGeneration: token.auth_generation,
          }))) return unavailable();
      let domain: string;
      try {
        domain = verifiedDomainFromEmail(user.email, config.sharedMailboxDomains);
      } catch {
        return unavailable();
      }
      const proofId = users.recordEmailLinkMailboxProof({
        applicationId,
        userId: user.userId,
        email: user.email,
        emailGeneration: token.email_generation,
        provedAt: now,
        expiresAt: now + config.mailboxProofMaxAgeMs,
      });
      if (!proofId) return unavailable();
      const eligible = this.resolveEligibleClaim(domain, user.userId, now);
      if (!eligible) return unavailable();
      const tenant = tenancy.getTenant(eligible.claim.tenant_id)!;
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
        now + config.admissionTTLms,
        now + config.mailboxProofMaxAgeMs,
      );
      db.prepare(`
        INSERT INTO _auth_domain_onboarding_transactions (
          transaction_id, application_id, user_id, email, email_generation,
          auth_generation, identity_kind, identity_continuation_id,
          mailbox_proof_id, domain, claim_id, claim_revision, policy_revision,
          tenant_id, request_role_key, token_hash, expires_at, consumed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
      `).run(
        `dot_${crypto.randomUUID()}`,
        applicationId,
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
      this.dependencies.emitCode(OBS_CODES.AUTH_DOMAIN_MAILBOX_PROVED, {
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
    this.dependencies.users.assertCurrentProfile();
    if (!raw.startsWith(ADMISSION_TOKEN_PREFIX)) return null;
    const row = this.getTransactionByHash.get(
      this.dependencies.applicationId,
      hashToken(raw),
    ) as TransactionRow | null;
    if (!row || row.consumed_at !== null || row.expires_at <= this.dependencies.now()) {
      return null;
    }
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
    const { applicationId, config, db, tenancy, users } = this.dependencies;
    users.assertCurrentProfile();
    this.requireEnabled();
    const now = this.dependencies.now();
    return db.transaction(() => {
      users.assertCurrentProfile();
      this.dependencies.reconcileClaimStatuses();
      const transaction = this.getTransactionByHash.get(
        applicationId,
        hashToken(input.continuation),
      ) as TransactionRow | null;
      if (!transaction || transaction.consumed_at !== null
        || transaction.expires_at <= now
        || !sameIdentityBinding(transaction, input.identity)) {
        throw invalidAdmission();
      }
      const user = users.getUserById(transaction.user_id);
      if (!isEligibleUser(user)
        || canonicalizeEmail(user.email) !== transaction.email
        || users.getEmailGeneration(user.userId) !== transaction.email_generation
        || users.getAuthGeneration(user.userId) !== transaction.auth_generation) {
        throw invalidAdmission();
      }
      const proof = db.prepare(`SELECT * FROM _auth_mailbox_proofs
        WHERE proof_id = ? AND application_id = ? AND user_id = ?
          AND email = ? AND email_generation = ? AND source = 'email-link'
          AND revoked_at IS NULL AND expires_at > ? AND proved_at > ?`).get(
        transaction.mailbox_proof_id,
        applicationId,
        user.userId,
        transaction.email,
        transaction.email_generation,
        now,
        now - config.mailboxProofMaxAgeMs,
      );
      if (!proof) throw invalidAdmission();
      const claim = this.dependencies.requireClaim(
        transaction.tenant_id,
        transaction.claim_id,
      );
      const policy = this.dependencies.getPolicy(transaction.claim_id);
      if (claim.domain !== transaction.domain
        || claim.revision !== transaction.claim_revision
        || !isClaimAdmissionEligible(claim, now, config.gracePeriodMs)
        || policy.policy_revision !== transaction.policy_revision
        || !policy.enabled
        || policy.request_role_key !== transaction.request_role_key
        || !config.allowedRequestRoles.includes(transaction.request_role_key)) {
        throw invalidAdmission();
      }
      this.dependencies.requireConfiguredRole(transaction.request_role_key);
      const tenant = this.dependencies.requireActiveTenant(transaction.tenant_id);
      if (this.hasPendingInvitation(tenant.tenantId, user.email, now)
        || tenancy.getMembership(tenant.tenantId, user.userId)
        || this.hasAdmissionBlock(tenant.tenantId, user.userId)) {
        throw domainAdmissionBlocked();
      }
      const existing = this.getJoinRequest(tenant.tenantId, user.userId);
      if (existing && existing.status !== 'pending'
        && !this.canRetryJoinRequest(existing, now)) throw domainAdmissionBlocked();
      if (input.consumeIdentity && !invokeSynchronousAuthCallback(
        input.consumeIdentity,
        {
          component: 'verified-domain-admission',
          invariant: 'identity-consumer-async',
          message: '[auth] Verified-domain identity consumption must be synchronous.',
          emitCode: this.dependencies.emitCode,
        },
      )) throw invalidAdmission();
      if (db.prepare(`UPDATE _auth_domain_onboarding_transactions
        SET consumed_at = ? WHERE transaction_id = ? AND consumed_at IS NULL
          AND expires_at > ?`).run(
        now,
        transaction.transaction_id,
        now,
      ).changes !== 1) throw invalidAdmission();

      let request = existing;
      if (!request) {
        const joinRequestId = `tjoin_${crypto.randomUUID()}`;
        db.prepare(`
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
        const changed = db.prepare(`
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
        // revision even if a generic request won the race after proof issue.
        const changed = db.prepare(`
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
      db.prepare(`
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
      this.dependencies.emitCode(OBS_CODES.AUTH_DOMAIN_JOIN_REQUESTED, {
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

  private resolveEligibleClaim(domain: string, userId: string, now: number): null | {
    claim: AdmissionClaimRow;
    policy: AdmissionPolicyRow & { request_role_key: string };
  } {
    const { config, db, tenancy, users } = this.dependencies;
    const row = db.prepare(`
      SELECT claim.*, policy.enabled, policy.admission,
        policy.request_role_key, policy.revision AS policy_revision
      FROM _auth_tenant_domain_claims claim
      INNER JOIN _auth_tenant_domain_policies policy ON policy.claim_id = claim.claim_id
      INNER JOIN _auth_tenants tenant ON tenant.tenant_id = claim.tenant_id
      WHERE claim.domain = ? AND claim.released_at IS NULL
        AND tenant.status = 'active' AND tenant.kind = 'organization'
        AND policy.enabled = 1 AND policy.admission = 'request-to-join'
    `).get(domain) as (AdmissionClaimRow & AdmissionPolicyRow) | null;
    if (!row || !row.request_role_key
      || !isClaimAdmissionEligible(row, now, config.gracePeriodMs)
      || !config.allowedRequestRoles.includes(row.request_role_key)
      || !this.dependencies.isConfiguredRoleSafe(row.request_role_key)
      || tenancy.getMembership(row.tenant_id, userId)
      || this.hasAdmissionBlock(row.tenant_id, userId)
      || this.hasPendingInvitation(
        row.tenant_id,
        users.getUserById(userId)?.email ?? '',
        now,
      )) {
      return null;
    }
    return {
      claim: row,
      policy: row as AdmissionPolicyRow & { request_role_key: string },
    };
  }

  private getJoinRequest(tenantId: string, userId: string): JoinRequestRow | null {
    return this.dependencies.db.prepare(`SELECT join_request_id, status, request_revision,
        created_at, reviewed_at
      FROM _auth_tenant_join_requests WHERE tenant_id = ? AND user_id = ?`).get(
      tenantId,
      userId,
    ) as JoinRequestRow | null;
  }

  private canRetryJoinRequest(request: JoinRequestRow, now: number): boolean {
    if (request.status === 'pending') return true;
    if (request.status === 'approved') return false;
    const provenance = this.dependencies.db.prepare(`SELECT blocked_until, source,
        request_revision
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
      ?? ((request.reviewed_at ?? request.created_at)
        + this.dependencies.config.deniedRetryCooldownMs);
    return blockedUntil <= now;
  }

  private hasPendingInvitation(tenantId: string, email: string, now: number): boolean {
    return Boolean(this.dependencies.db.prepare(`SELECT 1 FROM _auth_tenant_invitations
      WHERE tenant_id = ? AND email = ? COLLATE NOCASE AND status = 'pending'
        AND expires_at > ? LIMIT 1`).get(tenantId, canonicalizeEmail(email), now));
  }

  private hasAdmissionBlock(tenantId: string, userId: string): boolean {
    return Boolean(this.dependencies.db.prepare(`SELECT 1 FROM _auth_tenant_admission_blocks
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
    return Boolean(this.dependencies.db.prepare(`SELECT 1 FROM _auth_session_continuations
      WHERE continuation_id = ? AND application_id = ? AND user_id = ?
        AND purpose = 'tenant_onboarding' AND auth_generation = ?
        AND consumed_at IS NULL AND expires_at > ?`).get(
      continuationId,
      this.dependencies.applicationId,
      expected.userId,
      expected.authGeneration,
      this.dependencies.now(),
    ));
  }

  private requireEnabled(): void {
    if (!this.dependencies.config.enabled) {
      throw new AuthError(
        'Verified-domain onboarding is unavailable',
        'AUTH_DOMAIN_ONBOARDING_UNAVAILABLE',
        404,
      );
    }
  }
}

function isClaimAdmissionEligible(
  claim: AdmissionClaimRow,
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

function unavailable(): AuthDomainOnboardingCompletion {
  return Object.freeze({ option: Object.freeze({ action: 'unavailable' as const }) });
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
