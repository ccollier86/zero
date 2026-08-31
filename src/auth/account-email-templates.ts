/**
 * account-email-templates.ts
 *
 * Owns the default system email templates for auth/account lifecycle. These
 * functions are pure render helpers; they do not send email, read config, or
 * mutate auth state.
 */

import type { UserRecord } from './types';
import type {
  AuthEmailTemplateResult,
  ResolvedAuthEmailBranding,
} from './auth-email-templates';

/** Shared context for account lifecycle email templates. */
export interface AccountEmailTemplateContext {
  branding: ResolvedAuthEmailBranding;
  actionUrl?: string;
  code?: string;
  user: UserRecord;
  expiresAt: number;
}

/** Render the default account setup email. */
export function renderAccountSetupEmail(
  ctx: AccountEmailTemplateContext
): AuthEmailTemplateResult {
  const subject = `Set up your ${ctx.branding.appName} account`;
  const text = [
    `Your ${ctx.branding.appName} account is ready.`,
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
    html: renderHtml(subject, text, ctx),
  };
}

/** Render the default password reset email. */
export function renderPasswordResetEmail(
  ctx: AccountEmailTemplateContext
): AuthEmailTemplateResult {
  const subject = `Reset your ${ctx.branding.appName} password`;
  const text = [
    `A password reset was requested for your ${ctx.branding.appName} account.`,
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
    html: renderHtml(subject, text, ctx),
  };
}

/** Render the default email verification email. */
export function renderEmailVerificationEmail(
  ctx: AccountEmailTemplateContext
): AuthEmailTemplateResult {
  const subject = `Verify your ${ctx.branding.appName} email`;
  const text = [
    `Verify the email address for your ${ctx.branding.appName} account.`,
    '',
    'Confirm this email using this one-time link:',
    ctx.actionUrl,
    '',
    `This link expires ${formatExpiration(ctx.expiresAt)}.`,
    '',
    'If you did not create this account, you can ignore this email.',
  ].join('\n');

  return {
    subject,
    text,
    html: renderHtml(subject, text, ctx),
  };
}

/** Render the default email OTP challenge email. */
export function renderEmailOtpEmail(
  ctx: AccountEmailTemplateContext
): AuthEmailTemplateResult {
  const subject = `Your ${ctx.branding.appName} verification code`;
  const text = [
    `Use this code to finish signing in to ${ctx.branding.appName}:`,
    '',
    ctx.code ?? '',
    '',
    `This code expires ${formatExpiration(ctx.expiresAt)}.`,
    '',
    'If you did not request this code, you can ignore this email.',
  ].join('\n');

  return {
    subject,
    text,
    html: renderHtml(subject, text, ctx),
  };
}

function formatExpiration(expiresAt: number): string {
  return new Date(expiresAt).toISOString();
}

function renderHtml(
  subject: string,
  text: string,
  ctx: AccountEmailTemplateContext
): string {
  const logo = ctx.branding.logoUrl
    ? renderLogo(ctx.branding.logoUrl, ctx.branding.appName)
    : '';
  const support = ctx.branding.supportEmail
    ? renderSupport(ctx.branding.supportEmail)
    : '';
  const action = ctx.actionUrl
    ? renderActionButton(ctx.actionUrl, ctx.branding.brandColor)
    : '';

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<body style="margin:0;background:#f8fafc;color:#0f172a;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">',
    '<div style="padding:32px">',
    '<main style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:32px;box-shadow:0 18px 60px rgba(15,23,42,.08)">',
    logo,
    `<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25">${escapeHtml(subject)}</h1>`,
    `<pre style="margin:0;font-family:inherit;white-space:pre-wrap;line-height:1.6;color:#334155">${escapeHtml(text)}</pre>`,
    action,
    support,
    '</main>',
    '</div>',
    '</body>',
    '</html>',
  ].join('');
}

function renderLogo(logoUrl: string, appName: string): string {
  return [
    `<img src="${escapeAttribute(logoUrl)}"`,
    ` alt="${escapeAttribute(appName)}"`,
    ' style="display:block;max-height:40px;margin:0 0 24px" />',
  ].join('');
}

function renderSupport(supportEmail: string): string {
  return [
    '<p style="margin:24px 0 0;color:#64748b;font-size:13px">',
    `Need help? Contact ${escapeHtml(supportEmail)}.`,
    '</p>',
  ].join('');
}

function renderActionButton(actionUrl: string, brandColor: string): string {
  return [
    '<p style="margin:28px 0">',
    `<a href="${escapeAttribute(actionUrl)}"`,
    ` style="display:inline-block;background:${escapeAttribute(brandColor)};color:#fff;text-decoration:none;font-weight:700;border-radius:10px;padding:12px 18px">`,
    'Open secure link',
    '</a>',
    '</p>',
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

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('`', '&#096;');
}
