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

/** Build the response returned when an auth flow reaches session issuance. */
export async function buildAuthCompletionResponse(params: {
  user: UserRecord;
  tokenService: TokenService;
  authConfig: ResolvedAuthBehaviorConfig;
  mfaChallengeService: MfaChallengeService | null;
  tenantSessionService: AuthTenantSessionService;
  requestedMfaSetup?: boolean;
  sessionBinding?: WebSessionBinding;
}) {
  const { user, tokenService, authConfig, mfaChallengeService } = params;

  if (authConfig.mfa.enabled && mfaChallengeService) {
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
  });
}

/** Map the shared tenant/session decision into the stable HTTP response union. */
export async function buildSessionCompletionResponse(params: {
  user: UserRecord;
  tenantSessionService: AuthTenantSessionService;
  sessionBinding?: WebSessionBinding;
}) {
  const completion = await params.tenantSessionService.complete(
    params.user,
    params.sessionBinding,
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
