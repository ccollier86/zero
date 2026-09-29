/**
 * DNS verification control plane for verified-domain onboarding.
 *
 * This coordinator owns bounded DNS I/O, claim leases, periodic
 * reverification, and the worker lifecycle. Tenant claim/policy management
 * remains in the public verified-domain service.
 */

import { timingSafeEqual } from 'node:crypto';
import { OBS_CODES } from '../observability/codes';
import type { ReactiveDB } from '../sync/reactive-db';
import { hashToken } from '../tokens/token-utils';
import {
  authAuditActorFromContext,
  captureAuthAuditRequestContext,
  type AuthAuditService,
} from './auth-audit-service';
import type { AuthAuditRequestContext } from './auth-audit-types';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import type { AssertAuthTenantMutationAuthority } from './auth-tenant-mutation-authority';
import type { ResolvedAuthTenantOnboardingConfig } from './auth-tenant-onboarding-types';
import type { AuthTenantDomainClaimProjection } from './verified-domain-contracts';
import { resolveBoundedTxt } from './verified-domain-dns';
import { AuthError } from './types';
import type { UserStore } from './user-store';

export const VERIFIED_DOMAIN_DNS_RECORD_PREFIX = '_zero-domain-verification';

export const VERIFIED_DOMAIN_REVERIFY_BATCH = 8;
const WORKER_POLL_MS = 60_000;

interface VerificationClaimRow {
  claim_id: string;
  tenant_id: string;
  domain: string;
  status: 'pending' | 'verified' | 'grace' | 'lost';
  challenge_digest: string | null;
  challenge_expires_at: number | null;
  verification_digest: string | null;
  verified_at: number | null;
  last_checked_at: number | null;
  next_check_at: number | null;
  valid_until: number | null;
  revision: number;
  lease_owner: string | null;
  released_at: number | null;
}

interface VerifiedDomainDnsCoordinatorDependencies {
  db: ReactiveDB;
  config: ResolvedAuthTenantOnboardingConfig['verifiedDomains'];
  users: UserStore;
  now: () => number;
  auditService?: AuthAuditService;
  emitCode: AuthPlatformCodeEmitter;
  cleanupExpiredEvidence: () => unknown;
  reconcileClaimStatuses: (tenantId?: string) => void;
  requireClaim: (tenantId: string, claimId: string) => VerificationClaimRow;
  requireProjectedClaim: (
    tenantId: string,
    claimId: string,
  ) => AuthTenantDomainClaimProjection;
  lockTenant: (tenantId: string) => void;
  requireAuthority: (
    tenantId: string,
    assertion: AssertAuthTenantMutationAuthority,
  ) => ReturnType<AssertAuthTenantMutationAuthority>;
}

interface VerificationLease {
  tenantId: string;
  claimId: string;
  domain: string;
  digest: string;
  revision: number;
  leaseOwner: string;
}

/** Coordinates every DNS read and lease transition for verified claims. */
export class VerifiedDomainDnsCoordinator {
  private readonly workerId = `vdw_${crypto.randomUUID()}`;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<number> | null = null;
  private stopped = false;

  constructor(private readonly dependencies: VerifiedDomainDnsCoordinatorDependencies) {}

