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
