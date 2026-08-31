/**
 * account-email-service.ts
 *
 * Sends Zero's built-in auth/account lifecycle emails through the platform
 * email runtime. This service owns URL/template selection only; it does not
 * create tokens, change passwords, or register HTTP routes.
 */

import { isEmailDeliveryReady } from '../email/runtime';
import type { EmailRuntime } from '../email/types';
import { AuthError } from './types';
import type {
  AuthActionTokenRecord,
  ResolvedAuthBehaviorConfig,
  UserRecord,
} from './types';
import type {
  AuthEmailTemplateContext,
  AuthEmailTemplateKey,
  AuthEmailTemplateResult,
} from './auth-email-templates';
import { resolveAuthEmailBranding } from './auth-email-templates';
import { assertAuthEmailRecipientAccepted } from './auth-action-token-delivery';
import { normalizeNativeAuthContinuation } from './native/continuation';
import {
  renderAccountSetupEmail,
  renderEmailVerificationEmail,
  renderEmailOtpEmail,
  renderPasswordResetEmail,
} from './account-email-templates';

/** Auth account email sender built on the platform email boundary. */
export class AccountEmailService {
  constructor(
    private readonly getRuntime: () => EmailRuntime,
    private readonly config: ResolvedAuthBehaviorConfig
  ) {}

  /**
   * Assert that account email delivery can build action links.
   *
   * Routes call this before mutating user state or creating action tokens so a
   * missing provider/public URL fails without leaving half-applied reset state.
   */
  assertReady(): EmailRuntime {
    const runtime = this.requireEmailRuntime();
    const branding = resolveAuthEmailBranding(runtime.app, this.config.branding);
    this.requirePublicUrl(branding.publicUrl);
    return runtime;
  }

  /**
   * Send an account setup email for an admin-created account.
   *
   * The raw token is embedded only in the delivered email body and never logged
   * by this service.
   */
  async sendAccountSetup(params: {
    user: UserRecord;
    rawToken: string;
    token: AuthActionTokenRecord;
  }): Promise<void> {
    const runtime = this.assertReady();
    const branding = resolveAuthEmailBranding(runtime.app, this.config.branding);
    const publicUrl = this.requirePublicUrl(branding.publicUrl);
    const actionUrl = this.createActionUrl(
      publicUrl,
      this.config.accountEmails.setupPath,
      params.rawToken
    );
    const rendered = await this.renderTemplate(
      'accountSetup',
      {
        branding,
        actionUrl,
        user: params.user,
        expiresAt: params.token.expiresAt,
      },
      {
        userId: params.user.userId,
        tokenId: params.token.tokenId,
        tokenType: params.token.type,
      }
    );

    const result = await runtime.service.send({
      to: params.user.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      tags: { category: 'auth', action: 'account_setup' },
      metadata: { userId: params.user.userId, tokenType: params.token.type },
    });
    assertAuthEmailRecipientAccepted(result, params.user.email);
  }

  /**
   * Send a password reset email for user-initiated or admin-forced resets.
   */
  async sendPasswordReset(params: {
    user: UserRecord;
    rawToken: string;
    token: AuthActionTokenRecord;
    deliveryId?: string;
    signal?: AbortSignal;
  }): Promise<void> {
    const runtime = this.assertReady();
    const branding = resolveAuthEmailBranding(runtime.app, this.config.branding);
    const publicUrl = this.requirePublicUrl(branding.publicUrl);
    const actionUrl = this.createActionUrl(
      publicUrl,
      this.config.accountEmails.resetPath,
      params.rawToken,
      params.token.metadata.nativeContinuation,
    );
    const rendered = await this.renderTemplate(
      'passwordReset',
      {
        branding,
        actionUrl,
        user: params.user,
        expiresAt: params.token.expiresAt,
      },
      {
        userId: params.user.userId,
        tokenId: params.token.tokenId,
        tokenType: params.token.type,
      }
    );

    const result = await runtime.service.send({
      to: params.user.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      tags: { category: 'auth', action: params.token.type },
      metadata: { userId: params.user.userId, tokenType: params.token.type },
      idempotencyKey: params.deliveryId,
      signal: params.signal,
    });
    assertAuthEmailRecipientAccepted(result, params.user.email);
  }

