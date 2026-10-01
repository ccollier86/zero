/**
 * kv-recovery.test.ts
 *
 * Verifies KV journal/checkpoint recovery. This test owns persistence-slice
 * behavior only; app-factory wiring and Elysia plugin behavior are tested in
 * later slices.
 */

import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'bun:test';

import {
  KvCheckpointStore,
  KvError,
  KvFileJournal,
  KvMemoryEngine,
  ManualKvClock,
  parseKvJournalRecord,
  recoverKvMemoryEngine,
  type ZeroKvEntry,
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

  test('restores checkpoint expiry state for standalone read-time cleanup', async () => {
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

    expect(recovered.storedEntryCount()).toBe(1);
    expect(recovered.get('token')).toBeUndefined();
    expect(recovered.storedEntryCount()).toBe(0);
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

  test('does not create an empty WAL during flush before the first mutation', async () => {
    for (const durability of ['everysec', 'always'] as const) {
      const dir = join(testRoot, `empty-flush-${durability}`);
      const journalPath = join(dir, 'journal.jsonl');
      const journal = new KvFileJournal({
        baseDir: dir,
        durability,
        clock: new ManualKvClock(0),
      });
      await journal.flush();
      await expect(readFile(journalPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

      await journal.append({ op: 'set', key: 'first', value: true });
      await journal.flush();
      expect(await readFile(journalPath, 'utf8')).toContain('"sequence":1');
    }
  });

  test('truncates only an unterminated final WAL frame and preserves the valid prefix', async () => {
    const dir = join(testRoot, 'torn-final-journal-frame');
    const clock = new ManualKvClock(0);
    const checkpoint = new KvCheckpointStore({ baseDir: dir, clock });
    await checkpoint.write([], 0);
    const journal = new KvFileJournal({ baseDir: dir, durability: 'always', clock });
    await journal.append({ op: 'set', key: 'kept', value: 'prefix' });
    await appendFile(join(dir, 'journal.jsonl'), '{"version":1,"sequence":2');

    const recovered = new KvMemoryEngine({ clock });
    const result = await recoverKvMemoryEngine({ engine: recovered, checkpoint, journal });
    expect(result.skippedRecords).toBe(1);
    expect(result.recoveredTailRecords).toBe(1);
    expect(recovered.get<string>('kept')).toBe('prefix');
    expect((await readFile(join(dir, 'journal.jsonl'), 'utf8')).endsWith('\n')).toBe(true);

    await journal.append({ op: 'set', key: 'after-repair', value: true });
    const secondRecovery = new KvMemoryEngine({ clock });
    await recoverKvMemoryEngine({
      engine: secondRecovery,
      checkpoint,
      journal: new KvFileJournal({ baseDir: dir, durability: 'always', clock }),
    });
    expect(secondRecovery.get<string>('kept')).toBe('prefix');
    expect(secondRecovery.get<boolean>('after-repair')).toBe(true);

    await appendFile(join(dir, 'journal.jsonl'), '{ bad complete frame }\n');
    await expect(recoverKvMemoryEngine({
      engine: new KvMemoryEngine({ clock }),
      checkpoint,
      journal: new KvFileJournal({ baseDir: dir, durability: 'always', clock }),
    })).rejects.toMatchObject({ code: 'KV_RECOVERY_FAILED' });

    const skipJournal = new KvFileJournal({ baseDir: dir, durability: 'always', clock });
    const skippedEngine = new KvMemoryEngine({ clock });
    const skipped = await recoverKvMemoryEngine({
      engine: skippedEngine,
      checkpoint,
      journal: skipJournal,
      corruptRecordPolicy: 'skip',
    });
    expect(skipped.skippedRecords).toBe(1);
    expect(skipJournal.currentSequence()).toBe(2);
    const resumed = await skipJournal.append({ op: 'set', key: 'after-skip', value: true });
    expect(resumed.sequence).toBe(3);

    const skipRestart = new KvMemoryEngine({ clock });
    await recoverKvMemoryEngine({
      engine: skipRestart,
      checkpoint,
      journal: new KvFileJournal({ baseDir: dir, durability: 'always', clock }),
      corruptRecordPolicy: 'skip',
    });
    expect(skipRestart.get<boolean>('after-skip')).toBe(true);
  });

  test('validates a checkpoint JSON round-trip before replacing the last good snapshot', async () => {
    const dir = join(testRoot, 'checkpoint-write-validation');
    const clock = new ManualKvClock(0);
    const checkpoint = new KvCheckpointStore({ baseDir: dir, clock });
    const source = new KvMemoryEngine({ clock });
    source.set('kept', 'valid');
    await checkpoint.write(source.entries(), source.stats().version);
    const lastGood = await readFile(checkpoint.path(), 'utf8');
    const validEntry = source.entries()[0]!;
    const invalidValues: unknown[] = [undefined, Number.NaN, new Date(0), BigInt(1)];
    for (const value of invalidValues) {
      const invalidEntry = { ...validEntry, value } as unknown as ZeroKvEntry;
      await expect(checkpoint.write([invalidEntry], source.stats().version)).rejects.toMatchObject({
        code: 'KV_CHECKPOINT_INVALID',
      });
    }
    await expect(checkpoint.write([], Number.NaN)).rejects.toMatchObject({
      code: 'KV_CHECKPOINT_INVALID',
    });
    await expect(checkpoint.write([], Number.MAX_SAFE_INTEGER + 1)).rejects.toMatchObject({
      code: 'KV_CHECKPOINT_INVALID',
    });
    expect(() => new KvFileJournal({
      baseDir: dir,
      durability: 'always',
      initialSequence: Number.MAX_SAFE_INTEGER + 1,
    })).toThrow(KvError);
    const exhausted = new KvFileJournal({
      baseDir: dir,
      durability: 'always',
      initialSequence: Number.MAX_SAFE_INTEGER,
    });
    await expect(exhausted.append({ op: 'delete', key: 'never-written' })).rejects.toMatchObject({
      code: 'KV_PERSISTENCE_FAILED',
    });
    expect(await readFile(checkpoint.path(), 'utf8')).toBe(lastGood);
    await expect(checkpoint.read()).resolves.toMatchObject({
      entries: [expect.objectContaining({ key: 'kept', value: 'valid' })],
    });
  });

  test('classifies invalid persisted values, timestamps, and keys at the parser boundary', async () => {
    const dir = join(testRoot, 'invalid-persistence-values');
    const clock = new ManualKvClock(0);
    const checkpoint = new KvCheckpointStore({ baseDir: dir, clock });
    await checkpoint.write([], 0);

    const journalPath = join(dir, 'journal.jsonl');
    await appendFile(journalPath, [
      '{"version":2,"sequence":1,"timestamp":0,"mutation":{"op":"set","key":"valid","value":"kept","expiresAt":null}}',
      '{"version":2,"sequence":2,"timestamp":0,"mutation":{"op":"set","key":"bad-value","value":1e400,"expiresAt":null}}',
      '{"version":2,"sequence":3,"timestamp":1e400,"mutation":{"op":"delete","key":"bad-time"}}',
      '{"version":2,"sequence":4,"timestamp":0,"mutation":{"op":"delete","key":""}}',
      '{"version":2,"sequence":5,"timestamp":0,"mutation":{"op":"set","key":"missing-value","expiresAt":null}}',
    ].join('\n') + '\n');

    await expect(recoverKvMemoryEngine({
      engine: new KvMemoryEngine({ clock }),
      checkpoint,
      journal: new KvFileJournal({ baseDir: dir, clock }),
    })).rejects.toMatchObject({ code: 'KV_RECOVERY_FAILED' });

    const skippedEngine = new KvMemoryEngine({ clock });
    const skipped = await recoverKvMemoryEngine({
      engine: skippedEngine,
      checkpoint,
      journal: new KvFileJournal({ baseDir: dir, clock }),
      corruptRecordPolicy: 'skip',
    });
    expect(skipped.skippedRecords).toBe(4);
    expect(skippedEngine.get<string>('valid')).toBe('kept');

    const checkpointPath = checkpoint.path();
    const invalidEntries = [
      '{"key":"bad-value","kind":"value","value":1e400,"expiresAt":null,"version":1,"createdAt":0,"updatedAt":0,"lastAccessedAt":0,"sizeBytes":1}',
      '{"key":"","kind":"value","value":"bad-key","expiresAt":null,"version":1,"createdAt":0,"updatedAt":0,"lastAccessedAt":0,"sizeBytes":1}',
      '{"key":"missing-value","kind":"value","expiresAt":null,"version":1,"createdAt":0,"updatedAt":0,"lastAccessedAt":0,"sizeBytes":1}',
    ];
    for (const [index, entry] of invalidEntries.entries()) {
      await writeFile(
        checkpointPath,
        `{"version":${index === 2 ? 2 : 1},"sequence":1,"timestamp":0,"entries":[${entry}]}`
      );
      await expect(checkpoint.read()).rejects.toMatchObject({ code: 'KV_CHECKPOINT_INVALID' });
    }
    await writeFile(checkpointPath, '{"version":1,"sequence":1,"timestamp":1e400,"entries":[]}');
    await expect(checkpoint.read()).rejects.toMatchObject({ code: 'KV_CHECKPOINT_INVALID' });

    expect(() => parseKvJournalRecord(
      '{"version":2,"sequence":1,"timestamp":0,"mutation":{"op":"delete","key":"victim","maintenance":"prune"}}'
    )).toThrow(KvError);
    expect(() => parseKvJournalRecord(
      '{"version":2,"sequence":1,"timestamp":0,"mutation":{"op":"delete","key":"victim","maintenance":"prune","evaluatedAt":0,"pruneAt":0}}'
    )).toThrow(KvError);
    expect(() => parseKvJournalRecord(
      '{"version":2,"sequence":1,"timestamp":0,"mutation":{"op":"expire","key":"victim"}}'
    )).toThrow(KvError);
    await writeFile(checkpointPath, [
      '{"version":2,"sequence":1,"timestamp":0,"entries":[',
      '{"key":"missing-expiry","kind":"value","value":true,"version":1,"createdAt":0,"updatedAt":0,"lastAccessedAt":0,"sizeBytes":4}',
      ']}',
    ].join(''));
    await expect(checkpoint.read()).rejects.toMatchObject({ code: 'KV_CHECKPOINT_INVALID' });
  });

  test('preserves legacy physical replay order while rejecting impossible checkpoints', async () => {
    const dir = join(testRoot, 'invalid-persistence-order');
    const clock = new ManualKvClock(0);
    const checkpoint = new KvCheckpointStore({ baseDir: dir, clock });
    await mkdir(dir, { recursive: true });
    await writeFile(checkpoint.path(), '{"version":1,"sequence":0,"timestamp":0,"entries":[]}');
    await writeFile(join(dir, 'journal.jsonl'), [
      '{"version":1,"sequence":2,"timestamp":0,"mutation":{"op":"set","key":"ordered","value":"first","expiresAt":null}}',
      '{"version":1,"sequence":1,"timestamp":0,"mutation":{"op":"set","key":"ordered","value":"must-skip","expiresAt":null}}',
    ].join('\n') + '\n');

    const legacyEngine = new KvMemoryEngine({ clock });
    const legacyResult = await recoverKvMemoryEngine({
      engine: legacyEngine,
      checkpoint,
      journal: new KvFileJournal({ baseDir: dir, clock }),
    });
    expect(legacyResult.legacySequenceDiscontinuities).toBe(2);
    expect(legacyEngine.get<string>('ordered')).toBe('must-skip');

    await writeFile(checkpoint.path(), [
      '{"version":1,"sequence":1,"timestamp":0,"entries":[',
      '{"key":"future","kind":"value","value":true,"expiresAt":null,"version":2,"createdAt":0,"updatedAt":0,"lastAccessedAt":0,"sizeBytes":4}',
      ']}',
    ].join(''));
    await expect(checkpoint.read()).rejects.toMatchObject({ code: 'KV_CHECKPOINT_INVALID' });
  });

  test('rejects missing WAL sequences while accepting a covered retained prefix', async () => {
    const dir = join(testRoot, 'journal-sequence-gaps');
    const clock = new ManualKvClock(0);
    const checkpoint = new KvCheckpointStore({ baseDir: dir, clock });
    await checkpoint.write([], 0);
    const journalPath = join(dir, 'journal.jsonl');
    await writeFile(journalPath, [
      '{"version":2,"sequence":1,"timestamp":0,"mutation":{"op":"set","key":"a","value":1,"expiresAt":null}}',
      '{"version":2,"sequence":3,"timestamp":0,"mutation":{"op":"set","key":"c","value":3,"expiresAt":null}}',
    ].join('\n') + '\n');
    await expect(recoverKvMemoryEngine({
      engine: new KvMemoryEngine({ clock }),
      checkpoint,
      journal: new KvFileJournal({ baseDir: dir, clock }),
    })).rejects.toMatchObject({ code: 'KV_RECOVERY_FAILED' });

    await checkpoint.write([], 10);
    await writeFile(journalPath, [
      '{"version":1,"sequence":5,"timestamp":0,"mutation":{"op":"set","key":"covered","value":true,"expiresAt":null}}',
      '{"version":1,"sequence":6,"timestamp":0,"mutation":{"op":"delete","key":"covered"}}',
    ].join('\n') + '\n');
    const result = await recoverKvMemoryEngine({
      engine: new KvMemoryEngine({ clock }),
      checkpoint,
      journal: new KvFileJournal({ baseDir: dir, clock }),
    });
    expect(result.checkpointSequence).toBe(10);
    expect(result.replayedRecords).toBe(0);
  });

  test('upgrades legacy sequence gaps and undefined values before appending current records', async () => {
    const dir = join(testRoot, 'legacy-journal-upgrade');
    const clock = new ManualKvClock(0);
    const journalPath = join(dir, 'journal.jsonl');
    await mkdir(dir, { recursive: true });
    await writeFile(journalPath, [
      '{"version":1,"sequence":2,"timestamp":0,"mutation":{"op":"set","key":"kept","value":"legacy","expiresAt":null}}',
      '{"version":1,"sequence":4,"timestamp":0,"mutation":{"op":"set","key":"undefined-value","expiresAt":null}}',
    ].join('\n') + '\n');

    const journal = new KvFileJournal({ baseDir: dir, durability: 'always', clock });
    const recovered = new KvMemoryEngine({ clock });
    const first = await recoverKvMemoryEngine({
      engine: recovered,
      checkpoint: new KvCheckpointStore({ baseDir: dir, clock }),
      journal,
    });

    expect(first.legacySequenceDiscontinuities).toBe(2);
    expect(first.legacyUndefinedValuesDropped).toBe(1);
    expect(first.replayedRecords).toBe(2);
    expect(recovered.get<string>('kept')).toBe('legacy');
    expect(recovered.has('undefined-value')).toBe(false);
    expect(journal.currentSequence()).toBe(4);

    const appended = await journal.append({ op: 'set', key: 'current', value: 'v2' });
    expect(appended.version).toBe(2);
    expect(appended.sequence).toBe(5);

    const restarted = new KvMemoryEngine({ clock });
    const second = await recoverKvMemoryEngine({
      engine: restarted,
      checkpoint: new KvCheckpointStore({ baseDir: dir, clock }),
      journal: new KvFileJournal({ baseDir: dir, durability: 'always', clock }),
    });
    expect(second.legacySequenceDiscontinuities).toBe(2);
    expect(second.legacyUndefinedValuesDropped).toBe(1);
    expect(restarted.get<string>('kept')).toBe('legacy');
    expect(restarted.get<string>('current')).toBe('v2');
  });

  test('trusts covered legacy gaps, supports mixed upgrades, and rejects format downgrade', async () => {
    const dir = join(testRoot, 'mixed-format-upgrade');
    const clock = new ManualKvClock(0);
    const checkpoint = new KvCheckpointStore({ baseDir: dir, clock });
    await mkdir(dir, { recursive: true });
    await writeFile(checkpoint.path(), [
      '{"version":1,"sequence":3,"timestamp":0,"entries":[',
      '{"key":"kept","kind":"value","value":"checkpoint","expiresAt":null,"version":2,"createdAt":0,"updatedAt":0,"lastAccessedAt":0,"sizeBytes":10},',
      '{"key":"undefined-value","kind":"value","expiresAt":null,"version":3,"createdAt":0,"updatedAt":0,"lastAccessedAt":0,"sizeBytes":0}',
      ']}',
    ].join(''));
    const journalPath = join(dir, 'journal.jsonl');
    await writeFile(journalPath, [
      '{"version":1,"sequence":1,"timestamp":0,"mutation":{"op":"set","key":"covered","value":true,"expiresAt":null}}',
      '{"version":1,"sequence":3,"timestamp":0,"mutation":{"op":"delete","key":"covered"}}',
    ].join('\n') + '\n');

    const journal = new KvFileJournal({ baseDir: dir, durability: 'always', clock });
    const recovered = new KvMemoryEngine({ clock });
    const first = await recoverKvMemoryEngine({ engine: recovered, checkpoint, journal });
    expect(first.replayedRecords).toBe(0);
    expect(first.legacySequenceDiscontinuities).toBe(0);
    expect(first.legacyUndefinedValuesDropped).toBe(1);
    expect(recovered.get<string>('kept')).toBe('checkpoint');

    await checkpoint.write(recovered.entries(), 3);
    const appended = await journal.append({ op: 'set', key: 'current', value: true });
    expect(appended.sequence).toBe(4);

    const mixed = new KvMemoryEngine({ clock });
    await recoverKvMemoryEngine({
      engine: mixed,
      checkpoint,
      journal: new KvFileJournal({ baseDir: dir, durability: 'always', clock }),
    });
    expect(mixed.get<string>('kept')).toBe('checkpoint');
    expect(mixed.get<boolean>('current')).toBe(true);

    await appendFile(journalPath,
      '{"version":1,"sequence":5,"timestamp":0,"mutation":{"op":"set","key":"downgrade","value":true,"expiresAt":null}}\n'
    );
    await expect(recoverKvMemoryEngine({
      engine: new KvMemoryEngine({ clock }),
      checkpoint,
      journal: new KvFileJournal({ baseDir: dir, durability: 'always', clock }),
    })).rejects.toMatchObject({ code: 'KV_RECOVERY_FAILED' });

    const skipJournal = new KvFileJournal({ baseDir: dir, durability: 'always', clock });
    const skippedEngine = new KvMemoryEngine({ clock });
    const skipped = await recoverKvMemoryEngine({
      engine: skippedEngine,
      checkpoint,
      journal: skipJournal,
      corruptRecordPolicy: 'skip',
    });
    expect(skipped.skippedRecords).toBe(1);
    expect(skipJournal.currentSequence()).toBe(4);
    const resumed = await skipJournal.append({ op: 'set', key: 'after-skip', value: true });
    expect(resumed.sequence).toBe(5);

    const skipRestart = new KvMemoryEngine({ clock });
    await recoverKvMemoryEngine({
      engine: skipRestart,
      checkpoint,
      journal: new KvFileJournal({ baseDir: dir, durability: 'always', clock }),
      corruptRecordPolicy: 'skip',
    });
    expect(skipRestart.get<boolean>('after-skip')).toBe(true);
  });

  test('replays TTL transformations at mutation time before pruning at restart time', async () => {
    const dir = join(testRoot, 'historical-ttl-replay');
    const writeClock = new ManualKvClock(0);
    const journal = new KvFileJournal({ baseDir: dir, durability: 'always', clock: writeClock });

    await journal.append({ op: 'set', key: 'persisted', value: 'value', expiresAt: 100 });
    await journal.append({ op: 'set', key: 'extended', value: 'value', expiresAt: 100 });
    await journal.append({ op: 'set', key: 'legacy-counter', value: 10, kind: 'counter', expiresAt: 100 });
    await journal.append({ op: 'set', key: 'extended-counter', value: 10, kind: 'counter', expiresAt: 100 });

    writeClock.set(50);
    await journal.append({ op: 'expire', key: 'persisted', expiresAt: null });
    await journal.append({ op: 'expire', key: 'extended', expiresAt: 200 });
    await journal.append({ op: 'increment', key: 'legacy-counter', delta: 5 });
    await journal.append({ op: 'increment', key: 'extended-counter', delta: 5, expiresAt: 200 });

    const recoveryClock = new ManualKvClock(150);
    const recovered = new KvMemoryEngine({ clock: recoveryClock });
    await recoverKvMemoryEngine({
      engine: recovered,
      checkpoint: new KvCheckpointStore({ baseDir: dir, clock: recoveryClock }),
      journal: new KvFileJournal({ baseDir: dir, durability: 'always', clock: recoveryClock }),
    });

    expect(recovered.get<string>('persisted')).toBe('value');
    expect(recovered.get<string>('extended')).toBe('value');
    expect(recovered.get('legacy-counter')).toBeUndefined();
    expect(recovered.get<number>('extended-counter')).toBe(15);
    expect(recovered.getEntry('extended')?.expiresAt).toBe(200);
    expect(recovered.getEntry('extended-counter')?.expiresAt).toBe(200);
  });

  test('preserves historical TTL state while enforcing no-eviction capacity during replay', async () => {
    const dir = join(testRoot, 'historical-capacity-replay');
    const writeClock = new ManualKvClock(0);
    const journal = new KvFileJournal({ baseDir: dir, durability: 'always', clock: writeClock });
    await journal.append({ op: 'set', key: 'a', value: 'persist-me', expiresAt: 100 });
    writeClock.set(10);
    await journal.append({ op: 'set', key: 'b', value: 'other', expiresAt: null });
    writeClock.set(20);
    await journal.append({ op: 'expire', key: 'a', expiresAt: null });

    const recoveryClock = new ManualKvClock(150);
    const recovered = new KvMemoryEngine({
      clock: recoveryClock,
      maxEntries: 2,
      eviction: 'none',
    });
    await recoverKvMemoryEngine({
      engine: recovered,
      checkpoint: new KvCheckpointStore({ baseDir: dir, clock: recoveryClock }),
      journal: new KvFileJournal({ baseDir: dir, durability: 'always', clock: recoveryClock }),
    });

    expect(recovered.get<string>('a')).toBe('persist-me');
    expect(recovered.get<string>('b')).toBe('other');
    expect(recovered.stats().entries).toBe(2);
  });
});
