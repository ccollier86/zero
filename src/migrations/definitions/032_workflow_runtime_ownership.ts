/** Add the private generation lease that elects one workflow runtime per database. */

import type { Database } from 'bun:sqlite';
import type { Migration } from '../migrator';

export const migration: Migration = {
  version: '032',
  description: 'Durable workflow runtime ownership generations',
  safety: 'safe',
  backupRequired: false,

  up(db: Database) {
    // Keep this numbered definition self-contained and immutable. Runtime
    // schema helpers may evolve, while an applied migration may not.
    db.exec(`CREATE TABLE IF NOT EXISTS _workflow_runtime_owner_lease (
      lease_key TEXT PRIMARY KEY CHECK (lease_key = 'workflow-runtime'),
      owner_id TEXT NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 200),
      generation INTEGER NOT NULL
        CHECK (typeof(generation) = 'integer'
          AND generation BETWEEN 1 AND 9007199254740991),
      acquired_at INTEGER NOT NULL CHECK (typeof(acquired_at) = 'integer'),
      heartbeat_at INTEGER NOT NULL CHECK (typeof(heartbeat_at) = 'integer'),
      expires_at INTEGER NOT NULL CHECK (typeof(expires_at) = 'integer'),
      released_at INTEGER CHECK (released_at IS NULL OR typeof(released_at) = 'integer'),
      CHECK (heartbeat_at >= acquired_at),
      CHECK (expires_at > heartbeat_at),
      CHECK (released_at IS NULL OR released_at >= acquired_at)
    )`);
  },
};
