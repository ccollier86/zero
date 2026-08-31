/** Public auth capability and policy discovery route. */

import { Elysia } from 'elysia';
import { getEmailRuntime, isEmailDeliveryReady } from '../email';
import { resolveAuthEmailBranding } from './auth-email-templates';
import {
  requireSessionServices,
  type AuthSessionPluginConfig,
} from './auth-session-dependencies';

export function createAuthSessionConfigPlugin(config: AuthSessionPluginConfig) {
  return new Elysia({ name: 'auth-session-config' }).get('/config', () => {
    const { store } = requireSessionServices(config);
    const authConfig = config.getAuthConfig();
    const userCount = store.countUsers();
    const emailRuntime = getEmailRuntime();
    const branding = resolveAuthEmailBranding(emailRuntime.app, authConfig.branding);
    const emailReady = isEmailDeliveryReady(emailRuntime);
    const accountEmailReady = emailReady && Boolean(branding.publicUrl);
    const mfa = config.getMfaService()?.buildPublicConfig({
      emailOtpReady: emailReady,
    });

    return {
      registration: {
        ...authConfig.registration,
        bootstrapRequired: userCount === 0,
        publicRegistrationEnabled:
          userCount === 0 || authConfig.registration.mode === 'public',
        userCount,
      },
      accountEmails: {
        adminCreatedUser: authConfig.accountEmails.adminCreatedUser && accountEmailReady,
        passwordReset: authConfig.accountEmails.passwordReset && accountEmailReady,
        passwordChangedNotice:
          authConfig.accountEmails.passwordChangedNotice && accountEmailReady,
        emailVerification:
          authConfig.account.requireEmailVerification && accountEmailReady,
      },
      account: {
        requireEmailVerification: authConfig.account.requireEmailVerification,
        emailVerificationPath: authConfig.account.emailVerificationPath,
        emailVerificationReady:
          authConfig.account.requireEmailVerification && accountEmailReady,
      },
      mfa,
      userProperties: Object.fromEntries(
        Object.entries(authConfig.userProperties).filter(
          ([, field]) => field.editableBy === 'user'
        )
      ),
      strictUserProperties: authConfig.strictUserProperties,
    };
  });
}
