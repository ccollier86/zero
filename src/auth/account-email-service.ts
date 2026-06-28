/**
 * account-email-service.ts
 *
 * Sends Zero's built-in auth/account lifecycle emails through the platform
 * email runtime. This service owns URL/template selection only; it does not
 * create tokens, change passwords, or register HTTP routes.
 */

import type { EmailRuntime } from '../email/types';
import { AuthError } from './types';
import type { AuthActionTokenRecord, ResolvedAuthBehaviorConfig, UserRecord } from './types';
import {
  renderAccountSetupEmail,
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
    return this.requireEmailRuntime();
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
    const actionUrl = this.createActionUrl(
      runtime.app.publicUrl!,
      this.config.accountEmails.setupPath,
      params.rawToken
    );
    const rendered = renderAccountSetupEmail({
      appName: runtime.app.name ?? 'Zero app',
      actionUrl,
      user: params.user,
      expiresAt: params.token.expiresAt,
    });

    await runtime.service.send({
      to: params.user.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      tags: { category: 'auth', action: 'account_setup' },
      metadata: { userId: params.user.userId, tokenType: params.token.type },
    });
  }

  /**
   * Send a password reset email for user-initiated or admin-forced resets.
   */
  async sendPasswordReset(params: {
    user: UserRecord;
    rawToken: string;
    token: AuthActionTokenRecord;
  }): Promise<void> {
    const runtime = this.assertReady();
    const actionUrl = this.createActionUrl(
      runtime.app.publicUrl!,
      this.config.accountEmails.resetPath,
      params.rawToken
    );
    const rendered = renderPasswordResetEmail({
      appName: runtime.app.name ?? 'Zero app',
      actionUrl,
      user: params.user,
      expiresAt: params.token.expiresAt,
    });

    await runtime.service.send({
      to: params.user.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      tags: { category: 'auth', action: params.token.type },
      metadata: { userId: params.user.userId, tokenType: params.token.type },
    });
  }

  private requireEmailRuntime(): EmailRuntime {
    const runtime = this.getRuntime();
    if (!runtime.enabled) {
      throw new AuthError('Email is not configured', 'EMAIL_NOT_CONFIGURED', 503);
    }
    if (!runtime.app.publicUrl) {
      throw new AuthError('App public URL is required for account emails', 'EMAIL_PUBLIC_URL_REQUIRED', 500);
    }
    return runtime;
  }

  private createActionUrl(publicUrl: string, path: string, token: string): string {
    const base = publicUrl.endsWith('/') ? publicUrl.slice(0, -1) : publicUrl;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${base}${normalizedPath}`);
    url.searchParams.set('token', token);
    return url.toString();
  }
}
