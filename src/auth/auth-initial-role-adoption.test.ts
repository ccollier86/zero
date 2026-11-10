import { afterEach, describe, expect, test } from 'bun:test';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { resolveAuthBehaviorConfig } from './auth-config';
import { defineAuthTables } from './auth-schema';
import { installAuthAuthorityRevision, readAuthAuthorityRevision } from './auth-authority-revision';
import { readInstalledAuthorizationManifest, reconcileAuthorizationManifest } from './auth-authorization-manifest';
import { AuthAuditService } from './auth-audit-service';
import { resolveAuthAuditConfig } from './auth-audit-config';
import { createAuthorizationKernel } from './authorization-kernel';
import type { AuthAuthorizationOptions, ResolvedAuthAuthorizationConfig } from './types';

const databases: ReactiveDB[] = [];
afterEach(() => {
  const errors: unknown[] = [];
  for (const db of databases.splice(0).reverse()) try { db.dispose(); } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError(errors, 'Synthetic memory database cleanup failed');
});
const permissions = { 'support:knowledge-search': {}, 'support:knowledge-ingest': {} };
const binding: AuthAuthorizationOptions = {
  mode: 'simple', registryVersion: 2, permissions,
  roles: { admin: { permissions: Object.keys(permissions) } },
  initialRoleAdoption: { fromRegistryVersion: 1, toRegistryVersion: 2, roles: ['admin'] },
};
function config(input: AuthAuthorizationOptions = binding) { return resolveAuthBehaviorConfig({ tenancy: 'single', authorization: input }); }
function db() {
  const created = createReactiveDB({ mode: 'memory' }); databases.push(created);
  defineAuthTables(created); installAuthAuthorityRevision(created); return created;
}
function user(database: ReactiveDB, id: string, role: string) {
  database.prepare(`INSERT INTO users (user_id, username, email, role, status, password_change_required,
    email_verification_required, mfa_required, created_at) VALUES (?, ?, ?, ?, 'active', 0, 0, 0, ?)`).run(id, id, `${id}@example.test`, role, Date.now());
}
function reconcile(database: ReactiveDB, authorization: ResolvedAuthAuthorizationConfig, audit?: AuthAuditService) {
  return database.transaction(() => reconcileAuthorizationManifest({ db: database, authorization, tenancy: 'single', audit }));
}
function initial(database: ReactiveDB) { reconcile(database, resolveAuthBehaviorConfig({ authorization: 'simple' }).authorization); }

