/**
 * account-email-templates.ts
 *
 * Owns the default system email templates for auth/account lifecycle. These
 * functions are pure render helpers; they do not send email, read config, or
 * mutate auth state.
 */

import type { UserRecord } from './types';

/** Shared context for account lifecycle email templates. */
export interface AccountEmailTemplateContext {
  appName: string;
  actionUrl: string;
  user: UserRecord;
  expiresAt: number;
}

/** Render the default account setup email. */
export function renderAccountSetupEmail(ctx: AccountEmailTemplateContext) {
  const subject = `Set up your ${ctx.appName} account`;
  const text = [
    `Your ${ctx.appName} account is ready.`,
    '',
    `Username: ${ctx.user.username}`,
    '',
    'Set your password using this one-time link:',
    ctx.actionUrl,
    '',
    `This link expires ${formatExpiration(ctx.expiresAt)}.`,
  ].join('\n');

  return {
    subject,
    text,
    html: renderHtml(subject, text),
  };
}

/** Render the default password reset email. */
export function renderPasswordResetEmail(ctx: AccountEmailTemplateContext) {
  const subject = `Reset your ${ctx.appName} password`;
  const text = [
    `A password reset was requested for your ${ctx.appName} account.`,
    '',
    'Set a new password using this one-time link:',
    ctx.actionUrl,
    '',
    `This link expires ${formatExpiration(ctx.expiresAt)}.`,
    '',
    'If you did not request this, you can ignore this email.',
  ].join('\n');

  return {
    subject,
    text,
    html: renderHtml(subject, text),
  };
}

function formatExpiration(expiresAt: number): string {
  return new Date(expiresAt).toISOString();
}

function renderHtml(subject: string, text: string): string {
  return [
    '<!doctype html>',
    '<html>',
    '<body>',
    `<h1>${escapeHtml(subject)}</h1>`,
    `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
    '</body>',
    '</html>',
  ].join('');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
