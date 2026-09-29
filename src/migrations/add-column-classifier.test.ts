import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import type { TableSchema } from '../sync/types';
import { classifyAddColumnDefinition } from './add-column-classifier';
import { inspectDatabaseSchema } from './schema-inspector';
import { createMigrationPlan } from './migration-planner';

interface AddColumnCase {
  readonly definition: string;
  readonly safety: 'safe' | 'guarded';
  readonly defaultKind: ReturnType<typeof classifyAddColumnDefinition>['defaultKind'];
}

const emittedCases: readonly AddColumnCase[] = [
  { definition: 'text', safety: 'safe', defaultKind: 'absent' },
  { definition: "text default 'CURRENT_TIMESTAMP'", safety: 'safe', defaultKind: 'literal' },
  { definition: 'text default abc', safety: 'safe', defaultKind: 'literal' },
  { definition: 'text default GENERATED', safety: 'safe', defaultKind: 'literal' },
  {
    definition: 'text constraint generated default 1',
    safety: 'safe',
    defaultKind: 'literal',
  },
  { definition: 'integer default TRUE', safety: 'safe', defaultKind: 'literal' },
  { definition: 'real default .5', safety: 'safe', defaultKind: 'literal' },
  { definition: 'real default 1.', safety: 'safe', defaultKind: 'literal' },
  { definition: 'real default 1.5e+2', safety: 'safe', defaultKind: 'literal' },
  { definition: 'integer default 0x12', safety: 'safe', defaultKind: 'literal' },
  { definition: "blob default X'abcd'", safety: 'safe', defaultKind: 'literal' },
  { definition: 'integer default -/**/1', safety: 'safe', defaultKind: 'literal' },
  { definition: 'real default -1.5e-2', safety: 'safe', defaultKind: 'literal' },
  { definition: 'integer default +0x12', safety: 'safe', defaultKind: 'literal' },
  {
    definition: 'text references parent(id) on delete set/**/default',
    safety: 'safe',
    defaultKind: 'absent',
  },
  {
    definition: 'text references parent(id) on update set default default/**/null',
    safety: 'safe',
    defaultKind: 'null',
  },
  {
    definition: 'text default null references parent(id) on delete set default',
    safety: 'safe',
    defaultKind: 'null',
  },
  {
    definition: 'text default/**/null references parent(id) on update set/**/default',
    safety: 'safe',
    defaultKind: 'null',
  },
  {
    definition: "text check ('generated always as' <> '')",
    safety: 'guarded',
    defaultKind: 'absent',
  },
  {
    definition: "text not/**/null default 'ready'",
    safety: 'guarded',
    defaultKind: 'literal',
  },
  {
    definition: 'integer default 0 check (pending >= 0)',
    safety: 'guarded',
    defaultKind: 'literal',
  },
  { definition: 'text collate nocase', safety: 'guarded', defaultKind: 'absent' },
];

const omittedDefinitions = [
  'text primary/**/key',
  'text unique',
  'integer autoincrement',
  'text default current_time',
  'text default current_date',
  'text default current_timestamp',
  'integer default (1)',
  'text not null',
  'text -- ALTER schema rewriting cannot retain line comments\r hidden\n null',
  'text -- LF ends the comment\r\n not null',
  'text not null default null',
  "text references parent(id) default 'missing'",
  'text references parent(id) on delete set default not null',
  "text references parent(id) on delete set default default 'missing'",
  'integer generated always as (1) virtual',
  'integer generated always as (1) stored',
  'integer as (1)',
  'text default',
  'text default -CURRENT_TIMESTAMP',
  'text default +CURRENT_TIMESTAMP',
  'text default -abc',
  'text default random()',
  'blob default zeroblob(1)',
  'text default CURRENT_TIMESTAMP()',
  'integer default 1+2',
  'integer default 1 + 2',
  'integer default 1-2',
  'integer default 1 - 2',
  'integer default 1*2',
  'integer default 1/2',
  'text default 1||2',
  'integer default ~1',
  'text default SELECT',
  'text default CASE',
  "text default 'missing' references parent(id) on delete set default",
] as const;

