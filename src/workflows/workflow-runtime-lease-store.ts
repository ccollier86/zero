/**
 * Atomic persistence for the singleton workflow runtime lease.
 *
 * This store owns SQL and generation transitions only. Heartbeats, timers,
 * observability, and execution shutdown belong to the lifecycle owner.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import { WorkflowError } from './workflow-error';
import {
  ensureWorkflowRuntimeLeaseSchema,
  WORKFLOW_RUNTIME_LEASE_KEY,
} from './workflow-runtime-lease-schema';

export interface WorkflowRuntimeLeaseToken {
  readonly ownerId: string;
  readonly generation: number;
  readonly acquiredAt: number;
  readonly expiresAt: number;
}

interface WorkflowRuntimeLeaseRow {
  owner_id: string;
  generation: number;
  acquired_at: number;
  heartbeat_at: number;
  expires_at: number;
  released_at: number | null;
}

const MAX_GENERATION = Number.MAX_SAFE_INTEGER;

/** Own atomic acquire, renew, assertion, and release operations for one DB. */
export class WorkflowRuntimeLeaseStore {
  constructor(private readonly db: ReactiveDB) {
    ensureWorkflowRuntimeLeaseSchema(db);
  }

  /** Acquire a fresh generation or fail while another unexpired owner exists. */
  acquire(ownerId: string, now: number, leaseMs: number): WorkflowRuntimeLeaseToken {
    return this.db.transaction(() => {
      const current = this.read();
      const expiresAt = exactExpiry(now, leaseMs);
      if (!current) {
        this.db.prepare(`INSERT INTO _workflow_runtime_owner_lease (
          lease_key, owner_id, generation, acquired_at, heartbeat_at, expires_at, released_at
        ) VALUES (?, ?, 1, ?, ?, ?, NULL)`).run(
          WORKFLOW_RUNTIME_LEASE_KEY,
          ownerId,
          now,
          now,
          expiresAt,
        );
        return Object.freeze({ ownerId, generation: 1, acquiredAt: now, expiresAt });
      }
      validateLeaseRow(current);
      if (current.released_at === null && current.expires_at > now) {
        throw new WorkflowError(
          'Workflow runtime is already owned by another live service',
          'WORKFLOW_RUNTIME_OWNED',
          503,
          true,
        );
      }
      if (current.generation >= MAX_GENERATION) {
        throw new WorkflowError(
          'Workflow runtime ownership generation is exhausted',
          'WORKFLOW_STATE_INVALID',
          500,
        );
      }
      const generation = current.generation + 1;
      const result = this.db.prepare(`UPDATE _workflow_runtime_owner_lease SET
        owner_id = ?, generation = ?, acquired_at = ?, heartbeat_at = ?,
        expires_at = ?, released_at = NULL
        WHERE lease_key = ? AND generation = ?
          AND (released_at IS NOT NULL OR expires_at <= ?)`)
        .run(
          ownerId,
          generation,
          now,
          now,
          expiresAt,
          WORKFLOW_RUNTIME_LEASE_KEY,
          current.generation,
          now,
        );
      if (result.changes !== 1) throw ownershipConflict();
      return Object.freeze({ ownerId, generation, acquiredAt: now, expiresAt });
    });
  }

  /** Extend one exact live generation without ever reviving an expired lease. */
  renew(
    token: WorkflowRuntimeLeaseToken,
    now: number,
    leaseMs: number,
  ): WorkflowRuntimeLeaseToken | null {
    return this.db.transaction(() => {
      const expiresAt = exactExpiry(now, leaseMs);
      const result = this.db.prepare(`UPDATE _workflow_runtime_owner_lease SET
        heartbeat_at = ?, expires_at = ?
        WHERE lease_key = ? AND owner_id = ? AND generation = ?
          AND released_at IS NULL AND expires_at > ?`)
        .run(
          now,
          expiresAt,
          WORKFLOW_RUNTIME_LEASE_KEY,
          token.ownerId,
          token.generation,
          now,
        );
      return result.changes === 1
        ? Object.freeze({ ...token, expiresAt })
        : null;
    });
  }

