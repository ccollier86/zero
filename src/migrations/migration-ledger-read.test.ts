/** Constructor-free ledger tests: owned MEMORY databases only, no paths/backups. */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { MigrationLedger, readMigrationLedgerState } from './migration-ledger';
import type { Migration } from './types';

const migration: Migration = { version: '001', description: 'synthetic', up() {} };

test('read-only ledger reader does not initialize missing or legacy-only native state', () => {
  const database = new Database(':memory:');
  try {
    database.run('PRAGMA temp_store=MEMORY');
    database.run('CREATE TABLE _migrations(version TEXT PRIMARY KEY)');
    database.run("INSERT INTO _migrations VALUES ('001')");
    database.run('PRAGMA query_only=ON');
    const before = database.serialize();
    expect(() => readMigrationLedgerState(database)).toThrow();
    expect(database.serialize()).toEqual(before);
    expect(database.query("SELECT name FROM sqlite_schema WHERE name='_zero_migrations'").get()).toBeNull();
  } finally { database.close(); }
});

test('constructor-free reader retains last successful state across failed retries and rollbacks', () => {
  const database = new Database(':memory:');
  try {
    database.run('PRAGMA temp_store=MEMORY');
    const ledger = new MigrationLedger(database);
    const event = { migration, checksum: 'synthetic-checksum', safety: 'safe' as const,
      batch: 1, durationMs: 0, schemaHash: null };
    ledger.recordApplied(event);
    ledger.recordFailed({ ...event, direction: 'down', error: 'synthetic rollback failure' });
    database.run('PRAGMA query_only=ON');
    const before = database.serialize();
    expect(readMigrationLedgerState(database)).toEqual(ledger.stateByVersion());
    expect(readMigrationLedgerState(database).get('001')).toMatchObject({ status: 'applied', direction: 'up' });
    expect(database.serialize()).toEqual(before);
    database.run('PRAGMA query_only=OFF');
    ledger.recordRolledBack({ ...event, batch: 2 });
    ledger.recordFailed({ ...event, direction: 'up', batch: 3, error: 'synthetic forward failure' });
    database.run('PRAGMA query_only=ON');
    expect(readMigrationLedgerState(database).get('001')).toMatchObject({ status: 'rolled_back', direction: 'down' });
  } finally { database.close(); }
});

test('readonly ledger reader finalizes its exact statement on success and query failure', () => {
  let finalizations = 0;
  for (const fails of [false, true]) {
    const database = { prepare() {
      return { *iterate() { if (fails) throw new Error('synthetic query failure'); },
        finalize() { finalizations++; } };
    } } as unknown as Pick<Database, 'prepare'>;
    if (fails) expect(() => readMigrationLedgerState(database)).toThrow('synthetic query failure');
    else expect(readMigrationLedgerState(database).size).toBe(0);
  }
  expect(finalizations).toBe(2);
});
