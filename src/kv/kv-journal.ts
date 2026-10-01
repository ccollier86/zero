/**
 * kv-journal.ts
 *
 * Provides append-only JSONL persistence for KV mutations. This file owns
 * journal filesystem IO only; it does not checkpoint, recover, or expose app
 * service methods.
 */

import { appendFile, mkdir, open, readFile, stat, truncate } from 'node:fs/promises';
import path from 'node:path';

import { systemKvClock } from './kv-clock';
import { KvError } from './kv-errors';
import { KV_CHECKPOINT_PRUNE_KEY, type KvMutation } from './kv-mutation';
import { KvOperationQueue } from './kv-operation-queue';
import {
  KV_PERSISTENCE_FORMAT_VERSION,
  parseKvJournalRecord,
  serializeKvJournalRecord,
  type KvJournalRecord,
} from './kv-serializer';
import type { KvClock } from './kv-types';
import { assertKvKind, snapshotKvValue } from './kv-value';

/** KV journal durability policy. */
export type KvJournalDurability = 'memory' | 'everysec' | 'always';

/** Configures the append-only KV journal. */
export interface KvJournalConfig {
  baseDir?: string;
  fileName?: string;
  durability?: KvJournalDurability;
  clock?: KvClock;
  initialSequence?: number;
}

/** Corrupt-record result returned while scanning a journal. */
export interface KvJournalCorruptRecord {
  ok: false;
  line: number;
  error: KvError;
  /** True when recovery safely removed an unterminated final WAL frame. */
  recoveredTail?: boolean;
}

/** Valid-record result returned while scanning a journal. */
export interface KvJournalValidRecord {
  ok: true;
  record: KvJournalRecord;
}

/** Result yielded by journal scanning. */
export type KvJournalReadResult = KvJournalValidRecord | KvJournalCorruptRecord;

/** Append-only JSONL journal for durable KV mutations. */
export class KvFileJournal {
  private static readonly OPERATION_QUEUE_KEY = 'journal';

  private readonly baseDir: string | null;
  private readonly fileName: string;
  private readonly durability: KvJournalDurability;
  private readonly clock: KvClock;
  private readonly memoryRecords: KvJournalRecord[] = [];
  private readonly operations = new KvOperationQueue();
  private persistenceFailure: KvError | null = null;
  private namespaceDurabilityEstablished = false;
  private sequence: number;

  /** Create a journal that writes to disk unless durability is memory. */
  constructor(config: KvJournalConfig = {}) {
    this.baseDir = config.durability === 'memory' ? null : config.baseDir ?? './data/kv';
    this.fileName = config.fileName ?? 'journal.jsonl';
    this.durability = config.durability ?? 'everysec';
    this.clock = config.clock ?? systemKvClock;
    const initialSequence = config.initialSequence ?? 0;
    if (!Number.isSafeInteger(initialSequence) || initialSequence < 0) {
      throw new KvError('KV_VALUE_INVALID', 'KV journal initialSequence must be a non-negative safe integer.', {
        initialSequence,
      });
    }
    this.sequence = initialSequence;
  }

  /** Append one mutation and return the durable journal record. */
  append(mutation: KvMutation): Promise<KvJournalRecord> {
    const timestamp = mutation.evaluatedAt ?? this.clock.now();
    return this.operations.run(
      KvFileJournal.OPERATION_QUEUE_KEY,
      () => this.appendRecord(mutation, timestamp)
    );
  }

