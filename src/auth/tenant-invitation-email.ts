import type {
  AuthEmailTemplateResult,
  ResolvedAuthEmailBranding,
} from './auth-email-templates';

export interface TenantInvitationEmailContext {
  branding: ResolvedAuthEmailBranding;
  tenant: { name: string };
  actionUrl: string;
  expiresAt: number;
}

/** Pure default renderer used when an app does not supply a template hook. */
export function renderTenantInvitationEmail(
  context: TenantInvitationEmailContext,
): AuthEmailTemplateResult {
  const subject = `Join ${context.tenant.name} on ${context.branding.appName}`;
  const text = [
    `You have been invited to join ${context.tenant.name} on ${context.branding.appName}.`,
    '',
    'Accept this invitation using the one-time link:',
    context.actionUrl,
    '',
    `This link expires ${new Date(context.expiresAt).toISOString()}.`,
    '',
    'If you were not expecting this invitation, you can ignore this email.',
  ].join('\n');
  return {
    subject,
    text,
    html: [
      '<!doctype html><html lang="en"><body',
      ' style="margin:0;background:#f8fafc;color:#0f172a;',
      'font-family:Inter,ui-sans-serif,system-ui,sans-serif">',
      '<div style="padding:32px"><main style="max-width:560px;margin:0 auto;',
      'background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:32px">',
      `<h1 style="margin:0 0 16px;font-size:24px">${escapeHtml(subject)}</h1>`,
      `<p style="line-height:1.6;color:#334155">${escapeHtml(text.split('\n\n')[0]!)}</p>`,
      '<p style="margin:28px 0">',
      `<a href="${escapeHtml(context.actionUrl)}" style="display:inline-block;`,
      `background:${escapeHtml(context.branding.brandColor)};color:#fff;`,
      'text-decoration:none;font-weight:700;border-radius:10px;padding:12px 18px">',
      'Accept invitation</a></p>',
      `<p style="line-height:1.6;color:#64748b">This link expires ${escapeHtml(
        new Date(context.expiresAt).toISOString(),
      )}.</p>`,
      '</main></div></body></html>',
    ].join(''),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
    .replaceAll('`', '&#096;');
}
