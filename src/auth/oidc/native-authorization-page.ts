/** Platform-owned user confirmation page for native public clients. */

import { escapeHtml, nativeHtml } from './native-http';

export function nativeAuthorizationPage(input: {
  clientName: string;
  rawRequestId: string;
  scopes: string[];
  userEmail: string;
}): Response {
  const client = escapeHtml(input.clientName);
  const requestId = escapeHtml(input.rawRequestId);
  const email = escapeHtml(input.userEmail);
  const disclosures = scopeDisclosures(input.scopes)
    .map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  return nativeHtml(`<main><style>${STYLES}</style>
    <section><p class="brand">Zero</p><h1>Continue to ${client}?</h1>
    <p>You are signed in as <strong>${email}</strong>.</p>
    <p>${client} is requesting:</p><ul>${disclosures}</ul>
    <p class="permissions">App actions still use your current Zero permissions.</p>
    <form method="post" action="/auth/oauth/authorize">
      <input type="hidden" name="request_id" value="${requestId}">
      <button name="decision" value="approve" type="submit">Continue</button>
      <button class="secondary" name="decision" value="deny" type="submit">Cancel</button>
    </form></section></main>`);
}

function scopeDisclosures(scopes: string[]): string[] {
  const values = ['Your account identity'];
  if (scopes.includes('profile')) values.push('Your name and username');
  if (scopes.includes('email')) values.push('Your email address and verification status');
  return values;
}

const STYLES = `:root{color-scheme:light dark;font-family:system-ui,sans-serif}body{margin:0;background:#0b1018;color:#eef3fb}main{min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box}section{width:min(440px,100%);background:#151d2a;border:1px solid #344155;border-radius:16px;padding:28px;box-sizing:border-box;box-shadow:0 18px 60px #0007}.brand{color:#75a7ff;font-weight:700}h1{font-size:1.65rem;margin:.3rem 0 1rem}p,li{line-height:1.5;color:#c5cfdd}ul{padding-left:1.25rem}.permissions{font-size:.9rem;color:#9eabba}form{display:flex;gap:12px;margin-top:24px}button{border:0;border-radius:9px;padding:11px 18px;font:inherit;font-weight:650;background:#6197f4;color:#09111f;cursor:pointer}.secondary{background:#273246;color:#eef3fb}`;
