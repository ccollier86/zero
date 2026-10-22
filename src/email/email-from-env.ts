/** Optional starter/config convenience. Nothing is enabled without provider configuration. */
import { EmailError } from './email-error';
import { inspectMailConnection } from './mail-connection-config';
import type { BuiltInEmailProvider, EmailConfig, MailConnectionConfig } from './types';

export function emailFromEnv(env: Record<string, string | undefined> = process.env): EmailConfig | false {
  const text = (key: string) => env[key]?.trim() || undefined;
  const selected = text('EMAIL_PROVIDER');
  if (selected === 'false') return false;
  const provider = selected ?? (text('RESEND_API_KEY') ? 'resend' : text('SMTP_HOST') ? 'smtp' : text('IMAP_HOST') ? 'noop' : undefined);
  if (!provider) return false;
  if (!['resend', 'smtp', 'console', 'memory', 'noop'].includes(provider)) throw new EmailError('EMAIL_PROVIDER must name a supported provider or false', 'EMAIL_PROVIDER_MISCONFIGURED', 500);
  const connection = (prefix: 'SMTP' | 'IMAP'): MailConnectionConfig => {
    const boolean = (key: string): boolean | undefined => {
      const value = text(key);
      if (value === undefined) return undefined;
      if (value === 'true') return true;
      if (value === 'false') return false;
      throw new EmailError(`${key} must be true or false`, 'EMAIL_PROVIDER_MISCONFIGURED', 500);
    };
    const user = env[`${prefix}_USER`], pass = env[`${prefix}_PASSWORD`];
    const input = { host: env[`${prefix}_HOST`], port: text(`${prefix}_PORT`) ? Number(env[`${prefix}_PORT`]) : undefined,
      secure: boolean(`${prefix}_SECURE`), requireTLS: boolean(`${prefix}_REQUIRE_TLS`),
      auth: user !== undefined || pass !== undefined ? { user, pass } : undefined,
    };
    const { settings } = inspectMailConnection(prefix === 'SMTP' ? 'smtp' : 'imap', input, env);
    // Fill defaults/missing credentials now so another app's later ambient env
    // cannot supply a different port, TLS policy or login to this captured map.
    return { host: settings.host, port: settings.port, secure: settings.secure, requireTLS: settings.requireTLS,
      auth: settings.auth ?? { user: '', pass: '' }, timeoutMs: settings.timeoutMs,
    };
  };
  return { provider: provider as BuiltInEmailProvider, from: text('EMAIL_FROM'), replyTo: text('EMAIL_REPLY_TO'),
    ...(provider === 'resend' ? { resend: { apiKey: env.RESEND_API_KEY ?? '' } } : {}),
    ...(provider === 'smtp' ? { smtp: connection('SMTP') } : {}),
    ...(text('IMAP_HOST') ? { imap: { ...connection('IMAP'), sentFolder: text('IMAP_SENT_FOLDER') } } : {}),
  };
}
