import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { resolveAuthBehaviorConfig } from './auth-config';
import { AuthEmailOutboxDelivery } from './auth-email-outbox-delivery';
import type { AuthEmailOutboxDeliveryDeps } from './auth-email-outbox-delivery-types';
import type { AuthEmailOutboxJob } from './auth-email-outbox-types';
import { defineAuthTables } from './auth-schema';
import { AuthTenantOnboardingService } from './auth-tenant-onboarding-service';
import { defineAuthTenantOnboardingTables } from './auth-tenant-onboarding-schema';
import { AuthAuditService } from './auth-audit-service';
import { resolveAuthAuditConfig } from './auth-audit-config';
import { defineAuthAuditTables } from './auth-audit-schema';
import type { AssertAuthTenantMutationAuthority } from './auth-tenant-mutation-authority';
import { createAuthorizationKernel } from './authorization-kernel';
import { TenancyService } from './tenancy/tenancy-service';
import { defineTenancyTables } from './tenancy/tenancy-schema';
import { TenantStore } from './tenancy/tenant-store';
import { UserPropertyService } from './user-property-service';
import { UserStore } from './user-store';
import { AuthError } from './types';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { VerifiedDomainOnboardingService } from './verified-domain-service';
import { VERIFIED_DOMAIN_RELEASE_QUARANTINE_MS } from './verified-domain-service';

