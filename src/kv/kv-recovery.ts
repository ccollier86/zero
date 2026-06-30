/**
 * kv-recovery.ts
 *
 * Restores a KV memory engine from checkpoint plus journal replay. This file
 * owns recovery orchestration only; it does not define mutations, write
 * checkpoints, or register platform plugins.
 */

import { KvError } from './kv-errors';
import type { KvCheckpointStore } from './kv-checkpoint';
import type { KvFileJournal } from './kv-journal';
import { applyKvMutation } from './kv-mutation';
import type { KvMemoryEngine } from './kv-memory-engine';

/** Policy used when a journal record is corrupt during recovery. */
export type KvRecoveryCorruptRecordPolicy = 'fail' | 'skip';

/** Configures one KV memory-engine recovery run. */
export interface KvRecoveryConfig {
  engine: KvMemoryEngine;
  checkpoint: KvCheckpointStore;
  journal: KvFileJournal;
  corruptRecordPolicy?: KvRecoveryCorruptRecordPolicy;
}

/** Summary returned after KV recovery completes. */
export interface KvRecoveryResult {
  checkpointSequence: number;
  replayedRecords: number;
  skippedRecords: number;
}

/** Restore a memory engine from the latest checkpoint and newer journal records. */
export async function recoverKvMemoryEngine(config: KvRecoveryConfig): Promise<KvRecoveryResult> {
  const checkpoint = await config.checkpoint.read();
  const checkpointSequence = checkpoint?.sequence ?? 0;
  const policy = config.corruptRecordPolicy ?? 'fail';
  let highestSequence = checkpointSequence;
  let replayedRecords = 0;
  let skippedRecords = 0;

  config.engine.clear();
  if (checkpoint) {
    config.engine.restoreEntries(checkpoint.entries, { clear: false });
  }

  for await (const result of config.journal.readRecords()) {
    if (!result.ok) {
      if (policy === 'skip') {
        skippedRecords += 1;
        continue;
      }
      throw new KvError('KV_RECOVERY_FAILED', 'KV recovery failed on a corrupt journal record.', {
        line: result.line,
        cause: result.error.message,
      });
    }

    if (result.record.sequence > highestSequence) highestSequence = result.record.sequence;
    if (result.record.sequence <= checkpointSequence) continue;
    applyKvMutation(config.engine, result.record.mutation, {
      sequence: result.record.sequence,
      timestamp: result.record.timestamp,
    });
    replayedRecords += 1;
  }

  config.engine.pruneExpired();
  config.journal.setCurrentSequence(highestSequence);
  return {
    checkpointSequence,
    replayedRecords,
    skippedRecords,
  };
}
