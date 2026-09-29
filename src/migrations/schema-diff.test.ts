/**
 * schema-diff.test.ts
 *
 * Verifies schema inspection, diffing, and draft migration planning. Migrator
 * execution behavior is covered separately.
 */

import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { inspectDatabaseSchema } from './schema-inspector';
import { createMigrationPlan } from './migration-planner';
import { diffSchemaSnapshots } from './schema-diff';
import { snapshotDeclaredTables } from './schema-snapshot';

let db: Database | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

describe('schema inspection and diffing', () => {
  test('captures complete declared default expressions without reading constraint text', () => {
    const tables = {
      records: {
        record_id: 'text primary key',
        quoted: "text default 'not null' not null",
        expression: "text default (json_object('not null', 1)) not null",
        commented: "text default/**/'ready' not null",
        nested: 'integer default ((1 + 2)) check (nested > 0)',
        signed_space: 'integer default - 1',
        signed_comment: 'integer default +/**/1',
        signed_line: 'integer default - -- gap\n 1',
        unicode: 'text default \u00a0value',
        keyword_literal: 'text default GENERATED',
      },
    };
    const snapshot = snapshotDeclaredTables(tables);

    expect(snapshot.tables.records.columns.quoted.defaultValue)
      .toBe("'not null'");
    expect(snapshot.tables.records.columns.expression.defaultValue)
      .toBe("json_object('not null', 1)");
    expect(snapshot.tables.records.columns.commented.defaultValue)
      .toBe("'ready'");
    expect(snapshot.tables.records.columns.nested.defaultValue)
      .toBe('(1 + 2)');
    expect(snapshot.tables.records.columns.signed_space.defaultValue)
      .toBe('- 1');
    expect(snapshot.tables.records.columns.signed_comment.defaultValue)
      .toBe('+/**/1');
    expect(snapshot.tables.records.columns.signed_line.defaultValue)
      .toBe('- -- gap\n 1');
    expect(snapshot.tables.records.columns.unicode.defaultValue)
      .toBe('\u00a0value');
    expect(snapshot.tables.records.columns.keyword_literal.defaultValue)
      .toBe('GENERATED');

    db = new Database(':memory:');
    const columnSql = Object.entries(tables.records)
      .map(([name, definition]) => `"${name}" ${definition}`)
      .join(', ');
    db.run(`CREATE TABLE records (${columnSql})`);
    const actual = inspectDatabaseSchema(db, { includeInternal: false });
    for (const column of [
      'quoted', 'expression', 'commented', 'nested', 'signed_space',
      'signed_comment', 'signed_line', 'unicode',
      'keyword_literal',
    ]) {
      expect(snapshot.tables.records.columns[column].defaultValue)
        .toBe(actual.tables.records.columns[column].defaultValue);
    }
  });

  test('does not confuse foreign-key SET DEFAULT actions with column defaults', () => {
    const declared = snapshotDeclaredTables({
      records: {
        record_id: 'text primary key',
        action_only: 'text references parent(id) on delete set/**/default',
        action_then_default:
          'text references parent(id) on update set default default/**/null',
      },
    });

    expect(declared.tables.records.columns.action_only.defaultValue).toBeNull();
    expect(declared.tables.records.columns.action_then_default.defaultValue).toBe('null');

    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    db.run('CREATE TABLE parent (id text primary key)');
    db.run(`CREATE TABLE records (
      record_id text primary key,
      action_only text references parent(id) on delete set/**/default,
      action_then_default text references parent(id) on update set default default/**/null
    )`);
    const actual = inspectDatabaseSchema(db, { includeInternal: false });
    expect(declared.tables.records.columns.action_only.defaultValue)
      .toBe(actual.tables.records.columns.action_only.defaultValue);
    expect(declared.tables.records.columns.action_then_default.defaultValue)
      .toBe(actual.tables.records.columns.action_then_default.defaultValue);
  });

  test('normalizes SQL structure without collapsing quoted literal differences', () => {
    const declared = snapshotDeclaredTables({
      records: {
        record_id: 'text primary key',
        role: "text default 'admin user' check (role <> 'Admin  User')",
      },
    });
    db = new Database(':memory:');
    db.run(`CREATE TABLE records (
      record_id TEXT PRIMARY KEY,
      role TEXT DEFAULT 'Admin  User' CHECK (role <> 'admin user')
    )`);

    expect(diffSchemaSnapshots(
      declared,
      inspectDatabaseSchema(db, { includeInternal: false }),
    )).toContainEqual(expect.objectContaining({
      kind: 'changed-column',
      column: 'role',
      safety: 'manual',
    }));
  });

  test('reports no drift for matching tables with a natural identity index', () => {
    db = new Database(':memory:');
    db.run(`
      CREATE TABLE memberships (
        membership_id text primary key,
        team_id text not null,
        user_id text not null,
        role text
      )
    `);
    db.run('CREATE UNIQUE INDEX idx_memberships_identity ON memberships(team_id, user_id)');

    const declared = snapshotDeclaredTables({
      memberships: {
        membership_id: 'text primary key',
        team_id: 'text not null',
        user_id: 'text not null',
        role: 'text',
        _identity: ['team_id', 'user_id'],
      },
    });
    const actual = inspectDatabaseSchema(db, { includeInternal: false });

    expect(diffSchemaSnapshots(declared, actual)).toEqual([]);
  });

  test('generates draft SQL for missing tables, safe columns, and identity indexes', () => {
    db = new Database(':memory:');
    db.run('CREATE TABLE memberships (membership_id text primary key, team_id text not null, user_id text not null)');

    const plan = createMigrationPlan({
      memberships: {
        membership_id: 'text primary key',
        team_id: 'text not null',
        user_id: 'text not null',
        role: 'text',
        _identity: ['team_id', 'user_id'],
      },
      projects: {
        project_id: 'text primary key',
        name: 'text not null',
      },
    }, inspectDatabaseSchema(db, { includeInternal: false }));

    expect(plan.issues.map((issue) => issue.kind)).toEqual(expect.arrayContaining([
      'missing-column',
      'missing-identity-index',
      'missing-table',
    ]));
    expect(plan.statements.map((statement) => statement.sql)).toEqual(expect.arrayContaining([
      'ALTER TABLE "memberships" ADD COLUMN "role" text',
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_memberships_identity" ON "memberships" ("team_id", "user_id")',
      'CREATE TABLE IF NOT EXISTS "projects" ("project_id" text primary key, "name" text not null)',
    ]));
    expect(plan.safety).toBe('guarded');
  });

  test('never emits SQL for a column definition that escapes its generated slot', () => {
    const database = new Database(':memory:');
    db = database;
    database.run('CREATE TABLE victim (id text primary key)');

    expect(() => createMigrationPlan({
      evil: {
        id: 'text primary key); drop table victim; --',
      },
    }, inspectDatabaseSchema(database, { includeInternal: false }))).toThrow(
      '[migrator] Table "evil" column "id" must describe exactly one isolated SQL column.',
    );

    expect(database.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'victim'",
    ).get()).toEqual({ name: 'victim' });
  });

  test('classifies comment-separated constraints with the same exact grammar as planning', () => {
    db = new Database(':memory:');
    db.run('CREATE TABLE records (record_id text primary key)');

    for (const definition of [
      'text primary/**/key',
      'text not/**/null',
      "text not null check ('default' <> '')",
    ]) {
      const plan = createMigrationPlan({
        records: {
          record_id: 'text primary key',
          pending: definition,
        },
      }, inspectDatabaseSchema(db, { includeInternal: false }));

      expect(plan.issues).toContainEqual(expect.objectContaining({
        kind: 'missing-column',
        column: 'pending',
        safety: 'guarded',
      }));
      expect(plan.statements.some((statement) =>
        statement.sql.includes('ADD COLUMN "pending"'))).toBe(false);
      expect(plan.safety).toBe('guarded');
      expect(plan.needsManualReview).toBe(true);
    }
  });

  test('never labels a non-isolated missing column safe in direct schema diff output', () => {
    db = new Database(':memory:');
    db.run('CREATE TABLE records (record_id text primary key)');

    const issues = diffSchemaSnapshots(snapshotDeclaredTables({
      records: {
        record_id: 'text primary key',
        pending: 'text, injected text',
      },
    }), inspectDatabaseSchema(db, { includeInternal: false }));

    expect(issues).toContainEqual(expect.objectContaining({
      kind: 'missing-column',
      column: 'pending',
      safety: 'guarded',
    }));
  });

  test('flags composite primary keys as manual sync-table drift', () => {
    db = new Database(':memory:');
    db.run('CREATE TABLE user_properties (user_id text not null, key text not null, value text, primary key (user_id, key))');

    const issues = diffSchemaSnapshots(
      snapshotDeclaredTables({
        user_properties: {
          property_id: 'text primary key',
          user_id: 'text not null',
          key: 'text not null',
          value: 'text',
          _identity: ['user_id', 'key'],
        },
      }),
      inspectDatabaseSchema(db, { includeInternal: false }),
    );

    expect(issues.some((issue) => issue.kind === 'composite-primary-key')).toBe(true);
    expect(issues.some((issue) => issue.safety === 'manual')).toBe(true);
  });
});
