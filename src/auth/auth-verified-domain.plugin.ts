/** Elysia boundary for exact verified-domain administration and onboarding. */

import { Elysia, t } from 'elysia';
import { createRequestAuthorizationAccess } from './authorization-access';
import type { AuthorizationKernel, AuthorizationScopeSnapshot } from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import { extractAuthContext } from './auth-context';
import { admitAuthRequest } from './auth-request-admission';
import type { AuthRequestAdmissionService } from './auth-request-admission-service';
import type { AuthTenantSessionService } from './auth-tenant-session-service';
import type { AuthSessionContinuationRecord } from './auth-session-continuation-store';
import {
  captureAuthTenantMutationAuthority,
  type AssertAuthTenantMutationAuthority,
} from './auth-tenant-mutation-authority';
import type { AccountEmailService } from './account-email-service';
import type { AuthEmailOutbox } from './auth-email-outbox';
import type { TokenService } from './token-service';
import { AuthError, type AuthContext } from './types';
import type { UserStore } from './user-store';
import type {
  DomainAdmissionIdentityBinding,
  VerifiedDomainOnboardingService,
} from './verified-domain-service';
import { authAuditRequestFromRequest } from './auth-audit-service';
import { applyAuthPrivateNoStore } from './auth-response-cache';
import { captureAuthSessionIdentityProof } from './auth-session-identity-proof';

const idSchema = t.String({
  minLength: 1,
  maxLength: 200,
  pattern: '^[A-Za-z0-9_-]+$',
});
const revisionSchema = t.String({ minLength: 1, maxLength: 100 });
const continuationSchema = t.String({ minLength: 1, maxLength: 512 });

export interface AuthVerifiedDomainPluginConfig {
  getService: () => VerifiedDomainOnboardingService | null;
  getUserStore: () => UserStore | null;
  getTokenService: () => TokenService | null;
  getTenantSessionService: () => AuthTenantSessionService | null;
  getRequestAdmissionService: () => AuthRequestAdmissionService | null;
  getAuthorizationKernel: () => AuthorizationKernel;
  getAuthorizationRoleService: () => AuthorizationRoleService | null;
  getAccountEmailService: () => AccountEmailService | null;
  getAuthEmailOutbox: () => AuthEmailOutbox | null;
}

interface TenantActor {
  auth: AuthContext;
  scope: AuthorizationScopeSnapshot & {
    scopeKind: 'tenant';
    tenantId: string;
    membershipId: string;
  };
  access: ReturnType<typeof createRequestAuthorizationAccess>;
  service: VerifiedDomainOnboardingService;
  assertCurrentAuthority: AssertAuthTenantMutationAuthority;
}

