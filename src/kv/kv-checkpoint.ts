/**
 * kv-checkpoint.ts
 *
 * Reads and writes atomic KV checkpoints. This file owns checkpoint
 * filesystem IO only; it does not append mutations or expose app-facing KV
 * methods.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { systemKvClock } from './kv-clock';
import { KvError } from './kv-errors';
import {
  KV_PERSISTENCE_FORMAT_VERSION,
  parseKvCheckpoint,
  serializeKvCheckpoint,
  validateKvCheckpointPayload,
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
  private namespaceDurabilityEstablished = false;

  /** Create a checkpoint store rooted under a base directory. */
  constructor(config: KvCheckpointConfig = {}) {
    this.baseDir = config.baseDir ?? './data/kv';
    this.fileName = config.fileName ?? 'checkpoint.json';
    this.clock = config.clock ?? systemKvClock;
  }

  /** Write live entries and the latest covered journal sequence atomically. */
  async write(
    entries: Iterable<ZeroKvEntry>,
    sequence: number,
    timestamp = this.clock.now()
  ): Promise<KvCheckpointPayload> {
    const candidate: KvCheckpointPayload = {
      version: KV_PERSISTENCE_FORMAT_VERSION,
      sequence,
      timestamp,
      entries: [...entries],
    };
    let serialized: string;
    let payload: KvCheckpointPayload;
    try {
      payload = validateKvCheckpointPayload(candidate);
      serialized = serializeKvCheckpoint(payload);
      // Validate the exact JSON round-trip before replacing the last known-good
      // checkpoint. JSON.stringify can silently omit unsupported values or
      // coerce non-finite numbers, so validating only the source object is not
      // sufficient.
      payload = parseKvCheckpoint(serialized);
      serialized = serializeKvCheckpoint(payload);
    } catch (error) {
      throw new KvError('KV_CHECKPOINT_INVALID', 'KV checkpoint could not be serialized.', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const target = this.path();
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await mkdir(this.baseDir, { recursive: true });
      await writeAndSyncFile(temp, serialized);
      // Same-directory rename atomically replaces the prior checkpoint. Never
      // delete the last known-good target as a fallback when replacement fails.
      await rename(temp, target);
      if (this.namespaceDurabilityEstablished) {
        await fsyncDirectory(this.baseDir);
      } else {
        await fsyncDirectoryChain(this.baseDir);
        this.namespaceDurabilityEstablished = true;
      }
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw checkpointPersistenceError('write', target, error);
    }
    return payload;
  }

  /** Read the latest checkpoint, returning null when none exists. */
  async read(): Promise<KvCheckpointPayload | null> {
    let text: string;
    try {
      text = await readFile(this.path(), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw checkpointPersistenceError('read', this.path(), error);
    }
    try {
      return parseKvCheckpoint(text);
    } catch (error) {
      if (error instanceof KvError) throw error;
      throw new KvError('KV_CHECKPOINT_INVALID', 'KV checkpoint contents are invalid.', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Return the checkpoint file path. */
  path(): string {
    return path.join(this.baseDir, this.fileName);
  }
}

async function fsyncDirectoryChain(directory: string): Promise<void> {
  let current = path.resolve(directory);
  while (true) {
    await fsyncDirectory(current);
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

async function writeAndSyncFile(filePath: string, contents: string): Promise<void> {
  const handle = await open(filePath, 'wx');
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function fsyncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function checkpointPersistenceError(
  operation: 'read' | 'write',
  filePath: string,
  error: unknown
): KvError {
  if (error instanceof KvError && error.code === 'KV_PERSISTENCE_FAILED') return error;
  return new KvError('KV_PERSISTENCE_FAILED', `KV checkpoint ${operation} failed.`, {
    path: filePath,
    error: error instanceof Error ? error.message : String(error),
  });
}
