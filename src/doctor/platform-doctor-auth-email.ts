/**
 * platform-doctor-auth-email.ts
 *
 * Pure diagnostics for resolved auth behavior, bootstrap, MFA, account email,
 * provider readiness, and public authentication route boundaries.
 */

import { getBootstrapConfig } from '../auth/auth-bootstrap';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import type {
  AuthBehaviorConfig,
  ResolvedAuthBehaviorConfig,
} from '../auth/types';
import type { EmailConfig } from '../email/types';
import type { ResolvedConfig } from '../frontend/server/types';
import { authPublicPathFindings } from './auth-public-path-checks';
import {
  addPlatformDoctorFinding as addFinding,
  type PlatformDoctorFindingSink,
} from './platform-doctor-contracts';

export function resolveDoctorAuthConfig(
  config: AuthBehaviorConfig & {
    accessTokenTTL?: string;
    refreshTokenTTL?: string;
  },
  findings: PlatformDoctorFindingSink,
): ResolvedAuthBehaviorConfig | null {
  const {
    nativeApps: _nativeApps,
    accessTokenTTL: _accessTokenTTL,
    refreshTokenTTL: _refreshTokenTTL,
    ...behavior
  } = config;
  try {
    const resolved = resolveAuthBehaviorConfig(behavior);
    if (resolved.tenancy.mode === 'single'
      && resolved.authorization.mode === 'advanced'
      && !resolved.authorization.ownerAdoption) {
      addFinding(findings, {
        severity: 'info',
        code: 'auth.authorization.owner_adoption.runtime_guard',
        path: 'auth.authorization.ownerAdoption',
        message: 'Fresh single/advanced installs atomically make the first bootstrap user the application owner. Existing installs are checked for an active owner during startup.',
        hint: 'If startup reports an ownerless upgrade, configure one exact existing userId or email in auth.authorization.ownerAdoption, start once, and then keep or remove that idempotent selector.',
        docs: './docs/auth/README.md',
      });
    }
    return resolved;
  } catch (error) {
    addFinding(findings, {
      severity: 'error',
      code: 'auth.config.invalid',
      path: 'auth',
      message: error instanceof Error
        ? error.message
        : 'Auth configuration could not be resolved.',
      hint: 'Fix the auth configuration before starting the application.',
      docs: './docs/auth/README.md',
    });
    return null;
  }
}

export function checkAuthAndEmail(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFindingSink,
  env: Record<string, string | undefined>,
  authConfig: ResolvedAuthBehaviorConfig | null,
): void {
  if (resolved.auth === false || !authConfig) return;

  const bootstrap = getBootstrapConfig(authConfig);
  if (bootstrap.mode === 'secret' && !bootstrap.secret) {
    findings.push({
      severity: 'warning',
      code: 'auth.bootstrap.secret_missing',
      path: 'auth.bootstrap.secret',
      message: 'First-administrator bootstrap is secret-gated, but no bootstrap secret is configured.',
      hint: 'Inject a random secret of at least 32 characters from deployment secrets, or deliberately select bootstrap mode "public" or "disabled".',
      docs: './docs/auth/README.md#first-administrator-bootstrap',
    });
  } else if (bootstrap.mode === 'public') {
    findings.push({
      severity: 'warning',
      code: 'auth.bootstrap.public',
      path: 'auth.bootstrap',
      message: 'The first unauthenticated registration may claim the global administrator account.',
      hint: 'Use secret-gated bootstrap for any app reachable by untrusted clients.',
      docs: './docs/auth/README.md#first-administrator-bootstrap',
    });
  }

  if (!isDuration(authConfig.accountEmails.actionTokenTTL)) {
    findings.push({
      severity: 'error',
      code: 'auth.action_token_ttl.invalid',
      path: 'auth.accountEmails.actionTokenTTL',
      message: 'auth.accountEmails.actionTokenTTL must use a duration like 15m, 1h, or 7d.',
    });
  }
  if (!isDuration(authConfig.accountEmails.requestCooldown)) {
    findings.push({
      severity: 'error',
      code: 'auth.account_email_cooldown.invalid',
      path: 'auth.accountEmails.requestCooldown',
      message: 'auth.accountEmails.requestCooldown must use a duration like 30s, 5m, or 1h.',
    });
  }

  const emailDeliveryReady = isDoctorEmailDeliveryReady(resolved.email, env);
  const authPublicUrl = firstNonEmpty(
    authConfig.branding.publicUrl,
    resolved.app.publicUrl,
  );

  if (authConfig.account.requireEmailVerification) {
    if (!emailDeliveryReady) {
      findings.push({
        severity: 'error',
        code: 'auth.email_verification.delivery_unavailable',
        path: 'auth.account.requireEmailVerification',
        message: 'Required email verification cannot deliver verification messages with the configured email provider.',
        hint: 'Configure a non-noop email provider, sender address, and provider credentials, or disable requireEmailVerification.',
        docs: './docs/auth/README.md#email-readiness-and-failure-semantics',
      });
    }
    if (!authPublicUrl) {
      findings.push({
        severity: 'error',
        code: 'auth.email_verification.public_url_missing',
        path: 'app.publicUrl',
        message: 'Required email verification needs app.publicUrl or auth.branding.publicUrl to build verification links.',
        hint: 'Configure the public application origin used by verification links.',
        docs: './docs/auth/README.md#email-readiness-and-failure-semantics',
      });
    }
  }

  checkRequiredMfaReadiness(
    authConfig,
    emailDeliveryReady,
    findings,
  );

  const verifiedDomainsEnabled = Boolean(
    authConfig.tenancy?.mode === 'multi'
    && authConfig.tenancy.onboarding?.verifiedDomains.enabled,
  );
  const emailFeaturesEnabled = authConfig.accountEmails.adminCreatedUser
    || authConfig.accountEmails.passwordReset
    || authConfig.accountEmails.passwordChangedNotice
    || verifiedDomainsEnabled;

  if (emailFeaturesEnabled && resolved.email === false) {
    findings.push({
      severity: verifiedDomainsEnabled ? 'error' : 'warning',
      code: 'auth.email.disabled',
      path: 'auth.accountEmails',
      message: verifiedDomainsEnabled
        ? 'Verified-domain onboarding requires createApp email delivery.'
        : 'Auth account email flows are enabled, but createApp email is disabled. Disable those flows or configure email.',
    });
  }

  if (resolved.email === false) return;

  const emailConfig = resolved.email as EmailConfig;
  if (emailFeaturesEnabled && !authPublicUrl) {
    findings.push({
      severity: verifiedDomainsEnabled ? 'error' : 'warning',
      code: 'auth.email.public_url_missing',
      path: 'app.publicUrl',
      message: verifiedDomainsEnabled
        ? 'Verified-domain onboarding requires app.publicUrl for mailbox-proof links.'
        : 'Account emails need app.publicUrl so setup/reset links can be generated.',
    });
  }

  if (emailFeaturesEnabled && !emailConfig.from && !env.EMAIL_FROM) {
    findings.push({
      severity: verifiedDomainsEnabled ? 'error' : 'warning',
      code: 'email.from_missing',
      path: 'email.from',
      message: 'Email delivery needs a default from address. Set email.from or EMAIL_FROM.',
    });
  }

  if (usesResend(emailConfig) && !emailConfig.resend?.apiKey && !env.RESEND_API_KEY) {
    findings.push({
      severity: verifiedDomainsEnabled ? 'error' : 'warning',
      code: 'email.resend_api_key_missing',
      path: 'email.resend.apiKey',
      message: 'Resend is selected but no API key was found. Set email.resend.apiKey or RESEND_API_KEY.',
    });
  }
}

