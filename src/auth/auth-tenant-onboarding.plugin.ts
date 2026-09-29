/** Tenant-scoped invitation review plus public/pre-session onboarding routes. */

import { Elysia, t } from 'elysia';
import { parseTokenTTL } from '../tokens/token-utils';
import { createRequestAuthorizationAccess } from './authorization-access';
import type { AuthorizationKernel, AuthorizationScopeSnapshot } from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import { extractAuthContext } from './auth-context';
import { canonicalEmailSchema } from './auth-email-schema';
import {
  buildAuthCompletionResponse,
} from './auth-mfa-response';
import type { MfaChallengeService } from './mfa-challenge-service';
import { admitAuthRequest } from './auth-request-admission';
import {
  authDisplayNameSchema,
  authNewPasswordSchema,
  authUsernameSchema,
} from './auth-request-schema';
import type { AuthRequestAdmissionService } from './auth-request-admission-service';
import type { AuthTenantSessionService } from './auth-tenant-session-service';
import type { AuthTenantOnboardingService } from './auth-tenant-onboarding-service';
import {
  captureAuthTenantMutationAuthority,
  type AssertAuthTenantMutationAuthority,
} from './auth-tenant-mutation-authority';
import type { AuthEmailOutbox } from './auth-email-outbox';
import type { AccountEmailService } from './account-email-service';
import { syncPageSessionCookie } from './page-session';
import type { TokenService } from './token-service';
import type { UserPropertyService } from './user-property-service';
import type { UserStore } from './user-store';
import { AuthError, type AuthContext, type ResolvedAuthBehaviorConfig } from './types';
import {
  authAuditActorFromContext,
  authAuditRequestFromRequest,
} from './auth-audit-service';
import type { AuthAuditActor } from './auth-audit-types';
import { applyAuthPrivateNoStore } from './auth-response-cache';
import { captureAuthSessionIdentityAdmission } from './auth-session-identity-proof';

const idSchema = t.String({
  minLength: 1,
  maxLength: 200,
  pattern: '^[A-Za-z0-9_-]+$',
});
const roleKeySchema = t.String({
  minLength: 1,
  maxLength: 64,
  pattern: '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$',
});
const rolesSchema = t.Array(roleKeySchema, {
  minItems: 1,
  maxItems: 32,
  uniqueItems: true,
});
const invitationTokenSchema = t.String({
  minLength: 45,
  maxLength: 200,
  pattern: '^zinv_[A-Za-z0-9_-]+$',
});
const continuationSchema = t.String({ minLength: 1, maxLength: 512 });

export interface AuthTenantOnboardingPluginConfig {
  getService: () => AuthTenantOnboardingService | null;
  getUserStore: () => UserStore | null;
  getTokenService: () => TokenService | null;
  getPropertyService: () => UserPropertyService | null;
  getTenantSessionService: () => AuthTenantSessionService | null;
  getMfaChallengeService: () => MfaChallengeService | null;
  getRequestAdmissionService: () => AuthRequestAdmissionService | null;
  getAuthorizationKernel: () => AuthorizationKernel;
  getAuthorizationRoleService: () => AuthorizationRoleService | null;
  getAuthConfig: () => ResolvedAuthBehaviorConfig;
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
  service: AuthTenantOnboardingService;
  assertCurrentAuthority: AssertAuthTenantMutationAuthority;
}

interface IdentityProof {
  userId: string;
  /** Exact generation proven by the admitted session or continuation. */
  authGeneration: number;
  /** Live server-derived assurance from the admitted bearer/continuation. */
  mfaVerifiedAt: number | null;
  consume?: () => boolean;
  auditActor: AuthAuditActor;
}

