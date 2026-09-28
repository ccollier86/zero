import { describe, expect, test } from 'bun:test';
import {
  TenantAdministrationBoundaryFence,
  isTenantAdministrationScopeStable,
  tenantAdministrationBoundaryKey,
} from './tenant-administration-hooks';

describe('tenant administration hook boundary fencing', () => {
  test('distinguishes account replacement even when the tenant id is unchanged', () => {
    expect(tenantAdministrationBoundaryKey('account-a', 'tenant-1')).not.toBe(
      tenantAdministrationBoundaryKey('account-b', 'tenant-1'),
    );
  });

  test('distinguishes tenant switches for the same account and clears disabled scope', () => {
    expect(tenantAdministrationBoundaryKey('account-a', 'tenant-1')).not.toBe(
      tenantAdministrationBoundaryKey('account-a', 'tenant-2'),
    );
    expect(tenantAdministrationBoundaryKey('account-a', 'tenant-1', false)).toBeNull();
    expect(isTenantAdministrationScopeStable(transition('preparing'))).toBe(false);
    expect(isTenantAdministrationScopeStable(transition('reconciling'))).toBe(false);
    expect(isTenantAdministrationScopeStable(transition('idle'))).toBe(true);
    expect(isTenantAdministrationScopeStable(transition('recovery-required'))).toBe(true);
    expect(tenantAdministrationBoundaryKey(
      'account-a',
      'tenant-1',
      true,
      'session-family-a',
    )).not.toBe(tenantAdministrationBoundaryKey(
      'account-a',
      'tenant-1',
      true,
      'session-family-b',
    ));
  });

  test('suppresses late list, loadMore, and mutation completions from older boundaries', () => {
    const fence = new TenantAdministrationBoundaryFence();
    const tenantOneRequest = fence.update(
      tenantAdministrationBoundaryKey('account-a', 'tenant-1'),
    );
    expect(fence.isCurrent(tenantOneRequest)).toBe(true);

    const tenantTwoRequest = fence.update(
      tenantAdministrationBoundaryKey('account-a', 'tenant-2'),
    );
    expect(fence.isCurrent(tenantOneRequest)).toBe(false);
    expect(fence.isCurrent(tenantTwoRequest)).toBe(true);

    const replacementAccountRequest = fence.update(
      tenantAdministrationBoundaryKey('account-b', 'tenant-2'),
    );
    expect(fence.isCurrent(tenantTwoRequest)).toBe(false);
    expect(fence.isCurrent(replacementAccountRequest)).toBe(true);
  });

  test('blocks a retained administration handler before it can dispatch in a replacement scope', () => {
    const fence = new TenantAdministrationBoundaryFence();
    const scopeA = fence.update(tenantAdministrationBoundaryKey(
      'account-a', 'tenant-1', true, 'session-family-a',
    ));
    let dispatches = 0;
    const retained = () => {
      if (!fence.isCurrent(scopeA)) return;
      dispatches += 1;
    };

    fence.update(tenantAdministrationBoundaryKey(
      'account-a', 'tenant-1', true, 'session-family-b',
    ));
    retained();

    expect(dispatches).toBe(0);
  });
});

function transition(
  phase: 'idle' | 'preparing' | 'committed' | 'reconciling' | 'recovery-required',
) {
  return {
    phase,
    operation: phase === 'idle' ? null : 'tenant-switch' as const,
    revision: 1,
    recoverable: phase === 'recovery-required',
    error: null,
  };
}
