import { describe, expect, test } from 'bun:test';
import type { AuthTenantSummary } from './auth-types';
import {
  projectTenantAppShellWorkspaces,
  resolveTenantSwitcherStableDisplay,
  tenantSwitcherHandoffFailureReason,
  tenantSwitcherHandoffRemainingMs,
  type TenantSwitcherDisplay,
  type UseTenantSwitchPresentationResult,
} from './tenant-switch-presentation';

const alpha: AuthTenantSummary = {
  tenantId: 'tenant-a',
  kind: 'organization',
  slug: 'alpha',
  name: 'Alpha',
  role: 'owner',
};
const beta: AuthTenantSummary = {
  tenantId: 'tenant-b',
  kind: 'organization',
  slug: 'beta',
  name: 'Beta',
  role: 'member',
};
const administration: AuthTenantSummary = {
  tenantId: 'tenant-admin',
  kind: 'administration',
  slug: 'platform-administration',
  name: 'Platform administration',
  role: 'owner',
};

describe('tenant AppShell workspace projection', () => {
  test('uses only the committed active tenant and the official switch callback', () => {
    let selected = '';
    const presentation = tenantPresentation({
      tenants: [alpha, beta],
      activeTenant: beta,
      switchTenant: async (tenantId) => {
        selected = tenantId;
        return true;
      },
    });

    const workspaces = projectTenantAppShellWorkspaces(presentation, {
      hideWhenSingle: false,
    });

    expect(workspaces?.activeId).toBe('tenant-b');
    expect(workspaces?.requireActiveSelection).toBe(true);
    expect(workspaces?.label).toBe('Organizations');
    expect(workspaces?.items).toEqual([
      { id: 'tenant-a', name: 'Alpha', subtitle: 'owner' },
      { id: 'tenant-b', name: 'Beta', subtitle: 'member' },
    ]);
    workspaces?.onSelect?.(workspaces.items[0]!);
    expect(selected).toBe('tenant-a');
  });

  test('hides a completed single membership by default but not its load error', () => {
    expect(projectTenantAppShellWorkspaces(tenantPresentation({
      tenants: [alpha],
      activeTenant: alpha,
    }))).toBeUndefined();

    const failed = projectTenantAppShellWorkspaces(tenantPresentation({
      tenants: [alpha],
      activeTenant: alpha,
      error: 'Tenant list unavailable',
    }));
    expect(failed?.error).toBe('Tenant list unavailable');
    expect(failed?.retryLabel).toBe('Retry organization list');
  });

  test('keeps a single-membership control when it still exposes scoped actions', () => {
    const presentation = tenantPresentation({
      tenants: [alpha],
      activeTenant: alpha,
    });
    expect(projectTenantAppShellWorkspaces(presentation, {
      onCreate() {},
    })?.onCreate).toBeFunction();
    expect(projectTenantAppShellWorkspaces(presentation, {
      activeActions: [{ label: 'Organization settings' }],
    })?.activeActions).toHaveLength(1);
  });

  test('projects pending and completion state without optimistic selection', () => {
    const workspaces = projectTenantAppShellWorkspaces(tenantPresentation({
      tenants: [alpha, beta],
      activeTenant: alpha,
      isSwitching: true,
      announcement: 'Switched to Beta',
      focusRevision: 2,
    }));
    expect(workspaces).toMatchObject({
      activeId: 'tenant-a',
      pending: true,
      pendingLabel: 'Switching organization…',
      announcement: 'Switched to Beta',
      focusRevision: 2,
    });
  });

  test('visibly distinguishes protected administration scope from customer organizations', () => {
    const workspaces = projectTenantAppShellWorkspaces(tenantPresentation({
      tenants: [administration, alpha],
      activeTenant: administration,
    }), { hideWhenSingle: false });

    expect(workspaces?.items).toEqual([
      {
        id: 'tenant-admin',
        name: 'Platform administration',
        subtitle: 'Platform administration · owner',
      },
      { id: 'tenant-a', name: 'Alpha', subtitle: 'owner' },
    ]);
  });
});

