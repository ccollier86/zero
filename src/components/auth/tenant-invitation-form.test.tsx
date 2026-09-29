import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  TenantInvitationScopeNotice,
  tenantInvitationPresentation,
} from './tenant-invitation-form';

describe('TenantInvitationForm tenant-kind presentation', () => {
  test('labels a protected administration invitation and explains its boundary', () => {
    const presentation = tenantInvitationPresentation(
      'administration',
      'Internal Operators',
      'practice',
    );
    const notice = renderToStaticMarkup(createElement(TenantInvitationScopeNotice, {
      kind: 'administration',
    }));

    expect(presentation.title).toBe('Join Platform administration');
    expect(presentation.actionTerm).toBe('Platform administration');
    expect(notice).toContain('protected-scope invitation');
    expect(notice).toContain('not customer data access');
    expect(notice).toContain('MFA policy applies');
  });

  test('keeps customer invitations on configured terminology without an admin warning', () => {
    const presentation = tenantInvitationPresentation(
      'organization',
      'Northside',
      'practice',
    );
    const notice = renderToStaticMarkup(createElement(TenantInvitationScopeNotice, {
      kind: 'organization',
    }));

    expect(presentation.title).toBe('Join Northside');
    expect(presentation.actionTerm).toBe('practice');
    expect(notice).toBe('');
  });
});
