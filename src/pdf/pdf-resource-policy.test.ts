/** Verifies PDF resource decisions without making network requests. */

import { describe, expect, test } from 'bun:test';

import { resolvePdfConfig } from './pdf-config';
import { evaluatePdfResource, sanitizePdfResourceUrl } from './pdf-resource-policy';

function policy(input: Parameters<typeof resolvePdfConfig>[0]) {
  const resolved = resolvePdfConfig(input, {});
  if (resolved === false) throw new Error('Expected enabled PDF config.');
  return resolved.resources;
}

describe('evaluatePdfResource', () => {
  test('allows inline data but denies remote and file resources by default', () => {
    const defaults = policy(true);
    expect(evaluatePdfResource('data:image/png;base64,AA==', undefined, defaults).allowed).toBe(true);
    expect(evaluatePdfResource('https://example.com/logo.png', undefined, defaults).allowed).toBe(false);
    expect(evaluatePdfResource('file:///etc/passwd', undefined, defaults).allowed).toBe(false);
  });

  test('enforces exact origins and private-network blocking', () => {
    const allowlist = policy({
      resources: {
        remote: 'allowlist',
        allowedOrigins: ['https://assets.example.com'],
      },
    });
    expect(evaluatePdfResource('https://assets.example.com/logo.png', undefined, allowlist).allowed).toBe(true);
    expect(evaluatePdfResource('https://other.example.com/logo.png', undefined, allowlist).allowed).toBe(false);
    expect(evaluatePdfResource('http://127.0.0.1/secret', undefined, allowlist).reason).toBe('private-network');
  });

  test('same-origin mode resolves relative URLs against baseUrl', () => {
    const sameOrigin = policy({ resources: { remote: 'same-origin' } });
    expect(evaluatePdfResource('/logo.png', 'https://app.example.com/forms/', sameOrigin).allowed).toBe(true);
    expect(evaluatePdfResource('https://cdn.example.com/logo.png', 'https://app.example.com/', sameOrigin).allowed).toBe(false);
  });

  test('sanitizes credentials and query strings before diagnostics', () => {
    expect(sanitizePdfResourceUrl('https://user:pass@example.com/a.png?token=secret#x'))
      .toBe('https://example.com/a.png');
  });
});
