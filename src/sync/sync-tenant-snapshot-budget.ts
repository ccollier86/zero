/** Bounded aggregate work for one actor-backed tenant baseline. */

import type { DatabaseOperationRow } from '../databases/database-operations';
import type { Row } from './types';

export const SYNC_TENANT_SNAPSHOT_MAX_PAGE_REQUESTS = 512 as const;
export const SYNC_TENANT_SNAPSHOT_MAX_ROWS = 50_000 as const;
export const SYNC_TENANT_SNAPSHOT_MAX_OBSERVED_BYTES = 67_108_864 as const;
export const SYNC_TENANT_SNAPSHOT_DEADLINE_MS = 30_000 as const;

const encoder = new TextEncoder();

interface SyncTenantSnapshotBudgetOptions {
  readonly now?: () => number;
  readonly maxPageRequests?: number;
  readonly maxRows?: number;
  readonly maxObservedBytes?: number;
  readonly deadlineMs?: number;
}

/** Stable internal failure consumed by the tenant transport close path. */
export class SyncTenantSnapshotBudgetError extends Error {
  readonly code = 'SYNC_TENANT_SNAPSHOT_BUDGET_EXCEEDED' as const;

  constructor(readonly reason: 'deadline' | 'pages' | 'rows' | 'bytes') {
    super('Tenant Sync snapshot exceeded its bounded work contract.');
    this.name = 'SyncTenantSnapshotBudgetError';
  }
}

export class SyncTenantSnapshotBudget {
  readonly #now: () => number;
  readonly #deadline: number;
  readonly #maxPageRequests: number;
  readonly #maxRows: number;
  readonly #maxObservedBytes: number;
  #pageRequests = 0;
  #rows = 0;
  #observedBytes = 0;

  constructor(options: SyncTenantSnapshotBudgetOptions = {}) {
    this.#now = options.now ?? (() => performance.now());
    this.#deadline = this.#now()
      + (options.deadlineMs ?? SYNC_TENANT_SNAPSHOT_DEADLINE_MS);
    this.#maxPageRequests = options.maxPageRequests
      ?? SYNC_TENANT_SNAPSHOT_MAX_PAGE_REQUESTS;
    this.#maxRows = options.maxRows ?? SYNC_TENANT_SNAPSHOT_MAX_ROWS;
    this.#maxObservedBytes = options.maxObservedBytes
      ?? SYNC_TENANT_SNAPSHOT_MAX_OBSERVED_BYTES;
  }

  /** Count every actor call, including adaptive retries after IPC rejection. */
  beginPageRequest(): void {
    this.assertWithinDeadline();
    this.#pageRequests += 1;
    if (this.#pageRequests > this.#maxPageRequests) {
      throw new SyncTenantSnapshotBudgetError('pages');
    }
  }

  /** Account rows before filtering so hidden data cannot evade scan bounds. */
  observePage(rows: readonly DatabaseOperationRow[]): void {
    this.assertWithinDeadline();
    this.#rows += rows.length;
    if (this.#rows > this.#maxRows) {
      throw new SyncTenantSnapshotBudgetError('rows');
    }
    for (const row of rows) this.#observeValue(row);
  }

  /** Account projector expansion in addition to the canonical source row. */
  observeProjectedRow(row: Row): void {
    this.assertWithinDeadline();
    this.#observeValue(row);
  }

  assertWithinDeadline(): void {
    if (this.#now() > this.#deadline) {
      throw new SyncTenantSnapshotBudgetError('deadline');
    }
  }

  #observeValue(value: object): void {
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(value);
    } catch {
      throw new SyncTenantSnapshotBudgetError('bytes');
    }
    if (typeof serialized !== 'string') {
      throw new SyncTenantSnapshotBudgetError('bytes');
    }
    this.#observedBytes += encoder.encode(serialized).byteLength;
    if (this.#observedBytes > this.#maxObservedBytes) {
      throw new SyncTenantSnapshotBudgetError('bytes');
    }
  }
}
