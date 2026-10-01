import { describe, expect, test } from 'bun:test';
import {
  resolvePlatformManagementNavigation,
  resolvePlatformUserManagementMode,
} from './platform-user-management-mode';

describe('resolvePlatformUserManagementMode', () => {
  test('preserves controlled identity management', () => {
    expect(resolvePlatformUserManagementMode({
      controlled: true,
      configStatus: 'ready',
      tenancyMode: 'multi',
      activeTenantKind: 'organization',
    })).toBe('identity');
  });

  test('preserves the familiar single/simple user manager', () => {
    expect(resolvePlatformUserManagementMode({
      controlled: false,
      configStatus: 'ready',
      tenancyMode: 'single',
      authorizationMode: 'simple',
    })).toBe('identity');
  });

  test('distinguishes advanced single, platform, and organization control planes', () => {
    expect(resolvePlatformUserManagementMode({
      controlled: false,
      configStatus: 'ready',
      tenancyMode: 'single',
      authorizationMode: 'advanced',
    })).toBe('single-advanced');
    expect(resolvePlatformUserManagementMode({
      controlled: false,
      configStatus: 'ready',
      tenancyMode: 'multi',
      authorizationMode: 'advanced',
      activeTenantKind: 'administration',
    })).toBe('platform');
    expect(resolvePlatformUserManagementMode({
      controlled: false,
      configStatus: 'ready',
      tenancyMode: 'multi',
      authorizationMode: 'simple',
      activeTenantKind: 'organization',
    })).toBe('organization');
  });

  test('does not guess while configuration or tenant scope is unresolved', () => {
    expect(resolvePlatformUserManagementMode({
      controlled: false,
      configStatus: 'loading',
    })).toBe('loading');
    expect(resolvePlatformUserManagementMode({
      controlled: false,
      configStatus: 'error',
    })).toBe('unavailable');
    expect(resolvePlatformUserManagementMode({
      controlled: false,
      configStatus: 'ready',
      tenancyMode: 'multi',
      activeTenantKind: null,
    })).toBe('unavailable');
  });
});

describe('resolvePlatformManagementNavigation', () => {
  const permissions = (...granted: string[]) => ({
    ready: true,
    hasPermission: (permission: string) => granted.includes(permission),
  });

  test('shows the workspace plane for readers and independently authorized creators', () => {
    expect(resolvePlatformManagementNavigation(
      permissions('application.tenants:read'),
    ).canOpenWorkspaceControlPlane).toBe(true);
    expect(resolvePlatformManagementNavigation(permissions(
      'application.tenants:manage',
      'application.users:read',
    )).canOpenWorkspaceControlPlane).toBe(true);
  });

  test('fails closed while loading and for incomplete create authority', () => {
    expect(resolvePlatformManagementNavigation({
      ready: false,
      hasPermission: () => true,
    })).toEqual({
      canReadIdentities: false,
      canOpenWorkspaceControlPlane: false,
    });
    expect(resolvePlatformManagementNavigation(
      permissions('application.tenants:manage'),
    ).canOpenWorkspaceControlPlane).toBe(false);
  });
});