export function createAuthVerifiedDomainPlugin(
  config: AuthVerifiedDomainPluginConfig,
) {
  return new Elysia({ name: 'auth-verified-domain' })
    .get('/tenant/domains', async ({ request, set }) => {
      applyAuthPrivateNoStore(set);
      const actor = await requireTenantActor(config, request);
      actor.access.requirePermission('tenant.domains:read');
      return {
        actor: {
          capabilities: {
            canReadDomains: true,
            canCreateDomains: actor.access.hasPermission('tenant.domains:verify'),
            canVerifyDomains: actor.access.hasPermission('tenant.domains:verify'),
            canManagePolicy: actor.access.hasPermission('tenant.onboarding:manage'),
            canReleaseDomains: actor.access.hasPermission('tenant.domains:release'),
          },
        },
        requestRoles: actor.service.requestRoles,
        claims: actor.service.listClaims(actor.scope.tenantId),
      };
    })
    .post('/tenant/domains', async ({ request, body }) => {
      const actor = await requireTenantActor(config, request);
      actor.access.requirePermission('tenant.domains:verify');
      return actor.service.createClaim({
        tenantId: actor.scope.tenantId,
        domain: body.domain,
        assertCurrentAuthority: actor.assertCurrentAuthority,
        auditRequest: authAuditRequestFromRequest(request),
      });
    }, {
      body: t.Object({
        domain: t.String({ minLength: 1, maxLength: 254 }),
      }, { additionalProperties: false }),
    })
    .post('/tenant/domains/:claimId/challenges', async ({ request, params, body }) => {
      const actor = await requireTenantActor(config, request);
      actor.access.requirePermission('tenant.domains:verify');
      return actor.service.issueChallenge({
        tenantId: actor.scope.tenantId,
        claimId: params.claimId,
        expectedRevision: body.expectedRevision,
        assertCurrentAuthority: actor.assertCurrentAuthority,
        auditRequest: authAuditRequestFromRequest(request),
      });
    }, {
      params: t.Object({ claimId: idSchema }, { additionalProperties: false }),
      body: t.Object({ expectedRevision: revisionSchema }, { additionalProperties: false }),
    })
    .post('/tenant/domains/:claimId/verify', async ({ request, params, body }) => {
      const actor = await requireTenantActor(config, request);
      actor.access.requirePermission('tenant.domains:verify');
      return {
        claim: await actor.service.verifyClaim({
          tenantId: actor.scope.tenantId,
          claimId: params.claimId,
          expectedRevision: body.expectedRevision,
          assertCurrentAuthority: actor.assertCurrentAuthority,
          auditRequest: authAuditRequestFromRequest(request),
        }),
      };
    }, {
      params: t.Object({ claimId: idSchema }, { additionalProperties: false }),
      body: t.Object({ expectedRevision: revisionSchema }, { additionalProperties: false }),
    })
    .patch('/tenant/domains/:claimId/policy', async ({ request, params, body }) => {
      const actor = await requireTenantActor(config, request);
      actor.access.requirePermission('tenant.onboarding:manage');
      return {
        claim: actor.service.updatePolicy({
          tenantId: actor.scope.tenantId,
          claimId: params.claimId,
          enabled: body.enabled,
          requestRoleKey: body.requestRoleKey,
          expectedRevision: body.expectedRevision,
          assertCurrentAuthority: actor.assertCurrentAuthority,
          auditRequest: authAuditRequestFromRequest(request),
        }),
      };
    }, {
      params: t.Object({ claimId: idSchema }, { additionalProperties: false }),
      body: t.Object({
        enabled: t.Boolean(),
        requestRoleKey: t.Union([
          t.Null(),
          t.String({
            minLength: 1,
            maxLength: 64,
            pattern: '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$',
          }),
        ]),
        expectedRevision: revisionSchema,
      }, { additionalProperties: false }),
    })
    .post('/tenant/domains/:claimId/release', async ({ request, params, body }) => {
      const actor = await requireTenantActor(config, request);
      actor.access.requirePermission('tenant.domains:release');
      return actor.service.releaseClaim({
        tenantId: actor.scope.tenantId,
        claimId: params.claimId,
        expectedRevision: body.expectedRevision,
        expectedPolicyRevision: body.expectedPolicyRevision,
        confirmDomain: body.confirmDomain,
        assertCurrentAuthority: actor.assertCurrentAuthority,
        auditRequest: authAuditRequestFromRequest(request),
      });
    }, {
      params: t.Object({ claimId: idSchema }, { additionalProperties: false }),
      body: t.Object({
        expectedRevision: revisionSchema,
        expectedPolicyRevision: revisionSchema,
        confirmDomain: t.String({ minLength: 1, maxLength: 254 }),
      }, { additionalProperties: false }),
    })
    .post('/onboarding/domain/start', async ({ request, server, body }) => {
      admitAuthRequest({
        service: config.getRequestAdmissionService(),
        request,
        peerAddress: server?.requestIP(request)?.address,
        flow: 'domain-onboarding',
        subject: body.identityContinuation,
      });
      // Everything after admission is deliberately suppression-safe. Neither
      // an invalid identity nor an ineligible/unclaimed domain changes shape.
      try {
        const service = requireService(config);
        const identity = await resolveStartIdentity(config, request, body.identityContinuation);
        if (identity) {
          const binding = service.prepareMailboxRequest(identity);
          if (binding) {
            config.getAccountEmailService()?.assertReady();
            config.getAuthEmailOutbox()?.enqueueDomainMailboxProof(binding);
          }
        }
      } catch {
        // Do not turn delivery, identity, account, or domain state into an oracle.
      }
      return { accepted: true as const };
    }, {
      body: t.Object({
        identityContinuation: t.Optional(continuationSchema),
      }, { additionalProperties: false }),
    })
    .post('/onboarding/domain/complete', ({ request, server, body }) => {
      admitAuthRequest({
        service: config.getRequestAdmissionService(),
        request,
        peerAddress: server?.requestIP(request)?.address,
        flow: 'domain-onboarding',
        subject: body.proofToken,
      });
      return requireService(config).completeMailboxProof(body.proofToken);
    }, {
      body: t.Object({
        proofToken: t.String({ minLength: 40, maxLength: 200 }),
      }, { additionalProperties: false }),
    })
    .post('/onboarding/domain/admit', async ({ request, server, body, set }) => {
      admitAuthRequest({
        service: config.getRequestAdmissionService(),
        request,
        peerAddress: server?.requestIP(request)?.address,
        flow: 'domain-onboarding',
        subject: body.continuation,
      });
      const service = requireService(config);
      const binding = service.inspectAdmissionIdentity(body.continuation);
      if (!binding) throw invalidProof();
      const identity = await resolveAdmissionIdentity(
        config,
        request,
        binding,
        body.identityContinuation,
      );
      const result = service.admit({
        continuation: body.continuation,
        identity: binding,
        consumeIdentity: identity.consume,
      });
      set.status = 202;
      return result;
    }, {
      body: t.Object({
        continuation: continuationSchema,
        identityContinuation: t.Optional(continuationSchema),
      }, { additionalProperties: false }),
    });
}

