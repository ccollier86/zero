import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createReactiveDB,
  getReactiveDBLocalChangeOrigin,
  type ReactiveDB,
  withReactiveDBLocalChangeOrigin,
} from './reactive-db';

const databases: ReactiveDB[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const database of databases.splice(0).reverse()) database.dispose();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('ReactiveDB local change origin binding', () => {
  test('binds a complete transaction batch without attributing reentrant writes', () => {
    const database = createDatabase();
    const observed: Array<[string, string | null]> = [];

    database.onChange((change) => {
      if (change.rowId === 'outer-one') {
        database.insert('items', { id: 'reentrant', name: 'Reentrant' });
      }
      if (change.rowId === 'outer-two') {
        throw new Error('listener failure must not skip origin cleanup');
      }
    });
    database.onChange((change) => {
      observed.push([
        change.rowId,
        getReactiveDBLocalChangeOrigin(database, change.seq),
      ]);
    });

    withReactiveDBLocalChangeOrigin(database, 'connection-a', () => {
      database.transaction(() => {
        database.insert('items', { id: 'outer-one', name: 'One' });
        database.insert('items', { id: 'outer-two', name: 'Two' });
      });
    });

    expect(observed).toEqual([
      ['outer-one', 'connection-a'],
      ['outer-two', 'connection-a'],
      ['reentrant', null],
    ]);
    for (const change of database.getChangesAfter(0) ?? []) {
      expect(getReactiveDBLocalChangeOrigin(database, change.seq)).toBeNull();
    }
  });

  test('removes rolled-back attribution before SQLite reuses the sequence', () => {
    const database = createDatabase();
    const observed: Array<[string, string | null]> = [];
    database.onChange((change) => {
      observed.push([
        change.rowId,
        getReactiveDBLocalChangeOrigin(database, change.seq),
      ]);
    });

    expect(() => withReactiveDBLocalChangeOrigin(database, 'rolled-back-origin', () => {
      database.transaction(() => {
        database.insert('items', { id: 'rolled-back', name: 'No commit' });
        throw new Error('rollback');
      });
    })).toThrow('rollback');

    const committed = database.insert('items', { id: 'after', name: 'After' });
    expect(committed.seq).toBe(1);
    expect(observed).toEqual([['after', null]]);
    expect(getReactiveDBLocalChangeOrigin(database, committed.seq)).toBeNull();
  });

  test('retains exact local origin through a delayed drain and never exposes it externally', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-local-origin-'));
    directories.push(directory);
    const path = join(directory, 'app.sqlite');
    const first = createDatabase(path);
    const second = createDatabase(path);
    const firstObserved: Array<[string, string | null]> = [];
    const secondObserved: Array<[string, 'local' | 'external', string | null]> = [];

    first.onChange((change) => {
      firstObserved.push([
        change.rowId,
        getReactiveDBLocalChangeOrigin(first, change.seq),
      ]);
    });
    second.onChange((change, delivery) => {
      secondObserved.push([
        change.rowId,
        delivery.source,
        getReactiveDBLocalChangeOrigin(second, change.seq),
      ]);
      if (change.rowId === 'remote-trigger') {
        // This commit occurs while the replica dispatcher is already draining.
        // Its own row is queued for the next drain pass, after this origin
        // scope has returned.
        withReactiveDBLocalChangeOrigin(second, 'connection-b', () => {
          second.insert('items', { id: 'delayed-local', name: 'Delayed local' });
        });
      }
    });
    second.startExternalChangePolling({ intervalMs: 10 });

    withReactiveDBLocalChangeOrigin(first, 'connection-a', () => {
      first.insert('items', { id: 'remote-trigger', name: 'Remote trigger' });
    });

    await waitUntil(() => secondObserved.some(([rowId]) => rowId === 'delayed-local'));
    expect(firstObserved).toEqual([['remote-trigger', 'connection-a']]);
    expect(secondObserved).toEqual([
      ['remote-trigger', 'external', null],
      ['delayed-local', 'local', 'connection-b'],
    ]);
    for (const change of second.getChangesAfter(0) ?? []) {
      expect(getReactiveDBLocalChangeOrigin(second, change.seq)).toBeNull();
    }
  });

  test('clears local origins skipped by a handled retention gap', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-local-origin-gap-'));
    directories.push(directory);
    const path = join(directory, 'app.sqlite');
    const first = createDatabase(path, 1);
    const second = createDatabase(path, 1);
    const gapKinds: string[] = [];
    let skippedSequence: number | null = null;

    second.onChange((change) => {
      if (change.rowId !== 'remote-trigger') return;

      withReactiveDBLocalChangeOrigin(second, 'skipped-origin', () => {
        skippedSequence = second.insert('items', {
          id: 'skipped-local',
          name: 'Skipped local',
        }).seq;
      });
      // With a depth of one, this next commit prunes the attributed row before
      // the already-running dispatcher can begin its queued drain pass.
      second.insert('items', { id: 'pruning-local', name: 'Pruning local' });
    });
    second.startExternalChangePolling({
      intervalMs: 10,
      onGap: (gap) => gapKinds.push(gap.kind),
    });

    first.insert('items', { id: 'remote-trigger', name: 'Remote trigger' });

    await waitUntil(() => gapKinds.length > 0);
    if (skippedSequence === null) throw new Error('Expected a skipped local sequence');
    expect(gapKinds).toEqual(['retention']);
    expect(getReactiveDBLocalChangeOrigin(second, skippedSequence)).toBeNull();
  });

  test('clears all local origins when a fatal read invalidates the dispatcher', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-local-origin-invalid-'));
    directories.push(directory);
    const path = join(directory, 'app.sqlite');
    const first = createDatabase(path);
    const second = createDatabase(path);
    const raw = second.getRawDatabase();
    const invalidations: unknown[] = [];
    let skippedSequence: number | null = null;

    second.onChange((change) => {
      if (change.rowId !== 'remote-trigger') return;

      withReactiveDBLocalChangeOrigin(second, 'invalidated-origin', () => {
        skippedSequence = second.insert('items', {
          id: 'invalidated-local',
          name: 'Invalidated local',
        }).seq;
      });
      // Poison the durable state after the attributed commit queued another
      // drain. The fatal read is caught by drain(), so no row reaches
      // emitChange() to perform ordinary per-sequence cleanup.
      raw.run('DROP TRIGGER _zero_sync_log_state_update_fence_v1');
      raw.run(`
        UPDATE _zero_sync_log_state
        SET schema_version = 2, write_format = 2
        WHERE singleton = 1
      `);
    });
    second.startExternalChangePolling({
      intervalMs: 10,
      onInvalid: (error) => invalidations.push(error),
    });

    first.insert('items', { id: 'remote-trigger', name: 'Remote trigger' });

    await waitUntil(() => invalidations.length > 0);
    if (skippedSequence === null) throw new Error('Expected an invalidated local sequence');
    expect(String(invalidations[0])).toContain('ZERO_SYNC_LOG_STATE_INVALID');
    expect(getReactiveDBLocalChangeOrigin(second, skippedSequence)).toBeNull();
  });
});

function createDatabase(
  path: string = ':memory:',
  ringBufferDepth?: number,
): ReactiveDB {
  const database = createReactiveDB({
    mode: path === ':memory:' ? 'memory' : path,
    busyTimeout: 10_000,
    ...(ringBufferDepth === undefined ? {} : { ringBufferDepth }),
  });
  database.defineTable('items', {
    id: 'text primary key',
    name: 'text not null',
  });
  databases.push(database);
  return database;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
