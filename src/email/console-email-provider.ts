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

  constructor(
    private readonly emitCode: typeof emitPlatformCode = emitPlatformCode,
  ) {}

  /** Emit a sanitized preview event and return a successful send result. */
  async send(message: EmailMessage): Promise<EmailSendResult> {
    const accepted = normalizeRecipients(message.to);
    this.emitCode(OBS_CODES.EMAIL_CONSOLE_PREVIEW, {
      metadata: {
        recipientCount: accepted.length,
        hasSender: Boolean(message.from),
        hasText: Boolean(message.text),
        hasHtml: Boolean(message.html),
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
