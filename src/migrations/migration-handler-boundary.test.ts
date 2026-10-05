import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { Migrator } from './migrator';
import { renderMigrationPlan } from './migration-planner';
import { createMigrationRegistry } from './migrator';

function fixture() {
  const database = new Database(':memory:');
  database.run('CREATE TABLE proof (id TEXT PRIMARY KEY)');
  return database;
}

test('up cannot commit rows or applied ledger after returning a thenable', () => {
  const database = fixture();
  const runner = new Migrator({ database, createBackups: false, log: () => undefined,
    migrations: [{ version: '001', description: 'synthetic async return', up(db) {
      db.run("INSERT INTO proof VALUES ('synthetic')");
      return Promise.resolve();
    } }],
  });
  try {
    expect(() => runner.run()).toThrow('synchronous');
    expect(database.query('SELECT count(*) AS count FROM proof').get()).toEqual({ count: 0 });
    expect(runner.status()[0]?.applied).toBe(false);
  } finally { runner.dispose(); database.close(); }
});

test('down cannot commit changes or rolled-back ledger after returning a thenable', () => {
  const database = fixture();
  const runner = new Migrator({ database, createBackups: false, allowDestructiveDown: true,
    log: () => undefined, migrations: [{ version: '001', description: 'synthetic down',
      up(db) { db.run("INSERT INTO proof VALUES ('synthetic')"); },
      down(db) { db.run('DELETE FROM proof'); return Promise.resolve(); },
    }],
  });
  try {
    runner.run();
    expect(() => runner.rollback()).toThrow('synchronous');
    expect(database.query('SELECT count(*) AS count FROM proof').get()).toEqual({ count: 1 });
    expect(runner.status()[0]?.applied).toBe(true);
  } finally { runner.dispose(); database.close(); }
});

test('native async migration handlers are rejected before they can start', () => {
  const database = fixture();
  let invoked = false;
  try {
    expect(() => new Migrator({ database, createBackups: false, log: () => undefined,
      migrations: [{ version: '001', description: 'synthetic async handler', async up() { invoked = true; } }],
    })).toThrow('synchronous');
    expect(invoked).toBe(false);
  } finally { database.close(); }
});

test('generated plans do not offer a no-op down handler as implemented rollback', () => {
  const source = renderMigrationPlan({ version: '001', description: 'synthetic plan',
    plan: { issues: [], statements: [], safety: 'safe', needsManualReview: false },
  });
  expect(source).not.toContain('down(_db: Database)');
  expect(source).toContain('Rollback is intentionally omitted');
});

test('ordinary synchronous handler results and the existing migration receiver remain supported', () => {
  const database = fixture();
  const runner = new Migrator({ database, createBackups: false, log: () => undefined,
    migrations: [{ version: '001', description: 'synthetic receiver', up(db) {
      expect(this.description).toBe('synthetic receiver');
      return db.run("INSERT INTO proof VALUES ('synthetic')");
    } }],
  });
  try { expect(runner.run()).toEqual(['001']); }
  finally { runner.dispose(); database.close(); }
});

test('generator handlers cannot record success without executing their body', () => {
  expect(() => createMigrationRegistry([{ version: '001', description: 'synthetic generator',
    *up() { yield undefined; },
  }])).toThrow('synchronous');
});

test('native async down is rejected before migration construction opens its ledger', () => {
  const database = fixture();
  let invoked = false;
  try {
    expect(() => new Migrator({ database, migrations: [{ version: '001', description: 'synthetic async down',
      up() {}, async down() { invoked = true; },
    }] })).toThrow('synchronous');
    expect(invoked).toBe(false);
    expect(database.query("SELECT name FROM sqlite_master WHERE name = '_zero_migrations'").all()).toEqual([]);
  } finally { database.close(); }
});

test('custom rejecting thenable is observed without success and the transaction remains usable', async () => {
  const database = fixture();
  let rejectAttempt = true;
  let rejectionObserved = false;
  const runner = new Migrator({ database, createBackups: false, log: () => undefined,
    migrations: [{ version: '001', description: 'synthetic custom thenable', up(db) {
      db.run("INSERT INTO proof VALUES ('synthetic')");
      if (rejectAttempt) return { then(_resolve: unknown, reject: (error: Error) => void) {
        rejectionObserved = true;
        reject(new Error('synthetic rejection'));
      } };
    } }],
  });
  try {
    expect(() => runner.run()).toThrow('synchronous');
    await Bun.sleep(0);
    expect(rejectionObserved).toBe(true);
    expect(runner.status()[0]?.applied).toBe(false);
    expect(database.query('SELECT count(*) AS count FROM proof').get()).toEqual({ count: 0 });
    rejectAttempt = false;
    expect(runner.run()).toEqual(['001']);
  } finally { runner.dispose(); database.close(); }
});

test('generated plans use the public package type and safely encode source literals/comments', () => {
  const source = renderMigrationPlan({ version: "001'quoted", description: 'synthetic plan',
    plan: { issues: [{ kind: 'missing-table', severity: 'warning', message: 'synthetic */\ninvalid', safety: 'safe' }],
      statements: [], safety: 'safe', needsManualReview: true },
  });
  expect(source).toContain("from '@zero/framework/migrations'");
  expect(source).toContain('version: "001\'quoted"');
  expect(source).not.toContain('synthetic */');
  expect(() => new Bun.Transpiler({ loader: 'ts' }).transformSync(source)).not.toThrow();
});
