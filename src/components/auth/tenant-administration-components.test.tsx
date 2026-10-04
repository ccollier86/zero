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
import { canRetainTenantMemberConfirmation } from './tenant-member-management-parts';
import {
  canSubmitTenantInvitation,
  filterJoinRequestApprovalRoles,
  JoinRequestRow,
  joinRequestApprovalParams,
  resolveInvitationDeliveryMode,
  resolveTenantOnboardingSectionPhase,
  tenantOnboardingManagementBoundaryKey,
  tenantOnboardingConfirmationAnnouncement,
  TenantOnboardingManagement,
  TenantOnboardingSectionStatus,
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
    expect(markup).toMatch(/<h2[^>]*>Organization members<\/h2>/);
    expect(markup).toContain('data-slot="list-detail-layout"');
    expect(markup).toContain('data-slot="record-navigation-bar"');
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
    expect(markup).toMatch(
      /<h2[^>]*data-slot="card-title"[^>]*>Organization onboarding<\/h2>/,
    );
    expect(markup).toContain(
      'Organization onboarding controls require signing in with active organization access.',
    );
  });

  test('distinguishes onboarding policy, permission, and transport states per section', () => {
    expect(resolveTenantOnboardingSectionPhase({
      authConfigStatus: 'loading',
      featureEnabled: null,
      isLoading: true,
      isTenantConfigLoading: false,
      hasTenantConfig: false,
      tenantConfigError: null,
      isTenantConfigPermissionDenied: false,
      isPermissionDenied: false,
      error: null,
    })).toBe('loading-policy');
    expect(resolveTenantOnboardingSectionPhase({
      authConfigStatus: 'error',
      featureEnabled: false,
      isLoading: false,
      isTenantConfigLoading: false,
      hasTenantConfig: false,
      tenantConfigError: null,
      isTenantConfigPermissionDenied: false,
      isPermissionDenied: false,
      error: null,
    })).toBe('config-error');
    expect(resolveTenantOnboardingSectionPhase({
      authConfigStatus: 'ready',
      featureEnabled: false,
      isLoading: false,
      isTenantConfigLoading: false,
      hasTenantConfig: false,
      tenantConfigError: null,
      isTenantConfigPermissionDenied: false,
      isPermissionDenied: false,
      error: null,
    })).toBe('disabled');
    expect(resolveTenantOnboardingSectionPhase({
      authConfigStatus: 'ready',
      featureEnabled: true,
      isLoading: false,
      isTenantConfigLoading: false,
      hasTenantConfig: false,
      tenantConfigError: 'protected config failed',
      isTenantConfigPermissionDenied: false,
      isPermissionDenied: false,
      error: null,
    })).toBe('tenant-config-error');
    expect(resolveTenantOnboardingSectionPhase({
      authConfigStatus: 'ready',
      featureEnabled: true,
      isLoading: false,
      isTenantConfigLoading: false,
      hasTenantConfig: false,
      tenantConfigError: null,
      isTenantConfigPermissionDenied: false,
      isPermissionDenied: false,
      error: null,
    })).toBe('loading');
    expect(resolveTenantOnboardingSectionPhase({
      authConfigStatus: 'ready',
      featureEnabled: true,
      isLoading: false,
      isTenantConfigLoading: false,
      hasTenantConfig: false,
      tenantConfigError: null,
      isTenantConfigPermissionDenied: true,
      isPermissionDenied: false,
      error: null,
    })).toBe('permission-denied');
    expect(resolveTenantOnboardingSectionPhase({
      authConfigStatus: 'ready',
      featureEnabled: true,
      isLoading: false,
      isTenantConfigLoading: false,
      hasTenantConfig: true,
      tenantConfigError: null,
      isTenantConfigPermissionDenied: false,
      isPermissionDenied: true,
      error: null,
    })).toBe('permission-denied');
    expect(resolveTenantOnboardingSectionPhase({
      authConfigStatus: 'ready',
      featureEnabled: true,
      isLoading: false,
      isTenantConfigLoading: false,
      hasTenantConfig: true,
      tenantConfigError: null,
      isTenantConfigPermissionDenied: false,
      isPermissionDenied: false,
      error: 'request timed out',
    })).toBe('transport-error');

    const disabled = renderOnboardingStatus(
      'disabled',
      'Invitations are disabled by application policy.',
    );
    const denied = renderOnboardingStatus(
      'permission-denied',
      'Invitation history is not available for your current role.',
    );
    const configError = renderOnboardingStatus(
      'config-error',
      'Invitation policy could not be loaded.',
      'private upstream config body',
    );
    const transportError = renderOnboardingStatus(
      'transport-error',
      'request timed out',
      'request timed out',
    );
    const tenantConfigError = renderOnboardingStatus(
      'tenant-config-error',
      'Tenant onboarding access could not be loaded.',
      'feature transport detail',
    );

    expect(disabled).toContain('disabled by application policy');
    expect(disabled).not.toContain('Retry');
    expect(denied).toContain('not available for your current role');
    expect(denied).not.toContain('Retry');
    expect(configError).toContain('Invitation policy could not be loaded.');
    expect(configError).toContain('Retry');
    expect(configError).not.toContain('private upstream config body');
    expect(transportError).toContain('request timed out');
    expect(transportError).toContain('Retry');
    expect(tenantConfigError).toContain(
      'Tenant onboarding access could not be loaded.',
    );
    expect(tenantConfigError).not.toContain('feature transport detail');
  });

  test('resets sensitive onboarding UI at authorization-family boundaries', () => {
    expect(tenantOnboardingManagementBoundaryKey(
      'authorization-family-a',
      'user-a',
      'tenant-a',
    )).not.toBe(tenantOnboardingManagementBoundaryKey(
      'authorization-family-b',
      'user-a',
      'tenant-a',
    ));
  });

  test('keeps clipboard failure beside the retained one-time token', () => {
    const markup = renderToStaticMarkup(createElement(ManualInvitationToken, {
      token: 'secret-token',
      headingId: 'manual-token',
      copyError: 'Clipboard is unavailable.',
      onCopy() {},
      onDismiss() {},
    }));

    expect(markup).toContain('Clipboard is unavailable.');
    expect(markup).toContain('Use the one-time token field above to copy it manually.');
    expect(markup).toContain('value="secret-token"');
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

  test('requires projected invitation roles for every submission path', () => {
    expect(canSubmitTenantInvitation('person@example.com', true, [])).toBe(false);
    expect(canSubmitTenantInvitation(
      'person@example.com',
      true,
      ['member'],
    )).toBe(true);
    expect(canSubmitTenantInvitation('person@example.com', false, [])).toBe(true);
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

  test('keeps platform roles out of customers and offers both role realms in administration', () => {
    const customer = tenantRole('member', true);
    const administrator = {
      ...tenantRole('administrator', true),
      administrationOnly: true,
    };

    expect(rolesForTenantKind([customer, administrator], 'organization')
      .map((role) => role.key)).toEqual(['member']);
    expect(rolesForTenantKind([customer, administrator], 'administration')
      .map((role) => role.key)).toEqual(['member', 'administrator']);
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
    expect(administration).toContain('adaptive UserManagement control plane');
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
    const administratorToken = renderToStaticMarkup(createElement(ManualInvitationToken, {
      token: 'one-time-admin-secret',
      headingId: 'administrator-token',
      inputLabel: 'One-time administrator invitation token',
      recipient: 'intended administrator',
      onCopy() {},
      onDismiss() {},
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
    expect(token).toContain('font-mono');
    expect(token).toContain('autoComplete="off"');
    expect(token).toContain('spellCheck="false"');
    expect(token).toContain('Copy now');
    expect(token).toContain('Dismiss and clear from page');
    expect(token).toContain('aria-live="polite"');
    expect(administratorToken).toContain(
      'aria-label="One-time administrator invitation token"',
    );
    expect(administratorToken).toContain('intended administrator');
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

  test('closes member confirmations immediately when their exact capability vanishes', () => {
    const member = tenantMember();
    const allCapabilities = {
      canReadMembers: true,
      canManageMembers: true,
      canTransferOwnership: true,
    };

    expect(canRetainTenantMemberConfirmation(
      { action: 'suspend', member },
      allCapabilities,
    )).toBe(true);
    expect(canRetainTenantMemberConfirmation(
      { action: 'remove', member },
      { ...allCapabilities, canManageMembers: false },
    )).toBe(false);
    expect(canRetainTenantMemberConfirmation(
      { action: 'transfer', member },
      { ...allCapabilities, canTransferOwnership: false },
    )).toBe(false);
    expect(canRetainTenantMemberConfirmation(
      { action: 'transfer', member },
      { ...allCapabilities, canReadMembers: false },
    )).toBe(false);
  });
});

function renderOnboardingStatus(
  phase: Exclude<
    ReturnType<typeof resolveTenantOnboardingSectionPhase>,
    'ready'
  >,
  expectedMessage: string,
  transportError: string | null = null,
): string {
  const markup = renderToStaticMarkup(createElement(
    TenantOnboardingSectionStatus,
    {
      headingId: 'invitation-status',
      title: 'Invitations',
      phase,
      loadingPolicyMessage: 'Loading invitation policy…',
      loadingMessage: 'Loading invitations…',
      configErrorMessage: 'Invitation policy could not be loaded.',
      tenantConfigErrorMessage: 'Tenant onboarding access could not be loaded.',
      disabledMessage: 'Invitations are disabled by application policy.',
      permissionDeniedMessage:
        'Invitation history is not available for your current role.',
      transportError,
      busy: false,
      onRetry() {},
    },
  ));
  expect(markup).toContain(expectedMessage);
  return markup;
}

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

function tenantMember() {
  return {
    membershipId: 'membership-1',
    identity: {
      userId: 'user-1',
      username: 'grace',
      email: 'grace@example.test',
      firstName: 'Grace',
      lastName: 'Hopper',
    },
    status: 'active' as const,
    roles: ['member'],
    roleRevision: 'tenant-1:membership-1:1',
    joinedAt: 1,
    updatedAt: 1,
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
