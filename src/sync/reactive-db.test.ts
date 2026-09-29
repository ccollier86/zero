import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureObservability, MemoryEventStore, OBS_CODES } from '../observability';
import { createPlatformSQLiteService } from '../persistence';
import { createReactiveDB, ReactiveDB } from './reactive-db';
import type { Change, ChangeDeliveryMetadata } from './types';

let db: ReactiveDB;
let observabilityEvents: MemoryEventStore;

beforeEach(() => {
  observabilityEvents = new MemoryEventStore();
  configureObservability({ console: false, store: observabilityEvents });
  db = createReactiveDB({ mode: 'memory' });
  db.defineTable('todos', {
    id: 'text primary key',
    title: 'text not null',
    done: 'integer default 0',
  });
});

afterEach(() => {
  db.dispose();
});

function defineMembershipTable(): void {
  db.defineTable('memberships', {
    membership_id: 'text primary key',
    team_id: 'text not null',
    user_id: 'text not null',
    role: 'text',
    _identity: ['team_id', 'user_id'],
  });
}

function defineForeignKeyFenceTables(database: ReactiveDB): void {
  database.defineTable('parents', {
    id: 'text primary key',
    name: 'text not null',
  });
  database.defineTable('children', {
    id: 'text primary key',
    parent_id: 'text references parents(id)',
  });
}

function rebuildChildrenWithDeleteAction(
  database: ReactiveDB,
  action: 'CASCADE' | 'NO ACTION',
): void {
  const current = database.prepare(`
    SELECT sql FROM main.sqlite_schema
    WHERE type = 'table' AND name = 'children'
  `).get() as { sql: string };
  const baseDefinition = current.sql.replace(/\s+ON\s+DELETE\s+CASCADE/iu, '');
  const nextDefinition = action === 'CASCADE'
    ? baseDefinition.replace(
      /references\s+parents\s*\(\s*id\s*\)/iu,
      (reference) => `${reference} ON DELETE CASCADE`,
    )
    : baseDefinition;
  database.exec('ALTER TABLE children RENAME TO children_previous');
  database.exec(nextDefinition);
  database.exec('INSERT INTO children SELECT * FROM children_previous');
  database.exec('DROP TABLE children_previous');
}

// ─── defineTable ──────────────────────────────────────────────────────────

describe('defineTable', () => {
  test('creates table and prepared statements', () => {
    expect(db.hasTable('todos')).toBe(true);
    expect(db.getTableNames()).toContain('todos');
  });

  test('is idempotent — calling twice does not throw', () => {
    expect(() => {
      db.defineTable('todos', {
        id: 'text primary key',
        title: 'text not null',
        done: 'integer default 0',
      });
    }).not.toThrow();
  });

  test('throws if schema has no columns', () => {
    expect(() => db.defineTable('empty', {})).toThrow('at least one column');
  });

  test('throws if schema has no primary key', () => {
    expect(() =>
      db.defineTable('bad', { name: 'text not null', age: 'integer' })
    ).toThrow('primary key');
  });

  test('allows _ prefix tables', () => {
    expect(() => {
      db.defineTable('_internal', {
        key: 'text primary key',
        value: 'text',
      });
    }).not.toThrow();
    expect(db.hasTable('_internal')).toBe(true);
  });

  test('supports multiple tables', () => {
    db.defineTable('users', {
      id: 'text primary key',
      name: 'text not null',
      email: 'text',
    });
    expect(db.hasTable('todos')).toBe(true);
    expect(db.hasTable('users')).toBe(true);
    expect(db.getTableNames()).toEqual(expect.arrayContaining(['todos', 'users']));
  });

  test('rejects invalid natural identity declarations', () => {
    expect(() => {
      db.defineTable('bad_identity_pk', {
        id: 'text primary key',
        team_id: 'text',
        _identity: ['id'],
      });
    }).toThrow("identity field 'id' cannot be the primary key");

    expect(() => {
      db.defineTable('bad_identity_column', {
        id: 'text primary key',
        team_id: 'text',
        _identity: ['missing'],
      });
    }).toThrow("identity field 'missing' is not a table column");
  });

  test('rejects foreign-key actions that would mutate a tracked row invisibly', () => {
    db.defineTable('parents', { id: 'text primary key' });

    for (const action of ['cascade', 'set null', 'set default'] as const) {
      const table = `children_${action.replace(' ', '_')}`;
      expect(() => db.defineTable(table, {
        id: 'text primary key',
        parent_id: `text references parents(id) on delete ${action}`,
      })).toThrow('foreign-key actions are not observable');
      expect(db.prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?",
      ).get(table)).toBeNull();
    }

    expect(() => db.defineTable('restricted_children', {
      id: 'text primary key',
      parent_id: 'text references parents(id) on delete restrict on update no action',
    })).not.toThrow();

    expect(() => db.transaction(() => db.defineTable('nested_definition', {
      id: 'text primary key',
    }))).toThrow('cannot run inside a ReactiveDB transaction');
    expect(db.hasTable('nested_definition')).toBe(false);
  });
});

// ─── Natural Identity ─────────────────────────────────────────────────────

describe('natural identity', () => {
  test('generates deterministic primary keys for inserts missing the sync id', () => {
    defineMembershipTable();

    const change = db.insert('memberships', {
      team_id: 'team-1',
      user_id: 'user-1',
      role: 'admin',
    });
    const id = db.identityKey('memberships', {
      team_id: 'team-1',
      user_id: 'user-1',
    });

    expect(change.rowId).toBe(id);
    expect(change.row).toEqual({
      membership_id: id,
      team_id: 'team-1',
      user_id: 'user-1',
      role: 'admin',
    });
    expect(db.queryByIdentity('memberships', {
      team_id: 'team-1',
      user_id: 'user-1',
    })).toEqual(change.row);
  });

  test('enforces unique natural identity values', () => {
    defineMembershipTable();
    db.insert('memberships', {
      membership_id: 'custom-1',
      team_id: 'team-1',
      user_id: 'user-1',
      role: 'member',
    });

    expect(() => db.insert('memberships', {
      membership_id: 'custom-2',
      team_id: 'team-1',
      user_id: 'user-1',
      role: 'admin',
    })).toThrow();
  });

  test('upserts by natural identity while preserving an existing sync id', () => {
    defineMembershipTable();
    db.insert('memberships', {
      membership_id: 'legacy-id',
      team_id: 'team-1',
      user_id: 'user-1',
      role: 'member',
    });

    const change = db.upsertByIdentity('memberships', {
      team_id: 'team-1',
      user_id: 'user-1',
      role: 'admin',
    });

    expect(change.op).toBe('UPDATE');
    expect(change.rowId).toBe('legacy-id');
    expect(change.row).toEqual({
      membership_id: 'legacy-id',
      team_id: 'team-1',
      user_id: 'user-1',
      role: 'admin',
    });
  });

  test('updates and deletes by natural identity', () => {
    defineMembershipTable();
    db.insert('memberships', {
      team_id: 'team-1',
      user_id: 'user-1',
      role: 'member',
    });

    const update = db.updateByIdentity('memberships', {
      team_id: 'team-1',
      user_id: 'user-1',
    }, {
      role: 'owner',
    });
    expect(update?.row?.role).toBe('owner');

    const deletion = db.deleteByIdentity('memberships', {
      team_id: 'team-1',
      user_id: 'user-1',
    });
    expect(deletion?.op).toBe('DELETE');
    expect(db.queryByIdentity('memberships', {
      team_id: 'team-1',
      user_id: 'user-1',
    })).toBeNull();
  });

  test('rejects identity field changes through update paths', () => {
    defineMembershipTable();
    const change = db.insert('memberships', {
      team_id: 'team-1',
      user_id: 'user-1',
      role: 'member',
    });

    expect(() => db.update('memberships', change.rowId, {
      user_id: 'user-2',
    })).toThrow("identity field 'user_id' is immutable");

    expect(() => db.insert('memberships', {
      membership_id: change.rowId,
      team_id: 'team-2',
      user_id: 'user-1',
      role: 'member',
    })).toThrow("identity field 'team_id' is immutable");
  });
});

// ─── insert ───────────────────────────────────────────────────────────────

describe('insert', () => {
  test('inserts a new row and returns Change with op INSERT', () => {
    const change = db.insert('todos', { id: '1', title: 'Buy milk', done: 0 });

    expect(change.table).toBe('todos');
    expect(change.op).toBe('INSERT');
    expect(change.rowId).toBe('1');
    expect(change.row).toEqual({ id: '1', title: 'Buy milk', done: 0 });
    expect(change.seq).toBe(1);
    expect(change.ts).toBeGreaterThan(0);
  });

  test('row is readable after insert', () => {
    db.insert('todos', { id: '1', title: 'Buy milk', done: 0 });
    const row = db.queryOne('todos', '1');
    expect(row).toEqual({ id: '1', title: 'Buy milk', done: 0 });
  });

  test('primary-key upsert emits UPDATE without replacing another unique row', () => {
    db.insert('todos', { id: '1', title: 'Buy milk', done: 0 });
    const change = db.insert('todos', { id: '1', title: 'Buy oats', done: 0 });

    expect(change.op).toBe('UPDATE');
    expect(change.row).toEqual({ id: '1', title: 'Buy oats', done: 0 });
  });

  test('duplicate primary-key upsert retains replacement-style defaults', () => {
    db.insert('todos', { id: '1', title: 'Before', done: 1 });

    const change = db.insert('todos', { id: '1', title: 'After' });

    expect(change.op).toBe('UPDATE');
    expect(change.row).toEqual({ id: '1', title: 'After', done: 0 });
  });

  test('a different UNIQUE row cannot be silently replaced', () => {
    db.defineTable('accounts', {
      id: 'text primary key',
      email: 'text unique not null',
    });
    db.insert('accounts', { id: 'first', email: 'same@example.test' });

    expect(() => db.insert('accounts', {
      id: 'second',
      email: 'same@example.test',
    })).toThrow('UNIQUE constraint failed');
    expect(db.query('accounts')).toEqual([
      { id: 'first', email: 'same@example.test' },
    ]);
    expect(db.currentSeq).toBe(1);
  });

  test('an ignored existing-row upsert cannot emit a false UPDATE', () => {
    db.insert('todos', { id: 'ignored-upsert', title: 'Before', done: 0 });
    db.exec('CREATE TABLE trigger_effects (value TEXT)');
    db.exec(`
      CREATE TRIGGER ignore_existing_todo_upsert
      BEFORE INSERT ON todos
      WHEN NEW.id = 'ignored-upsert'
      BEGIN
        INSERT INTO trigger_effects (value) VALUES ('must-roll-back');
        SELECT RAISE(IGNORE);
      END
    `);

    expect(() => db.insert('todos', {
      id: 'ignored-upsert', title: 'After', done: 1,
    })).toThrow('target write was suppressed');
    expect(db.queryOne('todos', 'ignored-upsert')).toEqual({
      id: 'ignored-upsert', title: 'Before', done: 0,
    });
    expect(db.prepare('SELECT * FROM trigger_effects').all()).toEqual([]);
    expect(db.currentSeq).toBe(1);
  });

  test('statement-level ABORT overrides schema REPLACE and IGNORE policies', () => {
    for (const policy of ['replace', 'ignore'] as const) {
      const table = `accounts_${policy}`;
      db.defineTable(table, {
        id: 'text primary key',
        email: `text unique on conflict ${policy}`,
      });
      db.insert(table, { id: 'first', email: 'first@example.test' });
      db.insert(table, { id: 'second', email: 'second@example.test' });
      const before = db.currentSeq;

      expect(() => db.update(table, 'second', {
        email: 'first@example.test',
      })).toThrow('UNIQUE constraint failed');
      expect(() => db.createStrict(table, {
        id: 'third',
        email: 'first@example.test',
      })).toThrow('UNIQUE constraint failed');
      expect(db.query(table)).toEqual([
        { id: 'first', email: 'first@example.test' },
        { id: 'second', email: 'second@example.test' },
      ]);
      expect(db.currentSeq).toBe(before);
    }
  });

  test('emits canonical persisted primary-key spellings and affinities', () => {
    db.defineTable('case_keys', {
      id: 'text primary key collate nocase',
      value: 'text',
    });
    const inserted = db.insert('case_keys', { id: 'Alpha', value: 'one' });
    const upserted = db.insert('case_keys', { id: 'alpha', value: 'two' });
    const updated = db.update('case_keys', 'ALPHA', { value: 'three' });
    const deleted = db.delete('case_keys', 'aLpHa');
    expect([inserted.rowId, upserted.rowId, updated?.rowId, deleted?.rowId])
      .toEqual(['Alpha', 'Alpha', 'Alpha', 'Alpha']);

    db.defineTable('integer_keys', {
      id: 'integer primary key',
      value: 'text',
    });
    const integerInsert = db.insert('integer_keys', { id: '01', value: 'one' });
    const integerUpdate = db.update('integer_keys', '001', { value: 'two' });
    const integerDelete = db.delete('integer_keys', '0001');
    expect([integerInsert.rowId, integerUpdate?.rowId, integerDelete?.rowId])
      .toEqual(['1', '1', '1']);

    db.defineTable('case_natural_keys', {
      id: 'text primary key collate nocase',
      natural_key: 'text not null',
      value: 'text',
      _identity: ['natural_key'],
    });
    db.insert('case_natural_keys', {
      id: 'Alpha', natural_key: 'same', value: 'one',
    });
    expect(db.insert('case_natural_keys', {
      id: 'alpha', natural_key: 'same', value: 'two',
    }).rowId).toBe('Alpha');

    db.defineTable('integer_natural_keys', {
      id: 'integer primary key',
      natural_key: 'text not null',
      value: 'text',
      _identity: ['natural_key'],
    });
    db.insert('integer_natural_keys', {
      id: 1, natural_key: 'same', value: 'one',
    });
    expect(db.insert('integer_natural_keys', {
      id: '001', natural_key: 'same', value: 'two',
    }).rowId).toBe('1');
  });

  test('increments seq monotonically', () => {
    const c1 = db.insert('todos', { id: '1', title: 'First', done: 0 });
    const c2 = db.insert('todos', { id: '2', title: 'Second', done: 0 });
    const c3 = db.insert('todos', { id: '3', title: 'Third', done: 0 });

    expect(c1.seq).toBe(1);
    expect(c2.seq).toBe(2);
    expect(c3.seq).toBe(3);
    expect(db.currentSeq).toBe(3);
  });

  test('applies SQLite defaults for missing columns', () => {
    const change = db.insert('todos', { id: '1', title: 'Test' });
    expect(change.row!.done).toBe(0);
  });

  test('throws on undefined table', () => {
    expect(() => db.insert('nonexistent', { id: '1' })).toThrow('not defined');
  });

  test('canonical create/get/list aliases preserve insert and query semantics', () => {
    const change = db.create('todos', { id: '1', title: 'Alias', done: 0 });

    expect(change.op).toBe('INSERT');
    expect(db.get('todos', '1')).toEqual({ id: '1', title: 'Alias', done: 0 });
    expect(db.list('todos')).toEqual([{ id: '1', title: 'Alias', done: 0 }]);
  });
});

