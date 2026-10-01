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
import {
  KV_LEGACY_PERSISTENCE_FORMAT_VERSION,
  KV_PERSISTENCE_FORMAT_VERSION,
} from './kv-serializer';

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
  skippedSequences: number;
  recoveredTailRecords: number;
  legacySequenceDiscontinuities: number;
  legacyUndefinedValuesDropped: number;
}

/** Restore a memory engine from the latest checkpoint and newer journal records. */
export async function recoverKvMemoryEngine(config: KvRecoveryConfig): Promise<KvRecoveryResult> {
  const checkpoint = await config.checkpoint.read();
  const checkpointSequence = checkpoint?.sequence ?? 0;
  const policy = config.corruptRecordPolicy ?? 'fail';
  let highestSequence = checkpointSequence;
  let previousReplaySequence = checkpointSequence;
  let previousLegacySequence: number | null = null;
  let highestLegacySequence = checkpointSequence;
  let currentFormatReached = checkpoint?.version === KV_PERSISTENCE_FORMAT_VERSION;
  let replayedRecords = 0;
  let skippedRecords = 0;
  let skippedSequences = 0;
  let recoveredTailRecords = 0;
  let legacySequenceDiscontinuities = 0;
  let legacyUndefinedValuesDropped = checkpoint?.legacyUndefinedEntriesDropped ?? 0;

  config.engine.clear();
  if (checkpoint) {
    config.engine.restoreEntries(checkpoint.entries, {
      clear: false,
      retainExpired: true,
      capacityTime: checkpoint.timestamp,
    });
  }

  for await (const result of config.journal.readRecords()) {
    if (!result.ok) {
      if (result.recoveredTail) {
        skippedRecords += 1;
        recoveredTailRecords += 1;
        continue;
      }
      if (policy === 'skip') {
        skippedRecords += 1;
        continue;
      }
      throw new KvError('KV_RECOVERY_FAILED', 'KV recovery failed on a corrupt journal record.', {
        line: result.line,
        cause: result.error.message,
      });
    }

    const sequence = result.record.sequence;
    // A checkpoint is authoritative through its sequence. Retained WAL lines
    // at or below that boundary cannot reveal a missing replay mutation and
    // must not make an otherwise clean checkpoint unrecoverable.
    if (sequence <= checkpointSequence) continue;

    const expectedSequence = previousReplaySequence + 1;
    if (result.record.version === KV_LEGACY_PERSISTENCE_FORMAT_VERSION) {
      const legacyAfterCurrentFormat = currentFormatReached;
      if (legacyAfterCurrentFormat) {
        if (policy !== 'skip') {
          throw new KvError(
            'KV_RECOVERY_FAILED',
            'KV recovery found a legacy journal record after the current persistence format.',
            {
              sequence,
              previousSequence: previousReplaySequence,
              checkpointSequence,
              expectedSequence,
              recordVersion: result.record.version,
              checkpointVersion: checkpoint?.version ?? null,
            }
          );
        }
        skippedRecords += 1;
        continue;
      }
      const expectedLegacySequence: number = previousLegacySequence === null
        ? checkpointSequence + 1
        : previousLegacySequence + 1;
      if (sequence !== expectedLegacySequence) legacySequenceDiscontinuities += 1;
      // The v1 writer assigned sequence numbers before unsynchronized async
      // appends, so its physical WAL order can be non-monotonic. Preserve the
      // established v1 replay-in-file-order behavior, but hand v2 the maximum
      // observed legacy sequence so the upgraded writer cannot reuse one.
      previousLegacySequence = sequence;
      if (sequence > highestLegacySequence) highestLegacySequence = sequence;
      previousReplaySequence = highestLegacySequence;
    } else {
      currentFormatReached = true;
      if (sequence !== expectedSequence) {
        if (policy !== 'skip') {
          throw new KvError('KV_RECOVERY_FAILED', 'KV recovery found a missing or out-of-order journal sequence.', {
            sequence,
            previousSequence: previousReplaySequence,
            checkpointSequence,
            expectedSequence,
            recordVersion: result.record.version,
          });
        }
        if (sequence < expectedSequence) {
          skippedRecords += 1;
          continue;
        }
        skippedSequences += sequence - expectedSequence;
      }
    }
    if (result.record.version === KV_PERSISTENCE_FORMAT_VERSION) {
      previousReplaySequence = sequence;
    }
    if (result.record.legacyUndefinedValueMigrated) {
      legacyUndefinedValuesDropped += 1;
    }
    if (sequence > highestSequence) highestSequence = sequence;
    applyKvMutation(config.engine, result.record.mutation, {
      sequence: result.record.sequence,
      timestamp: result.record.timestamp,
    });
    replayedRecords += 1;
  }

  config.journal.setCurrentSequence(highestSequence);
  return {
    checkpointSequence,
    replayedRecords,
    skippedRecords,
    skippedSequences,
    recoveredTailRecords,
    legacySequenceDiscontinuities,
    legacyUndefinedValuesDropped,
  };
}
