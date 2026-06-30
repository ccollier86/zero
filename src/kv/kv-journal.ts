/**
 * kv-journal.ts
 *
 * Provides append-only JSONL persistence for KV mutations. This file owns
 * journal filesystem IO only; it does not checkpoint, recover, or expose app
 * service methods.
 */

import { appendFile, mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';

import { systemKvClock } from './kv-clock';
import { KvError } from './kv-errors';
import type { KvMutation } from './kv-mutation';
import {
  KV_PERSISTENCE_FORMAT_VERSION,
  parseKvJournalRecord,
  serializeKvJournalRecord,
  type KvJournalRecord,
} from './kv-serializer';
import type { KvClock } from './kv-types';

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
  private readonly baseDir: string | null;
  private readonly fileName: string;
  private readonly durability: KvJournalDurability;
  private readonly clock: KvClock;
  private readonly memoryRecords: KvJournalRecord[] = [];
  private sequence: number;

  /** Create a journal that writes to disk unless durability is memory. */
  constructor(config: KvJournalConfig = {}) {
    this.baseDir = config.durability === 'memory' ? null : config.baseDir ?? './data/kv';
    this.fileName = config.fileName ?? 'journal.jsonl';
    this.durability = config.durability ?? 'everysec';
    this.clock = config.clock ?? systemKvClock;
    this.sequence = config.initialSequence ?? 0;
  }

  /** Append one mutation and return the durable journal record. */
  async append(mutation: KvMutation): Promise<KvJournalRecord> {
    const record: KvJournalRecord = {
      version: KV_PERSISTENCE_FORMAT_VERSION,
      sequence: ++this.sequence,
      timestamp: this.clock.now(),
      mutation,
    };

    if (this.durability === 'memory') {
      this.memoryRecords.push(record);
      return record;
    }

    await this.ensureBaseDir();
    const journalPath = this.path();
    await appendFile(journalPath, serializeKvJournalRecord(record));
    if (this.durability === 'always') await fsyncFile(journalPath);
    return record;
  }

  /** Flush pending journal bytes to disk when the durability mode has a file. */
  async flush(): Promise<void> {
    if (this.durability === 'memory') return;
    await this.ensureBaseDir();
    await fsyncFile(this.path());
  }

  /** Return the highest sequence allocated by this journal instance. */
  currentSequence(): number {
    return this.sequence;
  }

  /** Advance the journal sequence after recovery without rewriting records. */
  setCurrentSequence(sequence: number): void {
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
    } catch {
      return;
    }

    let lineNumber = 0;
    for (const line of text.split('\n')) {
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
