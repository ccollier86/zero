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
  renderDomainMailboxProofEmail,
  renderEmailOtpEmail,
  renderPasswordResetEmail,
} from './account-email-templates';
import { renderTenantInvitationEmail } from './tenant-invitation-email';
import type { AuthTenantInvitationDelivery } from './auth-tenant-onboarding-types';

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
    const user = captureEmailDeliveryUser(params.user);
    const rawToken = params.rawToken;
    const tokenId = params.token.tokenId;
    const tokenType = params.token.type;
    const expiresAt = params.token.expiresAt;
    const runtime = this.assertReady();
    const branding = resolveAuthEmailBranding(runtime.app, this.config.branding);
    const publicUrl = this.requirePublicUrl(branding.publicUrl);
    const actionUrl = this.createActionUrl(
      publicUrl,
      this.config.accountEmails.setupPath,
      rawToken
    );
    const rendered = await this.renderTemplate(
      'accountSetup',
      {
        branding,
        actionUrl,
        user,
        expiresAt,
      },
      {
        userId: user.userId,
        tokenId,
        tokenType,
      }
    );

    const result = await runtime.service.send({
      to: user.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      tags: { category: 'auth', action: 'account_setup' },
      metadata: { userId: user.userId, tokenType },
    });
    assertAuthEmailRecipientAccepted(result, user.email);
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
    const user = captureEmailDeliveryUser(params.user);
    const rawToken = params.rawToken;
    const tokenId = params.token.tokenId;
    const tokenType = params.token.type;
    const expiresAt = params.token.expiresAt;
    const nativeContinuation = params.token.metadata.nativeContinuation;
    const deliveryId = params.deliveryId;
    const signal = params.signal;
    const runtime = this.assertReady();
    const branding = resolveAuthEmailBranding(runtime.app, this.config.branding);
    const publicUrl = this.requirePublicUrl(branding.publicUrl);
    const actionUrl = this.createActionUrl(
      publicUrl,
      this.config.accountEmails.resetPath,
      rawToken,
      nativeContinuation,
    );
    const rendered = await this.renderTemplate(
      'passwordReset',
      {
        branding,
        actionUrl,
        user,
        expiresAt,
      },
      {
        userId: user.userId,
        tokenId,
        tokenType,
      }
    );

    const result = await runtime.service.send({
      to: user.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      tags: { category: 'auth', action: tokenType },
      metadata: { userId: user.userId, tokenType },
      idempotencyKey: deliveryId,
      signal,
    });
    assertAuthEmailRecipientAccepted(result, user.email);
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
    const user = captureEmailDeliveryUser(params.user);
    const rawToken = params.rawToken;
    const tokenId = params.token.tokenId;
    const tokenType = params.token.type;
    const expiresAt = params.token.expiresAt;
    const nativeContinuation = params.token.metadata.nativeContinuation;
    const deliveryId = params.deliveryId;
    const signal = params.signal;
    const runtime = this.assertReady();
    const branding = resolveAuthEmailBranding(runtime.app, this.config.branding);
    const publicUrl = this.requirePublicUrl(branding.publicUrl);
    const actionUrl = this.createActionUrl(
      publicUrl,
      this.config.account.emailVerificationPath,
      rawToken,
      nativeContinuation,
    );
    const rendered = await this.renderTemplate(
      'emailVerification',
      {
        branding,
        actionUrl,
        user,
        expiresAt,
      },
      {
        userId: user.userId,
        tokenId,
        tokenType,
      }
    );

    const result = await runtime.service.send({
      to: user.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      tags: { category: 'auth', action: 'email_verification' },
      metadata: { userId: user.userId, tokenType },
      idempotencyKey: deliveryId,
      signal,
    });
    assertAuthEmailRecipientAccepted(result, user.email);
  }

  /** Deliver the dedicated non-login mailbox proof for domain discovery. */
  async sendDomainMailboxProof(params: {
    user: UserRecord;
    rawToken: string;
    expiresAt: number;
    deliveryId: string;
    signal?: AbortSignal;
  }): Promise<void> {
    const user = captureEmailDeliveryUser(params.user);
    const rawToken = params.rawToken;
    const expiresAt = params.expiresAt;
    const deliveryId = params.deliveryId;
    const signal = params.signal;
    const runtime = this.assertReady();
    const policy = this.config.tenancy?.onboarding?.verifiedDomains;
    if (!policy?.enabled) {
      throw new AuthError(
        'Verified-domain onboarding is disabled',
        'AUTH_DOMAIN_ONBOARDING_UNAVAILABLE',
        503,
      );
    }
    const branding = resolveAuthEmailBranding(runtime.app, this.config.branding);
    const publicUrl = this.requirePublicUrl(branding.publicUrl);
    const actionUrl = this.createActionUrl(
      publicUrl,
      policy.mailboxLandingPath,
      rawToken,
    );
    const rendered = await this.renderTemplate(
      'domainMailboxProof',
      {
        branding,
        actionUrl,
        user,
        expiresAt,
      },
      {
        userId: user.userId,
        tokenType: 'domain_mailbox_proof',
      },
    );
    const result = await runtime.service.send({
      to: user.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      tags: { category: 'auth', action: 'domain_mailbox_proof' },
      metadata: { userId: user.userId, tokenType: 'domain_mailbox_proof' },
      idempotencyKey: deliveryId,
      signal,
    });
    assertAuthEmailRecipientAccepted(result, user.email);
  }

  /** Deliver one tenant-bound invitation from the durable auth outbox. */
  async sendContactVerification(params: {
    user: UserRecord; recipient: string; rawToken: string; expiresAt: number;
    deliveryId: string; signal?: AbortSignal;
  }): Promise<void> {
    const user = captureEmailDeliveryUser(params.user);
    const runtime = this.assertReady();
    const contacts = this.config.userProfile?.contacts;
    if (!this.config.userProfile?.enabled || !contacts?.enabled) {
      throw new AuthError('Contact verification is disabled', 'AUTH_CONTACT_DISABLED', 403);
    }
    const branding = resolveAuthEmailBranding(runtime.app, this.config.branding);
    const actionUrl = this.createActionUrl(this.requirePublicUrl(branding.publicUrl), contacts.verificationPath, params.rawToken);
    // Existing safely escaped first-party verification template; no parallel rendering engine.
    const rendered = await this.renderTemplate('emailVerification', {
      branding, actionUrl, user, expiresAt: params.expiresAt,
    }, { userId: user.userId, tokenType: 'profile_contact_verification' });
    const result = await runtime.service.send({ to: params.recipient, subject: rendered.subject,
      text: rendered.text, html: rendered.html, tags: { category: 'auth', action: 'contact_verification' },
      metadata: { userId: user.userId, tokenType: 'profile_contact_verification' },
      idempotencyKey: params.deliveryId, signal: params.signal });
    assertAuthEmailRecipientAccepted(result, params.recipient);
  }

  /** Deliver one tenant-bound invitation from the durable auth outbox. */
  async sendTenantInvitation(params: {
    delivery: AuthTenantInvitationDelivery;
    rawToken: string;
    deliveryId: string;
    signal?: AbortSignal;
  }): Promise<void> {
    const delivery = captureTenantInvitationDelivery(params.delivery);
    const rawToken = params.rawToken;
    const deliveryId = params.deliveryId;
    const signal = params.signal;
    const runtime = this.assertReady();
    const onboarding = this.config.tenancy?.onboarding;
    if (!onboarding?.invitations.delivery.email.enabled) {
      throw new AuthError(
        'Tenant invitation email delivery is disabled',
        'TENANT_INVITATION_EMAIL_DISABLED',
        503,
      );
    }
    const branding = resolveAuthEmailBranding(runtime.app, this.config.branding);
    const publicUrl = this.requirePublicUrl(branding.publicUrl);
    const actionUrl = this.createActionUrl(
      publicUrl,
      onboarding.invitations.delivery.email.landingPath,
      rawToken,
    );
    const defaults = renderTenantInvitationEmail({
      branding,
      tenant: delivery.tenant,
      actionUrl,
      expiresAt: delivery.expiresAt,
    });
    const template = onboarding.invitations.delivery.email.template;
    let rendered = defaults;
    if (template) {
      let custom: AuthEmailTemplateResult;
      try {
        custom = await template({
          branding: { ...branding },
          recipient: delivery.recipient,
          tenant: { ...delivery.tenant },
          invitation: {
            invitationId: delivery.invitationId,
            roles: [...delivery.roles],
            expiresAt: delivery.expiresAt,
          },
          actionUrl,
          defaultSubject: defaults.subject,
          defaultText: defaults.text,
          defaultHtml: defaults.html ?? '',
        });
      } catch {
        throw authEmailTemplateFailure('tenantInvitation');
      }
      rendered = this.assertRenderedEmail(custom, 'tenantInvitation');
    }

    const result = await runtime.service.send({
      to: delivery.recipient,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      tags: { category: 'auth', action: 'tenant_invitation' },
      metadata: {
        invitationId: delivery.invitationId,
        tenantId: delivery.tenant.tenantId,
      },
      // Stable across retries so provider-side idempotency suppresses a send
      // whose acknowledgement was lost after the provider accepted it.
      idempotencyKey: deliveryId,
      signal,
    });
    assertAuthEmailRecipientAccepted(result, delivery.recipient);
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
    const user = captureEmailDeliveryUser(params.user);
    const code = params.code;
    const expiresAt = params.expiresAt;
    const purpose = params.purpose;
    const runtime = this.requireEmailRuntime();
    const branding = resolveAuthEmailBranding(runtime.app, this.config.branding);
    const rendered = await this.renderTemplate(
      'emailOtp',
      {
        branding,
        code,
        user,
        expiresAt,
      },
      {
        userId: user.userId,
        tokenType: 'email_otp',
        purpose,
      }
    );

    const result = await runtime.service.send({
      to: user.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      tags: { category: 'auth', action: 'email_otp' },
      metadata: { userId: user.userId, purpose },
    });
    assertAuthEmailRecipientAccepted(result, user.email);
  }

  private async renderTemplate(
    key: AuthEmailTemplateKey,
    input: Parameters<typeof renderAccountSetupEmail>[0],
    metadata: Record<string, unknown>
  ): Promise<AuthEmailTemplateResult> {
    const defaults = renderDefaultTemplate(key, input);
    const template = this.config.emails[key];

    if (!template) return defaults;

    let rendered: AuthEmailTemplateResult;
    try {
      rendered = await template({
        key,
        branding: { ...input.branding },
        user: cloneEmailTemplateUser(input.user),
        actionUrl: input.actionUrl,
        code: input.code,
        expiresAt: input.expiresAt,
        tokenType: typeof metadata.tokenType === 'string' ? metadata.tokenType : undefined,
        defaultSubject: defaults.subject,
        defaultText: defaults.text,
        defaultHtml: defaults.html ?? '',
        metadata: { ...metadata },
      } satisfies AuthEmailTemplateContext);
    } catch {
      throw authEmailTemplateFailure(key);
    }

    return this.assertRenderedEmail(rendered, key);
  }

  private assertRenderedEmail(
    rendered: AuthEmailTemplateResult,
    key: AuthEmailTemplateKey | 'tenantInvitation'
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

/** Immutable delivery identity retained across app-authored async templates. */
function captureEmailDeliveryUser(user: UserRecord): UserRecord {
  return Object.freeze({
    userId: user.userId,
    username: user.username,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    passwordChangeRequired: user.passwordChangeRequired,
    emailVerifiedAt: user.emailVerifiedAt,
    emailVerificationRequired: user.emailVerificationRequired,
    mfaRequired: user.mfaRequired,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    properties: Object.freeze({ ...user.properties }),
  });
}

/** Immutable invitation authority retained across app-authored async templates. */
function captureTenantInvitationDelivery(
  delivery: AuthTenantInvitationDelivery,
): AuthTenantInvitationDelivery {
  return Object.freeze({
    invitationId: delivery.invitationId,
    recipient: delivery.recipient,
    roles: Object.freeze([...delivery.roles]),
    expiresAt: delivery.expiresAt,
    tenant: Object.freeze({
      tenantId: delivery.tenant.tenantId,
      name: delivery.tenant.name,
      slug: delivery.tenant.slug,
      kind: delivery.tenant.kind,
    }),
  });
}

/** Public template contexts remain mutable without aliasing delivery authority. */
function cloneEmailTemplateUser(user: UserRecord): AuthEmailTemplateContext['user'] {
  return {
    userId: user.userId,
    username: user.username,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    properties: { ...user.properties },
  };
}

function authEmailTemplateFailure(
  key: AuthEmailTemplateKey | 'tenantInvitation',
): AuthError {
  return new AuthError(
    `Auth email template "${key}" failed`,
    'AUTH_EMAIL_TEMPLATE_INVALID',
    500,
  );
}

function renderDefaultTemplate(
  key: AuthEmailTemplateKey,
  input: Parameters<typeof renderAccountSetupEmail>[0]
): AuthEmailTemplateResult {
  if (key === 'accountSetup') return renderAccountSetupEmail(input);
  if (key === 'emailVerification') return renderEmailVerificationEmail(input);
  if (key === 'domainMailboxProof') return renderDomainMailboxProofEmail(input);
  if (key === 'emailOtp') return renderEmailOtpEmail(input);
  return renderPasswordResetEmail(input);
}
