import { describe, expect, test } from 'bun:test';
import { nativeHtml, nativeRedirect } from './native-http';

describe('native browser response security headers', () => {
  test('HTML preserves same-origin form submission and the existing hardening headers', () => {
    for (const status of [200, 400, 503]) {
      const response = nativeHtml('<main>Synthetic authorization page</main>', status);
      expect(response.status).toBe(status);
      expect(response.headers.get('referrer-policy')).toBe('same-origin');
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('pragma')).toBe('no-cache');
      expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
      expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
      expect(response.headers.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=()');
      expect(response.headers.get('x-frame-options')).toBe('DENY');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    }
  });

  test('all redirects, including code-bearing callbacks, retain no-referrer and no-store', () => {
    for (const location of ['/login?redirect=%2Fauth%2Foauth%2Fauthorize',
      'com.example.native:/callback?code=synthetic&state=synthetic',
      'https://native.example/callback?code=synthetic&state=synthetic']) {
      const response = nativeRedirect(location);
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(location);
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-frame-options')).toBe('DENY');
      expect(response.body).toBeNull();
    }
  });

  test('consent permits only the selected private scheme or exact network origin', () => {
    for (const [callback, source] of [
      ['tv.stupify.provisioner:/oauth/callback', 'tv.stupify.provisioner:'],
      ['com.example.native:/callback?channel=app', 'com.example.native:'],
      ['https://native.example.test/oauth/callback', 'https://native.example.test'],
      ['https://native.example.test:8443/callback?channel=app', 'https://native.example.test:8443'],
      ['http://127.0.0.1:49152/callback', 'http://127.0.0.1:49152'],
      ['http://[::1]:49152/callback', 'http://[::1]:49152'],
    ]) {
      const response = nativeHtml('<main>Consent</main>', 200, callback);
      expect(response.headers.get('content-security-policy')).toBe(
        `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${source}; frame-ancestors 'none'; base-uri 'none'`,
      );
      expect(response.headers.get('referrer-policy')).toBe('same-origin');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-frame-options')).toBe('DENY');
    }
  });

  test('callback paths and fixed query strings cannot inject policy directives', () => {
    const callback = 'https://native.example.test/callback;script-src/*?channel=other.example%3Bconnect-src%20*';
    const response = nativeHtml('<main>Consent</main>', 200, callback);
    const policy = response.headers.get('content-security-policy')!;
    expect(policy).toContain("form-action 'self' https://native.example.test;");
    expect(policy).not.toContain('script-src');
    expect(policy).not.toContain('connect-src');
    expect(policy).not.toContain('other.example');
    expect(policy).not.toContain('callback');
  });

  test('invalid or unsafe callbacks fail closed without echoing their value', () => {
    for (const callback of ['javascript:alert(1)', 'data:text/html,test', 'https://*.example.test/cb',
      'https://name:secret@example.test/cb', 'https://native.example.test/cb#fragment',
      'https://native.example.test/cb?code=do-not-log', 'https://native.example.test/\r\nform-action *']) {
      expect(() => nativeHtml('<main>Consent</main>', 200, callback)).toThrow('Invalid native consent callback.');
    }
  });
});
