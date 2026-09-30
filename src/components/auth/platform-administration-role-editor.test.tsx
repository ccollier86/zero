import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  AuthTenantMember,
  AuthTenantRoleDescriptor,
} from '../../frontend/client/auth-types';
import { PlatformAdministrationRoleEditor } from './platform-administration-role-editor';
import {
  platformAdministrationRoleChoices,
  platformAssignableRoles,
} from './platform-administration-role-policy';

describe('platform administration role editor', () => {
  test('keeps assigned administration roles above the actor grant ceiling visible and locked', () => {
    const markup = renderEditor({
      memberRoles: ['administrator'],
      roles: [
        role('administrator', { grantable: false }),
        role('access-manager'),
        role('customer-member', { administrationOnly: false }),
      ],
      draftRoles: ['administrator'],
    });

    expect(markup).toContain('Administrator (locked)');
    expect(markup).toContain('aria-label="Remove Administrator"');
    expect(markup).toContain('disabled=""');
    expect(markup).not.toContain('Customer member');
  });

  test('shows retained retired roles, blocks silent resubmission, and limits cleanup to the owner', () => {
    const roles = [role('administrator')];
    const memberRoles = ['administrator', 'retired-administrator'];
    const nonOwner = renderEditor({ roles, memberRoles, draftRoles: memberRoles });
    const ownerAfterRemoval = renderEditor({
      roles,
      memberRoles,
      draftRoles: ['administrator'],
      canTransferOwnership: true,
      roleSelectionChanged: true,
    });
    const ownerWithoutReplacement = renderEditor({
      roles,
      memberRoles: ['retired-administrator'],
      draftRoles: [],
      canTransferOwnership: true,
      roleSelectionChanged: true,
    });

    expect(nonOwner).toContain('retired-administrator (retired)');
    expect(nonOwner).toContain('Only the platform administration owner can remove it.');
    expect(nonOwner).toContain('aria-label="Remove retired role retired-administrator"');
    expect(nonOwner).toMatch(/<button[^>]*aria-label="Remove retired role retired-administrator"[^>]*disabled=""/);
    expect(nonOwner).toMatch(/<button[^>]*disabled=""[^>]*>Save roles<\/button>/);

    expect(ownerAfterRemoval).toContain('retired-administrator (retired)');
    expect(ownerAfterRemoval).not.toContain('Only the platform administration owner can remove it.');
    expect(ownerAfterRemoval).toContain('aria-label="Retain retired role retired-administrator"');
    expect(ownerAfterRemoval).not.toMatch(/<button[^>]*disabled=""[^>]*>Save roles<\/button>/);
    expect(ownerWithoutReplacement).toMatch(/<button[^>]*disabled=""[^>]*>Save roles<\/button>/);
  });

  test('exposes an assigned customer role and lets only the owner remove it', () => {
    const roles = [
      role('administrator'),
      role('customer-member', { administrationOnly: false, assignable: false }),
    ];
    const memberRoles = ['administrator', 'customer-member'];
    const nonOwner = renderEditor({ roles, memberRoles, draftRoles: memberRoles });
    const ownerAfterRemoval = renderEditor({
      roles,
      memberRoles,
      draftRoles: ['administrator'],
      canTransferOwnership: true,
      roleSelectionChanged: true,
    });

    expect(nonOwner).toContain('Customer Member (not valid here)');
    expect(nonOwner).toContain('declared role that is not valid in this organization');
    expect(nonOwner).toContain('Only the platform administration owner can remove it.');
    expect(nonOwner).toMatch(/<button[^>]*aria-label="Remove invalid platform administration role Customer Member"[^>]*disabled=""/);
    expect(nonOwner).toMatch(/<button[^>]*disabled=""[^>]*>Save roles<\/button>/);
    expect(ownerAfterRemoval).toContain('aria-label="Retain invalid platform administration role Customer Member"');
    expect(ownerAfterRemoval).not.toMatch(/<button[^>]*disabled=""[^>]*>Save roles<\/button>/);
  });

  test('keeps an assigned above-ceiling role visible in simple mode', () => {
    const markup = renderEditor({
      roles: [role('administrator', { grantable: false })],
      memberRoles: ['administrator'],
      draftRoles: ['administrator'],
      simple: true,
    });

    expect(markup).toContain('current role is above your assignment ceiling');
    expect(markup).toContain('aria-label="Platform administration role for Grace Hopper"');
    expect(markup).toContain('disabled=""');
  });

  test('separates editable retained roles from roles that may be newly granted', () => {
    const roles = [
      role('administrator', { grantable: false }),
      role('access-manager'),
      role('customer-member', { administrationOnly: false }),
      role('owner', { system: true }),
    ];

    expect(platformAdministrationRoleChoices(roles).map((item) => item.key))
      .toEqual(['administrator', 'access-manager']);
    expect(platformAssignableRoles(roles).map((item) => item.key))
      .toEqual(['access-manager']);
  });
});

function renderEditor({
  roles,
  memberRoles,
  draftRoles,
  canTransferOwnership = false,
  roleSelectionChanged = false,
  simple = false,
}: {
  roles: readonly AuthTenantRoleDescriptor[];
  memberRoles: readonly string[];
  draftRoles: readonly string[];
  canTransferOwnership?: boolean;
  roleSelectionChanged?: boolean;
  simple?: boolean;
}): string {
  return renderToStaticMarkup(createElement(PlatformAdministrationRoleEditor, {
    member: member(memberRoles),
    roles,
    simple,
    draftRoles,
    busy: false,
    canTransferOwnership,
    rolePanelId: 'platform-role-editor',
    roleSelectionChanged,
    onChange() {},
    onSave() {},
  }));
}

function member(roles: readonly string[]): AuthTenantMember {
  return {
    membershipId: 'membership-1',
    identity: {
      userId: 'user-1',
      username: 'grace',
      email: 'grace@example.test',
      firstName: 'Grace',
      lastName: 'Hopper',
    },
    status: 'active',
    roles: [...roles],
    roleRevision: 'tenant:administration:membership-1:1',
    joinedAt: 1,
    updatedAt: 1,
  };
}

function role(
  key: string,
  overrides: Partial<AuthTenantRoleDescriptor> = {},
): AuthTenantRoleDescriptor {
  const label = key.split('-').map((part) => (
    part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : part
  )).join(' ');
  return {
    key,
    label,
    permissions: [],
    allPermissions: false,
    system: false,
    assignable: true,
    administrationOnly: true,
    grantable: true,
    ...overrides,
  };
}