const active: ReactiveDB[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const db of active.splice(0)) db.dispose();
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('verified-domain onboarding service', () => {
  test('fails cached control-plane and worker boundaries after a profile change', async () => {
    const harness = await createHarness();
    const owner = await createUser(harness, 'profile-owner', 'owner@platform.com');
    const tenant = harness.tenancy.createTenant({
      name: 'Profile Domain',
      slug: 'profile-domain',
      ownerUserId: owner.userId,
    });
    harness.domains.createClaim({
      tenantId: tenant.tenant.tenantId,
      domain: 'profile-acme.com',
      assertCurrentAuthority: authority(
        owner.userId,
        tenant.ownerMembership.membershipId,
        tenant.tenant.tenantId,
      ),
    });
    let current = true;
    harness.users.setRuntimeProfileGuard(() => {
      if (!current) {
        throw new AuthError('Profile changed', 'AUTH_PROFILE_CHANGED', 503);
      }
    });
    expect(harness.domains.listClaims(tenant.tenant.tenantId)).toHaveLength(1);

    current = false;
    expect(() => harness.domains.requestRoles).toThrow(expect.objectContaining({
      code: 'AUTH_PROFILE_CHANGED',
    }));
    expect(() => harness.domains.listClaims(tenant.tenant.tenantId))
      .toThrow(expect.objectContaining({ code: 'AUTH_PROFILE_CHANGED' }));
    expect(() => harness.domains.cleanupExpiredEvidence())
      .toThrow(expect.objectContaining({ code: 'AUTH_PROFILE_CHANGED' }));
    expect(harness.db.prepare(`SELECT COUNT(*) AS count
      FROM _auth_tenant_domain_claims WHERE tenant_id = ?`).get(
      tenant.tenant.tenantId,
    )).toEqual({ count: 1 });

    const { dns: workerState } = harness.domains as unknown as {
      dns: {
        runWorkerPass(): void;
        stopped: boolean;
        timer: ReturnType<typeof setInterval> | null;
      };
    };
    workerState.runWorkerPass();
    await Promise.resolve();
    await Promise.resolve();
    expect(workerState.stopped).toBe(true);
    expect(workerState.timer).toBeNull();
  });

  test('binds DNS and mailbox proof to one fixed-role retained request and provenance', async () => {
    const harness = await createHarness();
    const owner = await createUser(harness, 'owner', 'owner@platform.com');
    const applicant = await createUser(harness, 'applicant', 'person@acme.com');
    const tenant = harness.tenancy.createTenant({
      name: 'Acme',
      slug: 'acme',
      ownerUserId: owner.userId,
    });
    const assertAuthority = authority(
      owner.userId,
      tenant.ownerMembership.membershipId,
      tenant.tenant.tenantId,
    );

    const created = harness.domains.createClaim({
      tenantId: tenant.tenant.tenantId,
      domain: ' ACME.COM. ',
      assertCurrentAuthority: assertAuthority,
    });
    expect(created.claim).toMatchObject({
      domain: 'acme.com',
      status: 'pending',
      revision: 'vdc_1',
      policy: { enabled: false, revision: 'vdp_1' },
    });
    const storedChallenge = harness.db.prepare(`SELECT challenge_digest
      FROM _auth_tenant_domain_claims WHERE claim_id = ?`).get(
      created.claim.claimId,
    ) as { challenge_digest: string };
    expect(storedChallenge.challenge_digest).not.toBe(created.challenge.value);
    expect(JSON.stringify(harness.db.prepare(`SELECT *
      FROM _auth_tenant_domain_claims WHERE claim_id = ?`).get(created.claim.claimId)))
      .not.toContain(created.challenge.value);

    harness.txtAnswers = [[created.challenge.value]];
    const verified = await harness.domains.verifyClaim({
      tenantId: tenant.tenant.tenantId,
      claimId: created.claim.claimId,
      expectedRevision: created.claim.revision,
      assertCurrentAuthority: assertAuthority,
    });
    expect(harness.lastTxtName).toBe('_zero-domain-verification.acme.com');
    expect(verified).toMatchObject({ status: 'verified', revision: 'vdc_2' });
    expect(verified.challengeExpiresAt).toBeNull();
    const enabled = harness.domains.updatePolicy({
      tenantId: tenant.tenant.tenantId,
      claimId: created.claim.claimId,
      enabled: true,
      requestRoleKey: 'member',
      expectedRevision: verified.policy.revision,
      assertCurrentAuthority: assertAuthority,
    });
    expect(enabled.policy).toMatchObject({
      enabled: true,
      requestRoleKey: 'member',
      revision: 'vdp_2',
    });

    const binding = harness.domains.prepareMailboxRequest({
      userId: applicant.userId,
      identityKind: 'session',
    });
    expect(binding).not.toBeNull();
    const first = harness.domains.createMailboxDelivery({ ...binding!, jobId: 'job-one' })!;
    const rotated = harness.domains.createMailboxDelivery({ ...binding!, jobId: 'job-one' })!;
    expect(first.rawToken).not.toBe(rotated.rawToken);
    expect(rowCount(harness.db, `_auth_domain_mailbox_tokens
      WHERE outbox_job_id = 'job-one'`)).toBe(2);
    const completed = harness.domains.completeMailboxProof(first.rawToken);
    expect(completed.option).toMatchObject({
      action: 'request-to-join',
      tenant: { name: 'Acme', slug: 'acme' },
    });
    if (!('continuation' in completed)) {
      throw new Error('Expected a proof-bound admission continuation');
    }
    expect(harness.domains.completeMailboxProof(rotated.rawToken)).toEqual({
      option: { action: 'unavailable' },
    });
    expect(harness.domains.createMailboxDelivery({ ...binding!, jobId: 'job-one' }))
      .toBeNull();
    const identity = harness.domains.inspectAdmissionIdentity(completed.continuation);
    expect(identity).toEqual({
      userId: applicant.userId,
      authGeneration: harness.users.getAuthGeneration(applicant.userId),
      identityKind: 'session',
      identityContinuationId: null,
    });

    const asyncFalse = (async () => false) as unknown as () => boolean;
    expect(() => harness.domains.admit({
      continuation: completed.continuation,
      identity: identity!,
      consumeIdentity: asyncFalse,
    })).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      message: '[auth] Verified-domain identity consumption must be synchronous.',
    }));
    expect(harness.domains.inspectAdmissionIdentity(completed.continuation)).toEqual(identity);
    expect(rowCount(harness.db, '_auth_tenant_join_requests')).toBe(0);

    const admitted = harness.domains.admit({
      continuation: completed.continuation,
      identity: identity!,
    });
    expect(admitted.request).toMatchObject({
      status: 'pending',
      tenant: { name: 'Acme', slug: 'acme' },
    });
    const provenance = harness.db.prepare(`SELECT *
      FROM _auth_domain_join_request_provenance WHERE join_request_id = ?`).get(
      admitted.request.joinRequestId,
    ) as Record<string, unknown>;
    expect(provenance).toMatchObject({
      tenant_id: tenant.tenant.tenantId,
      user_id: applicant.userId,
      claim_id: created.claim.claimId,
      domain: 'acme.com',
      request_role_key: 'member',
    });

    expect(() => harness.onboarding.approveJoinRequest({
      tenantId: tenant.tenant.tenantId,
      joinRequestId: admitted.request.joinRequestId,
      expectedRequestRevision: 1,
      roleKeys: ['manager'],
      assertCurrentAuthority: assertAuthority,
    })).toThrow('role fixed by the tenant policy');
    const approved = harness.onboarding.approveJoinRequest({
      tenantId: tenant.tenant.tenantId,
      joinRequestId: admitted.request.joinRequestId,
      expectedRequestRevision: 1,
      assertCurrentAuthority: assertAuthority,
    });
    expect(approved.membership).toMatchObject({ status: 'active', roles: ['member'] });
    expect(approved.approvalPolicy).toEqual({
      canApprove: true,
      roleSelection: {
        mode: 'fixed',
        roles: [{ key: 'member', label: 'Member' }],
      },
    });
    expect(harness.db.prepare(`SELECT source, source_id, claim_id, domain
      FROM _auth_tenant_membership_provenance WHERE membership_id = ?`).get(
      approved.membership!.membershipId,
    )).toEqual({
      source: 'domain-request',
      source_id: admitted.request.joinRequestId,
      claim_id: created.claim.claimId,
      domain: 'acme.com',
    });
  });

  test('does not carry denied domain provenance into a generic reopened request', async () => {
    const harness = await createAdmittedHarness();
    const tenantId = harness.tenant.tenant.tenantId;
    const joinRequestId = harness.admitted.request.joinRequestId;
    const first = harness.onboarding.listJoinRequests({
      tenantId,
      status: 'pending',
      approvalScope: harness.assertCurrentAuthority([]).scope,
    }).requests[0]!;
    harness.onboarding.denyJoinRequest({
      tenantId,
      joinRequestId,
      expectedRequestRevision: first.requestRevision,
      assertCurrentAuthority: harness.assertCurrentAuthority,
    });

    harness.onboarding.submitJoinRequest({
      userId: harness.applicantId,
      tenantSlug: harness.tenant.tenant.slug,
    });
    expect(harness.onboarding.listJoinRequests({
      tenantId,
      status: 'denied',
    }).requests).toHaveLength(1);

    harness.now.value += harness.domains.config.deniedRetryCooldownMs;
    harness.onboarding.submitJoinRequest({
      userId: harness.applicantId,
      tenantSlug: harness.tenant.tenant.slug,
    });
    const reopened = harness.onboarding.listJoinRequests({
      tenantId,
      status: 'pending',
      approvalScope: harness.assertCurrentAuthority([]).scope,
    }).requests[0]!;
    expect(reopened).toMatchObject({
      requestRevision: first.requestRevision + 1,
      approvalPolicy: {
        canApprove: true,
        roleSelection: { mode: 'default', roles: [{ key: 'member' }] },
      },
    });
    expect(() => harness.onboarding.approveJoinRequest({
      tenantId,
      joinRequestId,
      expectedRequestRevision: first.requestRevision,
      assertCurrentAuthority: harness.assertCurrentAuthority,
    })).toThrow('revision changed');
    expect(() => harness.onboarding.denyJoinRequest({
      tenantId,
      joinRequestId,
      expectedRequestRevision: first.requestRevision,
      assertCurrentAuthority: harness.assertCurrentAuthority,
    })).toThrow('revision changed');

    const approved = harness.onboarding.approveJoinRequest({
      tenantId,
      joinRequestId,
      expectedRequestRevision: reopened.requestRevision,
      assertCurrentAuthority: harness.assertCurrentAuthority,
    });
    expect(approved.membership).toMatchObject({ status: 'active', roles: ['member'] });
    expect(harness.db.prepare(`SELECT source, request_revision, blocked_until
      FROM _auth_domain_join_request_provenance WHERE join_request_id = ?`).get(
      joinRequestId,
    )).toEqual({
      source: 'verified-domain',
      request_revision: first.requestRevision,
      blocked_until: harness.now.value,
    });
    expect(rowCount(harness.db, '_auth_tenant_membership_provenance')).toBe(0);
  });

  test('keeps released requests quarantined before a clean generic reopen', async () => {
    const harness = await createAdmittedHarness();
    const tenantId = harness.tenant.tenant.tenantId;
    const joinRequestId = harness.admitted.request.joinRequestId;
    const release = harness.domains.releaseClaim({
      tenantId,
      claimId: harness.claim.claimId,
      expectedRevision: harness.claim.revision,
      expectedPolicyRevision: harness.claim.policy.revision,
      confirmDomain: harness.claim.domain,
      assertCurrentAuthority: harness.assertCurrentAuthority,
    }).release;
    const cancelled = harness.onboarding.listJoinRequests({
      tenantId,
      status: 'cancelled',
    }).requests[0]!;

    harness.onboarding.submitJoinRequest({
      userId: harness.applicantId,
      tenantSlug: harness.tenant.tenant.slug,
    });
    expect(harness.onboarding.listJoinRequests({
      tenantId,
      status: 'cancelled',
    }).requests[0]!.requestRevision).toBe(cancelled.requestRevision);

    harness.now.value = release.quarantineUntil;
    harness.onboarding.submitJoinRequest({
      userId: harness.applicantId,
      tenantSlug: harness.tenant.tenant.slug,
    });
    const reopened = harness.onboarding.listJoinRequests({
      tenantId,
      status: 'pending',
      approvalScope: harness.assertCurrentAuthority([]).scope,
    }).requests[0]!;
    expect(reopened).toMatchObject({
      requestRevision: cancelled.requestRevision + 1,
      approvalPolicy: {
        canApprove: true,
        roleSelection: { mode: 'default', roles: [{ key: 'member' }] },
      },
    });
    expect(() => harness.onboarding.approveJoinRequest({
      tenantId,
      joinRequestId,
      expectedRequestRevision: cancelled.requestRevision,
      assertCurrentAuthority: harness.assertCurrentAuthority,
    })).toThrow('revision changed');
    expect(() => harness.onboarding.denyJoinRequest({
      tenantId,
      joinRequestId,
      expectedRequestRevision: cancelled.requestRevision,
      assertCurrentAuthority: harness.assertCurrentAuthority,
    })).toThrow('revision changed');
    const approved = harness.onboarding.approveJoinRequest({
      tenantId,
      joinRequestId,
      expectedRequestRevision: reopened.requestRevision,
      assertCurrentAuthority: harness.assertCurrentAuthority,
    });
    expect(approved.status).toBe('approved');
    expect(rowCount(harness.db, '_auth_tenant_membership_provenance')).toBe(0);
  });

  test('advances the revision when verified provenance replaces a pending generic policy', async () => {
    const harness = await createHarness();
    const owner = await createUser(harness, 'policy-owner', 'owner@platform.com');
    const applicant = await createUser(harness, 'policy-applicant', 'person@acme.com');
    const tenant = harness.tenancy.createTenant({
      name: 'Policy', slug: 'policy', ownerUserId: owner.userId,
    });
    const assertCurrentAuthority = authority(
      owner.userId,
      tenant.ownerMembership.membershipId,
      tenant.tenant.tenantId,
    );
    const created = harness.domains.createClaim({
      tenantId: tenant.tenant.tenantId,
      domain: 'acme.com',
      assertCurrentAuthority,
    });
    harness.txtAnswers = [[created.challenge.value]];
    const verified = await harness.domains.verifyClaim({
      tenantId: tenant.tenant.tenantId,
      claimId: created.claim.claimId,
      expectedRevision: created.claim.revision,
      assertCurrentAuthority,
    });
    harness.domains.updatePolicy({
      tenantId: tenant.tenant.tenantId,
      claimId: created.claim.claimId,
      enabled: true,
      requestRoleKey: 'member',
      expectedRevision: verified.policy.revision,
      assertCurrentAuthority,
    });
    const binding = harness.domains.prepareMailboxRequest({
      userId: applicant.userId,
      identityKind: 'session',
    })!;
    const delivery = harness.domains.createMailboxDelivery({
      ...binding,
      jobId: 'policy-replacement',
    })!;
    const completed = harness.domains.completeMailboxProof(delivery.rawToken);
    if (!('continuation' in completed)) throw new Error('Expected domain continuation');
    const identity = harness.domains.inspectAdmissionIdentity(completed.continuation)!;

    harness.onboarding.submitJoinRequest({
      userId: applicant.userId,
      tenantSlug: tenant.tenant.slug,
    });
    const generic = harness.onboarding.listJoinRequests({
      tenantId: tenant.tenant.tenantId,
      status: 'pending',
    }).requests[0]!;
    const admitted = harness.domains.admit({
      continuation: completed.continuation,
      identity,
    });
    expect(admitted.request.joinRequestId).toBe(generic.joinRequestId);
    const fixed = harness.onboarding.listJoinRequests({
      tenantId: tenant.tenant.tenantId,
      status: 'pending',
      approvalScope: assertCurrentAuthority([]).scope,
    }).requests[0]!;
    expect(fixed).toMatchObject({
      requestRevision: generic.requestRevision + 1,
      approvalPolicy: { roleSelection: { mode: 'fixed' } },
    });

    expect(() => harness.onboarding.approveJoinRequest({
      tenantId: tenant.tenant.tenantId,
      joinRequestId: generic.joinRequestId,
      expectedRequestRevision: generic.requestRevision,
      assertCurrentAuthority,
    })).toThrow('revision changed');
    expect(() => harness.onboarding.denyJoinRequest({
      tenantId: tenant.tenant.tenantId,
      joinRequestId: generic.joinRequestId,
      expectedRequestRevision: generic.requestRevision,
      assertCurrentAuthority,
    })).toThrow('revision changed');
    expect(() => harness.onboarding.approveJoinRequest({
      tenantId: tenant.tenant.tenantId,
      joinRequestId: generic.joinRequestId,
      expectedRequestRevision: fixed.requestRevision,
      roleKeys: ['member'],
      assertCurrentAuthority,
    })).toThrow('role fixed by the tenant policy');
  });

  test('requires explicit resubmission before using legacy-unbound provenance', async () => {
    const harness = await createAdmittedHarness();
    const tenantId = harness.tenant.tenant.tenantId;
    const joinRequestId = harness.admitted.request.joinRequestId;
    const blockedUntil = harness.now.value + harness.domains.config.deniedRetryCooldownMs;
    harness.db.prepare(`UPDATE _auth_domain_join_request_provenance
      SET source = 'legacy-unbound', request_revision = NULL, blocked_until = ?
      WHERE join_request_id = ?`).run(blockedUntil, joinRequestId);
    const unbound = harness.onboarding.listJoinRequests({
      tenantId,
      status: 'pending',
      approvalScope: harness.assertCurrentAuthority([]).scope,
    }).requests[0]!;
    expect(unbound.approvalPolicy).toMatchObject({
      canApprove: false,
      roleSelection: { mode: 'fixed' },
    });
    expect(() => harness.onboarding.approveJoinRequest({
      tenantId,
      joinRequestId,
      expectedRequestRevision: unbound.requestRevision,
      assertCurrentAuthority: harness.assertCurrentAuthority,
    })).toThrow('provenance must be refreshed');

    harness.onboarding.submitJoinRequest({
      userId: harness.applicantId,
      tenantSlug: harness.tenant.tenant.slug,
    });
    expect(harness.onboarding.listJoinRequests({
      tenantId,
      status: 'pending',
    }).requests[0]!.requestRevision).toBe(unbound.requestRevision);

    harness.now.value = blockedUntil;
    harness.onboarding.submitJoinRequest({
      userId: harness.applicantId,
      tenantSlug: harness.tenant.tenant.slug,
    });
    const refreshed = harness.onboarding.listJoinRequests({
      tenantId,
      status: 'pending',
      approvalScope: harness.assertCurrentAuthority([]).scope,
    }).requests[0]!;
    expect(refreshed).toMatchObject({
      requestRevision: unbound.requestRevision + 1,
      approvalPolicy: {
        canApprove: true,
        roleSelection: { mode: 'default' },
      },
    });
  });

  test('cleans bounded expired evidence while preserving live records and provenance', async () => {
    const harness = await createAdmittedHarness();
    const consumedProofId = (harness.db.prepare(`SELECT mailbox_proof_id
      FROM _auth_domain_join_request_provenance`).get() as {
      mailbox_proof_id: string;
    }).mailbox_proof_id;
    expect(rowCount(harness.db, '_auth_mailbox_proofs')).toBe(1);
    const binding = harness.domains.prepareMailboxRequest({
      userId: harness.applicantId,
      identityKind: 'session',
    })!;
    harness.domains.createMailboxDelivery({ ...binding, jobId: 'still-live' });

    expect(harness.domains.cleanupExpiredEvidence()).toEqual({
      mailboxTokens: 1,
      transactions: 1,
      mailboxProofs: 0,
    });
    expect(rowCount(harness.db, `_auth_domain_mailbox_tokens
      WHERE outbox_job_id = 'still-live'`)).toBe(1);
    expect(rowCount(harness.db, `_auth_mailbox_proofs
      WHERE proof_id = '${consumedProofId}'`)).toBe(1);

    harness.now.value += harness.domains.config.mailboxProofMaxAgeMs + 1;
    const freshBinding = harness.domains.prepareMailboxRequest({
      userId: harness.applicantId,
      identityKind: 'session',
    })!;
    harness.domains.createMailboxDelivery({ ...freshBinding, jobId: 'fresh' });
    const cleanup = harness.domains.cleanupExpiredEvidence();
    expect(cleanup).toEqual({ mailboxTokens: 1, transactions: 0, mailboxProofs: 1 });
    expect(rowCount(harness.db, `_auth_domain_mailbox_tokens
      WHERE outbox_job_id = 'fresh'`)).toBe(1);
    expect(rowCount(harness.db, `_auth_mailbox_proofs
      WHERE proof_id = '${consumedProofId}'`)).toBe(0);
    expect(harness.db.prepare(`SELECT mailbox_proof_id
      FROM _auth_domain_join_request_provenance`).get()).toEqual({
      mailbox_proof_id: null,
    });
  });

  test('retains ambiguous-success sibling links and uses attempt-specific delivery keys', async () => {
    const harness = await createHarness();
    const applicant = await createUser(
      harness,
      'ambiguous-applicant',
      'person@acme.com',
    );
    const binding = harness.domains.prepareMailboxRequest({
      userId: applicant.userId,
      identityKind: 'session',
    })!;
    const deliveries: Array<{ rawToken: string; deliveryId: string }> = [];
    let attempt = 0;
    const delivery = new AuthEmailOutboxDelivery({
      getVerifiedDomainOnboarding: () => harness.domains,
      email: {
        async sendDomainMailboxProof(input: {
          rawToken: string;
          deliveryId: string;
        }) {
          attempt += 1;
          deliveries.push({
            rawToken: input.rawToken,
            deliveryId: input.deliveryId,
          });
          if (attempt === 1) throw new Error('provider response lost after acceptance');
        },
      },
    } as unknown as AuthEmailOutboxDeliveryDeps);
    const job = (attempts: number): AuthEmailOutboxJob => ({
      jobId: 'ambiguous-job',
      kind: 'domain_mailbox_proof',
      recipient: binding.email,
      nativeContinuation: null,
      invitationId: null,
      secretEnvelope: null,
      domainUserId: binding.userId,
      domainEmailGeneration: binding.emailGeneration,
      domainAuthGeneration: binding.authGeneration,
      domainIdentityKind: binding.identityKind,
      domainIdentityContinuationId: binding.identityContinuationId,
      attempts,
      leaseOwner: 'worker',
    });

    await expect(delivery.deliver(job(1), new AbortController().signal)).rejects.toThrow();
    expect(rowCount(harness.db, `_auth_domain_mailbox_tokens
      WHERE outbox_job_id = 'ambiguous-job'`)).toBe(1);
    await expect(delivery.deliver(job(2), new AbortController().signal)).resolves.toEqual({
      status: 'delivered',
      userId: applicant.userId,
    });
    expect(deliveries).toEqual([
      expect.objectContaining({ deliveryId: 'ambiguous-job:1' }),
      expect.objectContaining({ deliveryId: 'ambiguous-job:2' }),
    ]);
    expect(deliveries[0]!.rawToken).not.toBe(deliveries[1]!.rawToken);
    expect(rowCount(harness.db, `_auth_domain_mailbox_tokens
      WHERE outbox_job_id = 'ambiguous-job'`)).toBe(2);

    // Either delivered link atomically invalidates every sibling.
    expect(harness.domains.completeMailboxProof(deliveries[0]!.rawToken)).toEqual({
      option: { action: 'unavailable' },
    });
    expect(harness.domains.completeMailboxProof(deliveries[1]!.rawToken)).toEqual({
      option: { action: 'unavailable' },
    });
    expect(rowCount(harness.db, `_auth_domain_mailbox_tokens
      WHERE outbox_job_id = 'ambiguous-job' AND consumed_at IS NOT NULL`)).toBe(2);
    expect(harness.domains.createMailboxDelivery({
      ...binding,
      jobId: 'ambiguous-job',
    })).toBeNull();
  });

  test('email changes invalidate bindings and attribution never strands user deletion', async () => {
    const harness = await createHarness();
    const owner = await createUser(harness, 'owner-delete', 'owner@platform.com');
    const attributed = await createUser(harness, 'claim-actor', 'actor@platform.com');
    const applicant = await createUser(harness, 'email-change', 'person@acme.com');
    const tenant = harness.tenancy.createTenant({
      name: 'Acme Delete',
      slug: 'acme-delete',
      ownerUserId: owner.userId,
    });
    const claim = harness.domains.createClaim({
      tenantId: tenant.tenant.tenantId,
      domain: 'acme.com',
      assertCurrentAuthority: authority(
        attributed.userId,
        tenant.ownerMembership.membershipId,
        tenant.tenant.tenantId,
      ),
    });
    harness.domains.releaseClaim({
      tenantId: tenant.tenant.tenantId,
      claimId: claim.claim.claimId,
      expectedRevision: claim.claim.revision,
      expectedPolicyRevision: claim.claim.policy.revision,
      confirmDomain: claim.claim.domain,
      assertCurrentAuthority: authority(
        attributed.userId,
        tenant.ownerMembership.membershipId,
        tenant.tenant.tenantId,
      ),
    });
    expect(new UserStore(harness.db, { tenancyMode: 'multi' })
      .deleteUser(attributed.userId)).toBe(true);
    expect(harness.db.prepare(`SELECT created_by, released_by
      FROM _auth_tenant_domain_claims
      WHERE claim_id = ?`).get(claim.claim.claimId)).toEqual({
      created_by: null,
      released_by: null,
    });
    expect(harness.db.prepare(`SELECT updated_by FROM _auth_tenant_domain_policies
      WHERE claim_id = ?`).get(claim.claim.claimId)).toEqual({ updated_by: null });

    const binding = harness.domains.prepareMailboxRequest({
      userId: applicant.userId,
      identityKind: 'session',
    })!;
    const before = harness.users.getEmailGeneration(applicant.userId);
    const delivery = harness.domains.createMailboxDelivery({
      ...binding,
      jobId: 'email-generation',
    })!;
    harness.users.updateUser(applicant.userId, { email: 'person@other-acme.com' });
    expect(harness.users.getEmailGeneration(applicant.userId)).toBe(before + 1);
    expect(harness.domains.completeMailboxProof(delivery.rawToken)).toEqual({
      option: { action: 'unavailable' },
    });
  });

  test('releases manual and background DNS leases on resolver outages', async () => {
    const harness = await createHarness();
    const owner = await createUser(harness, 'dns-owner', 'owner@platform.com');
    const tenant = harness.tenancy.createTenant({
      name: 'DNS', slug: 'dns', ownerUserId: owner.userId,
    });
    const assertCurrentAuthority = authority(
      owner.userId,
      tenant.ownerMembership.membershipId,
      tenant.tenant.tenantId,
    );
    const created = harness.domains.createClaim({
      tenantId: tenant.tenant.tenantId,
      domain: 'acme.com',
      assertCurrentAuthority,
    });
    const createdState = claimLease(harness.db, created.claim.claimId);
    harness.now.value += harness.domains.config.dnsCheckCooldownMs + 1;
    harness.txtError = Object.assign(new Error('servfail'), { code: 'ESERVFAIL' });
    await expect(harness.domains.verifyClaim({
      tenantId: tenant.tenant.tenantId,
      claimId: created.claim.claimId,
      expectedRevision: created.claim.revision,
      assertCurrentAuthority,
    })).rejects.toMatchObject({
      code: 'AUTH_DOMAIN_DNS_UNAVAILABLE',
      status: 503,
    });
    expect(claimLease(harness.db, created.claim.claimId)).toMatchObject({
      status: 'pending',
      revision: 1,
      last_checked_at: null,
      lease_owner: null,
      updated_at: createdState.updated_at,
    });

    const rotated = harness.domains.issueChallenge({
      tenantId: tenant.tenant.tenantId,
      claimId: created.claim.claimId,
      expectedRevision: created.claim.revision,
      assertCurrentAuthority,
    });
    harness.txtError = null;
    harness.txtAnswers = [[rotated.challenge.value]];
    const verified = await harness.domains.verifyClaim({
      tenantId: tenant.tenant.tenantId,
      claimId: created.claim.claimId,
      expectedRevision: rotated.claim.revision,
      assertCurrentAuthority,
    });
    harness.now.value += 1_000;
    harness.db.prepare(`UPDATE _auth_tenant_domain_claims SET next_check_at = ?
      WHERE claim_id = ?`).run(harness.now.value, created.claim.claimId);
    const before = claimLease(harness.db, created.claim.claimId);
    harness.txtError = Object.assign(new Error('timeout'), { code: 'ETIMEOUT' });
    expect(await harness.domains.processDueReverification(1)).toBe(1);
    const after = claimLease(harness.db, created.claim.claimId);
    expect(after).toMatchObject({
      status: 'verified',
      revision: before.revision,
      last_checked_at: verified.lastCheckedAt,
      lease_owner: null,
      next_check_at: harness.now.value
        + harness.domains.config.reverifyRetryIntervalMs,
      updated_at: before.updated_at,
    });
  });

  test('enforces the retained per-tenant claim ceiling transactionally', async () => {
    const harness = await createHarness({ maxClaimsPerTenant: 1 });
    const owner = await createUser(harness, 'limit-owner', 'owner@platform.com');
    const tenant = harness.tenancy.createTenant({
      name: 'Limit', slug: 'limit', ownerUserId: owner.userId,
    });
    const assertCurrentAuthority = authority(
      owner.userId,
      tenant.ownerMembership.membershipId,
      tenant.tenant.tenantId,
    );
    harness.domains.createClaim({
      tenantId: tenant.tenant.tenantId,
      domain: 'acme.com',
      assertCurrentAuthority,
    });
    expect(() => harness.domains.createClaim({
      tenantId: tenant.tenant.tenantId,
      domain: 'acme.net',
      assertCurrentAuthority,
    })).toThrow('claim limit reached');
    expect(rowCount(harness.db, '_auth_tenant_domain_claims')).toBe(1);
  });

  test('releases a claim atomically, retains immutable history, and rejects replay', async () => {
    const harness = await createAdmittedHarness();
    const releaseActor = await createUser(
      harness,
      'release-actor',
      'release-actor@platform.com',
    );
    const releaseAuthority = authority(
      releaseActor.userId,
      harness.tenant.ownerMembership.membershipId,
      harness.tenant.tenant.tenantId,
    );
    const secondApplicant = await createUser(
      harness,
      'release-outstanding',
      'second@acme.com',
    );
    const binding = harness.domains.prepareMailboxRequest({
      userId: secondApplicant.userId,
      identityKind: 'session',
    })!;
    const delivery = harness.domains.createMailboxDelivery({
      ...binding,
      jobId: 'release-outstanding',
    })!;
    const completion = harness.domains.completeMailboxProof(delivery.rawToken);
    if (!('continuation' in completion)) throw new Error('Expected outstanding admission');
    const identity = harness.domains.inspectAdmissionIdentity(completion.continuation)!;

    expect(() => harness.domains.releaseClaim({
      tenantId: harness.tenant.tenant.tenantId,
      claimId: harness.claim.claimId,
      expectedRevision: harness.claim.revision,
      expectedPolicyRevision: harness.claim.policy.revision,
      confirmDomain: 'ACME.COM',
      assertCurrentAuthority: releaseAuthority,
    })).toThrow('exact domain');
    expect(harness.domains.listClaims(harness.tenant.tenant.tenantId)).toHaveLength(1);

    const release = harness.domains.releaseClaim({
      tenantId: harness.tenant.tenant.tenantId,
      claimId: harness.claim.claimId,
      expectedRevision: harness.claim.revision,
      expectedPolicyRevision: harness.claim.policy.revision,
      confirmDomain: 'acme.com',
      assertCurrentAuthority: releaseAuthority,
      auditRequest: { requestId: 'request-domain-release' },
    }).release;
    expect(release).toEqual({
      claimId: harness.claim.claimId,
      domain: 'acme.com',
      releasedAt: harness.now.value,
      quarantineUntil: harness.now.value + VERIFIED_DOMAIN_RELEASE_QUARANTINE_MS,
    });
    expect(harness.domains.listClaims(harness.tenant.tenant.tenantId)).toEqual([]);
    expect(harness.db.prepare(`SELECT status, challenge_digest, challenge_expires_at,
      verification_digest, next_check_at, valid_until, lease_owner, lease_expires_at,
      released_at, released_by, quarantine_until
      FROM _auth_tenant_domain_claims WHERE claim_id = ?`).get(
      harness.claim.claimId,
    )).toEqual({
      status: 'lost',
      challenge_digest: null,
      challenge_expires_at: null,
      verification_digest: null,
      next_check_at: null,
      valid_until: null,
      lease_owner: null,
      lease_expires_at: null,
      released_at: release.releasedAt,
      released_by: releaseActor.userId,
      quarantine_until: release.quarantineUntil,
    });
    expect(harness.db.prepare(`SELECT enabled, request_role_key, revision
      FROM _auth_tenant_domain_policies WHERE claim_id = ?`).get(
      harness.claim.claimId,
    )).toEqual({ enabled: 0, request_role_key: null, revision: 3 });
    expect(harness.db.prepare(`SELECT status, reviewed_by
      FROM _auth_tenant_join_requests WHERE join_request_id = ?`).get(
      harness.admitted.request.joinRequestId,
    )).toEqual({ status: 'cancelled', reviewed_by: releaseActor.userId });
    expect(harness.db.prepare(`SELECT claim_id, domain, blocked_until
      FROM _auth_domain_join_request_provenance WHERE join_request_id = ?`).get(
      harness.admitted.request.joinRequestId,
    )).toEqual({
      claim_id: harness.claim.claimId,
      domain: 'acme.com',
      blocked_until: release.quarantineUntil,
    });
    expect(harness.db.prepare(`SELECT claim_id, join_request_id, domain,
      released_at, blocked_until, released_by
      FROM _auth_released_domain_join_provenance
      WHERE claim_id = ? AND join_request_id = ?`).get(
      harness.claim.claimId,
      harness.admitted.request.joinRequestId,
    )).toEqual({
      claim_id: harness.claim.claimId,
      join_request_id: harness.admitted.request.joinRequestId,
      domain: 'acme.com',
      released_at: release.releasedAt,
      blocked_until: release.quarantineUntil,
      released_by: releaseActor.userId,
    });
    expect(harness.domains.inspectAdmissionIdentity(completion.continuation)).toBeNull();
    expect(() => harness.domains.admit({
      continuation: completion.continuation,
      identity,
    })).toThrow('invalid or expired');
    expect(harness.audit.listTenant(harness.tenant.tenant.tenantId, {
      action: 'tenant.domain-claim-released',
    }).events[0]).toMatchObject({
      actorUserId: releaseActor.userId,
      requestId: 'request-domain-release',
      targetId: harness.claim.claimId,
      metadata: {
        'invalidated-transaction-count': 1,
        'cancelled-request-count': 1,
      },
    });

    expect(() => harness.db.prepare(`UPDATE _auth_tenant_domain_claims
      SET domain = 'changed.example' WHERE claim_id = ?`).run(
      harness.claim.claimId,
    )).toThrow('AUTH_RELEASED_DOMAIN_CLAIM_IMMUTABLE');
    expect(() => harness.db.prepare(`UPDATE _auth_released_domain_join_provenance
      SET domain = 'changed.example' WHERE join_request_id = ?`).run(
      harness.admitted.request.joinRequestId,
    )).toThrow('AUTH_RELEASED_DOMAIN_PROVENANCE_IMMUTABLE');
    try {
      new UserStore(harness.db, { tenancyMode: 'multi' }).deleteUser(releaseActor.userId);
      throw new Error('Expected retained join-review history to block deletion');
    } catch (error) {
      expect(error).toMatchObject({ code: 'USER_HAS_TENANT_HISTORY', status: 409 });
    }

    const reclaimed = harness.domains.createClaim({
      tenantId: harness.tenant.tenant.tenantId,
      domain: 'acme.com',
      assertCurrentAuthority: harness.assertCurrentAuthority,
    });
    expect(reclaimed.claim.claimId).not.toBe(harness.claim.claimId);
    expect(reclaimed.claim).toMatchObject({ domain: 'acme.com', status: 'pending' });
    harness.txtAnswers = [[reclaimed.challenge.value]];
    const reverified = await harness.domains.verifyClaim({
      tenantId: harness.tenant.tenant.tenantId,
      claimId: reclaimed.claim.claimId,
      expectedRevision: reclaimed.claim.revision,
      assertCurrentAuthority: harness.assertCurrentAuthority,
    });
    harness.domains.updatePolicy({
      tenantId: harness.tenant.tenant.tenantId,
      claimId: reclaimed.claim.claimId,
      enabled: true,
      requestRoleKey: 'member',
      expectedRevision: reverified.policy.revision,
      assertCurrentAuthority: harness.assertCurrentAuthority,
    });

    const blockedBinding = harness.domains.prepareMailboxRequest({
      userId: harness.applicantId,
      identityKind: 'session',
    })!;
    const blockedDelivery = harness.domains.createMailboxDelivery({
      ...blockedBinding,
      jobId: 'release-cooldown-blocked',
    })!;
    expect(harness.domains.completeMailboxProof(blockedDelivery.rawToken)).toEqual({
      option: { action: 'unavailable' },
    });

    harness.now.value = release.quarantineUntil;
    const retryBinding = harness.domains.prepareMailboxRequest({
      userId: harness.applicantId,
      identityKind: 'session',
    })!;
    const retryDelivery = harness.domains.createMailboxDelivery({
      ...retryBinding,
      jobId: 'release-cooldown-expired',
    })!;
    const retryCompletion = harness.domains.completeMailboxProof(retryDelivery.rawToken);
    if (!('continuation' in retryCompletion)) throw new Error('Expected cooldown retry');
    const retryIdentity = harness.domains.inspectAdmissionIdentity(
      retryCompletion.continuation,
    )!;
    const retried = harness.domains.admit({
      continuation: retryCompletion.continuation,
      identity: retryIdentity,
    });
    expect(retried.request.joinRequestId).toBe(harness.admitted.request.joinRequestId);
    expect(harness.db.prepare(`SELECT claim_id, blocked_until
      FROM _auth_domain_join_request_provenance WHERE join_request_id = ?`).get(
      retried.request.joinRequestId,
    )).toEqual({ claim_id: reclaimed.claim.claimId, blocked_until: null });
    expect(harness.db.prepare(`SELECT claim_id, domain
      FROM _auth_released_domain_join_provenance WHERE join_request_id = ?`).get(
      retried.request.joinRequestId,
    )).toEqual({ claim_id: harness.claim.claimId, domain: 'acme.com' });
    expect(new UserStore(harness.db, { tenancyMode: 'multi' })
      .deleteUser(releaseActor.userId)).toBe(true);
    expect(harness.db.prepare(`SELECT released_by FROM _auth_tenant_domain_claims
      WHERE claim_id = ?`).get(harness.claim.claimId)).toEqual({ released_by: null });
    expect(harness.db.prepare(`SELECT released_by
      FROM _auth_released_domain_join_provenance WHERE claim_id = ?`).get(
      harness.claim.claimId,
    )).toEqual({ released_by: null });
  });

  test('fails closed and emits the standard auth invariant when release provenance diverges', async () => {
    const events: Array<{
      code: string;
      metadata: Record<string, unknown> | undefined;
    }> = [];
    const emitCode: AuthPlatformCodeEmitter = (definition, options) => {
      events.push({ code: definition.code, metadata: options?.metadata });
      return emitPlatformCode(definition, options);
    };
    const harness = await createAdmittedHarness({ emitCode });
    harness.db.exec(`
      CREATE TEMP TRIGGER force_domain_release_snapshot_mismatch
      BEFORE UPDATE OF status ON _auth_tenant_join_requests
      WHEN OLD.status = 'pending' AND NEW.status = 'cancelled'
      BEGIN
        SELECT RAISE(IGNORE);
      END
    `);

    expect(() => harness.domains.releaseClaim({
      tenantId: harness.tenant.tenant.tenantId,
      claimId: harness.claim.claimId,
      expectedRevision: harness.claim.revision,
      expectedPolicyRevision: harness.claim.policy.revision,
      confirmDomain: harness.claim.domain,
      assertCurrentAuthority: harness.assertCurrentAuthority,
    })).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      status: 500,
      message: '[auth] Domain release provenance snapshot invariant failed.',
    }));
    expect(events).toContainEqual({
      code: OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code,
      metadata: {
        component: 'verified-domain-onboarding-service',
        invariant: 'release-provenance-snapshot-count',
      },
    });
    expect(harness.domains.listClaims(harness.tenant.tenant.tenantId)).toHaveLength(1);
    expect(harness.db.prepare(`SELECT status FROM _auth_tenant_join_requests
      WHERE join_request_id = ?`).get(harness.admitted.request.joinRequestId))
      .toEqual({ status: 'pending' });
    expect(rowCount(harness.db, '_auth_released_domain_join_provenance')).toBe(0);
  });

  test('quarantines a released domain across tenants for exactly seven days', async () => {
    const harness = await createHarness();
    const firstOwner = await createUser(harness, 'quarantine-owner-one', 'one@platform.com');
    const secondOwner = await createUser(harness, 'quarantine-owner-two', 'two@platform.com');
    const first = harness.tenancy.createTenant({
      name: 'First', slug: 'first-release', ownerUserId: firstOwner.userId,
    });
    const second = harness.tenancy.createTenant({
      name: 'Second', slug: 'second-release', ownerUserId: secondOwner.userId,
    });
    const firstAuthority = authority(
      firstOwner.userId,
      first.ownerMembership.membershipId,
      first.tenant.tenantId,
    );
    const secondAuthority = authority(
      secondOwner.userId,
      second.ownerMembership.membershipId,
      second.tenant.tenantId,
    );
    const claim = harness.domains.createClaim({
      tenantId: first.tenant.tenantId,
      domain: 'acme.net',
      assertCurrentAuthority: firstAuthority,
    }).claim;
    harness.domains.releaseClaim({
      tenantId: first.tenant.tenantId,
      claimId: claim.claimId,
      expectedRevision: claim.revision,
      expectedPolicyRevision: claim.policy.revision,
      confirmDomain: claim.domain,
      assertCurrentAuthority: firstAuthority,
    });

    try {
      harness.domains.createClaim({
        tenantId: second.tenant.tenantId,
        domain: claim.domain,
        assertCurrentAuthority: secondAuthority,
      });
      throw new Error('Expected cross-tenant quarantine');
    } catch (error) {
      expect(error).toMatchObject({ code: 'AUTH_DOMAIN_UNAVAILABLE', status: 409 });
    }
    harness.now.value += VERIFIED_DOMAIN_RELEASE_QUARANTINE_MS;
    const claimed = harness.domains.createClaim({
      tenantId: second.tenant.tenantId,
      domain: claim.domain,
      assertCurrentAuthority: secondAuthority,
    });
    expect(claimed.claim).toMatchObject({ domain: 'acme.net', status: 'pending' });
  });

  test('serializes competing file-backed runtimes and rejects stale release replay', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-domain-release-race-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'shared.sqlite');
    const firstDb = createReactiveDB({
      mode: 'file', path, clearChangesOnStart: false, busyTimeout: 10_000,
    });
    const secondDb = createReactiveDB({
      mode: 'file', path, clearChangesOnStart: false, busyTimeout: 10_000,
    });
    active.push(firstDb, secondDb);
    for (const db of [firstDb, secondDb]) {
      defineAuthTables(db);
      defineTenancyTables(db);
      defineAuthTenantOnboardingTables(db);
      defineAuthAuditTables(db);
    }
    const auth = resolveAuthBehaviorConfig({
      tenancy: {
        mode: 'multi',
        onboarding: {
          verifiedDomains: { enabled: true, resolveTxt: async () => [] },
        },
      },
      authorization: 'simple',
      registration: { mode: 'disabled' },
    });
    const kernel = createAuthorizationKernel({
      tenancy: auth.tenancy,
      authorization: auth.authorization,
      userProperties: auth.userProperties,
    });
    const firstUsers = new UserStore(firstDb);
    const firstTenancy = new TenancyService(new TenantStore(firstDb));
    const secondTenancy = new TenancyService(new TenantStore(secondDb));
    const now = { value: 1_700_000_000_000 };
    const firstService = new VerifiedDomainOnboardingService(
      firstDb,
      auth.tenancy.onboarding!.verifiedDomains,
      kernel,
      firstUsers,
      firstTenancy,
      'application_test',
      () => now.value,
    );
    const secondService = new VerifiedDomainOnboardingService(
      secondDb,
      auth.tenancy.onboarding!.verifiedDomains,
      kernel,
      new UserStore(secondDb),
      secondTenancy,
      'application_test',
      () => now.value,
    );
    const firstOwner = await firstUsers.createUser({
      username: 'race-domain-owner-one',
      email: 'race-one@platform.com',
      password: 'password123',
      role: 'admin',
      status: 'active',
      emailVerifiedAt: now.value,
    });
    const secondOwner = await firstUsers.createUser({
      username: 'race-domain-owner-two',
      email: 'race-two@platform.com',
      password: 'password123',
      role: 'admin',
      status: 'active',
      emailVerifiedAt: now.value,
    });
    const firstTenant = firstTenancy.createTenant({
      name: 'Race One', slug: 'race-domain-one', ownerUserId: firstOwner.userId,
    });
    const secondTenant = firstTenancy.createTenant({
      name: 'Race Two', slug: 'race-domain-two', ownerUserId: secondOwner.userId,
    });
    const firstAuthority = authority(
      firstOwner.userId,
      firstTenant.ownerMembership.membershipId,
      firstTenant.tenant.tenantId,
    );
    const secondAuthority = authority(
      secondOwner.userId,
      secondTenant.ownerMembership.membershipId,
      secondTenant.tenant.tenantId,
    );
    const original = firstService.createClaim({
      tenantId: firstTenant.tenant.tenantId,
      domain: 'acme.org',
      assertCurrentAuthority: firstAuthority,
    }).claim;
    firstService.releaseClaim({
      tenantId: firstTenant.tenant.tenantId,
      claimId: original.claimId,
      expectedRevision: original.revision,
      expectedPolicyRevision: original.policy.revision,
      confirmDomain: original.domain,
      assertCurrentAuthority: firstAuthority,
    });
    now.value += VERIFIED_DOMAIN_RELEASE_QUARANTINE_MS;

    const competing = await Promise.allSettled([
      Promise.resolve().then(() => firstService.createClaim({
        tenantId: firstTenant.tenant.tenantId,
        domain: original.domain,
        assertCurrentAuthority: firstAuthority,
      })),
      Promise.resolve().then(() => secondService.createClaim({
        tenantId: secondTenant.tenant.tenantId,
        domain: original.domain,
        assertCurrentAuthority: secondAuthority,
      })),
    ]);
    expect(competing.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(competing.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const winner = competing.find((result) => result.status === 'fulfilled');
    if (!winner || winner.status !== 'fulfilled') throw new Error('Expected one winner');
    expect(rowCount(firstDb, `_auth_tenant_domain_claims
      WHERE domain = 'acme.org' AND released_at IS NULL`)).toBe(1);

    const winningClaim = winner.value.claim;
    const winningTenant = winningClaim.claimId === firstService.listClaims(
      firstTenant.tenant.tenantId,
    )[0]?.claimId ? firstTenant : secondTenant;
    const winningService = winningTenant === firstTenant ? firstService : secondService;
    const winningAuthority = winningTenant === firstTenant ? firstAuthority : secondAuthority;
    const releaseInput = {
      tenantId: winningTenant.tenant.tenantId,
      claimId: winningClaim.claimId,
      expectedRevision: winningClaim.revision,
      expectedPolicyRevision: winningClaim.policy.revision,
      confirmDomain: winningClaim.domain,
      assertCurrentAuthority: winningAuthority,
    };
    const releaseRace = await Promise.allSettled([
      Promise.resolve().then(() => winningService.releaseClaim(releaseInput)),
      Promise.resolve().then(() => (
        winningService === firstService ? secondService : firstService
      ).releaseClaim(releaseInput)),
    ]);
    expect(releaseRace.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(releaseRace.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(rowCount(firstDb, `_auth_tenant_domain_claims
      WHERE domain = 'acme.org' AND released_at IS NULL`)).toBe(0);
    expect(rowCount(firstDb, `_auth_tenant_domain_claims
      WHERE domain = 'acme.org' AND released_at IS NOT NULL`)).toBe(2);
  });
});

