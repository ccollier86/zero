/** Paired actual ReactiveDB runtime tests; no browser, application data or fake SQL projection. */
import { describe, expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { normalizeAuthPresence } from '../auth/auth-config-presence';
import { applicationServiceDataScope, trustedSystemServiceDataScope } from '../auth/service-data-scope';
import { EphemeralStateManager } from '../sync/ephemeral-manager';
import { guardianPresenceRealmMigration } from './presence-realm-migration';
import { registerPresenceProjectionTables } from './presence-schema';
import { PresenceProjectionStore } from './presence-projection-store';
import { PresenceService, type PresenceProjectionPublisher } from './presence-service';
import { presenceRowId } from './presence-publication';

function fixture(tenancyMode: 'single' | 'multi' = 'single', enabled = true) {
  let now = Date.now(); const db = createReactiveDB({ mode: 'memory' }), target = createReactiveDB({ mode: 'memory' });
  db.exec(`CREATE TABLE users(user_id TEXT PRIMARY KEY,status TEXT NOT NULL,password_change_required INTEGER NOT NULL,
    email_verification_required INTEGER NOT NULL,email_verified_at INTEGER);
    CREATE TABLE _auth_registration_provisioning(user_id TEXT PRIMARY KEY);
    CREATE TABLE _auth_admin_user_provisioning(user_id TEXT PRIMARY KEY);
    CREATE TABLE _auth_tenants(tenant_id TEXT PRIMARY KEY,status TEXT NOT NULL);
    CREATE TABLE _auth_tenant_memberships(tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,status TEXT NOT NULL);
    INSERT INTO users VALUES ('user','active',0,0,NULL),('suspended','suspended',0,0,NULL),('partial','active',0,0,NULL);
    INSERT INTO _auth_registration_provisioning VALUES ('partial');
    INSERT INTO _auth_tenants VALUES ('a','active'),('b','active');
    INSERT INTO _auth_tenant_memberships VALUES ('a','user','active'),('b','user','active');`);
  db.exec('CREATE TABLE _auth_authority_revision(singleton INTEGER PRIMARY KEY,revision INTEGER NOT NULL); INSERT INTO _auth_authority_revision VALUES(1,0)');
  guardianPresenceRealmMigration.up(target.getSQLiteService()!.raw); registerPresenceProjectionTables(target);
  const projection = new PresenceProjectionStore(target); const packets: string[] = [];
  const publisher: PresenceProjectionPublisher = { publish: async (packet, assertCurrent) => { assertCurrent(); packets.push(packet.mode); return projection.apply(packet); },
    isReady: () => projection.inspect()?.ready === true };
  const config = normalizeAuthPresence({ enabled, idleAfterMs: 1000, awayAfterMs: 2000, heartbeatIntervalMs: 1000,
    leaseDurationMs: 3000, ownerCheckpointIntervalMs: 1000, ownerLeaseDurationMs: 6000 });
  const manager = new EphemeralStateManager(0, () => now);
  const service = new PresenceService(db, config, tenancyMode, publisher, true, () => now, 'owner');
  const detached = service.attachEphemeralManager(manager);
  return { db, target, projection, publisher, packets, service, manager, config, detach: detached, now: () => now, advance: (ms: number) => { now += ms; },
    close: async () => { await service.close(); detached(); manager.dispose(); db.dispose(); target.dispose(); } };
}

describe('managed Guardian presence aggregation', () => {
  test('exact reset/merge/ready inventory, heartbeats are SQL quiet, activity ages, multiple connections aggregate independently', async () => {
    const f = fixture(), scope = applicationServiceDataScope(), noop = () => {};
    try {
      await f.service.initialize(); expect(f.packets.slice(0, 3)).toEqual(['reset', 'merge', 'ready']);
      expect(f.service.capabilities(scope).state).toBe('ready'); expect(f.service.list(scope, 'user', noop)).toHaveLength(1);
      const principal = { scope, userId: 'user', connectionId: 'one' };
      f.service.report(principal, { sequence: 1, activity: true, visible: true }, noop); await f.service.drain();
      expect(f.service.self(scope, 'user', noop).observation?.status).toBe('available');
      const seq = f.db.currentSeq;
      const prepare = f.db.prepare.bind(f.db), transaction = f.db.transaction.bind(f.db);
      let queries = 0, writes = 0;
      Object.defineProperty(f.db, 'prepare', { configurable: true, value: (...args: Parameters<typeof prepare>) => { queries++; return prepare(...args); } });
      Object.defineProperty(f.db, 'transaction', { configurable: true, value: (fn: () => unknown) => { writes++; return transaction(fn); } });
      f.service.report(principal, { sequence: 2, activity: false, visible: true }, noop);
      expect(queries).toBe(0); expect(writes).toBe(0);
      Object.defineProperty(f.db, 'prepare', { configurable: true, value: prepare }); Object.defineProperty(f.db, 'transaction', { configurable: true, value: transaction });
      await f.service.drain();
      expect(f.db.currentSeq).toBe(seq);
      f.advance(1000); f.service.tick(); await f.service.drain();
      expect(f.service.self(scope, 'user', noop).observation?.status).toBe('idle');
      f.service.report({ ...principal, connectionId: 'two' }, { sequence: 1, activity: true, visible: true }, noop);
      expect(f.service.self(scope, 'user', noop).observation?.status).toBe('available');
      f.service.release('one'); expect(f.service.self(scope, 'user', noop).observation?.connected).toBe(true);
      f.service.updateIntent(scope, 'user', { status: 'busy', expectedRevision: 0, expiresAfterMs: 1000 }, noop);
      expect(f.service.self(scope, 'user', noop).observation?.status).toBe('busy');
      f.advance(1000); f.service.tick(); expect(f.service.self(scope, 'user', noop).observation?.status).toBe('idle');
      f.service.release('two'); expect(f.service.self(scope, 'user', noop).observation?.status).toBe('offline');
      await f.service.drain(); await f.service.close(); expect(f.projection.inspect()?.ready).toBe(false);
      expect(() => f.service.report(principal, { sequence: 3, activity: true, visible: true }, noop)).toThrow();
    } finally { await f.close(); }
  });

  test('disabled feature admits no SQL install, reports or owner; another owner stays pending without stealing', async () => {
    const f = fixture('single', false), scope = applicationServiceDataScope();
    try {
      await f.service.initialize(); expect(f.service.capabilities(scope).state).toBe('disabled');
      expect(f.db.prepare('SELECT name FROM sqlite_master WHERE name=?').get('guardian_presence')).toBeNull();
      expect(() => f.service.report({ scope, userId: 'user', connectionId: 'x' }, { sequence: 1, activity: true, visible: true }, () => {})).toThrow();
    } finally { await f.close(); }
    const owner = fixture();
    try {
      await owner.service.initialize();
      const second = new PresenceService(owner.db, owner.config, 'single', { publish: async () => { throw new Error('should not publish'); }, isReady: () => true }, true, owner.now, 'other-owner');
      await second.initialize(); expect(second.capabilities(scope).state).toBe('pending'); await second.close();
      expect(owner.service.capabilities(scope).state).toBe('ready');
    } finally { await owner.close(); }
  });

  test('scope separation and post-report authority retirement fail closed without renewing another scope', async () => {
    const f = fixture(), scope = applicationServiceDataScope(), other = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'a' });
    try {
      await f.service.initialize();
      expect(() => f.service.list(other, 'user', () => {})).toThrow();
      let checks = 0;
      expect(() => f.service.report({ scope, userId: 'user', connectionId: 'stale' }, { sequence: 1, activity: true, visible: true }, () => {
        if (++checks === 3) throw new Error('scope retired');
      })).toThrow();
      expect(f.service.self(scope, 'user', () => {}).observation?.connected).toBe(false);
    } finally { await f.close(); }
  });

  test('independent Sync teardown immediately retires all its connections while the app remains available', async () => {
    const f = fixture(), scope = applicationServiceDataScope(), noop = () => {};
    try {
      await f.service.initialize();
      f.service.report({ scope, userId: 'user', connectionId: 'one' }, { sequence: 1, activity: true, visible: true }, noop);
      f.service.report({ scope, userId: 'user', connectionId: 'two' }, { sequence: 1, activity: true, visible: true }, noop);
      await f.service.drain();
      f.detach(); await f.service.drain();
      expect(f.service.capabilities(scope).state).toBe('ready');
      expect(f.service.self(scope, 'user', noop).observation).toMatchObject({ status: 'offline', connected: false });
      expect(f.target.prepare('SELECT status_key,connected FROM guardian_presence').get()).toEqual({ status_key: 'offline', connected: 0 });
      expect(() => f.service.report({ scope, userId: 'user', connectionId: 'late' }, { sequence: 1, activity: true, visible: true }, noop)).toThrow();
    } finally { await f.close(); }
  });

  test('rolled-back before-use reconciliation retires cached admission and retries a complete same-owner snapshot', async () => {
    const f = fixture(), scope = applicationServiceDataScope();
    try {
      await f.service.initialize();
      f.db.exec("INSERT INTO users VALUES ('later','active',0,0,NULL)");
      const transaction = f.db.transaction.bind(f.db);
      let depth = 0;
      Object.defineProperty(f.db, 'transaction', { configurable: true, value: (fn: () => unknown) => {
        depth++;
        try { return transaction(() => { const result = fn(); if (depth === 1) throw new Error('synthetic rollback'); return result; }); }
        finally { depth--; }
      } });
      await expect(f.service.ensureScope(scope)).rejects.toMatchObject({ code: 'AUTH_PRESENCE_NOT_READY' });
      Object.defineProperty(f.db, 'transaction', { configurable: true, value: transaction });
      expect(f.service.capabilities(scope).state).toBe('pending');
      expect(f.db.prepare("SELECT 1 FROM guardian_presence WHERE user_id='later'").get()).toBeNull();
      expect(() => f.service.report({ scope, userId: 'later', connectionId: 'late' }, { sequence: 1, activity: true, visible: true }, () => {})).toThrow();
      f.service.tick(true); await f.service.drain();
      expect(f.service.capabilities(scope).state).toBe('ready');
      expect(f.service.list(scope, 'user', () => {})).toHaveLength(2);
      expect(f.target.prepare('SELECT count(*) AS total FROM guardian_presence').get()).toEqual({ total: 2 });
    } finally { await f.close(); }
  });

  test('replacement owner retains durable scoped intent but never resurrects the old connection leases', async () => {
    const f = fixture(), scope = applicationServiceDataScope(), noop = () => {};
    let replacement: PresenceService | null = null;
    try {
      await f.service.initialize();
      f.service.report({ scope, userId: 'user', connectionId: 'old-device' }, { sequence: 1, activity: true, visible: true }, noop);
      f.service.updateIntent(scope, 'user', { status: 'busy', expectedRevision: 0 }, noop); await f.service.drain();
      const epoch = f.service.self(scope, 'user', noop).observation!.ownerEpoch;
      await f.service.close();
      replacement = new PresenceService(f.db, f.config, 'single', f.publisher, true, f.now, 'replacement');
      replacement.attachEphemeralManager(f.manager); await replacement.initialize();
      expect(replacement.self(scope, 'user', noop)).toMatchObject({ intent: { status: 'busy', revision: 1 },
        observation: { status: 'offline', connected: false, ownerEpoch: epoch + 1 } });
      replacement.report({ scope, userId: 'user', connectionId: 'new-device' }, { sequence: 1, activity: true, visible: true }, noop); await replacement.drain();
      expect(replacement.self(scope, 'user', noop).observation).toMatchObject({ status: 'busy', connected: true });
      expect(() => f.service.report({ scope, userId: 'user', connectionId: 'old-device' }, { sequence: 2, activity: true, visible: true }, noop)).toThrow();
    } finally { await replacement?.close(); await f.close(); }
  });

  test('directory reads apply exact native SQL cursor bounds and reject invalid internal page contracts', async () => {
    const f = fixture(), scope = applicationServiceDataScope(), noop = () => {};
    try {
      f.db.exec("INSERT INTO users VALUES ('second','active',0,0,NULL),('third','active',0,0,NULL)");
      await f.service.initialize();
      const all = f.service.list(scope, 'user', noop), first = f.service.list(scope, 'user', noop, { limit: 1 });
      expect(all).toHaveLength(3); expect(first).toHaveLength(1);
      const after = presenceRowId(scope.scopeKind, scope.scopeId, first[0]!.userId);
      expect(f.service.list(scope, 'user', noop, { limit: 2, after })).toEqual(all.slice(1));
      expect(() => f.service.list(scope, 'user', noop, { limit: 502 })).toThrow();
      expect(() => f.service.list(scope, 'user', noop, { limit: 1, after: 'forged' })).toThrow();
    } finally { await f.close(); }
  });
});