  /** @internal Execute one already-queued append. Protected for deterministic fault injection. */
  protected async appendRecord(mutation: KvMutation, timestamp: number): Promise<KvJournalRecord> {
    if (this.persistenceFailure) throw this.persistenceFailure;
    if (this.sequence >= Number.MAX_SAFE_INTEGER) {
      throw new KvError('KV_PERSISTENCE_FAILED', 'KV journal sequence space is exhausted.', {
        sequence: this.sequence,
      });
    }
    const record: KvJournalRecord = {
      version: KV_PERSISTENCE_FORMAT_VERSION,
      sequence: this.sequence + 1,
      timestamp,
      mutation: snapshotMutation(mutation),
    };
    const { serialized, snapshot } = serializeRecord(record);

    if (this.durability === 'memory') {
      this.memoryRecords.push(snapshot);
      this.sequence = snapshot.sequence;
      return snapshot;
    }

    try {
      await this.ensureBaseDir();
      const journalPath = this.path();
      await appendFile(journalPath, serialized);
      if (this.durability === 'always') {
        await fsyncFile(journalPath);
        if (!this.namespaceDurabilityEstablished) {
          await fsyncDirectoryChain(path.dirname(journalPath));
          this.namespaceDurabilityEstablished = true;
        }
      }
    } catch (error) {
      this.persistenceFailure = toPersistenceError(error, this.path(), snapshot.sequence);
      throw this.persistenceFailure;
    }

    this.sequence = snapshot.sequence;
    return snapshot;
  }

  /** Flush pending journal bytes to disk when the durability mode has a file. */
  flush(): Promise<void> {
    return this.operations.run(KvFileJournal.OPERATION_QUEUE_KEY, async () => {
      if (this.durability === 'memory') return;
      if (this.persistenceFailure) throw this.persistenceFailure;
      try {
        const journalPath = this.path();
        // Flushing an untouched journal is a no-op. Opening with append mode
        // would create an empty WAL whose directory entry had not followed the
        // first-append durability path.
        if (!await pathExists(journalPath)) return;
        await fsyncFile(journalPath);
        if (!this.namespaceDurabilityEstablished) {
          await fsyncDirectoryChain(path.dirname(journalPath));
          this.namespaceDurabilityEstablished = true;
        }
      } catch (error) {
        this.persistenceFailure = toPersistenceError(error, this.path());
        throw this.persistenceFailure;
      }
    });
  }

  /** Return the highest sequence allocated by this journal instance. */
  currentSequence(): number {
    return this.sequence;
  }

