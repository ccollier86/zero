import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AuthPlatformTenant } from '../../frontend/client/auth-platform-administration-types';
import type { UsePlatformTenantsResult } from '../../frontend/client/platform-administration-hooks';
import { PlatformWorkspaceCreateForm } from './platform-workspace-create-form';
import { PlatformWorkspaceDetail } from './platform-workspace-detail';
import {
  PlatformWorkspaceLoadError,
  PlatformWorkspaceReadDenied,
  PlatformWorkspaceUnavailable,
} from './platform-workspace-access-states';
import {
  PlatformWorkspaceManagement,
  restorePlatformWorkspacePeopleTriggerFocus,
} from './platform-workspace-management';
import {
  resolvePlatformWorkspaceDirectoryError,
  resolvePlatformWorkspaceMemberError,
  retryPlatformWorkspaceDirectoryError,
  retryPlatformWorkspaceMemberError,
} from './platform-workspace-error-routing';
import {
  boundedPlatformWorkspacePageSize,
  resolvePlatformWorkspaceSelectedId,
  resolvePlatformWorkspaceTerminology,
} from './platform-workspace-policy';
import { toPlatformWorkspaceRows } from './platform-workspace-schema';
import { PlatformWorkspaceToolbar } from './platform-workspace-toolbar';
import { resolvePlatformWorkspaceLifecycleTarget } from './use-platform-workspace-lifecycle-actions';
import { platformMemberCapabilities } from './use-platform-workspace-member-controller';

