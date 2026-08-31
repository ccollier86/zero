/**
 * resend-email-provider.ts
 *
 * Resend-backed EmailProvider. This file owns the Resend HTTP API mapping
 * only; auth/account lifecycle services supply templates and policy.
 */

import { EmailError } from './email-error';
import {
  EMAIL_PROVIDER_REQUEST_REJECTED,
  isDeterministicEmailProviderRejection,
} from './email-failure-policy';
import type { EmailMessage, EmailProvider, EmailSendResult, ResendEmailProviderConfig } from './types';

interface ResendSendResponse {
  id?: string;
}

/** Production email provider using Resend's send-email API. */
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;

  constructor(config: ResendEmailProviderConfig = {}) {
    this.apiKey = config.apiKey ?? Bun.env.RESEND_API_KEY;
    this.baseUrl = config.baseUrl ?? 'https://api.resend.com';
  }

  /**
   * Send one message through Resend.
   *
   * Throws EmailError when the API key is missing or Resend returns a non-2xx
   * response. Raw provider credentials are never included in thrown metadata.
   */
  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (!this.apiKey) {
      throw new EmailError('Resend API key is required', 'EMAIL_PROVIDER_MISCONFIGURED', 500);
    }

    const accepted = normalizeRecipients(message.to);
    const response = await fetch(`${this.baseUrl}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...(message.idempotencyKey
          ? { 'Idempotency-Key': message.idempotencyKey }
          : {}),
      },
      signal: message.signal,
      body: JSON.stringify({
        from: message.from,
        to: accepted,
        subject: message.subject,
        text: message.text,
        html: message.html,
        reply_to: message.replyTo,
        tags: message.tags ? mapTags(message.tags) : undefined,
      }),
    });

    if (!response.ok) {
      throw new EmailError(
        'Email provider request failed',
        isDeterministicEmailProviderRejection(response.status)
          ? EMAIL_PROVIDER_REQUEST_REJECTED
          : 'EMAIL_SEND_FAILED',
        response.status
      );
    }
    const body = await response.json().catch(() => null) as ResendSendResponse | null;

    return {
      id: body?.id,
      provider: this.name,
      accepted,
    };
  }
}

function normalizeRecipients(to: string | string[]): string[] {
  return Array.isArray(to) ? to : [to];
}

function mapTags(tags: Record<string, string>): Array<{ name: string; value: string }> {
  return Object.entries(tags).map(([name, value]) => ({ name, value }));
}
