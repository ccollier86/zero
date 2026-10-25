/**
 * types.ts
 *
 * Defines Zero's platform email contracts. These types are framework-neutral:
 * they do not import Elysia, auth services, Resend SDKs, or persistence code.
 */

/** Basic app identity used by system email templates and links. */
export interface AppIdentityConfig {
  /** Human-readable app name used in subjects and body copy. */
  name?: string;
  /** Public origin used to build emailed action links. */
  publicUrl?: string;
  /** Optional support/reply address. */
  supportEmail?: string;
}

/** An owned in-memory MIME part; paths and remote URLs are never accepted. */
export interface EmailAttachment {
  filename: string;
  content: Uint8Array;
  contentType?: string;
  contentId?: string;
}

/** Message shape accepted by platform email providers. */
export interface EmailMessage {
  /** Recipient address or addresses. */
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  /** Sender address. Defaults to configured email `from`. */
  from?: string;
  /** Optional reply-to address. Defaults to configured email `replyTo`. */
  replyTo?: string;
  /** Message subject. */
  subject: string;
  /** Plain text body. */
  text: string;
  /** Optional HTML body. */
  html?: string;
  /** In-memory attachments only; never filesystem paths or remote URLs. */
  attachments?: EmailAttachment[];
  inReplyTo?: string;
  references?: string[];
  /** Provider-supported tags for delivery analytics. */
  tags?: Record<string, string>;
  /** Internal platform metadata. Never sent to external providers by default. */
  metadata?: Record<string, unknown>;
  /** Stable request key for providers supporting idempotency (Resend); SMTP has no such guarantee. */
  idempotencyKey?: string;
  /** Abort delivery when the calling lifecycle no longer owns the attempt. */
  signal?: AbortSignal;
}

/** Provider send result normalized across email vendors. */
export interface EmailSendResult {
  /** Optional IMAP sent-folder copy outcome; failure never reclassifies an accepted send. */
  sentCopy?: 'saved' | 'failed';
  /** Provider message id when available. */
  id?: string;
  /** Provider identifier such as `resend`, `memory`, or `noop`. */
  provider: string;
  /** Addresses accepted for delivery by the provider boundary. */
  accepted: string[];
  /** Addresses rejected or skipped by the provider boundary. */
  rejected?: string[];
}

/** Dependency-inversion boundary used by auth and future platform email. */
export interface EmailProvider {
  readonly name: string;
  /** Explicit file support. Omission preserves plain sends but rejects attachments. */
  readonly supportsAttachments?: boolean;
  send(message: EmailMessage): Promise<EmailSendResult>;
  /** Retire active work owned by this provider; managed runtimes call this on stop. */
  close?(): void | Promise<void>;
}

/** Built-in provider names accepted by email config. */
export type BuiltInEmailProvider = 'resend' | 'smtp' | 'console' | 'memory' | 'noop';

/** SMTP/IMAP settings; explicit values override protocol-prefixed environment variables. */
export interface MailConnectionConfig {
  host?: string;
  port?: number;
  /** Implicit TLS. Inferred from port (465 SMTP, 993 IMAP). */
  secure?: boolean;
  /** Require TLS/STARTTLS; default true. Disable only for a deliberately trusted development relay. */
  requireTLS?: boolean;
  /** Omit to read SMTP_USER/SMTP_PASSWORD or IMAP_USER/IMAP_PASSWORD. SMTP relays may use false. */
  auth?: { user?: string; pass?: string } | false;
  /** Certificate verification is always enabled. Private CAs may be supplied explicitly. */
  tls?: { servername?: string; ca?: string | string[] };
  /** Whole-operation deadline; default 30000 ms. */
  timeoutMs?: number;
}

export interface SmtpEmailProviderConfig extends MailConnectionConfig {}
export interface ImapMailboxConfig extends MailConnectionConfig {
  /** Maximum raw MIME bytes loaded by read()/append(); default 25 MiB. */
  maxMessageBytes?: number;
  /** Optional folder for best-effort copies after accepted sends. Never retries an accepted SMTP send. */
  sentFolder?: string;
}

/** Resend adapter configuration. */
export interface ResendEmailProviderConfig {
  /** Resend API key. Defaults to Bun.env.RESEND_API_KEY when omitted. */
  apiKey?: string;
  /** API base URL. Defaults to https://api.resend.com. */
  baseUrl?: string;
}

/** Email configuration accepted by createApp(). */
export interface EmailConfig {
  /** Default sender. Required for real sends. */
  from?: string;
  /** Optional default reply-to address. */
  replyTo?: string;
  /** Built-in provider name or a custom provider object. Default: `resend`. */
  provider?: BuiltInEmailProvider | EmailProvider;
  /** Resend-specific config when using the Resend provider. */
  resend?: ResendEmailProviderConfig;
  /** Standard SMTP provider; omitted fields use SMTP_* environment variables. */
  smtp?: SmtpEmailProviderConfig;
  /** Optional receiving mailbox. true reads IMAP_*; omitted/false never opens an inbox. */
  imap?: boolean | ImapMailboxConfig;
  /** Optional authenticated email workspace; omitted/false mounts no inbox routes or state store. */
  inbox?: false | import('./inbox/server-types').EmailInboxConfig;
}

/** Active email runtime used by platform services. */
export interface EmailRuntime {
  enabled: boolean;
  app: AppIdentityConfig;
  config: EmailConfig | false | undefined;
  service: EmailServiceLike;
  provider: EmailProvider;
  /** Optional app-local receiving API. Not a browser credential surface. */
  mailbox?: import('./imap-mailbox').ImapMailbox | null;
  /** Close network operations owned by this email runtime. */
  close?(): void | Promise<void>;
}

/** Minimal service shape exposed from the runtime. */
export interface EmailServiceLike {
  send(message: EmailMessage): Promise<EmailSendResult>;
}