  start(): void {
    const { config, users } = this.dependencies;
    users.assertCurrentProfile();
    if (this.timer || this.stopped) return;
    this.dependencies.cleanupExpiredEvidence();
    if (!config.enabled) return;
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

  async verifyClaim(input: {
    tenantId: string;
    claimId: string;
    expectedRevision: string;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): Promise<AuthTenantDomainClaimProjection> {
    this.dependencies.users.assertCurrentProfile();
    this.requireEnabled();
    const request = Object.freeze({
      tenantId: input.tenantId,
      claimId: input.claimId,
      expectedRevision: input.expectedRevision,
      assertCurrentAuthority: input.assertCurrentAuthority,
      auditRequest: captureAuthAuditRequestContext(input.auditRequest),
    });
    const lease = this.acquireManualLease(request);
    let answers: readonly string[];
    try {
      answers = await this.resolveAnswers(lease.domain);
    } catch (error) {
      this.releaseUnavailableLease({ ...lease, scheduleRetry: false });
      this.dependencies.emitCode(OBS_CODES.AUTH_DOMAIN_DNS_UNAVAILABLE, {
        error,
        metadata: { claimId: request.claimId, tenantId: request.tenantId },
      });
      throw dnsUnavailable();
    }
    const matched = answers.some((answer) => digestMatches(lease.digest, answer));
    let claim: AuthTenantDomainClaimProjection;
    try {
      claim = this.finalizeManualLease({
        ...request,
        leaseOwner: lease.leaseOwner,
        expectedNumericRevision: lease.revision,
        matched,
      });
    } catch (error) {
      // DNS completed outside SQLite. Release only this exact lease if the
      // authority or revision changed; lease expiry remains process recovery.
      try {
        this.releaseUnavailableLease({ ...lease, scheduleRetry: false });
      } catch {
        // Preserve the authoritative failure. Stale runtimes cannot write only
        // for cleanup, and the bounded lease expiry will recover the claim.
      }
      throw error;
    }
    return claim;
  }

  async processDueReverification(limit = VERIFIED_DOMAIN_REVERIFY_BATCH): Promise<number> {
    this.dependencies.users.assertCurrentProfile();
    this.dependencies.cleanupExpiredEvidence();
    if (!this.dependencies.config.enabled || this.stopped) return 0;
    if (this.running) return this.running;
    const run = this.processDueReverificationInner(limit).finally(() => {
      if (this.running === run) this.running = null;
    });
    this.running = run;
    return run;
  }

  private async processDueReverificationInner(limit: number): Promise<number> {
    this.dependencies.reconcileClaimStatuses();
    let processed = 0;
    for (let index = 0; index < Math.max(0, Math.min(limit, 100)); index += 1) {
      const lease = this.acquireDueLease();
      if (!lease) break;
      let answers: readonly string[];
      try {
        answers = await this.resolveAnswers(lease.domain);
      } catch (error) {
        this.releaseUnavailableLease({ ...lease, scheduleRetry: true });
        this.dependencies.emitCode(OBS_CODES.AUTH_DOMAIN_DNS_UNAVAILABLE, {
          error,
          metadata: { claimId: lease.claimId, tenantId: lease.tenantId },
        });
        processed += 1;
        continue;
      }
      const matched = answers.some((answer) => digestMatches(lease.digest, answer));
      if (this.finalizeSystemLease(lease, matched)) processed += 1;
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
      this.dependencies.emitCode(OBS_CODES.AUTH_DOMAIN_WORKER_FAILED, {
        error,
        metadata: { error: error instanceof Error ? error.name : 'UnknownError' },
      });
    });
  }

  private acquireManualLease(input: {
    tenantId: string;
    claimId: string;
    expectedRevision: string;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
  }): VerificationLease {
    const { config, db, users } = this.dependencies;
    const now = this.dependencies.now();
    const tenantId = input.tenantId;
    const claimId = input.claimId;
    const expectedRevision = input.expectedRevision;
    const assertCurrentAuthority = input.assertCurrentAuthority;
    return db.transaction(() => {
      users.assertCurrentProfile();
      this.dependencies.lockTenant(tenantId);
      this.dependencies.requireAuthority(tenantId, assertCurrentAuthority);
      const claim = this.dependencies.requireClaim(tenantId, claimId);
      if (claimRevision(claim.revision) !== expectedRevision) {
        throw claimRevisionConflict();
      }
      const digest = claim.challenge_digest ?? claim.verification_digest;
      if (!digest || (claim.challenge_digest && claim.challenge_expires_at! <= now)) {
        throw new AuthError(
          'DNS challenge is unavailable or expired',
          'AUTH_DOMAIN_CHALLENGE_EXPIRED',
          409,
        );
      }
      if (claim.last_checked_at !== null
        && now - claim.last_checked_at < config.dnsCheckCooldownMs) {
        throw rateLimited();
      }
      const leaseOwner = `vdl_${crypto.randomUUID()}`;
      const changed = db.prepare(`
        UPDATE _auth_tenant_domain_claims
        SET lease_owner = ?, lease_expires_at = ?
        WHERE tenant_id = ? AND claim_id = ? AND revision = ?
          AND released_at IS NULL
          AND (lease_owner IS NULL OR lease_expires_at <= ?)
      `).run(
        leaseOwner,
        now + config.dnsTimeoutMs + 5_000,
        tenantId,
        claimId,
        claim.revision,
        now,
      );
      if (changed.changes !== 1) throw rateLimited();
      return {
        tenantId,
        claimId,
        domain: claim.domain,
        digest,
        revision: claim.revision,
        leaseOwner,
      };
    });
  }

  private finalizeManualLease(input: {
    tenantId: string;
    claimId: string;
    leaseOwner: string;
    expectedNumericRevision: number;
    matched: boolean;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): AuthTenantDomainClaimProjection {
    const { db, users } = this.dependencies;
    const now = this.dependencies.now();
    const tenantId = input.tenantId;
    const claimId = input.claimId;
    const leaseOwner = input.leaseOwner;
    const expectedNumericRevision = input.expectedNumericRevision;
    const matched = input.matched;
    const assertCurrentAuthority = input.assertCurrentAuthority;
    const auditRequest = captureAuthAuditRequestContext(input.auditRequest);
    db.transaction(() => {
      users.assertCurrentProfile();
      this.dependencies.lockTenant(tenantId);
      const authority = this.dependencies.requireAuthority(
        tenantId,
        assertCurrentAuthority,
      );
      const claim = this.dependencies.requireClaim(tenantId, claimId);
      if (claim.revision !== expectedNumericRevision
        || claim.lease_owner !== leaseOwner) throw claimRevisionConflict();
      this.persistVerificationResult(claim, leaseOwner, matched, now);
      this.dependencies.auditService?.append({
        action: 'tenant.domain-verification-completed',
        outcome: matched ? 'succeeded' : 'failed',
        ...(matched ? {} : { reason: 'proof-mismatch' }),
        scope: { kind: 'tenant', tenantId },
        actor: authAuditActorFromContext(authority.auth),
        request: auditRequest,
        target: { type: 'tenant-domain-claim', id: claimId },
      });
      const code = matched
        ? OBS_CODES.AUTH_DOMAIN_VERIFIED
        : OBS_CODES.AUTH_DOMAIN_VERIFICATION_FAILED;
      db.afterCommit(() => this.dependencies.emitCode(code, {
        metadata: { claimId, tenantId },
      }));
    });
    return this.dependencies.requireProjectedClaim(tenantId, claimId);
  }

  private acquireDueLease(): VerificationLease | null {
    const { config, db, users } = this.dependencies;
    const now = this.dependencies.now();
    return db.transaction(() => {
      users.assertCurrentProfile();
      const claim = db.prepare(`
        SELECT * FROM _auth_tenant_domain_claims claim
        WHERE claim.released_at IS NULL
          AND claim.status IN ('verified', 'grace', 'lost')
          AND claim.verification_digest IS NOT NULL
          AND claim.next_check_at IS NOT NULL AND claim.next_check_at <= ?
          AND (claim.lease_owner IS NULL OR claim.lease_expires_at <= ?)
          AND EXISTS (SELECT 1 FROM _auth_tenants tenant
            WHERE tenant.tenant_id = claim.tenant_id
              AND tenant.status = 'active' AND tenant.kind = 'organization')
        ORDER BY claim.next_check_at ASC, claim.claim_id ASC
        LIMIT 1
      `).get(now, now) as VerificationClaimRow | null;
      if (!claim?.verification_digest) return null;
      const changed = db.prepare(`
        UPDATE _auth_tenant_domain_claims
        SET lease_owner = ?, lease_expires_at = ?
        WHERE claim_id = ? AND revision = ? AND released_at IS NULL
          AND (lease_owner IS NULL OR lease_expires_at <= ?)
      `).run(
        this.workerId,
        now + config.dnsTimeoutMs + 5_000,
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

  private finalizeSystemLease(lease: VerificationLease, matched: boolean): boolean {
    const { db, users } = this.dependencies;
    const now = this.dependencies.now();
    const tenantId = lease.tenantId;
    const claimId = lease.claimId;
    return db.transaction(() => {
      users.assertCurrentProfile();
      const claim = this.dependencies.requireClaim(tenantId, claimId);
      if (claim.revision !== lease.revision || claim.lease_owner !== lease.leaseOwner) {
        return false;
      }
      this.persistVerificationResult(claim, lease.leaseOwner, matched, now);
      const code = matched
        ? OBS_CODES.AUTH_DOMAIN_REVERIFIED
        : OBS_CODES.AUTH_DOMAIN_REVERIFICATION_FAILED;
      db.afterCommit(() => this.dependencies.emitCode(code, {
        metadata: { claimId, tenantId },
      }));
      return true;
    });
  }

  private releaseUnavailableLease(input: VerificationLease & { scheduleRetry: boolean }): void {
    const { config, db, users } = this.dependencies;
    const now = this.dependencies.now();
    db.transaction(() => {
      users.assertCurrentProfile();
      db.prepare(`
        UPDATE _auth_tenant_domain_claims
        SET lease_owner = NULL, lease_expires_at = NULL,
            next_check_at = CASE WHEN ? = 1 THEN ? ELSE next_check_at END
        WHERE tenant_id = ? AND claim_id = ? AND revision = ?
          AND lease_owner = ? AND released_at IS NULL
      `).run(
        input.scheduleRetry ? 1 : 0,
        now + config.reverifyRetryIntervalMs,
        input.tenantId,
        input.claimId,
        input.revision,
        input.leaseOwner,
      );
    });
  }

  private persistVerificationResult(
    claim: VerificationClaimRow,
    leaseOwner: string,
    matched: boolean,
    now: number,
  ): void {
    const { config, db } = this.dependencies;
    if (matched) {
      const digest = claim.challenge_digest ?? claim.verification_digest;
      const changed = db.prepare(`
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
        now + config.reverifyIntervalMs,
        now + config.reverifyIntervalMs,
        now,
        claim.claim_id,
        claim.revision,
        leaseOwner,
      );
      if (changed.changes !== 1) throw claimRevisionConflict();
      return;
    }
    const status = failedClaimStatus(claim, now, config.gracePeriodMs);
    const changed = db.prepare(`
      UPDATE _auth_tenant_domain_claims
      SET status = ?, last_checked_at = ?, next_check_at = ?,
          revision = revision + 1, lease_owner = NULL, lease_expires_at = NULL,
          updated_at = ?
      WHERE claim_id = ? AND revision = ? AND lease_owner = ?
        AND released_at IS NULL
    `).run(
      status,
      now,
      now + config.reverifyRetryIntervalMs,
      now,
      claim.claim_id,
      claim.revision,
      leaseOwner,
    );
    if (changed.changes !== 1) throw claimRevisionConflict();
  }

  private async resolveAnswers(domain: string): Promise<readonly string[]> {
    const { config } = this.dependencies;
    return resolveBoundedTxt(`${VERIFIED_DOMAIN_DNS_RECORD_PREFIX}.${domain}`, {
      resolveTxt: config.resolveTxt,
      timeoutMs: config.dnsTimeoutMs,
      maxAnswers: config.maxTxtAnswers,
      maxBytes: config.maxTxtBytes,
    });
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

function digestMatches(expected: string, answer: string): boolean {
  const actual = hashToken(answer.trim());
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(actual, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

function failedClaimStatus(
  claim: VerificationClaimRow,
  now: number,
  gracePeriodMs: number,
): VerificationClaimRow['status'] {
  if (!claim.verified_at || !claim.valid_until) return 'pending';
  return now < claim.valid_until
    ? 'verified'
    : now < claim.valid_until + gracePeriodMs ? 'grace' : 'lost';
}

function claimRevision(revision: number): string {
  return `vdc_${revision.toString(36)}`;
}

function claimRevisionConflict(): AuthError {
  return new AuthError(
    'Domain claim changed; reload before retrying',
    'AUTH_DOMAIN_CLAIM_REVISION_CONFLICT',
    409,
  );
}

function dnsUnavailable(): AuthError {
  return new AuthError(
    'DNS TXT verification is temporarily unavailable',
    'AUTH_DOMAIN_DNS_UNAVAILABLE',
    503,
  );
}

function rateLimited(): AuthError {
  return new AuthError(
    'Domain verification was checked recently; retry later',
    'AUTH_DOMAIN_VERIFY_RATE_LIMITED',
    429,
  );
}
