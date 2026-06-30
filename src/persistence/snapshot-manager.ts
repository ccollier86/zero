/**
 * snapshot-manager.ts
 *
 * Writes atomic SQLite snapshots for hot mode. This file owns snapshot timing
 * and file replacement only; it does not open databases or choose storage
 * modes.
 */

import type { Database } from 'bun:sqlite';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode, errorPlatform } from '../observability/sink';

/** Writes periodic and final serialized snapshots for a hot SQLite database. */
export class SnapshotManager {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private inProgress = false;

  /** Create a snapshot manager for one active SQLite handle. */
  constructor(
    private readonly db: Database,
    private readonly snapshotPath: string,
    private readonly intervalMs: number,
    private readonly enabled: boolean
  ) {}

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
    try {
      mkdirSync(path.dirname(this.snapshotPath), { recursive: true });
      const tempPath = `${this.snapshotPath}.tmp`;
      await Bun.write(tempPath, this.db.serialize());
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
      this.inProgress = false;
    }
  }

  /** Write a synchronous final snapshot for shutdown. */
  snapshotSync(): boolean {
    if (!this.enabled || this.inProgress) return false;
    this.inProgress = true;
    try {
      mkdirSync(path.dirname(this.snapshotPath), { recursive: true });
      const tempPath = `${this.snapshotPath}.tmp`;
      writeFileSync(tempPath, this.db.serialize());
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
      this.inProgress = false;
    }
  }
}
