/** Durable verification-token creation and delivery for a new registration. */

import type { AuthSessionServices } from './auth-session-dependencies';
import type { UserRecord } from './types';

export async function sendRegistrationVerification(params: {
  services: AuthSessionServices;
  user: UserRecord;
  requestedMfaSetup: boolean;
  nativeContinuation: string | null;
}): Promise<void> {
  const { services, user, requestedMfaSetup, nativeContinuation } = params;
  const created = services.actionTokens.create({
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
}
