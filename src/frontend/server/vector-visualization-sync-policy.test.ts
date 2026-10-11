/** Bounded public signals and private snapshots/artifacts use SYSTEM Sync authority. */
import { describe, expect, test } from 'bun:test';
import { createReactiveDB } from '../../sync/reactive-db';
import type { SyncResourcePolicyAdapter } from '../../sync/types';
import { PlatformSyncPolicyService } from './platform-sync-policy';
import { resolveGenericDataQueryableTables, resolvePlatformClientTables, PLATFORM_SYNC_WRITE_PROTECTED_TABLES } from './app-platform-tables';
import { VECTOR_VISUALIZATION_MAPS_TABLE as MAPS, VECTOR_VISUALIZATION_OPERATIONS_TABLE as OPS, VECTOR_VISUALIZATION_FEED_TABLE as FEED,
  VECTOR_VISUALIZATION_OPERATION_SCHEMA, VECTOR_VISUALIZATION_MAP_SCHEMA, VECTOR_VISUALIZATION_FEED_SCHEMA } from '../../vector/visualization-schema';
const delegate: SyncResourcePolicyAdapter = {
  async resolveTableAccess({ tableNames }) { return { readableTables: new Set(tableNames), rowFilters: new Map(), policyFingerprint: 'test' }; },
  async authorizeMutation() { return { ok: false, reason: 'read-only' }; },
};
const auth = { userId: 'user:a', email: 'user-a@example.test', role: 'user' };
describe('vector visualization Sync policy', () => {
  test('keeps off catalogs inert and reserved names off generic reads/writes', () => {
    expect(Object.hasOwn(resolvePlatformClientTables(false, false), OPS)).toBe(false);
    expect(Object.hasOwn(resolvePlatformClientTables(false, false), FEED)).toBe(false);
    expect(Object.hasOwn(resolvePlatformClientTables(false, false, true), OPS)).toBe(false);
    expect(Object.hasOwn(resolvePlatformClientTables(false, false, true), MAPS)).toBe(false);
    expect(Object.hasOwn(resolvePlatformClientTables(false, false, true), FEED)).toBe(true);
    expect(resolveGenericDataQueryableTables(new Set([OPS, MAPS, FEED, 'documents']))).toEqual(new Set(['documents']));
    for (const table of [OPS, MAPS, FEED]) expect(PLATFORM_SYNC_WRITE_PROTECTED_TABLES.has(table)).toBe(true);
  });
  test('enforces exact owner, scope, tenant, kind and enabled-index permission with a permissive delegate', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      db.defineTable(OPS, VECTOR_VISUALIZATION_OPERATION_SCHEMA); db.defineTable(MAPS, VECTOR_VISUALIZATION_MAP_SCHEMA); db.defineTable(FEED, VECTOR_VISUALIZATION_FEED_SCHEMA);
      let permitted = true;
      const policy = new PlatformSyncPolicyService({ delegate, getDB: () => db,
        canReadVectorVisualization: (index, _access, kind) => permitted && index === 'docs' && kind === 'search' });
      const tableAccess = await policy.resolveTableAccess({ tableNames: [OPS, MAPS, FEED], authContext: auth });
      expect(tableAccess.readableTables.has(FEED)).toBe(true);
      expect(tableAccess.readableTables.has(OPS)).toBe(false); expect(tableAccess.readableTables.has(MAPS)).toBe(false);
      const filter = tableAccess.rowFilters.get(FEED)!;
      const own = { feed_id: 'feed:a', scope_id: 'application', owner_user_id: auth.userId, tenant_id: null, index_name: 'docs', kind: 'search', change_token: 'opaque', updated_at: '2026-10-09T12:00:00Z' };
      expect(filter.matches(own)).toBe(true);
      for (const change of [{ owner_user_id: 'other' }, { scope_id: 'tenant:a' }, { tenant_id: 'tenant:a' }, { index_name: 'other' }, { kind: 'ingestion' }, { kind: 'invalid' }]) expect(filter.matches({ ...own, ...change })).toBe(false);
      permitted = false; expect(filter.matches(own)).toBe(false);
      const disabled = await new PlatformSyncPolicyService({ delegate, getDB: () => db }).resolveTableAccess({ tableNames: [FEED], authContext: auth });
      expect(disabled.rowFilters.get(FEED)?.matches(own) ?? false).toBe(false);
    } finally { db.dispose(); }
  });
  test('denies anonymous, invalid tenant selection, native sessions and missing system tables', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      const policy = new PlatformSyncPolicyService({ delegate, getDB: () => db, canReadVectorVisualization: () => true });
      expect((await policy.resolveTableAccess({ tableNames: [FEED], authContext: auth })).readableTables.has(FEED)).toBe(false);
      db.defineTable(FEED, VECTOR_VISUALIZATION_FEED_SCHEMA);
      for (const context of [null, { ...auth, sessionKind: 'native' as const }, { ...auth, tenantId: 'tenant:a' }]) {
        expect((await policy.resolveTableAccess({ tableNames: [FEED], authContext: context })).readableTables.has(FEED)).toBe(false);
      }
    } finally { db.dispose(); }
  });
  test('a permissive custom delegate/private set cannot expose retained snapshots or mutate any reserved table', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      const permissive: SyncResourcePolicyAdapter = { ...delegate, async authorizeMutation() { return { ok: true }; } };
      const policy = new PlatformSyncPolicyService({ delegate: permissive, getDB: () => db, privateTables: new Set(), canReadVectorVisualization: () => true });
      const access = await policy.resolveTableAccess({ tableNames: [OPS, MAPS], authContext: auth });
      expect([...access.readableTables]).toEqual([]);
      for (const table of [OPS, MAPS, FEED]) {
        expect(await policy.authorizeMutation({ table, op: 'INSERT', row: {}, authContext: auth, loadRow: () => null })).toMatchObject({ ok: false });
      }
    } finally { db.dispose(); }
  });
});
