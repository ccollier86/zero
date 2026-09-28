import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DomainOnboarding } from './domain-onboarding';
import {
  isExactDomainReleaseConfirmation,
  TenantDomainManagement,
} from './tenant-domain-management';

describe('verified-domain packaged components', () => {
  test('fail closed during SSR before the public capability is known', () => {
    expect(renderToStaticMarkup(createElement(DomainOnboarding, {
      identityContinuation: 'opaque-identity-proof',
    }))).toBe('');
    expect(renderToStaticMarkup(createElement(TenantDomainManagement))).toBe('');
  });

  test('never serializes the pre-session identity continuation into SSR markup', () => {
    const markup = renderToStaticMarkup(createElement(DomainOnboarding, {
      identityContinuation: 'do-not-render-this-proof',
    }));
    expect(markup).not.toContain('do-not-render-this-proof');
  });

  test('requires the exact normalized domain for destructive release confirmation', () => {
    expect(isExactDomainReleaseConfirmation('acme.com', 'acme.com')).toBe(true);
    expect(isExactDomainReleaseConfirmation('acme.com', 'ACME.COM')).toBe(false);
    expect(isExactDomainReleaseConfirmation('acme.com', ' acme.com ')).toBe(false);
    expect(isExactDomainReleaseConfirmation('xn--bcher-kva.example', 'bücher.example'))
      .toBe(false);
  });
});
