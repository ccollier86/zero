/** Actual admitted ReactiveDB SYSTEM tests; no separate production handles or external application data. */
import { describe, expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { migration } from '../migrations/definitions/040_guardian_presence';
import { applicationServiceDataScope, trustedSystemServiceDataScope } from '../auth/service-data-scope';
import { normalizeAuthPresence } from '../auth/auth-config-presence';
import { PresenceSystemStore } from './presence-system-store';
import { presenceSystemSchemaReady, reconcilePresenceSystemSchema } from './presence-schema';

function fixture(now: () => number) {
  const db = createReactiveDB({ mode: 'memory' });
  db.exec('CREATE TABLE users(user_id TEXT PRIMARY KEY)');
  db.prepare('INSERT INTO users(user_id) VALUES (?)').run('user');
  migration.up(db.getSQLiteService()!.raw);
  const store = new PresenceSystemStore(db, now); store.register();
  return { db, store };
}

describe('presence SYSTEM owner and intent store', () => {
  test('immutable040 installs exact runtime schema; disabled migration admission is read-only and collisions remain unready', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      db.exec('CREATE TABLE users(user_id TEXT PRIMARY KEY)');
      expect(reconcilePresenceSystemSchema(db, false)).toBe(false);
      expect(db.prepare('SELECT name FROM sqlite_master WHERE name=?').get('guardian_presence')).toBeNull();
      migration.up(db.getSQLiteService()!.raw); expect(presenceSystemSchemaReady(db)).toBe(true);
      db.exec('DROP INDEX idx_guardian_presence_scope_user'); expect(presenceSystemSchemaReady(db)).toBe(false);
      expect(reconcilePresenceSystemSchema(db, true)).toBe(true);
      db.exec('DROP TABLE _guardian_presence_authority');
      db.exec('CREATE TABLE _guardian_presence_authority(owner_key TEXT PRIMARY KEY,installation_id TEXT NOT NULL,owner_id TEXT NOT NULL,owner_epoch INTEGER NOT NULL,lease_until INTEGER NOT NULL,next_revision INTEGER NOT NULL)');
      expect(reconcilePresenceSystemSchema(db, true)).toBe(false);
    } finally { db.dispose(); }
  });

  test('single owner is enforced, shared checkpoints are tracked, and crash/restart epoch fences older owners', () => {
    let now = 1000; const { db, store } = fixture(() => now);
    try {
      const first = store.claim('gateway-a', 3000)!;
      expect(first.ownerEpoch).toBe(1); expect(store.claim('gateway-b', 3000)).toBeNull();
      const sequence = db.currentSeq; now = 2000;
      const refreshed = store.checkpoint(first, 3000);
      expect(refreshed.freshUntil).toBe(5000); expect(db.currentSeq).toBe(sequence + 1);
      expect(store.claim('gateway-b', 3000)).toBeNull(); now = 5000;
      const next = store.claim('gateway-b', 3000)!;
      expect(next.ownerEpoch).toBe(2); expect(next.installationId).toBe(first.installationId);
      expect(() => store.checkpoint(first, 3000)).toThrow(); store.retire(first);
      expect(store.claim('gateway-c', 3000)).toBeNull();
      store.retire(next); expect(store.claim('gateway-c', 3000)?.ownerEpoch).toBe(3);
    } finally { db.dispose(); }
  });

  test('manual intent uses per-scope CAS and same-transaction live authority, never profile/role revisions', () => {
    let now = 1000; const { db, store } = fixture(() => now);
    const scope = applicationServiceDataScope(), other = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'other' });
    const config = normalizeAuthPresence({ enabled: true });
    try {
      const claim = store.claim('gateway', 3000)!;
      expect(store.intent(scope, 'user')).toEqual({ status: 'available', expiresAt: null, revision: 0 });
      const accepted = store.updateIntent(scope, 'user', { status: 'busy', expectedRevision: 0, expiresAfterMs: 1000 }, config, claim, () => {});
      expect(accepted).toEqual({ status: 'busy', expiresAt: 2000, revision: 1 });
      expect(store.intent(other, 'user').status).toBe('available');
      expect(() => store.updateIntent(scope, 'user', { status: 'away', expectedRevision: 0 }, config, claim, () => {})).toThrow();
      expect(() => store.updateIntent(scope, 'user', { status: 'idle', expectedRevision: 1 }, config, claim, () => {})).toThrow();
      let checks = 0;
      expect(() => store.updateIntent(scope, 'user', { status: 'away', expectedRevision: 1 }, config, claim, () => {
        if (++checks === 2) throw new Error('authority retired');
      })).toThrow();
      expect(store.intent(scope, 'user')).toEqual(accepted); expect(checks).toBe(2);
      now = 2000; expect(store.intent(scope, 'user').expiresAt).toBe(2000);
    } finally { db.dispose(); }
  });
});
