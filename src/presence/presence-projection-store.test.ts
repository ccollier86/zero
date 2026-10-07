/** Actual ReactiveDB/Fabric contribution source tests; service-level and subprocess gates follow actor integration. */
import { describe, expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { composeDatabaseRealm } from '../databases/database-realm-composition';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { guardianPresenceRealmMigration } from './presence-realm-migration';
import { guardianPresenceRealmContribution, hasGuardianPresenceRealm, PRESENCE_CURRENT_VIEW_SQL, readGuardianPresenceCurrent } from './presence-realm';
import { normalizePresenceSchemaSql } from './presence-schema-sql';
import { registerPresenceProjectionTables } from './presence-schema';
import { PresenceProjectionStore } from './presence-projection-store';
import { capturePresencePublication, presenceRowId, type PresencePublication } from './presence-publication';

const scopeId = 'organization-a';
function publication(revision: number, mode: PresencePublication['mode'] = 'merge', ownerEpoch = 1): PresencePublication {
  return { installationId: 'installation', targetId: `tenant:${scopeId}`, scopeKind: 'tenant', scopeId,
    ownerEpoch, sourceAuthorityRevision: 0, revision, freshUntil: Date.now() + 30000, mode, rows: [], removedIds: [] };
}
function fixture() {
  const db = createReactiveDB({ mode: 'memory' }); guardianPresenceRealmMigration.up(db.getSQLiteService()!.raw);
  registerPresenceProjectionTables(db); return { db, store: new PresenceProjectionStore(db) };
}

describe('Guardian Fabric projection', () => {
  test('contribution is explicit, immutable, query-only and actual SQL reflects incomplete/readiness/expired owners', () => {
    const realm = composeDatabaseRealm({ name: 'application', version: '1', contributions: [guardianPresenceRealmContribution()] });
    expect(hasGuardianPresenceRealm(realm)).toBe(true); expect(Object.keys(realm.tables)).toHaveLength(0);
    expect(Object.keys(realm.commands)).toHaveLength(0);
    const { db, store } = fixture();
    try {
      const installedView = db.prepare('SELECT sql FROM sqlite_master WHERE type=? AND name=?').get('view', 'guardian_presence_current') as { sql: string };
      expect(normalizePresenceSchemaSql(installedView.sql)).toBe(normalizePresenceSchemaSql(PRESENCE_CURRENT_VIEW_SQL));
      store.apply(publication(1, 'reset'));
      const row = { id: presenceRowId('tenant', scopeId, 'user'), scope_kind: 'tenant' as const, scope_id: scopeId,
        user_id: 'user', status_key: 'available', connected: 1 as const, revision: 2, owner_epoch: 1, updated_at: Date.now() };
      store.apply({ ...publication(2), rows: [row] });
      let current = db.prepare('SELECT status_key,connected,stale FROM guardian_presence_current').get() as Record<string, unknown>;
      expect(current).toEqual({ status_key: 'offline', connected: 0, stale: 1 });
      store.apply(publication(3, 'ready')); expect(store.inspect()?.ready).toBe(true);
      current = db.prepare('SELECT status_key,connected,stale FROM guardian_presence_current').get() as Record<string, unknown>;
      expect(current).toEqual({ status_key: 'available', connected: 1, stale: 0 });
      const result = withDatabaseReadQuerySession(createDatabaseReadQuerySession(db.getRawDatabase()), context => readGuardianPresenceCurrent(context, { limit: 1 })) as Record<string, unknown>[];
      expect(result[0]?.status).toBe('available'); expect(result[0]?.connected).toBe(true);
      store.apply({ ...publication(4, 'checkpoint'), freshUntil: Date.now() - 1 });
      current = db.prepare('SELECT status_key,connected,stale FROM guardian_presence_current').get() as Record<string, unknown>;
      expect(current).toEqual({ status_key: 'offline', connected: 0, stale: 1 });
      expect(() => readGuardianPresenceCurrent({ database: {} } as never, { now: 0 })).toThrow();
    } finally { db.dispose(); }
  });

  test('idempotent revision ordering and owner/installation fences reject stale or conflicting publication', () => {
    const { db, store } = fixture();
    try {
      const initial = publication(1, 'reset'); expect(store.apply(initial).applied).toBe(true);
      const sequence = db.currentSeq; expect(store.apply(initial).duplicate).toBe(true); expect(db.currentSeq).toBe(sequence);
      expect(() => store.apply({ ...initial, freshUntil: initial.freshUntil + 1 })).toThrow();
      expect(() => store.apply({ ...publication(2, 'ready'), installationId: 'wrong-installation' })).toThrow();
      store.apply(publication(1, 'reset', 2));
      expect(store.apply(publication(100, 'retire', 1)).applied).toBe(false);
      expect(store.inspect()?.ownerEpoch).toBe(2); expect(store.inspect()?.revision).toBe(1);
      expect(() => capturePresencePublication({ ...publication(2), rows: [{ id: 'forged' }] })).toThrow();
      expect(() => capturePresencePublication({ ...publication(2), freshUntil: '99999999' })).toThrow();
      expect(() => capturePresencePublication({ ...publication(2), scopeId: 'another-organization' })).toThrow();
    } finally { db.dispose(); }
  });
});
