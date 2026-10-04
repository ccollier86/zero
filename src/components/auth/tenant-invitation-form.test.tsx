import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  runBeforeTenantInvitationSignIn,
  TenantInvitationScopeNotice,
  tenantInvitationPresentation,
} from './tenant-invitation-form';

describe('TenantInvitationForm tenant-kind presentation', () => {
  test('lets the host synchronously prepare or cancel sign-in navigation', () => {
    let calls = 0;
    expect(runBeforeTenantInvitationSignIn(undefined)).toBe(true);
    expect(runBeforeTenantInvitationSignIn(() => {
      calls += 1;
    })).toBe(true);
    expect(runBeforeTenantInvitationSignIn(() => {
      calls += 1;
      return false;
    })).toBe(false);
    expect(runBeforeTenantInvitationSignIn(() => {
      throw new Error('handoff failed');
    })).toBe(false);
    expect(calls).toBe(2);
  });

  test('labels a protected administration invitation and explains its boundary', () => {
    const presentation = tenantInvitationPresentation(
      'administration',
      'Internal Operators',
      'practice',
    );
    const notice = renderToStaticMarkup(createElement(TenantInvitationScopeNotice, {
      kind: 'administration',
      platformAuthority: true,
    }));

    expect(presentation.title).toBe('Join Platform administration');
    expect(presentation.actionTerm).toBe('Platform administration');
    expect(notice).toContain('protected-scope invitation');
    expect(notice).toContain('explicit platform administration access');
    expect(notice).toContain('MFA policy applies');
  });

  test('does not mislabel an app-only administration invitation as platform access', () => {
    const notice = renderToStaticMarkup(createElement(TenantInvitationScopeNotice, {
      kind: 'administration',
      platformAuthority: false,
    }));

    expect(notice).toContain('app workspace');
    expect(notice).toContain('without granting platform administration access');
    expect(notice).not.toContain('MFA policy applies');
  });

  test('keeps customer invitations on configured terminology without an admin warning', () => {
    const presentation = tenantInvitationPresentation(
      'organization',
      'Northside',
      'practice',
    );
    const notice = renderToStaticMarkup(createElement(TenantInvitationScopeNotice, {
      kind: 'organization',
      platformAuthority: false,
    }));

    expect(presentation.title).toBe('Join Northside');
    expect(presentation.actionTerm).toBe('practice');
    expect(notice).toBe('');
  });
});
