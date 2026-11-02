import { expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from './auth-config';
import { readAuthAuthorityProperties } from './auth-authority-properties';
import { UserPropertyService } from './user-property-service';
import { UserStore } from './user-store';
import { defineAuthTables } from './auth-schema';
import { ReactiveDB } from '../sync/reactive-db';
import { captureAuthAdminMutationAuthority } from './auth-admin-mutation-authority';
import { captureAuthApplicationMutationAuthority } from './auth-application-mutation-authority';
import { captureAuthTenantMutationAuthority } from './auth-tenant-mutation-authority';
import { captureAuthApiKeyMutationAuthority, type AuthApiKeyRouteActor } from './auth-api-key-plugin-dependencies';
import { AuthorizationKernel } from './authorization-kernel';
import type { TokenService } from './token-service';
import type { AuthContext } from './types';

test('managed property fences bind declared policy inputs without confusing editable metadata with authority', async () => {
  const db = new ReactiveDB({ mode: 'memory' }); defineAuthTables(db);
  try {
    const policy = new UserPropertyService(resolveAuthBehaviorConfig({ userProperties: {
      plan: { editableBy: 'admin', useInPolicies: true }, professional: { editableBy: 'user' },
      operatorNote: { editableBy: 'admin' },
    } }));
    const store = new UserStore(db, { authorityPropertyPolicy: policy });
    const user = await store.createUser({ username: 'synthetic-policy', email: 'policy@example.test', password: 'Fixture-password-123!' });
    store.setProperties(user.userId, { plan: 'basic', professional: 'private', operatorNote: 'not-policy', unknown: 'untrusted' });
    expect(readAuthAuthorityProperties(store, user.userId)).toEqual({ plan: 'basic' });
    store.setProperty(user.userId, 'professional', 'changed');
    expect(readAuthAuthorityProperties(store, user.userId)).toEqual({ plan: 'basic' });
    store.setProperty(user.userId, 'plan', 'restricted');
    expect(readAuthAuthorityProperties(store, user.userId)).toEqual({ plan: 'restricted' });
    expect(store.getProperties(user.userId)).toMatchObject({ professional: 'changed', operatorNote: 'not-policy', unknown: 'untrusted' });
  } finally { db.dispose(); }
});

test('legacy stores/adapters retain conservative all-property binding', () => {
  expect(readAuthAuthorityProperties({ getProperties: () => ({ legacy: 'fenced' }) }, 'account')).toEqual({ legacy: 'fenced' });
  expect(readAuthAuthorityProperties(null, 'account')).toEqual({});
});

for (const boundary of ['administrator', 'application', 'tenant', 'api-key'] as const) {
  test(`${boundary} control-plane commits still fence metadata with a managed policy projection`, async () => {
    const db = new ReactiveDB({ mode: 'memory' }); defineAuthTables(db);
    try {
      const config = resolveAuthBehaviorConfig({ userProperties: { professional: { editableBy: 'user' } } });
      const store = new UserStore(db, { authorityPropertyPolicy: new UserPropertyService(config) });
      const user = await store.createUser({ username: `synthetic-${boundary}`, email: `${boundary}@example.test`, password: 'Fixture-password-123!' });
      const auth: AuthContext = { userId: user.userId, email: user.email, role: 'admin' };
      const tokenService = {
        captureAuthContextAuthority: () => ({}), resolveAuthContextAuthority: () => auth,
      } as unknown as TokenService;
      const input = { auth, store, tokenService, kernel: new AuthorizationKernel(config), roles: null };
      store.setProperty(user.userId, 'professional', 'before');
      const captureApplication = captureAuthApplicationMutationAuthority(input);
      const captureTenant = captureAuthTenantMutationAuthority(input);
      const assertCurrent = boundary === 'administrator'
        ? captureAuthAdminMutationAuthority(input)
        : boundary === 'application'
          ? () => captureApplication([])
          : boundary === 'tenant'
            ? () => captureTenant([])
            : captureAuthApiKeyMutationAuthority(input as unknown as AuthApiKeyRouteActor, new Request('https://fixture.example.test/auth/api-keys')).assertCurrent;
      store.setProperty(user.userId, 'professional', 'after');
      expect(readAuthAuthorityProperties(store, user.userId)).toEqual({});
      expect(() => assertCurrent()).toThrow(expect.objectContaining({
        code: 'AUTHORIZATION_CHANGED', status: 409,
      }));
    } finally { db.dispose(); }
  });
}
