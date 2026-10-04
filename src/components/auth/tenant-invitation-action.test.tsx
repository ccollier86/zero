import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Dialog } from '#zero/components/animate-ui/components/radix/dialog';
import type {
  AuthPublicConfig,
  AuthTenantAdministrationConfig,
  AuthTenantInvitation,
  AuthTenantRoleDescriptor,
} from '../../frontend/client/auth-types';
import {
  boundedTenantInvitationPageSize,
  projectTenantInvitationRoles,
  resolveTenantInvitationActionPolicy,
} from './tenant-invitation-action-policy';
import { TenantInvitationDialogBody } from './tenant-invitation-dialog';
import { TenantPendingInvitationSection } from './tenant-pending-invitation-section';

describe('tenant invitation action', () => {
  test('fails closed until live policy and invitation authority are available', () => {
    expect(resolveTenantInvitationActionPolicy({
      publicConfig: null,
      administrationConfig: null,
      invitationsEnabled: null,
      tenantKind: null,
    })).toMatchObject({
      availableModes: [],
      canChooseRoles: false,
      canIssue: false,
    });

    expect(resolveTenantInvitationActionPolicy({
      publicConfig: publicConfig(),
      administrationConfig: administrationConfig(),
      invitationsEnabled: false,
      tenantKind: 'organization',
    }).canIssue).toBe(false);
  });

  test('bounds compact pending-invitation pages to the transport contract', () => {
    expect(boundedTenantInvitationPageSize()).toBe(10);
    expect(boundedTenantInvitationPageSize(0)).toBe(1);
    expect(boundedTenantInvitationPageSize(10.9)).toBe(10);
    expect(boundedTenantInvitationPageSize(500)).toBe(100);
    expect(boundedTenantInvitationPageSize(Number.NaN)).toBe(10);
  });

  test('limits invitation roles to active-scope choices inside the actor grant ceiling', () => {
    const policy = resolveTenantInvitationActionPolicy({
      publicConfig: publicConfig(),
      administrationConfig: administrationConfig({
        roles: [
          role('member'),
          role('manager'),
          role('locked', { grantable: false }),
          role('owner', { system: true }),
          role('administrator', { administrationOnly: true }),
        ],
      }),
      invitationsEnabled: true,
      tenantKind: 'organization',
    });

    expect(policy.canIssue).toBe(true);
    expect(policy.canChooseRoles).toBe(true);
    expect(policy.roleChoices.map((item) => item.key)).toEqual([
      'member',
      'manager',
    ]);
  });

  test('keeps read-only pending history reachable without exposing the composer', () => {
    const config = administrationConfig();
    config.capabilities.canManageInvitations = false;
    const policy = resolveTenantInvitationActionPolicy({
      publicConfig: publicConfig(),
      administrationConfig: config,
      invitationsEnabled: true,
      tenantKind: 'organization',
    });
    const markup = renderToStaticMarkup(
      <Dialog open>
        <TenantInvitationDialogBody
          email=""
          mode="manual"
          availableModes={['manual']}
          roles={[]}
          selectedRoles={[]}
          simple
          canChooseRoles={false}
          canIssue={false}
          busy={false}
          error={null}
          manualToken={null}
          manualTokenError={null}
          pendingContent={<section>Pending invitation directory</section>}
          tenantSingular="workspace"
          onEmailChange={() => {}}
          onModeChange={() => {}}
          onRolesChange={() => {}}
          onSubmit={() => {}}
          onCopyToken={() => {}}
          onDismissToken={() => {}}
        />
      </Dialog>,
    );

    expect(policy).toMatchObject({ canRead: true, canIssue: false, canOpen: true });
    expect(markup).toContain('Pending invitations');
    expect(markup).toContain('Pending invitation directory');
    expect(markup).not.toContain('Invitation email');
    expect(markup).toContain('Close');
  });

  test('requires at least one grantable role in protected scope', () => {
    const denied = resolveTenantInvitationActionPolicy({
      publicConfig: publicConfig(),
      administrationConfig: administrationConfig({
        roles: [role('administrator', {
          administrationOnly: true,
          grantable: false,
        })],
      }),
      invitationsEnabled: true,
      tenantKind: 'administration',
    });
    const allowed = resolveTenantInvitationActionPolicy({
      publicConfig: publicConfig(),
      administrationConfig: administrationConfig({
        roles: [role('member')],
      }),
      invitationsEnabled: true,
      tenantKind: 'administration',
    });

    expect(denied.canIssue).toBe(false);
    expect(allowed.canIssue).toBe(true);
    expect(allowed.roleChoices.map((item) => item.key)).toEqual(['member']);
  });

  test('preserves valid drafts and otherwise selects member or the first role', () => {
    const roles = [role('manager'), role('member')];

    expect(projectTenantInvitationRoles(['manager'], roles, true))
      .toEqual(['manager']);
    expect(projectTenantInvitationRoles(['retired'], roles, false))
      .toEqual(['member']);
    expect(projectTenantInvitationRoles(['manager', 'member'], roles, true))
      .toEqual(['member']);
    expect(projectTenantInvitationRoles([], [], false)).toEqual([]);
  });

  test('renders a focused invitation dialog without a page-level card', () => {
    const markup = renderToStaticMarkup(
      <Dialog open>
      <TenantInvitationDialogBody
        email=""
        mode="manual"
        availableModes={['manual', 'email']}
        roles={[role('member')]}
        selectedRoles={['member']}
        simple
        canChooseRoles
        canIssue
        busy={false}
        error={null}
        manualToken={null}
        manualTokenError={null}
        tenantSingular="workspace"
        onEmailChange={() => {}}
        onModeChange={() => {}}
        onRolesChange={() => {}}
        onSubmit={() => {}}
        onCopyToken={() => {}}
        onDismissToken={() => {}}
      />
      </Dialog>,
    );

    expect(markup).toContain('Invite member');
    expect(markup).toContain('Invitation email');
    expect(markup).toContain('Invitation workspace role');
    expect(markup).not.toContain('data-slot="card"');
  });

  test('keeps a manual one-time token visible after issuance', () => {
    const markup = renderToStaticMarkup(
      <Dialog open>
      <TenantInvitationDialogBody
        email="person@example.com"
        mode="manual"
        availableModes={['manual']}
        roles={[]}
        selectedRoles={[]}
        simple
        canChooseRoles={false}
        canIssue
        busy={false}
        error={null}
        manualToken="one-time-secret"
        manualTokenError="Clipboard unavailable."
        pendingContent={<section>Pending invitations remain visible</section>}
        tenantSingular="workspace"
        onEmailChange={() => {}}
        onModeChange={() => {}}
        onRolesChange={() => {}}
        onSubmit={() => {}}
        onCopyToken={() => {}}
        onDismissToken={() => {}}
      />
      </Dialog>,
    );

    expect(markup).toContain('one-time-secret');
    expect(markup).toContain('Clipboard unavailable.');
    expect(markup).toContain('Dismiss and clear from page');
    expect(markup).toContain('Pending invitations remain visible');
    expect(markup).not.toContain('Invitation email');
  });

  test('renders compact pending invitation details, revoke, and pagination', () => {
    const markup = renderPendingInvitations({
      invitations: [invitation()],
      canManage: true,
      hasMore: true,
    });

    expect(markup).toContain('Pending invitations');
    expect(markup).toContain('person@example.com');
    expect(markup).toContain('pending');
    expect(markup).toContain('Workspace manager');
    expect(markup).toContain('Expires');
    expect(markup).toContain('Revoke');
    expect(markup).toContain('Load more invitations');
    expect(markup).not.toContain('data-slot="card"');
  });

  test('gates pending invitation history and revoke by exact capabilities', () => {
    const readOnly = renderPendingInvitations({
      invitations: [invitation()],
      canManage: false,
    });
    const denied = renderPendingInvitations({
      invitations: [],
      canManage: false,
      permissionDenied: true,
    });

    expect(readOnly).toContain('person@example.com');
    expect(readOnly).not.toContain('Revoke');
    expect(denied).toContain(
      'Pending invitation history is unavailable for your current role.',
    );
    expect(denied).not.toContain('person@example.com');
  });
});

