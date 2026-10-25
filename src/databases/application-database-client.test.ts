import { describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlatformSQLiteService } from '../persistence';
import { ApplicationDatabaseClients } from './application-database-client';
import { DatabaseRuntime } from './database-runtime';
import { defineDatabaseRealm, type DatabaseRealm } from './database-realm';
import { DatabaseManager } from './database-manager';
import { createRequestDatabaseClient } from '../frontend/server/request-database-client';
import { applicationServiceDataScope, trustedSystemServiceDataScope } from '../auth/service-data-scope';
import { SYNC_TABLE_MUTATION_VALIDATOR, type Change, type SyncTableMutationValidator } from '../sync/types';

const tables = {
  notes: { id: 'text primary key', title: 'text not null', revision: 'integer not null' },
};

function fixture(mode: 'ephemeral' | 'file' | 'hot', realm?: DatabaseRealm) {
  const root = mkdtempSync(join(process.env.PROJECT_SCRATCH_DIR ?? tmpdir(), 'zero-application-data-'));
  const runtime = DatabaseRuntime.open({
    id: 'application', role: 'default', ownsSQLite: true, tables,
    sqlite: createPlatformSQLiteService(mode === 'ephemeral' ? { mode }
      : { mode, path: join(root, 'app.sqlite'), ...(mode === 'hot' ? { snapshotPath: join(root, 'app.snapshot.sqlite') } : {}) }),
  });
  const owner = new ApplicationDatabaseClients({ runtime, tables, realm, assertStarted() {} });
  const client = owner.bind(() => undefined);
  return { root, runtime, owner, client, async close() {
    try { await owner.close(); runtime.close(); } finally { rmSync(root, { recursive: true, force: true }); }
  } };
}

