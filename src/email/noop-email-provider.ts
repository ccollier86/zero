/**
 * noop-email-provider.ts
 *
 * EmailProvider implementation for explicitly disabled email. It accepts
 * messages without network work; it does not render templates or persist mail.
 */

import type { EmailMessage, EmailProvider, EmailSendResult } from './types';
import { recipients } from './email-message';
import { prepareEmailAttachments } from './email-attachments';

/** Email provider used when email is disabled or intentionally swallowed. */
export class NoopEmailProvider implements EmailProvider {
  readonly name = 'noop';
  readonly supportsAttachments = false;

  /** Accept a message without delivering it. */
  async send(message: EmailMessage): Promise<EmailSendResult> {
    prepareEmailAttachments(message.attachments, this);
    return {
      provider: this.name,
      accepted: [...recipients(message.to), ...recipients(message.cc), ...recipients(message.bcc)],
    };
  }
}
