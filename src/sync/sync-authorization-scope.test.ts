import { describe, expect, test } from 'bun:test';

import { createSyncAuthorizationScope } from './sync-authorization-scope';
import type { SyncAuthContext } from './types';

describe('createSyncAuthorizationScope', () => {
  const context: SyncAuthContext = {
    userId: 'user-1',
    email: 'user@example.test',
    role: 'user',
    authGeneration: 4,
    sessionKind: 'web',
    sessionId: 'session-1',
    sessionGeneration: 2,
    mfaVerifiedAt: 1_700_000_000_000,
    sessionScopeKind: 'tenant',
    sessionScopeId: 'tenant-1',
    tenantId: 'tenant-1',
    tenantKind: 'organization',
  };

  test('changes when a Guardian security-boundary field changes', () => {
    const current = createSyncAuthorizationScope(context, 'policy-v1');

    expect(createSyncAuthorizationScope({
      ...context,
      authGeneration: context.authGeneration! + 1,
    }, 'policy-v1')).not.toBe(current);
    expect(createSyncAuthorizationScope({
      ...context,
      mfaVerifiedAt: context.mfaVerifiedAt! + 1,
    }, 'policy-v1')).not.toBe(current);
    expect(createSyncAuthorizationScope({
      ...context,
      tenantKind: 'administration',
    }, 'policy-v1')).not.toBe(current);
  });
});