interface Harness {
  db: ReactiveDB;
  users: UserStore;
  tenancy: TenancyService;
  onboarding: AuthTenantOnboardingService;
  domains: VerifiedDomainOnboardingService;
  audit: AuthAuditService;
  now: { value: number };
  txtAnswers: readonly (readonly string[])[];
  txtError: unknown | null;
  lastTxtName: string | null;
}

interface HarnessOptions {
  maxClaimsPerTenant?: number;
  emitCode?: AuthPlatformCodeEmitter;
}

async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const db = createReactiveDB({ mode: 'memory' });
  active.push(db);
  defineAuthTables(db);
  defineTenancyTables(db);
  defineAuthAuditTables(db);
  const now = { value: 1_700_000_000_000 };
  const harness = {
    db,
    now,
    txtAnswers: [] as readonly (readonly string[])[],
    txtError: null as unknown | null,
    lastTxtName: null as string | null,
  };
  const auth = resolveAuthBehaviorConfig({
    tenancy: {
      mode: 'multi',
      onboarding: {
        verifiedDomains: {
          enabled: true,
          resolveTxt: async (hostname) => {
            harness.lastTxtName = hostname;
            if (harness.txtError) throw harness.txtError;
            return harness.txtAnswers;
          },
          maxClaimsPerTenant: options.maxClaimsPerTenant,
        },
      },
    },
    authorization: 'simple',
    registration: { mode: 'disabled' },
  });
  // This transport-neutral harness creates identities directly; runtime
  // registration tests separately cover atomic multi-tenant bootstrap.
  const users = new UserStore(db);
  const tenancy = new TenancyService(new TenantStore(db));
  const kernel = createAuthorizationKernel({
    tenancy: auth.tenancy,
    authorization: auth.authorization,
    userProperties: auth.userProperties,
  });
  const audit = new AuthAuditService(db, resolveAuthAuditConfig(undefined));
  const onboarding = new AuthTenantOnboardingService(
    db,
    auth.tenancy.onboarding!,
    kernel,
    users,
    new UserPropertyService(auth),
    tenancy,
    null,
    audit,
    () => now.value,
  );
  const domains = new VerifiedDomainOnboardingService(
    db,
    auth.tenancy.onboarding!.verifiedDomains,
    kernel,
    users,
    tenancy,
    'application_test',
    () => now.value,
    audit,
    options.emitCode,
  );
  return Object.assign(harness, { users, tenancy, onboarding, domains, audit });
}

