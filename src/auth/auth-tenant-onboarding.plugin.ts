/** Tenant-scoped invitation review plus public/pre-session onboarding routes. */

import { Elysia, t } from 'elysia';
import { parseTokenTTL } from '../tokens/token-utils';
import { canonicalEmailSchema } from './auth-email-schema';
import {
  buildAuthCompletionResponse,
} from './auth-mfa-response';
import { admitAuthRequest } from './auth-request-admission';
import {
  authDisplayNameSchema,
  authNewPasswordSchema,
  authUsernameSchema,
} from './auth-request-schema';
import type { AuthEmailOutbox } from './auth-email-outbox';
import { syncPageSessionCookie } from './page-session';
import { AuthError, type ResolvedAuthBehaviorConfig } from './types';
import { authAuditRequestFromRequest } from './auth-audit-service';
import { applyAuthPrivateNoStore } from './auth-response-cache';
import type { AuthTenantOnboardingPluginConfig } from './auth-tenant-onboarding-plugin-config';
import {
  requireOnboardingProperties,
  requireOnboardingService,
  requireOnboardingStore,
  requireOnboardingTenantSessions,
  requireOnboardingTokenService,
  requireTenantOnboardingActor,
  resolveInvitationIdentityProof,
  resolveJoinRequestIdentityProof,
} from './auth-tenant-onboarding-identity';

export type { AuthTenantOnboardingPluginConfig } from './auth-tenant-onboarding-plugin-config';

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
      return requireOnboardingService(config).inspectInvitation(body.token);
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
      const service = requireOnboardingService(config);
      const store = requireOnboardingStore(config);
      const tenantSessions = requireOnboardingTenantSessions(config);
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
          properties: requireOnboardingProperties(config).getDefaultProperties(),
          auditRequest: authAuditRequestFromRequest(request),
          deferAcceptance: requiresUserMfa(authConfig)
            || requestedMfaSetup
            || administrationMfaSetup,
        });
        if ('invitationAcceptancePending' in account) {
          const completion = await buildAuthCompletionResponse({
            user: account.user,
            tokenService: requireOnboardingTokenService(config),
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
            requireOnboardingTokenService(config),
            pending,
            { clearWhenMissing: true },
          );
          return pending;
        }
        accepted = account;
      } else {
        const identity = await resolveInvitationIdentityProof(config, request, body);
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
        tokenService: requireOnboardingTokenService(config),
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
        requireOnboardingTokenService(config),
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
      const proof = await resolveJoinRequestIdentityProof(
        config,
        request,
        body.continuation,
      );
      const result = requireOnboardingService(config).submitJoinRequest({
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
      const actor = await requireTenantOnboardingActor(config, request);
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
      const actor = await requireTenantOnboardingActor(config, request);
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
      const actor = await requireTenantOnboardingActor(config, request);
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
      const actor = await requireTenantOnboardingActor(config, request);
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
      const actor = await requireTenantOnboardingActor(config, request);
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
      const actor = await requireTenantOnboardingActor(config, request);
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

function requiresUserMfa(config: ResolvedAuthBehaviorConfig): boolean {
  return config.mfa.enabled && config.mfa.policy === 'required';
}

function isDefaultMemberRole(roles: readonly string[]): boolean {
  return roles.length === 1 && roles[0] === 'member';
}