// ─── update ───────────────────────────────────────────────────────────────

describe('update', () => {
  test('merges partial data into existing row', () => {
    db.insert('todos', { id: '1', title: 'Buy milk', done: 0 });
    const change = db.update('todos', '1', { done: 1 });

    expect(change).not.toBeNull();
    expect(change!.op).toBe('UPDATE');
    expect(change!.row).toEqual({ id: '1', title: 'Buy milk', done: 1 });
  });

  test('returns null for non-existent row', () => {
    const change = db.update('todos', 'nonexistent', { done: 1 });
    expect(change).toBeNull();
  });

  test('preserves unchanged fields', () => {
    db.insert('todos', { id: '1', title: 'Buy milk', done: 0 });
    db.update('todos', '1', { title: 'Buy oats' });

    const row = db.queryOne('todos', '1');
    expect(row).toEqual({ id: '1', title: 'Buy oats', done: 0 });
  });

  test('does not change primary key even if provided in partial', () => {
    db.insert('todos', { id: '1', title: 'Buy milk', done: 0 });
    db.update('todos', '1', { id: '999', title: 'Hacked' });

    expect(db.queryOne('todos', '1')).toEqual({ id: '1', title: 'Hacked', done: 0 });
    expect(db.queryOne('todos', '999')).toBeNull();
  });

  test('increments seq and records in ring buffer', () => {
    db.insert('todos', { id: '1', title: 'Buy milk', done: 0 }); // seq 1
    const change = db.update('todos', '1', { done: 1 }); // seq 2

    expect(change!.seq).toBe(2);
    const changes = db.getChangesAfter(1);
    expect(changes).toHaveLength(1);
    expect(changes![0].op).toBe('UPDATE');
  });

  test('optimistic updates reject case-only and storage-class-stale snapshots', () => {
    db.defineTable('exact_cas_updates', {
      id: 'text primary key',
      label: 'text collate nocase not null',
      affinity_value: 'numeric',
      note: 'text',
    });
    db.insert('exact_cas_updates', {
      id: 'case', label: 'Alpha', affinity_value: 1, note: 'Before',
    });
    const staleCase = db.queryOne('exact_cas_updates', 'case')!;
    db.update('exact_cas_updates', 'case', { label: 'alpha' });
    db.insert('exact_cas_updates', {
      id: 'affinity', label: 'Stable', affinity_value: 1, note: 'Before',
    });
    const staleAffinity = {
      ...db.queryOne('exact_cas_updates', 'affinity')!,
      affinity_value: '1',
    };
    const before = db.getChangesAfter(0);
    const observed: Change[] = [];
    db.onChange((change) => observed.push(change));

    expect(() => db.updateIfCurrent(
      'exact_cas_updates',
      'case',
      { note: 'Must not commit' },
      staleCase,
    )).toThrow('row changed since authorization');
    expect(() => db.updateIfCurrent(
      'exact_cas_updates',
      'affinity',
      { note: 'Must not commit' },
      staleAffinity,
    )).toThrow('row changed since authorization');

    expect(db.queryOne('exact_cas_updates', 'case')).toMatchObject({
      label: 'alpha', note: 'Before',
    });
    expect(db.queryOne('exact_cas_updates', 'affinity')).toMatchObject({
      affinity_value: 1, note: 'Before',
    });
    expect(db.getChangesAfter(0)).toEqual(before);
    expect(observed).toEqual([]);
  });

  test('scoped updates require exact scope and expected-row equality', () => {
    db.defineTable('exact_scoped_updates', {
      id: 'text primary key',
      tenant_id: 'text collate nocase not null',
      label: 'text collate nocase not null',
      affinity_value: 'numeric',
      note: 'text',
    });
    db.insert('exact_scoped_updates', {
      id: 'case', tenant_id: 'TenantA', label: 'Alpha', affinity_value: 1, note: 'Before',
    });
    const staleCase = db.queryOne('exact_scoped_updates', 'case')!;
    db.update('exact_scoped_updates', 'case', { label: 'alpha' });
    db.insert('exact_scoped_updates', {
      id: 'affinity', tenant_id: 'TenantA', label: 'Stable', affinity_value: 1, note: 'Before',
    });
    const staleAffinity = {
      ...db.queryOne('exact_scoped_updates', 'affinity')!,
      affinity_value: '1',
    };
    const before = db.getChangesAfter(0);
    const observed: Change[] = [];
    db.onChange((change) => observed.push(change));

    expect(db.updateScoped(
      'exact_scoped_updates',
      'case',
      { note: 'Wrong scope' },
      { field: 'tenant_id', value: 'tenanta' },
    )).toBeNull();
    expect(() => db.updateScoped(
      'exact_scoped_updates',
      'case',
      { note: 'Stale case' },
      { field: 'tenant_id', value: 'TenantA' },
      staleCase,
    )).toThrow('row changed since authorization');
    expect(() => db.updateScoped(
      'exact_scoped_updates',
      'affinity',
      { note: 'Stale type' },
      { field: 'tenant_id', value: 'TenantA' },
      staleAffinity,
    )).toThrow('row changed since authorization');

    expect(db.queryOne('exact_scoped_updates', 'case')).toMatchObject({
      tenant_id: 'TenantA', label: 'alpha', note: 'Before',
    });
    expect(db.queryOne('exact_scoped_updates', 'affinity')).toMatchObject({
      affinity_value: 1, note: 'Before',
    });
    expect(db.getChangesAfter(0)).toEqual(before);
    expect(observed).toEqual([]);
  });

  test('ignored updates cannot hide behind trigger side effects', () => {
    db.defineTable('scoped_todos', {
      id: 'text primary key',
      tenant_id: 'text not null',
      title: 'text not null',
    });
    db.insert('todos', { id: 'plain', title: 'Before', done: 0 });
    db.insert('todos', { id: 'conditional', title: 'Before', done: 0 });
    db.insert('scoped_todos', {
      id: 'scoped', tenant_id: 'tenant-1', title: 'Before',
    });
    db.exec('CREATE TABLE update_effects (value TEXT)');
    db.exec(`
      CREATE TRIGGER ignore_todo_updates
      BEFORE UPDATE ON todos
      BEGIN
        INSERT INTO update_effects (value) VALUES (NEW.id);
        SELECT RAISE(IGNORE);
      END
    `);
    db.exec(`
      CREATE TRIGGER ignore_scoped_todo_updates
      BEFORE UPDATE ON scoped_todos
      BEGIN
        INSERT INTO update_effects (value) VALUES (NEW.id);
        SELECT RAISE(IGNORE);
      END
    `);
    const before = db.currentSeq;

    expect(() => db.update('todos', 'plain', { title: 'After' }))
      .toThrow('target write was suppressed');
    expect(() => db.updateIfCurrent('todos', 'conditional', { title: 'After' }, {
      id: 'conditional', title: 'Before', done: 0,
    })).toThrow('row changed since authorization');
    expect(() => db.updateScoped('scoped_todos', 'scoped', { title: 'After' }, {
      field: 'tenant_id', value: 'tenant-1',
    })).toThrow('row changed since authorization');

    expect(db.queryOne('todos', 'plain')?.title).toBe('Before');
    expect(db.queryOne('todos', 'conditional')?.title).toBe('Before');
    expect(db.queryOne('scoped_todos', 'scoped')?.title).toBe('Before');
    expect(db.prepare('SELECT * FROM update_effects').all()).toEqual([]);
    expect(db.currentSeq).toBe(before);
  });
});

// ─── delete ───────────────────────────────────────────────────────────────