describe('SQLite ADD COLUMN admission', () => {
  test('classifies executable definitions without reading quoted or nested constraint text', () => {
    for (const item of emittedCases) {
      expect(classifyAddColumnDefinition(item.definition)).toEqual({
        emit: true,
        safety: item.safety,
        defaultKind: item.defaultKind,
      });
    }
  });

  test('omits unsupported SQLite forms and every generated column form', () => {
    for (const definition of omittedDefinitions) {
      expect(classifyAddColumnDefinition(definition)).toEqual(expect.objectContaining({
        emit: false,
        safety: 'guarded',
      }));
    }
  });

  test('uses the same classification for findings and executable planner output', () => {
    for (const item of emittedCases) {
      const db = createPopulatedDatabase();
      try {
        const plan = createPendingColumnPlan(db, item.definition);
        expect(plan.issues).toContainEqual(expect.objectContaining({
          kind: 'missing-column',
          column: 'pending',
          safety: item.safety,
        }));

        const statement = plan.statements.find((candidate) =>
          candidate.sql.includes('ADD COLUMN "pending"'));
        expect(statement).toEqual(expect.objectContaining({ safety: item.safety }));
        expect(() => db.run(statement!.sql)).not.toThrow();

        const pending = db.query('PRAGMA table_xinfo(records)').all()
          .find((column) => (column as { name?: unknown }).name === 'pending') as
            | { hidden?: unknown }
            | undefined;
        expect(pending?.hidden).toBe(0);
      } finally {
        db.close();
      }
    }
  });

  test('never emits definitions outside direct-add admission', () => {
    for (const definition of omittedDefinitions) {
      const db = createPopulatedDatabase();
      try {
        const plan = createPendingColumnPlan(db, definition);
        expect(plan.issues).toContainEqual(expect.objectContaining({
          kind: 'missing-column',
          column: 'pending',
          safety: 'guarded',
        }));
        expect(plan.statements.some((statement) =>
          statement.sql.includes('ADD COLUMN "pending"'))).toBe(false);
      } finally {
        db.close();
      }
    }
  });

  test('omits SQLite-supported virtual columns because Fabric rejects hidden realm columns', () => {
    const db = createPopulatedDatabase();
    try {
      db.run('ALTER TABLE records ADD COLUMN direct_virtual integer as (1)');
      const virtual = db.query('PRAGMA table_xinfo(records)').all()
        .find((column) => (column as { name?: unknown }).name === 'direct_virtual') as
          | { hidden?: unknown }
          | undefined;
      expect(virtual?.hidden).toBe(2);

      const plan = createPendingColumnPlan(db, 'integer as (1)');
      expect(plan.statements.some((statement) =>
        statement.sql.includes('ADD COLUMN "pending"'))).toBe(false);
    } finally {
      db.close();
    }
  });

  test('emits data-dependent CHECK additions as guarded and lets SQLite enforce the scan', () => {
    const db = createPopulatedDatabase();
    try {
      const plan = createPendingColumnPlan(
        db,
        'integer default -1 check (pending >= 0)',
      );
      const statement = plan.statements.find((candidate) =>
        candidate.sql.includes('ADD COLUMN "pending"'));
      expect(statement?.safety).toBe('guarded');
      expect(() => db.run(statement!.sql)).toThrow();
    } finally {
      db.close();
    }
  });
});

function createPopulatedDatabase(): Database {
  const db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  db.run('CREATE TABLE parent (id text primary key)');
  db.run('CREATE TABLE records (record_id text primary key)');
  db.run("INSERT INTO records (record_id) VALUES ('existing')");
  return db;
}

function createPendingColumnPlan(db: Database, definition: string) {
  const schema: TableSchema = {
    record_id: 'text primary key',
    pending: definition,
  };
  return createMigrationPlan(
    { records: schema },
    inspectDatabaseSchema(db, { includeInternal: false }),
  );
}
