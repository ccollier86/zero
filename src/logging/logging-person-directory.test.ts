/** Synthetic Guardian identities only. Directory projection never opens app/logging files or grants domain reads. */
import { expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { createLoggingPersonDirectory, normalizeLoggingPeopleQuery } from './logging-person-directory';
import { loggingTableTarget } from './logging-table-target';
import { loggingDigest } from './logging-hash';

function fixture(profile = true) {
  const db = createReactiveDB({ mode: 'memory' });
  db.exec(`CREATE TABLE users(user_id TEXT PRIMARY KEY, username TEXT, first_name TEXT, last_name TEXT, status TEXT,
    email TEXT, password_hash TEXT ${profile ? ',profile_revision INTEGER NOT NULL DEFAULT 1' : ''});
    CREATE TABLE _auth_registration_provisioning(user_id TEXT);
    CREATE TABLE _auth_admin_user_provisioning(user_id TEXT);
    CREATE TABLE _auth_tenants(tenant_id TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE _auth_tenant_memberships(user_id TEXT,tenant_id TEXT,status TEXT);
    INSERT INTO _auth_tenants VALUES('tenant-a','active'),('tenant-b','active');`);
  const user = (id: string, name: string, tenant = 'tenant-a', status = 'active', membership = 'active') => {
    db.prepare('INSERT INTO users(user_id,username,first_name,last_name,status,email,password_hash) VALUES(?,?,?,?,?,?,?)')
      .run(id, id, name, 'Example', status, 'DO_NOT_RETURN@example.test', 'DO_NOT_RETURN_HASH');
    db.prepare('INSERT INTO _auth_tenant_memberships VALUES(?,?,?)').run(id, tenant, membership);
  };
  return { db, user, directory: createLoggingPersonDirectory(db, ['clinical_notes', 'billing', 'clinical-notes', '_private', 'x'.repeat(130)], ['clinical_notes']) };
}

test('minimal user projection keeps current tenant fences, pending identities and suspended identities distinct', () => {
  const f = fixture();
  try {
    f.user('a', 'Avery'); f.user('b', 'Blair', 'tenant-b'); f.user('c', 'Casey', 'tenant-a', 'suspended');
    f.user('d', 'Removed', 'tenant-a', 'active', 'removed'); f.user('e', 'Pending'); f.user('f', 'Staged');
    f.db.prepare('INSERT INTO _auth_registration_provisioning VALUES(?)').run('e');
    f.db.prepare('INSERT INTO _auth_admin_user_provisioning VALUES(?)').run('f');
    const scope = { kind: 'tenant', tenantId: 'tenant-a' } as const;
    expect(f.directory.people(scope, {}).items).toEqual([
      { id: 'a', username: 'a', name: 'Avery Example', revision: 1 }, { id: 'c', username: 'c', name: 'Casey Example', revision: 1 },
    ]);
    expect(f.directory.lookup(scope, ['a', 'a', 'b', 'c', 'd', 'e', 'f']).map(p => p.id)).toEqual(['a', 'c']);
    expect(f.directory.people({ kind: 'application' }, {}).items.map(p => p.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(JSON.stringify(f.directory.people(scope, {}))).not.toContain('DO_NOT_RETURN');
    f.db.prepare("UPDATE _auth_tenants SET status='suspended' WHERE tenant_id='tenant-a'").run();
    expect(f.directory.lookup(scope, ['a', 'c'])).toEqual([]);
  } finally { f.db.dispose(); }
});

test('directory pages use an exact bounded cursor, literal search wildcards, and current profile revisions', () => {
  const f = fixture();
  try {
    f.user('a', '100%'); f.user('b', 'Other'); f.user('c', 'underscore_'); f.user('d', 'Slash\\');
    const scope = { kind: 'application' } as const;
    expect(f.directory.people(scope, { limit: 2 })).toMatchObject({ hasMore: true, nextCursor: 'b', items: [{ id: 'a' }, { id: 'b' }] });
    expect(f.directory.people(scope, { limit: 2, after: 'b' })).toMatchObject({ hasMore: false, nextCursor: null, items: [{ id: 'c' }, { id: 'd' }] });
    for (const [search, id] of [['%', 'a'], ['_', 'c'], ['\\', 'd']] as const) expect(f.directory.people(scope, { search }).items.map(p => p.id)).toEqual([id]);
    f.db.prepare("UPDATE users SET first_name='Renamed',profile_revision=2 WHERE user_id='a'").run();
    expect(f.directory.lookup(scope, ['a'])).toMatchObject([{ name: 'Renamed Example', revision: 2 }]);
    expect(f.directory.lookup(scope, [])).toEqual([]);
    expect(() => f.directory.lookup(scope, Array.from({ length: 101 }, (_, n) => 'user-' + n))).toThrow();
  } finally { f.db.dispose(); }
  const legacy = fixture(false);
  try { legacy.user('legacy', 'Legacy'); expect(legacy.directory.lookup({ kind: 'application' }, ['legacy'])).toMatchObject([{ name: 'Legacy Example', revision: 1 }]); }
  finally { legacy.db.dispose(); }
});

test('catalog uses the original capture identity, groups aliases honestly and does not expose platform-only tables to tenants', () => {
  const f = fixture();
  try {
    expect(f.directory.tables({ kind: 'tenant', tenantId: 'tenant-a' })).toEqual([{ type: 'table.clinical-notes', names: ['clinical_notes'] }]);
    const tables = f.directory.tables({ kind: 'application' });
    expect(tables).toContainEqual({ type: 'table.clinical-notes', names: ['clinical-notes', 'clinical_notes'] });
    expect(tables.some(t => t.names.includes('_private'))).toBe(false);
    expect(loggingTableTarget('x'.repeat(130))).toBe('table.' + loggingDigest('x'.repeat(130)));
    expect(loggingTableTarget('UPPER_case')).toBe('table.upper-case');
    expect(loggingTableTarget('!!!')).toBe('table.' + loggingDigest('!!!'));
  } finally { f.db.dispose(); }
});

test('people query validation rejects unknown scope, accessors and oversized inputs without coercion', () => {
  let read = false;
  const accessor = { get search() { read = true; return ''; } };
  for (const value of [accessor, new Proxy({}, {}), { scope: 'platform' }, { limit: null }, { limit: '2' }, { limit: 0 }, { limit: 51 }, { limit: NaN }, { search: 'x'.repeat(101) }, { search: 'bad\n' }, { search: '\x7f' }, { after: 'not an id' }]) {
    expect(() => normalizeLoggingPeopleQuery(value as any)).toThrow(expect.objectContaining({ code: 'LOGGING_QUERY_INVALID' }));
  }
  expect(read).toBe(false);
  expect(normalizeLoggingPeopleQuery({ search: ' Avery ' })).toEqual({ limit: 25, search: 'Avery' });
});
