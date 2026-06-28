/**
 * migration-backup.ts
 *
 * Creates file backups for migration safety gates. This file owns filesystem
 * backup behavior only; migrator decides when backups are required.
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface MigrationBackup {
  path: string;
  hash: string;
}

/** Create a timestamped copy of a file-backed SQLite database. */
export function createMigrationBackup(
  dbPath: string,
  backupDir: string,
  migrationVersion: string,
): MigrationBackup | null {
  if (dbPath === ':memory:' || dbPath === 'memory') return null;
  if (!existsSync(dbPath)) return null;

  mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(
    backupDir,
    `${basename(dbPath)}.${migrationVersion}.${timestamp}.bak`,
  );

  copyFileSync(dbPath, path);
  return {
    path,
    hash: createHash('sha256').update(readFileSync(path)).digest('hex'),
  };
}
