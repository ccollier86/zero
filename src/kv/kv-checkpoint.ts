/**
 * kv-checkpoint.ts
 *
 * Reads and writes atomic KV checkpoints. This file owns checkpoint
 * filesystem IO only; it does not append mutations or expose app-facing KV
 * methods.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { systemKvClock } from './kv-clock';
import { KvError } from './kv-errors';
import {
  KV_PERSISTENCE_FORMAT_VERSION,
  parseKvCheckpoint,
  serializeKvCheckpoint,
  type KvCheckpointPayload,
} from './kv-serializer';
import type { KvClock, ZeroKvEntry } from './kv-types';

/** Configures checkpoint storage for the KV memory engine. */
export interface KvCheckpointConfig {
  baseDir?: string;
  fileName?: string;
  clock?: KvClock;
}

/** Atomic JSON checkpoint store for KV entries. */
export class KvCheckpointStore {
  private readonly baseDir: string;
  private readonly fileName: string;
  private readonly clock: KvClock;

  /** Create a checkpoint store rooted under a base directory. */
  constructor(config: KvCheckpointConfig = {}) {
    this.baseDir = config.baseDir ?? './data/kv';
    this.fileName = config.fileName ?? 'checkpoint.json';
    this.clock = config.clock ?? systemKvClock;
  }

  /** Write live entries and the latest covered journal sequence atomically. */
  async write(entries: Iterable<ZeroKvEntry>, sequence: number): Promise<KvCheckpointPayload> {
    const payload: KvCheckpointPayload = {
      version: KV_PERSISTENCE_FORMAT_VERSION,
      sequence,
      timestamp: this.clock.now(),
      entries: [...entries],
    };
    await mkdir(this.baseDir, { recursive: true });

    const target = this.path();
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temp, serializeKvCheckpoint(payload));
    await rename(temp, target).catch(async () => {
      await rm(target, { force: true });
      try {
        await rename(temp, target);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
    });
    return payload;
  }

  /** Read the latest checkpoint, returning null when none exists. */
  async read(): Promise<KvCheckpointPayload | null> {
    try {
      return parseKvCheckpoint(await readFile(this.path(), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      if (error instanceof KvError) throw error;
      throw new KvError('KV_CHECKPOINT_INVALID', 'KV checkpoint could not be read.', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Return the checkpoint file path. */
  path(): string {
    return path.join(this.baseDir, this.fileName);
  }
}
