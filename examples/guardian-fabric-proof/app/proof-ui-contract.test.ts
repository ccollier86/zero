import { describe, expect, test } from 'bun:test';

import { tasks } from '../db/schema';
import { tasksResource } from '../server/resources/tasks';
import {
  TASK_CAPABILITY_ORDER,
  TASK_ROLE_REGISTRY,
  taskRoleAllows,
} from '../shared/task-access';
import {
  cleanOnboardingHref,
  clearInvitationRoute,
  hasInvitationRouteMaterial,
  INVITATION_HANDOFF_TTL_MS,
  invitationHandoffRemainingMs,
  isWorkspaceSlug,
  normalizeWorkspaceSlug,
  parseWorkspaceSlug,
  parseInvitationRoute,
  rememberInvitationRoute,
  resolveInvitationRouteEntry,
  restoreInvitationRoute,
} from './auth-route-query';
import {
  activeTenantActions,
  dashboardNavigation,
} from './components/dashboard-shell';
import {
  ADMINISTRATION_STEPS,
  CUSTOMER_STEPS,
} from './components/proof-overview';
import {
  connectionStatus,
  fabricStatus,
  realtimeStatus,
} from './components/proof-status-grid';
import { TASK_COLUMNS, TASK_READ_PERMISSIONS } from './tasks/task-types';

