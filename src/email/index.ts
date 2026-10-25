/**
 * index.ts
 *
 * Public server-side email barrel. Exports provider contracts, built-in
 * adapters, and runtime helpers without exposing auth lifecycle internals.
 */

export { EmailError } from './email-error';
export { EmailService } from './email-service';
export { ConsoleEmailProvider } from './console-email-provider';
export { MemoryEmailProvider, type CapturedEmail } from './memory-email-provider';
export { NoopEmailProvider } from './noop-email-provider';
export { ResendEmailProvider } from './resend-email-provider';
export { SmtpEmailProvider } from './smtp-email-provider';
export { ImapMailbox } from './imap-mailbox';
export { emailFromEnv } from './email-from-env';
export type { EmailInboxConfig, EmailInboxServerAccount } from './inbox/server-types';
export type * from './inbox/contracts';
export type { MailAddress, MailAttachment, MailFolder, MailMessageRef, MailMessageSummary, MailMessage, MailMessagePage, MailListOptions, MailboxSearch, MailboxChange, MailWatchOptions } from './mailbox-types';
export {
  configureEmail,
  createEmailRuntime,
  getEmailRuntime,
  getEmailService,
  getMailboxService,
  isEmailDeliveryReady,
  isEmailAttachmentDeliveryReady,
  registerEmailRuntime,
} from './runtime';
export type {
  AppIdentityConfig,
  BuiltInEmailProvider,
  EmailConfig,
  EmailAttachment,
  EmailMessage,
  EmailProvider,
  EmailRuntime,
  EmailSendResult,
  EmailServiceLike,
  ResendEmailProviderConfig,
  SmtpEmailProviderConfig,
  ImapMailboxConfig,
  MailConnectionConfig,
} from './types';
