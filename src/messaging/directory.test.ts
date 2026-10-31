import { expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { applicationServiceDataScope, trustedSystemServiceDataScope } from '../auth/service-data-scope';
import type { UserStore } from '../auth/user-store';
import type { TenancyService } from '../auth/tenancy';
import { ManagedMessagingDirectory } from './directory';
test('discovery, exact display resolution and automatic groups exclude unfinished or token-ineligible accounts', () => {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    db.exec(`CREATE TABLE users(user_id TEXT PRIMARY KEY,username TEXT,first_name TEXT,last_name TEXT,status TEXT,password_change_required INTEGER,email_verification_required INTEGER,email_verified_at INTEGER);
      CREATE TABLE _auth_registration_provisioning(user_id TEXT PRIMARY KEY); CREATE TABLE _auth_admin_user_provisioning(user_id TEXT PRIMARY KEY);
      CREATE TABLE _auth_tenants(tenant_id TEXT PRIMARY KEY,status TEXT); CREATE TABLE _auth_tenant_memberships(tenant_id TEXT,user_id TEXT,status TEXT);
      INSERT INTO users VALUES('ready','Ready',NULL,NULL,'active',0,0,NULL),('registration','Unfinished',NULL,NULL,'active',0,0,NULL),('admin','Unfinished admin',NULL,NULL,'active',0,0,NULL),
        ('password','Password setup',NULL,NULL,'active',1,0,NULL),('verify','Verification',NULL,NULL,'active',0,1,NULL),('suspended','Suspended',NULL,NULL,'suspended',0,0,NULL),('foreign','Foreign',NULL,NULL,'active',0,0,NULL);
      INSERT INTO _auth_registration_provisioning VALUES('registration'); INSERT INTO _auth_admin_user_provisioning VALUES('admin');
      INSERT INTO _auth_tenants VALUES('a','active'),('b','active'); INSERT INTO _auth_tenant_memberships VALUES('a','ready','active'),('a','registration','active'),('b','foreign','active');`);
    const tenancy = { getTenant: (id: string) => db.prepare('SELECT tenant_id,status FROM _auth_tenants WHERE tenant_id=?').get(id),
      getMembership: (tenant: string, user: string) => db.prepare('SELECT status FROM _auth_tenant_memberships WHERE tenant_id=? AND user_id=?').get(tenant, user) } as unknown as TenancyService;
    const directory = new ManagedMessagingDirectory({ db, users: {} as UserStore, tenancy, publicAvatar: () => null });
    const app = applicationServiceDataScope(), tenant = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'a' });
    expect(directory.list(app, 'self', {}).items.map(row => row.id)).toEqual(['foreign', 'ready']);
    expect(directory.groupCandidates(app, '', 50).ids).toEqual(['foreign', 'ready']);
    expect(directory.resolve(app, ['ready', 'registration', 'admin', 'password', 'verify', 'suspended']).map(row => row.id)).toEqual(['ready']);
    expect(directory.resolve(tenant, ['ready', 'foreign']).map(row => row.id)).toEqual(['ready']);
    for (const id of ['registration', 'admin', 'password', 'verify', 'suspended']) expect(() => directory.assertRecipient(app, id)).toThrow();
    expect(() => directory.assertRecipient(app, 'ready')).not.toThrow();
    let admitted = true;
    const portal = new ManagedMessagingDirectory({ db, users: {} as UserStore, tenancy, portal: true, publicAvatar: () => null,
      supportRecipient: (_scope, id) => admitted && id === 'ready', groupRecipient: () => true, inboxRecipient: (_scope, id, inbox) => admitted && id === 'ready' && inbox === 'team',
      supportEntryRecipient: (_scope, _id, entry) => entry === 'public', inboxStaffRecipient: (_scope, _id, inbox) => inbox === 'team' });
    expect(portal.list(app, 'self', {}, true).items.map(row => row.id)).toEqual(['ready']);
    expect(portal.notificationRecipient(app, 'foreign', false, 'direct')).toBe(false);
    expect(portal.notificationRecipient(app, 'foreign', false, 'support')).toBe(true);
    expect(portal.notificationRecipient(app, 'ready', false, 'direct')).toBe(true);
    expect(portal.groupRecipient(app, 'foreign', 'team')).toBe(false);
    expect(portal.groupRecipient(app, 'ready', 'team')).toBe(true);
    expect(portal.inboxRecipient(app, 'ready', 'team')).toBe(true);
    expect(portal.supportRecipient(app, 'ready', 'public')).toBe(true);
    expect(portal.supportRecipient(app, 'ready', 'team')).toBe(false);
    expect(portal.inboxStaffRecipient(app, 'ready', 'team')).toBe(true);
    expect(portal.inboxStaffRecipient(app, 'ready', 'public')).toBe(false);
    admitted = false;
    expect(portal.notificationRecipient(app, 'ready', true, 'support')).toBe(false);
    expect(portal.inboxRecipient(app, 'ready', 'team')).toBe(false);
    expect(portal.supportRecipient(app, 'ready', 'public')).toBe(false);
    expect(portal.inboxStaffRecipient(app, 'ready', 'team')).toBe(false);
    expect(portal.list(app, 'self', {}, true).items).toEqual([]);
  } finally { db.dispose(); }
});

test('operator-only discovery pages across sparse eligible accounts with bounded Guardian work and no skipped admitted staff', () => {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    db.exec(`CREATE TABLE users(user_id TEXT PRIMARY KEY,username TEXT,first_name TEXT,last_name TEXT,status TEXT,password_change_required INTEGER,email_verification_required INTEGER,email_verified_at INTEGER);
      CREATE TABLE _auth_registration_provisioning(user_id TEXT PRIMARY KEY); CREATE TABLE _auth_admin_user_provisioning(user_id TEXT PRIMARY KEY);`);
    const insert = db.prepare("INSERT INTO users VALUES(?,?,NULL,NULL,'active',0,0,NULL)");
    db.transaction(() => { for (let n = 0; n < 1110; n++) { const id = 'member-' + String(n).padStart(4, '0'); insert.run(id, id); } });
    const app = applicationServiceDataScope(); let checks = 0;
    const directory = new ManagedMessagingDirectory({ db, users: {} as UserStore, tenancy: null, publicAvatar: () => null, supportRecipient: (_scope, id) => {
      checks++; return id === 'member-0001' || id === 'member-1101' || id === 'member-1102';
    } });
    const first = directory.list(app, 'self', { limit: 2 }, true);
    expect(first.items.map(row => row.id)).toEqual(['member-0001']); expect(first.nextCursor).toBe('member-0999'); expect(checks).toBe(1000);
    checks = 0; const second = directory.list(app, 'self', { limit: 1, after: first.nextCursor! }, true);
    expect(second.items.map(row => row.id)).toEqual(['member-1101']); expect(second.nextCursor).toBe('member-1101'); expect(checks).toBeLessThanOrEqual(110);
    const third = directory.list(app, 'self', { limit: 1, after: second.nextCursor! }, true);
    expect(third.items.map(row => row.id)).toEqual(['member-1102']); expect(third.hasMore).toBe(false); expect(third.nextCursor).toBeNull();
    const empty = directory.list(app, 'self', { search: 'not-admitted' }, true); expect(empty.items).toEqual([]); expect(empty.hasMore).toBe(false);
  } finally { db.dispose(); }
});