async function requireTenantActor(
  config: AuthVerifiedDomainPluginConfig,
  request: Request,
): Promise<TenantActor> {
  const service = requireService(config);
  const store = requireStore(config);
  const tokens = requireTokens(config);
  const kernel = config.getAuthorizationKernel();
  if (kernel.tenancy.mode !== 'multi') throw unavailableError();
  const auth = await extractAuthContext(request, tokens);
  if (!auth) throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
  const access = createRequestAuthorizationAccess({
    authContext: auth,
    kernel,
    propertyStore: store,
    roleAssignments: config.getAuthorizationRoleService(),
  });
  const scope = access.requireTenant();
  return {
    auth,
    scope,
    access,
    service,
    assertCurrentAuthority: captureAuthTenantMutationAuthority({
      auth,
      tokenService: tokens,
      kernel,
      store,
      roles: config.getAuthorizationRoleService(),
    }),
  };
}

async function resolveStartIdentity(
  config: AuthVerifiedDomainPluginConfig,
  request: Request,
  rawContinuation: string | undefined,
): Promise<null | {
  userId: string;
  identityKind: 'session' | 'continuation';
  identityContinuation?: AuthSessionContinuationRecord;
}> {
  if (request.headers.has('authorization')) {
    if (rawContinuation) return null;
    const auth = await extractAuthContext(request, requireTokens(config));
    return auth ? { userId: auth.userId, identityKind: 'session' } : null;
  }
  if (!rawContinuation) return null;
  const record = config.getTenantSessionService()?.continuations.inspect(
    rawContinuation,
    'tenant_onboarding',
  );
  if (!record) return null;
  return {
    userId: record.userId,
    identityKind: 'continuation',
    identityContinuation: record,
  };
}

async function resolveAdmissionIdentity(
  config: AuthVerifiedDomainPluginConfig,
  request: Request,
  binding: DomainAdmissionIdentityBinding,
  rawContinuation: string | undefined,
): Promise<{ consume?: () => boolean }> {
  const store = requireStore(config);
  if (binding.identityKind === 'session') {
    if (rawContinuation) throw invalidProof();
    const tokens = requireTokens(config);
    const auth = await extractAuthContext(request, tokens);
    if (!auth || auth.userId !== binding.userId
      || store.getAuthGeneration(auth.userId) !== binding.authGeneration) {
      throw invalidProof();
    }
    return { consume: captureAuthSessionIdentityProof(auth, tokens) };
  }
  if (!rawContinuation) throw invalidProof();
  const continuations = config.getTenantSessionService()?.continuations;
  const record = continuations?.inspect(rawContinuation, 'tenant_onboarding');
  if (!record || record.continuationId !== binding.identityContinuationId
    || record.userId !== binding.userId
    || record.authGeneration !== binding.authGeneration
    || record.applicationId !== requireService(config).applicationId) {
    throw invalidProof();
  }
  return {
    consume: () => continuations!.consumeInspected(
      record,
      'tenant_onboarding',
      record.userId,
      record.authGeneration,
    ),
  };
}

function requireService(config: AuthVerifiedDomainPluginConfig) {
  const service = config.getService();
  if (!service) throw unavailableError();
  return service;
}

function requireStore(config: AuthVerifiedDomainPluginConfig) {
  const store = config.getUserStore();
  if (!store) throw notReady();
  return store;
}

function requireTokens(config: AuthVerifiedDomainPluginConfig) {
  const tokens = config.getTokenService();
  if (!tokens) throw notReady();
  return tokens;
}

function invalidProof(): AuthError {
  return new AuthError(
    'Domain onboarding proof is invalid or expired',
    'AUTH_DOMAIN_ONBOARDING_PROOF_INVALID',
    400,
  );
}

function unavailableError(): AuthError {
  return new AuthError(
    'Verified-domain onboarding is unavailable',
    'AUTH_DOMAIN_ONBOARDING_UNAVAILABLE',
    404,
  );
}

function notReady(): AuthError {
  return new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
}
