import { Database } from 'bun:sqlite';
import { existsSync, writeFileSync } from 'node:fs';
import { Migrator } from '../migrator';
import type { Migration } from '../types';

const [dbPath, readyPath, startPath] = Bun.argv.slice(2);
if (!dbPath || !readyPath || !startPath) {
  throw new Error('Expected database, ready, and start paths.');
}

const migration: Migration = {
  version: '001',
  description: 'concurrent migration fixture',
  backupRequired: true,
  up(db: Database) {
    db.run('CREATE TABLE concurrent_effect (id INTEGER PRIMARY KEY)');
    // Keep the winner's writer transaction open long enough for the other
    // process to reach its stale-pending path and wait on BEGIN IMMEDIATE.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    db.run('INSERT INTO concurrent_effect (id) VALUES (1)');
  },
};

const migrator = new Migrator({
  dbPath,
  migrations: [migration],
  busyTimeoutMs: 10_000,
  log: () => {},
});

try {
  writeFileSync(readyPath, 'ready');
  const deadline = Date.now() + 10_000;
  while (!existsSync(startPath)) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for start barrier.');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
  migrator.run();
} finally {
  migrator.dispose();
}