describe('tenant switch presentation handoff recovery', () => {
  const handoff = {
    phase: 'pending' as const,
    userId: 'user-1',
    sourceTenantId: 'tenant-a',
    targetTenantId: 'tenant-b',
    createdAt: 1_000,
  };

  test('expires a pending marker exactly at its bounded lifetime', () => {
    expect(tenantSwitcherHandoffRemainingMs(handoff, 60_999)).toBe(1);
    expect(tenantSwitcherHandoffRemainingMs(handoff, 61_000)).toBe(0);
    expect(tenantSwitcherHandoffFailureReason(handoff, {
      operation: null,
      phase: 'idle',
    }, 61_000)).toBe('expired');
  });

  test('recovers immediately when tenant-session reconciliation is required', () => {
    expect(tenantSwitcherHandoffFailureReason(handoff, {
      operation: 'tenant-switch',
      phase: 'recovery-required',
    }, 2_000)).toBe('recovery-required');
    expect(tenantSwitcherHandoffFailureReason(handoff, {
      operation: 'authentication',
      phase: 'recovery-required',
    }, 2_000)).toBeNull();
  });
});

describe('tenant switch stable display identity boundary', () => {
  const display: TenantSwitcherDisplay = {
    userId: 'user-a',
    activeTenant: alpha,
    tenants: [alpha, beta],
  };
  const pendingHandoff = {
    phase: 'pending' as const,
    userId: 'user-a',
    sourceTenantId: alpha.tenantId,
    targetTenantId: beta.tenantId,
    createdAt: 1_000,
  };

  test('never carries account A tenant names or roles into account B', () => {
    expect(resolveTenantSwitcherStableDisplay({
      display,
      committedUserId: 'user-b',
      transition: { operation: null, phase: 'idle' },
      handoff: null,
    })).toBeNull();
    expect(resolveTenantSwitcherStableDisplay({
      display,
      committedUserId: null,
      transition: { operation: 'authentication', phase: 'reconciling' },
      handoff: pendingHandoff,
    })).toBeNull();
  });

  test('preserves a masked display only for its same-user tenant switch', () => {
    expect(resolveTenantSwitcherStableDisplay({
      display,
      committedUserId: null,
      transition: { operation: 'tenant-switch', phase: 'preparing' },
      handoff: pendingHandoff,
    })).toBe(display);
    expect(resolveTenantSwitcherStableDisplay({
      display,
      committedUserId: null,
      transition: { operation: 'tenant-switch', phase: 'reconciling' },
      handoff: { ...pendingHandoff, userId: 'user-b' },
    })).toBeNull();
    expect(resolveTenantSwitcherStableDisplay({
      display,
      committedUserId: null,
      transition: { operation: 'tenant-switch', phase: 'committed' },
      handoff: { ...pendingHandoff, sourceTenantId: 'tenant-other' },
    })).toBeNull();
  });

  test('drops masked logout and recovery state but keeps proven recovery identity', () => {
    expect(resolveTenantSwitcherStableDisplay({
      display,
      committedUserId: null,
      transition: { operation: 'logout', phase: 'preparing' },
      handoff: null,
    })).toBeNull();
    expect(resolveTenantSwitcherStableDisplay({
      display,
      committedUserId: null,
      transition: { operation: 'tenant-switch', phase: 'recovery-required' },
      handoff: pendingHandoff,
    })).toBeNull();
    expect(resolveTenantSwitcherStableDisplay({
      display,
      committedUserId: 'user-a',
      transition: { operation: 'tenant-switch', phase: 'recovery-required' },
      handoff: pendingHandoff,
    })).toBe(display);
  });
});

function tenantPresentation(
  overrides: Partial<UseTenantSwitchPresentationResult> = {},
): UseTenantSwitchPresentationResult {
  return {
    isAvailable: true,
    terminology: { singular: 'organization', plural: 'organizations' },
    tenants: [alpha, beta],
    activeTenant: alpha,
    isLoading: false,
    isSwitching: false,
    error: null,
    announcement: '',
    focusRevision: 0,
    reload() {},
    async switchTenant() { return true; },
    ...overrides,
  };
}
