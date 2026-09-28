/**
 * auth-mfa.plugin.ts
 *
 * Elysia controller for MFA setup and verification routes. This file owns HTTP
 * validation/transport only; MFA policy, OTP delivery, method persistence, and
 * token signing live in dedicated services.
 */

import { Elysia, t } from 'elysia';
import { extractAuthContext } from './auth-context';
import type { MfaChallengeService } from './mfa-challenge-service';
import type { TokenService } from './token-service';
import type { UserStore } from './user-store';
import type { AuthTransitionTokenPayload, ResolvedAuthBehaviorConfig, UserRecord } from './types';
import { AuthError } from './types';
import { buildSessionCompletionResponse } from './auth-mfa-response';
import type { AuthTenantSessionService } from './auth-tenant-session-service';
import {
  authMfaCodeSchema,
  authMfaLabelSchema,
  authTokenSchema,
} from './auth-request-schema';
import { syncPageSessionCookie } from './page-session';
import {
  authAuditActorFromContext,
  authAuditRequestFromRequest,
} from './auth-audit-service';
import { applyAuthPrivateNoStore } from './auth-response-cache';

export interface AuthMfaPluginConfig {
  getUserStore: () => UserStore | null;
  getTokenService: () => TokenService | null;
  getMfaChallengeService: () => MfaChallengeService | null;
  getAuthConfig: () => ResolvedAuthBehaviorConfig;
  getAuthTenantSessionService: () => AuthTenantSessionService | null;
}

/** Create MFA lifecycle routes mounted under `/auth/mfa`. */
export function createAuthMfaPlugin(config: AuthMfaPluginConfig) {
  return new Elysia({ name: 'auth-mfa', prefix: '/mfa' })
    .get('/methods', async ({ request, set }) => {
      applyAuthPrivateNoStore(set);
      const { store, tokenService, mfa } = requireMfaServices(config);
      const user = await requireFullSessionUser(request, store, tokenService);

      return {
        methods: mfa.listPublicMethods(user.userId),
        required: mfa.isMfaRequiredForUser(user),
      };
    })
    .post(
      '/setup',
      async ({ body, request }) => {
        const { store, tokenService, mfa } = requireMfaServices(config);
        const actor = await resolveMfaSetupActor({
          request,
          setupToken: body.setupToken,
          store,
          tokenService,
        });
        const started = await mfa.startEnrollment({
          user: actor.user,
          methodType: body.method,
          label: body.label,
        });
        const verificationToken = await tokenService.signTransitionToken(actor.user, {
          purpose: 'mfa_setup',
          ttl: config.getAuthConfig().mfa.challengeTTL,
          methodId: started.method.methodId,
          methodType: started.method.type,
          challengeId: started.challenge?.challengeId,
          flow: actor.flow,
        });

        return {
          setupRequired: actor.flow === 'auth',
          method: started.method,
          challenge: started.challenge,
          totp: started.totp,
          verificationToken,
        };
      },
      {
        body: t.Object({
          setupToken: t.Optional(authTokenSchema),
          method: t.Union([t.Literal('email'), t.Literal('totp')]),
          label: t.Optional(authMfaLabelSchema),
        }),
      }
    )
    .post(
      '/setup/verify',
      async ({ body, request, set }) => {
        const { store, tokenService, mfa, tenantSessions } = requireMfaServices(config);
        const payload = await verifyTransitionToken(
          tokenService,
          body.verificationToken,
          'mfa_setup'
        );
        if (!payload.methodId) {
          throw new AuthError('MFA setup method is missing', 'MFA_SETUP_TOKEN_INVALID', 401);
        }

        const user = requireTokenUser(store, payload);
        const liveAuth = await extractAuthContext(request, tokenService);
        const method = await mfa.verifyEnrollment({
          user,
          methodId: payload.methodId,
          challengeId: payload.challengeId,
          code: body.code,
          auditActor: liveAuth?.userId === user.userId
            ? authAuditActorFromContext(liveAuth)
            : { userId: user.userId, provenance: 'authenticated-request' },
          auditRequest: authAuditRequestFromRequest(request),
        });

        if (payload.flow === 'auth') {
          const completion = await buildSessionCompletionResponse({
            user,
            tenantSessionService: tenantSessions,
          });
          const response = {
            ...completion,
            method,
          };
          await syncPageSessionCookie(set, request, tokenService, response, {
            clearWhenMissing: true,
          });
          return response;
        }

        return {
          ok: true,
          method,
          methods: mfa.listPublicMethods(user.userId),
        };
      },
      {
        body: t.Object({
          verificationToken: authTokenSchema,
          code: authMfaCodeSchema,
        }),
      }
    )
    .post(
      '/challenge/verify',
      async ({ body, request, set }) => {
        const { store, tokenService, mfa, tenantSessions } = requireMfaServices(config);
        const payload = await verifyTransitionToken(
          tokenService,
          body.challengeToken,
          'mfa_challenge'
        );
        if (!payload.methodId) {
          throw new AuthError('MFA challenge method is missing', 'MFA_CHALLENGE_TOKEN_INVALID', 401);
        }

        const user = requireTokenUser(store, payload);
        const method = await mfa.verifyLoginChallenge({
          user,
          methodId: payload.methodId,
          challengeId: payload.challengeId,
          code: body.code,
        });
        const completion = await buildSessionCompletionResponse({
          user,
          tenantSessionService: tenantSessions,
        });
        const response = {
          ...completion,
          method,
        };
        await syncPageSessionCookie(set, request, tokenService, response, {
          clearWhenMissing: true,
        });
        return response;
      },
      {
        body: t.Object({
          challengeToken: authTokenSchema,
          code: authMfaCodeSchema,
        }),
      }
    );
}

