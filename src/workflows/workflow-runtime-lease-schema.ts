/**
 * Durable schema for exclusive workflow runtime ownership.
 *
 * This private singleton row is shared by every process opening one workflow
 * database. It carries a monotonically increasing generation so an expired or
 * gracefully released owner can never commit through a replacement owner.
 */

import type { ReactiveDB } from '../sync/reactive-db';

type WorkflowLeaseSchemaDatabase = Pick<ReactiveDB, 'exec'>;

export const WORKFLOW_RUNTIME_LEASE_KEY = 'workflow-runtime';

/** Install the private singleton lease table used by workflow runtimes. */
export function ensureWorkflowRuntimeLeaseSchema(
  db: WorkflowLeaseSchemaDatabase,
): void {
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
}
