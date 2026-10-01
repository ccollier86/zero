import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Plus } from 'lucide-react';
import type {
  AuthTenantMember,
  AuthTenantRoleDescriptor,
} from '../../frontend/client/auth-types';
import { TenantMemberDetail, formatMembershipDate } from './tenant-member-detail';
import { TenantMemberList, TenantMemberListControls } from './tenant-member-list';
import { resolveTenantMemberOperationPolicy } from './tenant-member-management';
import { RecordNavigationBar } from '../ui/record-navigation-bar';

const member: AuthTenantMember = {
  membershipId: 'membership-ada',
  identity: {
    userId: 'user-ada',
    username: 'ada',
    email: 'ada@example.test',
    firstName: 'Ada',
    lastName: 'Lovelace',
  },
  status: 'active',
  roles: ['member'],
  roleRevision: 'role-revision-1',
  joinedAt: Date.UTC(2026, 0, 2),
  updatedAt: Date.UTC(2026, 0, 3),
};

const role: AuthTenantRoleDescriptor = {
  key: 'member',
  label: 'Member',
  description: 'Standard workspace access.',
  administrationOnly: false,
  permissions: ['records:read'],
  allPermissions: false,
  system: false,
  assignable: true,
  grantable: true,
};

describe('tenant member master-detail UI', () => {
  test('keeps the member list compact and free of inline lifecycle controls', () => {
    const markup = renderToStaticMarkup(createElement(TenantMemberList, {
      members: [member],
      selectedId: member.membershipId,
      actorMembershipId: member.membershipId,
      roleLabels: new Map([['member', 'Member']]),
      busy: false,
      onSelect() {},
    }));

    expect(markup).toContain('<ul aria-label="Members"');
    expect(markup).toContain('aria-current="true"');
    expect(markup).toContain('Ada Lovelace');
    expect(markup).toContain('(you)');
    expect(markup).not.toContain('Suspend');
    expect(markup).not.toContain('Remove');
    expect(markup).not.toContain('Transfer ownership');
  });

  test('renders identity, membership, roles, and injected account UI in one detail pane', () => {
    const markup = renderToStaticMarkup(createElement(TenantMemberDetail, {
      member,
      actorMembershipId: member.membershipId,
      declaredRoles: [role],
      assignableRoles: [role],
      roleLabels: new Map([['member', 'Member']]),
      simple: true,
      draftRoles: ['member'],
      busy: false,
      canManageRoles: true,
      canTransferOwnership: false,
      tenantSingular: 'workspace',
      rolePanelId: 'member-access',
      roleSelectionChanged: false,
      detailContent: createElement('section', null, 'Account security controls'),
      onRolesChange() {},
      onSaveRoles() {},
    }));

    expect(markup).toContain('Identity');
    expect(markup).toContain('Workspace membership');
    expect(markup).toContain('Workspace access');
    expect(markup).toContain('Assigned roles');
    expect(markup).toContain('Effective permissions');
    expect(markup).toContain('records:read');
    expect(markup).toContain('Roles for Ada Lovelace');
    expect(markup).toContain('Account security controls');
    expect(markup).toContain('user-ada');
    expect(markup).toContain('membership-ada');
  });

  test('keeps retired roles visible without treating them as effective access', () => {
    const markup = renderToStaticMarkup(createElement(TenantMemberDetail, {
      member: { ...member, roles: ['retired_reviewer', 'member'] },
      declaredRoles: [role],
      assignableRoles: [role],
      roleLabels: new Map([['member', 'Member']]),
      simple: false,
      draftRoles: ['retired_reviewer', 'member'],
      busy: false,
      canManageRoles: false,
      canTransferOwnership: false,
      tenantSingular: 'workspace',
      rolePanelId: 'retired-member-access',
      roleSelectionChanged: false,
      onRolesChange() {},
      onSaveRoles() {},
    }));

    expect(markup).toContain('retired_reviewer (retired)');
    expect(markup).toContain('Retired roles remain visible for cleanup and grant no permissions.');
    expect(markup).toContain('records:read');
    expect(markup.match(/records:read/g)).toHaveLength(1);
  });

  test('projects lifecycle and ownership controls from exact capabilities', () => {
    expect(resolveTenantMemberOperationPolicy({
      member,
      actorMembershipId: member.membershipId,
      canManageMembers: true,
      canTransferOwnership: true,
    })).toEqual({
      suspend: true,
      reactivate: false,
      remove: true,
      transferOwnership: false,
    });
    expect(resolveTenantMemberOperationPolicy({
      member: { ...member, roles: ['owner'] },
      actorMembershipId: 'someone-else',
      canManageMembers: true,
      canTransferOwnership: true,
    })).toEqual({
      suspend: false,
      reactivate: false,
      remove: false,
      transferOwnership: false,
    });
    expect(resolveTenantMemberOperationPolicy({
      member: { ...member, status: 'suspended' },
      canManageMembers: false,
      canTransferOwnership: false,
    })).toEqual({
      suspend: false,
      reactivate: false,
      remove: false,
      transferOwnership: false,
    });
  });

  test('renders compact cursor controls with accessible labels', () => {
    const markup = renderToStaticMarkup(createElement(TenantMemberListControls, {
      search: 'ada',
      status: 'active',
      loadedCount: 25,
      hasMore: true,
      isLoading: false,
      isLoadingMore: false,
      onSearchChange() {},
      onStatusChange() {},
      onRefresh() {},
      onLoadMore() {},
    }));

    expect(markup).toContain('aria-label="Search members"');
    expect(markup).toContain('aria-label="Membership status"');
    expect(markup).toContain('aria-label="Refresh members"');
    expect(markup).toContain('25 loaded+');
    expect(markup).toContain('Load more');
  });

  test('formats membership dates deterministically in UTC', () => {
    expect(formatMembershipDate(Date.UTC(2026, 0, 2))).toBe('Jan 2, 2026');
    expect(formatMembershipDate(Number.NaN)).toBe('Unknown');
    expect(formatMembershipDate(Number.MAX_VALUE)).toBe('Unknown');
  });

  test('keeps composed workflows together in the record action bar', () => {
    const markup = renderToStaticMarkup(createElement(RecordNavigationBar, {
      currentIndex: 0,
      totalCount: 1,
      onPrevious() {},
      onNext() {},
      actions: [{ icon: createElement(Plus), label: 'Reset password', onClick() {} }],
      secondaryPrimaryAction: { label: 'Invite member', ariaHasPopup: 'dialog', onClick() {} },
      primaryAction: { label: 'Add member', ariaHasPopup: 'dialog', onClick() {} },
    }));

    expect(markup).toContain('aria-label="Reset password"');
    expect(markup).toContain('Invite member');
    expect(markup).toContain('Add member');
    expect(markup.match(/aria-haspopup="dialog"/g)).toHaveLength(2);
  });
});