  /**
   * Send an email verification link for a newly registered account.
   */
  async sendEmailVerification(params: {
    user: UserRecord;
    rawToken: string;
    token: AuthActionTokenRecord;
    deliveryId?: string;
    signal?: AbortSignal;
  }): Promise<void> {
    const runtime = this.assertReady();
    const branding = resolveAuthEmailBranding(runtime.app, this.config.branding);
    const publicUrl = this.requirePublicUrl(branding.publicUrl);
    const actionUrl = this.createActionUrl(
      publicUrl,
      this.config.account.emailVerificationPath,
      params.rawToken,
      params.token.metadata.nativeContinuation,
    );
    const rendered = await this.renderTemplate(
      'emailVerification',
      {
        branding,
        actionUrl,
        user: params.user,
        expiresAt: params.token.expiresAt,
      },
      {
        userId: params.user.userId,
        tokenId: params.token.tokenId,
        tokenType: params.token.type,
      }
    );

    const result = await runtime.service.send({
      to: params.user.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      tags: { category: 'auth', action: 'email_verification' },
      metadata: { userId: params.user.userId, tokenType: params.token.type },
      idempotencyKey: params.deliveryId,
      signal: params.signal,
    });
    assertAuthEmailRecipientAccepted(result, params.user.email);
  }

  /**
   * Send an MFA email OTP code.
   *
   * Unlike reset/setup links this delivery path does not require a public URL.
   */
  async sendEmailOtp(params: {
    user: UserRecord;
    code: string;
    expiresAt: number;
    purpose: 'setup' | 'login';
  }): Promise<void> {
    const runtime = this.requireEmailRuntime();
    const branding = resolveAuthEmailBranding(runtime.app, this.config.branding);
    const rendered = await this.renderTemplate(
      'emailOtp',
      {
        branding,
        code: params.code,
        user: params.user,
        expiresAt: params.expiresAt,
      },
      {
        userId: params.user.userId,
        tokenType: 'email_otp',
        purpose: params.purpose,
      }
    );

    const result = await runtime.service.send({
      to: params.user.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      tags: { category: 'auth', action: 'email_otp' },
      metadata: { userId: params.user.userId, purpose: params.purpose },
    });
    assertAuthEmailRecipientAccepted(result, params.user.email);
  }

  private async renderTemplate(
    key: AuthEmailTemplateKey,
    input: Parameters<typeof renderAccountSetupEmail>[0],
    metadata: Record<string, unknown>
  ): Promise<AuthEmailTemplateResult> {
    const defaults = renderDefaultTemplate(key, input);
    const template = this.config.emails[key];

    if (!template) return defaults;

    const rendered = await template({
      key,
      branding: input.branding,
      user: input.user,
      actionUrl: input.actionUrl,
      expiresAt: input.expiresAt,
      tokenType: typeof metadata.tokenType === 'string' ? metadata.tokenType : undefined,
      defaultSubject: defaults.subject,
      defaultText: defaults.text,
      defaultHtml: defaults.html ?? '',
      metadata,
    } satisfies AuthEmailTemplateContext);

    return this.assertRenderedEmail(rendered, key);
  }

  private assertRenderedEmail(
    rendered: AuthEmailTemplateResult,
    key: AuthEmailTemplateKey
  ): AuthEmailTemplateResult {
    if (!rendered.subject?.trim()) {
      throw new AuthError(
        `Auth email template "${key}" returned an empty subject`,
        'AUTH_EMAIL_TEMPLATE_INVALID',
        500
      );
    }
    if (!rendered.text?.trim() && !rendered.html?.trim()) {
      throw new AuthError(
        `Auth email template "${key}" returned an empty body`,
        'AUTH_EMAIL_TEMPLATE_INVALID',
        500
      );
    }
    return rendered;
  }

  private requireEmailRuntime(): EmailRuntime {
    const runtime = this.getRuntime();
    if (!isEmailDeliveryReady(runtime)) {
      throw new AuthError(
        'Email delivery is not fully configured',
        'EMAIL_NOT_CONFIGURED',
        503
      );
    }
    return runtime;
  }

  private requirePublicUrl(publicUrl: string | undefined): string {
    if (!publicUrl) {
      throw new AuthError(
        'App public URL is required for account emails',
        'EMAIL_PUBLIC_URL_REQUIRED',
        500
      );
    }
    return publicUrl;
  }

  private createActionUrl(
    publicUrl: string,
    path: string,
    token: string,
    nativeContinuation?: unknown,
  ): string {
    const base = publicUrl.endsWith('/') ? publicUrl.slice(0, -1) : publicUrl;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${base}${normalizedPath}`);
    url.searchParams.set('token', token);
    const continuation = normalizeNativeAuthContinuation(nativeContinuation);
    if (continuation) url.searchParams.set('redirect', continuation);
    return url.toString();
  }
}

function renderDefaultTemplate(
  key: AuthEmailTemplateKey,
  input: Parameters<typeof renderAccountSetupEmail>[0]
): AuthEmailTemplateResult {
  if (key === 'accountSetup') return renderAccountSetupEmail(input);
  if (key === 'emailVerification') return renderEmailVerificationEmail(input);
  if (key === 'emailOtp') return renderEmailOtpEmail(input);
  return renderPasswordResetEmail(input);
}
