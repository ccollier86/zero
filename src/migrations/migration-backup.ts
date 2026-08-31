/**
 * migration-backup.ts
 *
 * Creates file backups for migration safety gates. This file owns filesystem
 * backup behavior only; migrator decides when backups are required.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface MigrationBackup {
  path: string;
  hash: string;
}

/** Snapshot the live SQLite handle into a timestamped backup file. */
export function createMigrationBackup(
  database: Database,
  dbPath: string,
  backupDir: string,
  migrationVersion: string,
): MigrationBackup | null {
  if (dbPath === ':memory:' || dbPath === 'memory') return null;

  mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(
    backupDir,
    `${basename(dbPath)}.${migrationVersion}.${timestamp}.${randomUUID()}.bak`,
  );

  // This snapshots the connected database, including committed WAL pages and
  // hot-mode in-memory state whose configured snapshot file may not exist yet.
  database.run('VACUUM INTO ?', [path]);
  // Backups contain the full durable platform database. Do not let a permissive
  // process umask make a newly created snapshot readable by other local users.
  chmodSync(path, 0o600);
  return {
    path,
    hash: createHash('sha256').update(readFileSync(path)).digest('hex'),
  };
}