  /** Prove the exact generation remains live inside the caller's transaction. */
  isCurrent(token: WorkflowRuntimeLeaseToken, now: number): boolean {
    const row = this.db.prepare(`SELECT owner_id, generation, acquired_at,
      heartbeat_at, expires_at, released_at
      FROM _workflow_runtime_owner_lease WHERE lease_key = ? LIMIT 1`)
      .get(WORKFLOW_RUNTIME_LEASE_KEY) as WorkflowRuntimeLeaseRow | null;
    if (!row) return false;
    validateLeaseRow(row);
    return row.owner_id === token.ownerId
      && row.generation === token.generation
      && row.released_at === null
      && row.expires_at > now;
  }

  /**
   * Reject a legacy/unmanaged writer while a managed generation is live.
   *
   * Callers invoke this from `workflowRuntimeTransaction`, so the read and the
   * guarded mutation share the same BEGIN IMMEDIATE writer lock. Whichever
   * side obtains that lock first wins cleanly: an unmanaged commit finishes
   * before acquisition, or it observes the acquired generation and fails.
   */
  assertUnmanaged(now: number): void {
    validateLeaseTime(now);
    const current = this.read();
    if (!current) return;
    validateLeaseRow(current);
    if (current.released_at === null && current.expires_at > now) {
      throw new WorkflowError(
        'Workflow runtime is owned by a managed service',
        'WORKFLOW_RUNTIME_OWNED',
        503,
        true,
      );
    }
  }

  /** Mark one exact generation released; replacement acquisition increments it. */
  release(token: WorkflowRuntimeLeaseToken, now: number): boolean {
    return this.db.transaction(() => {
      const result = this.db.prepare(`UPDATE _workflow_runtime_owner_lease SET
        released_at = ?
        WHERE lease_key = ? AND owner_id = ? AND generation = ?
          AND released_at IS NULL`)
        .run(
          now,
          WORKFLOW_RUNTIME_LEASE_KEY,
          token.ownerId,
          token.generation,
        );
      return result.changes === 1;
    });
  }

  private read(): WorkflowRuntimeLeaseRow | null {
    return this.db.prepare(`SELECT owner_id, generation, acquired_at,
      heartbeat_at, expires_at, released_at
      FROM _workflow_runtime_owner_lease WHERE lease_key = ? LIMIT 1`)
      .get(WORKFLOW_RUNTIME_LEASE_KEY) as WorkflowRuntimeLeaseRow | null;
  }
}

function exactExpiry(now: number, leaseMs: number): number {
  const expiresAt = now + leaseMs;
  if (!Number.isSafeInteger(now) || now < 0
    || !Number.isSafeInteger(leaseMs) || leaseMs < 1
    || !Number.isSafeInteger(expiresAt)) {
    throw new WorkflowError(
      'Workflow runtime lease timing is invalid',
      'WORKFLOW_CONFIG_INVALID',
      500,
    );
  }
  return expiresAt;
}

function validateLeaseTime(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new WorkflowError(
      'Workflow runtime lease timing is invalid',
      'WORKFLOW_CONFIG_INVALID',
      500,
    );
  }
}

function validateLeaseRow(row: WorkflowRuntimeLeaseRow): void {
  if (typeof row.owner_id !== 'string' || row.owner_id.length === 0
    || !Number.isSafeInteger(row.generation) || row.generation < 1
    || !Number.isSafeInteger(row.acquired_at) || row.acquired_at < 0
    || !Number.isSafeInteger(row.heartbeat_at) || row.heartbeat_at < row.acquired_at
    || !Number.isSafeInteger(row.expires_at) || row.expires_at <= row.heartbeat_at
    || (row.released_at !== null
      && (!Number.isSafeInteger(row.released_at) || row.released_at < row.acquired_at))) {
    throw new WorkflowError(
      'Workflow runtime ownership state is invalid',
      'WORKFLOW_STATE_INVALID',
      500,
    );
  }
}

function ownershipConflict(): WorkflowError {
  return new WorkflowError(
    'Workflow runtime ownership changed during acquisition',
    'WORKFLOW_RUNTIME_OWNED',
    503,
    true,
  );
}
