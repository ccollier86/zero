/** Public auth capability and policy discovery route. */

import { Elysia } from 'elysia';
import { isEmailDeliveryReady } from '../email';
import { resolveAuthEmailBranding } from './auth-email-templates';
import {
  buildBootstrapCapability,
  buildRegistrationCapability,
} from './auth-bootstrap';
import {
  requireSessionServices,
  type AuthSessionPluginConfig,
} from './auth-session-dependencies';
import { applyAuthPrivateNoStore } from './auth-response-cache';

export function createAuthSessionConfigPlugin(config: AuthSessionPluginConfig) {
  return new Elysia({ name: 'auth-session-config' }).get('/config', ({ set }) => {
    applyAuthPrivateNoStore(set);
    const { store } = requireSessionServices(config);
    const authConfig = config.getAuthConfig();
    const bootstrapRequired = store.isBootstrapRequired();
    const bootstrap = buildBootstrapCapability(authConfig, bootstrapRequired);
    const registration = buildRegistrationCapability(authConfig, bootstrapRequired);
    const emailRuntime = config.getEmailRuntime();
    const branding = resolveAuthEmailBranding(emailRuntime.app, authConfig.branding);
    const emailReady = isEmailDeliveryReady(emailRuntime);
    const accountEmailReady = emailReady && Boolean(branding.publicUrl);
    const mfa = config.getMfaService()?.buildPublicConfig({
      emailOtpReady: emailReady,
    });

    return {
      tenancy: {
        mode: authConfig.tenancy?.mode ?? 'single' as const,
        terminology: authConfig.tenancy?.terminology ?? {
          singular: 'organization',
          plural: 'organizations',
        },
        creation: {
          mode: authConfig.tenancy?.creation.mode ?? 'disabled' as const,
        },
        onboarding: authConfig.tenancy?.mode === 'multi' ? {
          invitations: {
            enabled: authConfig.tenancy.onboarding?.invitations.enabled ?? true,
            accountCreation:
              authConfig.tenancy.onboarding?.invitations.accountCreation ?? true,
            delivery: {
              default: authConfig.tenancy.onboarding?.invitations.delivery.default
                ?? 'manual',
              manual: authConfig.tenancy.onboarding?.invitations.delivery.allowManual
                ?? true,
              email: Boolean(
                authConfig.tenancy.onboarding?.invitations.delivery.email.enabled
                && accountEmailReady,
              ),
            },
          },
          joinRequests: {
            enabled: authConfig.tenancy.onboarding?.joinRequests.enabled ?? true,
          },
          ...(authConfig.tenancy.onboarding?.verifiedDomains.enabled
            && accountEmailReady
            ? {
                verifiedDomains: {
                  enabled: true,
                  admission: 'request-to-join' as const,
                },
              }
            : {}),
        } : undefined,
      },
      authorization: {
        mode: authConfig.authorization?.mode ?? 'simple' as const,
      },
      apiKeys: {
        enabled: authConfig.apiKeys.enabled,
        selfService: authConfig.apiKeys.selfService,
        administratorIssuance: authConfig.apiKeys.administratorIssuance,
        defaultTTL: authConfig.apiKeys.defaultTTL,
        maxTTL: authConfig.apiKeys.maxTTL,
        maxActivePerUser: authConfig.apiKeys.maxActivePerUser,
      },
      bootstrap,
      registration,
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
