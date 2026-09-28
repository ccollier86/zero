import { describe, expect, test } from 'bun:test';
import {
  serviceDataScopeFromIdentity,
  serviceDataScopeKey,
} from './service-data-scope';

describe('service data scope projection', () => {
  test('preserves legacy application scope only in single mode', () => {
    const identity = {
      sessionScopeKind: 'application' as const,
      sessionScopeId: 'application',
    };

    expect(serviceDataScopeKey(serviceDataScopeFromIdentity(identity, 'single')!))
      .toBe('application');
    expect(serviceDataScopeFromIdentity(identity, 'multi')).toBeNull();
    expect(serviceDataScopeFromIdentity({}, 'multi')).toBeNull();
  });

  test('requires the complete server-validated tenant identity shape', () => {
    expect(serviceDataScopeFromIdentity({
      sessionScopeKind: 'tenant',
      sessionScopeId: 'ten_alpha',
      tenantId: 'ten_alpha',
      membershipId: 'tmem_alpha',
    }, 'multi')).toMatchObject({
      scopeKind: 'tenant',
      scopeId: 'ten_alpha',
      tenantId: 'ten_alpha',
    });

    expect(serviceDataScopeFromIdentity({
      sessionScopeKind: 'tenant',
      sessionScopeId: 'ten_alpha',
      tenantId: 'ten_beta',
      membershipId: 'tmem_alpha',
    }, 'multi')).toBeNull();
    expect(serviceDataScopeFromIdentity({
      sessionScopeKind: 'tenant',
      sessionScopeId: 'ten_alpha',
      tenantId: 'ten_alpha',
    }, 'multi')).toBeNull();
  });
});
