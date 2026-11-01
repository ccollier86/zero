import { expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from './auth-config';
import { readAuthAuthorityProperties } from './auth-authority-properties';
import { UserPropertyService } from './user-property-service';
import { UserStore } from './user-store';
import { defineAuthTables } from './auth-schema';
import { ReactiveDB } from '../sync/reactive-db';

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
