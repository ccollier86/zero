import { describe, expect, test } from 'bun:test';

import { authContextAuthorityFingerprint } from './auth-context-authority';
import type { AuthContext } from './types';

describe('auth context authority fingerprint', () => {
  test('binds the credential kind and stable credential id', () => {
    const common: AuthContext = {
      userId: 'u_credential',
      email: 'credential@example.test',
      role: 'user',
      authGeneration: 0,
      sessionScopeKind: 'application',
      sessionScopeId: 'application',
    };
    const session: AuthContext = {
      ...common,
      credentialKind: 'session',
      credentialId: 'session-1',
    };
    const firstKey: AuthContext = {
      ...common,
      credentialKind: 'api-key',
      credentialId: 'key-1',
    };
    const secondKey: AuthContext = {
      ...firstKey,
      credentialId: 'key-2',
    };

    expect(authContextAuthorityFingerprint(session))
      .not.toBe(authContextAuthorityFingerprint(firstKey));
    expect(authContextAuthorityFingerprint(firstKey))
      .not.toBe(authContextAuthorityFingerprint(secondKey));
  });
});
