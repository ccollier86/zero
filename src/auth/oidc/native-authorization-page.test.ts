import { describe, expect, test } from 'bun:test';
import { nativeAuthorizationPage } from './native-authorization-page';

describe('native authorization page', () => {
  test('shows requested identity disclosures and escapes provider data', async () => {
    const response = nativeAuthorizationPage({
      clientName: '<Desktop & Mobile>',
      rawRequestId: 'request<&>',
      scopes: ['openid', 'profile', 'email'],
      userEmail: 'person+native@example.test',
    });
    const html = await response.text();

    expect(html).toContain('&lt;Desktop &amp; Mobile&gt;');
    expect(html).toContain('Your account identity');
    expect(html).toContain('Your name and username');
    expect(html).toContain('Your email address and verification status');
    expect(html).toContain('value="request&lt;&amp;&gt;"');
    expect(html).not.toContain('<Desktop & Mobile>');
  });

  test('does not claim profile or email disclosure for openid-only', async () => {
    const response = nativeAuthorizationPage({
      clientName: 'Minimal App', rawRequestId: 'request',
      scopes: ['openid'], userEmail: 'person@example.test',
    });
    const html = await response.text();

    expect(html).toContain('Your account identity');
    expect(html).not.toContain('Your name and username');
    expect(html).not.toContain('Your email address and verification status');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(response.headers.get('permissions-policy')).toContain('camera=()');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });
});
