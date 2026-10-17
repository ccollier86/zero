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
});
