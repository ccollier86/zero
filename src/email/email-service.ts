/**
 * email-service.ts
 *
 * Framework-neutral platform email service. It applies app/default email
 * config, delegates delivery to an EmailProvider, and emits observability
 * events; it does not own auth templates or account lifecycle policy.
 */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { EmailError } from './email-error';
import { safeEmailFailureCode } from './email-failure-policy';
import type { EmailConfig, EmailMessage, EmailProvider, EmailSendResult } from './types';

/** Runtime service that applies defaults and delegates to a provider. */
export class EmailService {
  constructor(
    private readonly provider: EmailProvider,
    private readonly config: EmailConfig = {}
  ) {}

  /**
   * Send an email message through the configured provider.
   *
   * Applies default `from` and `replyTo`, validates minimum send fields, emits
   * stable observability events, and never logs message bodies or secrets.
   */
  async send(message: EmailMessage): Promise<EmailSendResult> {
    const resolved: EmailMessage = {
      ...message,
      from: message.from ?? this.config.from,
      replyTo: message.replyTo ?? this.config.replyTo,
    };

    validateMessage(resolved);

    emitPlatformCode(OBS_CODES.EMAIL_SEND_REQUESTED, {
      metadata: {
        provider: this.provider.name,
        toCount: normalizeRecipients(resolved.to).length,
      },
    });

    try {
      const result = await this.provider.send(resolved);
      emitPlatformCode(OBS_CODES.EMAIL_SENT, {
        metadata: {
          provider: result.provider,
          id: result.id,
          acceptedCount: result.accepted.length,
          rejectedCount: result.rejected?.length ?? 0,
        },
      });
      return result;
    } catch (error) {
      const deliveryError = normalizeProviderError(error);
      emitPlatformCode(OBS_CODES.EMAIL_SEND_FAILED, {
        metadata: {
          provider: this.provider.name,
          code: safeEmailFailureCode(deliveryError),
          status: deliveryError.status,
        },
      });
      throw deliveryError;
    }
  }
}

function normalizeProviderError(error: unknown): EmailError {
  if (error instanceof EmailError) return error;
  return new EmailError(
    'Email provider request failed',
    'EMAIL_SEND_FAILED',
    502
  );
}

function validateMessage(message: EmailMessage): void {
  if (!message.from) {
    throw new EmailError('Email `from` address is required', 'EMAIL_FROM_REQUIRED', 500);
  }
  if (normalizeRecipients(message.to).length === 0) {
    throw new EmailError('At least one email recipient is required', 'EMAIL_RECIPIENT_REQUIRED', 400);
  }
  if (!message.subject.trim()) {
    throw new EmailError('Email subject is required', 'EMAIL_SUBJECT_REQUIRED', 400);
  }
  if (!message.text.trim() && !message.html?.trim()) {
    throw new EmailError('Email text or HTML body is required', 'EMAIL_BODY_REQUIRED', 400);
  }
}

function normalizeRecipients(to: string | string[]): string[] {
  return (Array.isArray(to) ? to : [to]).filter((value) => value.trim().length > 0);
}
