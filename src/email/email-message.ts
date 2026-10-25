/** Shared message validation and snapshots. Only in-memory MIME inputs enter built-in transports. */
import { EmailError } from './email-error';
import { prepareEmailAttachments } from './email-attachments';
import type { EmailMessage, EmailProvider } from './types';

/** Resolve headers and owned attachment bytes before yielding to a transport. */
export function snapshotEmailMessage(message: EmailMessage, provider?: Pick<EmailProvider, 'supportsAttachments'>): EmailMessage {
  validateEmailMessage(message);
  const attachments = prepareEmailAttachments(message.attachments, provider);
  return {
    ...message,
    to: Array.isArray(message.to) ? [...message.to] : message.to,
    cc: Array.isArray(message.cc) ? [...message.cc] : message.cc,
    bcc: Array.isArray(message.bcc) ? [...message.bcc] : message.bcc,
    references: message.references ? [...message.references] : undefined,
    attachments,
  };
}

export function recipients(value?: string | string[]): string[] {
  return (Array.isArray(value) ? value : value === undefined ? [] : [value]).filter(item => typeof item === 'string' && Boolean(item.trim()));
}

function validateEmailMessage(message: EmailMessage): void {
  if (!message.from) throw new EmailError('Email `from` address is required', 'EMAIL_FROM_REQUIRED', 500);
  if (!recipients(message.to).length) throw new EmailError('At least one email recipient is required', 'EMAIL_RECIPIENT_REQUIRED', 400);
  if (typeof message.subject !== 'string' || !message.subject.trim()) throw new EmailError('Email subject is required', 'EMAIL_SUBJECT_REQUIRED', 400);
  if (typeof message.text !== 'string' || (message.html !== undefined && typeof message.html !== 'string') || (!message.text.trim() && !message.html?.trim())) {
    throw new EmailError('Email text or HTML body is required', 'EMAIL_BODY_REQUIRED', 400);
  }
  const header = (value: unknown) => typeof value === 'string' && !/[\x00\r\n]/.test(value);
  for (const value of [message.from, message.replyTo, message.subject, message.inReplyTo]) {
    if (value !== undefined && !header(value)) throw invalid();
  }
  for (const value of [message.to, message.cc, message.bcc]) {
    if (value !== undefined && !(Array.isArray(value) ? value.every(header) : header(value))) throw invalid();
  }
  if (message.references !== undefined && (!Array.isArray(message.references) || message.references.length > 100 || !message.references.every(header))) throw invalid();
}
function invalid() { return new EmailError('Email headers or attachments are invalid', 'EMAIL_MESSAGE_INVALID', 400); }
