import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AuthTenantJoinRequest } from '../../frontend/client/auth-types';
import {
  assignedRolesAboveGrantCeiling,
  projectTenantMemberRoleChoices,
  rolesForTenantKind,
  TenantMemberManagement,
  tenantConfirmationAnnouncement,
} from './tenant-member-management';
import {
  filterJoinRequestApprovalRoles,
  JoinRequestRow,
  joinRequestApprovalParams,
  resolveInvitationDeliveryMode,
  tenantOnboardingConfirmationAnnouncement,
  TenantOnboardingManagement,
  TenantOnboardingTenantKindNotice,
} from './tenant-onboarding-management';
import {
  ManualInvitationToken,
  TenantInvitationComposer,
  TenantInvitationList,
} from './tenant-onboarding-invitations';
import {
  parseTenantSwitcherHandoff,
  runTenantSwitch,
  TenantSwitcher,
} from './tenant-switcher';

describe('packaged tenant administration components', () => {
  test('renders an accessible SSR-safe unavailable state without global identity controls', () => {
    const markup = renderToStaticMarkup(createElement(TenantMemberManagement));

    expect(markup).toContain('Organization members');
    expect(markup).toContain(
      'Organization member controls are available after signing in with active organization access.',
    );
    expect(markup).not.toContain('Reset password');
    expect(markup).not.toContain('MFA');
    expect(markup).not.toContain('Delete account');
  });

  test('does not render a misleading switcher before multi-tenant capability is known', () => {
    const markup = renderToStaticMarkup(createElement(TenantSwitcher));
    expect(markup).toBe('');
  });

  test('renders an explicit onboarding unavailable state instead of an empty card', () => {
    const markup = renderToStaticMarkup(
      createElement(TenantOnboardingManagement),
    );

    expect(markup).toContain('Organization onboarding');
    expect(markup).toContain(
      'Organization onboarding controls require signing in with active organization access.',
    );
  });

  test('never submits a stale invitation delivery mode after config loads', () => {
    expect(resolveInvitationDeliveryMode('manual', 'email', ['email'])).toBe(
      'email',
    );
    expect(resolveInvitationDeliveryMode('email', 'manual', ['manual'])).toBe(
      'manual',
    );
    expect(
      resolveInvitationDeliveryMode('manual', 'email', ['email', 'manual']),
    ).toBe('manual');
  });

  test('submits only projected selectable roles and never overrides fixed/default policy', () => {
    const selectable = {
      canApprove: true,
      roleSelection: {
        mode: 'selectable' as const,
        defaultRoleKeys: ['member'],
        maxRoleCount: 32,
        roles: [
          { key: 'member', label: 'Member' },
          { key: 'billing', label: 'Billing manager' },
        ],
      },
    };
    const fixed = {
      canApprove: true,
      roleSelection: {
        mode: 'fixed' as const,
        roles: [{ key: 'domain-member', label: 'Verified coworker' }],
      },
    };
    const defaultPolicy = {
      canApprove: true,
      roleSelection: {
        mode: 'default' as const,
        roles: [{ key: 'member', label: 'Member' }],
      },
    };

    expect(
      filterJoinRequestApprovalRoles(selectable, [
        'billing',
        'owner',
        'billing',
      ]),
    ).toEqual(['billing']);
    expect(
      joinRequestApprovalParams(selectable, ['billing', 'owner'], false, 7),
    ).toEqual({ expectedRequestRevision: 7, roles: ['billing'] });
    expect(joinRequestApprovalParams(fixed, ['owner'], true, 7)).toEqual({
      expectedRequestRevision: 7,
      reactivateMembership: true,
    });
    expect(joinRequestApprovalParams(defaultPolicy, ['owner'], false, 7)).toEqual(
      { expectedRequestRevision: 7 },
    );
  });

  test('renders advanced approval choices but keeps fixed policy non-editable', () => {
    const selectableRequest: AuthTenantJoinRequest = {
      ...joinRequest,
      approvalPolicy: {
        canApprove: true,
        roleSelection: {
          mode: 'selectable',
          defaultRoleKeys: ['member'],
          maxRoleCount: 2,
          roles: [
            { key: 'member', label: 'Contributor' },
            { key: 'billing', label: 'Billing manager' },
          ],
        },
      },
    };
    const selectableMarkup = renderToStaticMarkup(
      createElement(JoinRequestRow, {
        request: selectableRequest,
        busy: false,
        tenantSingular: 'workspace',
        onApprove: async () => {},
        onDeny: async () => {},
      }),
    );
    const fixedMarkup = renderToStaticMarkup(
      createElement(JoinRequestRow, {
        request: {
          ...joinRequest,
          approvalPolicy: {
            canApprove: true,
            roleSelection: {
              mode: 'fixed',
              roles: [{ key: 'verified', label: 'Verified coworker' }],
            },
          },
        },
        busy: false,
        tenantSingular: 'workspace',
        onApprove: async () => {},
        onDeny: async () => {},
      }),
    );

    expect(selectableMarkup).toContain('Roles granted to Ada Lovelace');
    expect(selectableMarkup).toContain('Contributor');
    expect(selectableMarkup).toContain('Billing manager');
    expect(selectableMarkup).toContain('Choose up to 2 roles.');
    expect(fixedMarkup).toContain('Fixed access: Verified coworker');
    expect(fixedMarkup).not.toContain('role="checkbox"');
  });

  test('explains when a reviewer can deny but cannot grant required access', () => {
    const markup = renderToStaticMarkup(
      createElement(JoinRequestRow, {
        request: {
          ...joinRequest,
          approvalPolicy: {
            canApprove: false,
            roleSelection: {
              mode: 'fixed',
              roles: [{ key: 'manager', label: 'Manager' }],
            },
          },
        },
        busy: false,
        tenantSingular: 'workspace',
        onApprove: async () => {},
        onDeny: async () => {},
      }),
    );

    expect(markup).toContain(
      'Your current role can review this request but cannot grant its required workspace access.',
    );
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('Deny');
  });

  test('contains a rejected switch and announces success only after completion', async () => {
    let announcements = 0;
    await expect(
      runTenantSwitch(
        async () => {
          throw new Error('switch failed');
        },
        () => {
          announcements += 1;
        },
      ),
    ).resolves.toBe(false);
    expect(announcements).toBe(0);

    await expect(
      runTenantSwitch(
        async () => {},
        () => {
          announcements += 1;
        },
      ),
    ).resolves.toBe(true);
    expect(announcements).toBe(1);
  });

  test('uses specific completion announcements for sensitive member actions', () => {
    expect(
      tenantConfirmationAnnouncement('suspend', 'Ada Lovelace', 'organization'),
    ).toBe('Suspended Ada Lovelace');
    expect(
      tenantConfirmationAnnouncement('remove', 'Ada Lovelace', 'organization'),
    ).toBe('Removed Ada Lovelace from this organization');
    expect(
      tenantConfirmationAnnouncement(
        'transfer',
        'Ada Lovelace',
        'organization',
      ),
    ).toBe('Transferred organization ownership to Ada Lovelace');
  });

  test('keeps simple role choices inside the grant ceiling without hiding a locked assignment', () => {
    const roles = [
      tenantRole('member', true),
      tenantRole('manager', false),
      tenantRole('billing', false),
    ];
    expect(projectTenantMemberRoleChoices(roles, ['manager'], true).map((role) => role.key))
      .toEqual(['member', 'manager']);
    expect(assignedRolesAboveGrantCeiling(roles, ['manager'])).toEqual(['manager']);
    expect(projectTenantMemberRoleChoices(roles, ['manager'], false).map((role) => role.key))
      .toEqual(['member', 'manager', 'billing']);
  });

  test('offers roles only inside the active customer or administration kind', () => {
    const customer = tenantRole('member', true);
    const administrator = {
      ...tenantRole('administrator', true),
      administrationOnly: true,
    };

    expect(rolesForTenantKind([customer, administrator], 'organization')
      .map((role) => role.key)).toEqual(['member']);
    expect(rolesForTenantKind([customer, administrator], 'administration')
      .map((role) => role.key)).toEqual(['administrator']);
  });

  test('renders protected-scope onboarding exclusions only for administration', () => {
    const administration = renderToStaticMarkup(createElement(
      TenantOnboardingTenantKindNotice,
      { kind: 'administration' },
    ));
    const customer = renderToStaticMarkup(createElement(
      TenantOnboardingTenantKindNotice,
      { kind: 'organization' },
    ));

    expect(administration).toContain('supports invitations only');
    expect(administration).toContain('join requests');
    expect(administration).toContain('verified-domain onboarding');
    expect(administration).toContain('PlatformAdministrationManagement');
    expect(customer).toBe('');
  });

  test('keeps invitation controls labelled, keyboard-native, responsive, and pending-safe', () => {
    const composer = renderToStaticMarkup(createElement(TenantInvitationComposer, {
      email: 'ada@example.test',
      mode: 'manual',
      emailDelivery: true,
      manualDelivery: true,
      busy: true,
      canChooseRoles: true,
      roles: [tenantRole('member', true)],
      selectedRoles: ['member'],
      simple: true,
      tenantSingular: 'workspace',
      onEmailChange() {}, onModeChange() {}, onRolesChange() {}, onSubmit() {},
    }));
    const token = renderToStaticMarkup(createElement(ManualInvitationToken, {
      token: 'one-time-secret', headingId: 'manual-token', onCopy() {}, onDismiss() {},
    }));
    const list = renderToStaticMarkup(createElement(TenantInvitationList, {
      headingId: 'invitations', headingRef: null,
      invitations: [{
        invitationId: 'invite-1', email: 'ada@example.test', roles: ['member'],
        status: 'pending', expiresAt: 5_000, createdAt: 1, updatedAt: 1,
        acceptedAt: null, revokedAt: null,
      }],
      roleLabels: new Map([['member', 'Member']]), canManage: true, busy: false,
      hasMore: true, isLoadingMore: true, onLoadMore() {}, onRevoke() {},
    }));

    expect(composer).toContain('aria-label="Invitation email"');
    expect(composer).toContain('aria-label="Invitation delivery"');
    expect(composer).toContain('type="submit"');
    expect(composer).toContain('disabled=""');
    expect(composer).toContain('sm:grid-cols-');
    expect(token).toContain('aria-labelledby="manual-token"');
    expect(token).toContain('aria-label="One-time invitation token"');
    expect(token).toContain('readOnly=""');
    expect(list).toContain('tabindex="-1"');
    expect(list).toContain('aria-haspopup="dialog"');
    expect(list).toContain('sm:flex-row');
    expect(list).toContain('Loading…');
  });

  test('bounds persisted tenant-switch UI handoffs', () => {
    const handoff = {
      phase: 'succeeded' as const,
      userId: 'user-1',
      sourceTenantId: 'tenant-a',
      targetTenantId: 'tenant-b',
      createdAt: 1_000,
    };
    expect(parseTenantSwitcherHandoff(JSON.stringify(handoff), 1_500)).toEqual(handoff);
    expect(parseTenantSwitcherHandoff(JSON.stringify(handoff), 62_000)).toBeNull();
    expect(parseTenantSwitcherHandoff(JSON.stringify({
      ...handoff,
      targetTenantId: 'x'.repeat(513),
    }), 1_500)).toBeNull();
    expect(parseTenantSwitcherHandoff(JSON.stringify({
      ...handoff,
      targetName: 'old-scope display name',
      error: 'server detail',
    }), 1_500)).toEqual(handoff);
    expect(parseTenantSwitcherHandoff('{bad json', 1_500)).toBeNull();
  });

  test('announces confirmed invitation and join-request decisions specifically', () => {
    expect(tenantOnboardingConfirmationAnnouncement({
      action: 'revoke-invitation',
      invitation: {
        invitationId: 'invite-1',
        email: 'grace@example.test',
        roles: ['member'],
        status: 'pending',
        expiresAt: 5_000,
        createdAt: 1,
        updatedAt: 1,
        acceptedAt: null,
        revokedAt: null,
      },
    })).toBe('Revoked invitation for grace@example.test');
    expect(tenantOnboardingConfirmationAnnouncement({
      action: 'deny-join-request',
      request: {
        ...joinRequest,
        approvalPolicy: {
          canApprove: true,
          roleSelection: { mode: 'default', roles: [] },
        },
      },
    })).toBe('Denied request from ada@example.test');
  });
});

function tenantRole(key: string, grantable: boolean) {
  return {
    key,
    label: key,
    administrationOnly: false,
    permissions: [],
    allPermissions: false,
    system: false,
    assignable: true,
    grantable,
  };
}

const joinRequest = {
  joinRequestId: 'join-1',
  applicant: {
    userId: 'user-2',
    username: 'ada',
    email: 'ada@example.test',
    firstName: 'Ada',
    lastName: 'Lovelace',
  },
  status: 'pending',
  requestRevision: 1,
  requestedAt: 1,
  createdAt: 1,
  updatedAt: 1,
  reviewedAt: null,
  lastDecision: null,
  membership: null,
  reactivationRequired: false,
} satisfies Omit<AuthTenantJoinRequest, 'approvalPolicy'>;