describe('delete', () => {
  test('removes existing row and returns Change with op DELETE', () => {
    db.insert('todos', { id: '1', title: 'Buy milk', done: 0 });
    const change = db.delete('todos', '1');

    expect(change).not.toBeNull();
    expect(change!.op).toBe('DELETE');
    expect(change!.rowId).toBe('1');
    expect(change!.row).toBeNull();
  });

  test('row is gone after delete', () => {
    db.insert('todos', { id: '1', title: 'Buy milk', done: 0 });
    db.delete('todos', '1');

    expect(db.queryOne('todos', '1')).toBeNull();
  });

  test('returns null for non-existent row', () => {
    const change = db.delete('todos', 'nonexistent');
    expect(change).toBeNull();
  });

  test('optimistic and scoped deletes reject broadened equality', () => {
    db.defineTable('exact_cas_deletes', {
      id: 'text primary key',
      tenant_id: 'text collate nocase not null',
      label: 'text collate nocase not null',
      affinity_value: 'numeric',
    });
    db.insert('exact_cas_deletes', {
      id: 'plain-case', tenant_id: 'TenantA', label: 'Alpha', affinity_value: 1,
    });
    const plainCase = db.queryOne('exact_cas_deletes', 'plain-case')!;
    db.update('exact_cas_deletes', 'plain-case', { label: 'alpha' });
    db.insert('exact_cas_deletes', {
      id: 'scoped-case', tenant_id: 'TenantA', label: 'Alpha', affinity_value: 1,
    });
    const scopedCase = db.queryOne('exact_cas_deletes', 'scoped-case')!;
    db.update('exact_cas_deletes', 'scoped-case', { label: 'alpha' });
    db.insert('exact_cas_deletes', {
      id: 'scoped-affinity', tenant_id: 'TenantA', label: 'Stable', affinity_value: 1,
    });
    const scopedAffinity = {
      ...db.queryOne('exact_cas_deletes', 'scoped-affinity')!,
      affinity_value: '1',
    };
    const before = db.getChangesAfter(0);
    const observed: Change[] = [];
    db.onChange((change) => observed.push(change));

    expect(() => db.deleteIfCurrent(
      'exact_cas_deletes', 'plain-case', plainCase,
    )).toThrow('row changed since authorization');
    expect(db.deleteScoped(
      'exact_cas_deletes',
      'scoped-case',
      { field: 'tenant_id', value: 'tenanta' },
    )).toBeNull();
    expect(() => db.deleteScoped(
      'exact_cas_deletes',
      'scoped-case',
      { field: 'tenant_id', value: 'TenantA' },
      scopedCase,
    )).toThrow('row changed since authorization');
    expect(() => db.deleteScoped(
      'exact_cas_deletes',
      'scoped-affinity',
      { field: 'tenant_id', value: 'TenantA' },
      scopedAffinity,
    )).toThrow('row changed since authorization');

    expect(db.query('exact_cas_deletes')).toHaveLength(3);
    expect(db.getChangesAfter(0)).toEqual(before);
    expect(observed).toEqual([]);
  });

  test('rolls back when application triggers suppress or undo target writes', () => {
    db.exec(`
      CREATE TRIGGER ignore_todo_insert
      BEFORE INSERT ON todos
      WHEN NEW.id = 'ignored-insert'
      BEGIN
        SELECT RAISE(IGNORE);
      END
    `);
    expect(() => db.insert('todos', {
      id: 'ignored-insert', title: 'Missing', done: 0,
    })).toThrow('target write was suppressed');
    expect(db.currentSeq).toBe(0);

    db.insert('todos', { id: 'ignored-delete', title: 'Keep', done: 0 });
    db.exec(`
      CREATE TRIGGER ignore_todo_delete
      BEFORE DELETE ON todos
      WHEN OLD.id = 'ignored-delete'
      BEGIN
        UPDATE todos SET id = 'moved-delete' WHERE id = OLD.id;
        SELECT RAISE(IGNORE);
      END
    `);
    expect(() => db.delete('todos', 'ignored-delete')).toThrow('target write was suppressed');
    expect(db.queryOne('todos', 'ignored-delete')).toEqual({
      id: 'ignored-delete', title: 'Keep', done: 0,
    });
    expect(db.queryOne('todos', 'moved-delete')).toBeNull();
    expect(db.currentSeq).toBe(1);

    db.insert('todos', { id: 'deleted-after-update', title: 'Before', done: 0 });
    db.exec(`
      CREATE TRIGGER delete_todo_after_update
      AFTER UPDATE ON todos
      WHEN NEW.id = 'deleted-after-update'
      BEGIN
        DELETE FROM todos WHERE id = NEW.id;
      END
    `);
    expect(() => db.updateIfCurrent('todos', 'deleted-after-update', {
      title: 'After',
    }, {
      id: 'deleted-after-update', title: 'Before', done: 0,
    })).toThrow('persisted row is missing');
    expect(db.queryOne('todos', 'deleted-after-update')).toEqual({
      id: 'deleted-after-update', title: 'Before', done: 0,
    });
    expect(db.currentSeq).toBe(2);

    db.insert('todos', { id: 'recreated-delete', title: 'Before', done: 0 });
    db.exec(`
      CREATE TRIGGER recreate_todo_after_delete
      AFTER DELETE ON todos
      WHEN OLD.id = 'recreated-delete'
      BEGIN
        INSERT INTO todos (id, title, done) VALUES (OLD.id, OLD.title, OLD.done);
      END
    `);
    expect(() => db.deleteIfCurrent('todos', 'recreated-delete', {
      id: 'recreated-delete', title: 'Before', done: 0,
    })).toThrow('deleted row was recreated');
    expect(db.queryOne('todos', 'recreated-delete')).toEqual({
      id: 'recreated-delete', title: 'Before', done: 0,
    });
    expect(db.currentSeq).toBe(3);
  });
});

// ─── query / queryOne ─────────────────────────────────────────────────────

describe('query', () => {
  test('returns empty array for empty table', () => {
    expect(db.query('todos')).toEqual([]);
  });

  test('returns all rows', () => {
    db.insert('todos', { id: '1', title: 'First', done: 0 });
    db.insert('todos', { id: '2', title: 'Second', done: 1 });

    const rows = db.query('todos');
    expect(rows).toHaveLength(2);
  });

  test('queryOne returns null for missing row', () => {
    expect(db.queryOne('todos', 'missing')).toBeNull();
  });

  test('queryOne returns the row object', () => {
    db.insert('todos', { id: '1', title: 'Buy milk', done: 0 });
    expect(db.queryOne('todos', '1')).toEqual({ id: '1', title: 'Buy milk', done: 0 });
  });

  test('scoped reads reject NOCASE and affinity-coerced matches', () => {
    db.defineTable('exact_scoped_reads', {
      id: 'text primary key',
      tenant_id: 'text collate nocase not null',
      value: 'text',
    });
    db.insert('exact_scoped_reads', {
      id: 'case', tenant_id: 'TenantA', value: 'Case',
    });
    db.insert('exact_scoped_reads', {
      id: 'type', tenant_id: '1', value: 'Type',
    });

    expect(db.getScoped(
      'exact_scoped_reads', 'case', { field: 'tenant_id', value: 'tenanta' },
    )).toBeNull();
    expect(db.getScoped(
      'exact_scoped_reads', 'type', { field: 'tenant_id', value: 1 },
    )).toBeNull();
    expect(db.getScoped(
      'exact_scoped_reads', 'case', { field: 'tenant_id', value: 'TenantA' },
    )).toEqual({ id: 'case', tenant_id: 'TenantA', value: 'Case' });
  });
});

// ─── onChange ─────────────────────────────────────────────────────────────

describe('onChange', () => {
  test('listener fires on insert', () => {
    const changes: Change[] = [];
    db.onChange((c) => changes.push(c));

    db.insert('todos', { id: '1', title: 'Test', done: 0 });

    expect(changes).toHaveLength(1);
    expect(changes[0].op).toBe('INSERT');
    expect(changes[0].table).toBe('todos');
  });

  test('listener fires on update', () => {
    db.insert('todos', { id: '1', title: 'Test', done: 0 });

    const changes: Change[] = [];
    db.onChange((c) => changes.push(c));

    db.update('todos', '1', { done: 1 });

    expect(changes).toHaveLength(1);
    expect(changes[0].op).toBe('UPDATE');
  });

  test('listener fires on delete', () => {
    db.insert('todos', { id: '1', title: 'Test', done: 0 });

    const changes: Change[] = [];
    db.onChange((c) => changes.push(c));

    db.delete('todos', '1');

    expect(changes).toHaveLength(1);
    expect(changes[0].op).toBe('DELETE');
  });

  test('does NOT fire for no-op update (nonexistent row)', () => {
    const changes: Change[] = [];
    db.onChange((c) => changes.push(c));

    db.update('todos', 'missing', { done: 1 });

    expect(changes).toHaveLength(0);
  });

  test('does NOT fire for no-op delete (nonexistent row)', () => {
    const changes: Change[] = [];
    db.onChange((c) => changes.push(c));

    db.delete('todos', 'missing');

    expect(changes).toHaveLength(0);
  });

  test('multiple listeners all fire in order', () => {
    const order: number[] = [];
    db.onChange(() => order.push(1));
    db.onChange(() => order.push(2));
    db.onChange(() => order.push(3));

    db.insert('todos', { id: '1', title: 'Test', done: 0 });

    expect(order).toEqual([1, 2, 3]);
  });

  test('unsubscribe stops listener from firing', () => {
    const changes: Change[] = [];
    const unsub = db.onChange((c) => changes.push(c));

    db.insert('todos', { id: '1', title: 'Test', done: 0 });
    expect(changes).toHaveLength(1);

    unsub();
    db.insert('todos', { id: '2', title: 'Test2', done: 0 });
    expect(changes).toHaveLength(1); // Still 1 — listener removed
  });

  test('self-unsubscribe does not skip the next listener in the current dispatch', () => {
    const order: number[] = [];
    let unsubscribeFirst = () => {};
    unsubscribeFirst = db.onChange(() => {
      order.push(1);
      unsubscribeFirst();
    });
    db.onChange(() => order.push(2));

    db.insert('todos', { id: '1', title: 'First', done: 0 });
    db.insert('todos', { id: '2', title: 'Second', done: 0 });

    expect(order).toEqual([1, 2, 2]);
  });

  test('error in listener does not prevent other listeners', () => {
    const changes: Change[] = [];
    db.onChange(() => {
      throw new Error('broken listener');
    });
    db.onChange((c) => changes.push(c));

    // Should not throw, and second listener should still fire
    db.insert('todos', { id: '1', title: 'Test', done: 0 });
    expect(changes).toHaveLength(1);
  });

  test('error in listener does not roll back the write', () => {
    db.onChange(() => {
      throw new Error('broken listener');
    });

    db.insert('todos', { id: '1', title: 'Test', done: 0 });
    expect(db.queryOne('todos', '1')).toEqual({ id: '1', title: 'Test', done: 0 });
  });

  test('isolates listener payload mutation from later listeners and the caller', () => {
    db.exec('CREATE TABLE _nested_payloads (id TEXT PRIMARY KEY, payload TEXT)');
    let secondChange: Change | null = null;
    const secondSources: string[] = [];
    db.onChange((change, delivery) => {
      change.seq = 999;
      change.table = 'forged';
      (change.row!.nested as { tenant: string }).tenant = 'victim';
      delivery.source = 'external';
    });
    db.onChange((change, delivery) => {
      secondChange = change;
      secondSources.push(delivery.source);
    });

    const result = db.transaction(() => {
      db.exec("INSERT INTO _nested_payloads (id, payload) VALUES ('one', 'value')");
      return db.recordInternalChange({
        table: '_nested_payloads',
        op: 'INSERT',
        rowId: 'one',
        row: { id: 'one', nested: { tenant: 'actual' } },
      });
    });

    expect(secondChange).toMatchObject({
      seq: 1,
      table: '_nested_payloads',
      row: { nested: { tenant: 'actual' } },
    });
    expect(secondSources).toEqual(['local']);
    expect(result).toMatchObject({
      seq: 1,
      table: '_nested_payloads',
      row: { nested: { tenant: 'actual' } },
    });
    expect(db.getChangesAfter(0)?.[0]).toMatchObject({
      seq: 1,
      table: '_nested_payloads',
      row: { nested: { tenant: 'actual' } },
    });
  });

  test('isolates deferred delivery from a caller-mutated returned change', () => {
    const observed: Change[] = [];
    db.onChange((change) => observed.push(change));

    db.transaction(() => {
      const returned = db.insert('todos', {
        id: 'real-id', title: 'Real title', done: 0,
      });
      returned.seq = 999;
      returned.table = 'forged';
      returned.op = 'DELETE';
      returned.rowId = 'forged-id';
      returned.row = { id: 'forged-id', title: 'Forged', done: 1 };
      returned.previousRow = { id: 'other', title: 'Forged previous', done: 1 };
      returned.ts = 0;
    });

    const durable = db.getChangesAfter(0) ?? [];
    expect(durable).toHaveLength(1);
    expect(observed).toEqual(durable);
    expect(observed[0]).toMatchObject({
      seq: 1,
      table: 'todos',
      op: 'INSERT',
      rowId: 'real-id',
      row: { id: 'real-id', title: 'Real title', done: 0 },
      previousRow: null,
    });
  });

  test('consumes async listener rejection without sharing its mutable payload', async () => {
    let secondSequence = 0;
    db.onChange(async (change) => {
      change.seq = 999;
      await Promise.resolve();
      throw new Error('async listener failure');
    });
    db.onChange((change) => { secondSequence = change.seq; });

    const result = db.insert('todos', { id: '1', title: 'Test', done: 0 });
    await Promise.resolve();
    expect(secondSequence).toBe(1);
    expect(result.seq).toBe(1);
  });
});

// ─── Ring Buffer (_changes) ──────────────────────────────────────────────

