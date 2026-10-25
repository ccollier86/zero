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
import { recipients, snapshotEmailMessage } from './email-message';

interface ResendSendResponse {
  id?: string;
}

/** Production email provider using Resend's send-email API. */
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  readonly supportsAttachments = true;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;

  constructor(config: ResendEmailProviderConfig = {}) {
    this.apiKey = config.apiKey ?? Bun.env.RESEND_API_KEY;
    this.baseUrl = config.baseUrl ?? 'https://api.resend.com';
  }

  /** Whether this adapter captured a non-blank credential at construction. */
  isConfigured(): boolean {
    return Boolean(this.apiKey?.trim());
  }

  /**
   * Send one message through Resend.
   *
   * Throws EmailError when the API key is missing or Resend returns a non-2xx
   * response. Raw provider credentials are never included in thrown metadata.
   */
  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (!this.isConfigured()) {
      throw new EmailError('Resend API key is required', 'EMAIL_PROVIDER_MISCONFIGURED', 500);
    }

    message = snapshotEmailMessage(message, this);
    if (message.attachments?.some(attachment => attachment.contentId !== undefined && (!attachment.contentId || attachment.contentId.length >= 128))) {
      throw new EmailError('Resend inline content IDs must contain 1–127 characters', EMAIL_PROVIDER_REQUEST_REJECTED, 422);
    }
    const to = recipients(message.to);
    const accepted = [...to, ...recipients(message.cc), ...recipients(message.bcc)];
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
        to,
        cc: message.cc,
        bcc: message.bcc,
        subject: message.subject,
        text: message.text,
        html: message.html,
        reply_to: message.replyTo,
        headers: message.inReplyTo || message.references?.length ? {
          ...(message.inReplyTo ? { 'In-Reply-To': message.inReplyTo } : {}),
          ...(message.references?.length ? { References: message.references.join(' ') } : {}),
        } : undefined,
        attachments: message.attachments?.map(attachment => ({ filename: attachment.filename, content: Buffer.from(attachment.content).toString('base64'),
          ...(attachment.contentType !== undefined ? { content_type: attachment.contentType } : {}),
          ...(attachment.contentId !== undefined ? { content_id: attachment.contentId } : {}) })),
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
    if (!body || typeof body.id !== 'string' || !body.id || body.id.length > 256) throw new EmailError('Email provider did not return a valid acceptance receipt', 'EMAIL_SEND_FAILED', 502);

    return {
      id: body?.id,
      provider: this.name,
      accepted,
    };
  }
}

function mapTags(tags: Record<string, string>): Array<{ name: string; value: string }> {
  return Object.entries(tags).map(([name, value]) => ({ name, value }));
}
