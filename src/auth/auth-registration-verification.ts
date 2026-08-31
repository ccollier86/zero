/** Durable verification-token creation and delivery for a new registration. */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { discardUndeliveredActionToken } from './auth-action-token-delivery';
import type { AuthSessionPluginConfig, AuthSessionServices } from './auth-session-dependencies';
import { rollbackRegistration } from './auth-registration-rollback';
import type { UserRecord } from './types';

export async function sendRegistrationVerification(params: {
  config: AuthSessionPluginConfig;
  services: AuthSessionServices;
  user: UserRecord;
  requestedMfaSetup: boolean;
  nativeContinuation: string | null;
}): Promise<void> {
  const { config, services, user, requestedMfaSetup, nativeContinuation } = params;
  const nativeAuthorization = config.getNativeAuthorizationService();
  let created: ReturnType<AuthSessionServices['actionTokens']['create']> | null = null;
  try {
    services.registrationIntents.setMfaEnrollment(user.userId, requestedMfaSetup);
    created = services.actionTokens.create({
      userId: user.userId,
      type: 'email_verification',
      metadata: {
        source: 'registration',
        mfaEnrollment: requestedMfaSetup,
        ...(nativeContinuation ? { nativeContinuation } : {}),
      },
    });
    await services.accountEmail.sendEmailVerification({
      user, rawToken: created.rawToken, token: created.record,
    });
  } catch (error) {
    if (created) discardUndeliveredActionToken(services.actionTokens, created.rawToken);
    const rollback = rollbackRegistration({
      store: services.store,
      userId: user.userId,
      nativeAuthorization,
      nativeContinuation,
    });
    emitPlatformCode(OBS_CODES.AUTH_EMAIL_VERIFICATION_DELIVERY_FAILED, {
      userId: user.userId,
      metadata: { source: 'registration', ...rollback },
    });
    throw error;
  }
  emitPlatformCode(OBS_CODES.AUTH_EMAIL_VERIFICATION_SENT, {
    userId: user.userId,
    metadata: { source: 'registration' },
  });
}
