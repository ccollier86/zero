/** Real managed Fabric subprocess qualification: unopened scopes, SQL projection, authority and readonly catalog. */
import { describe, expect, test } from 'bun:test';
// Bun has no direct directory creation/removal or general path-join API.
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createPlatformSQLiteService } from '../persistence';
import { DatabaseRuntime } from '../databases/database-runtime';
import { DatabaseManager } from '../databases/database-manager';
import { DatabaseCoordinator } from '../databases/database-coordinator';
import { AuthorityCommitCoordinator } from '../databases/authority-commit-coordinator';
import { SubprocessDatabaseExecutor } from '../databases/subprocess-database-executor';
import { DatabaseActorAuthorityContext } from '../databases/database-actor-authority-context';
import { DATABASE_ACTOR_OPERATIONS } from '../databases/database-actor-protocol';
import { installAuthAuthorityRevision } from '../auth/auth-authority-revision';
import { normalizeAuthPresence } from '../auth/auth-config-presence';
import { trustedSystemServiceDataScope } from '../auth/service-data-scope';
import { EphemeralStateManager } from '../sync/ephemeral-manager';
import { PresenceService } from './presence-service';
import { ManagedPresencePublisher } from './presence-managed-publisher';
import { PRESENCE_REALM_QUERY } from './presence-realm';
import { presenceActorRealm, presenceActorRealmWithoutPresence } from './test-fixtures/presence-actor-realm';
import { presenceRowId } from './presence-publication';

const CHILD = Bun.fileURLToPath(new URL('./test-fixtures/presence-actor-child.ts', import.meta.url));
const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';

async function fixture(withPresenceContribution = true) {
  await mkdir(SCRATCH, { recursive: true });
  const root = await mkdtemp(`${SCRATCH}/presence-fabric-`);
  const systemPath = join(root, 'system.sqlite');
  const system = DatabaseRuntime.open({ id: 'system', role: 'system', sqlite: createPlatformSQLiteService({ mode: 'file', path: systemPath }), ownsSQLite: true });
  const app = DatabaseRuntime.open({ id: 'default', role: 'default', sqlite: createPlatformSQLiteService({ mode: 'ephemeral' }), ownsSQLite: true });
  system.db.exec(`CREATE TABLE users(user_id TEXT PRIMARY KEY,email TEXT NOT NULL,role TEXT NOT NULL,status TEXT NOT NULL,
    password_change_required INTEGER NOT NULL,email_verification_required INTEGER NOT NULL,email_verified_at INTEGER,mfa_required INTEGER NOT NULL,email_generation INTEGER NOT NULL);
    CREATE TABLE _auth_registration_provisioning(user_id TEXT PRIMARY KEY);
    CREATE TABLE _auth_admin_user_provisioning(user_id TEXT PRIMARY KEY);
    CREATE TABLE _auth_tenants(tenant_id TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL);
    CREATE TABLE _auth_tenant_memberships(tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,status TEXT NOT NULL);
    INSERT INTO users VALUES ('user-a','a@example.test','user','active',0,0,NULL,0,0),('user-b','b@example.test','user','active',0,0,NULL,0,0);
    INSERT INTO _auth_tenants VALUES ('a','organization','active'),('b','organization','active');
    INSERT INTO _auth_tenant_memberships VALUES ('a','user-a','active'),('b','user-b','active');`);
  installAuthAuthorityRevision(system.db);
  const authority = new AuthorityCommitCoordinator(); let advanceAtDispatch = false;
  const coordinator = new DatabaseCoordinator({ rootDirectory: join(root, 'actors'), realm: withPresenceContribution ? presenceActorRealm : presenceActorRealmWithoutPresence,
    maxDatabases: 2, maxTenantSyncDatabases: 2, sweepIntervalMs: false, operationTimeoutMs: 5000,
    authorityCommitCoordinator: authority, requireCommitAuthority: true,
    actorAuthorityContext: new DatabaseActorAuthorityContext(system.db, systemPath),
    createExecutor: ({ role, slot }) => {
      const actual = new SubprocessDatabaseExecutor({ command: [process.execPath, CHILD, role, String(slot)],
        env: withPresenceContribution ? {} : { ZERO_TEST_PRESENCE_REALM_WITHOUT_CONTRIBUTION: 'true' }, role, slot,
        maxInFlight: 1, startupTimeoutMs: 3000, operationTimeoutMs: 5000, shutdownAckTimeoutMs: 1000, shutdownExitTimeoutMs: 1000,
        sigtermTimeoutMs: 500, sigkillTimeoutMs: 500 });
      return new Proxy(actual, { get(target, property) {
        if (property === 'execute') return (request: Parameters<typeof actual.execute>[0], options: Parameters<typeof actual.execute>[1]) => {
          if (advanceAtDispatch && request.operation === DATABASE_ACTOR_OPERATIONS.presenceProjection) {
            advanceAtDispatch = false;
            system.db.prepare('UPDATE _auth_authority_revision SET revision=revision+1 WHERE singleton=1').run();
          }
          return actual.execute(request, options);
        };
        const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
      } });
    },
  });
  const manager = new DatabaseManager({ systemRuntime: system, appRuntime: app, multiple: { coordinator,
    authorityCommitCoordinator: authority, tenantDatabases: true,
    tenantDatabaseEligibility: { assertEligible: tenantId => {
      if (!system.db.prepare("SELECT 1 FROM _auth_tenants WHERE tenant_id=? AND status='active'").get(tenantId)) throw new Error('ineligible');
      return undefined;
    } },
  } }); manager.start();
  const publisher = new ManagedPresencePublisher(manager, true, 'multi');
  const service = new PresenceService(system.db, normalizeAuthPresence({ enabled: true }), 'multi', publisher, true);
  const ephemeral = new EphemeralStateManager(0); service.attachEphemeralManager(ephemeral);
  const remove = manager.installTenantPresenceAdmission(tenantId => service.ensureScope(trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId })));
  return { system, manager, coordinator, service, ephemeral, advance: () => { advanceAtDispatch = true; },
    close: async () => { remove(); await service.close(); ephemeral.dispose(); await manager.close(); await authority.close(); await rm(root, { recursive: true, force: true }); } };
}