describe('ring buffer', () => {
  test('getChangesAfter returns changes after given seq', () => {
    db.insert('todos', { id: '1', title: 'First', done: 0 });
    db.insert('todos', { id: '2', title: 'Second', done: 0 });
    db.insert('todos', { id: '3', title: 'Third', done: 0 });

    const changes = db.getChangesAfter(1);
    expect(changes).toHaveLength(2);
    expect(changes![0].seq).toBe(2);
    expect(changes![1].seq).toBe(3);
  });

  test('getChangesAfter(0) returns all changes', () => {
    db.insert('todos', { id: '1', title: 'First', done: 0 });
    db.insert('todos', { id: '2', title: 'Second', done: 0 });

    const changes = db.getChangesAfter(0);
    expect(changes).toHaveLength(2);
  });

  test('getChangesAfter returns empty array when up to date', () => {
    db.insert('todos', { id: '1', title: 'First', done: 0 });

    const changes = db.getChangesAfter(1);
    expect(changes).toEqual([]);
  });

  test('getChangesAfter returns empty array for empty buffer', () => {
    const changes = db.getChangesAfter(0);
    expect(changes).toEqual([]);
  });

  test('ring buffer prunes old entries', () => {
    const smallDb = createReactiveDB({ mode: 'memory', ringBufferDepth: 5 });
    smallDb.defineTable('t', { id: 'text primary key', val: 'text' });

    // Insert 10 entries — should prune first 5
    for (let i = 1; i <= 10; i++) {
      smallDb.insert('t', { id: String(i), val: `v${i}` });
    }

    // seq 1-5 should be pruned, seq 6-10 should remain
    const changes = smallDb.getChangesAfter(5);
    expect(changes).toHaveLength(5);
    expect(changes![0].seq).toBe(6);
    expect(changes![4].seq).toBe(10);

    // seq 4 is pruned — should return null
    const pruned = smallDb.getChangesAfter(4);
    expect(pruned).toBeNull();

    smallDb.dispose();
  });

  test('changes include correct data for INSERT/UPDATE/DELETE', () => {
    db.insert('todos', { id: '1', title: 'Buy milk', done: 0 });
    db.update('todos', '1', { done: 1 });
    db.delete('todos', '1');

    const changes = db.getChangesAfter(0);
    expect(changes).toHaveLength(3);

    // INSERT
    expect(changes![0].op).toBe('INSERT');
    expect(changes![0].row).toEqual({ id: '1', title: 'Buy milk', done: 0 });

    // UPDATE
    expect(changes![1].op).toBe('UPDATE');
    expect(changes![1].row).toEqual({ id: '1', title: 'Buy milk', done: 1 });

    // DELETE
    expect(changes![2].op).toBe('DELETE');
    expect(changes![2].row).toBeNull();
  });
});

// ─── Transactions ─────────────────────────────────────────────────────────