interface MfaServices {
  store: UserStore;
  tokenService: TokenService;
  mfa: MfaChallengeService;
  tenantSessions: AuthTenantSessionService;
}

function requireMfaServices(config: AuthMfaPluginConfig): MfaServices {
  const store = config.getUserStore();
  const tokenService = config.getTokenService();
  const mfa = config.getMfaChallengeService();
  const tenantSessions = config.getAuthTenantSessionService();
  if (!store || !tokenService || !mfa || !tenantSessions) {
    throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  }
  return { store, tokenService, mfa, tenantSessions };
}

async function resolveMfaSetupActor(params: {
  request: Request;
  setupToken?: string;
  store: UserStore;
  tokenService: TokenService;
}): Promise<{ user: UserRecord; flow: 'auth' | 'profile' }> {
  if (params.setupToken) {
    const payload = await verifyTransitionToken(
      params.tokenService,
      params.setupToken,
      'mfa_setup'
    );
    if (payload.methodId) {
      throw new AuthError('MFA setup token is already bound to a method', 'MFA_SETUP_TOKEN_INVALID', 401);
    }
    return {
      user: requireTokenUser(params.store, payload),
      flow: 'auth',
    };
  }

  return {
    user: await requireFullSessionUser(params.request, params.store, params.tokenService),
    flow: 'profile',
  };
}

async function requireFullSessionUser(
  request: Request,
  store: UserStore,
  tokenService: TokenService
): Promise<UserRecord> {
  const auth = await extractAuthContext(request, tokenService);
  if (!auth) throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
  const user = store.getUserById(auth.userId);
  if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
  return user;
}

async function verifyTransitionToken(
  tokenService: TokenService,
  token: string,
  purpose: AuthTransitionTokenPayload['purpose']
): Promise<AuthTransitionTokenPayload> {
  const payload = await tokenService.verifyTransitionToken(token, purpose);
  if (!payload) {
    throw new AuthError('Invalid MFA token', 'MFA_TOKEN_INVALID', 401);
  }
  return payload;
}

function requireTokenUser(
  store: UserStore,
  payload: AuthTransitionTokenPayload
): UserRecord {
  const user = store.getUserById(payload.sub);
  if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
  if (user.status === 'suspended') {
    throw new AuthError('Account is suspended', 'ACCOUNT_SUSPENDED', 403);
  }
  if (user.passwordChangeRequired) {
    throw new AuthError('Password change required', 'PASSWORD_CHANGE_REQUIRED', 403);
  }
  if (user.emailVerificationRequired && !user.emailVerifiedAt) {
    throw new AuthError('Email verification required', 'EMAIL_VERIFICATION_REQUIRED', 403);
  }
  return user;
}
