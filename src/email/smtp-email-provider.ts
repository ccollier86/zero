/** Standard SMTP transport behind Zero's provider-independent email facade. */
import SMTPConnection from 'nodemailer/lib/smtp-connection';
import MailComposer from 'nodemailer/lib/mail-composer';
import { EmailError } from './email-error';
import { EMAIL_PROVIDER_REQUEST_REJECTED } from './email-failure-policy';
import { inspectMailConnection } from './mail-connection-config';
import { snapshotEmailMessage } from './email-message';
import type { EmailMessage, EmailProvider, EmailSendResult, SmtpEmailProviderConfig } from './types';

export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  readonly supportsAttachments = true;
  private readonly resolved;
  private readonly active = new Set<() => void>();
  private closed = false;

  constructor(config: SmtpEmailProviderConfig = {}) {
    this.resolved = inspectMailConnection('smtp', config);
  }
  isConfigured(): boolean { return !this.closed && this.resolved.issues.length === 0; }

  /** Verifies connection, TLS and authentication, not delivery to a recipient. */
  async verify(options: { signal?: AbortSignal } = {}): Promise<void> {
    await this.run<void>(options.signal, (_connection, finish) => finish(undefined));
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    message = snapshotEmailMessage(message, this);
    const mime = new MailComposer({
      from: message.from, to: message.to, cc: message.cc, bcc: message.bcc, replyTo: message.replyTo,
      subject: message.subject, text: message.text, html: message.html,
      inReplyTo: message.inReplyTo, references: message.references,
      attachments: message.attachments?.map(value => ({ filename: value.filename, content: Buffer.from(value.content), contentType: value.contentType, cid: value.contentId })),
      // Never forward internal metadata, tags, credentials or action-token correlation keys.
      disableFileAccess: true, disableUrlAccess: true,
    }).compile();
    return this.run<EmailSendResult>(message.signal, (connection, finish) => {
      connection.send(mime.getEnvelope(), mime.createReadStream(), (error, info) => {
        if (error) return finish(undefined, error);
        finish({ provider: this.name, id: mime.messageId(), accepted: info.accepted, rejected: info.rejected });
      });
    });
  }

  close(): void {
    this.closed = true;
    for (const cancel of this.active) cancel();
  }

  private async run<T>(signal: AbortSignal | undefined, work: (connection: SMTPConnection, finish: (value?: T, error?: unknown) => void) => void): Promise<T> {
    if (this.closed) throw new EmailError('SMTP provider is closed', 'EMAIL_DELIVERY_ABORTED', 503);
    if (!this.isConfigured()) throw new EmailError('SMTP configuration is incomplete or invalid', 'EMAIL_PROVIDER_MISCONFIGURED', 500);
    if (signal?.aborted) throw new EmailError('Email delivery was aborted', 'EMAIL_DELIVERY_ABORTED', 503);
    if (this.active.size >= 16) throw new EmailError('SMTP connection limit reached', 'EMAIL_PROVIDER_BUSY', 503);
    const config = this.resolved.settings;
    const connection = new SMTPConnection({
      host: config.host, port: config.port, secure: config.secure,
      requireTLS: config.requireTLS && !config.secure, tls: config.tls,
      connectionTimeout: config.timeoutMs, greetingTimeout: config.timeoutMs,
      socketTimeout: config.timeoutMs, dnsTimeout: config.timeoutMs,
      logger: false, debug: false,
    });
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (value?: T, error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer); signal?.removeEventListener('abort', abort); this.active.delete(abort);
        connection.close();
        if (error) reject(error instanceof EmailError ? error : normalizeSmtpError(error));
        else resolve(value as T);
      };
      const abort = () => finish(undefined, new EmailError('Email delivery was aborted', 'EMAIL_DELIVERY_ABORTED', 503));
      const timer = setTimeout(() => finish(undefined, new EmailError('Email delivery timed out', 'EMAIL_DELIVERY_TIMEOUT', 504)), config.timeoutMs);
      this.active.add(abort);
      signal?.addEventListener('abort', abort, { once: true });
      connection.on('error', error => finish(undefined, error));
      connection.once('end', () => finish(undefined, new EmailError('SMTP connection ended', 'EMAIL_SEND_FAILED', 502)));
      if (signal?.aborted || this.closed) return abort();
      connection.connect(error => {
        if (settled) return;
        if (error) return finish(undefined, error);
        const send = () => { if (!settled) { try { work(connection, finish); } catch (error) { finish(undefined, error); } } };
        if (config.auth) connection.login(config.auth, error => error ? finish(undefined, error) : send());
        else send();
      });
    });
  }
}

/** SMTP reply numbers are not HTTP statuses; convert policy explicitly. Never retain the raw error. */
function normalizeSmtpError(error: unknown): EmailError {
  const value = error && typeof error === 'object' ? error as { code?: string; responseCode?: number } : {};
  if (value.responseCode && value.responseCode >= 400 && value.responseCode < 500) return new EmailError('SMTP server temporarily rejected the request', 'EMAIL_SEND_FAILED', 503);
  if (value.responseCode && value.responseCode >= 500 && value.responseCode < 600) return new EmailError('SMTP server rejected the request', EMAIL_PROVIDER_REQUEST_REJECTED, 422);
  if (['EAUTH', 'ENOAUTH', 'ECONFIG'].includes(value.code ?? '')) return new EmailError('SMTP authentication or configuration was rejected', EMAIL_PROVIDER_REQUEST_REJECTED, 422);
  return new EmailError('SMTP request failed', 'EMAIL_SEND_FAILED', 502);
}
