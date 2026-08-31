/**
 * auth-admin-config-response.ts
 *
 * Maps normalized auth/runtime configuration into the admin-safe capability
 * response. It does not authenticate requests or register routes.
 */

import { getEmailRuntime, isEmailDeliveryReady } from '../email';
import { resolveAuthEmailBranding } from './auth-email-templates';
import type { MfaService } from './mfa-service';
import type { ResolvedAuthBehaviorConfig } from './types';
import type { UserStore } from './user-store';

/** Build `/auth/admin/config` without exposing secrets. */
export function buildAdminConfigResponse(
  store: UserStore,
  config: ResolvedAuthBehaviorConfig,
  mfaService: MfaService | null
) {
  const userCount = store.countUsers();
  const emailRuntime = getEmailRuntime();
  const branding = resolveAuthEmailBranding(emailRuntime.app, config.branding);
  const emailDeliveryReady = isEmailDeliveryReady(emailRuntime);
  const accountEmailReady = emailDeliveryReady && Boolean(branding.publicUrl);
  const mfa = mfaService?.buildAdminConfig({ emailOtpReady: emailDeliveryReady });

  return {
    registration: {
      ...config.registration,
      bootstrapRequired: userCount === 0,
      publicRegistrationEnabled: userCount === 0 || config.registration.mode === 'public',
      userCount,
    },
    email: {
      enabled: emailRuntime.enabled,
      provider: emailRuntime.provider.name,
      hasPublicUrl: Boolean(branding.publicUrl),
    },
    account: {
      requireEmailVerification: config.account.requireEmailVerification,
      emailVerificationPath: config.account.emailVerificationPath,
      emailVerificationReady: config.account.requireEmailVerification && accountEmailReady,
      allowAdminMarkEmailVerified: config.account.allowAdminMarkEmailVerified,
    },
    accountEmails: {
      ...config.accountEmails,
      adminCreatedUser: config.accountEmails.adminCreatedUser && accountEmailReady,
      passwordReset: config.accountEmails.passwordReset && accountEmailReady,
      passwordChangedNotice: config.accountEmails.passwordChangedNotice && accountEmailReady,
      emailVerification: config.account.requireEmailVerification && accountEmailReady,
    },
    mfa,
    capabilities: {
      manualPasswordReset: config.accountEmails.manualPasswordReset,
      setupEmail: accountEmailReady,
      passwordResetEmail: config.accountEmails.passwordReset && accountEmailReady,
      emailVerification: config.account.requireEmailVerification && accountEmailReady,
      adminMarkEmailVerified: config.account.allowAdminMarkEmailVerified,
      mfa: Boolean(mfa?.enabled && mfa.ready),
      suspendUsers: true,
      promoteAdmins: true,
      userProperties: true,
    },
    userProperties: config.userProperties,
    strictUserProperties: config.strictUserProperties,
  };
}
