/** Owns a private, empty launch directory; never recursively removes child files. */
import { mkdtempSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseError } from './database-error';

/** Bun currently has no native temporary-directory or empty-directory removal API. */
export class SubprocessDatabaseWorkingDirectory {
  private directory: string | undefined;

  prepare(): string {
    this.directory ??= mkdtempSync(join(tmpdir(), 'zero-database-actor-'));
    return this.directory;
  }

  /** Called only after the exact child is settled, or spawning failed. */
  release(): DatabaseError | null {
    if (!this.directory) return null;
    try {
      rmdirSync(this.directory);
      this.directory = undefined;
      return null;
    } catch {
      // Retain ownership so a subsequent close can retry, without deleting
      // unknown files or exposing the physical directory/error in diagnostics.
      return new DatabaseError('DATABASE_EXECUTOR_FAILED',
        'Database executor launch directory could not be released.', {
          outcome: null,
          retryable: false,
          details: { phase: 'launch-directory-cleanup' },
        });
    }
  }
}