describe('managed Guardian presence through actual Fabric', () => {
  test('eagerly provisions unopened tenants, registers readonly SQL source, updates meaningful state and rejects generic writers', async () => {
    const f = await fixture(); const a = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'a' });
    try {
      expect(f.coordinator.diagnostics().databaseFiles).toBe(0);
      await f.service.initialize(); expect(f.coordinator.diagnostics().databaseFiles).toBe(2);
      expect(f.service.capabilities(a).state).toBe('ready');
      const bound = await f.manager.bindTenant({ tenantId: 'a', assertCurrentAuthoritySync: () => undefined });
      try {
        expect((await bound.client.query(PRESENCE_REALM_QUERY, {})).value).toMatchObject([{ userId: 'user-a', status: 'offline', stale: false }]);
        f.service.report({ scope: a, userId: 'user-a', connectionId: 'first-tab' }, { sequence: 1, activity: true, visible: true }, () => {});
        await f.service.drain();
        expect((await bound.client.query(PRESENCE_REALM_QUERY, {})).value).toMatchObject([{ userId: 'user-a', status: 'available', connected: true }]);
        await expect(bound.client.mutate({ type: 'update', table: 'guardian_presence', id: presenceRowId('tenant', 'a', 'user-a'), patch: { status_key: 'busy' } },
          { idempotencyKey: 'forged-update' })).rejects.toMatchObject({ code: 'DATABASE_PAYLOAD_INVALID' });
        await expect(bound.client.command('presence.attack', { id: presenceRowId('tenant', 'a', 'user-a') }, { idempotencyKey: 'forged-command' }))
          .rejects.toMatchObject({ code: 'DATABASE_OPERATION_UNSUPPORTED' });
        expect((await bound.client.query('notes.count', null)).value).toEqual({ count: 0 });
        f.service.release('first-tab'); await f.service.drain();
        expect((await bound.client.query(PRESENCE_REALM_QUERY, {})).value).toMatchObject([{ status: 'offline', connected: false }]);
        f.system.db.prepare("UPDATE _auth_tenant_memberships SET status='suspended' WHERE tenant_id='a'").run();
        await expect(bound.client.query(PRESENCE_REALM_QUERY, {})).rejects.toMatchObject({ code: 'AUTH_PRESENCE_NOT_READY' });
        expect((await bound.client.query('notes.count', null)).value).toEqual({ count: 0 });
      } finally { bound.release(); }
    } finally { await f.close(); }
  }, 20000);

  test('bounded actor reads return their stable cursor without skipping members or crossing tenant scopes', async () => {
    const f = await fixture();
    try {
      f.system.db.exec(`INSERT INTO users VALUES ('user-c','c@example.test','user','active',0,0,NULL,0,0);
        INSERT INTO _auth_tenant_memberships VALUES ('a','user-c','active');`);
      await f.service.initialize();
      const a = await f.manager.bindTenant({ tenantId: 'a', assertCurrentAuthoritySync: () => undefined });
      const b = await f.manager.bindTenant({ tenantId: 'b', assertCurrentAuthoritySync: () => undefined });
      try {
        const first = (await a.client.query(PRESENCE_REALM_QUERY, { limit: 1 })).value;
        expect(Array.isArray(first)).toBe(true);
        if (!Array.isArray(first)) throw new Error('Presence query must return a row list.');
        expect(first).toHaveLength(1);
        const firstRow = first[0] as { id: string; userId: string };
        expect(typeof firstRow.id).toBe('string');
        const second = (await a.client.query(PRESENCE_REALM_QUERY, { limit: 1, after: firstRow.id })).value;
        expect(Array.isArray(second)).toBe(true);
        if (!Array.isArray(second)) throw new Error('Presence query must return a row list.');
        expect(second).toHaveLength(1);
        const secondRow = second[0] as { id: string; userId: string };
        expect(firstRow.id < secondRow.id).toBe(true);
        expect(new Set([firstRow.userId, secondRow.userId])).toEqual(new Set(['user-a', 'user-c']));
        expect((await a.client.query(PRESENCE_REALM_QUERY, { limit: 1, after: secondRow.id })).value).toEqual([]);
        expect((await b.client.query(PRESENCE_REALM_QUERY, { limit: 1 })).value).toMatchObject([{ userId: 'user-b' }]);
        expect((await b.client.query(PRESENCE_REALM_QUERY, {})).value).toHaveLength(1);
      } finally { a.release(); b.release(); }
    } finally { await f.close(); }
  }, 20000);

  test('actor final-edge revision rejects an authority change between parent admission and actual IPC dispatch', async () => {
    const f = await fixture(), a = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'a' });
    try {
      await f.service.initialize(); f.advance();
      f.service.report({ scope: a, userId: 'user-a', connectionId: 'late' }, { sequence: 1, activity: true, visible: true }, () => {});
      await f.service.drain();
      expect(f.system.db.prepare('SELECT 1 FROM _guardian_presence_outbox WHERE scope_id=? LIMIT 1').get('a')).not.toBeNull();
      const bound = await f.manager.bindTenant({ tenantId: 'a', assertCurrentAuthoritySync: () => undefined });
      try {
        expect((await bound.client.query(PRESENCE_REALM_QUERY, {})).value).toMatchObject([{ userId: 'user-a', status: 'available' }]);
        expect(f.system.db.prepare('SELECT 1 FROM _guardian_presence_outbox WHERE scope_id=? LIMIT 1').get('a')).toBeNull();
      }
      finally { bound.release(); }
    } finally { await f.close(); }
  }, 20000);

  test('missing explicit contribution fails only presence admission, not ordinary Fabric reads or writes', async () => {
    const f = await fixture(false), a = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'a' });
    try {
      await f.service.initialize();
      expect(f.service.capabilities(a).state).toBe('pending');
      expect(f.coordinator.diagnostics().databaseFiles).toBe(0);
      expect(() => f.service.report({ scope: a, userId: 'user-a', connectionId: 'blocked' }, { sequence: 1, activity: true, visible: true }, () => {})).toThrow();
      const bound = await f.manager.bindTenant({ tenantId: 'a', assertCurrentAuthoritySync: () => undefined });
      try {
        expect((await bound.client.query('notes.count', null)).value).toEqual({ count: 0 });
        await bound.client.mutate({ type: 'create', table: 'notes', row: { id: 'ordinary-note', title: 'Ordinary app data' } }, { idempotencyKey: 'ordinary-write' });
        expect((await bound.client.query('notes.count', null)).value).toEqual({ count: 1 });
        await expect(bound.client.query(PRESENCE_REALM_QUERY, {})).rejects.toMatchObject({ code: 'AUTH_PRESENCE_NOT_READY' });
      } finally { bound.release(); }
    } finally { await f.close(); }
  }, 20000);
});
