import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  TenantJoinRequestForm,
  tenantJoinRequestPolicy,
} from './tenant-join-request-form';

describe('TenantJoinRequestForm sign-in route', () => {
  test('uses the deterministic local login route during SSR', () => {
    const markup = renderToStaticMarkup(createElement(TenantJoinRequestForm, {
      tenantSlug: 'acme',
    }));
    expect(markup).toContain('href="/login"');
    expect(markup).toContain('Sign in to request access');
  });

  test('preserves an explicit host sign-in href exactly', () => {
    const markup = renderToStaticMarkup(createElement(TenantJoinRequestForm, {
      tenantSlug: 'acme',
      signInHref: 'https://identity.example.test/start?mode=sso',
    }));
    expect(markup).toContain(
      'href="https://identity.example.test/start?mode=sso"',
    );
  });
});

describe('TenantJoinRequestForm public policy', () => {
  test('distinguishes unresolved, failed, enabled, and disabled policy', () => {
    expect(tenantJoinRequestPolicy(null, null)).toBe('unknown');
    expect(tenantJoinRequestPolicy(null, 'failed')).toBe('error');
    expect(tenantJoinRequestPolicy({
      registration: registration(),
    }, null)).toBe('enabled');
    expect(tenantJoinRequestPolicy({
      registration: registration(),
      tenancy: {
        mode: 'multi',
        onboarding: {
          invitations: {
            enabled: true,
            accountCreation: true,
            delivery: { default: 'manual', manual: true, email: false },
          },
          joinRequests: { enabled: false },
        },
      },
    }, null)).toBe('disabled');
  });
});

function registration() {
  return {
    mode: 'public' as const,
    bootstrapRequired: false,
    publicRegistrationEnabled: true,
  };
}
