/**
 * auth-email-templates.ts
 *
 * Defines typed auth email template contracts and branding helpers. This file
 * owns template inputs and app-authored template registration only; it does not
 * send messages, create tokens, or mutate auth state.
 */

import type { AppIdentityConfig } from '../email/types';

/** Stable template keys for Zero-authored auth/account email events. */
export type AuthEmailTemplateKey =
  | 'accountSetup'
  | 'passwordReset'
  | 'passwordChanged'
  | 'emailVerification'
  | 'domainMailboxProof'
  | 'emailOtp'
  | 'mfaEnabled'
  | 'mfaDisabled'
  | 'recoveryCodesRegenerated';

/** Developer-supplied branding values for auth pages and auth emails. */
export interface AuthEmailBrandingConfig {
  /** Display name used in auth email copy. Falls back to `app.name`. */
  appName?: string;
  /** Public origin used in auth email links. Falls back to `app.publicUrl`. */
  publicUrl?: string;
  /** Optional absolute logo URL for branded auth email templates. */
  logoUrl?: string;
  /** Optional support address rendered in default auth email footer copy. */
  supportEmail?: string;
  /** Optional button/accent color for default auth email templates. */
  brandColor?: string;
}

/** Branding values resolved for one rendered auth email. */
export interface ResolvedAuthEmailBranding {
  appName: string;
  publicUrl?: string;
  logoUrl?: string;
  supportEmail?: string;
  brandColor: string;
}

/** User shape exposed to app-authored auth email templates. */
export interface AuthEmailTemplateUser {
  userId: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  properties: Record<string, string>;
}

/** Result returned by an app-authored auth email template. */
export interface AuthEmailTemplateResult {
  subject: string;
  text: string;
  html?: string;
}

/** Context passed to app-authored auth email templates. */
export interface AuthEmailTemplateContext {
  key: AuthEmailTemplateKey;
  branding: ResolvedAuthEmailBranding;
  user: AuthEmailTemplateUser;
  actionUrl?: string;
  code?: string;
  expiresAt?: number;
  tokenType?: string;
  defaultSubject: string;
  defaultText: string;
  defaultHtml: string;
  metadata: Record<string, unknown>;
}

/** One app-authored auth email template. */
export type AuthEmailTemplate = (
  context: AuthEmailTemplateContext
) => AuthEmailTemplateResult | Promise<AuthEmailTemplateResult>;

/** Registry of app-authored auth email templates keyed by platform event. */
export type AuthEmailTemplates = Partial<Record<AuthEmailTemplateKey, AuthEmailTemplate>>;

const DEFAULT_AUTH_EMAIL_BRAND_COLOR = '#2563eb';

/**
 * Type helper for app auth email template registries.
 *
 * Returns the registry unchanged at runtime while preserving literal key
 * inference for each template file an app imports.
 */
export function defineAuthEmailTemplates<const T extends AuthEmailTemplates>(templates: T): T {
  return templates;
}

/** Merge app identity with auth-specific branding for one email render. */
export function resolveAuthEmailBranding(
  app: AppIdentityConfig,
  config: AuthEmailBrandingConfig = {}
): ResolvedAuthEmailBranding {
  return {
    appName: firstNonEmptyRequired('Zero app', config.appName, app.name),
    publicUrl: firstNonEmpty(config.publicUrl, app.publicUrl),
    logoUrl: firstNonEmpty(config.logoUrl),
    supportEmail: firstNonEmpty(config.supportEmail, app.supportEmail),
    brandColor: firstNonEmptyRequired(DEFAULT_AUTH_EMAIL_BRAND_COLOR, config.brandColor),
  };
}

function firstNonEmptyRequired(fallback: string, ...values: Array<string | undefined>): string {
  return firstNonEmpty(...values, fallback) ?? fallback;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}
