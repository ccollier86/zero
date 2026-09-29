/** Irreversible verified-domain release and quarantine control plane. */

import type { Statement } from 'bun:sqlite';
import { OBS_CODES } from '../observability/codes';
import type { ReactiveDB } from '../sync/reactive-db';
import {
  authAuditActorFromContext,
  captureAuthAuditRequestContext,
  type AuthAuditService,
} from './auth-audit-service';
import type { AuthAuditRequestContext } from './auth-audit-types';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';
import type { AssertAuthTenantMutationAuthority } from './auth-tenant-mutation-authority';
import type { ResolvedAuthTenantOnboardingConfig } from './auth-tenant-onboarding-types';
import type { TenancyService } from './tenancy/tenancy-service';
import { AuthError } from './types';
import type { UserStore } from './user-store';
import type { AuthTenantDomainReleaseResult } from './verified-domain-contracts';

interface ReleaseClaimRow {
  claim_id: string;
  domain: string;
  revision: number;
}

interface ReleasePolicyRow {
  policy_revision: number;
}

interface VerifiedDomainReleaseServiceDependencies {
  db: ReactiveDB;
  config: ResolvedAuthTenantOnboardingConfig['verifiedDomains'];
  users: UserStore;
  tenancy: TenancyService;
  now: () => number;
  auditService?: AuthAuditService;
  emitCode: AuthPlatformCodeEmitter;
}

export const VERIFIED_DOMAIN_RELEASE_QUARANTINE_MS = 7 * 86_400_000;

/**
 * Owns the complete release transaction so a claim cannot be retired without
 * disabling admission, preserving provenance, and cancelling pending work.
 */
export class VerifiedDomainReleaseService {
  private readonly getClaim: Statement;
  private readonly getPolicy: Statement;

  constructor(
    private readonly dependencies: VerifiedDomainReleaseServiceDependencies,
  ) {
    this.getClaim = dependencies.db.prepare(`SELECT claim_id, domain, revision
      FROM _auth_tenant_domain_claims
      WHERE tenant_id = ? AND claim_id = ? AND released_at IS NULL`);
    this.getPolicy = dependencies.db.prepare(`SELECT revision AS policy_revision
      FROM _auth_tenant_domain_policies WHERE claim_id = ?`);
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
    const { db, users } = this.dependencies;
    users.assertCurrentProfile();
    this.requireEnabled();
    const tenantId = input.tenantId;
    const claimId = input.claimId;
    const expectedRevision = input.expectedRevision;
    const expectedPolicyRevision = input.expectedPolicyRevision;
    const confirmDomain = input.confirmDomain;
    const assertCurrentAuthority = input.assertCurrentAuthority;
    const auditRequest = captureAuthAuditRequestContext(input.auditRequest);

    return db.transaction(() => {
      users.assertCurrentProfile();
      this.lockTenant(tenantId);
      const authority = this.requireAuthority(
        tenantId,
        assertCurrentAuthority,
      );
      const claim = this.requireClaim(tenantId, claimId);
      if (claimRevision(claim.revision) !== expectedRevision) {
        throw claimRevisionConflict();
      }
      const policy = this.requirePolicy(claimId);
      if (policyRevision(policy.policy_revision) !== expectedPolicyRevision) {
        throw policyRevisionConflict();
      }
      if (confirmDomain !== claim.domain) throw releaseConfirmationMismatch();

      const releasedAt = this.dependencies.now();
      const quarantineUntil = releasedAt + VERIFIED_DOMAIN_RELEASE_QUARANTINE_MS;
      const policyChanged = db.prepare(`
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

      const invalidatedTransactions = db.prepare(`
        UPDATE _auth_domain_onboarding_transactions
        SET consumed_at = ?
        WHERE claim_id = ? AND consumed_at IS NULL
      `).run(releasedAt, claim.claim_id).changes;

      const snapshottedRequests = db.prepare(`
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

      db.prepare(`
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

      const cancelledRequests = db.prepare(`
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

      const released = db.prepare(`
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

      this.dependencies.auditService?.append({
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
      db.afterCommit(() => this.dependencies.emitCode(code, {
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
  }

  private requireAuthority(
    tenantId: string,
    assertion: AssertAuthTenantMutationAuthority,
  ) {
    const authority = invokeSynchronousAuthCallback(
      () => assertion(['tenant.domains:release']),
      {
        component: 'verified-domain-onboarding-service',
        invariant: 'authority-callback-async',
        message: '[auth] Verified-domain authority callback must be synchronous.',
        emitCode: this.dependencies.emitCode,
      },
    );
    if (authority.scope.tenantId !== tenantId) throw forbidden();
    this.requireActiveTenant(tenantId);
    return authority;
  }

  private requireClaim(tenantId: string, claimId: string): ReleaseClaimRow {
    const claim = this.getClaim.get(tenantId, claimId) as ReleaseClaimRow | null;
    if (!claim) throw claimNotFound();
    return claim;
  }

  private requirePolicy(claimId: string): ReleasePolicyRow {
    const policy = this.getPolicy.get(claimId) as ReleasePolicyRow | null;
    if (!policy) throw claimNotFound();
    return policy;
  }

  private lockTenant(tenantId: string): void {
    const changed = this.dependencies.db.prepare(`UPDATE _auth_tenants
      SET updated_at = updated_at
      WHERE tenant_id = ? AND status = 'active'`).run(tenantId).changes;
    if (changed !== 1) throw forbidden();
  }

  private requireActiveTenant(tenantId: string): void {
    const tenant = this.dependencies.tenancy.getTenant(tenantId);
    if (!tenant || tenant.status !== 'active' || tenant.kind !== 'organization') {
      throw forbidden();
    }
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

  private stateInvariant(invariant: string, message: string): AuthError {
    const error = new AuthError(message, 'AUTH_STATE_INVARIANT_FAILED', 500);
    this.dependencies.emitCode(OBS_CODES.AUTH_STATE_INVARIANT_FAILED, {
      error,
      metadata: {
        component: 'verified-domain-onboarding-service',
        invariant,
      },
    });
    return error;
  }
}

function claimRevision(revision: number): string {
  return `vdc_${revision.toString(36)}`;
}

function policyRevision(revision: number): string {
  return `vdp_${revision.toString(36)}`;
}

function claimNotFound(): AuthError {
  return new AuthError('Domain claim not found', 'AUTH_DOMAIN_CLAIM_NOT_FOUND', 404);
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

function forbidden(): AuthError {
  return new AuthError('Forbidden', 'FORBIDDEN', 403);
}
