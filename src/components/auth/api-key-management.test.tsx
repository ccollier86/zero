import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { IssuedAuthApiKey } from '../../frontend/client/auth-api-key-types';
import {
  ApiKeyManagement,
  ApplicationUserApiKeyManagement,
  PlatformApiKeyManagement,
  SelfApiKeyManagement,
  TenantMemberApiKeyManagement,
} from './api-key-management';
import {
  apiKeyConfirmationTarget,
  ApiKeyIssueForm,
  ApiKeyList,
} from './api-key-management-parts';
import {
  apiKeyManagementCopy,
  apiKeyManagementHookOptions,
} from './api-key-management-policy';
import {
  apiKeySecretReducer,
  ApiKeySecretReveal,
} from './api-key-secret-reveal';

const KEY_ID = '123e4567-e89b-42d3-a456-426614174000';
const SECRET = `zero_ak_v1.${KEY_ID}.${'a'.repeat(43)}`;

describe('ApiKeyManagement mode routing', () => {
  test('maps every component mode to the exact SDK target and bounds page size', () => {
    expect(apiKeyManagementHookOptions({ mode: 'self', pageSize: 0 })).toEqual({
      mode: 'self', limit: 1,
    });
    expect(apiKeyManagementHookOptions({
      mode: 'application-admin', userId: 'user-1', pageSize: 20,
    })).toEqual({ mode: 'application-admin', userId: 'user-1', limit: 20 });
    expect(apiKeyManagementHookOptions({
      mode: 'tenant-admin', membershipId: 'member-1', pageSize: 500,
    })).toEqual({ mode: 'tenant-admin', membershipId: 'member-1', limit: 100 });
    expect(apiKeyManagementHookOptions({
      mode: 'platform-admin', tenantId: 'tenant-1', pageSize: 25,
    })).toEqual({ mode: 'platform-admin', tenantId: 'tenant-1', limit: 25 });
    expect(apiKeyManagementHookOptions({
      mode: 'platform-admin', tenantId: 'tenant-1', membershipId: 'member-1',
    })).toEqual({
      mode: 'platform-admin', tenantId: 'tenant-1', membershipId: 'member-1', limit: 25,
    });
  });

  test('wrappers remain optional and fail closed when the capability is unavailable', () => {
    const components = [
      createElement(ApiKeyManagement, { mode: 'self' }),
      createElement(SelfApiKeyManagement),
      createElement(ApplicationUserApiKeyManagement, { userId: 'user-1' }),
      createElement(TenantMemberApiKeyManagement, { membershipId: 'member-1' }),
      createElement(PlatformApiKeyManagement),
    ];
    for (const component of components) {
      const markup = renderToStaticMarkup(component);
      expect(markup).toContain('Loading API key configuration…');
      expect(markup).toMatch(
        /<h2[^>]*data-slot="card-title"[^>]*>[^<]*API key(?:s| directory)<\/h2>/,
      );
      expect(markup).not.toContain('Issue key');
      expect(markup).not.toContain('Revoke');
    }
  });

  test('renders only secret-free list metadata and accessible actions', () => {
    const markup = renderToStaticMarkup(createElement(ApiKeyList, {
      apiKeys: [issued().apiKey],
      busy: false,
      canRotate: true,
      canRevoke: true,
      actionsDisabled: false,
      onConfirm() {},
    }));
    expect(markup).toContain('Secret ending in');
    expect(markup).toContain('aaaa');
    expect(markup).toContain('aria-label="Rotate API key Automation ending in aaaa"');
    expect(markup).toContain('aria-label="Revoke API key Automation ending in aaaa"');
    expect(markup).not.toContain(SECRET);
  });

  test('keeps server-authorized controls mounted but disabled during transient work', () => {
    const listMarkup = renderToStaticMarkup(createElement(ApiKeyList, {
      apiKeys: [issued().apiKey],
      busy: false,
      canRotate: true,
      canRevoke: true,
      actionsDisabled: true,
      onConfirm() {},
    }));
    const issueMarkup = renderToStaticMarkup(createElement(ApiKeyIssueForm, {
      busy: false,
      disabled: true,
      defaultTTL: '8h',
      maxTTL: '14d',
      async onIssue() { return false; },
    }));

    expect(listMarkup).toContain('aria-label="Rotate API key Automation ending in aaaa"');
    expect(listMarkup).toContain('aria-label="Revoke API key Automation ending in aaaa"');
    expect(listMarkup.match(/disabled=""/g)).toHaveLength(2);
    expect(issueMarkup).toContain('Key label');
    expect(issueMarkup).toContain('Lifetime');
    expect(issueMarkup.match(/disabled=""/g)).toHaveLength(3);
  });

  test('keeps permanent and temporarily unavailable rows revocable', () => {
    for (const status of ['expired', 'invalidated', 'unavailable'] as const) {
      const value = issued().apiKey;
      const markup = renderToStaticMarkup(createElement(ApiKeyList, {
        apiKeys: [{ ...value, status }],
        busy: false,
        canRotate: true,
        canRevoke: true,
        actionsDisabled: false,
        onConfirm() {},
      }));
      expect(markup).toContain('aria-label="Revoke API key Automation ending in aaaa"');
      expect(markup).not.toContain('aria-label="Rotate API key Automation ending in aaaa"');
    }
  });

  test('uses configured tenant terminology in copy and metadata', () => {
    expect(apiKeyManagementCopy(
      { mode: 'tenant-admin', membershipId: 'member-1' },
      { singular: 'practice', plural: 'practices' },
    )).toEqual({
      title: 'Member API keys',
      description: 'Review and manage credentials bound to this practice member.',
      empty: 'This practice member does not have any API keys.',
    });
    const value = issued().apiKey;
    const markup = renderToStaticMarkup(createElement(ApiKeyList, {
      apiKeys: [{ ...value, tenantId: 'practice-1' }],
      busy: false,
      canRotate: false,
      canRevoke: false,
      actionsDisabled: false,
      tenantSingular: 'practice',
      onConfirm() {},
    }));
    expect(markup).toContain('<dt class="text-muted-foreground">Practice</dt>');
    expect(markup).not.toContain('>Organization</dt>');
    expect(markup).not.toContain('aria-label="Revoke API key');
  });

  test('shows the configured default and maximum key lifetimes', () => {
    const markup = renderToStaticMarkup(createElement(ApiKeyIssueForm, {
      busy: false,
      disabled: false,
      defaultTTL: '8h',
      maxTTL: '14d',
      async onIssue() { return true; },
    }));
    expect(markup).toContain('Defaults to 8h; maximum 14d.');
    expect(markup).not.toContain('12h or 30d');
  });

  test('identifies duplicate labels by hint, subject, and exact scope in confirmations', () => {
    const first = {
      ...issued().apiKey,
      tenantId: 'tenant-a',
      membershipId: 'membership-a',
    };
    const second = {
      ...issued().apiKey,
      keyId: '223e4567-e89b-42d3-a456-426614174000',
      hint: 'bbbb',
      userId: 'user-2',
      tenantId: 'tenant-b',
      membershipId: 'membership-b',
    };

    expect(apiKeyConfirmationTarget(first, 'practice')).toBe(
      'API key Automation, ending in aaaa, for user user-1 in practice tenant-a, membership membership-a',
    );
    expect(apiKeyConfirmationTarget(second, 'practice')).toBe(
      'API key Automation, ending in bbbb, for user user-2 in practice tenant-b, membership membership-b',
    );
    expect(apiKeyConfirmationTarget(first, 'practice'))
      .not.toBe(apiKeyConfirmationTarget(second, 'practice'));
  });
});

