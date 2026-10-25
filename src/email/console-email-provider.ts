/**
 * console-email-provider.ts
 *
 * Development EmailProvider that routes message previews through Zero's
 * observability boundary instead of writing directly to console.
 */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { EmailMessage, EmailProvider, EmailSendResult } from './types';
import { recipients } from './email-message';
import { prepareEmailAttachments } from './email-attachments';

/** Local development provider that emits email previews as observability events. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  readonly supportsAttachments = false;

  constructor(
    private readonly emitCode: typeof emitPlatformCode = emitPlatformCode,
  ) {}

  /** Emit a sanitized preview event and return a successful send result. */
  async send(message: EmailMessage): Promise<EmailSendResult> {
    prepareEmailAttachments(message.attachments, this);
    const accepted = [...recipients(message.to), ...recipients(message.cc), ...recipients(message.bcc)];
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