/** Mount below the root `/auth` plugin. */
export function createAuthTenantOnboardingPlugin(
  config: AuthTenantOnboardingPluginConfig,
) {
  return new Elysia({ name: 'auth-tenant-onboarding' })
    .post('/invitations/inspect', ({ body, request, server }) => {
      admitAuthRequest({
        service: config.getRequestAdmissionService(),
        request,
        peerAddress: server?.requestIP(request)?.address,
        flow: 'invitation',
        subject: body.token,
      });
      return requireService(config).inspectInvitation(body.token);
    }, {
      body: t.Object({ token: invitationTokenSchema }, { additionalProperties: false }),
    })
    .post('/invitations/accept', async ({ body, request, server, set }) => {
      admitAuthRequest({
        service: config.getRequestAdmissionService(),
        request,
        peerAddress: server?.requestIP(request)?.address,
        flow: 'invitation',
        subject: body.token,
      });
      const service = requireService(config);
      const store = requireStore(config);
      const tenantSessions = requireTenantSessions(config);
      const authConfig = config.getAuthConfig();
      let accepted;
      let requestedMfaSetup = false;
      let acceptedMfaVerifiedAt: number | null = null;

      if ('username' in body) {
        requestedMfaSetup = Boolean(body.mfaEnrollment) && authConfig.mfa.enabled;
        const inspection = service.inspectInvitation(body.token);
        const administrationMfaSetup = authConfig.mfa.enabled
          && authConfig.mfa.policy === 'admin-required'
          && inspection.available
          && inspection.tenant.kind === 'administration';
        const account = await service.createInvitationAccount({
          token: body.token,
          username: body.username,
          email: body.email,
          password: body.password,
          firstName: body.firstName,
          lastName: body.lastName,
          mfaRequired: requiresUserMfa(authConfig),
          properties: requireProperties(config).getDefaultProperties(),
          auditRequest: authAuditRequestFromRequest(request),
          deferAcceptance: requiresUserMfa(authConfig)
            || requestedMfaSetup
            || administrationMfaSetup,
        });
        if ('invitationAcceptancePending' in account) {
          const completion = await buildAuthCompletionResponse({
            user: account.user,
            tokenService: requireTokenService(config),
            authConfig,
            mfaChallengeService: config.getMfaChallengeService(),
            tenantSessionService: tenantSessions,
            requestedMfaSetup: requestedMfaSetup || administrationMfaSetup,
            expectedAuthGeneration: account.authGeneration,
          });
          const pending = {
            ...completion,
            invitationAcceptancePending: true as const,
          };
          await syncPageSessionCookie(
            set,
            request,
            requireTokenService(config),
            pending,
            { clearWhenMissing: true },
          );
          return pending;
        }
        accepted = account;
      } else {
        const identity = await resolveIdentityProof(config, request, body);
        acceptedMfaVerifiedAt = identity.mfaVerifiedAt;
        accepted = service.acceptInvitationForUser(
          body.token,
          identity.userId,
          identity.consume,
          {
            actor: identity.auditActor,
            request: authAuditRequestFromRequest(request),
          },
          identity.authGeneration,
        );
      }

      // Membership acceptance can create application authority. Re-enter the
      // complete MFA decision after that write so admin-required policy sees
      // the live administration-organization role before any session is minted.
      const response = await buildAuthCompletionResponse({
        user: accepted.user,
        tokenService: requireTokenService(config),
        authConfig,
        mfaChallengeService: config.getMfaChallengeService(),
        tenantSessionService: tenantSessions,
        mfaVerifiedAt: acceptedMfaVerifiedAt,
        expectedAuthGeneration: accepted.authGeneration,
        sessionBinding: {
          tenantId: accepted.tenant.tenantId,
          membershipId: accepted.membership.membershipId,
        },
      });
      const result = {
        ...response,
        invitationAccepted: true as const,
        acceptedTenant: {
          ...accepted.tenant,
          membershipId: accepted.membership.membershipId,
        },
      };
      await syncPageSessionCookie(
        set,
        request,
        requireTokenService(config),
        result,
        { clearWhenMissing: true },
      );
      return result;
    }, {
      body: t.Union([
        t.Object({ token: invitationTokenSchema }, { additionalProperties: false }),
        t.Object({
          token: invitationTokenSchema,
          continuation: continuationSchema,
        }, { additionalProperties: false }),
        t.Object({
          token: invitationTokenSchema,
          username: authUsernameSchema,
          email: canonicalEmailSchema,
          password: authNewPasswordSchema,
          firstName: t.Optional(authDisplayNameSchema),
          lastName: t.Optional(authDisplayNameSchema),
          mfaEnrollment: t.Optional(t.Boolean()),
        }, { additionalProperties: false }),
      ]),
    })
    .post('/tenant-join-requests', async ({ body, request, server, set }) => {
      admitAuthRequest({
        service: config.getRequestAdmissionService(),
        request,
        peerAddress: server?.requestIP(request)?.address,
        flow: 'join-request',
        subject: body.tenantSlug,
      });
      const proof = await resolveJoinRequestIdentity(config, request, body.continuation);
      const result = requireService(config).submitJoinRequest({
        userId: proof.userId,
        tenantSlug: body.tenantSlug,
        admitIdentityProof: proof.consume,
        auditActor: proof.auditActor,
        auditRequest: authAuditRequestFromRequest(request),
      });
      set.status = 202;
      return result;
    }, {
      body: t.Object({
        tenantSlug: t.String({
          minLength: 1,
          maxLength: 63,
          pattern: '^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$',
        }),
        continuation: t.Optional(continuationSchema),
      }, { additionalProperties: false }),
    })
    .get('/tenant/invitations', async ({ request, query, set }) => {
      applyAuthPrivateNoStore(set);
      const actor = await requireTenantActor(config, request);
      actor.access.requirePermission('tenant.invitations:read');
      return actor.service.listInvitations({
        tenantId: actor.scope.tenantId,
        status: query.status,
        limit: query.limit,
        cursor: query.cursor,
        assertCurrentAuthority: actor.assertCurrentAuthority,
      });
    }, {
      query: t.Object({
        status: t.Optional(t.Union([
          t.Literal('pending'),
          t.Literal('accepted'),
          t.Literal('revoked'),
          t.Literal('expired'),
        ])),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
        cursor: t.Optional(t.String({ minLength: 1, maxLength: 512 })),
      }, { additionalProperties: false }),
    })
    .post('/tenant/invitations', async ({ request, body }) => {
      const actor = await requireTenantActor(config, request);
      actor.access.requirePermission('tenant.invitations:manage');
      const roleKeys = body.roles ?? ['member'];
      if (!isDefaultMemberRole(roleKeys)) {
        actor.access.requirePermission('tenant.roles:manage');
      }
      const delivery = body.delivery
        ?? actor.service.config.invitations.delivery.default;
      if (delivery === 'manual'
        && !actor.service.config.invitations.delivery.allowManual) {
        throw new AuthError(
          'Manual tenant invitation delivery is disabled',
          'TENANT_INVITATION_MANUAL_DISABLED',
          403,
        );
      }
      let outbox: AuthEmailOutbox | null = null;
      if (delivery === 'email') {
        if (!actor.service.config.invitations.delivery.email.enabled) {
          throw new AuthError(
            'Tenant invitation email delivery is disabled',
            'TENANT_INVITATION_EMAIL_DISABLED',
            422,
          );
        }
        const email = config.getAccountEmailService();
        outbox = config.getAuthEmailOutbox();
        if (!email || !outbox) {
          throw new AuthError(
            'Tenant invitation email delivery is unavailable',
            'TENANT_INVITATION_EMAIL_UNAVAILABLE',
            503,
          );
        }
        // Provider readiness and app publicUrl are proven before a live
        // invitation row can exist.
        email.assertReady();
      }
      const created = actor.service.issueInvitation({
        tenantId: actor.scope.tenantId,
        email: body.email,
        roleKeys,
        ttlMs: body.expiresIn === undefined
          ? undefined
          : parseTokenTTL(body.expiresIn, 'tenant invitation lifetime'),
        assertCurrentAuthority: actor.assertCurrentAuthority,
        auditRequest: authAuditRequestFromRequest(request),
        ...(delivery === 'email' ? {
          afterPersist: (issued: {
            invitationId: string;
            recipient: string;
            rawToken: string;
          }) => {
            const queued = outbox!.enqueueInvitation(issued);
            if (queued.result !== 'enqueued') {
              throw new AuthError(
                'Tenant invitation email queue is at capacity',
                'TENANT_INVITATION_EMAIL_CAPACITY',
                503,
              );
            }
          },
        } : {}),
      });
      return delivery === 'manual'
        ? {
            invitation: created.invitation,
            delivery: { mode: 'manual' as const },
            token: created.token,
          }
        : {
            invitation: created.invitation,
            delivery: { mode: 'email' as const, status: 'queued' as const },
          };
    }, {
      body: t.Object({
        email: canonicalEmailSchema,
        roles: t.Optional(rolesSchema),
        expiresIn: t.Optional(t.String({
          minLength: 2,
          maxLength: 12,
          pattern: '^\\d+[smhd]$',
        })),
        delivery: t.Optional(t.Union([
          t.Literal('manual'),
          t.Literal('email'),
        ])),
      }, { additionalProperties: false }),
    })
    .delete('/tenant/invitations/:invitationId', async ({ request, params }) => {
      const actor = await requireTenantActor(config, request);
      actor.access.requirePermission('tenant.invitations:manage');
      return {
        invitation: actor.service.revokeInvitation({
          tenantId: actor.scope.tenantId,
          invitationId: params.invitationId,
          assertCurrentAuthority: actor.assertCurrentAuthority,
          auditRequest: authAuditRequestFromRequest(request),
        }),
      };
    }, {
      params: t.Object({ invitationId: idSchema }, { additionalProperties: false }),
    })
    .get('/tenant/join-requests', async ({ request, query, set }) => {
      applyAuthPrivateNoStore(set);
      const actor = await requireTenantActor(config, request);
      actor.access.requirePermission('tenant.join-requests:review');
      return actor.service.listJoinRequests({
        tenantId: actor.scope.tenantId,
        status: query.status,
        limit: query.limit,
        cursor: query.cursor,
        approvalScope: actor.scope,
        approvalApplicationScope: actor.access.applicationAuthorization,
        assertCurrentAuthority: actor.assertCurrentAuthority,
      });
    }, {
      query: t.Object({
        status: t.Optional(t.Union([
          t.Literal('pending'),
          t.Literal('approved'),
          t.Literal('denied'),
          t.Literal('cancelled'),
        ])),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
        cursor: t.Optional(t.String({ minLength: 1, maxLength: 512 })),
      }, { additionalProperties: false }),
    })
    .post('/tenant/join-requests/:joinRequestId/approve', async ({
      request, params, body,
    }) => {
      const actor = await requireTenantActor(config, request);
      actor.access.requirePermission('tenant.join-requests:review');
      return {
        request: actor.service.approveJoinRequest({
          tenantId: actor.scope.tenantId,
          joinRequestId: params.joinRequestId,
          expectedRequestRevision: body.expectedRequestRevision,
          roleKeys: body.roles,
          reactivateMembership: body.reactivateMembership,
          assertCurrentAuthority: actor.assertCurrentAuthority,
          auditRequest: authAuditRequestFromRequest(request),
        }),
      };
    }, {
      params: t.Object({ joinRequestId: idSchema }, { additionalProperties: false }),
      body: t.Object({
        expectedRequestRevision: t.Integer({ minimum: 1 }),
        roles: t.Optional(rolesSchema),
        reactivateMembership: t.Optional(t.Boolean()),
      }, { additionalProperties: false }),
    })
    .post('/tenant/join-requests/:joinRequestId/deny', async ({
      request, params, body,
    }) => {
      const actor = await requireTenantActor(config, request);
      actor.access.requirePermission('tenant.join-requests:review');
      return {
        request: actor.service.denyJoinRequest({
          tenantId: actor.scope.tenantId,
          joinRequestId: params.joinRequestId,
          expectedRequestRevision: body.expectedRequestRevision,
          assertCurrentAuthority: actor.assertCurrentAuthority,
          auditRequest: authAuditRequestFromRequest(request),
        }),
      };
    }, {
      params: t.Object({ joinRequestId: idSchema }, { additionalProperties: false }),
      body: t.Object({
        expectedRequestRevision: t.Integer({ minimum: 1 }),
      }, { additionalProperties: false }),
    });
}

