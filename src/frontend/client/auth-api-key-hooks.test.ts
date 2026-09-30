import { describe, expect, test } from 'bun:test';
import { AuthClientError } from './auth-errors';
import {
  AuthApiKeyLoadMoreFence,
  authApiKeyAuthorizationPhase,
  authApiKeyBoundaryKey,
  authApiKeyFailurePresentation,
  isAuthApiKeyManagementModeAvailable,
} from './auth-api-key-hooks';

describe('Guardian API-key browser mode gate', () => {
  test('maps controls only to their compatible live profile scope', () => {
    const available = (
      mode: 'self' | 'application-admin' | 'tenant-admin' | 'platform-admin',
      tenancyMode: 'single' | 'multi',
      activeTenantKind: 'organization' | 'administration' | null,
      selfService = true,
    ) => isAuthApiKeyManagementModeAvailable({
      mode,
      tenancyMode,
      activeTenantKind,
      selfService,
    });

    expect(available('self', 'single', null)).toBe(true);
    expect(available('application-admin', 'single', null)).toBe(true);
    expect(available('tenant-admin', 'single', null)).toBe(false);
    expect(available('platform-admin', 'single', null)).toBe(false);

    expect(available('self', 'multi', 'organization')).toBe(true);
    expect(available('tenant-admin', 'multi', 'organization')).toBe(true);
    expect(available('platform-admin', 'multi', 'organization')).toBe(false);
    expect(available('self', 'multi', 'administration')).toBe(false);
    expect(available('tenant-admin', 'multi', 'administration')).toBe(false);
    expect(available('platform-admin', 'multi', 'administration')).toBe(true);
    expect(available('self', 'single', null, false)).toBe(false);
  });
});

describe('Guardian API-key browser cache boundary', () => {
  test('partitions keys by identity, live scope, management mode, and target', () => {
    const base = {
      enabled: true,
      userId: 'user-a',
      activeTenantId: 'tenant-a',
      authorizationScopeKey: 'session-a',
      authorizationStatus: 'ready',
      authorizationRevision: 'rbac-a',
    } as const;
    const self = authApiKeyBoundaryKey({ ...base, options: { mode: 'self' } });
    const application = authApiKeyBoundaryKey({
      ...base,
      options: { mode: 'application-admin', userId: 'user-b' },
    });
    const tenant = authApiKeyBoundaryKey({
      ...base,
      options: { mode: 'tenant-admin', membershipId: 'member-b' },
    });
    const platform = authApiKeyBoundaryKey({
      ...base,
      options: {
        mode: 'platform-admin',
        tenantId: 'tenant-b',
        membershipId: 'member-b',
      },
    });

    expect(new Set([self, application, tenant, platform]).size).toBe(4);
    expect(authApiKeyBoundaryKey({
      ...base,
      authorizationScopeKey: 'session-b',
      options: { mode: 'self' },
    })).not.toBe(self);
    expect(authApiKeyBoundaryKey({
      ...base,
      authorizationRevision: 'rbac-b',
      options: { mode: 'self' },
    })).not.toBe(self);
    expect(authApiKeyBoundaryKey({
      ...base,
      userId: 'user-c',
      options: { mode: 'self' },
    })).not.toBe(self);
    expect(authApiKeyBoundaryKey({
      ...base,
      enabled: false,
      options: { mode: 'self' },
    })).toBeNull();
  });

  test('keeps background refresh stable while fencing unusable authority phases', () => {
    expect(authApiKeyAuthorizationPhase('ready')).toBe('ready');
    expect(authApiKeyAuthorizationPhase('refreshing')).toBe('ready');
    expect(authApiKeyAuthorizationPhase('loading')).toBe('loading');
    expect(authApiKeyAuthorizationPhase('revoked')).toBe('revoked');
  });
});

describe('Guardian API-key pagination fence', () => {
  test('admits only one load-more request synchronously', () => {
    const fence = new AuthApiKeyLoadMoreFence();
    const first = fence.tryStart();

    expect(first).not.toBeNull();
    expect(fence.isActive).toBe(true);
    expect(fence.tryStart()).toBeNull();
    expect(fence.tryStart(true)).toBeNull();
    expect(fence.finish(first!)).toBe(true);
    expect(fence.isActive).toBe(false);
  });

  test('rejects stale completion after a reload cancels an older page', () => {
    const fence = new AuthApiKeyLoadMoreFence();
    const stale = fence.tryStart()!;
    fence.cancel();
    const current = fence.tryStart()!;

    expect(current).not.toBe(stale);
    expect(fence.isCurrent(stale)).toBe(false);
    expect(fence.finish(stale)).toBe(false);
    expect(fence.isCurrent(current)).toBe(true);
    expect(fence.finish(current)).toBe(true);
  });
});

describe('Guardian API-key request failure presentation', () => {
  test('keeps mutation errors action-local, including action-specific 403s', () => {
    const forbidden = new AuthClientError('No longer eligible', 403, null, null);

    expect(authApiKeyFailurePresentation('mutation', forbidden)).toBeNull();
    expect(authApiKeyFailurePresentation('read', forbidden)).toEqual({
      denied: true,
      error: 'No longer eligible',
    });
    expect(authApiKeyFailurePresentation('read', new Error('Offline'))).toEqual({
      denied: false,
      error: 'Offline',
    });
  });
});
