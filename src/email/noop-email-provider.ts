/**
 * noop-email-provider.ts
 *
 * EmailProvider implementation for explicitly disabled email. It accepts
 * messages without network work; it does not render templates or persist mail.
 */

import type { EmailMessage, EmailProvider, EmailSendResult } from './types';
import { recipients } from './email-message';

/** Email provider used when email is disabled or intentionally swallowed. */
export class NoopEmailProvider implements EmailProvider {
  readonly name = 'noop';

  /** Accept a message without delivering it. */
  async send(message: EmailMessage): Promise<EmailSendResult> {
    return {
      provider: this.name,
      accepted: [...recipients(message.to), ...recipients(message.cc), ...recipients(message.bcc)],
    };
  }
}