async function requireTenantActor(
  config: AuthTenantOnboardingPluginConfig,
  request: Request,
): Promise<TenantActor> {
  const store = requireStore(config);
  const tokenService = requireTokenService(config);
  const service = requireService(config);
  const kernel = config.getAuthorizationKernel();
  if (kernel.tenancy.mode !== 'multi') {
    throw new AuthError(
      'Tenant onboarding administration is unavailable',
      'TENANT_ONBOARDING_UNAVAILABLE',
      404,
    );
  }
  const auth = await extractAuthContext(request, tokenService);
  if (!auth) throw unauthorized();
  const access = createRequestAuthorizationAccess({
    authContext: auth,
    kernel,
    propertyStore: store,
    roleAssignments: config.getAuthorizationRoleService(),
  });
  const scope = access.requireTenant();
  const assertCurrentAuthority = captureAuthTenantMutationAuthority({
    auth,
    tokenService,
    kernel,
    store,
    roles: config.getAuthorizationRoleService(),
  });
  return { auth, scope, access, service, assertCurrentAuthority };
}

async function resolveIdentityProof(
  config: AuthTenantOnboardingPluginConfig,
  request: Request,
  body: {
    token: string;
    continuation?: string;
  },
): Promise<IdentityProof> {
  const tokenService = requireTokenService(config);
  if (request.headers.has('authorization')) {
    if (body.continuation) throw ambiguousProof();
    const auth = await extractAuthContext(request, tokenService);
    if (!auth) throw unauthorized();
    const admission = captureAuthSessionIdentityAdmission(auth, tokenService);
    return {
      userId: auth.userId,
      authGeneration: admission.authGeneration,
      mfaVerifiedAt: auth.mfaVerifiedAt ?? null,
      consume: admission.consume,
      auditActor: authAuditActorFromContext(auth),
    };
  }
  if (body.continuation) {
    return resolveOnboardingContinuation(config, body.continuation);
  }
  throw new AuthError(
    'Complete authentication for the invitation email account to continue',
    'TENANT_INVITATION_IDENTITY_PROOF_REQUIRED',
    401,
  );
}