async function createAdmittedHarness(options: HarnessOptions = {}) {
  const harness = await createHarness(options);
  const owner = await createUser(harness, 'cleanup-owner', 'owner@platform.com');
  const applicant = await createUser(harness, 'cleanup-applicant', 'person@acme.com');
  const tenant = harness.tenancy.createTenant({
    name: 'Cleanup',
    slug: 'cleanup',
    ownerUserId: owner.userId,
  });
  const assertCurrentAuthority = authority(
    owner.userId,
    tenant.ownerMembership.membershipId,
    tenant.tenant.tenantId,
  );
  const created = harness.domains.createClaim({
    tenantId: tenant.tenant.tenantId,
    domain: 'acme.com',
    assertCurrentAuthority,
  });
  harness.txtAnswers = [[created.challenge.value]];
  const verified = await harness.domains.verifyClaim({
    tenantId: tenant.tenant.tenantId,
    claimId: created.claim.claimId,
    expectedRevision: created.claim.revision,
    assertCurrentAuthority,
  });
  const enabled = harness.domains.updatePolicy({
    tenantId: tenant.tenant.tenantId,
    claimId: created.claim.claimId,
    enabled: true,
    requestRoleKey: 'member',
    expectedRevision: verified.policy.revision,
    assertCurrentAuthority,
  });
  const binding = harness.domains.prepareMailboxRequest({
    userId: applicant.userId,
    identityKind: 'session',
  })!;
  const delivery = harness.domains.createMailboxDelivery({
    ...binding,
    jobId: 'consumed',
  })!;
  const completed = harness.domains.completeMailboxProof(delivery.rawToken);
  if (!('continuation' in completed)) throw new Error('Expected admission');
  const identity = harness.domains.inspectAdmissionIdentity(completed.continuation)!;
  const admitted = harness.domains.admit({ continuation: completed.continuation, identity });
  return Object.assign(harness, {
    applicantId: applicant.userId,
    ownerId: owner.userId,
    tenant,
    assertCurrentAuthority,
    claim: enabled,
    admitted,
  });
}

