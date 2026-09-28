/**
 * snapshot-manager.ts
 *
 * Writes atomic SQLite snapshots for hot mode. This file owns snapshot timing
 * and file replacement only; it does not open databases or choose storage
 * modes.
 */

import type { Database } from 'bun:sqlite';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode, errorPlatform } from '../observability/sink';

/** Writes periodic and final serialized snapshots for a hot SQLite database. */
export class SnapshotManager {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private inProgress = false;
  private writeGeneration = 0;

  /** Create a snapshot manager for one active SQLite handle. */
  constructor(
    private readonly db: Database,
    private readonly snapshotPath: string,
    private readonly intervalMs: number,
    private readonly enabled: boolean
  ) {}

  /** Whether this manager owns a graceful-shutdown durability boundary. */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Start periodic snapshots when enabled. */
  start(): void {
    if (!this.enabled || this.intervalId) return;
    this.intervalId = setInterval(() => {
      void this.snapshot();
    }, this.intervalMs);
  }

  /** Stop periodic snapshots. */
  stop(): void {
    if (!this.intervalId) return;
    clearInterval(this.intervalId);
    this.intervalId = null;
  }

  /** Write an async snapshot. Returns false when disabled or already running. */
  async snapshot(): Promise<boolean> {
    if (!this.enabled || this.inProgress) return false;
    this.inProgress = true;
    const generation = ++this.writeGeneration;
    const tempPath = this.createTempPath();
    try {
      mkdirSync(path.dirname(this.snapshotPath), { recursive: true });
      await Bun.write(tempPath, this.db.serialize());
      // A synchronous shutdown snapshot may have captured newer committed
      // state while this file write was awaiting I/O. Never let the older
      // image replace that final durability boundary when it completes.
      if (generation !== this.writeGeneration) return false;
      renameSync(tempPath, this.snapshotPath);
      emitPlatformCode(OBS_CODES.PERSISTENCE_SQL_SNAPSHOT_WRITTEN, {
        metadata: { snapshotPath: this.snapshotPath },
      });
      return true;
    } catch (error) {
      errorPlatform(OBS_CODES.PERSISTENCE_SQL_SNAPSHOT_FAILED, {
        error,
        metadata: { snapshotPath: this.snapshotPath },
      });
      return false;
    } finally {
      rmSync(tempPath, { force: true });
      this.inProgress = false;
    }
  }

  /** Write a synchronous final snapshot for shutdown. */
  snapshotSync(): boolean {
    if (!this.enabled) return false;
    const tempPath = this.createTempPath();
    try {
      mkdirSync(path.dirname(this.snapshotPath), { recursive: true });
      writeFileSync(tempPath, this.db.serialize());
      renameSync(tempPath, this.snapshotPath);
      // Advance only after the final image is durable. If this write fails,
      // an older in-flight image may still provide a usable (if earlier)
      // recovery point instead of being discarded as superseded.
      ++this.writeGeneration;
      emitPlatformCode(OBS_CODES.PERSISTENCE_SQL_SNAPSHOT_WRITTEN, {
        metadata: { snapshotPath: this.snapshotPath },
      });
      return true;
    } catch (error) {
      errorPlatform(OBS_CODES.PERSISTENCE_SQL_SNAPSHOT_FAILED, {
        error,
        metadata: { snapshotPath: this.snapshotPath },
      });
      return false;
    } finally {
      rmSync(tempPath, { force: true });
    }
  }

  private createTempPath(): string {
    return `${this.snapshotPath}.tmp.${crypto.randomUUID()}`;
  }
}