describe('explicit initial single/simple role permission binding', () => {
  test('reproduces the populated failure and adopts only the acknowledged role without changing users', () => {
    const database = db(); initial(database); user(database, 'existing-admin', 'admin'); user(database, 'existing-member', 'user');
    const beforeUsers = database.prepare('SELECT * FROM users ORDER BY user_id').all();
    const { initialRoleAdoption: _, ...unacknowledged } = binding;
    expect(() => reconcile(database, config(unacknowledged).authorization)).toThrow(expect.objectContaining({ code: 'AUTHORIZATION_ROLE_REACTIVATION_BLOCKED' }));
    expect(readInstalledAuthorizationManifest(database)?.registryVersion).toBe(1);
    const audit = new AuthAuditService(database, resolveAuthAuditConfig(undefined));
    expect(reconcile(database, config().authorization, audit)).toMatchObject({ kind: 'updated', committed: { registryVersion: 2 } });
    expect(database.prepare('SELECT * FROM users ORDER BY user_id').all()).toEqual(beforeUsers);
    const kernel = createAuthorizationKernel(config());
    for (const role of ['admin', 'user']) {
      const authorization = kernel.synthesizeSingleSimpleScope({ platformRole: role });
      const subject = { platformRole: role, authorization, properties: {} };
      expect(kernel.evaluate({ permission: 'support:knowledge-ingest' }, subject).allowed).toBe(role === 'admin');
    }
    expect(audit.listPlatform({ action: 'application.initial-role-binding-adopted' }).events).toEqual([expect.objectContaining({
      outcome: 'succeeded', actorProvenance: 'system', targetType: 'role', targetId: 'admin',
      metadata: expect.objectContaining({ 'from-version': 1, 'to-version': 2, 'retained-count': 1 }),
    })]);
    const before = database.prepare('SELECT * FROM _auth_audit_events ORDER BY event_id').all();
    const revision = readAuthAuthorityRevision(database);
    expect(reconcile(database, config().authorization, audit).kind).toBe('unchanged');
    expect(database.prepare('SELECT * FROM _auth_audit_events ORDER BY event_id').all()).toEqual(before);
    expect(readAuthAuthorityRevision(database)).toBe(revision);
    expect(reconcile(database, config(unacknowledged).authorization, audit).kind).toBe('unchanged');
  });
  test('does not exempt another newly introduced role with retained assignments', () => {
    const database = db(); initial(database); user(database, 'a', 'admin'); user(database, 'b', 'retired-staff');
    const marker = readInstalledAuthorizationManifest(database);
    expect(() => reconcile(database, config({ ...binding, roles: {
      ...binding.roles, 'retired-staff': { permissions: ['support:knowledge-search'] },
    } }).authorization)).toThrow(expect.objectContaining({ code: 'AUTHORIZATION_ROLE_REACTIVATION_BLOCKED' }));
    expect(readInstalledAuthorizationManifest(database)).toEqual(marker);
  });
  test('cannot reactivate a genuinely retired role after its registry was emptied', () => {
    const database = db();
    reconcile(database, config({ mode: 'simple', registryVersion: 1, permissions, roles: binding.roles }).authorization);
    user(database, 'a', 'admin');
    reconcile(database, config({ mode: 'simple', registryVersion: 2 }).authorization);
    expect(() => reconcile(database, config({ ...binding, registryVersion: 3,
      initialRoleAdoption: { fromRegistryVersion: 1, toRegistryVersion: 3, roles: ['admin'] },
    }).authorization)).toThrow(expect.objectContaining({ code: 'AUTHORIZATION_INITIAL_ROLE_ADOPTION_REJECTED' }));
    expect(() => reconcile(database, config({ mode: 'simple', registryVersion: 3, permissions, roles: binding.roles }).authorization))
      .toThrow(expect.objectContaining({ code: 'AUTHORIZATION_ROLE_REACTIVATION_BLOCKED' }));
    expect(readInstalledAuthorizationManifest(database)?.registryVersion).toBe(2);
  });
  test('refuses a nonempty installed v1 registry and an unmarked populated database', () => {
    for (const marked of [true, false]) {
      const database = db();
      if (marked) reconcile(database, config({ mode: 'simple', permissions: { 'existing:read': {} } }).authorization);
      user(database, 'a', 'admin');
      expect(() => reconcile(database, config().authorization)).toThrow(expect.objectContaining({ code: 'AUTHORIZATION_INITIAL_ROLE_ADOPTION_REJECTED' }));
    }
  });
  test('preserves reused-version and rollback rejection', () => {
    const database = db(); initial(database); user(database, 'a', 'admin');
    const { initialRoleAdoption: _, ...plain } = binding;
    expect(() => reconcile(database, config({ ...plain, registryVersion: 1 }).authorization)).toThrow(expect.objectContaining({ code: 'AUTHORIZATION_REGISTRY_VERSION_REQUIRED' }));
    reconcile(database, config().authorization);
    expect(() => reconcile(database, config({ mode: 'simple', registryVersion: 1 }).authorization)).toThrow(expect.objectContaining({ code: 'AUTHORIZATION_REGISTRY_VERSION_REQUIRED' }));
  });
  test('rolls manifest, authority clock and adoption audit back together', () => {
    const database = db(); initial(database); user(database, 'a', 'admin');
    const audit = new AuthAuditService(database, resolveAuthAuditConfig(undefined));
    const before = readInstalledAuthorizationManifest(database), revision = readAuthAuthorityRevision(database);
    expect(() => database.transaction(() => {
      reconcileAuthorizationManifest({ db: database, authorization: config().authorization, tenancy: 'single', audit });
      throw new Error('synthetic post-adoption rollback');
    })).toThrow('synthetic post-adoption rollback');
    expect(readInstalledAuthorizationManifest(database)).toEqual(before);
    expect(readAuthAuthorityRevision(database)).toBe(revision);
    expect(audit.listPlatform({ action: 'application.initial-role-binding-adopted' }).events).toEqual([]);
  });
  test('allows a pristine installation to use the same version-bound configuration', () => {
    const database = db(); expect(reconcile(database, config().authorization).kind).toBe('initialized');
    expect(reconcile(database, config().authorization).kind).toBe('unchanged');
  });
  test('validates exact versions, profiles, role lists and bounded permission templates', () => {
    const invalid: unknown[] = [
      { ...binding, mode: 'advanced' },
      { ...binding, initialRoleAdoption: { fromRegistryVersion: 2, toRegistryVersion: 3, roles: ['admin'] } },
      { ...binding, initialRoleAdoption: { fromRegistryVersion: 1, toRegistryVersion: 3, roles: ['admin'] } },
      { ...binding, initialRoleAdoption: { fromRegistryVersion: 1, toRegistryVersion: 2, roles: [] } },
      { ...binding, initialRoleAdoption: { fromRegistryVersion: 1, toRegistryVersion: 2, roles: ['admin', 'admin'] } },
      { ...binding, initialRoleAdoption: { fromRegistryVersion: 1, toRegistryVersion: 2, roles: ['missing'] } },
      { ...binding, roles: { admin: { allPermissions: true } } },
      { ...binding, initialRoleAdoption: { fromRegistryVersion: 1, toRegistryVersion: 2, roles: ['admin'], bypass: true } },
    ];
    for (const input of invalid) expect(() => config(input as AuthAuthorizationOptions)).toThrow();
    expect(() => resolveAuthBehaviorConfig({ tenancy: 'multi', authorization: binding })).toThrow('single/simple');
    expect(Object.isFrozen(config().authorization.initialRoleAdoption?.roles)).toBe(true);
  });
});
