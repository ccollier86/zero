/**
 * auth-mfa-response.ts
 *
 * Builds the final auth response after password/email gates have passed. This
 * helper decides whether to issue a full session, start an MFA challenge, or
 * return an MFA setup token; it does not register routes or persist auth data.
 */

import type { MfaChallengeService } from './mfa-challenge-service';
import type { TokenService } from './token-service';
import type { ResolvedAuthBehaviorConfig, UserRecord } from './types';
import { toAuthUserResponse } from './auth-user-response';
import type { WebSessionBinding } from './auth-session-types';
import type { AuthTenantSessionService } from './auth-tenant-session-service';
import { normalizeMfaVerifiedAt } from './mfa-assurance';

/** Build the response returned when an auth flow reaches session issuance. */
export async function buildAuthCompletionResponse(params: {
  user: UserRecord;
  tokenService: TokenService;
  authConfig: ResolvedAuthBehaviorConfig;
  mfaChallengeService: MfaChallengeService | null;
  tenantSessionService: AuthTenantSessionService;
  requestedMfaSetup?: boolean;
  sessionBinding?: WebSessionBinding;
  /** Trusted durable assurance re-resolved from a live server-side proof. */
  mfaVerifiedAt?: number | null;
}) {
  const { user, tokenService, authConfig, mfaChallengeService } = params;
  const mfaVerifiedAt = normalizeMfaVerifiedAt(params.mfaVerifiedAt);

  if (mfaVerifiedAt === null && authConfig.mfa.enabled && mfaChallengeService) {
    const activeMethod = mfaChallengeService.getActiveChallengeMethod(user.userId);
    if (activeMethod) {
      const started = await mfaChallengeService.startLoginChallenge({
        user,
        method: activeMethod,
      });
      const challengeToken = await tokenService.signTransitionToken(user, {
        purpose: 'mfa_challenge',
        ttl: authConfig.mfa.challengeTTL,
        methodId: started.method.methodId,
        methodType: started.method.type,
        challengeId: started.challenge?.challengeId || undefined,
        flow: 'auth',
      });

      return {
        user: toAuthUserResponse(user),
        mfaChallengeRequired: true,
        mfaChallenge: {
          method: started.method,
          challenge: started.challenge,
          challengeToken,
        },
      };
    }

    if (params.requestedMfaSetup || mfaChallengeService.isMfaRequiredForUser(user)) {
      const setupToken = await tokenService.signTransitionToken(user, {
        purpose: 'mfa_setup',
        ttl: authConfig.mfa.challengeTTL,
        flow: 'auth',
      });

      return {
        user: toAuthUserResponse(user),
        mfaSetupRequired: true,
        mfaSetupToken: setupToken,
        mfa: {
          methods: authConfig.mfa.methods,
          allowUserChoice: authConfig.mfa.allowUserChoice,
        },
      };
    }
  }

  return buildSessionCompletionResponse({
    user,
    tenantSessionService: params.tenantSessionService,
    sessionBinding: params.sessionBinding,
    mfaVerifiedAt,
  });
}

/** Map the shared tenant/session decision into the stable HTTP response union. */
export async function buildSessionCompletionResponse(params: {
  user: UserRecord;
  tenantSessionService: AuthTenantSessionService;
  sessionBinding?: WebSessionBinding;
  /** Durable proof produced only by a successfully verified MFA ceremony. */
  mfaVerifiedAt?: number | null;
}) {
  const completion = await params.tenantSessionService.complete(
    params.user,
    params.sessionBinding,
    params.mfaVerifiedAt ?? null,
  );
  const user = toAuthUserResponse(params.user);
  if (completion.kind === 'session') {
    return {
      user,
      accessToken: completion.tokens.accessToken,
      refreshToken: completion.tokens.refreshToken,
      ...(completion.tenant ? { activeTenant: completion.tenant } : {}),
    };
  }
  if (completion.kind === 'tenant_selection_required') {
    return {
      user,
      tenantSelectionRequired: true as const,
      tenantSelection: {
        continuation: completion.continuation,
        expiresAt: completion.expiresAt,
        tenants: completion.tenants,
      },
    };
  }
  return {
    user,
    tenantOnboardingRequired: true as const,
    onboarding: completion.onboarding,
  };
}
