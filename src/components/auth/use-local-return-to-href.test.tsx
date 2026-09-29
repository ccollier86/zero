import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildLocalReturnToHref,
  resolveLocalReturnToHref,
  useLocalReturnToHref,
} from './use-local-return-to-href';

const ORIGIN = 'https://app.example.test';

describe('local auth return-to href', () => {
  test('returns to the exact current pathname, search, and hash', () => {
    expect(buildLocalReturnToHref(
      '/login',
      `${ORIGIN}/accept-invitation?token=zinv_example#review`,
      ORIGIN,
    )).toBe(
      '/login?redirect=%2Faccept-invitation%3Ftoken%3Dzinv_example%23review',
    );
  });

  test('preserves login query parameters and never replaces an existing redirect', () => {
    expect(buildLocalReturnToHref(
      '/login?mode=password&theme=dark#sign-in',
      `${ORIGIN}/request-access/acme?source=email`,
      ORIGIN,
    )).toBe(
      '/login?mode=password&theme=dark&redirect=%2Frequest-access%2Facme%3Fsource%3Demail#sign-in',
    );
    const continued = '/login?mode=sso&redirect=%2Fhost-owned#sign-in';
    expect(buildLocalReturnToHref(
      continued,
      `${ORIGIN}/accept-invitation?token=zinv_other`,
      ORIGIN,
    )).toBe(continued);
  });

  test('ignores external, ambiguous, backslash, and control-character return targets', () => {
    const unsafe = [
      'https://attacker.example/collect?token=secret',
      '//attacker.example/collect',
      '/accept-invitation\\attacker.example',
      '/accept-invitation\n?token=secret',
      `${ORIGIN}/%2f%2fattacker.example`,
      `${ORIGIN}/accept-invitation%00`,
      `${ORIGIN}/accept-invitation?token=example%0a`,
      `${ORIGIN}/accept-invitation#example%5cvalue`,
      `${ORIGIN}/accept-invitation?token=malformed%`,
    ];
    for (const currentHref of unsafe) {
      expect(buildLocalReturnToHref(
        '/login?mode=password',
        currentHref,
        ORIGIN,
      )).toBe('/login?mode=password');
    }
  });

  test('keeps every explicit host sign-in href byte-for-byte without wrapping it', () => {
    const values = [
      '/custom-login?mode=sso&redirect=%2Fhost-owned#start',
      'https://identity.example.test/start?tenant=acme',
      'myapp://identity/start?tenant=acme',
      '//host-owned-router/sign-in',
    ];
    for (const explicitHref of values) {
      expect(resolveLocalReturnToHref(
        explicitHref,
        `${ORIGIN}/accept-invitation?token=zinv_example`,
        ORIGIN,
      )).toBe(explicitHref);
    }
  });

  test('uses deterministic SSR output while preserving an explicit component href', () => {
    expect(renderToStaticMarkup(createElement(ReturnLink))).toBe(
      '<a href="/login">Sign in</a>',
    );
    expect(renderToStaticMarkup(createElement(ReturnLink, {
      signInHref: 'https://identity.example.test/start?mode=sso&tenant=acme',
    }))).toBe(
      '<a href="https://identity.example.test/start?mode=sso&amp;tenant=acme">Sign in</a>',
    );
  });
});

function ReturnLink({ signInHref }: { signInHref?: string }) {
  return createElement('a', { href: useLocalReturnToHref(signInHref) }, 'Sign in');
}
