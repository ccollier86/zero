/**
 * memory-email-provider.ts
 *
 * In-memory EmailProvider for tests and local inspection. This provider owns
 * captured message storage only; it does not call external email APIs.
 */

import type { EmailMessage, EmailProvider, EmailSendResult } from './types';
import { recipients } from './email-message';
import { prepareEmailAttachments } from './email-attachments';

export interface CapturedEmail {
  id: string;
  message: EmailMessage;
  sentAt: number;
}

/** Test/local provider that records sent messages in memory. */
export class MemoryEmailProvider implements EmailProvider {
  readonly name = 'memory';
  readonly supportsAttachments = true;
  readonly messages: CapturedEmail[] = [];
  private nextId = 0;

  /** Store a message in memory and return a normalized send result. */
  async send(message: EmailMessage): Promise<EmailSendResult> {
    message = { ...message, attachments: prepareEmailAttachments(message.attachments, this) };
    const id = `email_${++this.nextId}`;
    this.messages.push({ id, message, sentAt: Date.now() });

    return {
      id,
      provider: this.name,
      accepted: [...recipients(message.to), ...recipients(message.cc), ...recipients(message.bcc)],
    };
  }

  /** Clear all captured messages. */
  clear(): void {
    this.messages.length = 0;
  }
}
