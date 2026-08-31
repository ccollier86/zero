/** Transport-independent orchestration for self-service registration. */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { buildAuthCompletionResponse } from './auth-mfa-response';
import {
  claimRegistrationContinuation,
  requireRegistrationContinuation,
} from './auth-registration-continuation';
import { resolveRegistrationPolicy } from './auth-registration-policy';
import { sendRegistrationVerification } from './auth-registration-verification';
import {
  requireSessionServices,
  type AuthSessionPluginConfig,
} from './auth-session-dependencies';
import { toAuthUserResponse } from './auth-user-response';

export interface RegistrationInput {
  username: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  mfaEnrollment?: boolean;
  nativeContinuation?: string;
}

export async function registerUser(
  config: AuthSessionPluginConfig,
  input: RegistrationInput
) {
  const services = requireSessionServices(config);
  const authConfig = config.getAuthConfig();
  const nativeAuthorization = config.getNativeAuthorizationService();
  const nativeContinuation = requireRegistrationContinuation(
    nativeAuthorization, input.nativeContinuation
  );
  const { user, policy } = await services.store.createRegistrationUser({
    username: input.username, email: input.email, password: input.password,
    firstName: input.firstName, lastName: input.lastName,
    properties: services.propertyService.getDefaultProperties(),
  }, (isBootstrap) => resolveRegistrationPolicy({
    isBootstrap, accountEmail: services.accountEmail, authConfig,
    mfaEnrollment: input.mfaEnrollment,
  }), (created) => claimRegistrationContinuation(
    nativeAuthorization, nativeContinuation, created.userId
  ));
  if (policy.requireEmailVerification) {
    await sendRegistrationVerification({
      config, services, user, nativeContinuation,
      requestedMfaSetup: policy.requestedMfaSetup,
    });
  }
  if (policy.isBootstrap) {
    emitPlatformCode(OBS_CODES.AUTH_FIRST_ADMIN_BOOTSTRAPPED, { userId: user.userId });
  }
  if (policy.requireEmailVerification) return { user: toAuthUserResponse(user) };
  return buildAuthCompletionResponse({
    user, tokenService: services.tokenService, authConfig,
    mfaChallengeService: services.mfaChallengeService,
    requestedMfaSetup: policy.requestedMfaSetup,
  });
}
