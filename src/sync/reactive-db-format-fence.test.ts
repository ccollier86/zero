import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createReactiveDB, type ReactiveDB } from './reactive-db';
import { openLegacyReactiveDB } from './test-fixtures/legacy-reactive-db-startup';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('ReactiveDB durable change-log format fence', () => {
  test('reserves seq 0 as an immutable structural sentinel', async () => {
    const { path } = await tempDatabase('zero-sync-fence-sentinel-');
    const reactive = createReactiveDB({ mode: path });
    try {
      const sentinel = reactive.prepare(`
        SELECT seq, tbl, op, row_id, data, previous_data, ts, origin, format_version
        FROM _changes WHERE seq = 0
      `).get();
      expect(sentinel).toEqual({
        seq: 0,
        tbl: '_zero_sync_fence',
        op: 'INSERT',
        row_id: 'format-v1',
        data: null,
        previous_data: null,
        ts: 0,
        origin: null,
        format_version: 1,
      });
      expect(reactive.currentSeq).toBe(0);
      expect(reactive.getChangesAfter(0)).toEqual([]);
    } finally {
      reactive.dispose();
    }
  });

  test('blocks the frozen released default constructor before it can serve', async () => {
    for (const withPositiveRow of [false, true]) {
      const { path } = await tempDatabase(`zero-sync-fence-legacy-${withPositiveRow}-`);
      const reactive = createReactiveDB({ mode: path });
      if (withPositiveRow) {
        reactive.defineTable('items', { id: 'text primary key' });
        reactive.insert('items', { id: 'one' });
      }
      reactive.dispose();

      expect(() => openLegacyReactiveDB(path)).toThrow('ZERO_SYNC_LOG_DELETE_FORBIDDEN');

      const verify = new Database(path);
      try {
        const sequences = verify.prepare(
          'SELECT seq FROM _changes ORDER BY seq',
        ).all() as Array<{ seq: number }>;
        expect(sequences.map((row) => row.seq)).toEqual(
          withPositiveRow ? [0, 1] : [0],
        );
      } finally {
        verify.close();
      }
    }
  });

  test('proves why pre-fence clear=false requires a coordinated stop-all', async () => {
    const { path } = await tempDatabase('zero-sync-fence-legacy-no-clear-');
    const reactive = createReactiveDB({ mode: path });
    reactive.dispose();

    // This explicitly non-default released configuration skips the startup
    // DELETE tripwire. Its old write ordering commits app DML before opening a
    // separate transaction for the log row; no later trigger can retroactively
    // roll the first transaction back.
    const legacy = openLegacyReactiveDB(path, false);
    try {
      legacy.run('CREATE TABLE items (id TEXT PRIMARY KEY)');
      legacy.run("INSERT INTO items (id) VALUES ('unsafe-old-writer')");
      expect(() => legacy.run(`
        INSERT INTO _changes
          (seq, tbl, op, row_id, data, previous_data, ts)
        VALUES (1, 'items', 'INSERT', 'unsafe-old-writer',
          '{"id":"unsafe-old-writer"}', NULL, 1)
      `)).toThrow('ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE');
      expect(legacy.prepare(
        "SELECT id FROM items WHERE id = 'unsafe-old-writer'",
      ).get()).toEqual({ id: 'unsafe-old-writer' });
      expect(legacy.prepare(
        'SELECT COUNT(*) AS count FROM _changes WHERE seq > 0',
      ).get()).toEqual({ count: 0 });
    } finally {
      legacy.close();
    }
  });

  test('rejects legacy or incompatible log rows and rolls back the whole app transaction', () => {
    for (const format of ['omitted', null, '1', 2] as const) {
      const reactive = createReactiveDB({ mode: 'memory' });
      reactive.defineTable('items', { id: 'text primary key' });
      const raw = reactive.getRawDatabase();
      try {
        expect(() => raw.transaction(() => {
          raw.prepare('INSERT INTO items (id) VALUES (?)')
            .run(`item-${String(format)}`);
          raw.run('UPDATE _zero_sync_log_state SET seq = seq + 1 WHERE singleton = 1');
          if (format === 'omitted') {
            raw.run(`
              INSERT INTO _changes
                (seq, tbl, op, row_id, data, previous_data, ts, origin)
              VALUES (1, 'items', 'INSERT', 'legacy', '{"id":"legacy"}', NULL, 1, NULL)
            `);
          } else {
            raw.prepare(`
              INSERT INTO _changes
                (seq, tbl, op, row_id, data, previous_data, ts, origin, format_version)
              VALUES (1, 'items', 'INSERT', 'legacy', '{"id":"legacy"}', NULL, 1, NULL, ?)
            `).run(format as any);
          }
        }).immediate()).toThrow('ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE');
        expect(reactive.query('items')).toEqual([]);
        expect(reactive.currentSeq).toBe(0);
        expect(reactive.getChangesAfter(0)).toEqual([]);
      } finally {
        reactive.dispose();
      }
    }
  });

  test('RAISE(ROLLBACK) cannot be swallowed to commit an application row', () => {
    const reactive = createReactiveDB({ mode: 'memory' });
    reactive.defineTable('items', { id: 'text primary key' });
    const raw = reactive.getRawDatabase();
    try {
      expect(() => raw.transaction(() => {
        raw.run("INSERT INTO items (id) VALUES ('caught')");
        try {
          raw.run(`
            INSERT INTO _changes
              (seq, tbl, op, row_id, data, previous_data, ts, origin)
            VALUES (1, 'items', 'INSERT', 'caught', '{"id":"caught"}', NULL, 1, NULL)
          `);
        } catch {
          // A caller may catch the statement error, but SQLite has already
          // rolled back the transaction and the wrapper cannot commit it.
        }
      }).immediate()).toThrow();
      expect(reactive.queryOne('items', 'caught')).toBeNull();
      expect(reactive.currentSeq).toBe(0);
    } finally {
      reactive.dispose();
    }
  });

  test('prevents replace, update, and unauthorized delete of durable history', () => {
    const reactive = createReactiveDB({ mode: 'memory' });
    reactive.defineTable('items', { id: 'text primary key' });
    reactive.insert('items', { id: 'one' });
    const raw = reactive.getRawDatabase();
    try {
      expect(() => raw.run(`
        INSERT OR REPLACE INTO _changes
          (seq, tbl, op, row_id, data, previous_data, ts, origin, format_version)
        VALUES (1, 'items', 'DELETE', 'replacement', NULL, NULL, 2, NULL, 1)
      `)).toThrow('ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE');
      expect(() => raw.run(`
        INSERT OR REPLACE INTO _changes
          (seq, tbl, op, row_id, data, previous_data, ts, origin, format_version)
        VALUES (0, '_zero_sync_fence', 'INSERT', 'format-v1',
          NULL, NULL, 0, NULL, 1)
      `)).toThrow('ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE');
      expect(() => raw.run("UPDATE _changes SET row_id = 'changed' WHERE seq = 1"))
        .toThrow('ZERO_SYNC_LOG_IMMUTABLE');
      expect(() => raw.run('DELETE FROM _changes WHERE seq = 1'))
        .toThrow('ZERO_SYNC_LOG_DELETE_FORBIDDEN');
      expect(() => raw.run('DELETE FROM _changes'))
        .toThrow('ZERO_SYNC_LOG_DELETE_FORBIDDEN');
      expect(reactive.getChangesAfter(0)?.map((change) => change.rowId)).toEqual(['one']);
    } finally {
      reactive.dispose();
    }
  });

  test('rolls back app row, sequence, log insert, and watermark when pruning fails', () => {
    const reactive = createReactiveDB({ mode: 'memory', ringBufferDepth: 1 });
    reactive.defineTable('items', { id: 'text primary key' });
    reactive.insert('items', { id: 'one' });
    const raw = reactive.getRawDatabase();
    raw.run(`
      CREATE TRIGGER reject_test_prune
      BEFORE DELETE ON _changes
      WHEN OLD.seq > 0
      BEGIN
        SELECT RAISE(ABORT, 'reject test prune');
      END
    `);

    try {
      expect(() => reactive.insert('items', { id: 'two' }))
        .toThrow('owned log trigger set is incompatible');
      expect(reactive.queryOne('items', 'two')).toBeNull();
      expect(reactive.currentSeq).toBe(1);
      expect(reactive.prepare(`
        SELECT seq, prune_through FROM _zero_sync_log_state WHERE singleton = 1
      `).get()).toEqual({ seq: 1, prune_through: 0 });
      expect(reactive.getChangesAfter(0)?.map((change) => change.seq)).toEqual([1]);
    } finally {
      reactive.dispose();
    }
  });

  test('rolls back a late trigger that injects a phantom durable change', () => {
    const reactive = createReactiveDB({ mode: 'memory' });
    reactive.defineTable('items', { id: 'text primary key' });
    const raw = reactive.getRawDatabase();
    raw.run('CREATE TABLE injection_side_effects (seq INTEGER PRIMARY KEY)');
    raw.run(`
      CREATE TRIGGER inject_test_durable_change
      AFTER INSERT ON _changes
      WHEN NEW.seq > 0
      BEGIN
        INSERT INTO injection_side_effects (seq) VALUES (NEW.seq);
        UPDATE _zero_sync_log_state
        SET seq = seq + 1
        WHERE singleton = 1;
        INSERT INTO _changes
          (seq, tbl, op, row_id, data, previous_data, ts, origin, format_version)
        VALUES
          (NEW.seq + 1, 'items', 'INSERT', 'phantom', '{"id":"phantom"}',
            NULL, NEW.ts, 'late-trigger', 1);
      END
    `);

    try {
      expect(() => reactive.insert('items', { id: 'real' }))
        .toThrow('owned log trigger set is incompatible');
      expect(reactive.queryOne('items', 'real')).toBeNull();
      expect(reactive.currentSeq).toBe(0);
      expect(reactive.getChangesAfter(0)).toEqual([]);
      expect(reactive.prepare(
        'SELECT seq FROM _changes ORDER BY seq',
      ).all()).toEqual([{ seq: 0 }]);
      expect(reactive.prepare(
        'SELECT COUNT(*) AS count FROM injection_side_effects',
      ).get()).toEqual({ count: 0 });
    } finally {
      reactive.dispose();
    }
  });

  test('rejects a late allocator trigger before it can mutate application data', () => {
    const reactive = createReactiveDB({ mode: 'memory' });
    reactive.defineTable('items', { id: 'text primary key' });
    reactive.getRawDatabase().run(`
      CREATE TRIGGER delete_target_from_allocator
      AFTER UPDATE OF seq ON _zero_sync_log_state
      BEGIN
        DELETE FROM items WHERE id = 'real';
      END
    `);

    try {
      expect(() => reactive.insert('items', { id: 'real' }))
        .toThrow('owned log trigger set is incompatible');
      expect(reactive.queryOne('items', 'real')).toBeNull();
      expect(reactive.currentSeq).toBe(0);
      expect(reactive.getChangesAfter(0)).toEqual([]);
    } finally {
      reactive.dispose();
    }
  });

  test('rejects case-varied owned-table triggers before startup or runtime writes', async () => {
    const { path } = await tempDatabase('zero-sync-fence-case-varied-trigger-');
    const created = createReactiveDB({ mode: path });
    created.dispose();
    const raw = new Database(path);
    try {
      raw.run(`
        CREATE TRIGGER uppercase_owned_trigger
        AFTER UPDATE OF seq ON "_ZERO_SYNC_LOG_STATE"
        BEGIN SELECT 1; END
      `);
    } finally {
      raw.close();
    }
    expect(() => createReactiveDB({ mode: path }))
      .toThrow('owned log trigger set is incompatible');

    const running = createReactiveDB({ mode: 'memory' });
    running.defineTable('items', { id: 'text primary key' });
    running.getRawDatabase().run(`
      CREATE TRIGGER mixed_case_allocator_trigger
      AFTER UPDATE OF seq ON "_Zero_Sync_Log_State"
      BEGIN
        DELETE FROM items WHERE id = 'real';
      END
    `);
    try {
      expect(() => running.insert('items', { id: 'real' }))
        .toThrow('owned log trigger set is incompatible');
      expect(running.queryOne('items', 'real')).toBeNull();
      expect(running.currentSeq).toBe(0);
      expect(running.getChangesAfter(0)).toEqual([]);
    } finally {
      running.dispose();
    }
  });

  test('rolls back when a late trigger suppresses pruning after side effects', () => {
    const reactive = createReactiveDB({ mode: 'memory', ringBufferDepth: 1 });
    reactive.defineTable('items', { id: 'text primary key' });
    reactive.insert('items', { id: 'one' });
    const raw = reactive.getRawDatabase();
    raw.run('CREATE TABLE prune_side_effects (seq INTEGER PRIMARY KEY)');
    raw.run(`
      CREATE TRIGGER ignore_test_prune
      BEFORE DELETE ON _changes
      WHEN OLD.seq > 0
      BEGIN
        INSERT INTO prune_side_effects (seq) VALUES (OLD.seq);
        SELECT RAISE(IGNORE);
      END
    `);

    try {
      expect(() => reactive.insert('items', { id: 'two' }))
        .toThrow('owned log trigger set is incompatible');
      expect(reactive.queryOne('items', 'two')).toBeNull();
      expect(reactive.currentSeq).toBe(1);
      expect(reactive.prepare(`
        SELECT seq, prune_through FROM _zero_sync_log_state WHERE singleton = 1
      `).get()).toEqual({ seq: 1, prune_through: 0 });
      expect(reactive.prepare(
        'SELECT seq FROM _changes ORDER BY seq',
      ).all()).toEqual([{ seq: 0 }, { seq: 1 }]);
      expect(reactive.prepare(
        'SELECT COUNT(*) AS count FROM prune_side_effects',
      ).get()).toEqual({ count: 0 });
    } finally {
      reactive.dispose();
    }
  });

  test('rolls back a late prune trigger that injects a phantom durable change', () => {
    const reactive = createReactiveDB({ mode: 'memory', ringBufferDepth: 1 });
    reactive.defineTable('items', { id: 'text primary key' });
    reactive.insert('items', { id: 'one' });
    const raw = reactive.getRawDatabase();
    raw.run('CREATE TABLE prune_injection_side_effects (seq INTEGER PRIMARY KEY)');
    raw.run(`
      CREATE TRIGGER inject_test_change_during_prune
      AFTER DELETE ON _changes
      WHEN OLD.seq > 0
      BEGIN
        INSERT INTO prune_injection_side_effects (seq) VALUES (OLD.seq);
        UPDATE _zero_sync_log_state
        SET seq = seq + 1
        WHERE singleton = 1;
        INSERT INTO _changes
          (seq, tbl, op, row_id, data, previous_data, ts, origin, format_version)
        VALUES
          (OLD.seq + 2, 'items', 'INSERT', 'phantom', '{"id":"phantom"}',
            NULL, OLD.ts, 'late-prune-trigger', 1);
      END
    `);

    try {
      expect(() => reactive.insert('items', { id: 'two' }))
        .toThrow('owned log trigger set is incompatible');
      expect(reactive.queryOne('items', 'two')).toBeNull();
      expect(reactive.currentSeq).toBe(1);
      expect(reactive.getChangesAfter(0)?.map((change) => change.rowId))
        .toEqual(['one']);
      expect(reactive.prepare(`
        SELECT seq, prune_through FROM _zero_sync_log_state WHERE singleton = 1
      `).get()).toEqual({ seq: 1, prune_through: 0 });
      expect(reactive.prepare(
        'SELECT seq FROM _changes ORDER BY seq',
      ).all()).toEqual([{ seq: 0 }, { seq: 1 }]);
      expect(reactive.prepare(
        'SELECT COUNT(*) AS count FROM prune_injection_side_effects',
      ).get()).toEqual({ count: 0 });
    } finally {
      reactive.dispose();
    }
  });

  test('rolls back when a late trigger suppresses the prune watermark advance', () => {
    const reactive = createReactiveDB({ mode: 'memory', ringBufferDepth: 1 });
    reactive.defineTable('items', { id: 'text primary key' });
    reactive.insert('items', { id: 'one' });
    const raw = reactive.getRawDatabase();
    raw.run('CREATE TABLE watermark_side_effects (seq INTEGER PRIMARY KEY)');
    raw.run(`
      CREATE TRIGGER ignore_test_watermark_advance
      BEFORE UPDATE ON _zero_sync_log_state
      WHEN NEW.prune_through > OLD.prune_through
      BEGIN
        INSERT INTO watermark_side_effects (seq) VALUES (NEW.prune_through);
        SELECT RAISE(IGNORE);
      END
    `);

    try {
      expect(() => reactive.insert('items', { id: 'two' }))
        .toThrow('owned log trigger set is incompatible');
      expect(reactive.queryOne('items', 'two')).toBeNull();
      expect(reactive.currentSeq).toBe(1);
      expect(reactive.prepare(`
        SELECT seq, prune_through FROM _zero_sync_log_state WHERE singleton = 1
      `).get()).toEqual({ seq: 1, prune_through: 0 });
      expect(reactive.prepare(
        'SELECT seq FROM _changes ORDER BY seq',
      ).all()).toEqual([{ seq: 0 }, { seq: 1 }]);
      expect(reactive.prepare(
        'SELECT COUNT(*) AS count FROM watermark_side_effects',
      ).get()).toEqual({ count: 0 });
    } finally {
      reactive.dispose();
    }
  });

  test('rolls back when a late trigger over-advances the prune watermark', () => {
    const reactive = createReactiveDB({ mode: 'memory', ringBufferDepth: 1 });
    reactive.defineTable('items', { id: 'text primary key' });
    reactive.insert('items', { id: 'one' });
    reactive.getRawDatabase().run(`
      CREATE TRIGGER over_advance_test_watermark
      AFTER UPDATE ON _zero_sync_log_state
      WHEN NEW.seq = 2 AND NEW.prune_through = 1
      BEGIN
        UPDATE _zero_sync_log_state
        SET prune_through = seq
        WHERE singleton = 1;
      END
    `);

    try {
      expect(() => reactive.insert('items', { id: 'two' }))
        .toThrow('owned log trigger set is incompatible');
      expect(reactive.queryOne('items', 'two')).toBeNull();
      expect(reactive.currentSeq).toBe(1);
      expect(reactive.prepare(`
        SELECT seq, prune_through FROM _zero_sync_log_state WHERE singleton = 1
      `).get()).toEqual({ seq: 1, prune_through: 0 });
      expect(reactive.prepare(
        'SELECT seq FROM _changes ORDER BY seq',
      ).all()).toEqual([{ seq: 0 }, { seq: 1 }]);
    } finally {
      reactive.dispose();
    }
  });

  test('guards the authoritative state row and poisons the legacy allocator', () => {
    const reactive = createReactiveDB({ mode: 'memory' });
    const raw = reactive.getRawDatabase();
    try {
      expect(() => raw.run('DELETE FROM _zero_sync_log_state'))
        .toThrow('ZERO_SYNC_LOG_STATE_INVALID');
      expect(() => raw.run(`
        INSERT OR REPLACE INTO _zero_sync_log_state
          (singleton, schema_version, write_format, min_reader_format, seq, prune_through)
        VALUES (1, 1, 1, 0, 0, 0)
      `)).toThrow('ZERO_SYNC_LOG_STATE_INVALID');
      expect(() => raw.run(
        'UPDATE _zero_sync_log_state SET seq = -1 WHERE singleton = 1',
      )).toThrow('ZERO_SYNC_LOG_STATE_INVALID');
      expect(() => raw.run(
        'UPDATE _change_sequence SET seq = seq + 1 WHERE singleton = 1',
      )).toThrow('ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE');
      expect(() => raw.run(
        'INSERT OR IGNORE INTO _change_sequence (singleton, seq) VALUES (1, 0)',
      )).toThrow('ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE');
    } finally {
      reactive.dispose();
    }
  });

  test('retains legacy-v0 rows and appends explicit v1 rows in order', async () => {
    const { path } = await tempDatabase('zero-sync-fence-legacy-retained-');
    const legacy = new Database(path, { create: true });
    try {
      legacy.run(`
        CREATE TABLE _changes (
          seq INTEGER PRIMARY KEY,
          tbl TEXT NOT NULL,
          op TEXT NOT NULL,
          row_id TEXT NOT NULL,
          data TEXT,
          ts INTEGER NOT NULL
        )
      `);
      legacy.run(`
        INSERT INTO _changes (seq, tbl, op, row_id, data, ts)
        VALUES (7, 'items', 'INSERT', 'legacy', '{"id":"legacy"}', 1)
      `);
    } finally {
      legacy.close();
    }

    const reactive = createReactiveDB({ mode: path });
    try {
      reactive.defineTable('items', { id: 'text primary key' });
      expect(reactive.getChangesAfter(6)?.map((change) => change.seq)).toEqual([7]);
      expect(reactive.insert('items', { id: 'new' }).seq).toBe(8);
      const formats = reactive.prepare(`
        SELECT seq, format_version FROM _changes WHERE seq > 0 ORDER BY seq
      `).all();
      expect(formats).toEqual([
        { seq: 7, format_version: null },
        { seq: 8, format_version: 1 },
      ]);
    } finally {
      reactive.dispose();
    }
  });

  test('fails closed on reserved, gapped, future-format, and unexplained histories', async () => {
    const cases: Array<{
      name: string;
      rows: Array<readonly [number, string, number | null]>;
      legacySeq: number | null;
      expected: string;
    }> = [
      {
        name: 'reserved',
        rows: [[0, 'INSERT', null] as const],
        legacySeq: null,
        expected: 'reserved change sequence 0 already exists',
      },
      {
        name: 'gapped',
        rows: [[1, 'INSERT', null] as const, [3, 'INSERT', null] as const],
        legacySeq: null,
        expected: 'retained change history is not contiguous',
      },
      {
        name: 'future',
        rows: [[1, 'INSERT', 2] as const],
        legacySeq: null,
        expected: 'unsupported format 2',
      },
      {
        name: 'ahead',
        rows: [[1, 'INSERT', null] as const],
        legacySeq: 2,
        expected: 'durable sequence is ahead of retained history',
      },
      {
        name: 'negative',
        rows: [[-1, 'INSERT', null] as const],
        legacySeq: null,
        expected: 'negative change sequence',
      },
      {
        name: 'reversed-format-transition',
        rows: [[1, 'INSERT', 1] as const, [2, 'INSERT', null] as const],
        legacySeq: null,
        expected: 'legacy history follows versioned history',
      },
    ];

    for (const input of cases) {
      const { path } = await tempDatabase(`zero-sync-fence-invalid-${input.name}-`);
      const legacy = new Database(path, { create: true });
      try {
        legacy.run(`
          CREATE TABLE _changes (
            seq INTEGER PRIMARY KEY,
            tbl TEXT NOT NULL,
            op TEXT NOT NULL,
            row_id TEXT NOT NULL,
            data TEXT,
            previous_data TEXT,
            ts INTEGER NOT NULL,
            origin TEXT,
            format_version
          )
        `);
        const insert = legacy.prepare(`
          INSERT INTO _changes
            (seq, tbl, op, row_id, data, previous_data, ts, origin, format_version)
          VALUES (?, 'items', ?, ?, '{"id":"row"}', NULL, 1, NULL, ?)
        `);
        for (const [seq, op, format] of input.rows) {
          insert.run(seq, op, `row-${seq}`, format);
        }
        insert.finalize();
        if (input.legacySeq !== null) {
          legacy.run(`
            CREATE TABLE _change_sequence (
              singleton INTEGER PRIMARY KEY,
              seq INTEGER NOT NULL
            )
          `);
          legacy.prepare(
            'INSERT INTO _change_sequence (singleton, seq) VALUES (1, ?)',
          ).run(input.legacySeq);
        }
      } finally {
        legacy.close();
      }
      expect(() => createReactiveDB({ mode: path })).toThrow(input.expected);
    }
  });

  test('rejects malformed retained row payloads instead of coercing them', async () => {
    const cases = [
      { name: 'empty-json', op: 'INSERT', data: '', previous: null, expected: 'invalid data JSON' },
      { name: 'null-json', op: 'INSERT', data: 'null', previous: null, expected: 'data must be a JSON object' },
      { name: 'array-json', op: 'INSERT', data: '[]', previous: null, expected: 'data must be a JSON object' },
      { name: 'overflow-number', op: 'INSERT', data: '{"id":"row-1","n":1e400}', previous: null, expected: 'canonical JSON object' },
      { name: 'negative-zero', op: 'INSERT', data: '{"id":"row-1","n":-0}', previous: null, expected: 'canonical JSON object' },
      { name: 'delete-data', op: 'DELETE', data: '{}', previous: '{}', expected: 'DELETE row data must be null' },
      { name: 'update-no-previous', op: 'UPDATE', data: '{}', previous: null, expected: 'UPDATE requires previous_data' },
    ];

    for (const input of cases) {
      const { path } = await tempDatabase(`zero-sync-fence-payload-${input.name}-`);
      const raw = new Database(path, { create: true });
      try {
        raw.run(`
          CREATE TABLE _changes (
            seq INTEGER PRIMARY KEY,
            tbl TEXT NOT NULL,
            op TEXT NOT NULL,
            row_id TEXT NOT NULL,
            data TEXT,
            previous_data TEXT,
            ts INTEGER NOT NULL,
            origin TEXT,
            format_version
          )
        `);
        raw.prepare(`
          INSERT INTO _changes
            (seq, tbl, op, row_id, data, previous_data, ts, origin, format_version)
          VALUES (1, 'items', ?, 'row-1', ?, ?, 1, NULL, 1)
        `).run(input.op, input.data, input.previous);
      } finally {
        raw.close();
      }
      expect(() => createReactiveDB({ mode: path })).toThrow(input.expected);
    }
  });

  test('fails startup when a versioned fence trigger is missing or altered', async () => {
    const { path } = await tempDatabase('zero-sync-fence-trigger-tamper-');
    const reactive = createReactiveDB({ mode: path });
    reactive.dispose();

    const raw = new Database(path);
    try {
      raw.run('DROP TRIGGER _zero_sync_changes_insert_fence_v1');
      raw.run(`
        CREATE TRIGGER _zero_sync_changes_insert_fence_v1
        BEFORE INSERT ON _changes BEGIN SELECT 1; END
      `);
    } finally {
      raw.close();
    }

    expect(() => createReactiveDB({ mode: path })).toThrow('missing or altered');
  });

  test('detects behavior-changing trigger literal case tampering', async () => {
    const { path } = await tempDatabase('zero-sync-fence-trigger-literal-case-');
    const reactive = createReactiveDB({ mode: path });
    reactive.dispose();

    const raw = new Database(path);
    try {
      const trigger = raw.prepare(`
        SELECT sql FROM sqlite_schema
        WHERE type = 'trigger' AND name = '_zero_sync_changes_insert_fence_v1'
      `).get() as { sql: string };
      const altered = trigger.sql
        .replaceAll("'INSERT'", "'insert'")
        .replaceAll("'UPDATE'", "'update'")
        .replaceAll("'DELETE'", "'delete'");
      expect(altered).not.toBe(trigger.sql);
      raw.run('DROP TRIGGER _zero_sync_changes_insert_fence_v1');
      raw.run(altered);
    } finally {
      raw.close();
    }

    expect(() => createReactiveDB({ mode: path })).toThrow('missing or altered');
  });

  test('rejects preexisting format columns that can coerce or synthesize v1', async () => {
    for (const definition of [
      'format_version INTEGER',
      'format_version DEFAULT 1',
      'format_version NOT NULL DEFAULT 1',
    ]) {
      const { path } = await tempDatabase('zero-sync-fence-format-column-');
      const raw = new Database(path, { create: true });
      try {
        raw.run(`
          CREATE TABLE _changes (
            seq INTEGER PRIMARY KEY,
            tbl TEXT NOT NULL,
            op TEXT NOT NULL,
            row_id TEXT NOT NULL,
            data TEXT,
            previous_data TEXT,
            ts INTEGER NOT NULL,
            origin TEXT,
            ${definition}
          )
        `);
      } finally {
        raw.close();
      }
      expect(() => createReactiveDB({ mode: path }))
        .toThrow('format_version must be nullable without affinity/default');
    }
  });

  test('rejects a non-integer primary-key schema before installing the fence', async () => {
    const { path } = await tempDatabase('zero-sync-fence-text-sequence-');
    const raw = new Database(path, { create: true });
    try {
      raw.run(`
        CREATE TABLE _changes (
          seq TEXT PRIMARY KEY,
          tbl TEXT NOT NULL,
          op TEXT NOT NULL,
          row_id TEXT NOT NULL,
          data TEXT,
          previous_data TEXT,
          ts INTEGER NOT NULL,
          origin TEXT
        )
      `);
    } finally {
      raw.close();
    }

    expect(() => createReactiveDB({ mode: path }))
      .toThrow('_changes schema is incompatible');

    const verify = new Database(path);
    try {
      expect(verify.prepare(`
        SELECT name FROM sqlite_schema
        WHERE name = '_zero_sync_log_state'
      `).get()).toBeNull();
      expect(verify.prepare('SELECT COUNT(*) AS count FROM _changes').get())
        .toEqual({ count: 0 });
    } finally {
      verify.close();
    }
  });

  test('keeps every durable log operation in main when a temp table shadows its name', async () => {
    for (const timing of ['before', 'after'] as const) {
      const { path } = await tempDatabase(`zero-sync-fence-temp-shadow-${timing}-`);
      const raw = new Database(path, { create: true });
      const createShadow = () => raw.run(`
        CREATE TEMP TABLE _changes (
          seq TEXT PRIMARY KEY,
          tbl TEXT,
          op TEXT,
          row_id TEXT,
          data TEXT,
          previous_data TEXT,
          ts TEXT,
          origin TEXT,
          format_version TEXT
        )
      `);
      const createAppShadow = () => raw.run(
        'CREATE TEMP TABLE items (id TEXT PRIMARY KEY)',
      );
      if (timing === 'before') {
        createShadow();
        createAppShadow();
      }
      const reactive = createReactiveDB({ database: raw });
      try {
        reactive.defineTable('items', { id: 'text primary key' });
        if (timing === 'after') {
          createShadow();
          createAppShadow();
        }
        expect(reactive.insert('items', { id: timing }).seq).toBe(1);
        expect(raw.prepare('SELECT seq FROM main._changes ORDER BY seq').all())
          .toEqual([{ seq: 0 }, { seq: 1 }]);
        expect(raw.prepare('SELECT COUNT(*) AS count FROM temp._changes').get())
          .toEqual({ count: 0 });
        expect(raw.prepare('SELECT id FROM main.items').all())
          .toEqual([{ id: timing }]);
        expect(raw.prepare('SELECT COUNT(*) AS count FROM temp.items').get())
          .toEqual({ count: 0 });
      } finally {
        reactive.dispose();
        raw.close();
      }

      expect(() => openLegacyReactiveDB(path)).toThrow('ZERO_SYNC_LOG_DELETE_FORBIDDEN');
    }
  });

  test('validates the durable state again before seeding a poll cursor or snapshot', async () => {
    const { path } = await tempDatabase('zero-sync-fence-state-race-');
    const observer = createReactiveDB({ mode: path });
    try {
      const raw = observer.getRawDatabase();
      raw.run('DROP TRIGGER _zero_sync_log_state_update_fence_v1');
      raw.run(`
        UPDATE _zero_sync_log_state
        SET schema_version = 2, write_format = 2
        WHERE singleton = 1
      `);

      expect(() => observer.currentSeq).toThrow('unsupported or malformed log state');
      expect(() => observer.readAtCurrentSequence(() => 'unreachable'))
        .toThrow('unsupported or malformed log state');
      expect(() => observer.startExternalChangePolling({ intervalMs: 10 }))
        .toThrow('unsupported or malformed log state');
    } finally {
      observer.dispose();
    }
  });

  test('latches a running replica closed after a non-retryable log-state failure', async () => {
    const { path } = await tempDatabase('zero-sync-fence-runtime-invalid-');
    const writer = createReactiveDB({ mode: path, busyTimeout: 10_000 });
    const observer = createReactiveDB({ mode: path, busyTimeout: 10_000 });
    const invalid: unknown[] = [];
    const transient: unknown[] = [];
    const observed: number[] = [];
    try {
      writer.defineTable('items', { id: 'text primary key' });
      observer.defineTable('items', { id: 'text primary key' });
      observer.onChange((change) => observed.push(change.seq));
      observer.startExternalChangePolling({
        intervalMs: 10,
        onInvalid: (error) => invalid.push(error),
        onError: (error) => transient.push(error),
      });

      const raw = writer.getRawDatabase();
      raw.run('DROP TRIGGER _zero_sync_log_state_update_fence_v1');
      raw.run(`
        UPDATE _zero_sync_log_state
        SET schema_version = 2, write_format = 2
        WHERE singleton = 1
      `);

      await waitUntil(() => invalid.length === 1);
      await Bun.sleep(35);
      expect(invalid).toHaveLength(1);
      expect(String(invalid[0])).toContain('ZERO_SYNC_LOG_STATE_INVALID');
      expect(transient).toEqual([]);
      expect(observed).toEqual([]);

      // Even if an operator tampers the row back in-place, this process has
      // crossed an untrusted cursor boundary and cannot safely resume.
      raw.run(`
        UPDATE _zero_sync_log_state
        SET schema_version = 1, write_format = 1
        WHERE singleton = 1
      `);
      expect(() => observer.insert('items', { id: 'must-restart' }))
        .toThrow('runtime was invalidated; restart after repair');
      expect(observed).toEqual([]);
    } finally {
      observer.dispose();
      writer.dispose();
    }
  });

  test('treats durable cursor and prune-watermark regression as fatal', async () => {
    for (const regression of ['sequence', 'prune-watermark'] as const) {
      const { path } = await tempDatabase(`zero-sync-fence-${regression}-regression-`);
      const writer = createReactiveDB({
        mode: path,
        ringBufferDepth: 1,
        busyTimeout: 10_000,
      });
      const observer = createReactiveDB({
        mode: path,
        ringBufferDepth: 1,
        busyTimeout: 10_000,
      });
      const invalid: unknown[] = [];
      const gaps: unknown[] = [];
      const errors: unknown[] = [];
      try {
        writer.defineTable('items', { id: 'text primary key' });
        observer.defineTable('items', { id: 'text primary key' });
        writer.insert('items', { id: 'one' });
        if (regression === 'prune-watermark') {
          writer.insert('items', { id: 'two' });
          expect(writer.prepare(`
            SELECT seq, prune_through FROM _zero_sync_log_state WHERE singleton = 1
          `).get()).toEqual({ seq: 2, prune_through: 1 });
        }

        observer.startExternalChangePolling({
          intervalMs: 10,
          onGap: (gap) => { gaps.push(gap); },
          onInvalid: (error) => invalid.push(error),
          onError: (error) => errors.push(error),
        });

        const raw = writer.getRawDatabase();
        raw.run('DROP TRIGGER _zero_sync_log_state_update_fence_v1');
        if (regression === 'sequence') {
          raw.run(`
            UPDATE _zero_sync_log_state
            SET seq = 0, prune_through = 0
            WHERE singleton = 1
          `);
        } else {
          raw.run(`
            UPDATE _zero_sync_log_state
            SET prune_through = 0
            WHERE singleton = 1
          `);
        }

        await waitUntil(() => invalid.length === 1);
        expect(String(invalid[0])).toContain(
          regression === 'sequence'
            ? 'durable sequence regressed behind replica cursor'
            : 'durable prune watermark regressed',
        );
        expect(gaps).toEqual([]);
        expect(errors).toEqual([]);

        // Repairing the row in place cannot make a process that crossed this
        // trusted cursor boundary resume; restart is mandatory.
        raw.prepare(`
          UPDATE _zero_sync_log_state
          SET seq = ?, prune_through = ?
          WHERE singleton = 1
        `).run(
          regression === 'sequence' ? 1 : 2,
          regression === 'sequence' ? 0 : 1,
        );
        await Bun.sleep(35);
        expect(invalid).toHaveLength(1);
        expect(() => observer.currentSeq).toThrow(
          'runtime was invalidated; restart after repair',
        );
      } finally {
        observer.dispose();
        writer.dispose();
      }
    }
  });

  test('treats a missing durable state object as fatal rather than retryable', async () => {
    const { path } = await tempDatabase('zero-sync-fence-state-missing-');
    const writer = createReactiveDB({ mode: path, busyTimeout: 10_000 });
    const observer = createReactiveDB({ mode: path, busyTimeout: 10_000 });
    const invalid: unknown[] = [];
    const transient: unknown[] = [];
    try {
      observer.startExternalChangePolling({
        intervalMs: 10,
        onInvalid: (error) => invalid.push(error),
        onError: (error) => transient.push(error),
      });
      writer.getRawDatabase().run(
        'ALTER TABLE _zero_sync_log_state RENAME TO _zero_sync_log_state_missing',
      );

      await waitUntil(() => invalid.length === 1);
      await Bun.sleep(35);
      expect(invalid).toHaveLength(1);
      expect(String(invalid[0])).toContain('no such table');
      expect(transient).toEqual([]);
    } finally {
      observer.dispose();
      writer.dispose();
    }
  });

  test('latches closed when a replica history gap has no successful handler', async () => {
    for (const behavior of ['missing', 'throwing', 'async'] as const) {
      const { path } = await tempDatabase(`zero-sync-fence-unhandled-gap-${behavior}-`);
      const writer = createReactiveDB({
        mode: path,
        ringBufferDepth: 1,
        busyTimeout: 10_000,
      });
      const observer = createReactiveDB({
        mode: path,
        ringBufferDepth: 1,
        busyTimeout: 10_000,
      });
      const invalid: unknown[] = [];
      const errors: unknown[] = [];
      try {
        writer.defineTable('items', { id: 'text primary key' });
        observer.defineTable('items', { id: 'text primary key' });
        observer.startExternalChangePolling({
          intervalMs: 50,
          onGap: behavior === 'throwing'
            ? () => { throw new Error('policy reset failed'); }
            : behavior === 'async'
              ? (async () => {}) as () => void
              : undefined,
          onInvalid: (error) => invalid.push(error),
          onError: (error) => errors.push(error),
        });

        writer.insert('items', { id: 'one' });
        writer.insert('items', { id: 'two' });

        await waitUntil(() => invalid.length === 1);
        expect(String(invalid[0])).toContain(
          behavior === 'missing'
            ? 'replica history gap was not handled'
            : 'replica history gap handler failed',
        );
        const expectedErrors = behavior === 'throwing'
          ? ['Error: policy reset failed']
          : behavior === 'async'
            ? [
              'Error: ZERO_SYNC_LOG_STATE_INVALID: replica history gap handler must be synchronous',
            ]
            : [];
        expect(errors.map(String)).toEqual(expectedErrors);
        expect(() => observer.currentSeq).toThrow(
          'runtime was invalidated; restart after repair',
        );
      } finally {
        observer.dispose();
        writer.dispose();
      }
    }
  });

  test('emits no partial batch when a running reader encounters a future format', async () => {
    const { path } = await tempDatabase('zero-sync-fence-reader-format-');
    const writer = createReactiveDB({ mode: path, busyTimeout: 10_000 });
    const observer = createReactiveDB({ mode: path, busyTimeout: 10_000 });
    const observed: number[] = [];
    const errors: unknown[] = [];
    let gap: {
      kind: 'retention' | 'continuity' | 'format';
      afterSeq: number;
      oldestSeq: number;
      currentSeq: number;
    } | null = null;
    try {
      observer.onChange((change) => observed.push(change.seq));
      observer.startExternalChangePolling({
        intervalMs: 10,
        onError: (error) => errors.push(error),
        onGap: (value) => { gap = value; },
      });

      // Simulate disk/schema tampering or a future writer that bypassed the v1
      // startup contract. The v1 reader must reject before emitting the row.
      const raw = writer.getRawDatabase();
      raw.run('DROP TRIGGER _zero_sync_changes_insert_fence_v1');
      raw.transaction(() => {
        raw.run('UPDATE _zero_sync_log_state SET seq = seq + 1 WHERE singleton = 1');
        raw.run(`
          INSERT INTO _changes
            (seq, tbl, op, row_id, data, previous_data, ts, origin, format_version)
          VALUES (1, 'items', 'INSERT', 'valid', '{"id":"valid"}',
            NULL, 1, 'future-writer', 1)
        `);
        raw.run('UPDATE _zero_sync_log_state SET seq = seq + 1 WHERE singleton = 1');
        raw.run(`
          INSERT INTO _changes
            (seq, tbl, op, row_id, data, previous_data, ts, origin, format_version)
          VALUES (2, 'items', 'INSERT', 'future', '{"id":"future"}',
            NULL, 1, 'future-writer', 2)
        `);
      }).immediate();

      await waitUntil(() => gap !== null);
      expect(observed).toEqual([]);
      expect(errors).toHaveLength(1);
      expect(String(errors[0])).toContain('ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE');
      expect(gap as {
        kind: 'retention' | 'continuity' | 'format';
        afterSeq: number;
        oldestSeq: number;
        currentSeq: number;
      } | null).toEqual({ kind: 'format', afterSeq: 0, oldestSeq: 1, currentSeq: 2 });
      expect(observer.getChangesAfter(0)).toBeNull();
    } finally {
      observer.dispose();
      writer.dispose();
    }
  });

  test('rejects noncanonical numeric payloads during running poll and replay', async () => {
    for (const [name, payload] of [
      ['overflow', '{"id":"row-1","n":1e400}'],
      ['negative-zero', '{"id":"row-1","n":-0}'],
    ] as const) {
      const { path } = await tempDatabase(`zero-sync-fence-running-${name}-`);
      const writer = createReactiveDB({ mode: path, busyTimeout: 10_000 });
      const observer = createReactiveDB({ mode: path, busyTimeout: 10_000 });
      const observed: number[] = [];
      const errors: unknown[] = [];
      let gap: unknown = null;
      try {
        observer.onChange((change) => observed.push(change.seq));
        observer.startExternalChangePolling({
          intervalMs: 10,
          onError: (error) => errors.push(error),
          onGap: (value) => { gap = value; },
        });

        const raw = writer.getRawDatabase();
        raw.run('DROP TRIGGER _zero_sync_changes_insert_fence_v1');
        raw.transaction(() => {
          raw.run('UPDATE _zero_sync_log_state SET seq = seq + 1 WHERE singleton = 1');
          raw.prepare(`
            INSERT INTO _changes
              (seq, tbl, op, row_id, data, previous_data, ts, origin, format_version)
            VALUES (1, 'items', 'INSERT', 'row-1', ?, NULL, 1, 'tampered-writer', 1)
          `).run(payload);
        }).immediate();

        await waitUntil(() => gap !== null);
        expect(observed).toEqual([]);
        expect(errors.map(String).join('\n')).toContain('canonical JSON object');
        expect(gap).toEqual({
          kind: 'format',
          afterSeq: 0,
          oldestSeq: 1,
          currentSeq: 1,
        });
        expect(observer.getChangesAfter(0)).toBeNull();
      } finally {
        observer.dispose();
        writer.dispose();
      }
    }
  });

  test('refuses an unsupported durable schema/write format before readiness', async () => {
    const { path } = await tempDatabase('zero-sync-fence-future-state-');
    const reactive = createReactiveDB({ mode: path });
    reactive.dispose();

    const raw = new Database(path);
    try {
      raw.run('DROP TRIGGER _zero_sync_log_state_update_fence_v1');
      raw.run(`
        UPDATE _zero_sync_log_state
        SET schema_version = 2, write_format = 2
        WHERE singleton = 1
      `);
    } finally {
      raw.close();
    }

    expect(() => createReactiveDB({ mode: path }))
      .toThrow('unsupported or malformed log state');
  });

  test('rejects a REAL v1 marker at startup and while polling', async () => {
    const startup = await tempDatabase('zero-sync-fence-real-format-startup-');
    const seed = new Database(startup.path, { create: true });
    try {
      seed.run(`
        CREATE TABLE _changes (
          seq INTEGER PRIMARY KEY,
          tbl TEXT NOT NULL,
          op TEXT NOT NULL,
          row_id TEXT NOT NULL,
          data TEXT,
          previous_data TEXT,
          ts INTEGER NOT NULL,
          origin TEXT,
          format_version
        )
      `);
      seed.run(`
        INSERT INTO _changes
          (seq, tbl, op, row_id, data, previous_data, ts, origin, format_version)
        VALUES (1, 'items', 'INSERT', 'real', '{"id":"real"}',
          NULL, 1, NULL, CAST(1 AS REAL))
      `);
    } finally {
      seed.close();
    }
    expect(() => createReactiveDB({ mode: startup.path }))
      .toThrow('ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE');

    const running = await tempDatabase('zero-sync-fence-real-format-running-');
    const writer = createReactiveDB({ mode: running.path, busyTimeout: 10_000 });
    const observer = createReactiveDB({ mode: running.path, busyTimeout: 10_000 });
    const errors: unknown[] = [];
    let gap: unknown = null;
    try {
      observer.startExternalChangePolling({
        intervalMs: 10,
        onError: (error) => errors.push(error),
        onGap: (value) => { gap = value; },
      });
      const raw = writer.getRawDatabase();
      raw.run('DROP TRIGGER _zero_sync_changes_insert_fence_v1');
      raw.transaction(() => {
        raw.run('UPDATE _zero_sync_log_state SET seq = seq + 1 WHERE singleton = 1');
        raw.run(`
          INSERT INTO _changes
            (seq, tbl, op, row_id, data, previous_data, ts, origin, format_version)
          VALUES (1, 'items', 'INSERT', 'real', '{"id":"real"}',
            NULL, 1, NULL, CAST(1 AS REAL))
        `);
      }).immediate();

      await waitUntil(() => gap !== null);
      expect(errors.map(String).join('\n')).toContain('unsupported format 1');
      expect(gap).toEqual({
        kind: 'format',
        afterSeq: 0,
        oldestSeq: 1,
        currentSeq: 1,
      });
      expect(observer.getChangesAfter(0)).toBeNull();
    } finally {
      observer.dispose();
      writer.dispose();
    }
  });

  test('rejects noncanonical collation, primary-key, and index constraints', async () => {
    for (const fixture of [
      {
        suffix: 'nocase',
        seq: 'INTEGER PRIMARY KEY',
        op: 'TEXT COLLATE NOCASE NOT NULL',
        constraint: '',
      },
      {
        suffix: 'pk-desc',
        seq: 'INTEGER PRIMARY KEY DESC',
        op: 'TEXT NOT NULL',
        constraint: '',
      },
      {
        suffix: 'unique-ignore',
        seq: 'INTEGER PRIMARY KEY',
        op: 'TEXT NOT NULL',
        constraint: ', UNIQUE(tbl, row_id) ON CONFLICT IGNORE',
      },
    ]) {
      const { path } = await tempDatabase(`zero-sync-fence-schema-${fixture.suffix}-`);
      const raw = new Database(path, { create: true });
      try {
        raw.run(`
          CREATE TABLE _changes (
            seq ${fixture.seq},
            tbl TEXT NOT NULL,
            op ${fixture.op},
            row_id TEXT NOT NULL,
            data TEXT,
            previous_data TEXT,
            ts INTEGER NOT NULL,
            origin TEXT,
            format_version
            ${fixture.constraint}
          )
        `);
      } finally {
        raw.close();
      }

      expect(() => createReactiveDB({ mode: path }))
        .toThrow('_changes schema is incompatible');
    }
  });

  test('rejects extra owned triggers and rolls back a late ignored log insert', async () => {
    const { path } = await tempDatabase('zero-sync-fence-extra-trigger-');
    const created = createReactiveDB({ mode: path });
    created.dispose();
    const raw = new Database(path);
    try {
      raw.run(`
        CREATE TRIGGER extra_zero_log_trigger
        BEFORE INSERT ON _changes
        WHEN NEW.seq > 0
        BEGIN
          SELECT RAISE(IGNORE);
        END
      `);
    } finally {
      raw.close();
    }
    expect(() => createReactiveDB({ mode: path }))
      .toThrow('owned log trigger set is incompatible');

    const running = createReactiveDB({ mode: 'memory' });
    running.defineTable('items', { id: 'text primary key' });
    try {
      running.getRawDatabase().run(`
        CREATE TABLE log_trigger_side_effects (seq INTEGER PRIMARY KEY)
      `);
      running.getRawDatabase().run(`
        CREATE TRIGGER late_ignore_log_insert
        BEFORE INSERT ON _changes
        WHEN NEW.seq > 0
        BEGIN
          INSERT INTO log_trigger_side_effects (seq) VALUES (NEW.seq);
          SELECT RAISE(IGNORE);
        END
      `);
      expect(() => running.insert('items', { id: 'must-rollback' }))
        .toThrow('owned log trigger set is incompatible');
      expect(running.queryOne('items', 'must-rollback')).toBeNull();
      expect(running.currentSeq).toBe(0);
      expect(running.getChangesAfter(0)).toEqual([]);
      expect(running.prepare(
        'SELECT COUNT(*) AS count FROM log_trigger_side_effects',
      ).get()).toEqual({ count: 0 });
    } finally {
      running.dispose();
    }
  });

  test('rejects temporary triggers attached to owned main-schema tables', () => {
    const raw = new Database(':memory:');
    const established = createReactiveDB({ database: raw });
    established.dispose();
    try {
      raw.run(`
        CREATE TEMP TRIGGER temp_zero_log_trigger
        BEFORE INSERT ON main._changes
        BEGIN
          SELECT 1;
        END
      `);

      expect(() => createReactiveDB({ database: raw }))
        .toThrow('temporary owned log trigger is incompatible');
    } finally {
      raw.close();
    }
  });

  test('validates cursor and retention configuration boundaries', () => {
    for (const ringBufferDepth of [0, -1, 1.5, Number.NaN]) {
      expect(() => createReactiveDB({ mode: 'memory', ringBufferDepth }))
        .toThrow('positive safe integer');
    }

    const reactive = createReactiveDB({ mode: 'memory', ringBufferDepth: 1 });
    reactive.defineTable('items', { id: 'text primary key' });
    try {
      for (const intervalMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() => reactive.startExternalChangePolling({ intervalMs }))
          .toThrow('positive safe integer');
      }
      reactive.startExternalChangePolling({ intervalMs: 1 })();
      expect(() => reactive.getChangesAfter(-1)).toThrow('non-negative safe integer');
      expect(() => reactive.getChangesAfter(0.5)).toThrow('non-negative safe integer');
      reactive.insert('items', { id: 'one' });
      reactive.insert('items', { id: 'two' });
      expect(reactive.getChangesAfter(0)).toBeNull();
      expect(reactive.getChangesAfter(1)?.map((change) => change.seq)).toEqual([2]);
      expect(reactive.prepare(
        'SELECT COUNT(*) AS count FROM _changes WHERE seq > 0',
      ).get()).toEqual({ count: 1 });
    } finally {
      reactive.dispose();
    }
  });
});

async function tempDatabase(prefix: string): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return { directory, path: join(directory, 'app.sqlite') };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition');
    await Bun.sleep(10);
  }
}