  /** Advance the journal sequence after recovery without rewriting records. */
  setCurrentSequence(sequence: number): void {
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw new KvError('KV_VALUE_INVALID', 'KV journal sequence must be a non-negative safe integer.', {
        sequence,
      });
    }
    if (sequence > this.sequence) this.sequence = sequence;
  }

  /** Read journal records as valid or corrupt scan results. */
  async *readRecords(): AsyncGenerator<KvJournalReadResult> {
    if (this.durability === 'memory') {
      for (const record of this.memoryRecords) yield { ok: true, record };
      return;
    }

    let text = '';
    try {
      text = await readFile(this.path(), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw toPersistenceError(error, this.path());
    }

    const finalNewline = text.lastIndexOf('\n');
    const hasUnterminatedTail = text.length > 0 && finalNewline !== text.length - 1;
    const tail = hasUnterminatedTail ? text.slice(finalNewline + 1) : '';
    const scanText = hasUnterminatedTail ? text.slice(0, finalNewline + 1) : text;

    if (hasUnterminatedTail) {
      try {
        await truncate(this.path(), Buffer.byteLength(scanText, 'utf8'));
        await fsyncFile(this.path());
      } catch (error) {
        throw toPersistenceError(error, this.path());
      }
    }

    let lineNumber = 0;
    for (const line of scanText.split('\n')) {
      lineNumber += 1;
      if (!line.trim()) continue;
      try {
        yield { ok: true, record: parseKvJournalRecord(line) };
      } catch (error) {
        yield {
          ok: false,
          line: lineNumber,
          error: error instanceof KvError
            ? error
            : new KvError('KV_JOURNAL_CORRUPT', 'KV journal record is invalid.', { line: lineNumber }),
        };
      }
    }

    if (tail.trim()) {
      yield {
        ok: false,
        line: lineNumber,
        recoveredTail: true,
        error: new KvError(
          'KV_JOURNAL_CORRUPT',
          'KV journal ended with an incomplete record; the unterminated tail was removed.',
          { line: lineNumber }
        ),
      };
    }
  }

  private path(): string {
    if (!this.baseDir) {
      throw new KvError('KV_PERSISTENCE_FAILED', 'Memory-only KV journal has no file path.');
    }
    return path.join(this.baseDir, this.fileName);
  }

  private async ensureBaseDir(): Promise<void> {
    if (!this.baseDir) return;
    await mkdir(this.baseDir, { recursive: true });
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

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
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

async function fsyncFile(filePath: string): Promise<void> {
  try {
    const handle = await open(filePath, 'a');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    throw new KvError('KV_PERSISTENCE_FAILED', 'KV journal fsync failed.', {
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function serializeRecord(record: KvJournalRecord): {
  serialized: string;
  snapshot: KvJournalRecord;
} {
  try {
    const serialized = serializeKvJournalRecord(record);
    return {
      serialized,
      snapshot: parseKvJournalRecord(serialized.trim()),
    };
  } catch (error) {
    throw new KvError('KV_VALUE_INVALID', 'KV mutation value cannot be serialized for durable storage.', {
      key: record.mutation.key,
      operation: record.mutation.op,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function snapshotMutation(mutation: KvMutation): KvMutation {
  if (typeof mutation.key !== 'string' || mutation.key.trim().length === 0) {
    throw new KvError('KV_KEY_INVALID', 'KV key must be a non-empty string.', {
      key: mutation.key,
    });
  }
  validateEvaluatedAt(mutation.evaluatedAt);
  validatePruneAt(mutation.pruneAt);

  switch (mutation.op) {
    case 'set':
      assertKvKind(mutation.kind);
      validateExpiresAt(mutation.expiresAt);
      validateTombstone(mutation.tombstone);
      return { ...mutation, value: snapshotKvValue(mutation.value) };
    case 'delete':
      if (mutation.maintenance !== undefined && mutation.maintenance !== 'prune') {
        throw new KvError('KV_VALUE_INVALID', 'KV delete maintenance marker is invalid.');
      }
      if (
        mutation.maintenance === 'prune'
        && (
          mutation.key !== KV_CHECKPOINT_PRUNE_KEY
          || mutation.pruneAt === undefined
          || mutation.evaluatedAt !== mutation.pruneAt
        )
      ) {
        throw new KvError('KV_VALUE_INVALID', 'KV checkpoint prune mutation is invalid.');
      }
      return { ...mutation };
    case 'expire':
      validateExpiresAt(mutation.expiresAt);
      validateTombstone(mutation.tombstone);
      return { ...mutation };
    case 'increment':
      if (!Number.isFinite(mutation.delta)) {
        throw new KvError('KV_VALUE_INVALID', 'KV increment mutation delta must be finite.', {
          key: mutation.key,
          delta: mutation.delta,
        });
      }
      if (mutation.result !== undefined && !Number.isFinite(mutation.result)) {
        throw new KvError('KV_VALUE_INVALID', 'KV increment mutation result must be finite.', {
          key: mutation.key,
          result: mutation.result,
        });
      }
      validateExpiresAt(mutation.expiresAt);
      validateTombstone(mutation.tombstone);
      return { ...mutation };
  }
}

function validateEvaluatedAt(value: number | undefined): void {
  if (value === undefined || Number.isFinite(value)) return;
  throw new KvError('KV_VALUE_INVALID', 'KV mutation evaluation timestamp must be finite.', {
    evaluatedAt: value,
  });
}

function validatePruneAt(value: number | undefined): void {
  if (value === undefined || Number.isFinite(value)) return;
  throw new KvError('KV_VALUE_INVALID', 'KV mutation prune timestamp must be finite.', {
    pruneAt: value,
  });
}

function validateTombstone(value: boolean | undefined): void {
  if (value === undefined || typeof value === 'boolean') return;
  throw new KvError('KV_VALUE_INVALID', 'KV mutation tombstone marker must be boolean.');
}

function validateExpiresAt(value: number | null | undefined): void {
  if (value === undefined || value === null || Number.isFinite(value)) return;
  throw new KvError('KV_TTL_INVALID', 'KV mutation expiry must be finite, null, or undefined.', {
    expiresAt: value,
  });
}

function toPersistenceError(error: unknown, filePath: string, sequence?: number): KvError {
  if (error instanceof KvError && error.code === 'KV_PERSISTENCE_FAILED') return error;
  return new KvError('KV_PERSISTENCE_FAILED', 'KV journal persistence failed.', {
    path: filePath,
    sequence,
    error: error instanceof Error ? error.message : String(error),
  });
}