async function resolveJoinRequestIdentity(
  config: AuthTenantOnboardingPluginConfig,
  request: Request,
  continuation: string | undefined,
): Promise<IdentityProof> {
  if (request.headers.has('authorization')) {
    if (continuation) throw ambiguousProof();
    const tokenService = requireTokenService(config);
    const auth = await extractAuthContext(request, tokenService);
    if (!auth) throw unauthorized();
    const admission = captureAuthSessionIdentityAdmission(auth, tokenService);
    return {
      userId: auth.userId,
      authGeneration: admission.authGeneration,
      mfaVerifiedAt: auth.mfaVerifiedAt ?? null,
      consume: admission.consume,
      auditActor: authAuditActorFromContext(auth),
    };
  }
  if (!continuation) {
    throw new AuthError(
      'Authentication or onboarding continuation is required',
      'TENANT_ONBOARDING_PROOF_REQUIRED',
      401,
    );
  }
  return resolveOnboardingContinuation(config, continuation);
}

function resolveOnboardingContinuation(
  config: AuthTenantOnboardingPluginConfig,
  raw: string,
): IdentityProof {
  const sessions = requireTenantSessions(config);
  const store = requireStore(config);
  const record = sessions.continuations.inspect(raw, 'tenant_onboarding');
  if (!record || store.getAuthGeneration(record.userId) !== record.authGeneration) {
    throw new AuthError(
      'Onboarding continuation is invalid',
      'TENANT_ONBOARDING_PROOF_INVALID',
      400,
    );
  }
  const user = store.getUserById(record.userId);
  if (!user || user.status !== 'active' || user.passwordChangeRequired
    || (user.emailVerificationRequired && !user.emailVerifiedAt)) {
    throw new AuthError(
      'Onboarding continuation is invalid',
      'TENANT_ONBOARDING_PROOF_INVALID',
      400,
    );
  }
  return {
    userId: user.userId,
    authGeneration: record.authGeneration,
    mfaVerifiedAt: record.mfaVerifiedAt,
    auditActor: { userId: user.userId, provenance: 'authenticated-request' },
    consume: () => store.getAuthGeneration(user.userId) === record.authGeneration
      && sessions.continuations.consumeInspected(
        record,
        'tenant_onboarding',
        user.userId,
        record.authGeneration,
      ),
  };
}