describe('Guardian + Fabric proof UI contract', () => {
  test('admits either declared task-read permission before mounting Sync', () => {
    expect(TASK_READ_PERMISSIONS).toEqual(['tasks:read:any', 'tasks:read']);
  });

  test('routes the workspace switcher action to the active scope management page', () => {
    expect(activeTenantActions('administration')).toEqual([{
      id: 'platform-operations',
      label: 'Platform operations',
      icon: 'lock',
      href: '/platform',
    }]);
    expect(activeTenantActions('organization')).toEqual([{
      id: 'workspace-settings',
      label: 'Members & access',
      icon: 'settings',
      href: '/organization',
    }]);
    expect(activeTenantActions(undefined)).toEqual([]);
  });

  test('projects navigation only for routes valid in the active tenant kind', () => {
    const organizationLinks = dashboardNavigation('organization')
      .flatMap((group) => group.items.map((item) => item.href));
    expect(organizationLinks).toContain('/tasks');
    expect(organizationLinks).toContain('/organization');
    expect(organizationLinks).toContain('/security');
    expect(organizationLinks).not.toContain('/platform');

    const administrationLinks = dashboardNavigation('administration')
      .flatMap((group) => group.items.map((item) => item.href));
    expect(administrationLinks).toContain('/platform');
    expect(administrationLinks).not.toContain('/tasks');
    expect(administrationLinks).not.toContain('/organization');
    expect(administrationLinks).not.toContain('/security');

    const restoringLinks = dashboardNavigation(undefined)
      .flatMap((group) => group.items.map((item) => item.href));
    expect(restoringLinks).toEqual(['/app', '/request-access', '/workspaces/new']);
  });

  test('uses the framework semantic success token for completed work', () => {
    expect(TASK_COLUMNS.find((column) => column.status === 'complete')?.accent)
      .toBe('bg-success');
  });

  test('keeps the role matrix and guided journeys aligned with the proof', () => {
    expect(TASK_CAPABILITY_ORDER).toHaveLength(5);
    expect(taskRoleAllows('viewer', 'tasks:read:any')).toBe(true);
    expect(taskRoleAllows('viewer', 'tasks:create')).toBe(false);
    expect(taskRoleAllows('editor', 'tasks:update:own')).toBe(true);
    expect(taskRoleAllows('editor', 'tasks:manage')).toBe(false);
    expect(taskRoleAllows('manager', 'tasks:manage')).toBe(true);
    expect(Object.keys(TASK_ROLE_REGISTRY)).toEqual(['viewer', 'editor', 'manager']);
    expect(ADMINISTRATION_STEPS.map((step) => step.href)).toContain('/platform');
    expect(CUSTOMER_STEPS.map((step) => step.href)).toContain('/tasks');
  });

  test('keeps every promised Guardian control reachable from a rendered route mode', async () => {
    const [platform, organization, security] = await Promise.all([
      Bun.file(new URL('./(dashboard)/platform/page.tsx', import.meta.url)).text(),
      Bun.file(new URL('./(dashboard)/organization/page.tsx', import.meta.url)).text(),
      Bun.file(new URL('./(dashboard)/security/page.tsx', import.meta.url)).text(),
    ]);

    expect(platform).toContain('PlatformUserManagement');
    expect(platform).toContain('PlatformApiKeyControls');
    expect(platform).toContain('ControlPlaneAuditViewer');
    expect(organization).toContain('PlatformUserManagement');
    expect(organization).toContain('TenantOnboardingManagement');
    expect(organization).toContain('ControlPlaneAuditViewer');
    expect(security).toContain('WorkspaceApiKeyControls');
  });

  test('scrubs one-time invitation material and normalizes workspace hints', () => {
    const token = `zinv_${'A'.repeat(43)}`;
    expect(parseInvitationRoute(`?token=%20${token}%20&continuation=next`)).toEqual({
      token,
      continuation: 'next',
    });
    expect(parseInvitationRoute('?continuation=next')).toBeNull();
    expect(hasInvitationRouteMaterial('?continuation=next')).toBe(true);
    expect(hasInvitationRouteMaterial('?token=broken')).toBe(true);
    expect(hasInvitationRouteMaterial(`#token=${token}`)).toBe(true);
    expect(hasInvitationRouteMaterial('?workspace=acme')).toBe(false);
    expect(normalizeWorkspaceSlug('  ACME-CLINIC ')).toBe('acme-clinic');
    expect(isWorkspaceSlug('acme-clinic')).toBe(true);
    expect(isWorkspaceSlug('acme--clinic')).toBe(false);
    expect(parseWorkspaceSlug('?workspace=%3Csecret%3E')).toBe('');
    expect(cleanOnboardingHref('/accept-invitation')).toBe('/accept-invitation');
    expect(cleanOnboardingHref('/request-access', '', ' ACME '))
      .toBe('/request-access?workspace=acme');
  });

  test('retains a scrubbed invitation only in a bounded current-tab handoff', () => {
    const values = new Map<string, string>();
    const store = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const input = { token: `zinv_${'B'.repeat(43)}`, continuation: 'identity-proof' };
    expect(rememberInvitationRoute(store, input, 1_000)).toBe(true);
    expect(invitationHandoffRemainingMs(store, 1_000)).toBe(INVITATION_HANDOFF_TTL_MS);
    expect(invitationHandoffRemainingMs(
      store,
      1_000 + INVITATION_HANDOFF_TTL_MS,
    )).toBe(0);
    expect(restoreInvitationRoute(store, 1_001)).toEqual(input);
    expect(restoreInvitationRoute(store, 1_000 + INVITATION_HANDOFF_TTL_MS + 1)).toBeNull();
    expect(values.size).toBe(0);
    expect(rememberInvitationRoute(store, input, 2_000)).toBe(true);
    clearInvitationRoute(store);
    expect(values.size).toBe(0);

    const older = { token: `zinv_${'C'.repeat(43)}` };
    const newer = { token: `zinv_${'D'.repeat(43)}` };
    expect(rememberInvitationRoute(store, older, 3_000)).toBe(true);
    expect(resolveInvitationRouteEntry(
      '',
      `?token=${newer.token}`,
      store,
      3_001,
    )).toEqual({ input: newer, source: 'link', malformed: false });
    expect(values.size).toBe(0);

    expect(rememberInvitationRoute(store, older, 4_000)).toBe(true);
    expect(resolveInvitationRouteEntry('', '?token=broken', store, 4_001)).toEqual({
      input: null,
      source: 'link',
      malformed: true,
    });
    expect(values.size).toBe(0);

    expect(rememberInvitationRoute(store, older, 4_500)).toBe(true);
    expect(resolveInvitationRouteEntry(
      `#token=${newer.token}`,
      '?token=broken',
      store,
      4_501,
    )).toEqual({ input: newer, source: 'link', malformed: false });
    expect(values.size).toBe(0);

    expect(resolveInvitationRouteEntry(
      '#token=broken',
      `?token=${newer.token}`,
      null,
      4_502,
    )).toEqual({ input: null, source: 'link', malformed: true });

    expect(rememberInvitationRoute(store, older, 5_000)).toBe(true);
    expect(resolveInvitationRouteEntry('', '', store, 5_001)).toEqual({
      input: older,
      source: 'handoff',
      malformed: false,
    });
  });

  test('distinguishes live, reconnecting, and offline Sync state', () => {
    expect(connectionStatus({
      connected: true,
      offline: false,
      pendingMutations: 0,
      lastSeq: 7,
    })).toMatchObject({ label: 'Live', tone: 'ready' });
    expect(connectionStatus({
      connected: false,
      offline: false,
      pendingMutations: 0,
      lastSeq: 7,
    })).toMatchObject({ label: 'Reconnecting', tone: 'pending' });
    expect(connectionStatus({
      connected: false,
      offline: true,
      pendingMutations: 2,
      lastSeq: 7,
    })).toMatchObject({ label: 'Offline', tone: 'attention' });
    expect(realtimeStatus('administration', {
      connected: true,
      offline: false,
      pendingMutations: 0,
      lastSeq: 7,
    })).toMatchObject({ label: 'Customer scope only', tone: 'neutral' });
    expect(realtimeStatus(undefined, {
      connected: true,
      offline: false,
      pendingMutations: 0,
      lastSeq: 7,
    })).toMatchObject({ label: 'Restoring scope', tone: 'pending' });
    expect(fabricStatus('organization', 'loading', 0))
      .toMatchObject({ label: 'Checking', tone: 'pending' });
    expect(fabricStatus('organization', 'provisioning', 0).description)
      .not.toContain('0 setup');
  });

  test('enforces task input bounds and keeps timestamps and ownership server-owned', () => {
    expect(tasks.schema.fields.get('title')).toMatchObject({
      required: true,
      minLength: 1,
      maxLength: 200,
    });
    expect(tasksResource.fields?.create).toEqual(['title', 'status']);
    expect(tasksResource.fields?.update).toEqual(['status']);
    for (const field of [
      'created_at',
      'created_by_user_id',
      'assigned_membership_id',
    ]) expect(tasksResource.fields?.create).not.toContain(field);
  });
});
