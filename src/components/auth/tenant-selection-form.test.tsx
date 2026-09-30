import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { nextAuthRovingRadioIndex } from './auth-roving-radio';
import { TenantSelectionForm, tenantSelectionFlowKey } from './tenant-selection-form';

describe('TenantSelectionForm flow reset key', () => {
  test('changes for a replacement continuation or tenant list', () => {
    const initial = selection('continuation-1', ['tenant-1', 'tenant-2']);
    expect(tenantSelectionFlowKey(initial)).not.toBe(
      tenantSelectionFlowKey(selection('continuation-2', ['tenant-1', 'tenant-2'])),
    );
    expect(tenantSelectionFlowKey(initial)).not.toBe(
      tenantSelectionFlowKey(selection('continuation-1', ['tenant-2'])),
    );
  });

  test('renders one tab stop and native button-backed radio semantics', () => {
    const markup = renderToStaticMarkup(createElement(TenantSelectionForm, {
      result: selection('continuation-1', ['tenant-1', 'tenant-2']),
    }));

    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('Choose your organization');
    expect(markup).toContain('role="radio" aria-checked="true" tabindex="0"');
    expect(markup).toContain('role="radio" aria-checked="false" tabindex="-1"');
    expect(markup).toContain('motion-reduce:transition-none');
  });

  test('uses configured terminology in visible and accessible copy', () => {
    const markup = renderToStaticMarkup(createElement(TenantSelectionForm, {
      result: selection('continuation-1', ['tenant-1']),
      terminology: { singular: 'practice', plural: 'practices' },
    }));

    expect(markup).toContain('Choose your practice');
    expect(markup).toContain('aria-label="Practices"');
    expect(markup).not.toContain('organization');
  });

  test('labels the protected administration scope instead of presenting it as a customer', () => {
    const result = selection('continuation-1', ['tenant-admin', 'tenant-1'], ['tenant-admin']);
    const markup = renderToStaticMarkup(createElement(TenantSelectionForm, {
      result,
    }));

    expect(markup).toContain('Platform administration');
    expect(markup).toContain('tenant-1 · member');
  });

});

describe('auth card radio keyboard navigation', () => {
  test('wraps arrow navigation and supports Home and End', () => {
    expect(nextAuthRovingRadioIndex('ArrowDown', 2, 3)).toBe(0);
    expect(nextAuthRovingRadioIndex('ArrowRight', 0, 3)).toBe(1);
    expect(nextAuthRovingRadioIndex('ArrowUp', 0, 3)).toBe(2);
    expect(nextAuthRovingRadioIndex('ArrowLeft', 2, 3)).toBe(1);
    expect(nextAuthRovingRadioIndex('Home', 2, 3)).toBe(0);
    expect(nextAuthRovingRadioIndex('End', 0, 3)).toBe(2);
  });

  test('ignores unrelated keys and empty groups', () => {
    expect(nextAuthRovingRadioIndex('Tab', 0, 3)).toBeNull();
    expect(nextAuthRovingRadioIndex('ArrowDown', 0, 0)).toBeNull();
  });
});

function selection(
  continuation: string,
  tenantIds: string[],
  administrationIds: string[] = [],
) {
  return {
    user: {
      userId: 'user-1',
      username: 'user',
      email: 'user@example.test',
      firstName: null,
      lastName: null,
      role: 'user',
      status: 'active' as const,
      passwordChangeRequired: false,
      emailVerifiedAt: 1,
      emailVerificationRequired: false,
      mfaRequired: false,
      createdAt: 1,
      updatedAt: null,
      properties: {},
    },
    tenantSelectionRequired: true as const,
    tenantSelection: {
      continuation,
      expiresAt: Date.now() + 60_000,
      tenants: tenantIds.map((tenantId) => ({
        tenantId,
        kind: administrationIds.includes(tenantId)
          ? 'administration' as const
          : 'organization' as const,
        slug: tenantId,
        name: tenantId,
        role: 'member',
      })),
    },
  };
}