function renderPendingInvitations({
  invitations,
  canManage,
  hasMore = false,
  permissionDenied = false,
}: {
  invitations: AuthTenantInvitation[];
  canManage: boolean;
  hasMore?: boolean;
  permissionDenied?: boolean;
}): string {
  return renderToStaticMarkup(
    <TenantPendingInvitationSection
      authConfigStatus="ready"
      featureEnabled
      isTenantConfigLoading={false}
      hasTenantConfig
      tenantConfigError={null}
      isTenantConfigPermissionDenied={false}
      isLoading={false}
      isLoadingMore={false}
      isMutating={false}
      isPermissionDenied={permissionDenied}
      error={null}
      invitations={invitations}
      page={{
        limit: 10,
        count: invitations.length,
        hasMore,
        nextCursor: hasMore ? 'next' : null,
      }}
      roleLabels={new Map([['manager', 'Workspace manager']])}
      canManage={canManage}
      tenantSingular="workspace"
      onReload={() => {}}
      onLoadMore={async () => {}}
      onRevoke={async () => invitation()}
      onAnnounce={() => {}}
    />,
  );
}

function invitation(): AuthTenantInvitation {
  return {
    invitationId: 'invitation-1',
    email: 'person@example.com',
    roles: ['manager'],
    status: 'pending',
    expiresAt: Date.UTC(2026, 9, 8, 12),
    createdAt: Date.UTC(2026, 9, 1, 12),
    updatedAt: Date.UTC(2026, 9, 1, 12),
    acceptedAt: null,
    revokedAt: null,
  };
}

function publicConfig(): AuthPublicConfig {
  return {
    registration: {
      mode: 'public',
      bootstrapRequired: false,
      publicRegistrationEnabled: true,
    },
    tenancy: {
      mode: 'multi',
      terminology: { singular: 'workspace', plural: 'workspaces' },
      onboarding: {
        invitations: {
          enabled: true,
          accountCreation: true,
          delivery: { default: 'manual', manual: true, email: true },
        },
        joinRequests: { enabled: true },
      },
    },
  };
}

function administrationConfig(
  overrides: Partial<AuthTenantAdministrationConfig> = {},
): AuthTenantAdministrationConfig {
  return {
    tenancy: 'multi',
    authorization: 'advanced',
    terminology: { singular: 'workspace', plural: 'workspaces' },
    tenant: {
      tenantId: 'tenant-1',
      kind: 'organization',
      slug: 'workspace',
      name: 'Workspace',
    },
    actor: {
      membershipId: 'membership-1',
      roles: ['owner'],
      permissions: [],
      allPermissions: true,
    },
    capabilities: {
      canReadMembers: true,
      canManageMembers: true,
      canReadRoles: true,
      canManageRoles: true,
      canTransferOwnership: true,
      canReadInvitations: true,
      canManageInvitations: true,
      canReviewJoinRequests: true,
    },
    roles: [role('member')],
    ...overrides,
  };
}

function role(
  key: string,
  overrides: Partial<AuthTenantRoleDescriptor> = {},
): AuthTenantRoleDescriptor {
  return {
    key,
    label: key,
    permissions: [],
    allPermissions: false,
    administrationOnly: false,
    system: false,
    assignable: true,
    grantable: true,
    ...overrides,
  };
}
