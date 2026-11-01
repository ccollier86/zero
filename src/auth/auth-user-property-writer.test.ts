import { expect, test } from 'bun:test';
import { ReactiveDB } from '../sync/reactive-db';
import { defineAuthTables } from './auth-schema';
import { resolveAuthBehaviorConfig } from './auth-config';
import { AuthAuditService } from './auth-audit-service';
import { UserStore } from './user-store';
import { UserPropertyService } from './user-property-service';
import { setOwnUserProperty, deleteOwnUserProperty } from './auth-user-property-writer';
import { AuthError, type AuthContext } from './types';

async function fixture() {
  const db = new ReactiveDB({ mode: 'memory' }); defineAuthTables(db);
  const config = resolveAuthBehaviorConfig({ userProperties: { professional: { editableBy: 'user' }, restricted: { editableBy: 'admin', useInPolicies: true } } });
  const audit = new AuthAuditService(db, config.audit), store = new UserStore(db, { auditService: audit });
  const propertyService = new UserPropertyService(config);
  const user = await store.createUser({ username: 'property-writer', email: 'property@example.test', password: 'Fixture-password-123!' });
  const auth = { userId: user.userId, email: user.email, role: user.role, sessionKind: 'web', sessionId: 'synthetic-session' } as AuthContext;
  return { db, audit, store, input: { store, propertyService, key: 'professional', assertAuthority: () => auth } };
}

test('native own writes have one value-free audit per actual change; same-value retry and absent deletion are no-ops', async () => {
  const f = await fixture();
  try {
    setOwnUserProperty({ ...f.input, value: 'PRIVATE_VALUE' }); setOwnUserProperty({ ...f.input, value: 'PRIVATE_VALUE' });
    let events = f.audit.listPlatform().events.filter(event => event.action.startsWith('account.property-'));
    expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ action: 'account.property-updated',
      actorUserId: f.input.assertAuthority().userId, targetId: f.input.assertAuthority().userId, metadata: { field: 'professional', operation: 'set' } });
    expect(JSON.stringify(events)).not.toContain('PRIVATE_VALUE');
    deleteOwnUserProperty(f.input); deleteOwnUserProperty(f.input);
    events = f.audit.listPlatform().events.filter(event => event.action.startsWith('account.property-')); expect(events).toHaveLength(2); expect(f.store.getProperty(f.input.assertAuthority().userId, 'professional')).toBeNull();
    setOwnUserProperty({ ...f.input, key: 'PRIVATE_UNKNOWN_KEY', value: 'PRIVATE_UNKNOWN_VALUE' });
    events = f.audit.listPlatform().events.filter(event => event.action.startsWith('account.property-'));
    expect(JSON.stringify(events)).not.toMatch(/PRIVATE_UNKNOWN_KEY|PRIVATE_UNKNOWN_VALUE/);
  } finally { f.db.dispose(); }
});

test('audit failure and final-authority rejection roll back the property without a false success', async () => {
  const f = await fixture();
  try {
    const append = f.store.appendControlPlaneAudit.bind(f.store);
    f.store.appendControlPlaneAudit = () => { throw new Error('Synthetic audit failure'); };
    expect(() => setOwnUserProperty({ ...f.input, value: 'rejected' })).toThrow('Synthetic audit failure');
    expect(f.store.getProperty(f.input.assertAuthority().userId, 'professional')).toBeNull(); expect(f.audit.listPlatform().events.filter(event => event.action.startsWith('account.property-'))).toHaveLength(0);
    f.store.appendControlPlaneAudit = append;
    let calls = 0;
    expect(() => setOwnUserProperty({ ...f.input, value: 'rejected', assertAuthority: () => {
      if (calls++) throw new AuthError('Authority changed', 'AUTH_STATE_CHANGED', 409);
      return f.input.assertAuthority();
    } })).toThrow('Authority changed');
    expect(f.store.getProperty(f.input.assertAuthority().userId, 'professional')).toBeNull(); expect(f.audit.listPlatform().events.filter(event => event.action.startsWith('account.property-'))).toHaveLength(0);
    expect(() => deleteOwnUserProperty({ ...f.input, key: 'restricted' })).toThrow('not editable');
  } finally { f.db.dispose(); }
});