describe('ApiKeyManagement one-time secret lifecycle', () => {
  test('dismissal clears the only retained issued-secret state', () => {
    const value = issued();
    const shown = apiKeySecretReducer(null, { type: 'show', issued: value });
    expect(shown?.secret).toBe(SECRET);
    const dismissed = apiKeySecretReducer(shown, { type: 'dismiss' });
    expect(dismissed).toBeNull();
    expect(JSON.stringify(dismissed)).not.toContain(SECRET);
  });

  test('masks the one-time value while keeping reveal, copy, and dismissal explicit', () => {
    const markup = renderToStaticMarkup(createElement(ApiKeySecretReveal, {
      issued: issued(),
      onDismiss() {},
    }));
    const boundedMask = `${'•'.repeat(24)}aaaa`;

    expect(markup).not.toContain(SECRET);
    expect(markup).toContain('Copy this API key now');
    expect(markup).toContain('shown once and cannot be recovered');
    expect(markup).toContain(`zero_ak_v1.${boundedMask}`);
    expect(markup.match(/•/g)).toHaveLength(24);
    expect(markup).toContain('data-slot="secret-field"');
    expect(markup).toContain('data-masked="true"');
    expect(markup).toContain('data-slot="secret-field-reveal"');
    expect(markup).toContain('aria-label="Show One-time API key secret"');
    expect(markup).toContain('data-slot="secret-field-copy"');
    expect(markup).toContain('aria-label="Copy One-time API key secret"');
    expect(markup).toContain('Dismiss and clear from page');
    expect(markup).not.toContain('<input');
    expect(markup).not.toContain('secretHash');
  });
});

function issued(): IssuedAuthApiKey {
  return {
    secret: SECRET,
    apiKey: {
      keyId: KEY_ID,
      userId: 'user-1',
      label: 'Automation',
      hint: 'aaaa',
      scopeKind: 'application',
      scopeId: 'application',
      tenantId: null,
      membershipId: null,
      createdByUserId: 'user-1',
      createdVia: 'self',
      createdAt: Date.UTC(2026, 8, 1),
      expiresAt: Date.UTC(2026, 9, 1),
      lastUsedAt: null,
      revokedAt: null,
      status: 'active',
    },
  };
}
