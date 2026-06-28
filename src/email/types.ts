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

/** Message shape accepted by platform email providers. */
export interface EmailMessage {
  /** Recipient address or addresses. */
  to: string | string[];
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
  /** Provider-supported tags for delivery analytics. */
  tags?: Record<string, string>;
  /** Internal platform metadata. Never sent to external providers by default. */
  metadata?: Record<string, unknown>;
}

/** Provider send result normalized across email vendors. */
export interface EmailSendResult {
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
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/** Built-in provider names accepted by email config. */
export type BuiltInEmailProvider = 'resend' | 'console' | 'memory' | 'noop';

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
}

/** Active email runtime used by platform services. */
export interface EmailRuntime {
  enabled: boolean;
  app: AppIdentityConfig;
  config: EmailConfig | false | undefined;
  service: EmailServiceLike;
  provider: EmailProvider;
}

/** Minimal service shape exposed from the runtime. */
export interface EmailServiceLike {
  send(message: EmailMessage): Promise<EmailSendResult>;
}
