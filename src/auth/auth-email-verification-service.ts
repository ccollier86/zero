/** Atomic verification-token consumption and auth-flow completion. */

import { OBS_CODES } from '../observability/codes';
import {
  getAuthAccountEmitter,
  requireAccountServices,
  type AuthAccountPluginConfig,
} from './auth-account-dependencies';
import { buildAuthCompletionResponse } from './auth-mfa-response';
import { AuthError } from './types';
import type { AuthAuditRequestContext } from './auth-audit-types';

export async function completeEmailVerification(
  config: AuthAccountPluginConfig,
  rawToken: string,
  auditRequest?: AuthAuditRequestContext,
) {
  const services = requireAccountServices(config);
  const inspection = services.actionTokens.inspect(rawToken, ['email_verification']);
  if (inspection.user.status === 'suspended') {
    throw new AuthError('Account is suspended', 'ACCOUNT_SUSPENDED', 403);
  }

  const verifiedDomainConfig = config.getAuthConfig().tenancy?.onboarding
    ?.verifiedDomains;
  const receipt = services.store.completeEmailVerificationForAuthentication(
    inspection.user.userId,
    () => {
      services.actionTokens.consume(rawToken, ['email_verification']);
      services.registrationIntents.clear(inspection.user.userId);
    },
    Date.now(),
    (verified, provedAt) => {
          config.getUserContactService?.()?.recordEmailProof(verified.userId, provedAt, 'possession');
          if (!verifiedDomainConfig?.enabled) return;
          const applicationId = services.store.getConfig('auth.application.id');
          if (!applicationId) return;
          services.store.recordEmailLinkMailboxProof({
            applicationId,
            userId: verified.userId,
            email: verified.email,
            emailGeneration: services.store.getEmailGeneration(verified.userId),
            provedAt,
            expiresAt: provedAt + verifiedDomainConfig.mailboxProofMaxAgeMs,
          });
        },
    {
      actor: {
        userId: inspection.user.userId,
        provenance: 'registration',
      },
      request: auditRequest,
    },
  );
  if (!receipt) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
  const { user, authGeneration } = receipt;
  getAuthAccountEmitter(config)(OBS_CODES.AUTH_EMAIL_VERIFIED, { userId: user.userId });

  return buildAuthCompletionResponse({
    user,
    tokenService: services.tokenService,
    authConfig: config.getAuthConfig(),
    mfaChallengeService: services.mfaChallengeService,
    tenantSessionService: services.tenantSessions,
    requestedMfaSetup: inspection.record.metadata.mfaEnrollment === true,
    expectedAuthGeneration: authGeneration,
  });
}
