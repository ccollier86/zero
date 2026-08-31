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
export {
  configureEmail,
  getEmailRuntime,
  getEmailService,
  isEmailDeliveryReady,
} from './runtime';
export type {
  AppIdentityConfig,
  BuiltInEmailProvider,
  EmailConfig,
  EmailMessage,
  EmailProvider,
  EmailRuntime,
  EmailSendResult,
  EmailServiceLike,
  ResendEmailProviderConfig,
} from './types';