/** Verify auth redirects do not point users at a protected login route. */
export function checkAuthPublicPaths(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFindingSink,
): void {
  findings.push(...authPublicPathFindings(resolved));
}

function checkRequiredMfaReadiness(
  authConfig: ResolvedAuthBehaviorConfig,
  emailDeliveryReady: boolean,
  findings: PlatformDoctorFindingSink,
): void {
  const mfa = authConfig.mfa;
  if (!mfa.enabled || mfa.policy === 'optional') return;

  const emailConfigured = mfa.methods.includes('email');
  const totpConfigured = mfa.methods.includes('totp');
  const emailReady = emailConfigured && emailDeliveryReady;
  const totpReady = totpConfigured && Boolean(mfa.totp.encryptionKey);

  if (emailConfigured && !emailReady) {
    findings.push({
      severity: totpReady ? 'warning' : 'error',
      code: 'auth.mfa.email_delivery_unavailable',
      path: 'auth.mfa.methods',
      message: 'Required MFA includes email OTP, but the configured email provider is not ready for delivery.',
      hint: totpReady
        ? 'Configure email delivery or remove the unavailable email method; TOTP remains usable.'
        : 'Configure a non-noop email provider, sender address, and provider credentials before requiring MFA.',
      docs: './docs/auth/README.md#mfa',
    });
  }

  if (totpConfigured && !totpReady) {
    findings.push({
      severity: emailReady ? 'warning' : 'error',
      code: 'auth.mfa.totp_encryption_key_missing',
      path: 'auth.mfa.totp.encryptionKey',
      message: 'Required MFA includes TOTP, but auth.mfa.totp.encryptionKey is not configured.',
      hint: emailReady
        ? 'Configure the TOTP encryption key or remove the unavailable TOTP method; email OTP remains usable.'
        : 'Configure an operator-managed TOTP encryption key before requiring MFA.',
      docs: './docs/auth/README.md#mfa',
    });
  }
}

function usesResend(config: EmailConfig): boolean {
  const provider = config.provider ?? 'resend';
  return provider === 'resend';
}

/** Mirror the runtime's provider/sender readiness without starting delivery. */
function isDoctorEmailDeliveryReady(
  email: false | EmailConfig,
  env: Record<string, string | undefined>,
): boolean {
  if (email === false) return false;
  if (!firstNonEmpty(email.from, env.EMAIL_FROM)) return false;

  const provider = email.provider ?? 'resend';
  if (typeof provider === 'object') return true;
  if (provider === 'resend') {
    return Boolean(firstNonEmpty(email.resend?.apiKey, env.RESEND_API_KEY));
  }
  return provider === 'console' || provider === 'memory';
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function isDuration(value: string): boolean {
  return /^\d+(s|m|h|d)$/.test(value);
}
