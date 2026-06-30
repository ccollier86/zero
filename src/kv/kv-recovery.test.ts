/**
 * kv-recovery.test.ts
 *
 * Verifies KV journal/checkpoint recovery. This test owns persistence-slice
 * behavior only; app-factory wiring and Elysia plugin behavior are tested in
 * later slices.
 */

import { appendFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'bun:test';

import {
  KvCheckpointStore,
  KvError,
  KvFileJournal,
  KvMemoryEngine,
  ManualKvClock,
  recoverKvMemoryEngine,
} from './index';

const testRoot = join(process.cwd(), '.zero/kv-recovery-tests');

describe('KV checkpoint and journal recovery', () => {
  beforeEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
    await mkdir(testRoot, { recursive: true });
  });

  test('restores checkpoint entries and replays newer journal mutations', async () => {
    const dir = join(testRoot, 'restore-and-replay');
    const clock = new ManualKvClock(1000);
    const source = new KvMemoryEngine({ clock });

    source.set('a', 1);
    source.set('b', 2);

    const checkpoint = new KvCheckpointStore({ baseDir: dir, clock });
    await checkpoint.write(source.entries(), source.stats().version);

    const journal = new KvFileJournal({
      baseDir: dir,
      clock,
      durability: 'always',
      initialSequence: source.stats().version,
    });
    await journal.append({ op: 'set', key: 'c', value: 3 });
    await journal.append({ op: 'delete', key: 'a' });
    await journal.append({ op: 'increment', key: 'b', delta: 3 });

    const recovered = new KvMemoryEngine({ clock });
    const result = await recoverKvMemoryEngine({
      engine: recovered,
      checkpoint,
      journal: new KvFileJournal({ baseDir: dir, clock }),
    });

    expect(result.checkpointSequence).toBe(2);
    expect(result.replayedRecords).toBe(3);
    expect(recovered.get('a')).toBeUndefined();
    expect(recovered.get<number>('b')).toBe(5);
    expect(recovered.get<number>('c')).toBe(3);
  });

  test('drops expired checkpoint entries during recovery', async () => {
    const dir = join(testRoot, 'expired-checkpoint');
    const sourceClock = new ManualKvClock(0);
    const source = new KvMemoryEngine({ clock: sourceClock });
    source.set('token', 'old', { ttlMs: 50 });

    const checkpoint = new KvCheckpointStore({ baseDir: dir, clock: sourceClock });
    await checkpoint.write(source.entries(), source.stats().version);

    const recoveryClock = new ManualKvClock(100);
    const recovered = new KvMemoryEngine({ clock: recoveryClock });
    await recoverKvMemoryEngine({
      engine: recovered,
      checkpoint: new KvCheckpointStore({ baseDir: dir, clock: recoveryClock }),
      journal: new KvFileJournal({ baseDir: dir, clock: recoveryClock }),
    });

    expect(recovered.get('token')).toBeUndefined();
    expect(recovered.stats().expiredEntries).toBe(1);
  });

  test('fails or skips corrupt journal records according to policy', async () => {
    const dir = join(testRoot, 'corrupt-journal');
    const clock = new ManualKvClock(0);
    const checkpoint = new KvCheckpointStore({ baseDir: dir, clock });
    await checkpoint.write([], 0);

    const journalPath = join(dir, 'journal.jsonl');
    await appendFile(journalPath, '{ bad json\n');

    await expect(
      recoverKvMemoryEngine({
        engine: new KvMemoryEngine({ clock }),
        checkpoint,
        journal: new KvFileJournal({ baseDir: dir, clock }),
      })
    ).rejects.toThrow(KvError);

    const skipped = await recoverKvMemoryEngine({
      engine: new KvMemoryEngine({ clock }),
      checkpoint,
      journal: new KvFileJournal({ baseDir: dir, clock }),
      corruptRecordPolicy: 'skip',
    });

    expect(skipped.skippedRecords).toBe(1);
  });
});
