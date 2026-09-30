import { describe, expect, test } from 'bun:test';

import type { AuthRequestCredentialResolver } from '../auth/auth-api-key-types';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { createAuthorizationKernel } from '../auth/authorization-kernel';
import type { TokenService } from '../auth/token-service';
import type { AuthContext } from '../auth/types';
import { createReactiveDB } from '../sync/reactive-db';
import { AuthWorkflowExecutionAuthorityProvider } from './auth-workflow-execution-authority';
import { WorkflowExecutionAuthorityStore } from './workflow-execution-authority';

describe('workflow API-key authority', () => {
  test('persists a credential-neutral seal and rejects it after key revocation', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      let active = true;
      const context: AuthContext = {
        userId: 'workflow-api-user',
        email: 'workflow-api@example.test',
        role: 'user',
        credentialKind: 'api-key',
        credentialId: 'workflow-key',
        authGeneration: 0,
        sessionScopeKind: 'application',
        sessionScopeId: 'application',
      };
      const credentials: AuthRequestCredentialResolver = {
        async resolve() { return active ? context : null; },
        captureAuthority(current) {
          return current.credentialKind === 'api-key'
            ? {
                kind: 'api-key',
                version: 1,
                keyId: current.credentialId!,
                keyGeneration: 0,
                userId: current.userId,
                scopeKind: 'application',
                scopeId: 'application',
              }
            : null;
        },
        resolveAuthority(reference) {
          return active && reference.kind === 'api-key'
            && reference.keyId === context.credentialId
            ? context
            : null;
        },
      };
      const authorityStore = new WorkflowExecutionAuthorityStore(db);
      const provider = new AuthWorkflowExecutionAuthorityProvider({
        tokens: {} as TokenService,
        requestCredentials: credentials,
        kernel: createAuthorizationKernel(resolveAuthBehaviorConfig({})),
        properties: { getProperties: () => ({}) },
        authorityStore,
      });
      const captured = provider.captureActor(context);
      expect(captured).not.toBeNull();
      expect(captured?.reference).toMatchObject({
        kind: 'api-key',
        keyId: 'workflow-key',
      });
      expect(captured?.identity).toMatchObject({
        credentialKind: 'api-key',
        credentialId: 'workflow-key',
        sessionKind: null,
      });

      authorityStore.insert('workflow-api-instance', captured!);
      const sealed = authorityStore.lockAndRead('workflow-api-instance');
      expect(sealed.ok).toBeTrue();
      if (!sealed.ok || sealed.authority.kind !== 'actor') return;
      expect(provider.revalidateActor(sealed.authority)?.authContext).toBe(context);

      active = false;

      expect(provider.revalidateActor(sealed.authority)).toBeNull();
    } finally {
      db.dispose();
    }
  });
});
