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
  } finally { db.dispose(); }
});