function requireService(config: AuthTenantOnboardingPluginConfig) {
  const service = config.getService();
  if (!service) throw notReady();
  return service;
}

function requireStore(config: AuthTenantOnboardingPluginConfig) {
  const store = config.getUserStore();
  if (!store) throw notReady();
  return store;
}

function requireTokenService(config: AuthTenantOnboardingPluginConfig) {
  const service = config.getTokenService();
  if (!service) throw notReady();
  return service;
}

function requireProperties(config: AuthTenantOnboardingPluginConfig) {
  const service = config.getPropertyService();
  if (!service) throw notReady();
  return service;
}

function requireTenantSessions(config: AuthTenantOnboardingPluginConfig) {
  const service = config.getTenantSessionService();
  if (!service) throw notReady();
  return service;
}

function requiresUserMfa(config: ResolvedAuthBehaviorConfig): boolean {
  return config.mfa.enabled && config.mfa.policy === 'required';
}

function isDefaultMemberRole(roles: readonly string[]): boolean {
  return roles.length === 1 && roles[0] === 'member';
}

function ambiguousProof(): AuthError {
  return new AuthError(
    'Provide exactly one identity proof',
    'TENANT_ONBOARDING_PROOF_AMBIGUOUS',
    422,
  );
}

function unauthorized(): AuthError {
  return new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
}

function notReady(): AuthError {
  return new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
}
