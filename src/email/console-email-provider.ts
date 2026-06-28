/**
 * console-email-provider.ts
 *
 * Development EmailProvider that routes message previews through Zero's
 * observability boundary instead of writing directly to console.
 */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { EmailMessage, EmailProvider, EmailSendResult } from './types';

/** Local development provider that emits email previews as observability events. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';

  /** Emit a sanitized preview event and return a successful send result. */
  async send(message: EmailMessage): Promise<EmailSendResult> {
    const accepted = normalizeRecipients(message.to);
    emitPlatformCode(OBS_CODES.EMAIL_CONSOLE_PREVIEW, {
      metadata: {
        to: accepted,
        from: message.from,
        subject: message.subject,
      },
    });

    return {
      provider: this.name,
      accepted,
    };
  }
}

function normalizeRecipients(to: string | string[]): string[] {
  return Array.isArray(to) ? to : [to];
}
