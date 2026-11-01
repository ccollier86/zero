/** Read-only Sync lifetime fences preserve custom policies and mutation authority. */
import { expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { defineAuthTables } from '../auth/auth-schema';
import { UserPropertyService } from '../auth/user-property-service';
import { UserStore } from '../auth/user-store';
import { ReactiveDB } from '../sync/reactive-db';
import { defineResource } from './resource-definition';
import { allOf, customPolicy, metadataPolicy } from './resource-policy';
import type { ResourcePolicy } from './resource-policy-types';
import { ResourceRegistry } from './resource-registry';
import { ResourceSyncPolicyService } from './resource-sync-policy';

async function fixture(policy?: ResourcePolicy, legacy = false) {
  const db = new ReactiveDB({ mode: 'memory' }); defineAuthTables(db);
  const authConfig = resolveAuthBehaviorConfig({ userProperties: {
    professional: { type: 'string', editableBy: 'user' },
    plan: { type: 'string', editableBy: 'admin', useInPolicies: true },
  } });
  const store = new UserStore(db, legacy ? {} : { authorityPropertyPolicy: new UserPropertyService(authConfig) });
  const user = await store.createUser({ username: 'sync-policy-owner', email: 'sync-policy@example.test', password: 'Fixture-password-123!' });
  store.setProperties(user.userId, { plan: 'permitted', professional: 'before' });
  const registry = new ResourceRegistry();
  registry.register(defineResource({ table: 'documents', realm: 'global', exposure: 'sync',
    policy: policy ?? metadataPolicy({ plan: 'permitted' }),
  }), { tables: { documents: { id: 'TEXT PRIMARY KEY', title: 'TEXT' } }, authConfig });
  const service = new ResourceSyncPolicyService({ registry, authConfig, getUserStore: () => store });
  const authContext = { userId: user.userId, email: user.email, role: user.role };
  const read = () => service.resolveTableAccess({ authContext, tableNames: ['documents'] });
  return { db, store, user, service, authContext, read };
}

test('managed built-in reads retain their lifetime across metadata edits, but not trusted-property changes', async () => {
  const f = await fixture();
  try {
    const before = await f.read(); expect(before.readableTables.has('documents')).toBe(true);
    f.store.setProperty(f.user.userId, 'professional', 'after');
    expect(f.service.validateReadAuthorityAtDelivery(f.authContext, before.readAuthorityFingerprint!)).toBe(true);
    expect((await f.read()).policyFingerprint).toBe(before.policyFingerprint);
    f.store.setProperty(f.user.userId, 'plan', 'restricted');
    expect(f.service.validateReadAuthorityAtDelivery(f.authContext, before.readAuthorityFingerprint!)).toBe(false);
    expect((await f.read()).readableTables.has('documents')).toBe(false);
  } finally { f.db.dispose(); }
});

test('custom list branches still receive full properties and fence changes, including nested branches', async () => {
  const observed: string[] = [];
  const f = await fixture(allOf(metadataPolicy({ plan: 'permitted' }), customPolicy(({ user }) => {
    observed.push(user!.properties.professional!); return true;
  })));
  try {
    const before = await f.read(); expect(before.readableTables.has('documents')).toBe(true);
    expect(observed).toEqual(['before']);
    f.store.setProperty(f.user.userId, 'professional', 'after');
    expect(f.service.validateReadAuthorityAtDelivery(f.authContext, before.readAuthorityFingerprint!)).toBe(false);
    expect((await f.read()).policyFingerprint).not.toBe(before.policyFingerprint);
    expect(observed).toEqual(['before', 'after']);
  } finally { f.db.dispose(); }
});

test('legacy stores retain full-property read fencing even with built-in policies', async () => {
  const f = await fixture(undefined, true);
  try {
    const before = await f.read();
    f.store.setProperty(f.user.userId, 'professional', 'after');
    expect(f.service.validateReadAuthorityAtDelivery(f.authContext, before.readAuthorityFingerprint!)).toBe(false);
  } finally { f.db.dispose(); }
});

test('mutation commit fences stay conservative for all properties independently of read lifetimes', async () => {
  const f = await fixture();
  try {
    const mutation = await f.service.authorizeMutation({ table: 'documents', op: 'UPDATE', rowId: 'one',
      row: { title: 'Changed' }, authContext: f.authContext, loadRow: () => ({ id: 'one', title: 'Before' }) });
    expect(mutation.ok).toBe(true);
    if (!mutation.ok) throw new Error('Synthetic mutation denied');
    expect(f.service.validateMutationAuthorityAtCommit(f.authContext, mutation.authorityFingerprint!)).toBe(true);
    f.store.setProperty(f.user.userId, 'professional', 'after');
    expect(f.service.validateMutationAuthorityAtCommit(f.authContext, mutation.authorityFingerprint!)).toBe(false);
  } finally { f.db.dispose(); }
});
