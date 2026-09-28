import { describe, expect, test } from 'bun:test';
import { authAuditBoundaryKey } from './auth-audit-hooks';
import { TenantAdministrationBoundaryFence } from './tenant-administration-hooks';

describe('auth audit browser cache boundary', () => {
  test('partitions tenant data by identity, active tenant, and applied filters', () => {
    const first = authAuditBoundaryKey({
      enabled: true,
      userId: 'user-a',
      tenantId: 'tenant-a',
      scope: 'tenant',
      query: { limit: 25 },
    });
    const nextTenant = authAuditBoundaryKey({
      enabled: true,
      userId: 'user-a',
      tenantId: 'tenant-b',
      scope: 'tenant',
      query: { limit: 25 },
    });
    const nextFilter = authAuditBoundaryKey({
      enabled: true,
      userId: 'user-a',
      tenantId: 'tenant-b',
      scope: 'tenant',
      query: { limit: 25, outcome: 'denied' },
    });
    expect(first).not.toBe(nextTenant);
    expect(nextTenant).not.toBe(nextFilter);
    expect(authAuditBoundaryKey({
      enabled: true,
      userId: 'user-a',
      tenantId: 'tenant-a',
      scope: 'tenant',
      query: { limit: 25 },
      authorizationScopeKey: 'session-family-a',
    })).not.toBe(authAuditBoundaryKey({
      enabled: true,
      userId: 'user-a',
      tenantId: 'tenant-a',
      scope: 'tenant',
      query: { limit: 25 },
      authorizationScopeKey: 'session-family-b',
    }));
    expect(authAuditBoundaryKey({
      enabled: false,
      userId: 'user-a',
      tenantId: 'tenant-a',
      scope: 'tenant',
      query: {},
    })).toBeNull();
  });

  test('invalidates a loaded revision synchronously when scope changes', () => {
    const fence = new TenantAdministrationBoundaryFence();
    const tenantARevision = fence.update('tenant-a');
    expect(fence.isCurrent(tenantARevision)).toBe(true);
    const tenantBRevision = fence.update('tenant-b');
    expect(tenantBRevision).toBeGreaterThan(tenantARevision);
    expect(fence.isCurrent(tenantARevision)).toBe(false);
  });
});
