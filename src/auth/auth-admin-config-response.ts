/**
 * auth-admin-config-response.ts
 *
 * Maps normalized auth/runtime configuration into the admin-safe capability
 * response. It does not authenticate requests or register routes.
 */

import { isEmailDeliveryReady, type EmailRuntime } from '../email';
import { resolveAuthEmailBranding } from './auth-email-templates';
import {
  buildBootstrapCapability,
  buildRegistrationCapability,
} from './auth-bootstrap';
import type { MfaService } from './mfa-service';
import type { ResolvedAuthBehaviorConfig } from './types';
import type { UserStore } from './user-store';

/** Build `/auth/admin/config` without exposing secrets. */
export function buildAdminConfigResponse(
  store: UserStore,
  config: ResolvedAuthBehaviorConfig,
  mfaService: MfaService | null,
  emailRuntime: EmailRuntime,
) {
  const userCount = store.countUsers();
  const bootstrapRequired = store.isBootstrapRequired();
  const bootstrap = buildBootstrapCapability(config, bootstrapRequired);
  const registration = buildRegistrationCapability(config, bootstrapRequired);
  const branding = resolveAuthEmailBranding(emailRuntime.app, config.branding);
  const emailDeliveryReady = isEmailDeliveryReady(emailRuntime);
  const accountEmailReady = emailDeliveryReady && Boolean(branding.publicUrl);
  const mfa = mfaService?.buildAdminConfig({ emailOtpReady: emailDeliveryReady });
  const authorizationMode = config.authorization?.mode ?? 'simple';
  const authorization = authorizationMode === 'simple'
    && (config.tenancy?.mode ?? 'single') === 'single'
    ? { mode: authorizationMode }
    : {
        mode: authorizationMode,
        permissions: config.authorization?.permissions ?? {},
        roles: Object.fromEntries(
          Object.entries(config.authorization?.roles ?? {}).map(([key, role]) => [
            key,
            { ...role, assignable: !role.system },
          ]),
        ),
      };
  const tenancy = {
    mode: config.tenancy?.mode ?? 'single' as const,
    terminology: config.tenancy?.terminology ?? {
      singular: 'organization',
      plural: 'organizations',
    },
    creation: {
      mode: config.tenancy?.creation.mode ?? 'disabled' as const,
    },
    ...((config.tenancy?.mode ?? 'single') === 'multi'
      ? {
          onboarding: {
            invitations: {
              enabled: config.tenancy?.onboarding?.invitations.enabled ?? true,
              accountCreation:
                config.tenancy?.onboarding?.invitations.accountCreation ?? true,
              delivery: {
                default: config.tenancy?.onboarding?.invitations.delivery.default
                  ?? 'manual' as const,
                manual: config.tenancy?.onboarding?.invitations.delivery.allowManual
                  ?? true,
                email: Boolean(
                  config.tenancy?.onboarding?.invitations.delivery.email.enabled
                  && accountEmailReady,
                ),
              },
            },
            joinRequests: {
              enabled: config.tenancy?.onboarding?.joinRequests.enabled ?? true,
            },
            ...(config.tenancy?.onboarding?.verifiedDomains.enabled
              && accountEmailReady
              ? {
                  verifiedDomains: {
                    enabled: true,
                    admission: 'request-to-join' as const,
                  },
                }
              : {}),
          },
        }
      : {}),
  };

  return {
    tenancy,
    authorization,
    bootstrap,
    registration: {
      ...registration,
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
