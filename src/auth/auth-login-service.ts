/** Credential verification and login completion policy. */

import { isEmailLoginIdentifier } from './auth-email-identity';
import { buildAuthCompletionResponse } from './auth-mfa-response';
import {
  requireSessionServices,
  type AuthSessionPluginConfig,
} from './auth-session-dependencies';
import { AuthError } from './types';

export async function loginUser(
  config: AuthSessionPluginConfig,
  input: { username: string; password: string }
) {
  const services = requireSessionServices(config);
  let user = isEmailLoginIdentifier(input.username)
    ? services.store.getUserByEmail(input.username)
    : services.store.getUserByUsername(input.username);
  if (!user) throw invalidCredentials();

  const valid = await services.store.verifyPassword(user.userId, input.password);
  if (!valid) throw invalidCredentials();
  if (user.status === 'suspended') {
    throw new AuthError('Account is suspended', 'ACCOUNT_SUSPENDED', 403);
  }
  if (user.passwordChangeRequired) {
    throw new AuthError('Password change required', 'PASSWORD_CHANGE_REQUIRED', 403);
  }
  if (user.emailVerificationRequired && !user.emailVerifiedAt) {
    throw new AuthError(
      'Email verification required', 'EMAIL_VERIFICATION_REQUIRED', 403
    );
  }

  services.propertyService.applyMissingDefaults(user.userId, services.store);
  user = services.store.getUserById(user.userId)!;
  return buildAuthCompletionResponse({
    user,
    tokenService: services.tokenService,
    authConfig: config.getAuthConfig(),
    mfaChallengeService: services.mfaChallengeService,
  });
}

function invalidCredentials(): AuthError {
  return new AuthError('Invalid credentials', 'INVALID_CREDENTIALS', 401);
}
