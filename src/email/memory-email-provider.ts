/**
 * memory-email-provider.ts
 *
 * In-memory EmailProvider for tests and local inspection. This provider owns
 * captured message storage only; it does not call external email APIs.
 */

import type { EmailMessage, EmailProvider, EmailSendResult } from './types';

export interface CapturedEmail {
  id: string;
  message: EmailMessage;
  sentAt: number;
}

/** Test/local provider that records sent messages in memory. */
export class MemoryEmailProvider implements EmailProvider {
  readonly name = 'memory';
  readonly messages: CapturedEmail[] = [];
  private nextId = 0;

  /** Store a message in memory and return a normalized send result. */
  async send(message: EmailMessage): Promise<EmailSendResult> {
    const id = `email_${++this.nextId}`;
    this.messages.push({ id, message, sentAt: Date.now() });

    return {
      id,
      provider: this.name,
      accepted: normalizeRecipients(message.to),
    };
  }

  /** Clear all captured messages. */
  clear(): void {
    this.messages.length = 0;
  }
}

function normalizeRecipients(to: string | string[]): string[] {
  return Array.isArray(to) ? to : [to];
}