describe('platform workspace management', () => {
  test('renders a cohesive unavailable workspace instead of a single-action card stack', () => {
    const markup = renderToStaticMarkup(createElement(PlatformWorkspaceManagement));

    expect(markup).toContain('Customer organizations');
    expect(markup).toContain('Switch to the administration organization');
    expect(markup).not.toContain('data-slot="card"');
    expect(markup).not.toContain('Create organization');
  });

  test('keeps terminology and page bounds deterministic', () => {
    expect(resolvePlatformWorkspaceTerminology({ singular: 'practice', plural: 'practices' }))
      .toEqual({ singular: 'practice', plural: 'practices' });
    expect(resolvePlatformWorkspaceTerminology({ singular: ' ', plural: '' }))
      .toEqual({ singular: 'organization', plural: 'organizations' });
    expect(boundedPlatformWorkspacePageSize(0)).toBe(1);
    expect(boundedPlatformWorkspacePageSize(500)).toBe(100);
    expect(boundedPlatformWorkspacePageSize(Number.NaN)).toBe(25);
  });

  test('resolves the first valid workspace without owning controlled state', () => {
    const visible = ['tenant-a', 'tenant-b'];
    expect(resolvePlatformWorkspaceSelectedId(null, visible)).toBe('tenant-a');
    expect(resolvePlatformWorkspaceSelectedId('missing', visible)).toBe('tenant-a');
    expect(resolvePlatformWorkspaceSelectedId('tenant-b', visible)).toBe('tenant-b');
    expect(resolvePlatformWorkspaceSelectedId('tenant-b', [])).toBeNull();
  });

  test('holds the current selection until the created workspace can be committed', () => {
    expect(resolvePlatformWorkspaceSelectedId(
      'tenant-a',
      ['tenant-a', 'tenant-b'],
      'tenant-new',
    )).toBe('tenant-a');
    expect(resolvePlatformWorkspaceSelectedId(
      null,
      ['tenant-a', 'tenant-b'],
      'tenant-new',
    )).toBeNull();
    expect(resolvePlatformWorkspaceSelectedId(
      'tenant-a',
      ['tenant-a', 'tenant-new'],
      'tenant-new',
    )).toBe('tenant-a');
    expect(resolvePlatformWorkspaceSelectedId(
      'tenant-new',
      ['tenant-a', 'tenant-new'],
      'tenant-new',
    )).toBe('tenant-new');
  });

  test('uses a compact scope-aware toolbar with server-backed directory controls', () => {
    const markup = renderToStaticMarkup(createElement(PlatformWorkspaceToolbar, {
      titleId: 'workspace-title',
      descriptionId: 'workspace-description',
      title: 'Customer practices',
      description: 'Browse customer practices and inspect their access.',
      scopeName: 'Zero Administration',
      singular: 'practice',
      plural: 'practices',
      search: '',
      status: 'all',
      canRead: true,
      isLoading: false,
      isLoadingMore: false,
      hasMore: true,
      onSearchChange() {},
      onStatusChange() {},
      onReload() {},
      onLoadMore() {},
    }));

    expect(markup).toContain('Zero Administration');
    expect(markup).toContain('aria-label="Search customer practices"');
    expect(markup).toContain('aria-label="Customer practice status"');
    expect(markup).toContain('Load more');
    expect(markup).not.toContain('data-slot="card"');
  });

  test('keeps creation in a focused form suitable for a modal', () => {
    const markup = renderToStaticMarkup(createElement(PlatformWorkspaceCreateForm, {
      singular: 'practice',
      async onSubmit() {},
    }));

    expect(markup).toContain('Practice name');
    expect(markup).toContain('URL name (optional)');
    expect(markup).toContain('Initial owner email');
    expect(markup).toContain('Account creation remains in People management');
    expect(markup).toContain('Create practice');
    expect(markup).not.toContain('data-slot="card"');
  });

  test('shows selected workspace facts and member access context in the detail pane', () => {
    const [workspace] = toPlatformWorkspaceRows([tenant()]);
    const markup = renderToStaticMarkup(createElement(PlatformWorkspaceDetail, {
      workspace: workspace!,
      singular: 'practice',
      members: [{
        membershipId: 'membership-1',
        identity: {
          userId: 'user-1',
          username: 'grace',
          email: 'grace@example.test',
          firstName: 'Grace',
          lastName: 'Hopper',
        },
        status: 'active',
        roles: ['clinician'],
        roleRevision: 'revision-1',
        joinedAt: 1,
        updatedAt: 2,
      }],
      roleLabels: new Map([['clinician', 'Clinical collaborator']]),
      canReadMembers: true,
      canManageMembers: true,
      isLoadingMembers: false,
      onOpenMembers() {},
    }));

    expect(markup).toContain('Active members');
    expect(markup).toContain('Open the focused people workspace');
    expect(markup).toContain('Grace Hopper');
    expect(markup).toContain('Clinical collaborator');
    expect(markup).toContain('Manage people');
    expect(markup).not.toContain('data-slot="card"');
  });

  test('keeps the people drill-in useful but read-only without mutation authority', () => {
    const [workspace] = toPlatformWorkspaceRows([tenant()]);
    const markup = renderToStaticMarkup(createElement(PlatformWorkspaceDetail, {
      workspace: workspace!,
      singular: 'practice',
      members: [],
      roleLabels: new Map(),
      canReadMembers: true,
      canManageMembers: false,
      isLoadingMembers: false,
      onOpenMembers() {},
    }));

    expect(markup).toContain('View people');
    expect(markup).not.toContain('Manage people');
    expect(markup).toContain('data-platform-workspace-people-trigger');
  });

  test('restores Back focus only within the owning management instance', () => {
    const focused: string[] = [];
    const firstInstance = {
      current: { focus: () => focused.push('first') },
    };
    const secondInstance = {
      current: { focus: () => focused.push('second') },
    };

    expect(restorePlatformWorkspacePeopleTriggerFocus(secondInstance)).toBe(true);
    expect(focused).toEqual(['second']);
    expect(restorePlatformWorkspacePeopleTriggerFocus(firstInstance)).toBe(true);
    expect(focused).toEqual(['second', 'first']);
    expect(restorePlatformWorkspacePeopleTriggerFocus({ current: null })).toBe(false);
  });

  test('fails customer mutation capabilities closed unless member reads are also authorized', () => {
    const directory = (canReadTenantMembers: boolean) => ({
      config: {
        capabilities: {
          canReadTenantMembers,
          canManageTenantMembers: true,
        },
      },
    }) as UsePlatformTenantsResult;

    expect(platformMemberCapabilities(directory(false), 'active')).toEqual({
      canReadMembers: false,
      canManageMembers: false,
      canManageRoles: false,
      canTransferOwnership: false,
    });
    expect(platformMemberCapabilities(directory(true), 'active')).toEqual({
      canReadMembers: true,
      canManageMembers: true,
      canManageRoles: true,
      canTransferOwnership: true,
    });
    expect(platformMemberCapabilities(directory(true), 'suspended')).toEqual({
      canReadMembers: true,
      canManageMembers: false,
      canManageRoles: false,
      canTransferOwnership: false,
    });
  });

  test('revalidates capability, in-flight state, and current projection after confirmation', () => {
    const active = tenant();
    expect(resolvePlatformWorkspaceLifecycleTarget({
      canManage: true,
      isMutating: false,
      tenants: [active],
    }, active.tenantId)).toEqual(active);
    expect(resolvePlatformWorkspaceLifecycleTarget({
      canManage: false,
      isMutating: false,
      tenants: [active],
    }, active.tenantId)).toBeNull();
    expect(resolvePlatformWorkspaceLifecycleTarget({
      canManage: true,
      isMutating: true,
      tenants: [active],
    }, active.tenantId)).toBeNull();
    expect(resolvePlatformWorkspaceLifecycleTarget({
      canManage: true,
      isMutating: false,
      tenants: [{ ...active, status: 'archived' }],
    }, active.tenantId)).toBeNull();
  });

  test('offers a compact non-hook unavailable primitive for adaptive parents', () => {
    const markup = renderToStaticMarkup(createElement(PlatformWorkspaceUnavailable, {
      title: 'Customer practices',
      description: 'Inspect practices.',
      plural: 'practices',
    }));

    expect(markup).toContain('Customer practices');
    expect(markup).toContain('customer practices');
    expect(markup).not.toContain('data-slot="card"');
  });

  test('retains independently granted create authority when directory reads are denied', () => {
    const markup = renderToStaticMarkup(createElement(PlatformWorkspaceReadDenied, {
      singular: 'practice',
      plural: 'practices',
      canCreate: true,
      isMutating: false,
      onCreate() {},
    }));

    expect(markup).toContain('cannot view customer practices');
    expect(markup).toContain('Create practice');
    expect(markup).not.toContain('data-slot="card"');
  });

  test('announces list failures once with a focused retry action', () => {
    const markup = renderToStaticMarkup(createElement(PlatformWorkspaceLoadError, {
      error: 'Directory transport failed',
      onRetry() {},
    }));

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Directory transport failed');
    expect(markup).toContain('Retry');
  });

  test('renders selected-member failures in the member preview instead of an empty result', () => {
    const [workspace] = toPlatformWorkspaceRows([tenant()]);
    const markup = renderToStaticMarkup(createElement(PlatformWorkspaceDetail, {
      workspace: workspace!,
      singular: 'practice',
      members: [],
      roleLabels: new Map(),
      canReadMembers: true,
      canManageMembers: true,
      isLoadingMembers: false,
      membersError: 'Member directory failed',
      onRetryMembers() {},
      onOpenMembers() {},
    }));

    expect(markup).toContain('Member directory failed');
    expect(markup).toContain('Retry member list');
    expect(markup).not.toContain('No members match this view');
  });

  test('routes directory and member retries only to their owning slices', () => {
    const calls: string[] = [];
    const directoryFailure = resolvePlatformWorkspaceDirectoryError({
      directoryError: 'Directory failed',
      mutationError: null,
    });
    retryPlatformWorkspaceDirectoryError(directoryFailure, {
      clearMutationError: () => calls.push('clear-mutation'),
      reloadDirectory: () => calls.push('reload-directory'),
    });
    expect(calls).toEqual(['reload-directory']);

    calls.length = 0;
    const memberFailure = resolvePlatformWorkspaceMemberError({
      localError: null,
      mutationError: null,
      membersError: 'Members failed',
    });
    retryPlatformWorkspaceMemberError(memberFailure, {
      clearLocalError: () => calls.push('clear-local'),
      clearMutationError: () => calls.push('clear-mutation'),
      reloadMembers: () => calls.push('reload-members'),
    });
    expect(calls).toEqual(['clear-local', 'reload-members']);

    calls.length = 0;
    const mutationFailure = resolvePlatformWorkspaceMemberError({
      localError: 'Role update failed',
      mutationError: 'Role update failed',
      membersError: 'Stale member read',
    });
    retryPlatformWorkspaceMemberError(mutationFailure, {
      clearLocalError: () => calls.push('clear-local'),
      clearMutationError: () => calls.push('clear-mutation'),
      reloadMembers: () => calls.push('reload-members'),
    });
    expect(calls).toEqual(['clear-local', 'clear-mutation', 'reload-members']);
  });
});

function tenant(): AuthPlatformTenant {
  return {
    tenantId: 'tenant-acme',
    kind: 'organization',
    slug: 'acme-health',
    name: 'Acme Health',
    status: 'active',
    authorizationGeneration: 1,
    createdAt: 1,
    updatedAt: 2,
    suspendedAt: null,
    memberCount: 4,
    activeMemberCount: 3,
  };
}