async function createUser(harness: Pick<Harness, 'users'>, key: string, email: string) {
  return harness.users.createUser({
    username: key,
    email,
    password: 'password123',
    role: key.includes('owner') ? 'admin' : 'user',
    status: 'active',
    emailVerifiedAt: 1_700_000_000_000,
  });
}

function authority(
  userId: string,
  membershipId: string,
  tenantId: string,
): AssertAuthTenantMutationAuthority {
  return () => ({
    auth: { userId, email: `${userId}@platform.com`, role: 'admin' },
    scope: {
      tenancy: 'multi',
      mode: 'simple',
      scopeKind: 'tenant',
      scopeId: tenantId,
      tenantId,
      membershipId,
      roles: ['owner'],
      permissions: [],
      allPermissions: true,
      revision: 'test',
    },
  });
}

function rowCount(db: ReactiveDB, from: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${from}`).get() as {
    count: number;
  }).count;
}

function claimLease(db: ReactiveDB, claimId: string) {
  return db.prepare(`SELECT status, revision, last_checked_at, next_check_at,
    lease_owner, lease_expires_at, updated_at FROM _auth_tenant_domain_claims
    WHERE claim_id = ?`).get(claimId) as {
    status: string;
    revision: number;
    last_checked_at: number | null;
    next_check_at: number | null;
    lease_owner: string | null;
    lease_expires_at: number | null;
    updated_at: number;
  };
}
