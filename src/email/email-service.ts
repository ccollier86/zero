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
import type { ImapMailbox } from './imap-mailbox';
import { recipients, snapshotEmailMessage } from './email-message';
import type { EmailSendAudit } from './email-send-audit';
import { isDeterministicEmailProviderRejection } from './email-failure-policy';

/** Runtime service that applies defaults and delegates to a provider. */
export class EmailService {
  private readonly sentFolder: string | undefined;
  constructor(
    private readonly provider: EmailProvider,
    private readonly config: EmailConfig = {},
    private readonly emitCode: typeof emitPlatformCode = emitPlatformCode,
    private readonly mailbox: ImapMailbox | null = null,
    private readonly audit?: EmailSendAudit,
  ) { this.sentFolder = typeof config.imap === 'object' ? config.imap.sentFolder : undefined; }

  /**
   * Send an email message through the configured provider.
   *
   * Applies default `from` and `replyTo`, validates minimum send fields, emits
   * stable observability events, and never logs message bodies or secrets.
   */
  async send(message: EmailMessage): Promise<EmailSendResult> {
    const resolved = snapshotEmailMessage({
      ...message,
      from: message.from ?? this.config.from,
      replyTo: message.replyTo ?? this.config.replyTo,
    }, this.provider);

    this.emitCode(OBS_CODES.EMAIL_SEND_REQUESTED, {
      metadata: {
        provider: this.provider.name,
        toCount: recipients(resolved.to).length,
      },
    });

    const audit = this.audit?.prepare(this.provider.name);
    if (audit) await audit.admit();

    let providerAccepted = false;
    try {
      const result = { ...await this.provider.send(resolved) };
      providerAccepted = result.accepted.length > 0;
      if (audit) {
        try { await audit.finish(providerAccepted ? 'accepted' : 'rejected', { acceptedCount: result.accepted.length, rejectedCount: result.rejected?.length ?? 0 }); }
        catch { throw new EmailError('Email provider outcome requires reconciliation; do not automatically send another copy.', 'EMAIL_SEND_OUTCOME_UNKNOWN', 409); }
      }
      const sentFolder = this.sentFolder;
      if (this.mailbox && sentFolder && result.accepted.length > 0 && !['noop', 'console', 'memory'].includes(this.provider.name)) {
        try {
          await this.mailbox.append(resolved, { folder: sentFolder, messageId: result.provider === 'smtp' ? result.id : undefined, signal: resolved.signal });
          result.sentCopy = 'saved';
        } catch {
          // Sending already succeeded. Do not throw and cause an outbox/app to send a duplicate.
          result.sentCopy = 'failed';
          this.emitCode(OBS_CODES.EMAIL_SENT_COPY_FAILED, { metadata: { provider: result.provider } });
        }
      }
      this.emitCode(OBS_CODES.EMAIL_SENT, {
        metadata: {
          provider: result.provider,
          id: result.id,
          acceptedCount: result.accepted.length,
          rejectedCount: result.rejected?.length ?? 0,
        },
      });
      return result;
    } catch (error) {
      if (error instanceof EmailError && error.code === 'EMAIL_SEND_OUTCOME_UNKNOWN') throw error;
      if (audit) {
        try { await audit.finish(providerAccepted ? 'accepted' : error instanceof EmailError && isDeterministicEmailProviderRejection(error.status) ? 'rejected' : 'unknown'); }
        catch { throw new EmailError('Email provider outcome requires reconciliation; do not automatically send another copy.', 'EMAIL_SEND_OUTCOME_UNKNOWN', 409); }
      }
      const deliveryError = normalizeProviderError(error);
      this.emitCode(OBS_CODES.EMAIL_SEND_FAILED, {
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