describe('primary async application database facade', () => {
  for (const mode of ['ephemeral', 'file', 'hot'] as const) {
    test(`${mode}: populated pages, tracked writes, atomic assertions and exact replay`, async () => {
      const f = fixture(mode);
      try {
        f.runtime.db.transaction(() => {
          for (let i = 0; i < 120; i++) f.runtime.db.insert('notes', { id: `seed-${String(i).padStart(3, '0')}`, title: 'Synthetic note', revision: i });
        });
        const before = f.runtime.db.currentSeq;
        const notifications: Change[] = [];
        const stop = f.runtime.db.onChange(change => { notifications.push(change); });
        const page = await f.client.findPage('notes', {
          limit: 10, offset: 5, select: ['id', 'revision'],
          filters: [{ type: 'field', field: 'revision', operator: 'gte', value: 20 }],
          order: [{ field: 'revision', direction: 'desc' }],
        });
        expect(page.value.total).toBe(100);
        expect(page.value.rows).toHaveLength(10);
        expect(page.value.rows[0]).toEqual({ id: 'seed-114', revision: 114 });
        const first = await f.client.list('notes', { limit: 2 });
        const second = await f.client.list('notes', { limit: 2, after: first.value.nextCursor! });
        expect(first.value.rows.map(r => r.id)).toEqual(['seed-000', 'seed-001']);
        expect(second.value.rows.map(r => r.id)).toEqual(['seed-002', 'seed-003']);

        const mutation = { type: 'create', table: 'notes', row: { id: 'new', title: 'New tracked note', revision: 1 } } as const;
        const created = await f.client.mutate(mutation, { idempotencyKey: 'note:new' });
        expect(created.replayed).toBe(false);
        expect(created.sequence.seq).toBe(before + 1);
        const replay = await f.client.mutate(mutation, { idempotencyKey: 'note:new' });
        expect(replay).toEqual({ ...created, replayed: true });
        expect(f.runtime.db.getChangesAfter(before)).toHaveLength(1);
        expect(notifications).toHaveLength(1);
        expect((await f.client.get('notes', 'new', { consistency: { mode: 'read-your-writes', minSeq: created.sequence } })).value).toEqual(mutation.row);

        await expect(f.client.batch({ mutations: [
          { type: 'update', table: 'notes', id: 'new', patch: { revision: 2 } },
          { type: 'create', table: 'notes', row: mutation.row },
        ] }, { idempotencyKey: 'rollback-batch' })).rejects.toBeDefined();
        expect((await f.client.get('notes', 'new')).value?.revision).toBe(1);
        expect(f.runtime.db.currentSeq).toBe(before + 1);
        expect(notifications).toHaveLength(1);
        stop();
        await expect(f.client.get('_zero_database_operation_receipts', 'note:new')).rejects.toMatchObject({ code: 'DATABASE_PAYLOAD_INVALID' });
        await expect(f.client.get('users', 'admin')).rejects.toMatchObject({ code: 'DATABASE_PAYLOAD_INVALID' });
      } finally { await f.close(); }
    });

    test(`${mode}: named SQL is readonly, avoids database copies, commands are atomic`, async () => {
      const realm = defineDatabaseRealm({ name: 'notes', version: '1', tables,
        queries: {
          'notes.count': ({ database }) => database.query<{ total: number }>('SELECT COUNT(*) AS total FROM notes').get()!,
          'notes.unsafe': ({ database }) => database.query('DELETE FROM notes').all(),
        },
        commands: { 'notes.rename': ({ db }, input: { id: string; title: string }) => {
          db.update('notes', input.id, { title: input.title });
          return { id: input.id, title: input.title };
        } },
      });
      const f = fixture(mode, realm);
      try {
        f.runtime.db.insert('notes', { id: 'n', title: 'Before', revision: 1 });
        const serialize = spyOn(f.runtime.sqlite.raw, 'serialize');
        expect((await f.client.query('notes.count', null)).value).toEqual({ total: 1 });
        expect(serialize).not.toHaveBeenCalled();
        serialize.mockRestore();
        await expect(f.client.query('notes.unsafe', null)).rejects.toMatchObject({ code: 'DATABASE_OPERATION_UNSUPPORTED' });
        await f.client.command('notes.rename', { id: 'n', title: 'After' }, { idempotencyKey: 'rename:n' });
        expect((await f.client.get('notes', 'n')).value?.title).toBe('After');
        expect(f.runtime.sqlite.raw.query('PRAGMA query_only').get()).toEqual({ query_only: 0 });
      } finally { await f.close(); }
    });
  }

  test('read-only adoption never installs a receipt ledger; input and scopes cannot rebind it', async () => {
    const f = fixture('ephemeral');
    try {
      expect(Reflect.ownKeys(f.client)).toEqual([]);
      await f.client.find('notes', { limit: 1 });
      expect(f.runtime.sqlite.raw.query("SELECT name FROM sqlite_schema WHERE name = '_zero_database_operation_receipts'").get()).toBeNull();
      await expect(f.client.get('notes; SELECT 1', 'x')).rejects.toBeDefined();
      await expect(f.client.find('notes', { limit: 1 }, { operationTimeoutMs: -1 })).rejects.toMatchObject({ code: 'DATABASE_PAYLOAD_INVALID' });
      const ac = new AbortController(); ac.abort();
      await expect(f.client.mutate({ type: 'delete', table: 'notes', id: 'x' }, { idempotencyKey: 'cancelled', signal: ac.signal })).rejects.toMatchObject({ code: 'DATABASE_QUEUE_TIMEOUT', outcome: 'not-started' });
    } finally { await f.close(); }
  });

  for (const mode of ['file', 'hot'] as const) {
    test(`${mode}: exact receipts survive a clean runtime restart without another reactive insert`, async () => {
      const f = fixture(mode);
      let reopened: DatabaseRuntime | undefined;
      let owner: ApplicationDatabaseClients | undefined;
      const mutation = { type: 'create', table: 'notes', row: { id: 'persisted', title: 'Retained synthetic receipt', revision: 1 } } as const;
      try {
        const accepted = await f.client.mutate(mutation, { idempotencyKey: 'durable:create' });
        await f.owner.close(); f.runtime.close();
        reopened = DatabaseRuntime.open({ id: 'application', role: 'default', ownsSQLite: true, tables,
          sqlite: createPlatformSQLiteService({ mode, path: join(f.root, 'app.sqlite'),
            ...(mode === 'hot' ? { snapshotPath: join(f.root, 'app.snapshot.sqlite') } : {}) }),
        });
        owner = new ApplicationDatabaseClients({ runtime: reopened, tables, assertStarted() {} });
        const result = await owner.bind(() => undefined).mutate(mutation, { idempotencyKey: 'durable:create' });
        expect(result).toEqual({ ...accepted, replayed: true });
        expect(reopened.db.currentSeq).toBe(accepted.sequence.seq);
      } finally { await owner?.close(); reopened?.close(); await f.close(); }
    });
  }

  test('declarative mutation validators survive primary registry admission', async () => {
    const f = fixture('ephemeral');
    const validator: SyncTableMutationValidator = {
      primaryKey: 'id', fieldNames: ['id', 'title', 'revision'],
      decodeRow: row => row, encodeRow: row => row,
      validateRow(row) { return row.title === 'Rejected'
        ? { success: false, issues: [{ message: 'Synthetic domain rejection' }] }
        : { success: true, output: row }; },
    };
    const owner = new ApplicationDatabaseClients({ runtime: f.runtime,
      tables: { notes: { ...tables.notes, [SYNC_TABLE_MUTATION_VALIDATOR]: validator } }, assertStarted() {} });
    try {
      await expect(owner.bind(() => undefined).mutate({ type: 'create', table: 'notes', row: { id: 'invalid', title: 'Rejected', revision: 1 } }, { idempotencyKey: 'invalid' })).rejects.toBeDefined();
      expect(f.runtime.db.get('notes', 'invalid')).toBeNull();
    } finally { await owner.close(); await f.close(); }
  });

  test('bounded primary FIFO rejects overflow and cancelled queued work without affecting another database', async () => {
    const f = fixture('ephemeral'), other = fixture('ephemeral');
    try {
      const ac = new AbortController();
      const reads = Array.from({ length: 258 }, (_, index) => f.client.get('notes', String(index), index === 1 ? { signal: ac.signal } : {}));
      ac.abort();
      const settled = Promise.allSettled(reads);
      await other.client.mutate({ type: 'create', table: 'notes', row: { id: 'independent', title: 'Not globally queued', revision: 1 } }, { idempotencyKey: 'independent' });
      const results = await settled;
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected.map(r => r.reason.code).sort()).toEqual(['DATABASE_BACKPRESSURE', 'DATABASE_QUEUE_TIMEOUT']);
      expect((await other.client.get('notes', 'independent')).value?.id).toBe('independent');
    } finally { await f.close(); await other.close(); }
  });

  test('live authority is checked at FIFO head, inside commit, and after yielded delivery', async () => {
    let current = true;
    const admitted = defineDatabaseRealm({ name: 'revocation', version: '1', tables,
      queries: { 'notes.revoke': () => { queueMicrotask(() => { current = false; }); return 'private-result'; } },
      commands: { 'notes.create-revoked': ({ db }) => {
        db.create('notes', { id: 'revoked', title: 'Never committed', revision: 1 });
        current = false;
        return null;
      } },
    });
    const f = fixture('ephemeral', admitted);
    const client = f.owner.bind(() => { if (!current) throw new Error('/private/authority'); return undefined; });
    try {
      const blocked = client.mutate({ type: 'create', table: 'notes', row: { id: 'queued', title: 'Blocked', revision: 1 } }, { idempotencyKey: 'queued' });
      current = false;
      await expect(blocked).rejects.toMatchObject({ code: 'DATABASE_AUTHORITY_CHANGED', outcome: 'not-started' });
      current = true;
      await expect(client.command('notes.create-revoked', null, { idempotencyKey: 'in-command' })).rejects.toMatchObject({ code: 'DATABASE_AUTHORITY_CHANGED', outcome: 'not-committed' });
      expect(f.runtime.db.get('notes', 'revoked')).toBeNull();
      current = true;
      await expect(client.query('notes.revoke', null)).rejects.toMatchObject({ code: 'DATABASE_AUTHORITY_CHANGED' });
      expect(f.runtime.db.get('notes', 'queued')).toBeNull();
    } finally { await f.close(); }
  });

  test('manager projects only the application scope, drains work and seals retained clients', async () => {
    const f = fixture('ephemeral');
    await f.owner.close();
    const system = DatabaseRuntime.open({ id: 'system', role: 'system', ownsSQLite: true, sqlite: createPlatformSQLiteService({ mode: 'ephemeral' }) });
    const manager = new DatabaseManager({ systemRuntime: system, appRuntime: f.runtime, applicationTables: tables });
    try {
      manager.start();
      const client = createRequestDatabaseClient({ manager, scope: applicationServiceDataScope(), assertCurrentAuthoritySync() {} })!;
      expect(client).not.toBeNull();
      expect(createRequestDatabaseClient({ manager, scope: trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'unfiltered-tenant' }), assertCurrentAuthoritySync() {} })).toBeNull();
      await client.mutate({ type: 'create', table: 'notes', row: { id: 'manager', title: 'Safe', revision: 1 } }, { idempotencyKey: 'manager' });
      await manager.close();
      await expect(client.get('notes', 'manager')).rejects.toMatchObject({ code: 'DATABASE_CLOSED' });
    } finally { await manager.close(); await f.close(); }
  });
});