describe('transactions', () => {
  test('exposes one opaque transaction domain per ReactiveDB instance', () => {
    const sameDomain = db.getTransactionDomain();
    expect(db.getTransactionDomain()).toBe(sameDomain);

    const other = createReactiveDB({ mode: 'memory' });
    try {
      expect(other.getTransactionDomain()).not.toBe(sameDomain);
    } finally {
      other.dispose();
    }
  });

  test('requires an active transaction to register an afterCommit callback', () => {
    expect(() => db.afterCommit(() => {})).toThrow(
      'afterCommit callbacks require an active transaction',
    );
  });

  test('runs afterCommit callbacks once in registration order after state resets', () => {
    const order: string[] = [];

    db.transaction(() => {
      db.insert('todos', { id: '1', title: 'Committed', done: 0 });
      db.afterCommit(() => {
        expect(db.queryOne('todos', '1')).not.toBeNull();
        order.push('outer-first');
        db.transaction(() => {
          db.afterCommit(() => order.push('reentrant'));
        });
      });
      db.transaction(() => {
        db.afterCommit(() => order.push('nested'));
      });
      db.afterCommit(() => order.push('outer-last'));

      expect(order).toEqual([]);
    });

    expect(order).toEqual([
      'outer-first',
      'reentrant',
      'nested',
      'outer-last',
    ]);
  });

  test('delivers committed changes before running afterCommit callbacks', () => {
    const order: string[] = [];
    db.onChange((change) => order.push(`change:${change.rowId}`));

    db.transaction(() => {
      db.insert('todos', { id: '1', title: 'First', done: 0 });
      db.insert('todos', { id: '2', title: 'Second', done: 0 });
      db.afterCommit(() => {
        order.push('after-commit');
        db.insert('todos', { id: '3', title: 'Reentrant', done: 0 });
      });
    });

    expect(order).toEqual([
      'change:1',
      'change:2',
      'after-commit',
      'change:3',
    ]);
  });

  test('discards afterCommit callbacks on rollback and rollback-only failure', () => {
    const callbacks: string[] = [];

    expect(() => db.transaction(() => {
      db.afterCommit(() => callbacks.push('rollback'));
      throw new Error('abort transaction');
    })).toThrow('abort transaction');

    expect(() => db.transaction(() => {
      db.afterCommit(() => callbacks.push('rollback-only'));
      try {
        db.transaction(() => {
          throw new Error('poison nested transaction');
        });
      } catch {
        // Swallowing a nested failure cannot un-poison the outer transaction.
      }
    })).toThrow('transaction is rollback-only');

    expect(callbacks).toEqual([]);
  });

  test('isolates afterCommit failures and consumes async callback rejections', async () => {
    const callbacks: string[] = [];

    db.transaction(() => {
      db.insert('todos', { id: '1', title: 'Committed', done: 0 });
      db.afterCommit(() => {
        callbacks.push('throws');
        throw new Error('post-commit failure');
      });
      db.afterCommit(async () => {
        callbacks.push('async-start');
        await Promise.resolve();
        callbacks.push('async-finish');
        throw new Error('async post-commit rejection');
      });
      db.afterCommit(() => callbacks.push('last'));
    });

    await Promise.resolve();
    expect(db.queryOne('todos', '1')).not.toBeNull();
    expect(callbacks).toEqual([
      'throws',
      'async-start',
      'last',
      'async-finish',
    ]);
    expect(observabilityEvents.query({
      code: OBS_CODES.SYNC_POST_COMMIT_NOTIFICATION_FAILED.code,
    }).events).toHaveLength(2);
    expect(observabilityEvents.query({
      code: OBS_CODES.SYNC_CHANGE_LISTENER_FAILED.code,
    }).events).toHaveLength(0);
  });

  test('rolls back when synchronous transaction-result inspection is hostile', () => {
    const hostileResult = Object.defineProperty({}, 'then', {
      get() {
        throw new Error('hostile then getter');
      },
    });

    expect(() => db.transaction(() => {
      db.insert('todos', { id: 'hostile', title: 'Rollback', done: 0 });
      return hostileResult;
    })).toThrow('ReactiveDB synchronous callback thenable inspection failed');

    expect(db.queryOne('todos', 'hostile')).toBeNull();
    expect(db.currentSeq).toBe(0);
  });

  test('isolates injected emitters for listener and post-commit contract failures', () => {
    const firstCodes: string[] = [];
    const secondCodes: string[] = [];
    const hostileResult = () => Object.defineProperty({}, 'then', {
      get() {
        throw new Error('hostile then getter');
      },
    });
    const first = createReactiveDB({
      mode: 'memory',
      emitCode(definition) {
        firstCodes.push(definition.code);
        throw new Error('injected observability sink failed');
      },
    });
    const second = createReactiveDB({
      mode: 'memory',
      emitCode(definition) {
        secondCodes.push(definition.code);
      },
    });

    try {
      first.defineTable('items', { id: 'text primary key' });
      second.defineTable('items', { id: 'text primary key' });
      let laterListenerRan = false;
      first.onChange(() => hostileResult());
      first.onChange(() => { laterListenerRan = true; });
      first.insert('items', { id: 'first' });

      let laterCallbackRan = false;
      second.transaction(() => {
        second.insert('items', { id: 'second' });
        second.afterCommit(() => hostileResult());
        second.afterCommit(() => { laterCallbackRan = true; });
      });

      expect(laterListenerRan).toBe(true);
      expect(laterCallbackRan).toBe(true);
      expect(firstCodes).toEqual([
        OBS_CODES.SYNC_CHANGE_LISTENER_FAILED.code,
      ]);
      expect(secondCodes).toEqual([
        OBS_CODES.SYNC_POST_COMMIT_NOTIFICATION_FAILED.code,
      ]);
      expect(observabilityEvents.query({
        code: OBS_CODES.SYNC_CHANGE_LISTENER_FAILED.code,
      }).events).toHaveLength(0);
      expect(observabilityEvents.query({
        code: OBS_CODES.SYNC_POST_COMMIT_NOTIFICATION_FAILED.code,
      }).events).toHaveLength(0);
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  test('all writes in a transaction are atomic', () => {
    db.transaction(() => {
      db.insert('todos', { id: '1', title: 'First', done: 0 });
      db.insert('todos', { id: '2', title: 'Second', done: 0 });
    });

    expect(db.query('todos')).toHaveLength(2);
  });

  test('failed transaction rolls back all writes', () => {
    try {
      db.transaction(() => {
        db.insert('todos', { id: '1', title: 'First', done: 0 });
        throw new Error('abort!');
      });
    } catch {
      // Expected
    }

    expect(db.query('todos')).toHaveLength(0);
  });

  test('change listeners are deferred until commit', () => {
    const changes: Change[] = [];
    db.onChange((c) => changes.push(c));

    db.transaction(() => {
      db.insert('todos', { id: '1', title: 'First', done: 0 });
      // Mid-transaction: listener should NOT have fired yet
      expect(changes).toHaveLength(0);

      db.insert('todos', { id: '2', title: 'Second', done: 0 });
      expect(changes).toHaveLength(0);
    });

    // After commit: all changes emitted
    expect(changes).toHaveLength(2);
    expect(changes[0].rowId).toBe('1');
    expect(changes[1].rowId).toBe('2');
  });

  test('queues reentrant listener writes behind the complete committed batch', () => {
    const firstListener: number[] = [];
    const secondListener: number[] = [];

    db.onChange((change) => {
      firstListener.push(change.seq);
      if (change.rowId === '1') {
        db.insert('todos', { id: '3', title: 'Reentrant', done: 0 });
      }
    });
    db.onChange((change) => secondListener.push(change.seq));

    db.transaction(() => {
      db.insert('todos', { id: '1', title: 'First', done: 0 });
      db.insert('todos', { id: '2', title: 'Second', done: 0 });
    });

    expect(firstListener).toEqual([1, 2, 3]);
    expect(secondListener).toEqual([1, 2, 3]);
    expect(db.getChangesAfter(0)?.map((change) => change.seq)).toEqual([1, 2, 3]);
  });

  test('failed transaction does not emit changes', () => {
    const changes: Change[] = [];
    db.onChange((c) => changes.push(c));

    try {
      db.transaction(() => {
        db.insert('todos', { id: '1', title: 'First', done: 0 });
        throw new Error('abort!');
      });
    } catch {
      // Expected
    }

    expect(changes).toHaveLength(0);
  });

  test('seq is rolled back on failed transaction', () => {
    const initialSeq = db.currentSeq;

    try {
      db.transaction(() => {
        db.insert('todos', { id: '1', title: 'First', done: 0 });
        db.insert('todos', { id: '2', title: 'Second', done: 0 });
        throw new Error('abort!');
      });
    } catch {
      // Expected
    }

    expect(db.currentSeq).toBe(initialSeq);
  });

  test('transaction returns the function result', () => {
    const result = db.transaction(() => {
      db.insert('todos', { id: '1', title: 'First', done: 0 });
      return 42;
    });

    expect(result).toBe(42);
  });

  test('nested transactions work (inner runs in outer context)', () => {
    const changes: Change[] = [];
    db.onChange((c) => changes.push(c));

    db.transaction(() => {
      db.insert('todos', { id: '1', title: 'First', done: 0 });
      db.transaction(() => {
        db.insert('todos', { id: '2', title: 'Second', done: 0 });
      });
    });

    // Both writes committed, changes emitted after outer transaction
    expect(db.query('todos')).toHaveLength(2);
    expect(changes).toHaveLength(2);
  });

  test('changes are recorded in ring buffer during transaction', () => {
    db.transaction(() => {
      db.insert('todos', { id: '1', title: 'First', done: 0 });
      db.insert('todos', { id: '2', title: 'Second', done: 0 });
    });

    const changes = db.getChangesAfter(0);
    expect(changes).toHaveLength(2);
    expect(changes![0].rowId).toBe('1');
    expect(changes![1].rowId).toBe('2');
  });

  test('rolls back the application row and sequence when change recording fails', () => {
    db.exec(`
      CREATE TRIGGER reject_change_record
      BEFORE INSERT ON _changes
      BEGIN
        SELECT RAISE(ABORT, 'reject test change');
      END
    `);

    expect(() => db.insert('todos', {
      id: '1',
      title: 'Must roll back',
      done: 0,
    })).toThrow('owned log trigger set is incompatible');

    expect(db.queryOne('todos', '1')).toBeNull();
    expect(db.currentSeq).toBe(0);
    expect(db.getChangesAfter(0)).toEqual([]);
  });

  test('rejects async callbacks and poisons their awaited continuation', async () => {
    let rawAccessError = '';
    expect(() => db.transaction(async () => {
      db.insert('todos', { id: 'before-await', title: 'Before', done: 0 });
      await Promise.resolve();
      try {
        db.getRawDatabase().run(
          "INSERT INTO main.todos (id, title, done) VALUES ('raw-after-await', 'Raw', 0)",
        );
      } catch (error) {
        rawAccessError = String(error);
      }
      db.insert('todos', { id: 'after-await', title: 'After', done: 0 });
    })).toThrow('transactions must be synchronous');

    await Bun.sleep(0);
    expect(rawAccessError).toContain('transactions must be synchronous');
    expect(db.query('todos')).toEqual([]);
    expect(db.currentSeq).toBe(0);
  });

  test('poisons detached async continuations after a synchronous rollback', async () => {
    let releaseContinuation!: () => void;
    const continuationGate = new Promise<void>((resolve) => {
      releaseContinuation = resolve;
    });
    let continuation!: Promise<void>;

    expect(() => db.transaction(() => {
      continuation = (async () => {
        await continuationGate;
        db.insert('todos', { id: 'detached', title: 'Must not commit', done: 0 });
      })();
      throw new Error('abort outer transaction');
    })).toThrow('abort outer transaction');

    releaseContinuation();
    await expect(continuation).rejects.toThrow('transaction is rollback-only');
    expect(db.queryOne('todos', 'detached')).toBeNull();
  });

  test('cannot commit when a nested async-transaction error is swallowed', async () => {
    expect(() => db.transaction(() => {
      db.insert('todos', { id: 'outer', title: 'Outer', done: 0 });
      try {
        db.transaction(async () => {
          db.insert('todos', { id: 'nested', title: 'Nested', done: 0 });
          await Promise.resolve();
          db.insert('todos', { id: 'late', title: 'Late', done: 0 });
        });
      } catch {
        // The outer transaction must retain the poison even if app code
        // catches the immediate nested-contract error.
      }
    })).toThrow('transactions must be synchronous');

    await Bun.sleep(0);
    expect(db.query('todos')).toEqual([]);
    expect(db.currentSeq).toBe(0);
  });

  test('rejects async snapshot readers and poisons their awaited continuation', async () => {
    let continuation: Promise<void> | null = null;

    expect(() => db.readAtCurrentSequence(() => {
      continuation = (async () => {
        await Promise.resolve();
        db.insert('todos', { id: 'late-read', title: 'Late', done: 0 });
      })();
      return continuation;
    })).toThrow('snapshot readers must be synchronous');

    await expect(continuation!).rejects.toThrow('snapshot readers must be synchronous');
    expect(db.query('todos')).toEqual([]);
    expect(db.currentSeq).toBe(0);
  });

  test('snapshot readers reject managed writes before a standalone snapshot can commit', () => {
    const observed: Change[] = [];
    db.onChange((change) => observed.push(change));

    expect(() => db.readAtCurrentSequence(() => db.insert('todos', {
      id: 'snapshot-write',
      title: 'Must not commit',
      done: 0,
    }))).toThrow('snapshot readers are read-only');

    expect(db.query('todos')).toEqual([]);
    expect(db.currentSeq).toBe(0);
    expect(db.getChangesAfter(0)).toEqual([]);
    expect(observed).toEqual([]);
  });

  test('a swallowed snapshot write attempt poisons and rolls back an outer transaction', () => {
    const observed: Change[] = [];
    db.onChange((change) => observed.push(change));

    expect(() => db.transaction(() => {
      db.insert('todos', { id: 'before', title: 'Before', done: 0 });
      try {
        db.readAtCurrentSequence(() => {
          try {
            // An active outer transaction reaches the target DML before
            // change creation, so the snapshot guard must poison that outer
            // transaction and force the target row to roll back as well.
            db.insert('todos', { id: 'inside', title: 'Inside', done: 0 });
          } catch {
            // Neither layer may turn a rejected managed write into a commit.
          }
          return db.query('todos');
        });
      } catch {
        // Swallowing the snapshot's rollback-only result must not clear poison.
      }
    })).toThrow('transaction is rollback-only');

    expect(db.query('todos')).toEqual([]);
    expect(db.currentSeq).toBe(0);
    expect(db.getChangesAfter(0)).toEqual([]);
    expect(observed).toEqual([]);
  });

  test('snapshot readers reject schema definition and internal change recording', () => {
    expect(() => db.readAtCurrentSequence(() => {
      try {
        db.defineTable('snapshot_schema', { id: 'text primary key' });
      } catch {
        // A swallowed schema attempt still invalidates the snapshot.
      }
      return null;
    })).toThrow('transaction is rollback-only');
    expect(db.hasTable('snapshot_schema')).toBe(false);

    db.exec('CREATE TABLE _snapshot_state (id TEXT PRIMARY KEY)');
    expect(() => db.transaction(() => {
      db.readAtCurrentSequence(() => {
        db.exec("INSERT INTO _snapshot_state (id) VALUES ('unsafe')");
        db.recordInternalChange({
          table: '_snapshot_state',
          op: 'INSERT',
          rowId: 'unsafe',
          row: { id: 'unsafe' },
        });
      });
    })).toThrow('snapshot readers are read-only');

    expect(db.prepare('SELECT id FROM _snapshot_state').all()).toEqual([]);
    expect(db.currentSeq).toBe(0);
    expect(db.getChangesAfter(0)).toEqual([]);
  });

  test('snapshot readers remain readable and nested reads share the same cursor', () => {
    db.insert('todos', { id: 'one', title: 'One', done: 0 });

    const outer = db.readAtCurrentSequence(() => {
      const nested = db.readAtCurrentSequence(() => db.query('todos'));
      return {
        nested,
        row: db.queryOne('todos', 'one'),
      };
    });

    expect(outer.seq).toBe(1);
    expect(outer.value.nested.seq).toBe(outer.seq);
    expect(outer.value.nested.value).toEqual([
      { id: 'one', title: 'One', done: 0 },
    ]);
    expect(outer.value.row).toEqual({ id: 'one', title: 'One', done: 0 });
  });

  test('a swallowed lossy-payload failure marks the whole transaction rollback-only', () => {
    db.defineTable('payloads', {
      id: 'text primary key',
      body: 'blob',
    });

    expect(() => db.transaction(() => {
      try {
        db.insert('payloads', { id: 'unsafe', body: new Uint8Array([1]) });
      } catch {
        // Managed mutation failures cannot be converted into partial commits.
      }
    })).toThrow('transaction is rollback-only');

    expect(db.query('payloads')).toEqual([]);
    expect(db.currentSeq).toBe(0);
    expect(db.getChangesAfter(0)).toEqual([]);
  });

  test('a swallowed target-postcondition failure rolls back the outer transaction', () => {
    db.insert('todos', { id: 'ignored', title: 'Before', done: 0 });
    db.exec(`
      CREATE TRIGGER ignore_transaction_update
      BEFORE UPDATE ON todos
      WHEN NEW.id = 'ignored'
      BEGIN
        SELECT RAISE(IGNORE);
      END
    `);

    expect(() => db.transaction(() => {
      try {
        db.update('todos', 'ignored', { title: 'After' });
      } catch {
        // The outer commit must still fail.
      }
    })).toThrow('transaction is rollback-only');

    expect(db.queryOne('todos', 'ignored')?.title).toBe('Before');
    expect(db.currentSeq).toBe(1);
    expect(db.getChangesAfter(0)).toHaveLength(1);
  });

  test('an added durable-log trigger is rejected before app data can commit', () => {
    db.exec(`
      CREATE TRIGGER ignore_transaction_change_log
      BEFORE INSERT ON _changes
      WHEN NEW.seq > 0
      BEGIN
        SELECT RAISE(IGNORE);
      END
    `);

    expect(() => db.transaction(() => {
      db.insert('todos', { id: 'unlogged', title: 'Unsafe', done: 0 });
    })).toThrow('owned log trigger set is incompatible');

    expect(db.queryOne('todos', 'unlogged')).toBeNull();
    expect(db.currentSeq).toBe(0);
    expect(db.getChangesAfter(0)).toEqual([]);
  });

  test('a swallowed internal-record failure rolls back preceding raw DML', () => {
    db.exec('CREATE TABLE _state_rollback (id TEXT PRIMARY KEY, value TEXT)');

    expect(() => db.transaction(() => {
      db.exec("INSERT INTO _state_rollback (id, value) VALUES ('one', 'unsafe')");
      try {
        db.recordInternalChange({
          table: '_state_rollback',
          op: 'UPDATE',
          rowId: 'one',
          row: { id: 'one', value: 'unsafe' },
        });
      } catch {
        // Missing previousRow makes the internal event invalid.
      }
    })).toThrow('transaction is rollback-only');

    expect(db.prepare('SELECT * FROM _state_rollback').all()).toEqual([]);
    expect(db.currentSeq).toBe(0);
    expect(db.getChangesAfter(0)).toEqual([]);
  });

  test('rejects lossy change payloads before committing or notifying listeners', () => {
    db.defineTable('payloads', {
      id: 'text primary key',
      body: 'blob',
      score: 'real',
    });
    const observed: Change[] = [];
    db.onChange((change) => observed.push(change));

    expect(() => db.insert('payloads', {
      id: 'blob', body: new Uint8Array([1, 2, 3]), score: 1,
    })).toThrow('lossless JSON object');
    expect(() => db.insert('payloads', {
      id: 'infinite', body: null, score: Number.POSITIVE_INFINITY,
    })).toThrow('lossless JSON object');
    expect(db.query('payloads')).toEqual([]);
    expect(db.currentSeq).toBe(0);
    expect(observed).toEqual([]);
  });
});

// ─── dispose ──────────────────────────────────────────────────────────────

describe('dispose', () => {
  test('throws on any operation after dispose', () => {
    db.dispose();

    expect(() => db.insert('todos', { id: '1', title: 'Test', done: 0 })).toThrow('disposed');
    expect(() => db.update('todos', '1', { done: 1 })).toThrow('disposed');
    expect(() => db.delete('todos', '1')).toThrow('disposed');
    expect(() => db.query('todos')).toThrow('disposed');
    expect(() => db.queryOne('todos', '1')).toThrow('disposed');
    expect(() => db.getChangesAfter(0)).toThrow('disposed');
    expect(() => db.onChange(() => {})).toThrow('disposed');
    expect(() => db.getTableNames()).toThrow('disposed');
    expect(() => db.hasTable('todos')).toThrow('disposed');
    expect(() => db.getPrimaryKey('todos')).toThrow('disposed');
    expect(() => db.getColumns('todos')).toThrow('disposed');
    expect(() => db.getIdentity('todos')).toThrow('disposed');
    expect(() => db.syncEpoch).toThrow('disposed');
    expect(() => db.getSQLiteService()).toThrow('disposed');
    expect(() => db.getRawDatabase()).toThrow('disposed');
    expect(() =>
      db.defineTable('x', { id: 'text primary key' })
    ).toThrow('disposed');
  });

  test('dispose is idempotent', () => {
    db.dispose();
    expect(() => db.dispose()).not.toThrow();
  });

  test('cannot dispose inside a transaction or swallow the rollback poison', () => {
    const raw = new Database(':memory:');
    const database = createReactiveDB({ database: raw });
    database.defineTable('items', {
      id: 'text primary key',
      name: 'text not null',
    });

    try {
      expect(() => database.transaction(() => {
        database.insert('items', { id: 'one', name: 'Unsafe' });
        try {
          database.dispose();
        } catch {
          // Disposing an active transaction poisons it even if swallowed.
        }
      })).toThrow('active transaction');

      expect(database.query('items')).toEqual([]);
      expect(database.currentSeq).toBe(0);
      expect(database.getChangesAfter(0)).toEqual([]);

      database.insert('items', { id: 'two', name: 'Still usable' });
      expect(database.queryOne('items', 'two')).toEqual({
        id: 'two', name: 'Still usable',
      });
    } finally {
      database.dispose();
      raw.close();
    }
  });

  test('cannot dispose from a snapshot reader, even when the attempt is swallowed', () => {
    expect(() => db.readAtCurrentSequence(() => {
      try {
        db.dispose();
      } catch {
        // Snapshot readers cannot partially tear down the database, and the
        // attempt remains rollback-only even if application code catches it.
      }
      return null;
    })).toThrow('transaction is rollback-only');

    db.insert('todos', { id: 'usable', title: 'Still usable', done: 0 });
    expect(db.queryOne('todos', 'usable')).toEqual({
      id: 'usable', title: 'Still usable', done: 0,
    });
  });

  test('cannot dispose from a listener before the committed batch is delivered', () => {
    const observed: number[] = [];
    db.onChange(() => db.dispose());
    db.onChange((change) => observed.push(change.seq));

    db.transaction(() => {
      db.insert('todos', { id: 'one', title: 'One', done: 0 });
      db.insert('todos', { id: 'two', title: 'Two', done: 0 });
    });

    expect(observed).toEqual([1, 2]);
    expect(db.query('todos')).toHaveLength(2);
    expect(db.currentSeq).toBe(2);
  });
});

// ─── exec / prepare (raw access) ─────────────────────────────────────────

describe('raw access', () => {
  test('allows unrelated application schema DDL inside a managed transaction', () => {
    db.transaction(() => {
      db.exec('CREATE TABLE app_runtime_schema (id TEXT PRIMARY KEY, value TEXT)');
      db.exec('CREATE INDEX app_runtime_value_idx ON app_runtime_schema (value)');
    });

    expect(db.prepare(`
      SELECT name FROM sqlite_schema
      WHERE name IN ('app_runtime_schema', 'app_runtime_value_idx')
      ORDER BY name
    `).all()).toEqual([
      { name: 'app_runtime_schema' },
      { name: 'app_runtime_value_idx' },
    ]);

    // The committed schema version is now trusted, and ordinary prepared CRUD
    // continues without another false-positive schema fence.
    db.insert('todos', { id: 'after-ddl', title: 'Still usable', done: 0 });
    expect(db.queryOne('todos', 'after-ddl')?.title).toBe('Still usable');
  });

  test('allows a structurally compatible managed table rebuild without tracked writes', () => {
    db.insert('todos', { id: 'one', title: 'Before', done: 0 });
    const definition = db.prepare(`
      SELECT sql FROM main.sqlite_schema
      WHERE type = 'table' AND name = 'todos'
    `).get() as { sql: string };

    db.transaction(() => {
      db.exec('ALTER TABLE todos RENAME TO todos_previous');
      db.exec(definition.sql);
      db.exec('INSERT INTO todos SELECT * FROM todos_previous');
      db.exec('DROP TABLE todos_previous');
    });

    expect(db.queryOne('todos', 'one')).toEqual({
      id: 'one', title: 'Before', done: 0,
    });
    db.update('todos', 'one', { title: 'After' });
    expect(db.queryOne('todos', 'one')?.title).toBe('After');
  });

  test('rejects unrelated DDL combined with a tracked change and rolls both back', () => {
    const observed: Change[] = [];
    db.onChange((change) => observed.push(change));

    expect(() => db.transaction(() => {
      db.exec('CREATE TABLE mixed_schema_change (id TEXT PRIMARY KEY)');
      db.insert('todos', { id: 'mixed', title: 'Must roll back', done: 0 });
    })).toThrow('cannot combine schema changes with tracked changes');

    expect(db.prepare(`
      SELECT name FROM main.sqlite_schema WHERE name = 'mixed_schema_change'
    `).get()).toBeNull();
    expect(db.queryOne('todos', 'mixed')).toBeNull();
    expect(db.currentSeq).toBe(0);
    expect(db.getChangesAfter(0)).toEqual([]);
    expect(observed).toEqual([]);

    db.insert('todos', { id: 'usable', title: 'Prepared statements survived', done: 0 });
    expect(db.queryOne('todos', 'usable')?.title).toBe('Prepared statements survived');
  });

  test('rejects external managed column and primary-key contract drift before mutation', () => {
    const driftCases: Array<{
      name: string;
      mutateSchema: (database: ReactiveDB) => void;
    }> = [
      {
        name: 'column',
        mutateSchema: (database) => {
          database.exec('ALTER TABLE items ADD COLUMN hidden_value TEXT');
        },
      },
      {
        name: 'primary-key',
        mutateSchema: (database) => {
          database.exec('ALTER TABLE items RENAME TO items_previous');
          database.exec('CREATE TABLE items (id TEXT UNIQUE, value TEXT NOT NULL)');
          database.exec('INSERT INTO items SELECT * FROM items_previous');
          database.exec('DROP TABLE items_previous');
        },
      },
      {
        name: 'non-primary-key-collation',
        mutateSchema: (database) => {
          database.exec('ALTER TABLE items RENAME TO items_previous');
          database.exec(`
            CREATE TABLE items (
              id TEXT PRIMARY KEY,
              value TEXT NOT NULL COLLATE NOCASE
            )
          `);
          database.exec('INSERT INTO items SELECT * FROM items_previous');
          database.exec('DROP TABLE items_previous');
        },
      },
      {
        name: 'column-constraint',
        mutateSchema: (database) => {
          database.exec('ALTER TABLE items RENAME TO items_previous');
          database.exec(`
            CREATE TABLE items (
              id TEXT PRIMARY KEY,
              value TEXT NOT NULL CHECK (length(value) > 0)
            )
          `);
          database.exec('INSERT INTO items SELECT * FROM items_previous');
          database.exec('DROP TABLE items_previous');
        },
      },
    ];

    for (const drift of driftCases) {
      const database = createReactiveDB({ mode: 'memory' });
      try {
        database.defineTable('items', {
          id: 'text primary key',
          value: 'text not null',
        });
        database.insert('items', { id: 'one', value: 'Before' });
        const before = database.getChangesAfter(0);
        const observed: Change[] = [];
        database.onChange((change) => observed.push(change));

        drift.mutateSchema(database);
        expect(() => database.update('items', 'one', { value: drift.name }))
          .toThrow('registered column/primary-key contract');

        expect(database.currentSeq).toBe(1);
        expect(database.getChangesAfter(0)).toEqual(before);
        expect(observed).toEqual([]);
      } finally {
        database.dispose();
      }
    }
  });

  test('preserves literal whitespace while fingerprinting stored table SQL', () => {
    db.defineTable('literal_constraints', {
      id: 'text primary key',
      value: "text not null check (value <> 'blocked  value')",
    });
    db.insert('literal_constraints', { id: 'one', value: 'allowed' });
    const definition = db.prepare(`
      SELECT sql FROM main.sqlite_schema
      WHERE type = 'table' AND name = 'literal_constraints'
    `).get() as { sql: string };
    const before = db.getChangesAfter(0);
    const observed: Change[] = [];
    db.onChange((change) => observed.push(change));

    db.getRawDatabase().transaction(() => {
      db.exec('ALTER TABLE literal_constraints RENAME TO literal_constraints_previous');
      db.exec(definition.sql.replace('blocked  value', 'blocked value'));
      db.exec(`
        INSERT INTO literal_constraints
        SELECT * FROM literal_constraints_previous
      `);
      db.exec('DROP TABLE literal_constraints_previous');
    }).immediate();

    expect(() => db.update('literal_constraints', 'one', { value: 'still allowed' }))
      .toThrow('registered column/primary-key contract');
    expect(db.queryOne('literal_constraints', 'one')).toEqual({
      id: 'one', value: 'allowed',
    });
    expect(db.getChangesAfter(0)).toEqual(before);
    expect(observed).toEqual([]);
  });

  test('rejects externally introduced cascading FKs before a tracked write', () => {
    defineForeignKeyFenceTables(db);
    db.insert('parents', { id: 'parent', name: 'Parent' });
    db.insert('children', { id: 'child', parent_id: 'parent' });
    const before = db.getChangesAfter(0);
    const observed: Change[] = [];
    db.onChange((change) => observed.push(change));

    db.getRawDatabase().transaction(() => {
      rebuildChildrenWithDeleteAction(db, 'CASCADE');
    }).immediate();

    expect(() => db.delete('parents', 'parent'))
      .toThrow('foreign-key actions are not observable');
    expect(db.queryOne('parents', 'parent')).toEqual({ id: 'parent', name: 'Parent' });
    expect(db.queryOne('children', 'child')).toEqual({
      id: 'child', parent_id: 'parent',
    });
    expect(db.currentSeq).toBe(2);
    expect(db.getChangesAfter(0)).toEqual(before);
    expect(observed).toEqual([]);

    // Repairing the external schema makes the next entry audit succeed and
    // proves the existing prepared statement set remains usable.
    db.getRawDatabase().transaction(() => {
      rebuildChildrenWithDeleteAction(db, 'NO ACTION');
    }).immediate();
    db.update('children', 'child', { parent_id: 'parent' });
    expect(db.currentSeq).toBe(3);
    expect(observed.map((change) => change.seq)).toEqual([3]);
  });

  test('rolls back persistent unsafe FK DDL, cascaded rows, log state, and delivery', () => {
    defineForeignKeyFenceTables(db);
    db.insert('parents', { id: 'parent', name: 'Parent' });
    db.insert('children', { id: 'child', parent_id: 'parent' });
    const before = db.getChangesAfter(0);
    const observed: Change[] = [];
    db.onChange((change) => observed.push(change));

    expect(() => db.transaction(() => {
      rebuildChildrenWithDeleteAction(db, 'CASCADE');
      db.delete('parents', 'parent');
    })).toThrow('foreign-key actions are not observable');

    expect(db.queryOne('parents', 'parent')).toEqual({ id: 'parent', name: 'Parent' });
    expect(db.queryOne('children', 'child')).toEqual({
      id: 'child', parent_id: 'parent',
    });
    expect(db.prepare('PRAGMA main.foreign_key_list(children)').all()[0]).toMatchObject({
      on_delete: 'NO ACTION',
    });
    expect(db.currentSeq).toBe(2);
    expect(db.getChangesAfter(0)).toEqual(before);
    expect(observed).toEqual([]);

    db.update('children', 'child', { parent_id: 'parent' });
    expect(db.currentSeq).toBe(3);
  });

  test('rejects an unsafe-create/use/safe-restore schema transaction', () => {
    defineForeignKeyFenceTables(db);
    db.insert('parents', { id: 'parent', name: 'Parent' });
    db.insert('children', { id: 'child', parent_id: 'parent' });
    const before = db.getChangesAfter(0);
    const observed: Change[] = [];
    db.onChange((change) => observed.push(change));

    expect(() => db.transaction(() => {
      rebuildChildrenWithDeleteAction(db, 'CASCADE');
      db.delete('parents', 'parent');
      // The unsafe cascade already removed the child. Restoring an apparently
      // safe final schema must not let that hidden side effect commit.
      rebuildChildrenWithDeleteAction(db, 'NO ACTION');
    })).toThrow('cannot combine schema changes with tracked changes');

    expect(db.queryOne('parents', 'parent')).toEqual({ id: 'parent', name: 'Parent' });
    expect(db.queryOne('children', 'child')).toEqual({
      id: 'child', parent_id: 'parent',
    });
    expect(db.prepare('PRAGMA main.foreign_key_list(children)').all()[0]).toMatchObject({
      on_delete: 'NO ACTION',
    });
    expect(db.currentSeq).toBe(2);
    expect(db.getChangesAfter(0)).toEqual(before);
    expect(observed).toEqual([]);

    db.update('children', 'child', { parent_id: 'parent' });
    expect(db.currentSeq).toBe(3);
  });

  test('rolls back main and temporary triggers added to owned tables in a transaction', () => {
    for (const trigger of [
      `CREATE TRIGGER unsafe_main_owned_trigger
       BEFORE INSERT ON _changes BEGIN SELECT 1; END`,
      `CREATE TEMP TRIGGER unsafe_temp_owned_trigger
       BEFORE INSERT ON main._changes BEGIN SELECT 1; END`,
    ]) {
      expect(() => db.transaction(() => db.exec(trigger)))
        .toThrow('owned log trigger');
    }

    expect(db.prepare(`
      SELECT name FROM main.sqlite_schema
      WHERE name = 'unsafe_main_owned_trigger'
    `).get()).toBeNull();
    expect(db.prepare(`
      SELECT name FROM temp.sqlite_schema
      WHERE name = 'unsafe_temp_owned_trigger'
    `).get()).toBeNull();
  });

  test('internal change recording requires a transaction and internal table', () => {
    expect(() => db.recordInternalChange({
      table: '_state',
      op: 'INSERT',
      rowId: 'one',
      row: { value: 1 },
    })).toThrow('active transaction');

    expect(() => db.transaction(() => db.recordInternalChange({
      table: 'todos',
      op: 'INSERT',
      rowId: 'one',
      row: { value: 1 },
    }))).toThrow('underscore-prefixed');
    expect(db.currentSeq).toBe(0);
  });

  test('rejects non-string internal row ids and rolls back preceding raw DML', () => {
    db.exec('CREATE TABLE IF NOT EXISTS _state_row_ids (id TEXT PRIMARY KEY)');

    expect(() => db.transaction(() => {
      db.exec("INSERT INTO _state_row_ids (id) VALUES ('one')");
      db.recordInternalChange({
        table: '_state_row_ids',
        op: 'INSERT',
        rowId: 1 as unknown as string,
        row: { id: 'one' },
      });
    })).toThrow('non-empty string row id');

    expect(db.prepare('SELECT * FROM _state_row_ids').all()).toEqual([]);
    expect(db.currentSeq).toBe(0);
    expect(db.getChangesAfter(0)).toEqual([]);
  });

  test('internal change recording joins the surrounding raw mutation commit', () => {
    db.exec('CREATE TABLE IF NOT EXISTS _state (id TEXT PRIMARY KEY, value TEXT)');
    const insert = db.prepare('INSERT INTO _state (id, value) VALUES (?, ?)');
    const observed: Change[] = [];
    db.onChange((change) => observed.push(change));

    try {
      db.transaction(() => {
        insert.run('one', 'value');
        db.recordInternalChange({
          table: '_state',
          op: 'INSERT',
          rowId: 'one',
          row: { id: 'one', value: 'value' },
        });
        expect(observed).toEqual([]);
      });
    } finally {
      insert.finalize();
    }

    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      seq: 1,
      table: '_state',
      op: 'INSERT',
      rowId: 'one',
    });
  });

  test('rejects non-canonical internal event shapes and rolls back raw mutations', () => {
    db.exec('CREATE TABLE IF NOT EXISTS _state (id TEXT PRIMARY KEY, value TEXT)');
    const insert = db.prepare('INSERT INTO _state (id, value) VALUES (?, ?)');
    const count = db.prepare('SELECT COUNT(*) AS count FROM _state');
    const invalidChanges = [
      { op: 'INSERT' as const },
      { op: 'INSERT' as const, row: { id: 'one' }, previousRow: { id: 'old' } },
      { op: 'UPDATE' as const, row: { id: 'one' } },
      { op: 'UPDATE' as const, previousRow: { id: 'old' } },
      { op: 'DELETE' as const },
      { op: 'DELETE' as const, row: { id: 'one' }, previousRow: { id: 'old' } },
    ];

    try {
      for (const [index, change] of invalidChanges.entries()) {
        expect(() => db.transaction(() => {
          const rowId = `invalid-${index}`;
          insert.run(rowId, 'value');
          db.recordInternalChange({
            table: '_state',
            rowId,
            ...change,
          });
        })).toThrow('canonical v1 row/previousRow shape');
        expect(count.get()).toEqual({ count: 0 });
        expect(db.currentSeq).toBe(0);
        expect(db.getChangesAfter(0)).toEqual([]);
      }
    } finally {
      insert.finalize();
      count.finalize();
    }
  });

  test('rejects non-object and non-serializable internal event payloads', () => {
    db.exec('CREATE TABLE IF NOT EXISTS _state (id TEXT PRIMARY KEY, value TEXT)');
    const insert = db.prepare('INSERT INTO _state (id, value) VALUES (?, ?)');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const sparse: unknown[] = [];
    sparse.length = 1;
    const extraProperty: unknown[] & { extra?: string } = [];
    extraProperty.extra = 'not encoded';
    const symbolProperty: unknown[] = [];
    Object.defineProperty(symbolProperty, Symbol('hidden'), { value: true });
    const invalidRows: unknown[] = [
      0,
      false,
      'row',
      [],
      [1],
      cyclic,
      { nested: sparse },
      { nested: extraProperty },
      { nested: symbolProperty },
      { value: -0 },
    ];

    try {
      for (const [index, row] of invalidRows.entries()) {
        expect(() => db.transaction(() => {
          const rowId = `invalid-payload-${index}`;
          insert.run(rowId, 'value');
          db.recordInternalChange({
            table: '_state',
            op: 'INSERT',
            rowId,
            row: row as any,
          });
        })).toThrow('canonical v1 row/previousRow shape');
      }
    } finally {
      insert.finalize();
    }

    expect(db.prepare('SELECT COUNT(*) AS count FROM _state').get())
      .toEqual({ count: 0 });
    expect(db.currentSeq).toBe(0);
    expect(db.getChangesAfter(0)).toEqual([]);
  });

  test('exec creates internal tables', () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS _credentials (
        user_id TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL
      )
    `);

    // Should be queryable via prepare
    const stmt = db.prepare('SELECT * FROM _credentials');
    expect(stmt.all()).toEqual([]);
  });

  test('prepare returns usable statement', () => {
    db.exec('CREATE TABLE IF NOT EXISTS _kv (key TEXT PRIMARY KEY, value TEXT)');
    const insert = db.prepare('INSERT INTO _kv (key, value) VALUES (?, ?)');
    const get = db.prepare('SELECT value FROM _kv WHERE key = ?');

    insert.run('theme', 'dark');
    const result = get.get('theme') as { value: string };
    expect(result.value).toBe('dark');
  });
});

// ─── Multi-table ──────────────────────────────────────────────────────────

describe('multi-table', () => {
  test('changes from different tables have independent tracking', () => {
    db.defineTable('users', {
      id: 'text primary key',
      name: 'text not null',
    });

    const changes: Change[] = [];
    db.onChange((c) => changes.push(c));

    db.insert('todos', { id: '1', title: 'Todo 1', done: 0 });
    db.insert('users', { id: 'u1', name: 'Alice' });

    expect(changes).toHaveLength(2);
    expect(changes[0].table).toBe('todos');
    expect(changes[1].table).toBe('users');

    // Seq is global across tables
    expect(changes[0].seq).toBe(1);
    expect(changes[1].seq).toBe(2);
  });

  test('query only returns rows from specified table', () => {
    db.defineTable('users', {
      id: 'text primary key',
      name: 'text not null',
    });

    db.insert('todos', { id: '1', title: 'Todo', done: 0 });
    db.insert('users', { id: 'u1', name: 'Alice' });

    expect(db.query('todos')).toHaveLength(1);
    expect(db.query('users')).toHaveLength(1);
  });
});

// ─── File mode ────────────────────────────────────────────────────────────

describe('file mode', () => {
  test('supports an explicit destructive change-history reset on restart', () => {
    const path = `/tmp/test-reactive-db-${Date.now()}.db`;

    // First instance: write some data
    const db1 = createReactiveDB({ mode: path });
    db1.defineTable('items', { id: 'text primary key', name: 'text' });
    const firstEpoch = db1.syncEpoch;
    db1.insert('items', { id: '1', name: 'Widget' });
    expect(db1.getChangesAfter(0)).toHaveLength(1);
    db1.dispose();

    // Second instance: explicitly reset replay history while retaining app data.
    const db2 = createReactiveDB({ mode: path, clearChangesOnStart: true });
    db2.defineTable('items', { id: 'text primary key', name: 'text' });
    expect(db2.syncEpoch).not.toBe(firstEpoch);

    // Data still there
    expect(db2.queryOne('items', '1')).toEqual({ id: '1', name: 'Widget' });

    // Retained history was discarded without reusing its durable cursor.
    // Callers behind the pruning watermark must take a fresh snapshot.
    expect(db2.getChangesAfter(0)).toBeNull();
    expect(db2.getChangesAfter(1)).toEqual([]);
    expect(db2.currentSeq).toBe(1);

    const next = db2.insert('items', { id: '2', name: 'Next' });
    expect(next.seq).toBe(2);
    expect(db2.getChangesAfter(1)?.map((change) => change.seq)).toEqual([2]);

    db2.dispose();

    // Cleanup
    try {
      const fs = require('fs');
      fs.unlinkSync(path);
      fs.unlinkSync(`${path}-wal`);
      fs.unlinkSync(`${path}-shm`);
    } catch {
      // Files may not exist
    }
  });

  test('retains change history and continues its sequence across reopen by default', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-reactive-reopen-'));
    const path = join(directory, 'app.sqlite');
    let first: ReactiveDB | undefined;
    let second: ReactiveDB | undefined;

    try {
      first = createReactiveDB({ mode: path });
      first.defineTable('items', { id: 'text primary key', name: 'text' });
      const firstEpoch = first.syncEpoch;
      expect(first.insert('items', { id: '1', name: 'First' }).seq).toBe(1);
      first.dispose();
      first = undefined;

      second = createReactiveDB({ mode: path });
      second.defineTable('items', { id: 'text primary key', name: 'text' });

      expect(second.syncEpoch).not.toBe(firstEpoch);
      expect(second.currentSeq).toBe(1);
      expect(second.getChangesAfter(0)?.map((change) => change.seq)).toEqual([1]);
      expect(second.insert('items', { id: '2', name: 'Second' }).seq).toBe(2);
      expect(second.getChangesAfter(0)?.map((change) => change.seq)).toEqual([1, 2]);
    } finally {
      second?.dispose();
      first?.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('migrates a retained legacy change log without reusing its highest sequence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-reactive-sequence-migration-'));
    const path = join(directory, 'app.sqlite');
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
      legacy.prepare(`
        INSERT INTO _changes (seq, tbl, op, row_id, data, ts)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(41, 'items', 'INSERT', 'legacy', '{"id":"legacy","name":"Legacy"}', 1);
    } finally {
      legacy.close();
    }

    const reactive = createReactiveDB({ mode: path });
    try {
      reactive.defineTable('items', { id: 'text primary key', name: 'text' });

      expect(reactive.currentSeq).toBe(41);
      const change = reactive.insert('items', { id: 'next', name: 'Next' });
      expect(change.seq).toBe(42);
      expect(reactive.getChangesAfter(41)?.map((entry) => entry.seq)).toEqual([42]);

      const columns = reactive.prepare('PRAGMA table_info(_changes)').all() as Array<{ name: string }>;
      expect(columns.some((column) => column.name === 'previous_data')).toBe(true);
      expect(columns.some((column) => column.name === 'origin')).toBe(true);
    } finally {
      reactive.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('coordinates insert, update, delete, and rollback sequences across connections', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-reactive-multi-connection-'));
    const path = join(directory, 'app.sqlite');
    let first: ReactiveDB | undefined;
    let second: ReactiveDB | undefined;

    try {
      first = createReactiveDB({
        mode: path,
        clearChangesOnStart: false,
        busyTimeout: 10_000,
      });
      second = createReactiveDB({
        mode: path,
        clearChangesOnStart: false,
        busyTimeout: 10_000,
      });
      const schema = { id: 'text primary key', name: 'text not null' };
      first.defineTable('items', schema);
      second.defineTable('items', schema);

      const changes = [
        first.insert('items', { id: 'first', name: 'First' }),
        second.insert('items', { id: 'second', name: 'Second' }),
        first.update('items', 'first', { name: 'First updated' }),
        second.update('items', 'second', { name: 'Second updated' }),
        first.delete('items', 'second'),
        second.delete('items', 'first'),
      ];

      expect(changes.map((change) => change?.seq)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(changes.map((change) => change?.op)).toEqual([
        'INSERT',
        'INSERT',
        'UPDATE',
        'UPDATE',
        'DELETE',
        'DELETE',
      ]);
      expect(first.currentSeq).toBe(6);
      expect(second.currentSeq).toBe(6);
      expect(first.getChangesAfter(0)?.map((change) => change.seq)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(second.getChangesAfter(0)?.map((change) => change.seq)).toEqual([1, 2, 3, 4, 5, 6]);

      expect(() => second!.transaction(() => {
        second!.insert('items', { id: 'rolled-back', name: 'Rolled back' });
        throw new Error('abort shared transaction');
      })).toThrow('abort shared transaction');

      expect(first.currentSeq).toBe(6);
      expect(second.currentSeq).toBe(6);
      expect(first.queryOne('items', 'rolled-back')).toBeNull();
      expect(first.insert('items', { id: 'after', name: 'After rollback' }).seq).toBe(7);
    } finally {
      second?.dispose();
      first?.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('fans out external changes once while keeping local delivery synchronous', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-reactive-replica-fanout-'));
    const path = join(directory, 'app.sqlite');
    let first: ReactiveDB | undefined;
    let second: ReactiveDB | undefined;

    try {
      first = createReactiveDB({ mode: path, busyTimeout: 10_000 });
      second = createReactiveDB({ mode: path, busyTimeout: 10_000 });
      const schema = { id: 'text primary key', name: 'text not null' };
      first.defineTable('items', schema);
      second.defineTable('items', schema);

      const observed: Change[] = [];
      second.onChange((change) => observed.push(change));
      const stop = second.startExternalChangePolling({ intervalMs: 10 });

      first.insert('items', { id: 'external', name: 'Other writer' });
      await waitUntil(() => observed.some((change) => change.rowId === 'external'));

      second.insert('items', { id: 'local', name: 'This writer' });
      expect(observed.filter((change) => change.rowId === 'local')).toHaveLength(1);
      await new Promise((resolve) => setTimeout(resolve, 35));
      expect(observed.filter((change) => change.rowId === 'external')).toHaveLength(1);
      expect(observed.filter((change) => change.rowId === 'local')).toHaveLength(1);
      stop();
    } finally {
      second?.dispose();
      first?.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('drains a pending external sequence before a synchronous local commit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-reactive-replica-order-'));
    const path = join(directory, 'app.sqlite');
    let first: ReactiveDB | undefined;
    let second: ReactiveDB | undefined;

    try {
      first = createReactiveDB({ mode: path, busyTimeout: 10_000 });
      second = createReactiveDB({ mode: path, busyTimeout: 10_000 });
      const schema = { id: 'text primary key', name: 'text not null' };
      first.defineTable('items', schema);
      second.defineTable('items', schema);

      const observed: Array<{
        change: Change;
        delivery: ChangeDeliveryMetadata;
      }> = [];
      second.onChange((change, delivery) => observed.push({ change, delivery }));
      const stop = second.startExternalChangePolling({ intervalMs: 50 });

      first.insert('items', { id: 'external', name: 'Other writer' });
      second.insert('items', { id: 'local', name: 'This writer' });

      expect(observed.map(({ change }) => [change.seq, change.rowId])).toEqual([
        [1, 'external'],
        [2, 'local'],
      ]);
      expect(observed.map(({ delivery }) => delivery.source)).toEqual([
        'external',
        'local',
      ]);
      await new Promise((resolve) => setTimeout(resolve, 65));
      expect(observed).toHaveLength(2);
      stop();
    } finally {
      second?.dispose();
      first?.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('observes a remote policy-owning revoke before a dependent local row', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-reactive-policy-order-'));
    const path = join(directory, 'app.sqlite');
    let first: ReactiveDB | undefined;
    let second: ReactiveDB | undefined;

    try {
      first = createReactiveDB({ mode: path, busyTimeout: 10_000 });
      second = createReactiveDB({ mode: path, busyTimeout: 10_000 });
      const roomSchema = { room_id: 'text primary key', name: 'text not null' };
      const memberSchema = {
        membership_id: 'text primary key',
        room_id: 'text not null',
        user_id: 'text not null',
      };
      first.defineTable('rooms', roomSchema);
      first.defineTable('room_members', memberSchema);
      second.defineTable('rooms', roomSchema);
      second.defineTable('room_members', memberSchema);
      first.transaction(() => {
        first!.insert('rooms', { room_id: 'room', name: 'Before revoke' });
        first!.insert('room_members', {
          membership_id: 'membership', room_id: 'room', user_id: 'user',
        });
      });

      let membershipVisible = true;
      let leakedRoomUpdate = false;
      const observed: string[] = [];
      second.onChange((change) => {
        observed.push(change.rowId);
        if (change.table === 'room_members' && change.op === 'DELETE') {
          membershipVisible = false;
        }
        if (change.table === 'rooms' && membershipVisible) {
          leakedRoomUpdate = true;
        }
      });
      second.startExternalChangePolling({ intervalMs: 50 });

      first.delete('room_members', 'membership');
      second.update('rooms', 'room', { name: 'After revoke' });

      expect(observed).toEqual(['membership', 'room']);
      expect(membershipVisible).toBe(false);
      expect(leakedRoomUpdate).toBe(false);
    } finally {
      second?.dispose();
      first?.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('rejects corrupt retained JSON before the runtime becomes ready', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-reactive-corrupt-startup-'));
    const path = join(directory, 'app.sqlite');
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
          origin TEXT
        )
      `);
      legacy.run(`
        INSERT INTO _changes
          (seq, tbl, op, row_id, data, previous_data, ts, origin)
        VALUES (1, 'items', 'INSERT', 'corrupt', '{invalid-json', NULL, 1, NULL)
      `);
    } finally {
      legacy.close();
    }

    try {
      expect(() => createReactiveDB({ mode: path })).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('binds application reads to one represented durable sequence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-reactive-read-snapshot-'));
    const path = join(directory, 'app.sqlite');
    let writer: ReactiveDB | undefined;
    let reader: ReactiveDB | undefined;

    try {
      writer = createReactiveDB({ mode: path, busyTimeout: 10_000 });
      reader = createReactiveDB({ mode: path, busyTimeout: 10_000 });
      const schema = { id: 'text primary key', name: 'text not null' };
      writer.defineTable('items', schema);
      reader.defineTable('items', schema);
      writer.insert('items', { id: 'item', name: 'Before' });

      const snapshot = reader.readAtCurrentSequence(() => {
        writer!.update('items', 'item', { name: 'After' });
        return reader!.queryOne('items', 'item');
      });

      expect(snapshot.seq).toBe(1);
      expect(snapshot.value?.name).toBe('Before');
      expect(reader.currentSeq).toBe(2);
      expect(reader.queryOne('items', 'item')?.name).toBe('After');
    } finally {
      reader?.dispose();
      writer?.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('reports a replica retention gap instead of silently skipping changes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-reactive-replica-gap-'));
    const path = join(directory, 'app.sqlite');
    let first: ReactiveDB | undefined;
    let second: ReactiveDB | undefined;

    try {
      first = createReactiveDB({ mode: path, ringBufferDepth: 2, busyTimeout: 10_000 });
      second = createReactiveDB({ mode: path, ringBufferDepth: 2, busyTimeout: 10_000 });
      const schema = { id: 'text primary key', name: 'text not null' };
      first.defineTable('items', schema);
      second.defineTable('items', schema);

      let observedGap: {
        kind: 'retention' | 'continuity' | 'format';
        afterSeq: number;
        oldestSeq: number;
        currentSeq: number;
      } | null = null;
      second.startExternalChangePolling({
        intervalMs: 50,
        onGap: (gap) => { observedGap = gap; },
      });
      for (let index = 1; index <= 4; index += 1) {
        first.insert('items', { id: String(index), name: `Item ${index}` });
      }

      await waitUntil(() => observedGap !== null);
      expect(observedGap as {
        kind: 'retention' | 'continuity' | 'format';
        afterSeq: number;
        oldestSeq: number;
        currentSeq: number;
      } | null).toEqual({ kind: 'retention', afterSeq: 0, oldestSeq: 3, currentSeq: 4 });
    } finally {
      second?.dispose();
      first?.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('allocates collision-free monotonic sequences from concurrent processes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-reactive-multi-process-'));
    const path = join(directory, 'app.sqlite');
    const moduleUrl = new URL('./reactive-db.ts', import.meta.url).href;
    const writerSource = `
      import { createReactiveDB } from ${JSON.stringify(moduleUrl)};

      const [, path, writerId, startAtValue] = Bun.argv;
      const database = createReactiveDB({
        mode: path,
        clearChangesOnStart: false,
        busyTimeout: 10_000,
      });
      database.defineTable('items', {
        id: 'text primary key',
        value: 'text not null',
      });
      await Bun.sleep(Math.max(0, Number(startAtValue) - Date.now()));
      for (let index = 0; index < 20; index += 1) {
        const id = writerId + '-' + index;
        database.insert('items', { id, value: 'created' });
        database.update('items', id, { value: 'updated' });
        database.delete('items', id);
      }
      database.dispose();
    `;

    try {
      const startAt = String(Date.now() + 300);
      const writers = ['one', 'two'].map((writerId) => Bun.spawn([
        process.execPath,
        '-e',
        writerSource,
        path,
        writerId,
        startAt,
      ], {
        cwd: process.cwd(),
        env: Bun.env,
        stdout: 'pipe',
        stderr: 'pipe',
      }));

      const results = await Promise.all(writers.map(async (writer) => {
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(writer.stdout).text(),
          new Response(writer.stderr).text(),
          writer.exited,
        ]);
        return { stdout, stderr, exitCode };
      }));
      for (const result of results) {
        expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
      }

      const observer = createReactiveDB({ mode: path, clearChangesOnStart: false });
      try {
        observer.defineTable('items', {
          id: 'text primary key',
          value: 'text not null',
        });
        const changes = observer.getChangesAfter(0);
        const expectedSequences = Array.from({ length: 120 }, (_, index) => index + 1);

        expect(observer.currentSeq).toBe(120);
        expect(changes?.map((change) => change.seq)).toEqual(expectedSequences);
        expect(new Set(changes?.map((change) => change.seq)).size).toBe(120);
        expect(changes?.filter((change) => change.op === 'INSERT')).toHaveLength(40);
        expect(changes?.filter((change) => change.op === 'UPDATE')).toHaveLength(40);
        expect(changes?.filter((change) => change.op === 'DELETE')).toHaveLength(40);
        expect(observer.query('items')).toEqual([]);
      } finally {
        observer.dispose();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// ─── Platform Persistence Foundation ─────────────────────────────────────

describe('platform SQLite integration', () => {
  test('uses an injected platform SQLite service without owning its lifecycle', () => {
    const sqlite = createPlatformSQLiteService({ mode: 'ephemeral' });
    const first = createReactiveDB({ sqlite });

    first.defineTable('items', { id: 'text primary key', name: 'text' });
    first.insert('items', { id: '1', name: 'Shared handle' });
    expect(first.queryOne('items', '1')).toEqual({ id: '1', name: 'Shared handle' });
    first.dispose();

    const second = createReactiveDB({ sqlite });
    second.defineTable('items', { id: 'text primary key', name: 'text' });
    expect(second.currentSeq).toBe(1);
    expect(second.getChangesAfter(0)?.map((change) => change.seq)).toEqual([1]);
    second.dispose();

    expect(() => sqlite.raw.prepare('SELECT 1 AS ok').get()).not.toThrow();
    sqlite.close();
  });

  test('does not close an injected raw database by default', () => {
    const raw = new Database(':memory:');
    const first = createReactiveDB({ database: raw });

    first.defineTable('items', { id: 'text primary key', name: 'text' });
    first.insert('items', { id: '1', name: 'Raw handle' });
    first.dispose();

    const second = createReactiveDB({ database: raw });
    second.defineTable('items', { id: 'text primary key', name: 'text' });
    expect(second.currentSeq).toBe(1);
    expect(second.getChangesAfter(0)?.map((change) => change.seq)).toEqual([1]);
    second.dispose();

    expect(() => raw.prepare('SELECT 1 AS ok').get()).not.toThrow();
    raw.close();
  });

  test('routes owned hot mode through the platform snapshot service', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zero-reactive-hot-'));
    const dbPath = join(dir, 'app.db');
    const snapshotPath = join(dir, 'app.snapshot.db');

    try {
      const first = createReactiveDB({
        mode: 'hot',
        path: dbPath,
        snapshotPath,
        snapshotIntervalMs: 60_000,
      });
      first.defineTable('items', { id: 'text primary key', name: 'text' });
      first.insert('items', { id: '1', name: 'Hot row' });
      first.dispose();

      const second = createReactiveDB({
        mode: 'hot',
        path: dbPath,
        snapshotPath,
        snapshotIntervalMs: 60_000,
      });
      second.defineTable('items', { id: 'text primary key', name: 'text' });

      expect(second.queryOne('items', '1')).toEqual({ id: '1', name: 'Hot row' });
      expect(second.currentSeq).toBe(1);
      expect(second.getChangesAfter(0)?.map((change) => change.seq)).toEqual([1]);
      second.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
