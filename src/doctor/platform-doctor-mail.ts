/** Configuration-only mail diagnostics: never connects, logs credentials, or sends a probe. */
import { inspectMailConnection } from '../email/mail-connection-config';
import type { EmailConfig } from '../email/types';
import type { PlatformDoctorFindingSink } from './platform-doctor-contracts';

export function checkMailConfiguration(email: false | EmailConfig, env: Record<string, string | undefined>, findings: PlatformDoctorFindingSink): void {
  if (!email) return;
  if (typeof email.provider === 'string' && !['resend', 'smtp', 'console', 'memory', 'noop'].includes(email.provider)) {
    findings.push({ severity: 'error', code: 'email.provider.invalid', path: 'email.provider', message: 'Email provider is not supported.' });
  }
  if (email.provider === 'smtp') {
    const resolved = inspectMailConnection('smtp', email.smtp, env);
    for (const issue of resolved.issues) findings.push({
      severity: 'error', code: 'email.smtp.config_invalid', path: `email.smtp${issue.field ? '.' + issue.field : ''}`,
      message: issue.message, docs: './docs-next/backend/email/smtp.md',
    });
    if (!resolved.settings.secure && !resolved.settings.requireTLS) findings.push({ severity: 'warning', code: 'email.smtp.tls_optional', path: 'email.smtp.requireTLS', message: 'SMTP may transmit credentials or messages without TLS. Use this only for a deliberately trusted development relay.' });
  }
  if (email.imap) {
    const { maxMessageBytes, sentFolder, ...connection } = email.imap === true ? {} : email.imap;
    if (sentFolder !== undefined && (typeof sentFolder !== 'string' || !sentFolder || sentFolder.length > 512 || /[\x00\r\n]/.test(sentFolder))) findings.push({ severity: 'error', code: 'email.imap.config_invalid', path: 'email.imap.sentFolder', message: 'A valid sent-folder path is required.' });
    const resolved = inspectMailConnection('imap', connection, env);
    for (const issue of resolved.issues) findings.push({
      severity: 'error', code: 'email.imap.config_invalid', path: `email.imap${issue.field ? '.' + issue.field : ''}`,
      message: issue.message, docs: './docs-next/backend/email/mailbox.md',
    });
    if (maxMessageBytes !== undefined && (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes < 1 || maxMessageBytes > 100 * 1024 * 1024)) findings.push({
      severity: 'error', code: 'email.imap.config_invalid', path: 'email.imap.maxMessageBytes', message: 'Maximum message size must be between 1 byte and 100 MiB.',
    });
    if (!resolved.settings.secure && !resolved.settings.requireTLS) findings.push({ severity: 'warning', code: 'email.imap.tls_optional', path: 'email.imap.requireTLS', message: 'IMAP may transmit credentials without TLS. Use this only for a deliberately trusted development server.' });
  }
}
