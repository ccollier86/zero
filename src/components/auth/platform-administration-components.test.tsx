import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UsePlatformAdministrationResult } from '../../frontend/client/platform-administration-hooks';
import {
  PlatformAdministrationManagement,
  PlatformAdministrationMembers,
  platformMemberAnnouncement,
} from './platform-administration-management';
import { PlatformAdministrationInvitations } from './platform-administration-invitations';
import {
  platformAssignableRoles,
  platformRoleSelection,
} from './platform-administration-role-policy';
import {
  PlatformTenantManagement,
  PlatformTenantUnavailable,
} from './platform-tenant-management';

describe('packaged platform administration components', () => {
  test('fails closed outside administration scope with an explicit switching instruction', () => {
    const administrators = renderToStaticMarkup(
      createElement(PlatformAdministrationManagement),
    );
    const tenants = renderToStaticMarkup(createElement(PlatformTenantManagement));

    expect(administrators).toContain('Switch to the Platform administration organization');
    expect(administrators).toContain('Customer-organization membership never grants');
    expect(administrators).not.toContain('Add administrator');
    expect(tenants).toContain('Switch to Platform administration');
    expect(tenants).not.toContain('Create organization');
  });

  test('renders customer directory copy with configured tenant terminology', () => {
    const markup = renderToStaticMarkup(createElement(PlatformTenantUnavailable, {
      title: 'Customer practices',
      description: 'Create, browse, suspend, and inspect customer practices.',
      plural: 'practices',
    }));

    expect(markup).toContain('Customer practices');
    expect(markup).toContain('inspect customer practices');
    expect(markup).toContain('browse customer practices');
    expect(markup).not.toContain('customer organizations');
  });

  test('renders capability-gated administrator controls with native keyboard actions', () => {
    const markup = renderToStaticMarkup(createElement(PlatformAdministrationMembers, {
      administration: state(),
      onError() {},
      onAnnounce() {},
    }));

    expect(markup).toContain('id="zero-platform-administration-members"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain('aria-label="Existing administrator account email"');
    expect(markup).toContain('type="submit"');
    expect(markup).toContain('Add administrator');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('aria-controls="platform-roles-member-2"');
    expect(markup).toContain('Transfer ownership');
    expect(markup).toContain('flex-col');
    expect(markup).toContain('sm:flex-row');
    expect(markup).not.toContain('Reset password');
  });

  test('keeps invitation labels, destructive semantics, and one-time-token copy explicit', () => {
    const markup = renderToStaticMarkup(createElement(PlatformAdministrationInvitations, {
      administration: state(),
      delivery: { email: true, manual: true, default: 'manual' },
      onError() {},
      onAnnounce() {},
    }));

    expect(markup).toContain('aria-label="Administrator invitation email"');
    expect(markup).toContain('aria-label="Administrator invitation delivery"');
    expect(markup).toContain('Invited platform roles');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('Pending invitations');
    expect(markup).toContain('platform-administrator MFA policy');
    expect(markup).toContain('sm:grid-cols-');
  });

  test('renders exactly-one selectors in simple mode and independent choices in advanced mode', () => {
    const simpleMembers = renderToStaticMarkup(createElement(PlatformAdministrationMembers, {
      administration: state({}, 'simple'), onError() {}, onAnnounce() {},
    }));
    const simpleInvitations = renderToStaticMarkup(createElement(PlatformAdministrationInvitations, {
      administration: state({}, 'simple'),
      delivery: { email: true, manual: true, default: 'manual' },
      onError() {}, onAnnounce() {},
    }));
    const advanced = renderToStaticMarkup(createElement(PlatformAdministrationInvitations, {
      administration: state({}, 'advanced'),
      delivery: { email: true, manual: true, default: 'manual' },
      onError() {}, onAnnounce() {},
    }));

    expect(simpleMembers).toContain('aria-label="New administrator roles"');
    expect(simpleMembers).toContain('role="combobox"');
    expect(simpleInvitations).toContain('aria-label="Invitation platform roles"');
    expect(simpleInvitations).toContain('role="combobox"');
    expect(advanced).toContain('role="checkbox"');
  });

  test('exposes loading state through a polite live region and disables mutation controls', () => {
    const loading = state({ isLoading: true });
    const loadingMarkup = renderToStaticMarkup(createElement(PlatformAdministrationMembers, {
      administration: loading,
      onError() {},
      onAnnounce() {},
    }));
    const mutatingMarkup = renderToStaticMarkup(createElement(PlatformAdministrationInvitations, {
      administration: state({ isMutating: true }),
      delivery: { email: true, manual: true, default: 'manual' },
      onError() {},
      onAnnounce() {},
    }));

    expect(loadingMarkup).toContain('role="status"');
    expect(loadingMarkup).toContain('aria-live="polite"');
    expect(loadingMarkup).toContain('Loading platform administrators');
    expect(mutatingMarkup).toContain('aria-busy="true"');
    expect(mutatingMarkup).toContain('disabled=""');
  });

  test('never offers customer roles in protected administration assignment controls', () => {
    expect(platformAssignableRoles([
      role('administrator', true),
      role('access-manager', true),
      role('member', false),
      { ...role('locked', true), grantable: false },
      { ...role('owner', true), key: 'owner' },
    ]).map((role) => role.key)).toEqual(['administrator', 'access-manager']);
    expect(platformRoleSelection([])).toBeNull();
    expect(platformRoleSelection(['administrator', 'access-manager']))
      .toEqual(['administrator', 'access-manager']);
  });

  test('uses specific live-region completion language for sensitive changes', () => {
    expect(platformMemberAnnouncement('suspend', 'Grace Hopper')).toBe('Suspended Grace Hopper');
    expect(platformMemberAnnouncement('remove', 'Grace Hopper'))
      .toBe('Removed Grace Hopper from platform administration');
    expect(platformMemberAnnouncement('transfer', 'Grace Hopper'))
      .toBe('Transferred platform ownership to Grace Hopper');
  });
});

function state(
  overrides: Partial<UsePlatformAdministrationResult> = {},
  authorization: 'simple' | 'advanced' = 'advanced',
): UsePlatformAdministrationResult {
  return {
    isAvailable: true,
    config: {
      authorization,
      administration: {
        tenantId: 'tenant-admin', kind: 'administration', slug: 'administration',
        name: 'Platform administration', membershipId: 'member-1',
      },
      capabilities: {
        canReadMembers: true, canManageMembers: true,
        canReadInvitations: true, canManageInvitations: true,
        canReadTenants: true, canReadTenantMembers: true,
        canManageTenants: true, canCreateTenants: true, canTransferOwnership: true,
      },
      roles: [role('administrator', true), role('access-manager', true)],
    },
    members: [
      member('member-1', 'owner', ['owner']),
      member('member-2', 'grace', ['administrator']),
    ],
    memberPage: { limit: 25, count: 2, hasMore: false, nextCursor: null },
    invitations: [{
      invitationId: 'invitation-1', email: 'invitee@example.test',
      roles: ['administrator'], status: 'pending', expiresAt: 50,
      createdAt: 1, updatedAt: 1, acceptedAt: null, revokedAt: null,
    }],
    invitationPage: { limit: 25, count: 1, hasMore: false, nextCursor: null },
    isLoading: false,
    isLoadingMoreMembers: false,
    isLoadingMoreInvitations: false,
    isMutating: false,
    error: null,
    reload() {},
    async loadMoreMembers() {},
    async loadMoreInvitations() {},
    async addMember() { return { member: member('member-3', 'new', ['administrator']), actorSessionInvalidated: false }; },
    async updateMember() { return { member: member('member-2', 'grace', ['administrator']), actorSessionInvalidated: false }; },
    async removeMember() { return { member: member('member-2', 'grace', ['administrator']), actorSessionInvalidated: false }; },
    async transferOwnership() {
      return {
        owner: member('member-2', 'grace', ['owner']),
        previousOwner: member('member-1', 'owner', ['administrator']),
        actorSessionInvalidated: true,
      };
    },
    async issueInvitation() {
      return {
        invitation: this.invitations[0]!, delivery: { mode: 'manual' }, token: 'secret',
      };
    },
    async revokeInvitation() { return this.invitations[0]!; },
    ...overrides,
  };
}

function role(key: string, administrationOnly: boolean) {
  return {
    key,
    label: key,
    administrationOnly,
    permissions: [],
    allPermissions: false,
    system: true,
    assignable: true,
    grantable: true,
  };
}

function member(membershipId: string, username: string, roles: string[]) {
  return {
    membershipId,
    identity: {
      userId: `user-${username}`, username, email: `${username}@example.test`,
      firstName: username === 'grace' ? 'Grace' : null,
      lastName: username === 'grace' ? 'Hopper' : null,
    },
    status: 'active' as const,
    roles,
    roleRevision: `${membershipId}:1`,
    joinedAt: 1,
    updatedAt: 1,
  };
}
