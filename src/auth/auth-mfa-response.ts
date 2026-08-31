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

/** Build the response returned when an auth flow reaches session issuance. */
export async function buildAuthCompletionResponse(params: {
  user: UserRecord;
  tokenService: TokenService;
  authConfig: ResolvedAuthBehaviorConfig;
  mfaChallengeService: MfaChallengeService | null;
  requestedMfaSetup?: boolean;
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

  const tokens = await tokenService.issueTokenPair(user);
  return {
    user: toAuthUserResponse(user),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
}
