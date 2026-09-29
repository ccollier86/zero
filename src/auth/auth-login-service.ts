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
  if (typeof input.username !== 'string' || typeof input.password !== 'string') {
    throw invalidCredentials();
  }
  let user = isEmailLoginIdentifier(input.username)
    ? services.store.getUserByEmail(input.username)
    : services.store.getUserByUsername(input.username);
  if (!user) throw invalidCredentials();

  const proof = await services.store.verifyPasswordForAuthentication(
    user.userId,
    input.password,
  );
  if (!proof) throw invalidCredentials();
  user = services.store.getUserById(proof.userId)!;
  if (!user) throw invalidCredentials();
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
    tenantSessionService: services.tenantSessions,
    expectedAuthGeneration: proof.authGeneration,
  });
}

function invalidCredentials(): AuthError {
  return new AuthError('Invalid credentials', 'INVALID_CREDENTIALS', 401);
}
